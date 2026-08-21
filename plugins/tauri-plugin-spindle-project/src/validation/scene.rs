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

    // `MenuDocument::buttons()` — the build pipeline's "what counts as a
    // button" — only walks top-level `scene.nodes`; recursive `Group`
    // flattening is deferred to a later PR (see that fn's doc comment). A
    // track can validate clean against `node_ids` (which does recurse) while
    // targeting a button the build never emits spumux rects for at all, so
    // that's checked separately below.
    let top_level_button_ids: HashSet<&str> = doc.buttons().iter().map(|b| b.id).collect();
    let all_button_ids = collect_button_node_ids(&doc.scene.nodes);

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

        // Highlight/activate-state properties only ever affect a compiled
        // top-level button — the planner requires `button_ids.contains(...)`
        // (see `build/planner/animation.rs`) and silently drops any track
        // that doesn't resolve to one. That covers two distinct authoring
        // mistakes: a button nested inside a group (not yet flattened to the
        // disc — `all_button_ids` catches it as a button that exists but
        // isn't top-level), and a track that targets a non-button node
        // entirely (text/image/shape/group), which was previously invisible
        // to this check because it only ever looked at `all_button_ids`.
        let is_highlight_or_activate_property = matches!(
            track.target,
            AnimatableProperty::HighlightColour
                | AnimatableProperty::HighlightOpacity
                | AnimatableProperty::ActivateColour
                | AnimatableProperty::ActivateOpacity
        );
        if node_exists
            && is_highlight_or_activate_property
            && !top_level_button_ids.contains(track.node_id.as_str())
        {
            let is_nested_button = all_button_ids.contains(track.node_id.as_str());
            let message = if is_nested_button {
                format!(
                    "Menu \"{}\" has an animation track for button \"{}\", which is nested inside a group. Grouped buttons aren't compiled to the disc yet, so this track will not have any effect on the build.",
                    menu.name, track.node_id
                )
            } else {
                format!(
                    "Menu \"{}\" has a {:?} animation track targeting \"{}\", which is not a button. Highlight/activate-state properties only ever affect a compiled button, so this track will not have any effect on the build.",
                    menu.name, track.target, track.node_id
                )
            };
            let suggested_fix = if is_nested_button {
                "Move the button out of the group, or delete the animation track until group flattening ships."
            } else {
                "Target a compiled top-level button with this track, or delete it."
            };
            issues.push(ValidationIssue {
                severity: IssueSeverity::Warning,
                code: "menu.animation-node-not-compiled".to_string(),
                message,
                context: Some(menu.id.clone()),
                entity_type: Some("menu".to_string()),
                entity_name: Some(menu.name.clone()),
                suggested_fix: Some(suggested_fix.to_string()),
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

        for keyframe in &track.keyframes {
            if !keyframe.timestamp_secs.is_finite() {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    code: "menu.animation-keyframe-invalid".to_string(),
                    message: format!(
                        "Menu \"{}\" has an animation keyframe for node \"{}\" with a non-finite timestamp ({}).",
                        menu.name, track.node_id, keyframe.timestamp_secs
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Set the keyframe's timestamp to a finite number of seconds.".to_string(),
                    ),
                });
            }
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

        // DVD lowering (`build/planner/animation.rs`) samples a highlight/
        // activate track only at its own keyframe timestamps and holds each
        // sampled value until the next `<spu>` — it never interpolates. The
        // editor's evaluator (`models/animation.rs::evaluate_track`), by
        // contrast, honours each keyframe's `easing` and smoothly
        // interpolates between neighbouring keyframes by default (`Linear`).
        // Any easing other than `Hold` on a segment that actually gets
        // lowered therefore makes the DVD preview and the authored disc
        // silently disagree: the preview eases, the disc steps. Only a
        // keyframe that starts a segment (i.e. not the track's last one) can
        // cause this — the last keyframe's own `easing` has no following
        // segment to apply to.
        if family == DiscFamily::DvdVideo
            && is_motion
            && matches!(
                track.target,
                AnimatableProperty::HighlightColour
                    | AnimatableProperty::HighlightOpacity
                    | AnimatableProperty::ActivateColour
                    | AnimatableProperty::ActivateOpacity
            )
            && track
                .keyframes
                .split_last()
                .is_some_and(|(_, leading)| leading.iter().any(|kf| kf.easing != Easing::Hold))
        {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Warning,
                code: "menu.animation-easing-quantised".to_string(),
                message: format!(
                    "Menu \"{}\"'s animation track for node \"{}\" uses an easing curve other than \"Hold\". The editor preview interpolates smoothly between keyframes, but DVD-Video's subpicture overlay can only swap to a new image at each keyframe — the disc will step instantly instead of easing.",
                    menu.name, track.node_id
                ),
                context: Some(menu.id.clone()),
                entity_type: Some("menu".to_string()),
                entity_name: Some(menu.name.clone()),
                suggested_fix: Some(
                    "Set the track's keyframes to \"Hold\" easing so the preview matches what the disc will actually show."
                        .to_string(),
                ),
            });
        }

        if node_exists && !is_motion {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Warning,
                code: "menu.animation-on-still-menu".to_string(),
                message: format!(
                    "Menu \"{}\" has an animation track for node \"{}\", but the menu is authored as still — a still menu's video decode freezes after its first frame and can never reach a later keyframe. The menu degrades to a static overlay using only the track's first keyframe; the build proceeds.",
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
            // Union of both groups the DCSQ lowering samples together —
            // `build/planner/animation.rs`'s `build_overlay_keyframe_schedule`
            // unions highlight *and* activate tracks into one shared
            // per-menu instant schedule, so a menu that only animates
            // ActivateColour/ActivateOpacity can still produce an arbitrarily
            // dense multi-SPU schedule; counting only HighlightColour/
            // HighlightOpacity here would miss that entirely.
            let relevant_highlight_tracks: Vec<&AnimationTrack> = doc
                .animation
                .iter()
                .filter(|track| {
                    matches!(
                        track.target,
                        AnimatableProperty::HighlightColour | AnimatableProperty::HighlightOpacity
                    ) && !track.keyframes.is_empty()
                })
                .collect();
            let relevant_activate_tracks: Vec<&AnimationTrack> = doc
                .animation
                .iter()
                .filter(|track| {
                    matches!(
                        track.target,
                        AnimatableProperty::ActivateColour | AnimatableProperty::ActivateOpacity
                    ) && !track.keyframes.is_empty()
                })
                .collect();
            let relevant_tracks: Vec<&AnimationTrack> = relevant_highlight_tracks
                .iter()
                .chain(relevant_activate_tracks.iter())
                .copied()
                .collect();
            let frame_count = overlay_schedule_frame_count(&relevant_tracks, loop_duration_secs);
            let frames_per_sec = frame_count as f64 / loop_duration_secs;
            if frames_per_sec > 1.0 {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.animation-keyframe-density".to_string(),
                    message: format!(
                        "Menu \"{}\"'s animated highlight/activate schedule samples {frame_count} overlay frames over a {loop_duration_secs:.2}s loop (~{frames_per_sec:.2}/s) — each frame is a full re-rendered subpicture image, and denser schedules risk exceeding the ~3.36 Mbit/s subpicture bitrate budget.",
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

            if family == DiscFamily::DvdVideo {
                validate_animation_palette_budget(
                    menu,
                    &relevant_highlight_tracks,
                    &relevant_activate_tracks,
                    issues,
                );
            }
        }
    }
}

/// The number of palette entries DVD-Video's subpicture overlay always
/// reserves regardless of animation: the transparent background entry, and
/// the button-outline "stroke" colour every rendered overlay carries
/// (`build/skia/overlay.rs`). This is a conservative floor, not a precise
/// count — the real budget also depends on the menu's base (unanimated)
/// highlight/select colours, which are already included in the sampled sets
/// below whenever a track exists, or otherwise stay fixed across the whole
/// schedule.
const RESERVED_PALETTE_ENTRIES: usize = 2;

/// The palette every subpicture stream in one PGC must share has exactly 16
/// entries (`docs/motion-menus.md`'s DCSQ CLUT constraint section). Warn
/// when the distinct colours sampled across a menu's *whole* animated
/// schedule — both the highlight (selected-state) and activate
/// (activated-state) groups — plus the reserved entries above, would exceed
/// it. This is deliberately conservative: it counts every distinct
/// `#rrggbb` value reachable by any keyframe on a relevant track, not just
/// the values that end up adjacent in the same schedule instant, so it can
/// over-warn but should never under-warn.
fn validate_animation_palette_budget(
    menu: &Menu,
    relevant_highlight_tracks: &[&AnimationTrack],
    relevant_activate_tracks: &[&AnimationTrack],
    issues: &mut Vec<ValidationIssue>,
) {
    let mut distinct_colours: HashSet<String> = HashSet::new();
    for track in relevant_highlight_tracks
        .iter()
        .chain(relevant_activate_tracks.iter())
    {
        if !matches!(
            track.target,
            AnimatableProperty::HighlightColour | AnimatableProperty::ActivateColour
        ) {
            continue;
        }
        for keyframe in &track.keyframes {
            if let KeyValue::Colour { hex } = &keyframe.value {
                distinct_colours.insert(normalise_hex_rgb(hex));
            }
        }
    }

    let budget_used = RESERVED_PALETTE_ENTRIES + distinct_colours.len();
    if budget_used > 16 {
        issues.push(ValidationIssue {
            severity: IssueSeverity::Warning,
            code: "menu.animation-palette-exhausted".to_string(),
            message: format!(
                "Menu \"{}\"'s animated highlight/activate schedule samples {} distinct colours. Together with the {RESERVED_PALETTE_ENTRIES} entries DVD-Video's subpicture overlay always reserves (transparent background, button-outline stroke), that needs {budget_used} palette entries — more than the 16-entry CLUT every subpicture stream in a PGC must share. This is a conservative estimate: it counts colours that could appear anywhere in the schedule, not just ones that must coexist.",
                menu.name,
                distinct_colours.len()
            ),
            context: Some(menu.id.clone()),
            entity_type: Some("menu".to_string()),
            entity_name: Some(menu.name.clone()),
            suggested_fix: Some(
                "Reduce the number of distinct colours used across the animated tracks."
                    .to_string(),
            ),
        });
    }
}

/// Normalise a `#rrggbb`/`#rrggbbaa` hex colour to a lower-case `rrggbb` key
/// for palette-entry deduplication — opacity doesn't consume a separate CLUT
/// slot on DVD-Video (it's carried per-pixel-type contrast, not the palette
/// itself), so two keyframes differing only in alpha must count as one
/// colour.
fn normalise_hex_rgb(hex: &str) -> String {
    let stripped = hex.trim_start_matches('#');
    let rgb = if stripped.len() >= 6 {
        &stripped[0..6]
    } else {
        stripped
    };
    rgb.to_lowercase()
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

/// Recursively collect the `id` of every `Button` node at any depth
/// (including nested inside `Group`s) — the full set of "is this id a
/// button at all", contrasted with [`MenuDocument::buttons`]'s top-level-only
/// "is this id a button the build actually compiles". The difference
/// between the two is exactly a group-nested button.
fn collect_button_node_ids(nodes: &[SceneNode]) -> HashSet<&str> {
    let mut ids = HashSet::new();
    collect_button_node_ids_into(nodes, &mut ids);
    ids
}

fn collect_button_node_ids_into<'a>(nodes: &'a [SceneNode], ids: &mut HashSet<&'a str>) {
    for node in nodes {
        match node {
            SceneNode::Group { children, .. } => {
                collect_button_node_ids_into(children, ids);
            }
            SceneNode::Button { id, .. } => {
                ids.insert(id.as_str());
            }
            _ => {}
        }
    }
}
