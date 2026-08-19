// Per-menu checks: button counts, default button, navigation, authored-scene
// validation, and motion-menu background/audio/timing checks.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::{HashMap, HashSet};

use crate::models::*;

use super::menu_action::{validate_action, ActionSubject};
use super::menu_aspect::titleset_stream_counts;
use super::scene::{
    count_scene_buttons, validate_button_video_usage, validate_motion_keyframes,
    validate_scene_nodes,
};

pub(super) fn validate_menus(
    project: &SpindleProjectFile,
    asset_ids: &HashSet<&str>,
    asset_map: &HashMap<&str, &Asset>,
    all_title_ids: &HashSet<&str>,
    all_menu_ids: &HashSet<&str>,
    issues: &mut Vec<ValidationIssue>,
) {
    // Pair each menu with its owning titleset so stream index validation has context.
    // Global menus carry None — we cannot know which titleset they will target.
    let all_menus: Vec<(&Menu, Option<&Titleset>)> = project
        .disc
        .global_menus
        .iter()
        .map(|m| (m, None))
        .chain(
            project
                .disc
                .titlesets
                .iter()
                .flat_map(|ts| ts.menus.iter().map(move |m| (m, Some(ts)))),
        )
        .collect();

    let profile = profile_for(project.disc.family);

    for (menu, titleset_opt) in &all_menus {
        let stream_counts = titleset_opt.map(titleset_stream_counts);
        let doc = menu.doc();
        let background_mode = menu.resolved_background_mode();
        let motion_duration_secs = menu.resolved_motion_duration_secs();
        let motion_loop_start_secs = menu.resolved_motion_loop_start_secs();
        let background_asset_id = menu.resolved_background_asset_id();
        let motion_audio_asset_id = menu.resolved_motion_audio_asset_id();
        let buttons = doc.buttons();

        // Menu-level checks below (background asset, motion, timeout action)
        // always run, regardless of button count — an empty-buttons menu can
        // still have a broken background or motion configuration worth
        // reporting. See `menu.no-buttons` below, which is a Warning and
        // does NOT short-circuit the rest of these checks.

        // Validate the timeout action's target.
        if let Some(action) = &doc.interaction.timeout_action {
            validate_action(
                action,
                all_title_ids,
                all_menu_ids,
                &project.disc,
                &ActionSubject {
                    subject: format!("Timeout action in menu \"{}\"", menu.name),
                    entity_type: "menu",
                    entity_name: Some(&menu.name),
                    context_id: Some(&menu.id),
                },
                stream_counts,
                issues,
            );
        }

        // Hard limit: format-defined maximum navigable buttons per menu
        // (`FormatProfile::max_buttons_per_menu` — 36 for DVD-Video).
        if buttons.len() > profile.max_buttons_per_menu as usize {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                code: "menu.too-many-buttons".to_string(),
                message: format!(
                    "Menu \"{}\" has {} buttons, which exceeds the {}-button {} limit.",
                    menu.name,
                    buttons.len(),
                    profile.max_buttons_per_menu,
                    profile.display_name
                ),
                context: Some(menu.id.clone()),
                entity_type: Some("menu".to_string()),
                entity_name: Some(menu.name.clone()),
                suggested_fix: Some(
                    "Remove some buttons or split the menu into multiple pages.".to_string(),
                ),
            });
        } else if buttons.len() > 18 {
            // Safe Zone warning (12-18 buttons is the recommended target)
            issues.push(ValidationIssue {
                severity: IssueSeverity::Warning,
                code: "menu.button-density-high".to_string(),
                message: format!(
                    "Menu \"{}\" has {} buttons. High button density may exceed the safe zone for some TV displays.",
                    menu.name,
                    buttons.len()
                ),
                context: Some(menu.id.clone()),
                entity_type: Some("menu".to_string()),
                entity_name: Some(menu.name.clone()),
                suggested_fix: Some(
                    "Aim for 12-18 buttons per menu for better readability and compatibility.".to_string(),
                ),
            });
        }

        // Empty menus — a Warning only; it must NOT skip the menu-level
        // checks below (background asset, motion, timeout action already
        // ran above regardless), nor should it prevent per-button checks
        // from running on whatever buttons *do* exist.
        if buttons.is_empty() {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Warning,
                code: "menu.no-buttons".to_string(),
                message: format!("Menu \"{}\" has no buttons.", menu.name),
                context: Some(menu.id.clone()),
                entity_type: Some("menu".to_string()),
                entity_name: Some(menu.name.clone()),
                suggested_fix: Some(
                    "Add at least one button to define user interaction.".to_string(),
                ),
            });
        }

        // No default button
        if !buttons.is_empty() && doc.interaction.default_focus_id.is_none() {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Warning,
                code: "menu.no-default-button".to_string(),
                message: format!(
                    "Menu \"{}\" has no default button. The first button will be selected on entry.",
                    menu.name
                ),
                context: Some(menu.id.clone()),
                entity_type: Some("menu".to_string()),
                entity_name: Some(menu.name.clone()),
                suggested_fix: Some("Set a default button so the player knows which button to highlight on entry.".to_string()),
            });
        }

        // Role/placement consistency: `MenuRole` (what the menu is for) is
        // independent of `MenuDomain` (the DVD backend's actual VMGM/VTSM
        // placement — see `MenuRole`'s doc comment). The role picker only
        // ever offers roles compatible with a menu's current placement (see
        // `MenuLevelInspector.tsx`), so this combination normally can't
        // arise from the UI — but a hand-edited project file, or a project
        // saved before that restriction existed, can still persist an
        // incompatible pair. Flag it: `build/authoring/mod.rs` places menus
        // by `MenuDomain` alone, so an incompatible role is silently
        // ignored for DVD authoring rather than acted on.
        if let Some(role) = doc.role {
            let expected_domain = role.default_domain();
            if expected_domain != doc.domain {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.role-domain-mismatch".to_string(),
                    message: format!(
                        "Menu \"{}\" is set to the {} role, but it's placed in {} — {} menus are normally {}.",
                        menu.name,
                        role_label(role),
                        domain_label(doc.domain),
                        role_label(role),
                        domain_label(expected_domain),
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(format!(
                        "Choose a role compatible with this menu's {} placement.",
                        domain_label(doc.domain)
                    )),
                });
            }
        }

        let button_ids: HashSet<&str> = buttons.iter().map(|b| b.id).collect();

        // Validate every interaction-graph node's action for dangling
        // targets — not just top-level scene buttons. `doc.buttons()` only
        // sees top-level `Button` scene nodes, so a button nested inside a
        // `Group` or a focus node left behind after its scene node was
        // deleted (orphaned) would otherwise escape target validation
        // entirely. Buttons are a subset of interaction nodes, so this is
        // the ONLY pass that target-validates actions — the per-button loop
        // below only checks dead-end (missing-action) and nav-link issues,
        // which need `doc.buttons()` geometry/labels, so each action is
        // target-validated exactly once.
        for node in &doc.interaction.nodes {
            let Some(action) = &node.action else {
                continue;
            };
            let subject = match buttons.iter().find(|b| b.id == node.node_id) {
                Some(button) => format!("Action \"{}\" in menu \"{}\"", button.label, menu.name),
                None => format!("Interaction: {} in menu \"{}\"", node.node_id, menu.name),
            };
            validate_action(
                action,
                all_title_ids,
                all_menu_ids,
                &project.disc,
                &ActionSubject {
                    subject,
                    entity_type: "menu",
                    entity_name: Some(&menu.name),
                    context_id: Some(&menu.id),
                },
                stream_counts,
                issues,
            );
        }

        for button in &buttons {
            // Dead-end detection: button with no action
            if button.action.is_none() {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.button-no-action".to_string(),
                    message: format!(
                        "Button \"{}\" in menu \"{}\" has no action assigned.",
                        button.label, menu.name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Assign an action (play title, show menu, etc.) to this button."
                            .to_string(),
                    ),
                });
            }

            // Navigation link validation
            for (dir, nav_id) in [
                ("up", button.nav_up),
                ("down", button.nav_down),
                ("left", button.nav_left),
                ("right", button.nav_right),
            ] {
                if let Some(id) = nav_id {
                    if !button_ids.contains(id) {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Error,
                            code: "menu.dangling-nav-ref".to_string(),
                            message: format!(
                                "Button \"{}\" in menu \"{}\" has a {dir} nav link to a button that does not exist.",
                                button.label, menu.name
                            ),
                            context: Some(menu.id.clone()),
                            entity_type: Some("menu".to_string()),
                            entity_name: Some(menu.name.clone()),
                            suggested_fix: Some("Remove the broken nav link or use auto-generate navigation to rebuild all links.".to_string()),
                        });
                    }
                }
            }

            // Navigation completeness (buttons should ideally have all nav directions)
            let has_any_nav = button.nav_up.is_some()
                || button.nav_down.is_some()
                || button.nav_left.is_some()
                || button.nav_right.is_some();

            if !has_any_nav && buttons.len() > 1 {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Info,
                    code: "menu.button-no-navigation".to_string(),
                    message: format!(
                        "Button \"{}\" in menu \"{}\" has no directional navigation set. Use auto-generate navigation to fix this.",
                        button.label, menu.name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some("Use the auto-generate navigation feature to create directional links for all buttons.".to_string()),
                });
            }
        }

        // ── Authored Scene Checks ───────────────────────────────────────
        // Count buttons in scene nodes (including groups) — a menu can stay
        // under the top-level format limit above yet exceed it once buttons
        // nested in groups are counted too.
        let scene_button_count = count_scene_buttons(&doc.scene.nodes);
        if scene_button_count > profile.max_buttons_per_menu as usize {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                code: "menu.scene-too-many-buttons".to_string(),
                message: format!(
                    "Authored scene for menu \"{}\" has {} buttons, which exceeds the {}-button {} limit.",
                    menu.name, scene_button_count, profile.max_buttons_per_menu, profile.display_name
                ),
                context: Some(menu.id.clone()),
                entity_type: Some("menu".to_string()),
                entity_name: Some(menu.name.clone()),
                suggested_fix: Some(
                    "Remove some buttons or split the scene into multiple pages.".to_string(),
                ),
            });
        }

        // Check background asset
        if let Some(asset_id) = &doc.scene.background.asset_id {
            if !asset_ids.contains(asset_id.as_str()) {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    code: "menu.scene-dangling-background".to_string(),
                    message: format!(
                        "Authored scene for menu \"{}\" references a background asset that no longer exists.",
                        menu.name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Re-assign a background asset in the menu editor.".to_string(),
                    ),
                });
            }
        }

        // Validate all scene nodes recursively
        validate_scene_nodes(&doc.scene.nodes, asset_ids, &menu.name, &menu.id, issues);

        if matches!(background_mode, BackgroundMode::Motion) {
            if background_asset_id.is_none() {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    code: "menu.motion-missing-background".to_string(),
                    message: format!(
                        "Motion menu \"{}\" has no background video asset assigned.",
                        menu.name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Assign a video-backed background asset before enabling motion mode."
                            .to_string(),
                    ),
                });
            } else if let Some(asset_id) = background_asset_id {
                if let Some(asset) = asset_map.get(asset_id) {
                    if asset.video_streams.is_empty() {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Error,
                            code: "menu.motion-background-no-video-stream".to_string(),
                            message: format!(
                                "Motion menu \"{}\" uses a background asset that has no video stream.",
                                menu.name
                            ),
                            context: Some(menu.id.clone()),
                            entity_type: Some("menu".to_string()),
                            entity_name: Some(menu.name.clone()),
                            suggested_fix: Some(
                                "Choose a source asset with a video stream for the motion background."
                                    .to_string(),
                            ),
                        });
                    } else if motion_audio_asset_id.is_none() && asset.audio_streams.is_empty() {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Warning,
                            code: "menu.motion-no-audio-bed".to_string(),
                            message: format!(
                                "Motion menu \"{}\" has no authored audio bed, and its background video asset does not carry audio either.",
                                menu.name
                            ),
                            context: Some(menu.id.clone()),
                            entity_type: Some("menu".to_string()),
                            entity_name: Some(menu.name.clone()),
                            suggested_fix: Some(
                                "Assign a separate motion audio asset or choose a background video with usable audio."
                                    .to_string(),
                            ),
                        });
                    }
                }
            }

            if !motion_duration_secs.is_some_and(|secs| secs > 0.0) {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    code: "menu.motion-invalid-duration".to_string(),
                    message: format!(
                        "Motion menu \"{}\" needs a loop duration greater than 0 seconds.",
                        menu.name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Set an explicit motion loop duration in the menu inspector.".to_string(),
                    ),
                });
            }

            if motion_loop_start_secs <= 0.0 {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.motion-loop-start-default".to_string(),
                    message: format!(
                        "Motion menu \"{}\" still uses a loop start time of 0.0 seconds, which causes a visible restart cut on each loop.",
                        menu.name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Set a loop start time after the intro segment so the loop can re-enter cleanly."
                            .to_string(),
                    ),
                });
            }

            if let Some(audio_asset_id) = motion_audio_asset_id {
                if !asset_ids.contains(audio_asset_id) {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.motion-audio-dangling".to_string(),
                        message: format!(
                            "Motion menu \"{}\" references an audio asset that no longer exists.",
                            menu.name
                        ),
                        context: Some(menu.id.clone()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu.name.clone()),
                        suggested_fix: Some(
                            "Choose another audio asset or clear the motion audio assignment."
                                .to_string(),
                        ),
                    });
                } else if let Some(asset) = asset_map.get(audio_asset_id) {
                    if asset.audio_streams.is_empty() {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Error,
                            code: "menu.motion-audio-no-stream".to_string(),
                            message: format!(
                                "Motion menu \"{}\" uses an audio asset that has no audio stream.",
                                menu.name
                            ),
                            context: Some(menu.id.clone()),
                            entity_type: Some("menu".to_string()),
                            entity_name: Some(menu.name.clone()),
                            suggested_fix: Some(
                                "Pick an asset with at least one audio stream for the motion bed."
                                    .to_string(),
                            ),
                        });
                    }
                }
            }

            let background_asset = background_asset_id.and_then(|id| asset_map.get(id));
            let source_duration_secs = background_asset.and_then(|asset| asset.duration_secs);

            if let (Some(loop_duration_secs), Some(source_duration_secs)) =
                (motion_duration_secs, source_duration_secs)
            {
                if motion_loop_start_secs + loop_duration_secs > source_duration_secs {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.motion-loop-exceeds-source".to_string(),
                        message: format!(
                            "Motion menu \"{}\" loop window (start {:.2}s + duration {:.2}s) runs past the end of its background asset ({:.2}s).",
                            menu.name, motion_loop_start_secs, loop_duration_secs, source_duration_secs
                        ),
                        context: Some(menu.id.clone()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu.name.clone()),
                        suggested_fix: Some(
                            "Shorten the loop duration or move the loop start earlier so the window fits inside the source video."
                                .to_string(),
                        ),
                    });
                }
            }

            let intro_duration_secs = doc.timing.intro_duration_secs;
            let intro_window_invalid = intro_duration_secs < 0.0
                || (intro_duration_secs > 0.0
                    && source_duration_secs.is_some_and(|source_duration_secs| {
                        doc.timing.intro_start_secs + intro_duration_secs > source_duration_secs
                    }));
            if intro_window_invalid {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    code: "menu.motion-intro-invalid".to_string(),
                    message: format!(
                        "Motion menu \"{}\" intro window is invalid — either the duration is negative, or it runs past the end of the background asset.",
                        menu.name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Set a non-negative intro duration that fits inside the source video, starting from the intro start time."
                            .to_string(),
                    ),
                });
            }

            if doc.timing.loop_count > 0 && doc.interaction.timeout_action.is_none() {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.motion-loop-count-without-timeout".to_string(),
                    message: format!(
                        "Motion menu \"{}\" has a loop count of {}, but no timeout action — it will loop forever instead of stopping after {} plays.",
                        menu.name, doc.timing.loop_count, doc.timing.loop_count
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Set a timeout action, or set the loop count to 0 for an intentional infinite loop."
                            .to_string(),
                    ),
                });
            }
        }

        validate_button_video_usage(menu, background_mode, asset_map, issues);
        validate_motion_keyframes(doc, menu, motion_duration_secs, issues);
    }
}

fn role_label(role: MenuRole) -> &'static str {
    match role {
        MenuRole::Root => "Root",
        MenuRole::TitleSelect => "Title Select",
        MenuRole::Chapter => "Chapter",
        MenuRole::Setup => "Setup",
        MenuRole::Extras => "Extras",
        MenuRole::Popup => "Popup",
    }
}

fn domain_label(domain: MenuDomain) -> &'static str {
    match domain {
        MenuDomain::Vmgm => "VMGM (disc-level)",
        MenuDomain::Titleset => "VTSM (titleset-level)",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project_with_menu(menu: Menu) -> SpindleProjectFile {
        let mut project = SpindleProjectFile::default();
        project.disc.global_menus.push(menu);
        project
    }

    fn authored_document_with_timeout(action: Option<PlaybackAction>) -> MenuDocument {
        MenuDocument {
            id: "menu-1".to_string(),
            name: "Main Menu".to_string(),
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
                    colour: Some("#000000".to_string()),
                },
                nodes: vec![],
                guides: vec![],
            },
            interaction: MenuInteractionGraph {
                default_focus_id: None,
                nodes: vec![],
                timeout_action: action,
            },
            timing: MenuTiming::default(),
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::Still,
            theme_ref: None,
            generation_meta: None,
            compile_policy: MenuCompilePolicy::default(),
        }
    }

    fn motion_document(
        timing: MenuTiming,
        background_asset_id: Option<&str>,
        timeout_action: Option<PlaybackAction>,
    ) -> MenuDocument {
        MenuDocument {
            id: "menu-1".to_string(),
            name: "Motion Menu".to_string(),
            domain: MenuDomain::Vmgm,
            role: MenuRole::TitleSelect,
            scene: MenuScene {
                design_size: MenuSize {
                    width: 720.0,
                    height: 480.0,
                    aspect: AspectMode::SixteenByNine,
                },
                background: SceneBackground {
                    asset_id: background_asset_id.map(|id| id.to_string()),
                    colour: None,
                },
                nodes: vec![],
                guides: vec![],
            },
            interaction: MenuInteractionGraph {
                default_focus_id: None,
                nodes: vec![],
                timeout_action,
            },
            timing,
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::Motion,
            theme_ref: None,
            generation_meta: None,
            compile_policy: MenuCompilePolicy::default(),
        }
    }

    fn motion_video_asset(id: &str, duration_secs: f64) -> Asset {
        let mut asset = Asset::new(format!("{id}.mp4"), format!("/tmp/{id}.mp4"));
        asset.id = id.to_string();
        asset.duration_secs = Some(duration_secs);
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
        asset.audio_streams = vec![AudioStreamInfo {
            index: 1,
            codec: "aac".to_string(),
            channels: 2,
            sample_rate: 48000,
            language: None,
            bitrate_bps: None,
            title: None,
        }];
        asset
    }

    #[test]
    fn motion_build_pending_warning_is_gone() {
        let menu = Menu::new("menu-1", "Motion Menu").with_document(motion_document(
            MenuTiming {
                intro_start_secs: 0.0,
                intro_duration_secs: 0.0,
                loop_start_secs: 1.0,
                loop_duration_secs: 3.0,
                loop_count: 0,
                audio_asset_id: None,
            },
            Some("bg-video"),
            None,
        ));
        let project = project_with_menu(menu);
        let asset = motion_video_asset("bg-video", 10.0);
        let asset_ids: HashSet<&str> = ["bg-video"].into_iter().collect();
        let mut asset_map = HashMap::new();
        asset_map.insert("bg-video", &asset);
        let all_title_ids = HashSet::new();
        let all_menu_ids: HashSet<&str> = ["menu-1"].into_iter().collect();
        let mut issues = Vec::new();

        validate_menus(
            &project,
            &asset_ids,
            &asset_map,
            &all_title_ids,
            &all_menu_ids,
            &mut issues,
        );

        assert!(
            !issues.iter().any(|i| i.code == "menu.motion-build-pending"),
            "the motion-build-pending warning must be gone now that motion builds are supported, got {issues:?}"
        );
    }

    #[test]
    fn motion_loop_exceeds_source_is_flagged_when_window_runs_past_asset_duration() {
        let menu = Menu::new("menu-1", "Motion Menu").with_document(motion_document(
            MenuTiming {
                intro_start_secs: 0.0,
                intro_duration_secs: 0.0,
                loop_start_secs: 8.0,
                loop_duration_secs: 5.0, // 8 + 5 = 13, past the 10s source
                loop_count: 0,
                audio_asset_id: None,
            },
            Some("bg-video"),
            None,
        ));
        let project = project_with_menu(menu);
        let asset = motion_video_asset("bg-video", 10.0);
        let asset_ids: HashSet<&str> = ["bg-video"].into_iter().collect();
        let mut asset_map = HashMap::new();
        asset_map.insert("bg-video", &asset);
        let all_title_ids = HashSet::new();
        let all_menu_ids: HashSet<&str> = ["menu-1"].into_iter().collect();
        let mut issues = Vec::new();

        validate_menus(
            &project,
            &asset_ids,
            &asset_map,
            &all_title_ids,
            &all_menu_ids,
            &mut issues,
        );

        assert!(
            issues
                .iter()
                .any(|i| i.code == "menu.motion-loop-exceeds-source"
                    && i.severity == IssueSeverity::Error),
            "expected a motion-loop-exceeds-source error, got {issues:?}"
        );
    }

    #[test]
    fn motion_loop_within_source_is_not_flagged() {
        let menu = Menu::new("menu-1", "Motion Menu").with_document(motion_document(
            MenuTiming {
                intro_start_secs: 0.0,
                intro_duration_secs: 0.0,
                loop_start_secs: 1.0,
                loop_duration_secs: 3.0,
                loop_count: 0,
                audio_asset_id: None,
            },
            Some("bg-video"),
            None,
        ));
        let project = project_with_menu(menu);
        let asset = motion_video_asset("bg-video", 10.0);
        let asset_ids: HashSet<&str> = ["bg-video"].into_iter().collect();
        let mut asset_map = HashMap::new();
        asset_map.insert("bg-video", &asset);
        let all_title_ids = HashSet::new();
        let all_menu_ids: HashSet<&str> = ["menu-1"].into_iter().collect();
        let mut issues = Vec::new();

        validate_menus(
            &project,
            &asset_ids,
            &asset_map,
            &all_title_ids,
            &all_menu_ids,
            &mut issues,
        );

        assert!(
            !issues
                .iter()
                .any(|i| i.code == "menu.motion-loop-exceeds-source"),
            "loop window fits inside the source, got {issues:?}"
        );
    }

    #[test]
    fn motion_intro_invalid_is_flagged_for_negative_duration() {
        let menu = Menu::new("menu-1", "Motion Menu").with_document(motion_document(
            MenuTiming {
                intro_start_secs: 0.0,
                intro_duration_secs: -1.0,
                loop_start_secs: 1.0,
                loop_duration_secs: 3.0,
                loop_count: 0,
                audio_asset_id: None,
            },
            Some("bg-video"),
            None,
        ));
        let project = project_with_menu(menu);
        let asset = motion_video_asset("bg-video", 10.0);
        let asset_ids: HashSet<&str> = ["bg-video"].into_iter().collect();
        let mut asset_map = HashMap::new();
        asset_map.insert("bg-video", &asset);
        let all_title_ids = HashSet::new();
        let all_menu_ids: HashSet<&str> = ["menu-1"].into_iter().collect();
        let mut issues = Vec::new();

        validate_menus(
            &project,
            &asset_ids,
            &asset_map,
            &all_title_ids,
            &all_menu_ids,
            &mut issues,
        );

        assert!(
            issues.iter().any(
                |i| i.code == "menu.motion-intro-invalid" && i.severity == IssueSeverity::Error
            ),
            "expected a motion-intro-invalid error for negative duration, got {issues:?}"
        );
    }

    #[test]
    fn motion_intro_invalid_is_flagged_when_intro_window_runs_past_source() {
        let menu = Menu::new("menu-1", "Motion Menu").with_document(motion_document(
            MenuTiming {
                intro_start_secs: 8.0,
                intro_duration_secs: 5.0, // 8 + 5 = 13, past the 10s source
                loop_start_secs: 1.0,
                loop_duration_secs: 3.0,
                loop_count: 0,
                audio_asset_id: None,
            },
            Some("bg-video"),
            None,
        ));
        let project = project_with_menu(menu);
        let asset = motion_video_asset("bg-video", 10.0);
        let asset_ids: HashSet<&str> = ["bg-video"].into_iter().collect();
        let mut asset_map = HashMap::new();
        asset_map.insert("bg-video", &asset);
        let all_title_ids = HashSet::new();
        let all_menu_ids: HashSet<&str> = ["menu-1"].into_iter().collect();
        let mut issues = Vec::new();

        validate_menus(
            &project,
            &asset_ids,
            &asset_map,
            &all_title_ids,
            &all_menu_ids,
            &mut issues,
        );

        assert!(
            issues
                .iter()
                .any(|i| i.code == "menu.motion-intro-invalid"
                    && i.severity == IssueSeverity::Error),
            "expected a motion-intro-invalid error for an out-of-range intro window, got {issues:?}"
        );
    }

    #[test]
    fn motion_loop_count_without_timeout_is_a_warning() {
        let menu = Menu::new("menu-1", "Motion Menu").with_document(motion_document(
            MenuTiming {
                intro_start_secs: 0.0,
                intro_duration_secs: 0.0,
                loop_start_secs: 1.0,
                loop_duration_secs: 3.0,
                loop_count: 3,
                audio_asset_id: None,
            },
            Some("bg-video"),
            None,
        ));
        let project = project_with_menu(menu);
        let asset = motion_video_asset("bg-video", 10.0);
        let asset_ids: HashSet<&str> = ["bg-video"].into_iter().collect();
        let mut asset_map = HashMap::new();
        asset_map.insert("bg-video", &asset);
        let all_title_ids = HashSet::new();
        let all_menu_ids: HashSet<&str> = ["menu-1"].into_iter().collect();
        let mut issues = Vec::new();

        validate_menus(
            &project,
            &asset_ids,
            &asset_map,
            &all_title_ids,
            &all_menu_ids,
            &mut issues,
        );

        assert!(
            issues
                .iter()
                .any(|i| i.code == "menu.motion-loop-count-without-timeout"
                    && i.severity == IssueSeverity::Warning),
            "expected a motion-loop-count-without-timeout warning, got {issues:?}"
        );
    }

    #[test]
    fn motion_loop_count_with_timeout_is_not_flagged() {
        let menu = Menu::new("menu-1", "Motion Menu").with_document(motion_document(
            MenuTiming {
                intro_start_secs: 0.0,
                intro_duration_secs: 0.0,
                loop_start_secs: 1.0,
                loop_duration_secs: 3.0,
                loop_count: 3,
                audio_asset_id: None,
            },
            Some("bg-video"),
            Some(PlaybackAction::Stop),
        ));
        let project = project_with_menu(menu);
        let asset = motion_video_asset("bg-video", 10.0);
        let asset_ids: HashSet<&str> = ["bg-video"].into_iter().collect();
        let mut asset_map = HashMap::new();
        asset_map.insert("bg-video", &asset);
        let all_title_ids = HashSet::new();
        let all_menu_ids: HashSet<&str> = ["menu-1"].into_iter().collect();
        let mut issues = Vec::new();

        validate_menus(
            &project,
            &asset_ids,
            &asset_map,
            &all_title_ids,
            &all_menu_ids,
            &mut issues,
        );

        assert!(
            !issues
                .iter()
                .any(|i| i.code == "menu.motion-loop-count-without-timeout"),
            "a timeout action is authored, so this should not be flagged, got {issues:?}"
        );
    }

    #[test]
    fn timeout_action_targeting_a_deleted_title_is_flagged_even_with_no_buttons() {
        // Regression guard: the timeout action must still be validated even
        // though the menu has no buttons — `menu.no-buttons` is a Warning
        // and must not short-circuit the rest of the menu-level checks.
        let menu = Menu::new("menu-1", "Main Menu").with_document(authored_document_with_timeout(
            Some(PlaybackAction::PlayTitle {
                title_id: "stale-title-id".to_string(),
            }),
        ));
        let project = project_with_menu(menu);

        let asset_ids = HashSet::new();
        let asset_map = HashMap::new();
        let all_title_ids = HashSet::new();
        let all_menu_ids: HashSet<&str> = ["menu-1"].into_iter().collect();
        let mut issues = Vec::new();

        validate_menus(
            &project,
            &asset_ids,
            &asset_map,
            &all_title_ids,
            &all_menu_ids,
            &mut issues,
        );

        assert!(
            issues
                .iter()
                .any(|i| i.code == "menu.dangling-title-ref"
                    && i.context.as_deref() == Some("menu-1")),
            "expected a dangling-title-ref issue for the menu's timeout action, got {issues:?}"
        );
    }

    #[test]
    fn authored_document_timeout_action_targeting_a_deleted_menu_is_flagged() {
        let menu = Menu::new("menu-1", "Main Menu").with_document(authored_document_with_timeout(
            Some(PlaybackAction::ShowMenu {
                menu_id: "stale-menu-id".to_string(),
            }),
        ));
        let project = project_with_menu(menu);

        let asset_ids = HashSet::new();
        let asset_map = HashMap::new();
        let all_title_ids = HashSet::new();
        let all_menu_ids: HashSet<&str> = ["menu-1"].into_iter().collect();
        let mut issues = Vec::new();

        validate_menus(
            &project,
            &asset_ids,
            &asset_map,
            &all_title_ids,
            &all_menu_ids,
            &mut issues,
        );

        assert!(
            issues
                .iter()
                .any(|i| i.code == "menu.dangling-menu-ref"
                    && i.context.as_deref() == Some("menu-1")),
            "expected a dangling-menu-ref issue for the authored timeout action, got {issues:?}"
        );
    }

    #[test]
    fn timeout_action_targeting_an_existing_title_is_not_flagged() {
        let menu = Menu::new("menu-1", "Main Menu").with_document(authored_document_with_timeout(
            Some(PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            }),
        ));
        let project = project_with_menu(menu);

        let asset_ids = HashSet::new();
        let asset_map = HashMap::new();
        let all_title_ids: HashSet<&str> = ["title-1"].into_iter().collect();
        let all_menu_ids: HashSet<&str> = ["menu-1"].into_iter().collect();
        let mut issues = Vec::new();

        validate_menus(
            &project,
            &asset_ids,
            &asset_map,
            &all_title_ids,
            &all_menu_ids,
            &mut issues,
        );

        assert!(
            !issues.iter().any(|i| i.code.starts_with("menu.dangling")),
            "valid timeout action target should not raise a dangling-reference issue, got {issues:?}"
        );
    }

    #[test]
    fn scene_only_menu_with_buttons_gets_no_no_buttons_warning_and_full_check_suite() {
        // Issue #29 regression: a menu authored purely as a scene document
        // (whose legacy `buttons[]` never existed) must not be flagged as
        // having no buttons — and the rest of the per-menu checks (here: a
        // dangling background asset) must still run rather than being
        // short-circuited.
        let menu = Menu::new("menu-1", "Scene Menu").with_document(MenuDocument {
            id: "menu-1".to_string(),
            name: "Scene Menu".to_string(),
            domain: MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
            scene: MenuScene {
                design_size: MenuSize {
                    width: 720.0,
                    height: 480.0,
                    aspect: AspectMode::SixteenByNine,
                },
                background: SceneBackground {
                    asset_id: Some("missing-asset".to_string()),
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
                default_focus_id: Some("btn-1".to_string()),
                nodes: vec![FocusNode {
                    node_id: "btn-1".to_string(),
                    action: Some(PlaybackAction::Stop),
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
        });
        let project = project_with_menu(menu);

        // "missing-asset" is deliberately absent from asset_ids/asset_map.
        let asset_ids = HashSet::new();
        let asset_map = HashMap::new();
        let all_title_ids = HashSet::new();
        let all_menu_ids: HashSet<&str> = ["menu-1"].into_iter().collect();
        let mut issues = Vec::new();

        validate_menus(
            &project,
            &asset_ids,
            &asset_map,
            &all_title_ids,
            &all_menu_ids,
            &mut issues,
        );

        assert!(
            !issues.iter().any(|i| i.code == "menu.no-buttons"),
            "menu with authored scene buttons must not be flagged as having no buttons, got {issues:?}"
        );
        assert!(
            issues
                .iter()
                .any(|i| i.code == "menu.scene-dangling-background"),
            "expected the dangling background asset to still be reported, got {issues:?}"
        );
    }

    #[test]
    fn dangling_actions_on_group_nested_and_orphaned_interaction_nodes_are_flagged() {
        // Regression guard: `doc.buttons()` only sees top-level scene
        // buttons, so target validation must walk `interaction.nodes`
        // directly to catch (a) a button nested inside a `Group`, whose
        // focus node still lives in the top-level interaction graph, and
        // (b) an orphaned focus node whose scene button was deleted but
        // whose interaction node was left behind.
        let menu = Menu::new("menu-1", "Main Menu").with_document(MenuDocument {
            id: "menu-1".to_string(),
            name: "Main Menu".to_string(),
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
                    colour: Some("#000000".to_string()),
                },
                nodes: vec![SceneNode::Group {
                    id: "group-1".to_string(),
                    name: "Group".to_string(),
                    children: vec![SceneNode::Button {
                        id: "grouped-btn".to_string(),
                        label: "Grouped".to_string(),
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
                }],
                guides: vec![],
            },
            interaction: MenuInteractionGraph {
                default_focus_id: Some("grouped-btn".to_string()),
                nodes: vec![
                    FocusNode {
                        node_id: "grouped-btn".to_string(),
                        action: Some(PlaybackAction::ShowMenu {
                            menu_id: "deleted-menu".to_string(),
                        }),
                        ..FocusNode::default()
                    },
                    FocusNode {
                        node_id: "orphaned-focus".to_string(),
                        action: Some(PlaybackAction::PlayTitle {
                            title_id: "deleted-title".to_string(),
                        }),
                        ..FocusNode::default()
                    },
                ],
                timeout_action: None,
            },
            timing: MenuTiming::default(),
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::Still,
            theme_ref: None,
            generation_meta: None,
            compile_policy: MenuCompilePolicy::default(),
        });
        let project = project_with_menu(menu);

        let asset_ids = HashSet::new();
        let asset_map = HashMap::new();
        let all_title_ids = HashSet::new();
        let all_menu_ids: HashSet<&str> = ["menu-1"].into_iter().collect();
        let mut issues = Vec::new();

        validate_menus(
            &project,
            &asset_ids,
            &asset_map,
            &all_title_ids,
            &all_menu_ids,
            &mut issues,
        );

        assert!(
            issues
                .iter()
                .any(|i| i.code == "menu.dangling-menu-ref"),
            "expected the group-nested button's dangling showMenu target to be flagged, got {issues:?}"
        );
        assert!(
            issues
                .iter()
                .any(|i| i.code == "menu.dangling-title-ref"),
            "expected the orphaned focus node's dangling playTitle target to be flagged, got {issues:?}"
        );
    }

    // ── `menu.role-domain-mismatch` ───────────────────────────────────────

    #[test]
    fn role_incompatible_with_placement_is_flagged() {
        // `Chapter` is a titleset-only role (see `MenuRole::default_domain`),
        // but this menu is persisted as a VMGM (global) menu — the picker
        // would never produce this combination, but a hand-edited or
        // pre-restriction project file still can.
        let menu = Menu::new("menu-1", "Main Menu").with_document(MenuDocument {
            role: Some(MenuRole::Chapter),
            ..authored_document_with_timeout(None)
        });
        let project = project_with_menu(menu);

        let asset_ids = HashSet::new();
        let asset_map = HashMap::new();
        let all_title_ids = HashSet::new();
        let all_menu_ids: HashSet<&str> = ["menu-1"].into_iter().collect();
        let mut issues = Vec::new();

        validate_menus(
            &project,
            &asset_ids,
            &asset_map,
            &all_title_ids,
            &all_menu_ids,
            &mut issues,
        );

        assert!(
            issues.iter().any(|i| i.code == "menu.role-domain-mismatch"
                && i.severity == IssueSeverity::Warning
                && i.context.as_deref() == Some("menu-1")),
            "expected a role-domain-mismatch warning for a Chapter role on a VMGM menu, got {issues:?}"
        );
    }

    #[test]
    fn role_compatible_with_placement_is_not_flagged() {
        // `TitleSelect` is VMGM-compatible (the default in
        // `authored_document_with_timeout`) — no mismatch warning.
        let menu =
            Menu::new("menu-1", "Main Menu").with_document(authored_document_with_timeout(None));
        let project = project_with_menu(menu);

        let asset_ids = HashSet::new();
        let asset_map = HashMap::new();
        let all_title_ids = HashSet::new();
        let all_menu_ids: HashSet<&str> = ["menu-1"].into_iter().collect();
        let mut issues = Vec::new();

        validate_menus(
            &project,
            &asset_ids,
            &asset_map,
            &all_title_ids,
            &all_menu_ids,
            &mut issues,
        );

        assert!(
            !issues.iter().any(|i| i.code == "menu.role-domain-mismatch"),
            "expected no role-domain-mismatch warning for a VMGM-compatible role, got {issues:?}"
        );
    }
}
