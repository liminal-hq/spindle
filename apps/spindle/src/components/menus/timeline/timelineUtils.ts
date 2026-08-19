// Small shared helpers for the timeline UI and its preview-sampling call
// sites in SceneCanvas: honest-preview quantization and KeyValue<->CSS
// conversions. Kept separate from `utils/animation.ts` (the Rust evaluator
// twin, pinned to the shared parity fixture) since none of this is part of
// that parity contract.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { AnimationTrack, KeyValue } from '../../../types/project';

/**
 * Sample `track` the way the compiled disc actually plays it back: DCSQ
 * lowering swaps overlay bitmaps at each keyframe's own timestamp with no
 * interpolation (see design decision D8), so "honest preview" quantizes to
 * the last keyframe at-or-before `tSecs` regardless of the keyframe's
 * authored easing. Returns `null` for an empty track.
 */
export function sampleHonestPreview(track: AnimationTrack, tSecs: number): KeyValue | null {
	const keyframes = track.keyframes;
	if (keyframes.length === 0) return null;
	let result = keyframes[0];
	for (const kf of keyframes) {
		if (kf.timestampSecs <= tSecs) {
			result = kf;
		} else {
			break;
		}
	}
	return result.value;
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
