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
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            path,
        ])
        .output()
        .map_err(|e| crate::Error::Inspection(format!(
            "Failed to run ffprobe: {e}. Ensure ffprobe is installed and on the PATH."
        )))?;

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

    let container_format = probe
        .format
        .as_ref()
        .and_then(|f| f.format_name.clone());

    let mut video_streams = Vec::new();
    let mut audio_streams = Vec::new();
    let mut subtitle_streams = Vec::new();

    for stream in probe.streams.unwrap_or_default() {
        match stream.codec_type.as_deref() {
            Some("video") => {
                // Skip attached pictures (album art, etc.)
                if stream.disposition.as_ref().is_some_and(|d| d.attached_pic == 1) {
                    continue;
                }
                video_streams.push(VideoStreamInfo {
                    index: stream.index,
                    codec: stream.codec_name.clone().unwrap_or_default(),
                    width: stream.width.unwrap_or(0),
                    height: stream.height.unwrap_or(0),
                    frame_rate: parse_frame_rate(stream.r_frame_rate.as_deref()),
                    aspect_ratio: stream.display_aspect_ratio.clone(),
                    scan_type: detect_scan_type(&stream),
                    bitrate_bps: stream
                        .bit_rate
                        .as_deref()
                        .and_then(|s| s.parse().ok()),
                });
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
                    language: stream
                        .tags
                        .as_ref()
                        .and_then(|t| t.language.clone()),
                    bitrate_bps: stream
                        .bit_rate
                        .as_deref()
                        .and_then(|s| s.parse().ok()),
                });
            }
            Some("subtitle") => {
                let codec = stream.codec_name.clone().unwrap_or_default();
                subtitle_streams.push(SubtitleStreamInfo {
                    index: stream.index,
                    codec: codec.clone(),
                    language: stream
                        .tags
                        .as_ref()
                        .and_then(|t| t.language.clone()),
                    subtitle_type: classify_subtitle_type(&codec),
                });
            }
            _ => {}
        }
    }

    // Compute fingerprint from file size + path (lightweight; full hashing is Phase 10)
    let fingerprint = file_size_bytes
        .map(|size| format!("{:x}-{}", size, file_name.len()));

    let compatibility = assess_dvd_compatibility(
        &video_streams,
        &audio_streams,
        &container_format,
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
        fingerprint,
    })
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
        (720, 480) | (720, 576) | (704, 480) | (704, 576)
        | (352, 480) | (352, 576) | (352, 240) | (352, 288)
    );

    // Check if frame rate is DVD-compliant
    let is_dvd_framerate = video.frame_rate.map_or(true, |fr| {
        (fr - 29.97).abs() < 0.1
            || (fr - 25.0).abs() < 0.1
            || (fr - 23.976).abs() < 0.1
    });

    // Check audio compatibility
    let has_dvd_audio = audio_streams.is_empty() || audio_streams.iter().any(|a| {
        matches!(
            a.codec.as_str(),
            "ac3" | "dts" | "pcm_s16le" | "pcm_s16be" | "mp2" | "lpcm"
        )
    });

    if is_mpeg2 && is_dvd_resolution && is_dvd_framerate && is_mpeg_container && has_dvd_audio {
        CompatibilityAssessment::RemuxCompatible
    } else if is_mpeg2 && is_dvd_resolution && is_dvd_framerate {
        CompatibilityAssessment::TransformCompatible
    } else if is_dvd_framerate {
        CompatibilityAssessment::ReEncodeRequired
    } else {
        CompatibilityAssessment::ReEncodeRequired
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
        if d == 0.0 { return None; }
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

// ── FFprobe JSON output structures ──────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    streams: Option<Vec<FfprobeStream>>,
    format: Option<FfprobeFormat>,
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
    channels: Option<u32>,
    sample_rate: Option<String>,
    tags: Option<StreamTags>,
    disposition: Option<StreamDisposition>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    format_name: Option<String>,
    duration: Option<String>,
    size: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StreamTags {
    language: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StreamDisposition {
    attached_pic: u32,
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
        assert!(matches!(classify_subtitle_type("dvd_subtitle"), SubtitleType::Bitmap));
        assert!(matches!(classify_subtitle_type("srt"), SubtitleType::Text));
        assert!(matches!(classify_subtitle_type("subrip"), SubtitleType::Text));
        assert!(matches!(classify_subtitle_type("unknown_codec"), SubtitleType::Unknown));
    }

    #[test]
    fn dvd_compatibility_remux_compatible() {
        let video = vec![VideoStreamInfo {
            index: 0, codec: "mpeg2video".to_string(),
            width: 720, height: 480, frame_rate: Some(29.97),
            aspect_ratio: Some("16:9".to_string()),
            scan_type: Some("interlaced".to_string()),
            bitrate_bps: Some(6_000_000),
        }];
        let audio = vec![AudioStreamInfo {
            index: 1, codec: "ac3".to_string(),
            channels: 6, sample_rate: 48000,
            language: Some("eng".to_string()),
            bitrate_bps: Some(448_000),
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
            index: 0, codec: "mpeg2video".to_string(),
            width: 720, height: 480, frame_rate: Some(29.97),
            aspect_ratio: None, scan_type: None, bitrate_bps: None,
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
            index: 0, codec: "h264".to_string(),
            width: 1920, height: 1080, frame_rate: Some(29.97),
            aspect_ratio: None, scan_type: None, bitrate_bps: None,
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
}
