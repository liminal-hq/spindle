// Authored scene-graph validation: dangling asset references, button-video usage,
// and animated highlight keyframe checks.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::{HashMap, HashSet};

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
    for button in menu.doc().buttons() {
        if let Some(asset_id) = button.video_asset_id {
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

/// Validate `doc.animation` (the [`AnimationTrack`] model — see design
/// decision D8's validation repoint, `docs/dcsq-player-compat.md`). Replaces
/// the pre-lift `validate_motion_keyframes`, which read the legacy
/// per-button `highlight_keyframes`; `lift_highlight_keyframes` runs before
/// validation (`SpindleProjectFile::migrate_all_menus`), so tracks are the
/// only place animation is authored by the time this runs.
pub(super) fn validate_animation_tracks(
    doc: &MenuDocument,
    menu: &Menu,
    motion_duration_secs: Option<f64>,
    family: DiscFamily,
    issues: &mut Vec<ValidationIssue>,
) {
    if doc.animation.is_empty() {
        return;
    }

    let node_ids = scene_node_ids(&doc.scene.nodes);
    let is_motion = matches!(doc.background_mode, BackgroundMode::Motion);

    for track in &doc.animation {
        let node_exists = node_ids.contains(track.node_id.as_str());

        if !node_exists {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                code: "menu.animation-node-missing".to_string(),
                message: format!(
                    "Menu \"{}\" has an animation track for node \"{}\", which no longer exists in the scene.",
                    menu.name, track.node_id
                ),
                context: Some(menu.id.clone()),
                entity_type: Some("menu".to_string()),
                entity_name: Some(menu.name.clone()),
                suggested_fix: Some(
                    "Delete the orphaned animation track, or restore the node it targets."
                        .to_string(),
                ),
            });
        }

        if track.keyframes.is_empty() {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Warning,
                code: "menu.animation-empty-track".to_string(),
                message: format!(
                    "Menu \"{}\" has an animation track for node \"{}\" with no keyframes yet.",
                    menu.name, track.node_id
                ),
                context: Some(menu.id.clone()),
                entity_type: Some("menu".to_string()),
                entity_name: Some(menu.name.clone()),
                suggested_fix: Some(
                    "Add at least one keyframe, or delete the empty track.".to_string(),
                ),
            });
            continue;
        }

        if family == DiscFamily::DvdVideo
            && matches!(
                track.target,
                AnimatableProperty::Opacity | AnimatableProperty::Position
            )
        {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Warning,
                code: "menu.animation-unsupported-property".to_string(),
                message: format!(
                    "Menu \"{}\" animates {:?} on node \"{}\", which DVD-Video's subpicture overlay model cannot express — only highlight colour/opacity are lowered to the disc.",
                    menu.name, track.target, track.node_id
                ),
                context: Some(menu.id.clone()),
                entity_type: Some("menu".to_string()),
                entity_name: Some(menu.name.clone()),
                suggested_fix: Some(
                    "Remove this track, or accept that it has no effect on a DVD-Video build."
                        .to_string(),
                ),
            });
        }

        if node_exists && !is_motion {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                code: "menu.animation-on-still-menu".to_string(),
                message: format!(
                    "Menu \"{}\" has an animation track for node \"{}\", but the menu is authored as still — a still menu's video decode freezes after its first frame and can never reach a later keyframe. The build will degrade this to a single static overlay using only the track's first keyframe.",
                    menu.name, track.node_id
                ),
                context: Some(menu.id.clone()),
                entity_type: Some("menu".to_string()),
                entity_name: Some(menu.name.clone()),
                suggested_fix: Some(
                    "Switch the menu to motion mode, or delete the animation track."
                        .to_string(),
                ),
            });
            continue;
        }

        let Some(loop_duration_secs) = is_motion.then_some(motion_duration_secs).flatten() else {
            continue;
        };

        let mut previous_timestamp = None;
        for keyframe in &track.keyframes {
            if !(0.0..=loop_duration_secs).contains(&keyframe.timestamp_secs) {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    code: "menu.motion-keyframe-out-of-range".to_string(),
                    message: format!(
                        "Animation keyframe for node \"{}\" in menu \"{}\" falls outside the motion loop ({loop_duration_secs} s).",
                        track.node_id, menu.name
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
                        "Animation keyframes for node \"{}\" in menu \"{}\" are not in chronological order.",
                        track.node_id, menu.name
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
    }

    if let Some(loop_duration_secs) = is_motion.then_some(motion_duration_secs).flatten() {
        if loop_duration_secs > 0.0 {
            let relevant_tracks: Vec<&AnimationTrack> = doc
                .animation
                .iter()
                .filter(|track| {
                    matches!(
                        track.target,
                        AnimatableProperty::HighlightColour | AnimatableProperty::HighlightOpacity
                    ) && !track.keyframes.is_empty()
                })
                .collect();
            let frame_count = overlay_schedule_frame_count(&relevant_tracks, loop_duration_secs);
            let frames_per_sec = frame_count as f64 / loop_duration_secs;
            if frames_per_sec > 1.0 {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.animation-keyframe-density".to_string(),
                    message: format!(
                        "Menu \"{}\"'s animated highlight schedule samples {frame_count} overlay frames over a {loop_duration_secs:.2}s loop (~{frames_per_sec:.2}/s) — each frame is a full re-rendered subpicture image, and denser schedules risk exceeding the ~3.36 Mbit/s subpicture bitrate budget.",
                        menu.name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Reduce the number of keyframes, or spread them further apart in time."
                            .to_string(),
                    ),
                });
            }
        }
    }
}

/// The overlay-schedule frame count the DCSQ lowering (`build/planner`)
/// would produce for these tracks — the union of every keyframe timestamp,
/// clamped to the loop window, deduped. Kept in sync with (but intentionally
/// not shared code with) `build::planner::animation`'s scheduler: `build`
/// and `validation` are sibling modules and validation doesn't depend on
/// the build pipeline.
fn overlay_schedule_frame_count(tracks: &[&AnimationTrack], loop_duration_secs: f64) -> usize {
    let mut timestamps: Vec<f64> = std::iter::once(0.0)
        .chain(tracks.iter().flat_map(|track| {
            track
                .keyframes
                .iter()
                .map(|kf| kf.timestamp_secs.clamp(0.0, loop_duration_secs))
        }))
        .collect();
    timestamps.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    timestamps.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
    timestamps.len()
}

/// Recursively collect every scene node's `id`, including nested `Group`
/// children — used to check whether an `AnimationTrack.node_id` still
/// resolves to something in the scene.
fn scene_node_ids(nodes: &[SceneNode]) -> HashSet<&str> {
    let mut ids = HashSet::new();
    collect_scene_node_ids(nodes, &mut ids);
    ids
}

fn collect_scene_node_ids<'a>(nodes: &'a [SceneNode], ids: &mut HashSet<&'a str>) {
    for node in nodes {
        match node {
            SceneNode::Group { id, children, .. } => {
                ids.insert(id.as_str());
                collect_scene_node_ids(children, ids);
            }
            SceneNode::Text { id, .. }
            | SceneNode::Image { id, .. }
            | SceneNode::Shape { id, .. }
            | SceneNode::Video { id, .. }
            | SceneNode::Button { id, .. }
            | SceneNode::ComponentInstance { id, .. }
            | SceneNode::GeneratedCollection { id, .. } => {
                ids.insert(id.as_str());
            }
        }
    }
}
