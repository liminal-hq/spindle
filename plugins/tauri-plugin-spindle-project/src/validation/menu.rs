// Per-menu checks: button counts, default button, navigation, authored-scene
// validation, and motion-menu background/audio/timing checks.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::{HashMap, HashSet};

use crate::models::*;

use super::menu_action::validate_action;
use super::menu_aspect::titleset_stream_counts;
use super::scene::{
    count_scene_buttons, validate_button_video_usage, validate_motion_keyframes,
    validate_scene_nodes,
};

pub(super) fn validate_menus(
    project: &SpindleProjectFile,
    asset_ids: &HashSet<&str>,
    asset_map: &HashMap<&str, &Asset>,
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

    let all_menu_ids: HashSet<&str> = all_menus.iter().map(|(m, _)| m.id.as_str()).collect();

    let all_title_ids: HashSet<&str> = project
        .disc
        .titlesets
        .iter()
        .flat_map(|ts| ts.titles.iter().map(|t| t.id.as_str()))
        .collect();

    for (menu, titleset_opt) in &all_menus {
        let stream_counts = titleset_opt.map(titleset_stream_counts);
        let background_mode = menu.resolved_background_mode();
        let motion_duration_secs = menu.resolved_motion_duration_secs();
        let motion_loop_start_secs = menu.resolved_motion_loop_start_secs();
        let background_asset_id = menu.resolved_background_asset_id();
        let motion_audio_asset_id = menu.resolved_motion_audio_asset_id();

        // Hard limit: 36 buttons per menu (DVD spec limit for most players/configurations)
        if menu.buttons.len() > 36 {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                code: "menu.too-many-buttons".to_string(),
                message: format!(
                    "Menu \"{}\" has {} buttons, which exceeds the DVD-Video limit of 36.",
                    menu.name,
                    menu.buttons.len()
                ),
                context: Some(menu.id.clone()),
                entity_type: Some("menu".to_string()),
                entity_name: Some(menu.name.clone()),
                suggested_fix: Some(
                    "Remove some buttons or split the menu into multiple pages.".to_string(),
                ),
            });
        } else if menu.buttons.len() > 18 {
            // Safe Zone warning (12-18 buttons is the recommended target)
            issues.push(ValidationIssue {
                severity: IssueSeverity::Warning,
                code: "menu.button-density-high".to_string(),
                message: format!(
                    "Menu \"{}\" has {} buttons. High button density may exceed the safe zone for some TV displays.",
                    menu.name,
                    menu.buttons.len()
                ),
                context: Some(menu.id.clone()),
                entity_type: Some("menu".to_string()),
                entity_name: Some(menu.name.clone()),
                suggested_fix: Some(
                    "Aim for 12-18 buttons per menu for better readability and compatibility.".to_string(),
                ),
            });
        }

        // Empty menus
        if menu.buttons.is_empty() {
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
            continue;
        }

        // No default button
        if menu.default_button_id.is_none() {
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

        let button_ids: HashSet<&str> = menu.buttons.iter().map(|b| b.id.as_str()).collect();

        for button in &menu.buttons {
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

            // Validate action targets exist. Skipped when this menu has
            // an authored document: `buttons[]` is then just a best-effort
            // mirror of `authored_document.interaction.nodes[]` (kept in
            // sync by the frontend, not guaranteed authoritative), and
            // that authored-document action is validated below — checking
            // both would report the same dangling/invalid target twice.
            if menu.authored_document.is_none() {
                if let Some(action) = &button.action {
                    validate_action(
                        action,
                        &all_title_ids,
                        &all_menu_ids,
                        &project.disc,
                        &menu.name,
                        &menu.id,
                        &button.label,
                        stream_counts,
                        issues,
                    );
                }
            }

            // Navigation link validation
            for (dir, nav_id) in [
                ("up", &button.nav_up),
                ("down", &button.nav_down),
                ("left", &button.nav_left),
                ("right", &button.nav_right),
            ] {
                if let Some(id) = nav_id {
                    if !button_ids.contains(id.as_str()) {
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

            if !has_any_nav && menu.buttons.len() > 1 {
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

        // ── Authored Document (Scene) Checks ───────────────────────────
        if let Some(doc) = &menu.authored_document {
            // Count buttons in scene nodes (including groups)
            let scene_button_count = count_scene_buttons(&doc.scene.nodes);
            if scene_button_count > 36 {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    code: "menu.scene-too-many-buttons".to_string(),
                    message: format!(
                        "Authored scene for menu \"{}\" has {} buttons, which exceeds the DVD-Video limit of 36.",
                        menu.name, scene_button_count
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

            // Validate interaction graph actions
            for focus_node in &doc.interaction.nodes {
                if let Some(action) = &focus_node.action {
                    validate_action(
                        action,
                        &all_title_ids,
                        &all_menu_ids,
                        &project.disc,
                        &menu.name,
                        &menu.id,
                        &format!("Interaction: {}", focus_node.node_id),
                        stream_counts,
                        issues,
                    );
                }
            }
        }

        if matches!(background_mode, BackgroundMode::Motion) {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Warning,
                code: "menu.motion-build-pending".to_string(),
                message: format!(
                    "Menu \"{}\" is authored as a motion menu, but the backend still blocks motion-menu builds until video-loop authoring is implemented.",
                    menu.name
                ),
                context: Some(menu.id.clone()),
                entity_type: Some("menu".to_string()),
                entity_name: Some(menu.name.clone()),
                suggested_fix: Some(
                    "Keep authoring the motion timing and assets, but switch this menu back to still mode before building for now.".to_string(),
                ),
            });

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

            if motion_loop_start_secs.is_some_and(|secs| secs <= 0.0) {
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
        }

        validate_button_video_usage(menu, background_mode, asset_map, issues);

        if let Some(doc) = &menu.authored_document {
            validate_motion_keyframes(doc, menu, motion_duration_secs, issues);
        }
    }
}
