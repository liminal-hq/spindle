// Shared test fixtures for build modules.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use crate::models::*;

pub(crate) fn test_project() -> SpindleProjectFile {
    let mut project = SpindleProjectFile::default();
    project.project.name = "Test DVD".to_string();

    let asset = Asset {
        id: "asset-1".to_string(),
        file_name: "test.mp4".to_string(),
        source_path: "/tmp/test.mp4".to_string(),
        file_size_bytes: Some(1_000_000_000),
        duration_secs: Some(3600.0),
        container_format: Some("mp4".to_string()),
        video_streams: vec![VideoStreamInfo {
            index: 0,
            codec: "h264".to_string(),
            width: 1920,
            height: 1080,
            frame_rate: Some(29.97),
            aspect_ratio: Some("16:9".to_string()),
            scan_type: None,
            bitrate_bps: None,
            title: None,
            color_transfer: None,
            color_primaries: None,
            dolby_vision_profile: None,
        }],
        audio_streams: vec![AudioStreamInfo {
            index: 1,
            codec: "aac".to_string(),
            channels: 2,
            sample_rate: 48000,
            language: Some("eng".to_string()),
            bitrate_bps: None,
            title: None,
        }],
        subtitle_streams: vec![],
        compatibility: Some(CompatibilityAssessment::ReEncodeRequired),
        compatibility_detail: None,
        fingerprint: None,
        warnings: vec![],
        thumbnail_path: None,
        thumbnail_error: None,
        source_chapters: vec![],
        format_title: None,
    };

    let title = Title {
        id: "title-1".to_string(),
        name: "Main Feature".to_string(),
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
            id: "am-1".to_string(),
            source_stream_index: 1,
            output_target: AudioOutputTarget::Ac3,
            copy_mode: CopyMode::ReEncode,
            label: "English".to_string(),
            language: "eng".to_string(),
            order_index: 0,
            is_default: true,
        }],
        subtitle_mappings: vec![],
        chapters: vec![
            ChapterPoint {
                id: "ch-1".to_string(),
                name: "Chapter 1".to_string(),
                timestamp_secs: 0.0,
                order_index: 0,
            },
            ChapterPoint {
                id: "ch-2".to_string(),
                name: "Chapter 2".to_string(),
                timestamp_secs: 300.0,
                order_index: 1,
            },
        ],
        end_action: Some(PlaybackAction::Stop),
        order_index: 0,
    };

    project.disc.titlesets[0].titles.push(title);
    project.assets.push(asset);
    project.build_settings.output_directory = Some("/tmp/dvd_output".to_string());

    project
}

pub(crate) fn test_menu() -> Menu {
    test_menu_with_action(
        "menu-1",
        "Main Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    )
}

pub(crate) fn test_menu_with_action(
    menu_id: &str,
    menu_name: &str,
    action: PlaybackAction,
) -> Menu {
    Menu {
        id: menu_id.to_string(),
        name: menu_name.to_string(),
        background_asset_id: None,
        buttons: vec![MenuButton {
            id: "btn-1".to_string(),
            label: "Play".to_string(),
            bounds: ButtonBounds {
                x: 120.0,
                y: 320.0,
                width: 240.0,
                height: 48.0,
            },
            action: Some(action),
            nav_up: None,
            nav_down: None,
            nav_left: None,
            nav_right: None,
            highlight_mode: HighlightMode::Static,
            highlight_keyframes: vec![],
            video_asset_id: None,
        }],
        default_button_id: Some("btn-1".to_string()),
        highlight_colours: MenuHighlightColours::default(),
        background_mode: BackgroundMode::Still,
        motion_duration_secs: None,
        motion_audio_asset_id: None,
        motion_loop_count: 0,
        timeout_action: None,
        authored_document: None,
    }
}

pub(crate) fn add_second_titleset(project: &mut SpindleProjectFile) {
    let second_asset = Asset {
        id: "asset-2".to_string(),
        file_name: "bonus.mp4".to_string(),
        source_path: "/tmp/bonus.mp4".to_string(),
        file_size_bytes: Some(500_000_000),
        duration_secs: Some(1200.0),
        container_format: Some("mp4".to_string()),
        video_streams: vec![VideoStreamInfo {
            index: 0,
            codec: "h264".to_string(),
            width: 1440,
            height: 1080,
            frame_rate: Some(29.97),
            aspect_ratio: Some("4:3".to_string()),
            scan_type: None,
            bitrate_bps: None,
            title: None,
            color_transfer: None,
            color_primaries: None,
            dolby_vision_profile: None,
        }],
        audio_streams: vec![AudioStreamInfo {
            index: 1,
            codec: "aac".to_string(),
            channels: 2,
            sample_rate: 48000,
            language: Some("eng".to_string()),
            bitrate_bps: None,
            title: None,
        }],
        subtitle_streams: vec![],
        compatibility: Some(CompatibilityAssessment::ReEncodeRequired),
        compatibility_detail: None,
        fingerprint: None,
        warnings: vec![],
        thumbnail_path: None,
        thumbnail_error: None,
        source_chapters: vec![],
        format_title: None,
    };

    let second_title = Title {
        id: "title-2".to_string(),
        name: "Bonus Feature".to_string(),
        source_asset_id: Some("asset-2".to_string()),
        video_mapping: Some(VideoTrackMapping {
            source_stream_index: 0,
            copy_mode: CopyMode::ReEncode,
        }),
        video_output_profile: Some(VideoOutputProfile {
            raster: VideoRaster::FullD1,
            aspect: AspectMode::FourByThree,
        }),
        audio_mappings: vec![AudioTrackMapping {
            id: "am-2".to_string(),
            source_stream_index: 1,
            output_target: AudioOutputTarget::Ac3,
            copy_mode: CopyMode::ReEncode,
            label: "English".to_string(),
            language: "eng".to_string(),
            order_index: 0,
            is_default: true,
        }],
        subtitle_mappings: vec![],
        chapters: vec![ChapterPoint {
            id: "ch-3".to_string(),
            name: "Bonus Chapter".to_string(),
            timestamp_secs: 0.0,
            order_index: 0,
        }],
        end_action: Some(PlaybackAction::Stop),
        order_index: 0,
    };

    let second_titleset = Titleset {
        id: "titleset-2".to_string(),
        name: "Bonus".to_string(),
        titles: vec![second_title],
        menus: vec![],
    };

    project.assets.push(second_asset);
    project.disc.titlesets.push(second_titleset);
}
