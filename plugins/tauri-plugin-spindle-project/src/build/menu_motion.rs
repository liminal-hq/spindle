// Motion-menu ffmpeg segment composition: single-command trim + scene overlay
// + audio + DVD mux per segment (intro/loop), and the audio-source/timing
// planning that feeds it.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

//! Deliberately not a `MenuCompiler` trait yet — see design decision D2
//! (`MenuCompiler` trait: deferred, minimal module seam). A future trait
//! stage should map: `compose_background` -> [`build_ffmpeg_motion_segment_command`];
//! `mux` -> the spumux/dvdauthor emission in [`super::menu::generate_spumux_xml`]
//! and [`super::authoring::menu`]'s `<post>` derivation.

use std::collections::HashMap;
use std::path::PathBuf;

use crate::models::*;

use super::ffmpeg::{
    dvd_active_dimensions, dvd_colour_flags, fps_rational_str, output_display_aspect_ratio_parts,
    source_display_aspect_ratio,
};
use super::menu::AuthorableMenuRef;

/// Where a motion segment's audio bed comes from — see design decision D1's
/// three-way fallback chain.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum MotionAudioSource {
    /// An explicitly authored audio asset, looped and windowed at
    /// `offset_secs` into the continuous intro+loop timeline.
    Bed { path: String, offset_secs: f64 },
    /// No explicit bed — reuse the background video's own audio track,
    /// already time-aligned by the same input-side `-ss`/`-t` trim as the
    /// video stream.
    BackgroundAudio,
    /// Neither an authored bed nor usable background audio — synthesize
    /// silence.
    Silence,
}

/// Everything [`build_ffmpeg_motion_segment_command`] needs to compose one
/// segment (intro or loop) of a motion menu.
#[derive(Debug, Clone)]
pub(crate) struct MotionSegmentSpec {
    pub(crate) video_source_path: String,
    pub(crate) video_start_secs: f64,
    pub(crate) duration_secs: f64,
    pub(crate) audio: MotionAudioSource,
    pub(crate) scene_png_path: PathBuf,
    pub(crate) output_path: PathBuf,
}

/// Plan the loop segment (always) and intro segment (only when
/// `timing.intro_duration_secs > 0.0`) for a motion menu, resolving the
/// background video asset and the audio-bed fallback chain.
///
/// Bed windows are continuous across the intro+loop timeline so first-play
/// audio doesn't hiccup at the intro/loop boundary: intro plays
/// `[0..introDur)`, loop plays `[introDur..introDur+loopDur)` (or
/// `[0..loopDur)` when there is no intro).
pub(crate) fn plan_motion_segments(
    menu_ref: &AuthorableMenuRef<'_>,
    assets: &HashMap<&str, &Asset>,
    scene_png_path: &std::path::Path,
    loop_output_path: &std::path::Path,
    intro_output_path: &std::path::Path,
) -> crate::Result<(MotionSegmentSpec, Option<MotionSegmentSpec>)> {
    let background_asset_id = menu_ref.background_asset_id().ok_or_else(|| {
        crate::Error::Build(format!(
            "Motion menu \"{}\" has no background video asset assigned.",
            menu_ref.name()
        ))
    })?;
    let asset = assets.get(background_asset_id).ok_or_else(|| {
        crate::Error::Build(format!(
            "Background asset not found for motion menu \"{}\"",
            menu_ref.name()
        ))
    })?;
    if asset.video_streams.is_empty() {
        return Err(crate::Error::Build(format!(
            "Motion menu \"{}\" background asset has no video stream.",
            menu_ref.name()
        )));
    }

    let timing = &menu_ref.menu.doc().timing;
    let loop_dur = menu_ref.motion_duration_secs().ok_or_else(|| {
        crate::Error::Build(format!(
            "Motion menu \"{}\" needs a loop duration greater than 0 seconds.",
            menu_ref.name()
        ))
    })?;
    let has_intro = timing.intro_duration_secs > 0.0;

    let audio_for = |offset_secs: f64| -> MotionAudioSource {
        if let Some(audio_asset_id) = timing.audio_asset_id.as_deref() {
            if let Some(audio_asset) = assets.get(audio_asset_id) {
                return MotionAudioSource::Bed {
                    path: audio_asset.source_path.clone(),
                    offset_secs,
                };
            }
        }
        if !asset.audio_streams.is_empty() {
            MotionAudioSource::BackgroundAudio
        } else {
            MotionAudioSource::Silence
        }
    };

    let loop_offset = if has_intro {
        timing.intro_duration_secs
    } else {
        0.0
    };

    let loop_spec = MotionSegmentSpec {
        video_source_path: asset.source_path.clone(),
        video_start_secs: timing.loop_start_secs,
        duration_secs: loop_dur,
        audio: audio_for(loop_offset),
        scene_png_path: scene_png_path.to_path_buf(),
        output_path: loop_output_path.to_path_buf(),
    };

    let intro_spec = has_intro.then(|| MotionSegmentSpec {
        video_source_path: asset.source_path.clone(),
        video_start_secs: timing.intro_start_secs,
        duration_secs: timing.intro_duration_secs,
        audio: audio_for(0.0),
        scene_png_path: scene_png_path.to_path_buf(),
        output_path: intro_output_path.to_path_buf(),
    });

    Ok((loop_spec, intro_spec))
}

/// Build the single ffmpeg compose command for one motion-menu segment:
/// input-side trim, background scale/pad into the DVD raster, scene-PNG
/// overlay, an audio bed (bed asset / background audio / silence) always
/// re-encoded to AC-3, closed-GOP mpeg2video, and DVD colour tagging.
pub(crate) fn build_ffmpeg_motion_segment_command(
    ffmpeg_bin: &str,
    menu_ref: &AuthorableMenuRef<'_>,
    assets: &HashMap<&str, &Asset>,
    project: &SpindleProjectFile,
    standard: VideoStandard,
    spec: &MotionSegmentSpec,
) -> crate::Result<Vec<String>> {
    let aspect = menu_ref.display_aspect(project);
    let target = RenderTarget::from_disc(&project.disc, aspect);
    let width = target.raster_width;
    let height = target.raster_height;
    let sar = target.sar_string();
    let aspect_str = match aspect {
        AspectMode::FourByThree => "4:3",
        AspectMode::SixteenByNine => "16:9",
    };
    let fps = fps_rational_str(standard.frame_rate());

    let (target_dar_num, target_dar_den) = output_display_aspect_ratio_parts(aspect);
    let target_dar = target_dar_num as f64 / target_dar_den as f64;

    let background_asset_id = menu_ref.background_asset_id().ok_or_else(|| {
        crate::Error::Build(format!(
            "Motion menu \"{}\" has no background video asset assigned.",
            menu_ref.name()
        ))
    })?;
    let asset = assets.get(background_asset_id).ok_or_else(|| {
        crate::Error::Build(format!(
            "Background asset not found for motion menu \"{}\"",
            menu_ref.name()
        ))
    })?;
    let video_info = asset.video_streams.first().ok_or_else(|| {
        crate::Error::Build(format!(
            "Motion menu \"{}\" background asset has no video stream.",
            menu_ref.name()
        ))
    })?;
    let source_dar = source_display_aspect_ratio(video_info).unwrap_or(target_dar);
    let (active_width, active_height) =
        dvd_active_dimensions(width, height, source_dar, target_dar);
    let pad_x = (width.saturating_sub(active_width)) / 2;
    let pad_y = (height.saturating_sub(active_height)) / 2;

    let mut cmd = vec![ffmpeg_bin.to_string(), "-y".to_string()];

    // Input 0: background video, trimmed input-side (frame-accurate with
    // re-encode) — never the `trim` filter.
    cmd.extend([
        "-ss".to_string(),
        format!("{:.3}", spec.video_start_secs),
        "-t".to_string(),
        format!("{:.3}", spec.duration_secs),
        "-i".to_string(),
        spec.video_source_path.clone(),
    ]);

    let mut video_filters = vec![format!(
        "[0:v]fps={fps},scale={active_width}:{active_height}:out_color_matrix=bt601,pad={width}:{height}:{pad_x}:{pad_y}[bg]"
    )];
    let audio_filter: String;
    let scene_input_index: usize;

    match &spec.audio {
        MotionAudioSource::BackgroundAudio => {
            cmd.extend([
                "-loop".to_string(),
                "1".to_string(),
                "-i".to_string(),
                spec.scene_png_path.display().to_string(),
            ]);
            scene_input_index = 1;
            audio_filter = "[0:a]asetpts=PTS-STARTPTS,apad[aud]".to_string();
        }
        MotionAudioSource::Bed { path, offset_secs } => {
            cmd.extend([
                "-stream_loop".to_string(),
                "-1".to_string(),
                "-i".to_string(),
                path.clone(),
            ]);
            cmd.extend([
                "-loop".to_string(),
                "1".to_string(),
                "-i".to_string(),
                spec.scene_png_path.display().to_string(),
            ]);
            scene_input_index = 2;
            audio_filter = format!(
                "[1:a]atrim=start={:.3}:duration={:.3},asetpts=PTS-STARTPTS,apad[aud]",
                offset_secs, spec.duration_secs
            );
        }
        MotionAudioSource::Silence => {
            cmd.extend([
                "-f".to_string(),
                "lavfi".to_string(),
                "-i".to_string(),
                "anullsrc=r=48000:cl=stereo".to_string(),
            ]);
            cmd.extend([
                "-loop".to_string(),
                "1".to_string(),
                "-i".to_string(),
                spec.scene_png_path.display().to_string(),
            ]);
            scene_input_index = 2;
            audio_filter = format!(
                "[1:a]atrim=start=0:duration={:.3},asetpts=PTS-STARTPTS,apad[aud]",
                spec.duration_secs
            );
        }
    }

    video_filters.push(format!(
        "[bg][{scene_input_index}:v]overlay=0:0,setsar={sar}[menuout]"
    ));
    video_filters.push(audio_filter);

    cmd.extend([
        "-filter_complex".to_string(),
        video_filters.join(";"),
        "-map".to_string(),
        "[menuout]".to_string(),
        "-map".to_string(),
        "[aud]".to_string(),
        "-r".to_string(),
        fps.to_string(),
        "-c:v".to_string(),
        "mpeg2video".to_string(),
        "-b:v".to_string(),
        "4000k".to_string(),
        "-maxrate".to_string(),
        "7000k".to_string(),
        "-bufsize".to_string(),
        "1835k".to_string(),
        "-g".to_string(),
        if standard == VideoStandard::Pal {
            "12"
        } else {
            "18"
        }
        .to_string(),
        "-flags".to_string(),
        "+cgop".to_string(),
        // ffmpeg's mpeg2video encoder can't combine closed GOPs with
        // scene-change-triggered GOP breaks ("closed gop with scene change
        // detection are not supported yet") — disabling scene-cut detection
        // is what the encoder itself suggests, and keeps every GOP exactly
        // `-g` frames long and closed, which is what the loop cut needs.
        "-sc_threshold".to_string(),
        "1000000000".to_string(),
    ]);
    cmd.extend(dvd_colour_flags(standard));
    cmd.extend([
        "-aspect".to_string(),
        aspect_str.to_string(),
        "-c:a".to_string(),
        "ac3".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
        "-ar".to_string(),
        "48000".to_string(),
        "-t".to_string(),
        format!("{:.3}", spec.duration_secs),
        "-f".to_string(),
        "dvd".to_string(),
        "-muxrate".to_string(),
        "10080000".to_string(),
        spec.output_path.display().to_string(),
    ]);

    Ok(cmd)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::path::Path;

    use crate::models::*;

    use super::super::menu::{AuthorableMenuRef, MenuDomain as BuildMenuDomain};
    use super::{
        build_ffmpeg_motion_segment_command, plan_motion_segments, MotionAudioSource,
        MotionSegmentSpec,
    };

    fn motion_menu_document() -> MenuDocument {
        MenuDocument {
            animation: vec![],
            id: "menu-1".to_string(),
            name: "Motion Menu".to_string(),
            domain: MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
            scene: MenuScene {
                design_size: MenuSize {
                    width: 720.0,
                    height: 480.0,
                    aspect: AspectMode::SixteenByNine,
                },
                background: SceneBackground {
                    asset_id: Some("bg-video".to_string()),
                    colour: None,
                },
                nodes: vec![],
                guides: vec![],
            },
            interaction: MenuInteractionGraph {
                default_focus_id: None,
                nodes: vec![],
                timeout_action: None,
            },
            timing: MenuTiming {
                intro_start_secs: 0.0,
                intro_duration_secs: 1.5,
                loop_start_secs: 2.0,
                loop_duration_secs: 3.5,
                loop_count: 2,
                audio_asset_id: None,
            },
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::Motion,
            theme_ref: None,
            generation_meta: None,
            compile_policy: MenuCompilePolicy::default(),
        }
    }

    fn video_asset(id: &str, with_audio: bool) -> Asset {
        let mut asset = Asset::new(format!("{id}.mp4"), format!("/tmp/{id}.mp4"));
        asset.id = id.to_string();
        asset.video_streams = vec![VideoStreamInfo {
            index: 0,
            codec: "h264".to_string(),
            width: 1920,
            height: 1080,
            frame_rate: Some(30.0),
            aspect_ratio: None,
            scan_type: None,
            bitrate_bps: None,
            title: None,
            color_transfer: None,
            color_primaries: None,
            dolby_vision_profile: None,
        }];
        if with_audio {
            asset.audio_streams = vec![AudioStreamInfo {
                index: 1,
                codec: "aac".to_string(),
                channels: 2,
                sample_rate: 48000,
                language: None,
                bitrate_bps: None,
                title: None,
            }];
        }
        asset
    }

    fn menu_with_document(doc: MenuDocument) -> Menu {
        Menu::new(doc.id.clone(), doc.name.clone()).with_document(doc)
    }

    #[test]
    fn plan_motion_segments_produces_intro_and_loop_with_continuous_bed_windows() {
        let doc = motion_menu_document();
        let menu = menu_with_document(doc);
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: BuildMenuDomain::Vmgm,
        };
        let asset = video_asset("bg-video", true);
        let mut assets = HashMap::new();
        assets.insert("bg-video", &asset);

        let (loop_spec, intro_spec) = plan_motion_segments(
            &menu_ref,
            &assets,
            Path::new("/tmp/menu_scene.png"),
            Path::new("/tmp/menu_base.mpg"),
            Path::new("/tmp/menu_intro.mpg"),
        )
        .unwrap();

        assert_eq!(loop_spec.video_start_secs, 2.0);
        assert_eq!(loop_spec.duration_secs, 3.5);
        assert_eq!(loop_spec.audio, MotionAudioSource::BackgroundAudio);

        let intro_spec = intro_spec.expect("expected an intro segment");
        assert_eq!(intro_spec.video_start_secs, 0.0);
        assert_eq!(intro_spec.duration_secs, 1.5);
        assert_eq!(intro_spec.audio, MotionAudioSource::BackgroundAudio);
    }

    #[test]
    fn plan_motion_segments_omits_intro_when_not_authored() {
        let mut doc = motion_menu_document();
        doc.timing.intro_duration_secs = 0.0;
        let menu = menu_with_document(doc);
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: BuildMenuDomain::Vmgm,
        };
        let asset = video_asset("bg-video", true);
        let mut assets = HashMap::new();
        assets.insert("bg-video", &asset);

        let (_loop_spec, intro_spec) = plan_motion_segments(
            &menu_ref,
            &assets,
            Path::new("/tmp/menu_scene.png"),
            Path::new("/tmp/menu_base.mpg"),
            Path::new("/tmp/menu_intro.mpg"),
        )
        .unwrap();

        assert!(intro_spec.is_none());
    }

    #[test]
    fn plan_motion_segments_prefers_explicit_audio_bed_over_background_audio() {
        let mut doc = motion_menu_document();
        doc.timing.audio_asset_id = Some("bed-audio".to_string());
        let menu = menu_with_document(doc);
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: BuildMenuDomain::Vmgm,
        };
        let bg_asset = video_asset("bg-video", true);
        let mut bed_asset = Asset::new("bed.wav".to_string(), "/tmp/bed.wav".to_string());
        bed_asset.id = "bed-audio".to_string();
        bed_asset.audio_streams = vec![AudioStreamInfo {
            index: 0,
            codec: "pcm_s16le".to_string(),
            channels: 2,
            sample_rate: 48000,
            language: None,
            bitrate_bps: None,
            title: None,
        }];
        let mut assets = HashMap::new();
        assets.insert("bg-video", &bg_asset);
        assets.insert("bed-audio", &bed_asset);

        let (loop_spec, intro_spec) = plan_motion_segments(
            &menu_ref,
            &assets,
            Path::new("/tmp/menu_scene.png"),
            Path::new("/tmp/menu_base.mpg"),
            Path::new("/tmp/menu_intro.mpg"),
        )
        .unwrap();

        assert_eq!(
            loop_spec.audio,
            MotionAudioSource::Bed {
                path: "/tmp/bed.wav".to_string(),
                offset_secs: 1.5,
            }
        );
        assert_eq!(
            intro_spec.unwrap().audio,
            MotionAudioSource::Bed {
                path: "/tmp/bed.wav".to_string(),
                offset_secs: 0.0,
            }
        );
    }

    #[test]
    fn plan_motion_segments_falls_back_to_silence_when_no_bed_and_no_background_audio() {
        let doc = motion_menu_document();
        let menu = menu_with_document(doc);
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: BuildMenuDomain::Vmgm,
        };
        let asset = video_asset("bg-video", false);
        let mut assets = HashMap::new();
        assets.insert("bg-video", &asset);

        let (loop_spec, _intro_spec) = plan_motion_segments(
            &menu_ref,
            &assets,
            Path::new("/tmp/menu_scene.png"),
            Path::new("/tmp/menu_base.mpg"),
            Path::new("/tmp/menu_intro.mpg"),
        )
        .unwrap();

        assert_eq!(loop_spec.audio, MotionAudioSource::Silence);
    }

    #[test]
    fn plan_motion_segments_errors_when_background_asset_missing_video_stream() {
        let doc = motion_menu_document();
        let menu = menu_with_document(doc);
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: BuildMenuDomain::Vmgm,
        };
        let asset = Asset::new("bg-video.mp4".to_string(), "/tmp/bg-video.mp4".to_string());
        let mut assets = HashMap::new();
        assets.insert("bg-video", &asset);

        let result = plan_motion_segments(
            &menu_ref,
            &assets,
            Path::new("/tmp/menu_scene.png"),
            Path::new("/tmp/menu_base.mpg"),
            Path::new("/tmp/menu_intro.mpg"),
        );

        assert!(result.is_err());
    }

    fn command_for(spec: MotionSegmentSpec, standard: VideoStandard) -> Vec<String> {
        let doc = motion_menu_document();
        let menu = menu_with_document(doc);
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: BuildMenuDomain::Vmgm,
        };
        let asset = video_asset("bg-video", true);
        let mut assets = HashMap::new();
        assets.insert("bg-video", &asset);
        let project = SpindleProjectFile::default();

        build_ffmpeg_motion_segment_command("ffmpeg", &menu_ref, &assets, &project, standard, &spec)
            .unwrap()
    }

    fn loop_spec(audio: MotionAudioSource) -> MotionSegmentSpec {
        MotionSegmentSpec {
            video_source_path: "/tmp/bg-video.mp4".to_string(),
            video_start_secs: 2.0,
            duration_secs: 3.5,
            audio,
            scene_png_path: std::path::PathBuf::from("/tmp/menu_scene.png"),
            output_path: std::path::PathBuf::from("/tmp/menu_base.mpg"),
        }
    }

    #[test]
    fn command_uses_input_side_trim_not_trim_filter() {
        let cmd = command_for(
            loop_spec(MotionAudioSource::BackgroundAudio),
            VideoStandard::Ntsc,
        );
        let cmd_str = cmd.join(" ");

        assert!(cmd_str.contains("-ss 2.000 -t 3.500 -i /tmp/bg-video.mp4"));
        assert!(
            !cmd_str.contains("trim="),
            "must not use the trim filter, got: {cmd_str}"
        );
    }

    #[test]
    fn command_final_duration_reflects_segment_not_hardcoded_one_second() {
        let cmd = command_for(
            loop_spec(MotionAudioSource::BackgroundAudio),
            VideoStandard::Ntsc,
        );
        let t_arg = cmd
            .iter()
            .enumerate()
            .rfind(|(_, a)| *a == "-t")
            .map(|(i, _)| cmd[i + 1].clone())
            .expect("-t value");
        assert_eq!(
            t_arg, "3.500",
            "must cap output at the real segment duration, not the still-menu's hardcoded 1s"
        );
    }

    #[test]
    fn command_always_encodes_ac3_192k_48000() {
        let cmd = command_for(
            loop_spec(MotionAudioSource::BackgroundAudio),
            VideoStandard::Ntsc,
        );
        let cmd_str = cmd.join(" ");
        assert!(cmd_str.contains("-c:a ac3 -b:a 192k -ar 48000"));
    }

    #[test]
    fn command_falls_back_to_anullsrc_for_silence() {
        let cmd = command_for(loop_spec(MotionAudioSource::Silence), VideoStandard::Ntsc);
        let cmd_str = cmd.join(" ");
        assert!(cmd_str.contains("-f lavfi -i anullsrc=r=48000:cl=stereo"));
    }

    #[test]
    fn command_windows_the_bed_at_the_given_offset() {
        let cmd = command_for(
            loop_spec(MotionAudioSource::Bed {
                path: "/tmp/bed.wav".to_string(),
                offset_secs: 1.5,
            }),
            VideoStandard::Ntsc,
        );
        let cmd_str = cmd.join(" ");
        assert!(cmd_str.contains("-stream_loop -1 -i /tmp/bed.wav"));
        assert!(cmd_str.contains("atrim=start=1.500:duration=3.500"));
    }

    #[test]
    fn command_includes_dvd_colour_flags_matching_standard() {
        let ntsc_cmd = command_for(
            loop_spec(MotionAudioSource::BackgroundAudio),
            VideoStandard::Ntsc,
        );
        assert!(ntsc_cmd.join(" ").contains("-color_primaries smpte170m"));

        let pal_cmd = command_for(
            loop_spec(MotionAudioSource::BackgroundAudio),
            VideoStandard::Pal,
        );
        assert!(pal_cmd.join(" ").contains("-color_primaries bt470bg"));
    }

    #[test]
    fn command_scale_filter_tags_out_color_matrix_bt601() {
        let cmd = command_for(
            loop_spec(MotionAudioSource::BackgroundAudio),
            VideoStandard::Ntsc,
        );
        let cmd_str = cmd.join(" ");
        assert!(cmd_str.contains("out_color_matrix=bt601"));
    }

    #[test]
    fn command_requests_dvd_muxer_and_muxrate() {
        let cmd = command_for(
            loop_spec(MotionAudioSource::BackgroundAudio),
            VideoStandard::Ntsc,
        );
        let cmd_str = cmd.join(" ");
        assert!(cmd_str.contains("-f dvd -muxrate 10080000"));
    }

    #[test]
    fn command_sets_closed_gop_flag() {
        let cmd = command_for(
            loop_spec(MotionAudioSource::BackgroundAudio),
            VideoStandard::Ntsc,
        );
        assert!(cmd.contains(&"-flags".to_string()));
        assert!(cmd.contains(&"+cgop".to_string()));
    }
}
