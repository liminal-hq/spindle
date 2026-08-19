// Small shared helpers for the timeline UI and its preview-sampling call
// sites in SceneCanvas: honest-preview quantization and KeyValue<->CSS
// conversions.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

// Kept separate from `utils/animation.ts` (the Rust evaluator twin, pinned
// to the shared parity fixture) since none of this is part of that parity
// contract.

import type { AnimatableProperty, AnimationTrack, KeyValue } from '../../../types/project';
import { evaluateTrack } from '../../../utils/animation';

/**
 * The last timestamp a frame can actually start displaying at before
 * playback wraps back to `0` — mirrors
 * `build/planner/animation.rs::build_overlay_keyframe_schedule`'s
 * `last_presentable_secs = (loop_duration_secs - frame_duration_secs).max(0.0)`,
 * where `frame_duration_secs = 1 / standard.frame_rate()`. A keyframe
 * authored at or past this (including exactly at `loopDurationSecs`) is
 * pulled back to it, the same way the planner's clamp does, rather than to
 * the unreachable wrap instant `loopDurationSecs` itself.
 */
function lastPresentableSecs(loopDurationSecs: number, fps: number): number {
	const frameDurationSecs = fps > 0 ? 1 / fps : 0;
	return Math.max(loopDurationSecs - frameDurationSecs, 0);
}

/**
 * The DCSQ frame-schedule boundary (start instant) containing `tSecs`:
 * the last timestamp at-or-before `tSecs` in the UNION of every track in
 * `relevantTracks`' own keyframe timestamps (each clamped into
 * `[0, lastPresentableSecs]`, always including 0.0) — mirrors
 * `build/planner/animation.rs::build_overlay_keyframe_schedule`'s
 * `timestamps` union, which combines every highlight/select-relevant
 * track's keyframes (across every button) into ONE shared frame schedule,
 * since a DVD menu bakes both states into one subpicture image per
 * schedule instant. Clamping to {@link lastPresentableSecs} rather than
 * `loopDurationSecs` matters: a keyframe at exactly `loopDurationSecs`
 * would otherwise add a boundary at an instant playback never actually
 * reaches (it wraps to `0` first), making that keyframe show on the
 * compiled disc but never in this preview.
 */
function scheduleBoundarySecs(
	relevantTracks: AnimationTrack[],
	tSecs: number,
	loopDurationSecs: number,
	fps: number,
): number {
	const maxSecs = lastPresentableSecs(loopDurationSecs, fps);
	const timestamps = new Set<number>([0]);
	for (const track of relevantTracks) {
		for (const kf of track.keyframes) {
			timestamps.add(Math.min(Math.max(kf.timestampSecs, 0), maxSecs));
		}
	}
	let boundary = 0;
	for (const ts of [...timestamps].sort((a, b) => a - b)) {
		if (ts <= tSecs) {
			boundary = ts;
		} else {
			break;
		}
	}
	return boundary;
}

export interface FoldedTrackValue {
	hex: string;
	opacity: number;
}

/**
 * Fold every track in `tracks` (all of them relevant to ONE state group —
 * e.g. every button's `highlight-colour`/`highlight-opacity` tracks, or
 * every button's `activate-colour`/`activate-opacity` tracks) into a
 * single (hex, opacity) pair the way `effective_colour_hex` does: sample
 * each track with `sample`, letting the LAST track in `tracks` (document
 * order) that resolves a value win — independently for colour vs.
 * opacity — since DVD's subpicture model bakes one CLUT entry per
 * schedule instant for the whole menu, not one per button. Falls back to
 * `defaultHex`/`defaultOpacity` when nothing in `tracks` resolves that
 * property.
 */
function foldRelevantTracks(
	tracks: AnimationTrack[],
	colourTarget: AnimatableProperty,
	opacityTarget: AnimatableProperty,
	defaultHex: string,
	defaultOpacity: number,
	sample: (track: AnimationTrack) => KeyValue | null,
): FoldedTrackValue {
	let hex = defaultHex;
	let opacity = defaultOpacity;
	for (const track of tracks) {
		const value = sample(track);
		if (!value) continue;
		if (value.kind === 'colour' && track.target === colourTarget) {
			hex = value.hex;
		} else if (value.kind === 'scalar' && track.target === opacityTarget) {
			opacity = value.value;
		}
	}
	return { hex, opacity };
}

/**
 * Honest-preview sampling for one state group (highlight or activate),
 * folded menu-wide the way the compiled disc's single CLUT actually
 * would show it, instead of each button showing its own track's value.
 * Mirrors `build_overlay_keyframe_schedule`'s per-frame
 * `effective_colour_hex` call: `groupTracks` (every button's relevant
 * track for this group) is folded at the schedule boundary found from
 * `schedulingTracks`, which must be the COMPLETE union of highlight AND
 * activate relevant tracks (see {@link scheduleBoundarySecs}) — a
 * keyframe in either group can force a new schedule instant that both
 * states are re-sampled at.
 */
export function sampleHonestFold(
	groupTracks: AnimationTrack[],
	schedulingTracks: AnimationTrack[],
	colourTarget: AnimatableProperty,
	opacityTarget: AnimatableProperty,
	defaultHex: string,
	defaultOpacity: number,
	tSecs: number,
	loopDurationSecs: number,
	fps: number,
): FoldedTrackValue {
	const boundarySecs = scheduleBoundarySecs(schedulingTracks, tSecs, loopDurationSecs, fps);
	return foldRelevantTracks(
		groupTracks,
		colourTarget,
		opacityTarget,
		defaultHex,
		defaultOpacity,
		(track) => evaluateTrack(track, boundarySecs),
	);
}

/**
 * Sample `track` the way the compiled disc's DCSQ schedule actually plays
 * it back. The disc doesn't quantize each track independently: every
 * track in `relevantTracks` (e.g. a node's `highlight-colour` +
 * `highlight-opacity` pair, or its `activate-colour` + `activate-opacity`
 * pair — see `build_overlay_keyframe_schedule`'s "relevant" track groups)
 * shares ONE frame schedule at the union of their keyframe timestamps;
 * within a frame the disc shows a value baked at the *frame's start
 * instant* by evaluating each track's own eased curve there (mirrors
 * `effective_colour_hex`'s `evaluate_track(track, start_secs)` call) — not
 * a same-track-only "hold to the last keyframe at-or-before `tSecs`". A
 * track can appear to jump value between two of its own keyframes purely
 * because a *sibling* track in `relevantTracks` added a schedule boundary
 * between them. `track` itself does not need to be a member of
 * `relevantTracks` (though in practice it always is). Returns `null` for
 * an empty `track`.
 */
export function sampleHonestPreview(
	relevantTracks: AnimationTrack[],
	track: AnimationTrack,
	tSecs: number,
	loopDurationSecs: number,
	fps: number,
): KeyValue | null {
	if (track.keyframes.length === 0) return null;
	const boundarySecs = scheduleBoundarySecs(relevantTracks, tSecs, loopDurationSecs, fps);
	return evaluateTrack(track, boundarySecs);
}

/**
 * Sample `track` for the navigation preview, mirroring the compiled disc's
 * actual behaviour for both a still and a motion menu:
 *
 * - Still menu (`isMotion` false): the disc can't host a schedule at all
 *   (see `build_overlay_keyframe_schedule`'s doc comment on the
 *   still-menu degrade path), so it bakes in only the track's *first*
 *   keyframe — this ignores `tSecs` entirely, matching the disc showing a
 *   single static frame regardless of preview playhead position.
 * - Motion menu: the full eased curve (`evaluateTrack`) when
 *   `honestPreview` is off — a friendlier, continuous preview than the
 *   disc actually produces — or the quantized {@link sampleHonestPreview}
 *   when it's on.
 *
 * Returns `null` when `track` is `undefined`/empty.
 */
export function sampleTrackForPreview(
	track: AnimationTrack | undefined,
	relevantTracks: AnimationTrack[],
	tSecs: number,
	loopDurationSecs: number,
	fps: number,
	isMotion: boolean,
	honestPreview: boolean,
): KeyValue | null {
	if (!track || track.keyframes.length === 0) return null;
	if (!isMotion) return track.keyframes[0].value;
	return honestPreview
		? sampleHonestPreview(relevantTracks, track, tSecs, loopDurationSecs, fps)
		: evaluateTrack(track, tSecs);
}

/** Extract a CSS colour string from a {@link KeyValue}, or `null` if it isn't
 * a colour value. */
export function keyValueToColour(value: KeyValue | null): string | null {
	return value && value.kind === 'colour' ? value.hex : null;
}

/** Extract an opacity (0..1) from a {@link KeyValue}, or `null` if it isn't a
 * scalar value. */
export function keyValueToOpacity(value: KeyValue | null): number | null {
	return value && value.kind === 'scalar' ? value.value : null;
}
