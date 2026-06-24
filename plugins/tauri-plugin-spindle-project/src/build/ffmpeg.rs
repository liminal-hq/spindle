// FFmpeg command generation for title transcoding.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::Path;

use crate::models::*;

/// Default average video bitrate used when no disc-capacity budget could be
/// computed for this title (e.g. zero-duration asset, or capacity estimation
/// isn't available in this call path).
pub(crate) const DEFAULT_VIDEO_BITRATE_BPS: f64 = 6_000_000.0;

/// Encoder safety ceiling for `-maxrate`. Kept independent of the disc
/// capacity budget's `DVD_MAX_VIDEO_RATE_BPS` (9.8 Mbps) — this is the
/// short-term peak the encoder is allowed to burst to, not the requested
/// average, and is clamped below the average if the average is unusually high.
pub(crate) const MAX_VIDEO_RATE_BPS: f64 = 9_000_000.0;

/// DVD-Video's total mux rate ceiling — the `-muxrate` this command always
/// requests. Video and audio together must fit under it.
pub(crate) const MUX_RATE_BPS: f64 = 10_080_000.0;

#[allow(clippy::too_many_arguments)]
pub(crate) fn build_ffmpeg_transcode_command(
    source_path: &str,
    output_path: &Path,
    title: &Title,
    asset: &Asset,
    disc: &Disc,
    video_info: Option<&VideoStreamInfo>,
    video_bitrate_bps: f64,
    two_pass: bool,
) -> Vec<String> {
    let video_bitrate_bps = if video_bitrate_bps > 0.0 {
        video_bitrate_bps.min(MAX_VIDEO_RATE_BPS)
    } else {
        DEFAULT_VIDEO_BITRATE_BPS
    };
    let maxrate_bps = MAX_VIDEO_RATE_BPS.max(video_bitrate_bps);
    let mut cmd = vec!["ffmpeg".to_string(), "-y".to_string()];

    cmd.extend(["-i".to_string(), source_path.to_string()]);

    // ffmpeg requires every -i input to be declared before any output-file
    // option (-c:v, -b:v, -map for the output mapping, etc.) — interleaving
    // a later -i after output options have already started confuses its
    // parser into misattributing the next -map to the new input rather than
    // the output. The synthesized silent-audio input must therefore be
    // declared here, immediately after the real source, not down near the
    // rest of the audio options where it used to live.
    let synthesise_silent_audio = title.audio_mappings.is_empty();
    if synthesise_silent_audio {
        cmd.extend([
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            "anullsrc=r=48000:cl=stereo".to_string(),
        ]);
    }

    if let Some(ref vm) = title.video_mapping {
        cmd.extend(["-map".to_string(), format!("0:{}", vm.source_stream_index)]);
    }

    let profile = title.video_output_profile.unwrap_or(VideoOutputProfile {
        raster: VideoRaster::FullD1,
        aspect: AspectMode::SixteenByNine,
    });
    let (output_fps, vf) = build_title_video_filter(profile, disc, video_info);

    cmd.extend(["-vf".to_string(), vf]);

    let bv_str = format!("{}k", (video_bitrate_bps / 1000.0).round() as i64);

    cmd.extend([
        "-c:v".to_string(),
        "mpeg2video".to_string(),
        "-r".to_string(),
        fps_rational_str(output_fps).to_string(),
        "-b:v".to_string(),
        bv_str.clone(),
    ]);

    if two_pass {
        // Two-pass: pass 1 (see build_ffmpeg_transcode_pass1_command) already
        // analysed the whole title, so the encoder allocates bits per actual
        // scene complexity here rather than needing a CBR floor — that's
        // what makes two-pass both more accurate *and* better quality than
        // forced CBR. -maxrate stays at the wide safety ceiling so complex
        // scenes can still burst.
        cmd.extend([
            "-pass".to_string(),
            "2".to_string(),
            "-passlogfile".to_string(),
            ffmpeg_passlogfile_prefix(output_path),
            "-maxrate".to_string(),
            format!("{}k", (maxrate_bps / 1000.0).round() as i64),
            "-bufsize".to_string(),
            "1835k".to_string(),
        ]);
    } else {
        // Single-pass: force near-CBR (-minrate == -maxrate == -b:v) so the
        // encoder can't drift in either direction. Without this, single-pass
        // mpeg2video is free to undershoot the target substantially on
        // low-complexity content (observed dropping to ~64% of target on a
        // real animated feature) or, if only a floor were added without
        // matching the ceiling, overshoot on content with complexity bursts.
        // This is the safe baseline; two-pass (above) is the better option
        // when quality-per-byte matters, since it doesn't need a CBR floor
        // to hit its target accurately.
        cmd.extend([
            "-minrate".to_string(),
            bv_str.clone(),
            "-maxrate".to_string(),
            bv_str,
            "-bufsize".to_string(),
            "1835k".to_string(),
        ]);
    }

    cmd.extend([
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
            CopyMode::ReEncode => {
                match am.output_target {
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
                }
                // Only re-encoded tracks can have their channel layout
                // changed — a stream copy can't be downmixed/upmixed.
                if let Some(channels) = am.channel_layout {
                    cmd.extend([format!("-ac:{i}"), channels.to_string()]);
                }
            }
        }
    }

    let bitmap_subtitle_mappings: Vec<_> = title
        .subtitle_mappings
        .iter()
        .filter(|sm| {
            asset.subtitle_streams.iter().any(|stream| {
                stream.index == sm.source_stream_index
                    && stream.subtitle_type == SubtitleType::Bitmap
            })
        })
        .collect();

    for (i, sm) in bitmap_subtitle_mappings.iter().enumerate() {
        cmd.extend([
            "-map".to_string(),
            format!("0:{}", sm.source_stream_index),
            format!("-c:s:{i}"),
            "dvd_subtitle".to_string(),
            format!("-metadata:s:s:{i}"),
            format!("language={}", sm.language),
        ]);
    }

    if synthesise_silent_audio {
        cmd.extend([
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
        (MUX_RATE_BPS as i64).to_string(),
        output_path.display().to_string(),
    ]);

    cmd
}

/// Shared HDR-tonemap / scale-pad-setsar / fps-conform video filter chain
/// used by both the real title transcode and its two-pass analysis pass.
/// Returns `(output_fps, vf_filter_string)`.
fn build_title_video_filter(
    profile: VideoOutputProfile,
    disc: &Disc,
    video_info: Option<&VideoStreamInfo>,
) -> (f64, String) {
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

    (output_fps, vf_parts.join(","))
}

/// Deterministic ffmpeg `-passlogfile` prefix for a title's two-pass stats,
/// placed alongside the title's output file so it's cleaned up with the rest
/// of the build workspace. ffmpeg appends `-0.log` to this prefix itself.
fn ffmpeg_passlogfile_prefix(output_path: &Path) -> String {
    let stem = output_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("title");
    output_path
        .with_file_name(format!("{stem}_2pass"))
        .display()
        .to_string()
}

/// Build the analysis-only first pass of a two-pass title encode: the same
/// video filter chain and bitrate target as the real encode
/// (`build_ffmpeg_transcode_command` with `two_pass: true`), but with audio
/// and subtitles stripped and the output discarded via the null muxer. Must
/// run before the second pass so the `-passlogfile` stats it writes are
/// available for the real encode to read.
pub(crate) fn build_ffmpeg_transcode_pass1_command(
    source_path: &str,
    output_path: &Path,
    title: &Title,
    disc: &Disc,
    video_info: Option<&VideoStreamInfo>,
    video_bitrate_bps: f64,
) -> Vec<String> {
    let video_bitrate_bps = if video_bitrate_bps > 0.0 {
        video_bitrate_bps.min(MAX_VIDEO_RATE_BPS)
    } else {
        DEFAULT_VIDEO_BITRATE_BPS
    };
    let maxrate_bps = MAX_VIDEO_RATE_BPS.max(video_bitrate_bps);

    let profile = title.video_output_profile.unwrap_or(VideoOutputProfile {
        raster: VideoRaster::FullD1,
        aspect: AspectMode::SixteenByNine,
    });
    let (output_fps, vf) = build_title_video_filter(profile, disc, video_info);

    let mut cmd = vec!["ffmpeg".to_string(), "-y".to_string()];
    cmd.extend(["-i".to_string(), source_path.to_string()]);

    if let Some(ref vm) = title.video_mapping {
        cmd.extend(["-map".to_string(), format!("0:{}", vm.source_stream_index)]);
    }

    cmd.extend(["-vf".to_string(), vf]);

    cmd.extend([
        "-c:v".to_string(),
        "mpeg2video".to_string(),
        "-r".to_string(),
        fps_rational_str(output_fps).to_string(),
        "-b:v".to_string(),
        format!("{}k", (video_bitrate_bps / 1000.0).round() as i64),
        "-maxrate".to_string(),
        format!("{}k", (maxrate_bps / 1000.0).round() as i64),
        "-bufsize".to_string(),
        "1835k".to_string(),
        "-g".to_string(),
        if disc.standard == VideoStandard::Pal {
            "12"
        } else {
            "18"
        }
        .to_string(),
        "-pass".to_string(),
        "1".to_string(),
        "-passlogfile".to_string(),
        ffmpeg_passlogfile_prefix(output_path),
        "-an".to_string(),
        "-f".to_string(),
        "null".to_string(),
        "-".to_string(),
    ]);

    cmd
}

/// Build an FFmpeg command that normalises a text subtitle stream to SRT.
///
/// This gives the first-pass text subtitle path one stable text format that
/// `spumux` can render with a host font during subtitle composition.
pub(crate) fn build_ffmpeg_text_subtitle_prepare_command(
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
        "-f".to_string(),
        "srt".to_string(),
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
    fn ffmpeg_bitrate_reflects_disc_capacity_budget_not_a_hardcoded_default() {
        // Regression test for liminal-hq/spindle#43: the transcode used to
        // always request a flat 6000k regardless of disc capacity. The
        // default test project (DVD5, one 3600s title, no menus) computes a
        // budget above the 9.8 Mbps DVD spec ceiling, which the encoder
        // safety ceiling then caps to 9000k.
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        let transcode = plan
            .jobs
            .iter()
            .find(|j| matches!(j, crate::build::BuildJob::TranscodeTitle { .. }))
            .unwrap();
        let cmd = transcode.command().unwrap();

        let bv_arg = cmd
            .iter()
            .skip_while(|a| *a != "-b:v")
            .nth(1)
            .expect("-b:v value");
        assert_eq!(
            bv_arg, "9000k",
            "expected the capacity-budgeted rate (clamped to the encoder ceiling), not the old hardcoded 6000k"
        );

        let maxrate_arg = cmd
            .iter()
            .skip_while(|a| *a != "-maxrate")
            .nth(1)
            .expect("-maxrate value");
        assert_eq!(maxrate_arg, "9000k");
    }

    #[test]
    fn ffmpeg_falls_back_to_default_bitrate_when_no_budget_is_available() {
        let project = test_project();
        let title = &project.disc.titlesets[0].titles[0];
        let asset = &project.assets[0];

        let cmd = super::build_ffmpeg_transcode_command(
            &asset.source_path,
            std::path::Path::new("/tmp/out.mpg"),
            title,
            asset,
            &project.disc,
            None,
            0.0,
            false,
        );

        let bv_arg = cmd
            .iter()
            .skip_while(|a| *a != "-b:v")
            .nth(1)
            .expect("-b:v value");
        assert_eq!(bv_arg, "6000k");
    }

    #[test]
    fn ffmpeg_single_pass_forces_symmetric_cbr_below_the_safety_ceiling() {
        // Regression test: single-pass mpeg2video must not just float a
        // -minrate floor while leaving -maxrate at the independent 9 Mbps
        // safety ceiling — that asymmetry (floor at target, ceiling far
        // above it) can only ever push the realized average bitrate UP from
        // target, risking overshoot on content with complexity bursts. True
        // CBR (minrate == maxrate == target) is required so the encoder
        // can't drift in either direction. Uses a below-ceiling target
        // (5759k, matching a real reported undershoot case) so maxrate
        // would differ from the target if the old asymmetric logic were
        // still in place.
        let project = test_project();
        let title = &project.disc.titlesets[0].titles[0];
        let asset = &project.assets[0];

        let cmd = super::build_ffmpeg_transcode_command(
            &asset.source_path,
            std::path::Path::new("/tmp/out.mpg"),
            title,
            asset,
            &project.disc,
            Some(&asset.video_streams[0]),
            5_759_000.0,
            false,
        );

        let bv_arg = cmd
            .iter()
            .skip_while(|a| *a != "-b:v")
            .nth(1)
            .expect("-b:v value")
            .clone();
        let minrate_arg = cmd
            .iter()
            .skip_while(|a| *a != "-minrate")
            .nth(1)
            .expect("-minrate value");
        let maxrate_arg = cmd
            .iter()
            .skip_while(|a| *a != "-maxrate")
            .nth(1)
            .expect("-maxrate value");

        assert_eq!(bv_arg, "5759k");
        assert_eq!(
            minrate_arg, &bv_arg,
            "minrate must equal the target bitrate"
        );
        assert_eq!(maxrate_arg, &bv_arg, "maxrate must also equal the target bitrate (true CBR), not the independent safety ceiling");
        assert!(
            !cmd.contains(&"-pass".to_string()),
            "single-pass must not set -pass"
        );
    }

    #[test]
    fn ffmpeg_two_pass_omits_cbr_floor_and_sets_pass2_passlogfile() {
        // Two-pass doesn't need a CBR floor to hit its target accurately —
        // pass 1's lookahead already informs accurate allocation — and
        // forcing one would defeat the point of allocating more bits to
        // complex scenes. -maxrate should stay at the wide safety ceiling.
        let project = test_project();
        let title = &project.disc.titlesets[0].titles[0];
        let asset = &project.assets[0];

        let cmd = super::build_ffmpeg_transcode_command(
            &asset.source_path,
            std::path::Path::new("/tmp/out.mpg"),
            title,
            asset,
            &project.disc,
            Some(&asset.video_streams[0]),
            5_759_000.0,
            true,
        );

        assert!(
            !cmd.contains(&"-minrate".to_string()),
            "two-pass must not force a CBR floor"
        );

        let maxrate_arg = cmd
            .iter()
            .skip_while(|a| *a != "-maxrate")
            .nth(1)
            .expect("-maxrate value");
        assert_eq!(
            maxrate_arg, "9000k",
            "two-pass should keep the wide safety ceiling, not clamp to the target"
        );

        let pass_arg = cmd
            .iter()
            .skip_while(|a| *a != "-pass")
            .nth(1)
            .expect("-pass value");
        assert_eq!(pass_arg, "2");

        assert!(
            cmd.contains(&"-passlogfile".to_string()),
            "expected -passlogfile for pass 2 to read pass 1's stats"
        );
    }

    #[test]
    fn ffmpeg_pass1_command_is_video_only_analysis_discarded_via_null_muxer() {
        let project = test_project();
        let title = &project.disc.titlesets[0].titles[0];
        let asset = &project.assets[0];

        let cmd = super::build_ffmpeg_transcode_pass1_command(
            &asset.source_path,
            std::path::Path::new("/tmp/out.mpg"),
            title,
            &project.disc,
            Some(&asset.video_streams[0]),
            5_759_000.0,
        );

        assert!(
            cmd.contains(&"-an".to_string()),
            "pass 1 must disable audio"
        );
        assert!(
            !cmd.iter().any(|a| a == "-c:a" || a.starts_with("-c:a:")),
            "pass 1 must not configure any audio codec"
        );

        let pass_arg = cmd
            .iter()
            .skip_while(|a| *a != "-pass")
            .nth(1)
            .expect("-pass value");
        assert_eq!(pass_arg, "1");

        assert_eq!(cmd.last().map(String::as_str), Some("-"));
        let f_arg = cmd
            .iter()
            .skip_while(|a| *a != "-f")
            .nth(1)
            .expect("-f value");
        assert_eq!(f_arg, "null", "pass 1 output must be discarded");

        let bv_arg = cmd
            .iter()
            .skip_while(|a| *a != "-b:v")
            .nth(1)
            .expect("-b:v value");
        assert_eq!(
            bv_arg, "5759k",
            "pass 1 must target the same bitrate as the real encode"
        );
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

    #[test]
    fn ffmpeg_requests_ac_when_a_channel_layout_is_selected() {
        let mut project = test_project();
        project.disc.titlesets[0].titles[0].audio_mappings[0].channel_layout = Some(2);
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        let transcode = plan
            .jobs
            .iter()
            .find(|j| matches!(j, crate::build::BuildJob::TranscodeTitle { .. }))
            .unwrap();
        let cmd = transcode.command().unwrap();

        assert!(cmd.contains(&"-ac:0".to_string()), "expected -ac:0 flag");
        let ac_val = cmd
            .iter()
            .skip_while(|a| *a != "-ac:0")
            .nth(1)
            .expect("-ac:0 value");
        assert_eq!(ac_val, "2");
    }

    #[test]
    fn ffmpeg_does_not_request_ac_when_no_channel_layout_is_selected() {
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        let transcode = plan
            .jobs
            .iter()
            .find(|j| matches!(j, crate::build::BuildJob::TranscodeTitle { .. }))
            .unwrap();
        let cmd = transcode.command().unwrap();

        assert!(
            !cmd.iter().any(|a| a.starts_with("-ac:")),
            "expected no -ac flag when channel_layout is unset (preserve source), got: {cmd:?}"
        );
    }
}
