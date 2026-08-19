// Project validation: orchestrates per-category checks and returns the combined
// list of issues. See plugins/tauri-plugin-spindle-project/src/desktop.rs for the
// `SpindleProject::validate_project` entry point that calls `run()`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::{HashMap, HashSet};

use crate::models::*;

mod build_settings;
mod chapter;
mod disc;
mod menu;
mod menu_action;
mod menu_aspect;
mod scene;
mod title;
mod titleset;

pub(crate) fn run(project: &SpindleProjectFile) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();

    let all_title_ids: HashSet<&str> = project
        .disc
        .titlesets
        .iter()
        .flat_map(|ts| ts.titles.iter().map(|t| t.id.as_str()))
        .collect();
    let all_menu_ids: HashSet<&str> = project
        .disc
        .global_menus
        .iter()
        .chain(project.disc.titlesets.iter().flat_map(|ts| ts.menus.iter()))
        .map(|m| m.id.as_str())
        .collect();

    let total_titles = disc::validate_disc(project, &all_title_ids, &all_menu_ids, &mut issues);

    let asset_ids: HashSet<&str> = project.assets.iter().map(|a| a.id.as_str()).collect();
    let asset_map: HashMap<&str, &Asset> =
        project.assets.iter().map(|a| (a.id.as_str(), a)).collect();

    title::validate_titles(project, &asset_ids, &asset_map, &mut issues);
    menu::validate_menus(
        project,
        &asset_ids,
        &asset_map,
        &all_title_ids,
        &all_menu_ids,
        &mut issues,
    );
    menu_aspect::validate_menu_aspect_sections(project, &mut issues);
    titleset::validate_titleset_formats(project, &mut issues);
    build_settings::validate_build_settings(project, total_titles, &mut issues);

    issues
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::models::{
        AnimatableProperty, AnimationTrack, AspectMode, Asset, AudioOutputTarget,
        AudioTrackMapping, BackgroundMode, ChapterPoint, CompatibilityAssessment, CopyMode, Disc,
        DiscFamily, Easing, HighlightMode, IssueSeverity, KeyValue, Keyframe, Menu,
        MenuCompilePolicy, MenuDocument, MenuDomain, MenuHighlightColours, MenuInteractionGraph,
        MenuRole, MenuScene, MenuSize, MenuTiming, PlaybackAction, SceneBackground, SceneNode,
        SubtitleTrackMapping, Title, Titleset, VideoStandard,
    };

    use super::chapter::{chapter_target_exists, dangling_play_chapter_issue};
    use super::menu_action::{validate_action, ActionSubject};
    use super::menu_aspect::{titleset_stream_counts, validate_menu_aspect_section};
    use super::scene::{validate_animation_tracks, validate_button_video_usage};

    #[test]
    fn chapter_target_exists_requires_matching_title_and_chapter() {
        let disc = Disc {
            standard: VideoStandard::Ntsc,
            titlesets: vec![Titleset {
                id: "titleset-1".to_string(),
                name: "Main".to_string(),
                titles: vec![Title {
                    id: "title-1".to_string(),
                    name: "Feature".to_string(),
                    source_asset_id: None,
                    video_mapping: None,
                    video_output_profile: None,
                    audio_mappings: vec![],
                    subtitle_mappings: vec![],
                    chapters: vec![ChapterPoint {
                        id: "ch-2".to_string(),
                        name: "Chapter 2".to_string(),
                        timestamp_secs: 0.0,
                        order_index: 0,
                    }],
                    end_action: None,
                    order_index: 0,
                    bitrate_weight: 1.0,
                    bitrate_floor_bps: None,
                    bitrate_ceiling_bps: None,
                    pinned_bitrate_bps: None,
                }],
                menus: vec![],
            }],
            ..Disc::default()
        };

        assert!(chapter_target_exists(&disc, "title-1", "ch-2"));
        assert!(!chapter_target_exists(&disc, "title-1", "missing-chapter"));
        assert!(!chapter_target_exists(&disc, "missing-title", "ch-2"));
    }

    #[test]
    fn dangling_play_chapter_issue_marks_missing_targets_as_errors() {
        let issue = dangling_play_chapter_issue(
            "menu.dangling-chapter-ref",
            "Button \"Play\" in menu \"Main Menu\" references a chapter target that does not exist."
                .to_string(),
            Some("menu-1".to_string()),
            "menu",
            Some("Main Menu".to_string()),
            "Update the button action to point to an existing chapter or remove it.",
        );

        assert!(matches!(issue.severity, IssueSeverity::Error));
        assert_eq!(issue.code, "menu.dangling-chapter-ref");
        assert_eq!(issue.context.as_deref(), Some("menu-1"));
    }

    fn make_audio_mapping(order_index: u32) -> AudioTrackMapping {
        AudioTrackMapping {
            id: format!("audio-{order_index}"),
            source_stream_index: order_index,
            output_target: AudioOutputTarget::Ac3,
            copy_mode: CopyMode::Copy,
            label: format!("Audio {order_index}"),
            language: "eng".to_string(),
            order_index,
            is_default: order_index == 0,
            channel_layout: None,
            bitrate_bps: None,
        }
    }

    fn make_subtitle_mapping(order_index: u32) -> SubtitleTrackMapping {
        SubtitleTrackMapping {
            id: format!("sub-{order_index}"),
            source_stream_index: order_index,
            label: format!("Subtitle {order_index}"),
            language: "eng".to_string(),
            order_index,
            is_default: order_index == 0,
            is_forced: false,
        }
    }

    fn make_titleset_with_streams(audio_count: usize, subtitle_count: usize) -> Titleset {
        Titleset {
            id: "ts-1".to_string(),
            name: "Main".to_string(),
            titles: vec![Title {
                id: "title-1".to_string(),
                name: "Feature".to_string(),
                source_asset_id: None,
                video_mapping: None,
                video_output_profile: None,
                audio_mappings: (0..audio_count as u32).map(make_audio_mapping).collect(),
                subtitle_mappings: (0..subtitle_count as u32)
                    .map(make_subtitle_mapping)
                    .collect(),
                chapters: vec![],
                end_action: None,
                order_index: 0,
                bitrate_weight: 1.0,
                bitrate_floor_bps: None,
                bitrate_ceiling_bps: None,
                pinned_bitrate_bps: None,
            }],
            menus: vec![],
        }
    }

    #[test]
    fn titleset_stream_counts_reflects_title_mappings() {
        let ts = make_titleset_with_streams(2, 3);
        assert_eq!(titleset_stream_counts(&ts), (2, 3));
    }

    #[test]
    fn titleset_stream_counts_uses_max_across_titles() {
        let mut ts = make_titleset_with_streams(2, 1);
        // Second title has more subtitle tracks than the first.
        ts.titles.push(Title {
            id: "title-2".to_string(),
            name: "Bonus".to_string(),
            source_asset_id: None,
            video_mapping: None,
            video_output_profile: None,
            audio_mappings: vec![make_audio_mapping(0)],
            subtitle_mappings: vec![make_subtitle_mapping(0), make_subtitle_mapping(1)],
            chapters: vec![],
            end_action: None,
            order_index: 1,
            bitrate_weight: 1.0,
            bitrate_floor_bps: None,
            bitrate_ceiling_bps: None,
            pinned_bitrate_bps: None,
        });
        let (audio, subtitle) = titleset_stream_counts(&ts);
        assert_eq!(audio, 2);
        assert_eq!(subtitle, 2);
    }

    #[test]
    fn titleset_stream_counts_empty_titleset_returns_zero() {
        let ts = Titleset {
            id: "ts-empty".to_string(),
            name: "Empty".to_string(),
            titles: vec![],
            menus: vec![],
        };
        assert_eq!(titleset_stream_counts(&ts), (0, 0));
    }

    fn run_stream_action_validation(
        action: PlaybackAction,
        stream_counts: Option<(usize, usize)>,
    ) -> Vec<crate::models::ValidationIssue> {
        let disc = Disc::default();
        let all_title_ids = std::collections::HashSet::new();
        let all_menu_ids = std::collections::HashSet::new();
        let mut issues = Vec::new();
        validate_action(
            &action,
            &all_title_ids,
            &all_menu_ids,
            &disc,
            &ActionSubject {
                subject: "Action \"Audio English\" in menu \"Setup Menu\"".to_string(),
                entity_type: "menu",
                entity_name: Some("Setup Menu"),
                context_id: Some("menu-1"),
            },
            stream_counts,
            &mut issues,
        );
        issues
    }

    #[test]
    fn set_audio_stream_valid_index_produces_no_issues() {
        let issues = run_stream_action_validation(
            PlaybackAction::SetAudioStream { stream_index: 1 },
            Some((2, 0)),
        );
        assert!(issues.is_empty());
    }

    #[test]
    fn set_audio_stream_out_of_range_is_an_error() {
        let issues = run_stream_action_validation(
            PlaybackAction::SetAudioStream { stream_index: 2 },
            Some((2, 0)),
        );
        assert_eq!(issues.len(), 1);
        assert!(matches!(issues[0].severity, IssueSeverity::Error));
        assert_eq!(issues[0].code, "menu.action.audio-stream-out-of-range");
    }

    #[test]
    fn set_audio_stream_no_tracks_is_an_error() {
        let issues = run_stream_action_validation(
            PlaybackAction::SetAudioStream { stream_index: 0 },
            Some((0, 0)),
        );
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "menu.action.audio-stream-no-tracks");
    }

    #[test]
    fn set_audio_stream_without_titleset_context_skips_validation() {
        // Global menu — no stream_counts available, validation must not fire.
        let issues =
            run_stream_action_validation(PlaybackAction::SetAudioStream { stream_index: 99 }, None);
        assert!(issues.is_empty());
    }

    #[test]
    fn set_subtitle_stream_valid_index_produces_no_issues() {
        let issues = run_stream_action_validation(
            PlaybackAction::SetSubtitleStream {
                stream_index: Some(0),
            },
            Some((0, 2)),
        );
        assert!(issues.is_empty());
    }

    #[test]
    fn set_subtitle_stream_out_of_range_is_an_error() {
        let issues = run_stream_action_validation(
            PlaybackAction::SetSubtitleStream {
                stream_index: Some(3),
            },
            Some((0, 2)),
        );
        assert_eq!(issues.len(), 1);
        assert!(matches!(issues[0].severity, IssueSeverity::Error));
        assert_eq!(issues[0].code, "menu.action.subtitle-stream-out-of-range");
    }

    #[test]
    fn set_subtitle_stream_no_tracks_is_an_error() {
        let issues = run_stream_action_validation(
            PlaybackAction::SetSubtitleStream {
                stream_index: Some(0),
            },
            Some((0, 0)),
        );
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "menu.action.subtitle-stream-no-tracks");
    }

    #[test]
    fn set_subtitle_stream_disable_is_always_valid() {
        // stream_index: None means "disable subtitles" — valid even with zero subtitle tracks.
        let issues = run_stream_action_validation(
            PlaybackAction::SetSubtitleStream { stream_index: None },
            Some((0, 0)),
        );
        assert!(issues.is_empty());
    }

    #[test]
    fn set_subtitle_stream_without_titleset_context_skips_validation() {
        let issues = run_stream_action_validation(
            PlaybackAction::SetSubtitleStream {
                stream_index: Some(99),
            },
            None,
        );
        assert!(issues.is_empty());
    }

    #[test]
    fn validate_menu_aspect_section_reports_mixed_authored_aspects() {
        let menu_a = Menu::new("menu-a", "Menu A").with_document(MenuDocument {
            animation: vec![],
            id: "menu-a".to_string(),
            name: "Menu A".to_string(),
            domain: MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
            scene: MenuScene {
                design_size: MenuSize {
                    width: 720.0,
                    height: 480.0,
                    aspect: AspectMode::FourByThree,
                },
                background: SceneBackground {
                    asset_id: None,
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
            timing: MenuTiming::default(),
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::Still,
            theme_ref: None,
            generation_meta: None,
            compile_policy: MenuCompilePolicy {
                display_aspect: Some(AspectMode::FourByThree),
                ..MenuCompilePolicy::default()
            },
        });
        let menu_b = Menu::new("menu-b", "Menu B").with_document(MenuDocument {
            animation: vec![],
            id: "menu-b".to_string(),
            name: "Menu B".to_string(),
            domain: MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
            scene: MenuScene {
                design_size: MenuSize {
                    width: 720.0,
                    height: 480.0,
                    aspect: AspectMode::SixteenByNine,
                },
                background: SceneBackground {
                    asset_id: None,
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
            timing: MenuTiming::default(),
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::Still,
            theme_ref: None,
            generation_meta: None,
            compile_policy: MenuCompilePolicy {
                display_aspect: Some(AspectMode::SixteenByNine),
                ..MenuCompilePolicy::default()
            },
        });

        let mut issues = Vec::new();
        validate_menu_aspect_section(
            [&menu_a, &menu_b].into_iter(),
            AspectMode::SixteenByNine,
            "disc-global menus",
            None,
            &mut issues,
        );

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "menu.section-aspect-mismatch");
    }

    #[test]
    fn validate_animation_tracks_flags_out_of_range_entries() {
        let menu = Menu::new("menu-1", "Motion Menu").with_document(MenuDocument {
            animation: vec![AnimationTrack {
                node_id: "btn-1".to_string(),
                target: AnimatableProperty::HighlightColour,
                keyframes: vec![Keyframe {
                    timestamp_secs: 9.0,
                    value: KeyValue::Colour {
                        hex: "#ffaa40".to_string(),
                    },
                    easing: Easing::Hold,
                }],
            }],
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
                    asset_id: Some("asset-1".to_string()),
                    colour: None,
                },
                nodes: vec![SceneNode::Button {
                    id: "btn-1".to_string(),
                    label: "Play".to_string(),
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 40.0,
                    highlight_mode: HighlightMode::Static,
                    highlight_keyframes: vec![],
                    video_asset_id: None,
                    button_style: None,
                    label_style: None,
                }],
                guides: vec![],
            },
            interaction: MenuInteractionGraph {
                default_focus_id: None,
                nodes: vec![],
                timeout_action: None,
            },
            timing: MenuTiming {
                intro_start_secs: 0.0,
                intro_duration_secs: 0.0,
                loop_start_secs: 2.0,
                loop_duration_secs: 5.0,
                loop_count: 0,
                audio_asset_id: None,
            },
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::Motion,
            theme_ref: None,
            generation_meta: None,
            compile_policy: MenuCompilePolicy::default(),
        });

        let mut issues = Vec::new();
        validate_animation_tracks(
            menu.authored_document.as_ref().expect("authored doc"),
            &menu,
            Some(5.0),
            DiscFamily::DvdVideo,
            &mut issues,
        );

        assert_eq!(
            issues.len(),
            1,
            "expected only the out-of-range issue, got {issues:?}"
        );
        assert_eq!(issues[0].code, "menu.motion-keyframe-out-of-range");
    }

    /// Shared fixture for the `menu.animation-*` tests below: one button
    /// ("btn-1"), `background_mode`/`timing`/`animation` overridden per test.
    fn animation_test_menu(
        background_mode: BackgroundMode,
        timing: MenuTiming,
        animation: Vec<AnimationTrack>,
    ) -> Menu {
        Menu::new("menu-1", "Test Menu").with_document(MenuDocument {
            animation,
            id: "menu-1".to_string(),
            name: "Test Menu".to_string(),
            domain: MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
            scene: MenuScene {
                design_size: MenuSize {
                    width: 720.0,
                    height: 480.0,
                    aspect: AspectMode::SixteenByNine,
                },
                background: SceneBackground {
                    asset_id: Some("asset-1".to_string()),
                    colour: None,
                },
                nodes: vec![SceneNode::Button {
                    id: "btn-1".to_string(),
                    label: "Play".to_string(),
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 40.0,
                    highlight_mode: HighlightMode::Static,
                    highlight_keyframes: vec![],
                    video_asset_id: None,
                    button_style: None,
                    label_style: None,
                }],
                guides: vec![],
            },
            interaction: MenuInteractionGraph {
                default_focus_id: None,
                nodes: vec![],
                timeout_action: None,
            },
            timing,
            highlight_colours: MenuHighlightColours::default(),
            background_mode,
            theme_ref: None,
            generation_meta: None,
            compile_policy: MenuCompilePolicy::default(),
        })
    }

    fn colour_keyframe(timestamp_secs: f64, hex: &str) -> Keyframe {
        Keyframe {
            timestamp_secs,
            value: KeyValue::Colour {
                hex: hex.to_string(),
            },
            easing: Easing::Hold,
        }
    }

    fn scene_button(id: &str) -> SceneNode {
        SceneNode::Button {
            id: id.to_string(),
            label: "Play".to_string(),
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 40.0,
            highlight_mode: HighlightMode::Static,
            highlight_keyframes: vec![],
            video_asset_id: None,
            button_style: None,
            label_style: None,
        }
    }

    /// Like [`animation_test_menu`], but the caller supplies the scene's
    /// top-level `nodes` directly — used by the group-nesting tests below,
    /// which need a `Group`-wrapped button rather than the shared fixture's
    /// single top-level "btn-1".
    fn animation_test_menu_with_nodes(
        nodes: Vec<SceneNode>,
        animation: Vec<AnimationTrack>,
    ) -> Menu {
        Menu::new("menu-1", "Test Menu").with_document(MenuDocument {
            animation,
            id: "menu-1".to_string(),
            name: "Test Menu".to_string(),
            domain: MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
            scene: MenuScene {
                design_size: MenuSize {
                    width: 720.0,
                    height: 480.0,
                    aspect: AspectMode::SixteenByNine,
                },
                background: SceneBackground {
                    asset_id: Some("asset-1".to_string()),
                    colour: None,
                },
                nodes,
                guides: vec![],
            },
            interaction: MenuInteractionGraph {
                default_focus_id: None,
                nodes: vec![],
                timeout_action: None,
            },
            timing: MenuTiming {
                loop_duration_secs: 5.0,
                ..MenuTiming::default()
            },
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::Motion,
            theme_ref: None,
            generation_meta: None,
            compile_policy: MenuCompilePolicy::default(),
        })
    }

    #[test]
    fn validate_animation_tracks_does_not_warn_for_a_top_level_button() {
        let menu = animation_test_menu_with_nodes(
            vec![scene_button("btn-1")],
            vec![AnimationTrack {
                node_id: "btn-1".to_string(),
                target: AnimatableProperty::HighlightColour,
                keyframes: vec![colour_keyframe(0.0, "#ff0000")],
            }],
        );

        let mut issues = Vec::new();
        validate_animation_tracks(
            menu.doc(),
            &menu,
            Some(5.0),
            DiscFamily::DvdVideo,
            &mut issues,
        );

        assert!(
            !issues
                .iter()
                .any(|i| i.code == "menu.animation-node-not-compiled"),
            "a track on a top-level button must not warn, got {issues:?}"
        );
    }

    #[test]
    fn validate_animation_tracks_warns_for_a_group_nested_button() {
        let menu = animation_test_menu_with_nodes(
            vec![SceneNode::Group {
                id: "group-1".to_string(),
                name: "Group".to_string(),
                children: vec![scene_button("btn-1")],
            }],
            vec![AnimationTrack {
                node_id: "btn-1".to_string(),
                target: AnimatableProperty::HighlightColour,
                keyframes: vec![colour_keyframe(0.0, "#ff0000")],
            }],
        );

        let mut issues = Vec::new();
        validate_animation_tracks(
            menu.doc(),
            &menu,
            Some(5.0),
            DiscFamily::DvdVideo,
            &mut issues,
        );

        let warning = issues
            .iter()
            .find(|i| i.code == "menu.animation-node-not-compiled")
            .expect("expected menu.animation-node-not-compiled for a group-nested button");
        assert_eq!(warning.severity, IssueSeverity::Warning);
        // The node still exists (inside the group), so it must not also be
        // flagged as missing.
        assert!(
            !issues
                .iter()
                .any(|i| i.code == "menu.animation-node-missing"),
            "a group-nested button still exists in the scene, got {issues:?}"
        );
    }

    #[test]
    fn validate_animation_tracks_flags_a_non_finite_keyframe_timestamp() {
        let menu = animation_test_menu(
            BackgroundMode::Motion,
            MenuTiming {
                loop_duration_secs: 5.0,
                ..MenuTiming::default()
            },
            vec![AnimationTrack {
                node_id: "btn-1".to_string(),
                target: AnimatableProperty::HighlightColour,
                keyframes: vec![Keyframe {
                    timestamp_secs: f64::INFINITY,
                    value: KeyValue::Colour {
                        hex: "#ff0000".to_string(),
                    },
                    easing: Easing::Hold,
                }],
            }],
        );

        let mut issues = Vec::new();
        validate_animation_tracks(
            menu.doc(),
            &menu,
            Some(5.0),
            DiscFamily::DvdVideo,
            &mut issues,
        );

        let invalid = issues
            .iter()
            .find(|i| i.code == "menu.animation-keyframe-invalid")
            .expect("expected menu.animation-keyframe-invalid for a non-finite timestamp");
        assert_eq!(invalid.severity, IssueSeverity::Error);
    }

    #[test]
    fn validate_animation_tracks_flags_a_nan_keyframe_timestamp() {
        let menu = animation_test_menu(
            BackgroundMode::Motion,
            MenuTiming {
                loop_duration_secs: 5.0,
                ..MenuTiming::default()
            },
            vec![AnimationTrack {
                node_id: "btn-1".to_string(),
                target: AnimatableProperty::HighlightColour,
                keyframes: vec![Keyframe {
                    timestamp_secs: f64::NAN,
                    value: KeyValue::Colour {
                        hex: "#ff0000".to_string(),
                    },
                    easing: Easing::Hold,
                }],
            }],
        );

        let mut issues = Vec::new();
        validate_animation_tracks(
            menu.doc(),
            &menu,
            Some(5.0),
            DiscFamily::DvdVideo,
            &mut issues,
        );

        let invalid = issues
            .iter()
            .find(|i| i.code == "menu.animation-keyframe-invalid")
            .expect("expected menu.animation-keyframe-invalid for a NaN timestamp");
        assert_eq!(invalid.severity, IssueSeverity::Error);
    }

    #[test]
    fn validate_animation_tracks_flags_a_node_that_no_longer_exists() {
        let menu = animation_test_menu(
            BackgroundMode::Motion,
            MenuTiming {
                loop_duration_secs: 5.0,
                ..MenuTiming::default()
            },
            vec![AnimationTrack {
                node_id: "btn-deleted".to_string(),
                target: AnimatableProperty::HighlightColour,
                keyframes: vec![colour_keyframe(0.0, "#ff0000")],
            }],
        );

        let mut issues = Vec::new();
        validate_animation_tracks(
            menu.doc(),
            &menu,
            Some(5.0),
            DiscFamily::DvdVideo,
            &mut issues,
        );

        assert!(
            issues
                .iter()
                .any(|i| i.code == "menu.animation-node-missing"),
            "expected menu.animation-node-missing, got {issues:?}"
        );
    }

    #[test]
    fn validate_animation_tracks_flags_an_empty_track_as_a_warning() {
        let menu = animation_test_menu(
            BackgroundMode::Motion,
            MenuTiming {
                loop_duration_secs: 5.0,
                ..MenuTiming::default()
            },
            vec![AnimationTrack {
                node_id: "btn-1".to_string(),
                target: AnimatableProperty::HighlightColour,
                keyframes: vec![],
            }],
        );

        let mut issues = Vec::new();
        validate_animation_tracks(
            menu.doc(),
            &menu,
            Some(5.0),
            DiscFamily::DvdVideo,
            &mut issues,
        );

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "menu.animation-empty-track");
        assert_eq!(issues[0].severity, IssueSeverity::Warning);
    }

    #[test]
    fn validate_animation_tracks_warns_on_opacity_and_position_for_dvd() {
        let menu = animation_test_menu(
            BackgroundMode::Motion,
            MenuTiming {
                loop_duration_secs: 5.0,
                ..MenuTiming::default()
            },
            vec![
                AnimationTrack {
                    node_id: "btn-1".to_string(),
                    target: AnimatableProperty::Opacity,
                    keyframes: vec![Keyframe {
                        timestamp_secs: 0.0,
                        value: KeyValue::Scalar { value: 1.0 },
                        easing: Easing::Hold,
                    }],
                },
                AnimationTrack {
                    node_id: "btn-1".to_string(),
                    target: AnimatableProperty::Position,
                    keyframes: vec![Keyframe {
                        timestamp_secs: 0.0,
                        value: KeyValue::Point { x: 0.0, y: 0.0 },
                        easing: Easing::Hold,
                    }],
                },
            ],
        );

        let mut issues = Vec::new();
        validate_animation_tracks(
            menu.doc(),
            &menu,
            Some(5.0),
            DiscFamily::DvdVideo,
            &mut issues,
        );

        let unsupported: Vec<_> = issues
            .iter()
            .filter(|i| i.code == "menu.animation-unsupported-property")
            .collect();
        assert_eq!(
            unsupported.len(),
            2,
            "expected a warning for both Opacity and Position, got {issues:?}"
        );
        assert!(unsupported
            .iter()
            .all(|i| i.severity == IssueSeverity::Warning));
    }

    #[test]
    fn validate_animation_tracks_errors_on_still_menu_and_names_the_degrade() {
        let menu = animation_test_menu(
            BackgroundMode::Still,
            MenuTiming::default(),
            vec![AnimationTrack {
                node_id: "btn-1".to_string(),
                target: AnimatableProperty::HighlightColour,
                keyframes: vec![colour_keyframe(0.0, "#ff0000")],
            }],
        );

        let mut issues = Vec::new();
        validate_animation_tracks(menu.doc(), &menu, None, DiscFamily::DvdVideo, &mut issues);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "menu.animation-on-still-menu");
        assert_eq!(issues[0].severity, IssueSeverity::Error);
        assert!(
            issues[0].message.to_lowercase().contains("first keyframe"),
            "expected the message to name the first-keyframe degrade, got: {}",
            issues[0].message
        );
    }

    #[test]
    fn validate_animation_tracks_warns_on_dense_keyframe_schedules() {
        // 6 sampled frames (union incl. the implicit 0.0) over a 2s loop is
        // 3/s, comfortably past the ~1/s density threshold.
        let menu = animation_test_menu(
            BackgroundMode::Motion,
            MenuTiming {
                loop_duration_secs: 2.0,
                ..MenuTiming::default()
            },
            vec![AnimationTrack {
                node_id: "btn-1".to_string(),
                target: AnimatableProperty::HighlightColour,
                keyframes: vec![
                    colour_keyframe(0.2, "#ff0000"),
                    colour_keyframe(0.4, "#ff1100"),
                    colour_keyframe(0.6, "#ff2200"),
                    colour_keyframe(0.8, "#ff3300"),
                    colour_keyframe(1.0, "#ff4400"),
                ],
            }],
        );

        let mut issues = Vec::new();
        validate_animation_tracks(
            menu.doc(),
            &menu,
            Some(2.0),
            DiscFamily::DvdVideo,
            &mut issues,
        );

        let density: Vec<_> = issues
            .iter()
            .filter(|i| i.code == "menu.animation-keyframe-density")
            .collect();
        assert_eq!(
            density.len(),
            1,
            "expected exactly one density warning, got {issues:?}"
        );
        assert_eq!(density[0].severity, IssueSeverity::Warning);
        assert!(
            density[0].message.contains("3.36 Mbit/s"),
            "expected the message to cite the subpicture bitrate budget, got: {}",
            density[0].message
        );
    }

    #[test]
    fn validate_animation_tracks_sparse_schedule_is_not_flagged_as_dense() {
        let menu = animation_test_menu(
            BackgroundMode::Motion,
            MenuTiming {
                loop_duration_secs: 10.0,
                ..MenuTiming::default()
            },
            vec![AnimationTrack {
                node_id: "btn-1".to_string(),
                target: AnimatableProperty::HighlightColour,
                keyframes: vec![
                    colour_keyframe(0.0, "#ff0000"),
                    colour_keyframe(5.0, "#00ff00"),
                ],
            }],
        );

        let mut issues = Vec::new();
        validate_animation_tracks(
            menu.doc(),
            &menu,
            Some(10.0),
            DiscFamily::DvdVideo,
            &mut issues,
        );

        assert!(
            !issues
                .iter()
                .any(|i| i.code == "menu.animation-keyframe-density"),
            "a sparse schedule must not trigger the density warning, got {issues:?}"
        );
    }

    #[test]
    fn validate_button_video_usage_warns_for_still_menus() {
        let menu = Menu::new("menu-1", "Still Menu").with_document(MenuDocument {
            animation: vec![],
            id: "menu-1".to_string(),
            name: "Still Menu".to_string(),
            domain: MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
            scene: MenuScene {
                design_size: MenuSize {
                    width: 720.0,
                    height: 480.0,
                    aspect: AspectMode::SixteenByNine,
                },
                background: SceneBackground {
                    asset_id: None,
                    colour: None,
                },
                nodes: vec![SceneNode::Button {
                    id: "btn-1".to_string(),
                    label: "Play".to_string(),
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 40.0,
                    highlight_mode: HighlightMode::Static,
                    highlight_keyframes: vec![],
                    video_asset_id: Some("asset-1".to_string()),
                    button_style: None,
                    label_style: None,
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
        let asset = Asset {
            id: "asset-1".to_string(),
            file_name: "clip.mp4".to_string(),
            source_path: "/tmp/clip.mp4".to_string(),
            file_size_bytes: None,
            duration_secs: None,
            container_format: None,
            video_streams: vec![],
            audio_streams: vec![],
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

        let asset_map: HashMap<&str, &Asset> = HashMap::from([("asset-1", &asset)]);
        let mut issues = Vec::new();
        validate_button_video_usage(&menu, BackgroundMode::Still, &asset_map, &mut issues);

        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].code, "menu.button-video-ignored-on-still-menu");
        assert_eq!(issues[1].code, "menu.button-video-no-stream");
    }
}
