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
            channel_layout: None,
            bitrate_bps: None,
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
        bitrate_weight: 1.0,
        bitrate_floor_bps: None,
        bitrate_ceiling_bps: None,
        pinned_bitrate_bps: None,
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

/// Build a menu with a single authored scene button ("btn-1") carrying
/// `action`, and that button set as the default focus. Mirrors what
/// `migrate_to_document` would have lifted from the old legacy fields, since
/// `Menu`'s legacy fields are no longer publicly constructible outside
/// `models::menu` (deserialise-only).
pub(crate) fn test_menu_with_action(
    menu_id: &str,
    menu_name: &str,
    action: PlaybackAction,
) -> Menu {
    Menu::new(menu_id, menu_name).with_document(MenuDocument {
        id: menu_id.to_string(),
        name: menu_name.to_string(),
        domain: MenuDomain::Vmgm,
        role: Some(MenuRole::TitleSelect),
        scene: MenuScene {
            design_size: MenuSize::default(),
            background: SceneBackground {
                asset_id: None,
                colour: Some("#101014".to_string()),
            },
            nodes: vec![SceneNode::Button {
                id: "btn-1".to_string(),
                label: "Play".to_string(),
                x: 120.0,
                y: 320.0,
                width: 240.0,
                height: 48.0,
                highlight_mode: HighlightMode::Static,
                highlight_keyframes: vec![],
                video_asset_id: None,
                button_style: None,
                label_style: None,
            }],
            guides: vec![],
        },
        interaction: MenuInteractionGraph {
            default_focus_id: Some("btn-1".to_string()),
            nodes: vec![FocusNode {
                node_id: "btn-1".to_string(),
                action: Some(action),
                ..FocusNode::default()
            }],
            timeout_action: None,
        },
        timing: MenuTiming::default(),
        highlight_colours: MenuHighlightColours::default(),
        background_mode: BackgroundMode::Still,
        theme_ref: None,
        generation_meta: None,
        compile_policy: MenuCompilePolicy::default(),
    })
}

/// Append a button to `menu`'s authored document scene + interaction graph.
/// Test helper standing in for the legacy `menu.buttons.push(...)` pattern,
/// now that `Menu`'s legacy fields are private.
pub(crate) fn push_button(menu: &mut Menu, button: MenuButton) {
    let doc = menu.doc_mut();
    doc.scene.nodes.push(SceneNode::Button {
        id: button.id.clone(),
        label: button.label.clone(),
        x: button.bounds.x,
        y: button.bounds.y,
        width: button.bounds.width,
        height: button.bounds.height,
        highlight_mode: button.highlight_mode,
        highlight_keyframes: button.highlight_keyframes.clone(),
        video_asset_id: button.video_asset_id.clone(),
        button_style: None,
        label_style: None,
    });
    doc.interaction.nodes.push(FocusNode {
        node_id: button.id.clone(),
        nav_up: button.nav_up.clone(),
        nav_down: button.nav_down.clone(),
        nav_left: button.nav_left.clone(),
        nav_right: button.nav_right.clone(),
        action: button.action.clone(),
    });
}

/// Mutable access to a button's interaction/focus node by id. Test helper
/// standing in for the legacy `menu.buttons[i].nav_* = ...` pattern.
pub(crate) fn focus_node_mut<'a>(menu: &'a mut Menu, button_id: &str) -> &'a mut FocusNode {
    menu.doc_mut()
        .interaction
        .nodes
        .iter_mut()
        .find(|n| n.node_id == button_id)
        .unwrap_or_else(|| panic!("expected a focus node for \"{button_id}\""))
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
            channel_layout: None,
            bitrate_bps: None,
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
        bitrate_weight: 1.0,
        bitrate_floor_bps: None,
        bitrate_ceiling_bps: None,
        pinned_bitrate_bps: None,
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
