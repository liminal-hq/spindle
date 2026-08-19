// Lowering `AnimationTrack` highlight keyframes into the per-keyframe
// overlay-image DCSQ schedule for a motion menu (design decision D8, see
// docs/dcsq-player-compat.md's Decision section).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::Path;

use crate::models::*;

use super::super::menu::AuthorableMenuRef;
use super::super::types::OverlayKeyframeSpec;
use super::super::util::sanitise_filename;
use super::paths::MenuPaths;

/// Build the overlay-keyframe schedule for a menu's `RenderMenu`/
/// `ComposeMenuHighlights` jobs.
///
/// Always returns at least one entry. A menu with no `HighlightColour`/
/// `HighlightOpacity`/`ActivateColour`/`ActivateOpacity` tracks targeting
/// one of its buttons gets a single trivial frame that reuses today's
/// `{base}_highlight.png`/`_select.png` paths and the menu's default
/// highlight/select colours — the "no tracks" case
/// `docs/dcsq-player-compat.md` requires to stay byte-identical to a build
/// with no animation support at all.
///
/// Still menus can't host a looping schedule on any spec-compliant player
/// (a still menu's video decode freezes after its first second and never
/// resumes — see `docs/dcsq-player-compat.md`'s still-vs-motion timing
/// analysis), so a still menu with tracks degrades to a single frame baking
/// in only each track's *first* keyframe. `menu.animation-on-still-menu`
/// (validation) names this degrade; the build proceeds regardless (D8's
/// "the feature never blocks a build").
///
/// DVD's subpicture model has exactly one highlight colour for the whole
/// menu (one 4-colour CLUT, not one per button — `menu_ref.highlight_colours()`
/// is menu-scoped), so when more than one button carries a relevant track,
/// this samples every track at each schedule instant and lets the
/// *last*-listed track in `doc.animation` win ties. In practice a menu
/// authors at most one animated highlight track, so this rarely matters.
pub(super) fn build_overlay_keyframe_schedule(
    menu_ref: &AuthorableMenuRef<'_>,
    motion_loop_duration_secs: Option<f64>,
    standard: VideoStandard,
    menus_dir: &Path,
    menu_paths: &MenuPaths,
) -> Vec<OverlayKeyframeSpec> {
    let doc = menu_ref.menu.doc();
    let highlight_colours = &doc.highlight_colours;
    let default_select_colour = highlight_colours.activate_colour.clone();

    let trivial_frame = || OverlayKeyframeSpec {
        start_secs: 0.0,
        end_secs: 0.0,
        highlight_image_path: menu_paths.highlight_image_path.display().to_string(),
        select_image_path: menu_paths.select_image_path.display().to_string(),
        highlight_colour: highlight_colours.select_colour.clone(),
        select_colour: default_select_colour.clone(),
    };

    let button_ids: std::collections::HashSet<&str> =
        menu_ref.buttons().iter().map(|b| b.id).collect();

    let is_relevant =
        |track: &&AnimationTrack, colour: AnimatableProperty, opacity: AnimatableProperty| {
            (track.target == colour || track.target == opacity)
                && !track.keyframes.is_empty()
                && button_ids.contains(track.node_id.as_str())
        };
    let relevant_highlight_tracks: Vec<&AnimationTrack> = doc
        .animation
        .iter()
        .filter(|track| {
            is_relevant(
                track,
                AnimatableProperty::HighlightColour,
                AnimatableProperty::HighlightOpacity,
            )
        })
        .collect();
    // DVD naming quirk: spumux's "select" colour is the *activated* state
    // (flashed on button press), driven by `ActivateColour`/`ActivateOpacity`
    // tracks — not to be confused with `HighlightColour`, which drives
    // spumux's "highlight" (selected/focused) colour above.
    let relevant_select_tracks: Vec<&AnimationTrack> = doc
        .animation
        .iter()
        .filter(|track| {
            is_relevant(
                track,
                AnimatableProperty::ActivateColour,
                AnimatableProperty::ActivateOpacity,
            )
        })
        .collect();

    if relevant_highlight_tracks.is_empty() && relevant_select_tracks.is_empty() {
        return vec![trivial_frame()];
    }

    if !matches!(menu_ref.background_mode(), BackgroundMode::Motion) {
        let highlight_colour = effective_colour_hex(
            &relevant_highlight_tracks,
            AnimatableProperty::HighlightColour,
            AnimatableProperty::HighlightOpacity,
            &highlight_colours.select_colour,
            highlight_colours.select_opacity,
            |track| track.keyframes.first().map(|kf| kf.value.clone()),
        );
        let select_colour = effective_colour_hex(
            &relevant_select_tracks,
            AnimatableProperty::ActivateColour,
            AnimatableProperty::ActivateOpacity,
            &highlight_colours.activate_colour,
            highlight_colours.activate_opacity,
            |track| track.keyframes.first().map(|kf| kf.value.clone()),
        );
        return vec![OverlayKeyframeSpec {
            start_secs: 0.0,
            end_secs: 0.0,
            highlight_image_path: menu_paths.highlight_image_path.display().to_string(),
            select_image_path: menu_paths.select_image_path.display().to_string(),
            highlight_colour,
            select_colour,
        }];
    }

    let Some(loop_duration_secs) = motion_loop_duration_secs.filter(|secs| *secs > 0.0) else {
        return vec![trivial_frame()];
    };

    // Union of every relevant track's keyframe timestamps (highlight and
    // select alike — either kind of track can drive a schedule instant),
    // clamped inside the loop window, sorted, deduped, always including 0.0.
    let mut timestamps: Vec<f64> = std::iter::once(0.0)
        .chain(
            relevant_highlight_tracks
                .iter()
                .chain(relevant_select_tracks.iter())
                .flat_map(|track| {
                    track
                        .keyframes
                        .iter()
                        .map(|kf| kf.timestamp_secs.clamp(0.0, loop_duration_secs))
                }),
        )
        .collect();
    timestamps.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    timestamps.dedup_by(|a, b| (*a - *b).abs() < 1e-9);

    // Defensive clamp so the last frame's `end` never lands past the last
    // presentable frame of the loop (spumux `end` past the last PTS is
    // undefined — see the design's risk list).
    let frame_duration_secs = 1.0 / standard.frame_rate();
    let last_frame_end = (loop_duration_secs - frame_duration_secs).max(0.0);

    let base_name = sanitise_filename(&menu_ref.menu.id);
    let mut frames = Vec::with_capacity(timestamps.len());
    for (index, &start_secs) in timestamps.iter().enumerate() {
        let end_secs = match timestamps.get(index + 1) {
            Some(&next) => next,
            None => last_frame_end.max(start_secs),
        };
        let highlight_colour = effective_colour_hex(
            &relevant_highlight_tracks,
            AnimatableProperty::HighlightColour,
            AnimatableProperty::HighlightOpacity,
            &highlight_colours.select_colour,
            highlight_colours.select_opacity,
            |track| evaluate_track(track, start_secs),
        );
        let select_colour = effective_colour_hex(
            &relevant_select_tracks,
            AnimatableProperty::ActivateColour,
            AnimatableProperty::ActivateOpacity,
            &highlight_colours.activate_colour,
            highlight_colours.activate_opacity,
            |track| evaluate_track(track, start_secs),
        );
        frames.push(OverlayKeyframeSpec {
            start_secs,
            end_secs,
            highlight_image_path: menus_dir
                .join(format!("{base_name}_hl_k{index}.png"))
                .display()
                .to_string(),
            select_image_path: menus_dir
                .join(format!("{base_name}_sel_k{index}.png"))
                .display()
                .to_string(),
            highlight_colour,
            select_colour,
        });
    }
    frames
}

/// Sample every relevant track with `sample`, folding the `colour_target`/
/// `opacity_target` results onto `default_colour`/`default_opacity`, then
/// bake the resulting opacity into the alpha channel. Tracks are applied in
/// `doc.animation` order, so a later track overrides an earlier one when
/// both resolve a value (see this module's doc comment on the
/// one-CLUT-per-menu tie-break policy). Shared by the "highlight" (selected
/// state, `HighlightColour`/`HighlightOpacity`) and "select" (activated
/// state, `ActivateColour`/`ActivateOpacity`) samplings in
/// [`build_overlay_keyframe_schedule`] — same fold, different targets and
/// defaults.
fn effective_colour_hex<F>(
    tracks: &[&AnimationTrack],
    colour_target: AnimatableProperty,
    opacity_target: AnimatableProperty,
    default_colour: &str,
    default_opacity: f64,
    sample: F,
) -> String
where
    F: Fn(&AnimationTrack) -> Option<KeyValue>,
{
    let mut hex = strip_alpha(default_colour);
    let mut opacity = default_opacity;
    for track in tracks {
        let Some(value) = sample(track) else {
            continue;
        };
        match value {
            KeyValue::Colour { hex: sampled } if track.target == colour_target => {
                hex = strip_alpha(&sampled);
            }
            KeyValue::Scalar { value: sampled } if track.target == opacity_target => {
                opacity = sampled;
            }
            _ => {}
        }
    }
    bake_opacity_into_alpha(&hex, opacity)
}

/// Drop any existing alpha digits from a `#rrggbb`/`#rrggbbaa` hex string —
/// opacity is baked back in separately by [`bake_opacity_into_alpha`].
fn strip_alpha(hex: &str) -> String {
    let stripped = hex.trim_start_matches('#');
    if stripped.len() >= 6 {
        format!("#{}", &stripped[0..6])
    } else {
        hex.to_string()
    }
}

/// Append an alpha channel derived from `opacity` (0.0-1.0) to a `#rrggbb`
/// hex colour, producing `#rrggbbaa`.
fn bake_opacity_into_alpha(hex6: &str, opacity: f64) -> String {
    let stripped = hex6.trim_start_matches('#');
    let alpha = (opacity.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{stripped}{alpha:02x}")
}
