// Media inspection via FFprobe — extracts stream metadata and assesses DVD compatibility.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::Path;
use std::process::Command;

use serde::Deserialize;

use crate::models::*;

/// Run ffprobe on the given file and return a populated Asset.
pub fn inspect(path: &str) -> crate::Result<Asset> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "-show_chapters",
            path,
        ])
        .output()
        .map_err(|e| {
            crate::Error::Inspection(format!(
                "Failed to run ffprobe: {e}. Ensure ffprobe is installed and on the PATH."
            ))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(crate::Error::Inspection(format!(
            "ffprobe exited with status {}: {stderr}",
            output.status
        )));
    }

    let probe: FfprobeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|e| crate::Error::Inspection(format!("Failed to parse ffprobe output: {e}")))?;

    let file_path = Path::new(path);
    let file_name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    let file_size_bytes = probe
        .format
        .as_ref()
        .and_then(|f| f.size.as_deref())
        .and_then(|s| s.parse::<u64>().ok());

    let duration_secs = probe
        .format
        .as_ref()
        .and_then(|f| f.duration.as_deref())
        .and_then(|s| s.parse::<f64>().ok());

    let container_format = probe.format.as_ref().and_then(|f| f.format_name.clone());
    let format_title = probe
        .format
        .as_ref()
        .and_then(|f| f.tags.as_ref())
        .and_then(|t| t.title.clone())
        .filter(|t| !t.is_empty());

    let mut video_streams = Vec::new();
    let mut audio_streams = Vec::new();
    let mut subtitle_streams = Vec::new();

    let mut asset_warnings = Vec::new();

    for stream in probe.streams.unwrap_or_default() {
        match stream.codec_type.as_deref() {
            Some("video") => {
                // Skip attached pictures (album art, etc.)
                if stream
                    .disposition
                    .as_ref()
                    .is_some_and(|d| d.attached_pic == 1)
                {
                    continue;
                }
                let dolby_vision_profile = detect_dolby_vision_profile(&stream);
                video_streams.push(VideoStreamInfo {
                    index: stream.index,
                    codec: stream.codec_name.clone().unwrap_or_default(),
                    width: stream.width.unwrap_or(0),
                    height: stream.height.unwrap_or(0),
                    frame_rate: parse_frame_rate(stream.r_frame_rate.as_deref()),
                    aspect_ratio: stream.display_aspect_ratio.clone(),
                    scan_type: detect_scan_type(&stream),
                    bitrate_bps: stream.bit_rate.as_deref().and_then(|s| s.parse().ok()),
                    title: stream.tags.as_ref().and_then(|t| t.title.clone()),
                    color_transfer: stream.color_transfer.clone(),
                    color_primaries: stream.color_primaries.clone(),
                    dolby_vision_profile,
                });

                if let Some(profile) = dolby_vision_profile {
                    asset_warnings.push(AssetWarning {
                        code: "video.dolby-vision".to_string(),
                        message: format!(
                            "Dolby Vision profile {profile} detected. SDR DVD output may have incorrect colours."
                        ),
                    });
                }
            }
            Some("audio") => {
                audio_streams.push(AudioStreamInfo {
                    index: stream.index,
                    codec: stream.codec_name.unwrap_or_default(),
                    channels: stream.channels.unwrap_or(0),
                    sample_rate: stream
                        .sample_rate
                        .as_deref()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(0),
                    language: stream.tags.as_ref().and_then(|t| t.language.clone()),
                    bitrate_bps: stream.bit_rate.as_deref().and_then(|s| s.parse().ok()),
                    title: stream.tags.as_ref().and_then(|t| t.title.clone()),
                });
            }
            Some("subtitle") => {
                let codec = stream.codec_name.clone().unwrap_or_default();
                subtitle_streams.push(SubtitleStreamInfo {
                    index: stream.index,
                    codec: codec.clone(),
                    language: stream.tags.as_ref().and_then(|t| t.language.clone()),
                    subtitle_type: classify_subtitle_type(&codec),
                    title: stream.tags.as_ref().and_then(|t| t.title.clone()),
                });
            }
            _ => {}
        }
    }

    // Extract chapter markers from source media
    let source_chapters: Vec<SourceChapter> = probe
        .chapters
        .iter()
        .filter_map(|ch| {
            let start = ch.start_time.as_deref()?.parse::<f64>().ok()?;
            let end = ch.end_time.as_deref()?.parse::<f64>().ok()?;
            Some(SourceChapter {
                start_secs: start,
                end_secs: end,
                title: ch.tags.as_ref().and_then(|t| t.title.clone()),
            })
        })
        .collect();

    // Compute fingerprint from file size + path (lightweight; full hashing is Phase 10)
    let fingerprint = file_size_bytes.map(|size| format!("{:x}-{}", size, file_name.len()));

    let compatibility = assess_dvd_compatibility(&video_streams, &audio_streams, &container_format);
    let compatibility_detail = build_compatibility_detail(
        &video_streams,
        &audio_streams,
        &container_format,
        compatibility,
    );

    Ok(Asset {
        id: uuid::Uuid::new_v4().to_string(),
        file_name,
        source_path: path.to_string(),
        file_size_bytes,
        duration_secs,
        container_format,
        video_streams,
        audio_streams,
        subtitle_streams,
        compatibility: Some(compatibility),
        compatibility_detail: Some(compatibility_detail),
        fingerprint,
        warnings: dedupe_asset_warnings(asset_warnings),
        thumbnail_path: None,
        thumbnail_error: None,
        source_chapters,
        format_title,
    })
}

/// Extract a thumbnail from a video file at the given timestamp.
///
/// Writes a JPEG image to `output_path` using ffmpeg.
pub fn extract_thumbnail(
    source_path: &str,
    output_path: &str,
    timestamp_secs: f64,
) -> crate::Result<()> {
    let ts = format!("{:.2}", timestamp_secs);
    let asset = inspect(source_path)?;
    let thumbnail_filter = asset
        .video_streams
        .first()
        .map(build_thumbnail_filter)
        .unwrap_or_else(|| "scale=640:360:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1".to_string());

    let output = Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-y",
            "-ss",
            &ts,
            "-i",
            source_path,
            "-vf",
            &thumbnail_filter,
            "-frames:v",
            "1",
            "-q:v",
            "3",
            output_path,
        ])
        .output()
        .map_err(|e| {
            crate::Error::Inspection(format!(
                "Failed to run ffmpeg for thumbnail extraction: {e}"
            ))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(crate::Error::Inspection(format!(
            "ffmpeg thumbnail extraction failed: {stderr}"
        )));
    }

    Ok(())
}

fn build_thumbnail_filter(video: &VideoStreamInfo) -> String {
    let mut filter_parts = Vec::new();

    if is_hdr_source(video) {
        filter_parts.push(
            "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,\
             tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
                .to_string(),
        );
    }

    let target_width = 640;
    let target_height = 360;
    let source_dar = source_display_aspect_ratio(video).unwrap_or_else(|| {
        if video.width > 0 && video.height > 0 {
            video.width as f64 / video.height as f64
        } else {
            target_width as f64 / target_height as f64
        }
    });
    let target_dar = target_width as f64 / target_height as f64;

    let (scaled_width, scaled_height) = if source_dar > target_dar {
        (
            target_width,
            round_even(target_width as f64 / source_dar).min(target_height),
        )
    } else {
        (
            round_even(target_height as f64 * source_dar).min(target_width),
            target_height,
        )
    };

    let pad_x = (target_width.saturating_sub(scaled_width)) / 2;
    let pad_y = (target_height.saturating_sub(scaled_height)) / 2;

    filter_parts.push(format!(
        "scale={scaled_width}:{scaled_height},pad={target_width}:{target_height}:{pad_x}:{pad_y},setsar=1"
    ));

    filter_parts.join(",")
}

fn source_display_aspect_ratio(info: &VideoStreamInfo) -> Option<f64> {
    parse_display_aspect_ratio(info.aspect_ratio.as_deref()).or_else(|| {
        if info.width > 0 && info.height > 0 {
            Some(info.width as f64 / info.height as f64)
        } else {
            None
        }
    })
}

fn parse_display_aspect_ratio(value: Option<&str>) -> Option<f64> {
    let value = value?;
    let (num, den) = value.split_once(':')?;
    let num: f64 = num.parse().ok()?;
    let den: f64 = den.parse().ok()?;
    if den == 0.0 {
        return None;
    }
    Some(num / den)
}

fn round_even(value: f64) -> u32 {
    let rounded = value.round().max(2.0) as u32;
    if rounded % 2 == 0 {
        rounded
    } else {
        rounded.saturating_sub(1)
    }
}

fn is_hdr_source(info: &VideoStreamInfo) -> bool {
    matches!(
        info.color_transfer.as_deref(),
        Some("smpte2084" | "arib-std-b67" | "smpte428")
    )
}

/// Assess how compatible an asset is with DVD-Video authoring.
fn assess_dvd_compatibility(
    video_streams: &[VideoStreamInfo],
    audio_streams: &[AudioStreamInfo],
    container: &Option<String>,
) -> CompatibilityAssessment {
    // No video = unsupported for DVD-Video titles (could be audio-only, but not v1)
    if video_streams.is_empty() {
        return CompatibilityAssessment::Unsupported;
    }

    let video = &video_streams[0];

    // Check if the container is MPEG-PS or MPEG-TS (can be remuxed)
    let is_mpeg_container = container.as_ref().is_some_and(|c| {
        let lc = c.to_lowercase();
        lc.contains("mpeg") || lc.contains("vob") || lc.contains("mpegps") || lc.contains("mpegts")
    });

    // Check if video codec is MPEG-2 (DVD-native)
    let is_mpeg2 = video.codec == "mpeg2video";

    // Check if resolution is DVD-compliant
    let is_dvd_resolution = matches!(
        (video.width, video.height),
        (720, 480)
            | (720, 576)
            | (704, 480)
            | (704, 576)
            | (352, 480)
            | (352, 576)
            | (352, 240)
            | (352, 288)
    );

    // Check if frame rate is DVD-compliant
    let is_dvd_framerate = video.frame_rate.map_or(true, |fr| {
        (fr - 29.97).abs() < 0.1 || (fr - 25.0).abs() < 0.1 || (fr - 23.976).abs() < 0.1
    });

    // Check audio compatibility
    let has_dvd_audio = audio_streams.is_empty()
        || audio_streams.iter().any(|a| {
            matches!(
                a.codec.as_str(),
                "ac3" | "dts" | "pcm_s16le" | "pcm_s16be" | "mp2" | "lpcm"
            )
        });

    if is_mpeg2 && is_dvd_resolution && is_dvd_framerate && is_mpeg_container && has_dvd_audio {
        CompatibilityAssessment::RemuxCompatible
    } else if is_mpeg2 && is_dvd_resolution && is_dvd_framerate {
        CompatibilityAssessment::TransformCompatible
    } else {
        CompatibilityAssessment::ReEncodeRequired
    }
}

fn build_compatibility_detail(
    video_streams: &[VideoStreamInfo],
    audio_streams: &[AudioStreamInfo],
    container: &Option<String>,
    overall: CompatibilityAssessment,
) -> CompatibilityDetail {
    let video = video_streams.first().map(|v| {
        let is_mpeg2 = v.codec == "mpeg2video";
        let is_dvd_res = matches!(
            (v.width, v.height),
            (720, 480)
                | (720, 576)
                | (704, 480)
                | (704, 576)
                | (352, 480)
                | (352, 576)
                | (352, 240)
                | (352, 288)
        );
        let is_dvd_fps = v.frame_rate.map_or(true, |fr| {
            (fr - 29.97).abs() < 0.1 || (fr - 25.0).abs() < 0.1 || (fr - 23.976).abs() < 0.1
        });

        VideoCompatibility {
            codec: PropertyCheck {
                value: v.codec.clone(),
                dvd_requires: "mpeg2video".to_string(),
                action: if is_mpeg2 {
                    "none".to_string()
                } else {
                    "re-encode".to_string()
                },
                compatible: is_mpeg2,
            },
            resolution: PropertyCheck {
                value: format!("{}x{}", v.width, v.height),
                dvd_requires: "720x480, 720x576, or other DVD-legal rasters".to_string(),
                action: if is_dvd_res {
                    "none".to_string()
                } else {
                    "scale".to_string()
                },
                compatible: is_dvd_res,
            },
            frame_rate: PropertyCheck {
                value: v
                    .frame_rate
                    .map_or("unknown".to_string(), |fr| format!("{fr:.3}")),
                dvd_requires: "29.97, 25.0, or 23.976 fps".to_string(),
                action: if is_dvd_fps {
                    "none".to_string()
                } else {
                    "re-encode".to_string()
                },
                compatible: is_dvd_fps,
            },
        }
    });

    let audio_compat = audio_streams
        .iter()
        .map(|a| {
            let is_dvd_audio = matches!(
                a.codec.as_str(),
                "ac3" | "dts" | "pcm_s16le" | "pcm_s16be" | "mp2" | "lpcm"
            );
            AudioStreamCompatibility {
                stream_index: a.index,
                codec: PropertyCheck {
                    value: a.codec.clone(),
                    dvd_requires: "ac3, dts, mp2, or lpcm".to_string(),
                    action: if is_dvd_audio {
                        "none".to_string()
                    } else {
                        "re-encode".to_string()
                    },
                    compatible: is_dvd_audio,
                },
            }
        })
        .collect();

    let is_mpeg_container = container.as_ref().is_some_and(|c| {
        let lc = c.to_lowercase();
        lc.contains("mpeg") || lc.contains("vob") || lc.contains("mpegps") || lc.contains("mpegts")
    });

    let container_compat = ContainerCompatibility {
        format: PropertyCheck {
            value: container.clone().unwrap_or_else(|| "unknown".to_string()),
            dvd_requires: "MPEG-PS (VOB)".to_string(),
            action: if is_mpeg_container {
                "none".to_string()
            } else {
                "remux".to_string()
            },
            compatible: is_mpeg_container,
        },
    };

    CompatibilityDetail {
        overall,
        video,
        audio_streams: audio_compat,
        container: container_compat,
    }
}

fn classify_subtitle_type(codec: &str) -> SubtitleType {
    match codec {
        "dvd_subtitle" | "dvdsub" | "hdmv_pgs_subtitle" | "pgssub" => SubtitleType::Bitmap,
        "srt" | "subrip" | "ass" | "ssa" | "webvtt" | "mov_text" => SubtitleType::Text,
        _ => SubtitleType::Unknown,
    }
}

fn parse_frame_rate(rate: Option<&str>) -> Option<f64> {
    let rate = rate?;
    if let Some((num, den)) = rate.split_once('/') {
        let n: f64 = num.parse().ok()?;
        let d: f64 = den.parse().ok()?;
        if d == 0.0 {
            return None;
        }
        Some(n / d)
    } else {
        rate.parse().ok()
    }
}

fn detect_scan_type(stream: &FfprobeStream) -> Option<String> {
    if let Some(ref ft) = stream.field_order {
        match ft.as_str() {
            "progressive" => return Some("progressive".to_string()),
            "tt" | "bb" | "tb" | "bt" => return Some("interlaced".to_string()),
            _ => {}
        }
    }
    None
}

fn detect_dolby_vision_profile(stream: &FfprobeStream) -> Option<u8> {
    stream
        .side_data_list
        .as_ref()?
        .iter()
        .find_map(|side_data| match side_data {
            FfprobeSideData::DoviConfigurationRecord { dv_profile, .. } => Some(*dv_profile),
            _ => None,
        })
}

fn dedupe_asset_warnings(warnings: Vec<AssetWarning>) -> Vec<AssetWarning> {
    let mut seen = std::collections::HashSet::new();
    let mut deduped = Vec::new();

    for warning in warnings {
        if seen.insert((warning.code.clone(), warning.message.clone())) {
            deduped.push(warning);
        }
    }

    deduped
}

// ── FFprobe JSON output structures ──────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    streams: Option<Vec<FfprobeStream>>,
    format: Option<FfprobeFormat>,
    #[serde(default)]
    chapters: Vec<FfprobeChapter>,
}

#[derive(Debug, Deserialize)]
struct FfprobeChapter {
    #[serde(default)]
    start_time: Option<String>,
    #[serde(default)]
    end_time: Option<String>,
    #[serde(default)]
    tags: Option<ChapterTags>,
}

#[derive(Debug, Deserialize)]
struct ChapterTags {
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    index: u32,
    codec_name: Option<String>,
    codec_type: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
    display_aspect_ratio: Option<String>,
    field_order: Option<String>,
    bit_rate: Option<String>,
    color_transfer: Option<String>,
    color_primaries: Option<String>,
    channels: Option<u32>,
    sample_rate: Option<String>,
    tags: Option<StreamTags>,
    disposition: Option<StreamDisposition>,
    side_data_list: Option<Vec<FfprobeSideData>>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    format_name: Option<String>,
    duration: Option<String>,
    size: Option<String>,
    tags: Option<FormatTags>,
}

#[derive(Debug, Deserialize)]
struct FormatTags {
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StreamTags {
    language: Option<String>,
    title: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StreamDisposition {
    attached_pic: u32,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "side_data_type")]
enum FfprobeSideData {
    #[serde(rename = "DOVI configuration record")]
    DoviConfigurationRecord { dv_profile: u8 },
    #[serde(other)]
    Other,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_rate_parsing() {
        assert!((parse_frame_rate(Some("30000/1001")).unwrap() - 29.97).abs() < 0.01);
        assert!((parse_frame_rate(Some("25/1")).unwrap() - 25.0).abs() < 0.01);
        assert!((parse_frame_rate(Some("24000/1001")).unwrap() - 23.976).abs() < 0.01);
        assert!(parse_frame_rate(Some("0/0")).is_none());
        assert!(parse_frame_rate(None).is_none());
    }

    #[test]
    fn subtitle_type_classification() {
        assert!(matches!(
            classify_subtitle_type("dvd_subtitle"),
            SubtitleType::Bitmap
        ));
        assert!(matches!(classify_subtitle_type("srt"), SubtitleType::Text));
        assert!(matches!(
            classify_subtitle_type("subrip"),
            SubtitleType::Text
        ));
        assert!(matches!(
            classify_subtitle_type("unknown_codec"),
            SubtitleType::Unknown
        ));
    }

    #[test]
    fn dvd_compatibility_remux_compatible() {
        let video = vec![VideoStreamInfo {
            index: 0,
            codec: "mpeg2video".to_string(),
            width: 720,
            height: 480,
            frame_rate: Some(29.97),
            aspect_ratio: Some("16:9".to_string()),
            scan_type: Some("interlaced".to_string()),
            bitrate_bps: Some(6_000_000),
            title: None,
            color_transfer: None,
            color_primaries: None,
            dolby_vision_profile: None,
        }];
        let audio = vec![AudioStreamInfo {
            index: 1,
            codec: "ac3".to_string(),
            channels: 6,
            sample_rate: 48000,
            language: Some("eng".to_string()),
            bitrate_bps: Some(448_000),
            title: None,
        }];
        let container = Some("mpeg".to_string());
        assert!(matches!(
            assess_dvd_compatibility(&video, &audio, &container),
            CompatibilityAssessment::RemuxCompatible
        ));
    }

    #[test]
    fn dvd_compatibility_transform_required() {
        let video = vec![VideoStreamInfo {
            index: 0,
            codec: "mpeg2video".to_string(),
            width: 720,
            height: 480,
            frame_rate: Some(29.97),
            aspect_ratio: None,
            scan_type: None,
            bitrate_bps: None,
            title: None,
            color_transfer: None,
            color_primaries: None,
            dolby_vision_profile: None,
        }];
        let audio = vec![];
        let container = Some("matroska".to_string());
        assert!(matches!(
            assess_dvd_compatibility(&video, &audio, &container),
            CompatibilityAssessment::TransformCompatible
        ));
    }

    #[test]
    fn dvd_compatibility_reencode_required() {
        let video = vec![VideoStreamInfo {
            index: 0,
            codec: "h264".to_string(),
            width: 1920,
            height: 1080,
            frame_rate: Some(29.97),
            aspect_ratio: None,
            scan_type: None,
            bitrate_bps: None,
            title: None,
            color_transfer: None,
            color_primaries: None,
            dolby_vision_profile: None,
        }];
        let audio = vec![];
        let container = Some("mp4".to_string());
        assert!(matches!(
            assess_dvd_compatibility(&video, &audio, &container),
            CompatibilityAssessment::ReEncodeRequired
        ));
    }

    #[test]
    fn dvd_compatibility_no_video_is_unsupported() {
        assert!(matches!(
            assess_dvd_compatibility(&[], &[], &None),
            CompatibilityAssessment::Unsupported
        ));
    }

    #[test]
    fn detects_dolby_vision_profile_from_side_data() {
        let stream = FfprobeStream {
            index: 0,
            codec_name: Some("hevc".to_string()),
            codec_type: Some("video".to_string()),
            width: Some(3840),
            height: Some(2160),
            r_frame_rate: Some("24000/1001".to_string()),
            display_aspect_ratio: Some("16:9".to_string()),
            field_order: None,
            bit_rate: None,
            color_transfer: None,
            color_primaries: None,
            channels: None,
            sample_rate: None,
            tags: None,
            disposition: None,
            side_data_list: Some(vec![FfprobeSideData::DoviConfigurationRecord {
                dv_profile: 5,
            }]),
        };

        assert_eq!(detect_dolby_vision_profile(&stream), Some(5));
    }

    #[test]
    fn thumbnail_filter_preserves_ultrawide_aspect_ratio() {
        let filter = build_thumbnail_filter(&VideoStreamInfo {
            index: 0,
            codec: "hevc".to_string(),
            width: 3840,
            height: 1606,
            frame_rate: Some(23.976),
            aspect_ratio: Some("3840:1606".to_string()),
            scan_type: None,
            bitrate_bps: None,
            title: None,
            color_transfer: None,
            color_primaries: None,
            dolby_vision_profile: None,
        });

        assert!(
            filter.contains("scale=640:268,pad=640:360:0:46,setsar=1"),
            "unexpected thumbnail filter: {filter}"
        );
    }

    #[test]
    fn thumbnail_filter_applies_hdr_tonemap() {
        let filter = build_thumbnail_filter(&VideoStreamInfo {
            index: 0,
            codec: "hevc".to_string(),
            width: 3840,
            height: 2160,
            frame_rate: Some(23.976),
            aspect_ratio: Some("16:9".to_string()),
            scan_type: None,
            bitrate_bps: None,
            title: None,
            color_transfer: Some("smpte2084".to_string()),
            color_primaries: Some("bt2020".to_string()),
            dolby_vision_profile: None,
        });

        assert!(
            filter.contains("tonemap=hable"),
            "expected HDR tonemap: {filter}"
        );
    }
}
