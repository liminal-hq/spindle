// Small shared helpers for the timeline UI and its preview-sampling call
// sites in SceneCanvas: honest-preview quantization and KeyValue<->CSS
// conversions. Kept separate from `utils/animation.ts` (the Rust evaluator
// twin, pinned to the shared parity fixture) since none of this is part of
// that parity contract.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { AnimationTrack, KeyValue } from '../../../types/project';
import { evaluateTrack } from '../../../utils/animation';

/**
 * The DCSQ frame-schedule boundary (start instant) containing `tSecs`:
 * the last timestamp at-or-before `tSecs` in the UNION of every track in
 * `relevantTracks`' own keyframe timestamps (each clamped into
 * `[0, loopDurationSecs]`, always including 0.0) — mirrors
 * `build/planner/animation.rs::build_overlay_keyframe_schedule`'s
 * `timestamps` union, which combines every highlight/select-relevant
 * track's keyframes (across every button) into ONE shared frame schedule,
 * since a DVD menu bakes both states into one subpicture image per
 * schedule instant.
 */
function scheduleBoundarySecs(
	relevantTracks: AnimationTrack[],
	tSecs: number,
	loopDurationSecs: number,
): number {
	const maxSecs = Math.max(loopDurationSecs, 0);
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
): KeyValue | null {
	if (track.keyframes.length === 0) return null;
	const boundarySecs = scheduleBoundarySecs(relevantTracks, tSecs, loopDurationSecs);
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
	isMotion: boolean,
	honestPreview: boolean,
): KeyValue | null {
	if (!track || track.keyframes.length === 0) return null;
	if (!isMotion) return track.keyframes[0].value;
	return honestPreview
		? sampleHonestPreview(relevantTracks, track, tSecs, loopDurationSecs)
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
