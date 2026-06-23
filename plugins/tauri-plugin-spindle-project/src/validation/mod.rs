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
        AspectMode, Asset, AudioOutputTarget, AudioTrackMapping, BackgroundMode, ButtonBounds,
        ChapterPoint, CompatibilityAssessment, CopyMode, Disc, HighlightKeyframe, HighlightMode,
        IssueSeverity, Menu, MenuButton, MenuCompilePolicy, MenuDocument, MenuDomain,
        MenuHighlightColours, MenuInteractionGraph, MenuScene, MenuSize, MenuTiming,
        PlaybackAction, SceneBackground, SceneNode, SubtitleTrackMapping, Title, Titleset,
        VideoStandard,
    };

    use super::chapter::{chapter_target_exists, dangling_play_chapter_issue};
    use super::menu_action::{validate_action, ActionSubject};
    use super::menu_aspect::{titleset_stream_counts, validate_menu_aspect_section};
    use super::scene::{validate_button_video_usage, validate_motion_keyframes};

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
        let menu_a = Menu {
            id: "menu-a".to_string(),
            name: "Menu A".to_string(),
            authored_document: Some(MenuDocument {
                id: "menu-a".to_string(),
                name: "Menu A".to_string(),
                domain: MenuDomain::Vmgm,
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
            }),
            ..Menu::default()
        };
        let menu_b = Menu {
            id: "menu-b".to_string(),
            name: "Menu B".to_string(),
            authored_document: Some(MenuDocument {
                id: "menu-b".to_string(),
                name: "Menu B".to_string(),
                domain: MenuDomain::Vmgm,
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
            }),
            ..Menu::default()
        };

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
    fn validate_motion_keyframes_flags_out_of_range_entries() {
        let menu = Menu {
            id: "menu-1".to_string(),
            name: "Motion Menu".to_string(),
            authored_document: Some(MenuDocument {
                id: "menu-1".to_string(),
                name: "Motion Menu".to_string(),
                domain: MenuDomain::Vmgm,
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
                        highlight_mode: HighlightMode::Animated,
                        highlight_keyframes: vec![HighlightKeyframe {
                            timestamp_secs: 9.0,
                            select_colour: None,
                            select_opacity: None,
                            activate_colour: None,
                            activate_opacity: None,
                        }],
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
                },
                highlight_colours: MenuHighlightColours::default(),
                background_mode: BackgroundMode::Motion,
                theme_ref: None,
                generation_meta: None,
                compile_policy: MenuCompilePolicy::default(),
            }),
            ..Menu::default()
        };

        let mut issues = Vec::new();
        validate_motion_keyframes(
            menu.authored_document.as_ref().expect("authored doc"),
            &menu,
            Some(5.0),
            &mut issues,
        );

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "menu.motion-keyframe-out-of-range");
    }

    #[test]
    fn validate_button_video_usage_warns_for_still_menus() {
        let menu = Menu {
            id: "menu-1".to_string(),
            name: "Still Menu".to_string(),
            buttons: vec![MenuButton {
                id: "btn-1".to_string(),
                label: "Play".to_string(),
                bounds: ButtonBounds {
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 40.0,
                },
                action: None,
                nav_up: None,
                nav_down: None,
                nav_left: None,
                nav_right: None,
                highlight_mode: HighlightMode::Static,
                highlight_keyframes: vec![],
                video_asset_id: Some("asset-1".to_string()),
            }],
            ..Menu::default()
        };
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
