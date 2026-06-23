// Authored scene-graph validation: dangling asset references, button-video usage,
// and animated highlight keyframe checks.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashMap;

use crate::models::*;

pub(super) fn count_scene_buttons(nodes: &[SceneNode]) -> usize {
    let mut count = 0;
    for node in nodes {
        match node {
            SceneNode::Button { .. } => count += 1,
            SceneNode::Group { children, .. } => count += count_scene_buttons(children),
            _ => {}
        }
    }
    count
}

pub(super) fn validate_scene_nodes(
    nodes: &[SceneNode],
    asset_ids: &std::collections::HashSet<&str>,
    menu_name: &str,
    menu_id: &str,
    issues: &mut Vec<ValidationIssue>,
) {
    for node in nodes {
        match node {
            SceneNode::Image { asset_id, id, .. } => {
                if !asset_ids.contains(asset_id.as_str()) {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.scene-dangling-image".to_string(),
                        message: format!(
                            "Scene node \"{}\" in menu \"{}\" references an image asset that no longer exists.",
                            id, menu_name
                        ),
                        context: Some(menu_id.to_string()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu_name.to_string()),
                        suggested_fix: Some("Update or remove the broken image node.".to_string()),
                    });
                }
            }
            SceneNode::Video { asset_id, id, .. } => {
                if !asset_ids.contains(asset_id.as_str()) {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.scene-dangling-video".to_string(),
                        message: format!(
                            "Scene node \"{}\" in menu \"{}\" references a video asset that no longer exists.",
                            id, menu_name
                        ),
                        context: Some(menu_id.to_string()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu_name.to_string()),
                        suggested_fix: Some("Update or remove the broken video node.".to_string()),
                    });
                }
            }
            SceneNode::Button {
                video_asset_id: Some(asset_id),
                id,
                ..
            } => {
                if !asset_ids.contains(asset_id.as_str()) {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.scene-dangling-button-video".to_string(),
                        message: format!(
                            "Button \"{}\" in menu \"{}\" references a video background asset that no longer exists.",
                            id, menu_name
                        ),
                        context: Some(menu_id.to_string()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu_name.to_string()),
                        suggested_fix: Some(
                            "Update or remove the broken button video asset.".to_string(),
                        ),
                    });
                }
            }
            SceneNode::Group { children, .. } => {
                validate_scene_nodes(children, asset_ids, menu_name, menu_id, issues);
            }
            _ => {}
        }
    }
}

pub(super) fn validate_button_video_usage(
    menu: &Menu,
    background_mode: BackgroundMode,
    asset_map: &HashMap<&str, &Asset>,
    issues: &mut Vec<ValidationIssue>,
) {
    for button in &menu.buttons {
        if let Some(asset_id) = button.video_asset_id.as_deref() {
            if matches!(background_mode, BackgroundMode::Still) {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.button-video-ignored-on-still-menu".to_string(),
                    message: format!(
                        "Button \"{}\" in menu \"{}\" has a video asset, but button video is ignored while the menu is authored as still.",
                        button.label, menu.name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Switch the menu to motion mode or clear the button video assignment."
                            .to_string(),
                    ),
                });
            }

            if let Some(asset) = asset_map.get(asset_id) {
                if asset.video_streams.is_empty() {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.button-video-no-stream".to_string(),
                        message: format!(
                            "Button \"{}\" in menu \"{}\" uses a video asset that has no video stream.",
                            button.label, menu.name
                        ),
                        context: Some(menu.id.clone()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu.name.clone()),
                        suggested_fix: Some(
                            "Choose an asset with a video stream for the button video."
                                .to_string(),
                        ),
                    });
                }
            }
        }
    }
}

pub(super) fn validate_motion_keyframes(
    doc: &MenuDocument,
    menu: &Menu,
    motion_duration_secs: Option<f64>,
    issues: &mut Vec<ValidationIssue>,
) {
    if !matches!(doc.background_mode, BackgroundMode::Motion) {
        return;
    }

    let Some(loop_duration_secs) = motion_duration_secs else {
        return;
    };

    for node in &doc.scene.nodes {
        validate_motion_keyframes_in_node(node, menu, loop_duration_secs, issues);
    }
}

fn validate_motion_keyframes_in_node(
    node: &SceneNode,
    menu: &Menu,
    loop_duration_secs: f64,
    issues: &mut Vec<ValidationIssue>,
) {
    match node {
        SceneNode::Button {
            id: _,
            label,
            highlight_mode: HighlightMode::Animated,
            highlight_keyframes,
            ..
        } => {
            let mut previous_timestamp = None;
            for keyframe in highlight_keyframes {
                if !(0.0..=loop_duration_secs).contains(&keyframe.timestamp_secs) {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.motion-keyframe-out-of-range".to_string(),
                        message: format!(
                            "Animated highlight keyframe for button \"{}\" in menu \"{}\" falls outside the motion loop ({} s).",
                            label, menu.name, loop_duration_secs
                        ),
                        context: Some(menu.id.clone()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu.name.clone()),
                        suggested_fix: Some(
                            "Move the keyframe inside the authored motion loop duration."
                                .to_string(),
                        ),
                    });
                }

                if previous_timestamp.is_some_and(|previous| keyframe.timestamp_secs < previous) {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.motion-keyframes-out-of-order".to_string(),
                        message: format!(
                            "Animated highlight keyframes for button \"{}\" in menu \"{}\" are not in chronological order.",
                            label, menu.name
                        ),
                        context: Some(menu.id.clone()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu.name.clone()),
                        suggested_fix: Some(
                            "Sort the keyframes by timestamp so the motion loop can be interpreted deterministically."
                                .to_string(),
                        ),
                    });
                    break;
                }

                previous_timestamp = Some(keyframe.timestamp_secs);
            }

            if highlight_keyframes.is_empty() {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.motion-animated-button-no-keyframes".to_string(),
                    message: format!(
                        "Button \"{}\" in menu \"{}\" is marked animated, but it has no highlight keyframes yet.",
                        label, menu.name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Add at least one highlight keyframe or switch the button back to static highlights."
                            .to_string(),
                    ),
                });
            }
        }
        SceneNode::Group { children, .. } => {
            for child in children {
                validate_motion_keyframes_in_node(child, menu, loop_duration_secs, issues);
            }
        }
        _ => {}
    }
}
