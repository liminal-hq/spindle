// Tests for build plan generation.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use crate::build::test_support::{test_menu, test_project};
use crate::build::{generate_build_plan, generate_build_plan_with_options, BuildJob};
use crate::models::*;

#[test]
fn build_plan_generates_correct_job_count() {
    let project = test_project();
    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert_eq!(plan.jobs.len(), 3);
    assert_eq!(plan.summary.transcode_jobs, 1);
    assert_eq!(plan.summary.titles_count, 1);
}

#[test]
fn build_plan_includes_iso_when_enabled() {
    let mut project = test_project();
    project.build_settings.generate_iso = true;

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert_eq!(plan.jobs.len(), 4);
    assert!(plan.summary.generate_iso);
}

#[test]
fn build_plan_includes_menu_jobs_when_menu_exists() {
    let mut project = test_project();
    project.disc.global_menus.push(test_menu());

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan
        .jobs
        .iter()
        .any(|job| matches!(job, BuildJob::RenderMenu { .. })));
    assert!(plan
        .jobs
        .iter()
        .any(|job| matches!(job, BuildJob::ComposeMenuHighlights { .. })));
    assert_eq!(plan.summary.menus_count, 1);
}

#[test]
fn build_plan_muxes_bitmap_subtitles_during_title_transcode() {
    let mut project = test_project();
    project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
        index: 2,
        codec: "hdmv_pgs_subtitle".to_string(),
        language: Some("eng".to_string()),
        subtitle_type: SubtitleType::Bitmap,
        title: Some("English".to_string()),
    });
    project.disc.titlesets[0].titles[0]
        .subtitle_mappings
        .push(SubtitleTrackMapping {
            id: "sm-1".to_string(),
            source_stream_index: 2,
            label: "English".to_string(),
            language: "eng".to_string(),
            order_index: 0,
            is_default: false,
            is_forced: false,
        });

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();
    let transcode_job = plan
        .jobs
        .iter()
        .find_map(|job| match job {
            BuildJob::TranscodeTitle { command, .. } => Some(command),
            _ => None,
        })
        .expect("expected transcode job");

    assert!(transcode_job
        .windows(2)
        .any(|window| { window == [String::from("-map"), String::from("0:2")] }));
    assert!(transcode_job
        .windows(2)
        .any(|window| { window == [String::from("-c:s:0"), String::from("dvd_subtitle")] }));
    assert!(!plan
        .jobs
        .iter()
        .any(|job| matches!(job, BuildJob::ExtractSubtitles { .. })));
}

#[test]
fn build_plan_renders_text_subtitles_after_base_transcode() {
    let mut project = test_project();
    project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
        index: 2,
        codec: "subrip".to_string(),
        language: Some("eng".to_string()),
        subtitle_type: SubtitleType::Text,
        title: Some("English".to_string()),
    });
    project.disc.titlesets[0].titles[0]
        .subtitle_mappings
        .push(SubtitleTrackMapping {
            id: "sm-text".to_string(),
            source_stream_index: 2,
            label: "English".to_string(),
            language: "eng".to_string(),
            order_index: 0,
            is_default: false,
            is_forced: false,
        });

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(
        plan.jobs
            .iter()
            .any(|job| matches!(job, BuildJob::RenderTextSubtitles { .. })),
        "expected explicit text subtitle render job"
    );

    let transcode_output = plan.jobs.iter().find_map(|job| match job {
        BuildJob::TranscodeTitle { output_path, .. } => Some(output_path),
        _ => None,
    });
    assert!(
        transcode_output.is_some_and(|path| path.contains("_base.mpg")),
        "text subtitle titles should transcode to a base MPEG before composition"
    );
}

#[test]
fn build_plan_populates_pass1_command_when_two_pass_encoding_is_enabled() {
    let mut project = test_project();
    project.build_settings.two_pass_video_encoding = true;

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    let pass1_command = plan.jobs.iter().find_map(|job| match job {
        BuildJob::TranscodeTitle { pass1_command, .. } => Some(pass1_command),
        _ => None,
    });

    let pass1_command = pass1_command
        .expect("expected a TranscodeTitle job")
        .as_ref()
        .expect("expected pass1_command to be populated when two_pass_video_encoding is on");

    assert!(
        pass1_command.contains(&"-pass".to_string()),
        "expected pass 1 command to set -pass 1"
    );
}

#[test]
fn build_plan_omits_pass1_command_when_two_pass_encoding_is_disabled() {
    let project = test_project();
    assert!(!project.build_settings.two_pass_video_encoding);

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    let pass1_command = plan.jobs.iter().find_map(|job| match job {
        BuildJob::TranscodeTitle { pass1_command, .. } => Some(pass1_command),
        _ => None,
    });

    assert_eq!(
        pass1_command.expect("expected a TranscodeTitle job"),
        &None,
        "expected no pass1_command when two_pass_video_encoding is off"
    );
}

#[test]
fn build_plan_preserves_mixed_subtitle_stream_order() {
    let mut project = test_project();
    project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
        index: 2,
        codec: "subrip".to_string(),
        language: Some("eng".to_string()),
        subtitle_type: SubtitleType::Text,
        title: Some("English text".to_string()),
    });
    project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
        index: 3,
        codec: "dvd_subtitle".to_string(),
        language: Some("fra".to_string()),
        subtitle_type: SubtitleType::Bitmap,
        title: Some("French bitmap".to_string()),
    });
    project.disc.titlesets[0].titles[0].subtitle_mappings = vec![
        SubtitleTrackMapping {
            id: "sm-text".to_string(),
            source_stream_index: 2,
            label: "English".to_string(),
            language: "eng".to_string(),
            order_index: 0,
            is_default: false,
            is_forced: false,
        },
        SubtitleTrackMapping {
            id: "sm-bitmap".to_string(),
            source_stream_index: 3,
            label: "French".to_string(),
            language: "fra".to_string(),
            order_index: 1,
            is_default: false,
            is_forced: false,
        },
    ];

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    let transcode_job = plan
        .jobs
        .iter()
        .find_map(|job| match job {
            BuildJob::TranscodeTitle { command, .. } => Some(command),
            _ => None,
        })
        .expect("expected transcode job");
    assert!(
        transcode_job
            .windows(2)
            .any(|window| window == [String::from("-c:s:0"), String::from("dvd_subtitle")]),
        "bitmap subtitle should keep the first ffmpeg subtitle slot when it is the first bitmap mapping"
    );

    let render_job = plan
        .jobs
        .iter()
        .find_map(|job| match job {
            BuildJob::RenderTextSubtitles { command, .. } => Some(command),
            _ => None,
        })
        .expect("expected text subtitle render job");
    assert!(
        render_job
            .windows(2)
            .any(|window| { window == [String::from("-s"), String::from("0")] }),
        "text subtitle should render into stream slot 0 when it is the first subtitle mapping"
    );
}

#[test]
fn build_plan_skip_unsupported_streams_keeps_text_subtitles() {
    // Regression test for liminal-hq/spindle#93: text subtitles have a working
    // RenderTextSubtitles pipeline and must not be dropped by the escape hatch.
    let mut project = test_project();
    project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
        index: 2,
        codec: "subrip".to_string(),
        language: Some("eng".to_string()),
        subtitle_type: SubtitleType::Text,
        title: Some("English text".to_string()),
    });
    project.disc.titlesets[0].titles[0]
        .subtitle_mappings
        .push(SubtitleTrackMapping {
            id: "sm-text".to_string(),
            source_stream_index: 2,
            label: "English".to_string(),
            language: "eng".to_string(),
            order_index: 0,
            is_default: false,
            is_forced: false,
        });

    let plan =
        generate_build_plan_with_options(&project, "/tmp/dvd_output", false, true, false).unwrap();

    assert!(
        plan.jobs
            .iter()
            .any(|job| matches!(job, BuildJob::RenderTextSubtitles { .. })),
        "skip unsupported streams must not strip text subtitle render jobs"
    );
}

#[test]
fn build_plan_skip_unsupported_streams_removes_unknown_codec_subtitles() {
    // Only SubtitleType::Unknown streams — codecs Spindle has no handler for —
    // should be stripped by the escape hatch.
    let mut project = test_project();
    project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
        index: 2,
        codec: "some_future_codec".to_string(),
        language: Some("eng".to_string()),
        subtitle_type: SubtitleType::Unknown,
        title: None,
    });
    project.disc.titlesets[0].titles[0]
        .subtitle_mappings
        .push(SubtitleTrackMapping {
            id: "sm-unknown".to_string(),
            source_stream_index: 2,
            label: "English".to_string(),
            language: "eng".to_string(),
            order_index: 0,
            is_default: false,
            is_forced: false,
        });

    let plan =
        generate_build_plan_with_options(&project, "/tmp/dvd_output", false, true, false).unwrap();

    // After stripping, no subtitle jobs of any kind should appear.
    assert!(
        !plan
            .jobs
            .iter()
            .any(|job| matches!(job, BuildJob::RenderTextSubtitles { .. })),
        "unknown-codec subtitle mapping should produce no RenderTextSubtitles job"
    );
    let transcode = plan
        .jobs
        .iter()
        .find(|j| matches!(j, BuildJob::TranscodeTitle { .. }))
        .expect("expected a TranscodeTitle job");
    let cmd = transcode.command().unwrap();
    assert!(
        !cmd.iter().any(|a| a.starts_with("-c:s")),
        "unknown-codec subtitle mapping should produce no -c:s flag in the transcode command"
    );
}

#[test]
fn build_plan_deduplicates_identical_transcodes_with_different_mapping_ids() {
    let mut project = test_project();

    // Add a second titleset with a title that uses the same asset and
    // identical stream/output settings but different mapping UUIDs.
    let duplicate_title = Title {
        id: "title-dup".to_string(),
        name: "Same Feature Copy".to_string(),
        source_asset_id: Some("asset-1".to_string()),
        video_mapping: Some(VideoTrackMapping {
            source_stream_index: 0,
            copy_mode: CopyMode::ReEncode,
        }),
        video_output_profile: Some(VideoOutputProfile {
            raster: VideoRaster::FullD1,
            aspect: AspectMode::SixteenByNine,
        }),
        audio_mappings: vec![AudioTrackMapping {
            id: "am-different-uuid".to_string(), // different ID!
            source_stream_index: 1,
            output_target: AudioOutputTarget::Ac3,
            copy_mode: CopyMode::ReEncode,
            label: "English".to_string(),
            language: "eng".to_string(),
            order_index: 0,
            is_default: true,
            channel_layout: None,
            bitrate_bps: None,
        }],
        subtitle_mappings: vec![],
        chapters: vec![],
        end_action: Some(PlaybackAction::Stop),
        order_index: 0,
        bitrate_weight: 1.0,
        bitrate_floor_bps: None,
        bitrate_ceiling_bps: None,
        pinned_bitrate_bps: None,
    };

    project.disc.titlesets.push(Titleset {
        id: "titleset-dup".to_string(),
        name: "Duplicate".to_string(),
        titles: vec![duplicate_title],
        menus: vec![],
    });

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    // Should have 1 transcode + 1 link, not 2 transcodes
    assert_eq!(
        plan.summary.transcode_jobs, 1,
        "identical config should reuse transcode"
    );
    assert!(
        plan.jobs
            .iter()
            .any(|j| matches!(j, BuildJob::LinkTitle { .. })),
        "duplicate title should be linked, not transcoded again"
    );
}

#[test]
fn build_plan_rejects_motion_menus_until_backend_support_lands() {
    let mut project = test_project();
    let mut menu = test_menu();
    menu.background_mode = BackgroundMode::Motion;
    menu.motion_duration_secs = Some(12.0);
    project.disc.global_menus.push(menu);

    let err = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap_err();
    let msg = err.to_string();

    assert!(msg.contains("Motion menu build authoring is not implemented yet"));
    assert!(msg.contains("\"Main Menu\""));
}

#[test]
fn build_plan_rejects_menu_with_missing_image_asset() {
    let mut project = test_project();
    let mut menu = test_menu();
    menu.authored_document = Some(MenuDocument {
        id: "menu-1".to_string(),
        name: "Main Menu".to_string(),
        domain: MenuDomain::Vmgm,
        scene: MenuScene {
            design_size: MenuSize {
                width: 720.0,
                height: 480.0,
                aspect: AspectMode::FourByThree,
            },
            background: SceneBackground {
                asset_id: None,
                colour: Some("#000000".to_string()),
            },
            nodes: vec![SceneNode::Image {
                id: "img-1".to_string(),
                asset_id: "deleted-asset-id".to_string(),
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            }],
            guides: vec![],
        },
        interaction: MenuInteractionGraph {
            default_focus_id: None,
            nodes: vec![],
            timeout_action: None,
        },
        timing: MenuTiming::default(),
        highlight_colours: MenuHighlightColours::default(),
        background_mode: BackgroundMode::Still,
        theme_ref: None,
        generation_meta: None,
        compile_policy: MenuCompilePolicy::default(),
    });
    project.disc.global_menus.push(menu);

    let err = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap_err();
    let msg = err.to_string();

    assert!(
        msg.contains("deleted-asset-id"),
        "error should name the missing asset ID: {msg}"
    );
    assert!(
        msg.contains("Main Menu"),
        "error should name the menu: {msg}"
    );
}
