// FFmpeg command generation for title transcoding.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::Path;

use crate::models::*;

pub(crate) fn build_ffmpeg_transcode_command(
    source_path: &str,
    output_path: &Path,
    title: &Title,
    disc: &Disc,
    video_info: Option<&VideoStreamInfo>,
) -> Vec<String> {
    let mut cmd = vec!["ffmpeg".to_string(), "-y".to_string()];

    cmd.extend(["-i".to_string(), source_path.to_string()]);

    if let Some(ref vm) = title.video_mapping {
        cmd.extend(["-map".to_string(), format!("0:{}", vm.source_stream_index)]);
    }

    let profile = title.video_output_profile.unwrap_or(VideoOutputProfile {
        raster: VideoRaster::FullD1,
        aspect: AspectMode::SixteenByNine,
    });
    let (width, height) = profile.raster.resolution(disc.standard);

    let source_fps = video_info.and_then(|v| v.frame_rate);
    let output_fps = choose_output_fps(source_fps, disc.standard);

    let mut vf_parts: Vec<String> = Vec::new();

    if video_info.is_some_and(is_hdr_source) {
        vf_parts.push(
            "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,\
             tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
                .to_string(),
        );
    }

    let source_dar = video_info
        .and_then(source_display_aspect_ratio)
        .unwrap_or_else(|| width as f64 / height as f64);
    let (target_dar_num, target_dar_den) = output_display_aspect_ratio_parts(profile.aspect);
    let target_dar = target_dar_num as f64 / target_dar_den as f64;
    let target_sar = dvd_sample_aspect_ratio(width, height, target_dar_num, target_dar_den);

    vf_parts.push(build_dvd_scale_filter(
        width,
        height,
        source_dar,
        target_dar,
        &target_sar,
    ));

    if source_fps.is_some_and(|fps| (fps - output_fps).abs() > 0.1) {
        vf_parts.push(format!("fps={}", fps_rational_str(output_fps)));
    }

    cmd.extend(["-vf".to_string(), vf_parts.join(",")]);

    cmd.extend([
        "-c:v".to_string(),
        "mpeg2video".to_string(),
        "-r".to_string(),
        fps_rational_str(output_fps).to_string(),
        "-b:v".to_string(),
        "6000k".to_string(),
        "-maxrate".to_string(),
        "9000k".to_string(),
        "-bufsize".to_string(),
        "1835k".to_string(),
        "-g".to_string(),
        if disc.standard == VideoStandard::Pal {
            "12"
        } else {
            "18"
        }
        .to_string(),
    ]);

    match profile.aspect {
        AspectMode::FourByThree => cmd.extend(["-aspect".to_string(), "4:3".to_string()]),
        AspectMode::SixteenByNine => cmd.extend(["-aspect".to_string(), "16:9".to_string()]),
    }

    for (i, am) in title.audio_mappings.iter().enumerate() {
        cmd.extend(["-map".to_string(), format!("0:{}", am.source_stream_index)]);

        match am.copy_mode {
            CopyMode::Copy => {
                cmd.extend([format!("-c:a:{i}"), "copy".to_string()]);
            }
            CopyMode::ReEncode => match am.output_target {
                AudioOutputTarget::Ac3 => {
                    cmd.extend([
                        format!("-c:a:{i}"),
                        "ac3".to_string(),
                        format!("-b:a:{i}"),
                        "448k".to_string(),
                        format!("-ar:a:{i}"),
                        "48000".to_string(),
                    ]);
                }
                AudioOutputTarget::Mp2 => {
                    cmd.extend([
                        format!("-c:a:{i}"),
                        "mp2".to_string(),
                        format!("-b:a:{i}"),
                        "384k".to_string(),
                        format!("-ar:a:{i}"),
                        "48000".to_string(),
                    ]);
                }
                AudioOutputTarget::Lpcm => {
                    cmd.extend([
                        format!("-c:a:{i}"),
                        "pcm_s16be".to_string(),
                        format!("-ar:a:{i}"),
                        "48000".to_string(),
                    ]);
                }
                AudioOutputTarget::Dts => {
                    cmd.extend([
                        format!("-c:a:{i}"),
                        "dts".to_string(),
                        format!("-b:a:{i}"),
                        "768k".to_string(),
                        format!("-ar:a:{i}"),
                        "48000".to_string(),
                    ]);
                }
            },
        }
    }

    if title.audio_mappings.is_empty() {
        cmd.extend([
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            "anullsrc=r=48000:cl=stereo".to_string(),
            "-map".to_string(),
            "1:a".to_string(),
            "-shortest".to_string(),
            "-c:a".to_string(),
            "ac3".to_string(),
            "-b:a".to_string(),
            "192k".to_string(),
        ]);
    }

    cmd.extend([
        "-f".to_string(),
        "dvd".to_string(),
        "-muxrate".to_string(),
        "10080000".to_string(),
        output_path.display().to_string(),
    ]);

    cmd
}

/// Build an ffmpeg command to extract a single bitmap subtitle stream to a
/// VOBsub file that spumux can consume during dvdauthor processing.
pub(crate) fn build_ffmpeg_subtitle_extract_command(
    source_path: &str,
    output_path: &Path,
    source_stream_index: u32,
) -> Vec<String> {
    vec![
        "ffmpeg".to_string(),
        "-y".to_string(),
        "-i".to_string(),
        source_path.to_string(),
        "-map".to_string(),
        format!("0:{source_stream_index}"),
        "-c:s".to_string(),
        "dvd_subtitle".to_string(),
        output_path.display().to_string(),
    ]
}

fn choose_output_fps(source_fps: Option<f64>, standard: VideoStandard) -> f64 {
    match standard {
        VideoStandard::Pal => 25.0,
        VideoStandard::Ntsc => {
            if source_fps.is_some_and(|fps| (fps - 24_000.0 / 1_001.0).abs() < 0.1) {
                24_000.0 / 1_001.0
            } else {
                30_000.0 / 1_001.0
            }
        }
    }
}

pub(crate) fn fps_rational_str(fps: f64) -> &'static str {
    if (fps - 24_000.0 / 1_001.0).abs() < 0.001 {
        "24000/1001"
    } else if (fps - 30_000.0 / 1_001.0).abs() < 0.001 {
        "30000/1001"
    } else if (fps - 25.0).abs() < 0.001 {
        "25"
    } else {
        "30000/1001"
    }
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

pub(crate) fn output_display_aspect_ratio_parts(aspect: AspectMode) -> (u32, u32) {
    match aspect {
        AspectMode::FourByThree => (4, 3),
        AspectMode::SixteenByNine => (16, 9),
    }
}

pub(crate) fn dvd_sample_aspect_ratio(
    width: u32,
    height: u32,
    display_aspect_num: u32,
    display_aspect_den: u32,
) -> String {
    let mut num = display_aspect_num as u64 * height as u64;
    let mut den = display_aspect_den as u64 * width as u64;
    let gcd = gcd_u64(num, den);
    num /= gcd;
    den /= gcd;
    format!("{num}/{den}")
}

fn build_dvd_scale_filter(
    width: u32,
    height: u32,
    source_dar: f64,
    target_dar: f64,
    target_sar: &str,
) -> String {
    let mut active_width = width;
    let mut active_height = height;

    if source_dar > target_dar {
        active_height = round_even((height as f64 * target_dar / source_dar).min(height as f64));
    } else if source_dar < target_dar {
        active_width = round_even((width as f64 * source_dar / target_dar).min(width as f64));
    }

    let pad_x = (width.saturating_sub(active_width)) / 2;
    let pad_y = (height.saturating_sub(active_height)) / 2;

    format!(
        "scale={active_width}:{active_height},pad={width}:{height}:{pad_x}:{pad_y},setsar={target_sar}"
    )
}

fn round_even(value: f64) -> u32 {
    let rounded = value.round().max(2.0) as u32;
    if rounded % 2 == 0 {
        rounded
    } else {
        rounded.saturating_sub(1)
    }
}

fn gcd_u64(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        let tmp = b;
        b = a % b;
        a = tmp;
    }
    a.max(1)
}

fn is_hdr_source(info: &VideoStreamInfo) -> bool {
    matches!(
        info.color_transfer.as_deref(),
        Some("smpte2084" | "arib-std-b67" | "smpte428")
    )
}

#[cfg(test)]
mod tests {
    use crate::build::generate_build_plan;
    use crate::build::test_support::test_project;

    #[test]
    fn ffmpeg_vf_has_scale_and_pad() {
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        let transcode = plan
            .jobs
            .iter()
            .find(|j| matches!(j, crate::build::BuildJob::TranscodeTitle { .. }))
            .unwrap();
        let cmd = transcode.command().unwrap();

        assert!(cmd.contains(&"-vf".to_string()), "expected -vf flag");
        let vf_val = cmd
            .iter()
            .skip_while(|a| *a != "-vf")
            .nth(1)
            .expect("-vf value");
        assert!(vf_val.contains("scale="), "expected scale= in vf filter");
        assert!(vf_val.contains("pad="), "expected pad= in vf filter");
        assert!(
            vf_val.contains("setsar=32/27"),
            "expected NTSC 16:9 anamorphic SAR in vf filter"
        );
    }

    #[test]
    fn ffmpeg_preserves_23976_fps_for_ntsc() {
        let mut project = test_project();
        project.assets[0].video_streams[0].frame_rate = Some(24_000.0 / 1_001.0);
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        let transcode = plan
            .jobs
            .iter()
            .find(|j| matches!(j, crate::build::BuildJob::TranscodeTitle { .. }))
            .unwrap();
        let cmd = transcode.command().unwrap();

        let r_arg = cmd
            .iter()
            .skip_while(|a| *a != "-r")
            .nth(1)
            .expect("-r value");
        assert_eq!(r_arg, "24000/1001", "23.976 fps source should be preserved");
    }

    #[test]
    fn ffmpeg_command_has_mpeg2_codec() {
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        let transcode = plan
            .jobs
            .iter()
            .find(|j| matches!(j, crate::build::BuildJob::TranscodeTitle { .. }));
        assert!(transcode.is_some());

        let cmd = transcode.unwrap().command().unwrap();
        assert!(cmd.contains(&"mpeg2video".to_string()));
        let vf_arg = cmd.iter().find(|a| a.starts_with("scale="));
        assert!(vf_arg.is_some(), "expected scale=720:480 in -vf filter");
    }

    #[test]
    fn ffmpeg_uses_anamorphic_letterbox_for_scope_sources() {
        let mut project = test_project();
        project.assets[0].video_streams[0].width = 3840;
        project.assets[0].video_streams[0].height = 1606;
        project.assets[0].video_streams[0].aspect_ratio = Some("1920:803".to_string());

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();
        let transcode = plan
            .jobs
            .iter()
            .find(|j| matches!(j, crate::build::BuildJob::TranscodeTitle { .. }))
            .unwrap();
        let cmd = transcode.command().unwrap();
        let vf_arg = cmd
            .iter()
            .skip_while(|a| *a != "-vf")
            .nth(1)
            .expect("-vf value");

        assert!(
            vf_arg.contains("scale=720:356"),
            "expected scope content to use anamorphic-aware height, got: {vf_arg}"
        );
        assert!(
            vf_arg.contains("pad=720:480:0:62"),
            "expected centred letterbox padding, got: {vf_arg}"
        );
    }
}
