// Pure px<->seconds mapping for the timeline strip, plus frame-rate lookup
// and time snapping — kept dependency-free so it's directly unit-testable
// without mounting React.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useMemo } from 'react';
import type { VideoStandard } from '../../../types/project';

export interface TimelineGeometry {
	pxPerSecond: number;
	durationSecs: number;
	/** Total scrollable width of the timeline content, in px. */
	totalWidthPx: number;
	secsToPx: (secs: number) => number;
	pxToSecs: (px: number) => number;
}

const MIN_PX_PER_SECOND = 4;

/** Build a {@link TimelineGeometry} for a track spanning `durationSecs` at
 * `pxPerSecond` scale. `durationSecs` is clamped to a small positive minimum
 * so a not-yet-loaded video (duration 0) still produces a usable, if empty,
 * geometry rather than dividing by zero downstream. */
export function computeTimelineGeometry(
	durationSecs: number,
	pxPerSecond: number,
): TimelineGeometry {
	const safeDuration = Math.max(durationSecs, 0);
	const safePxPerSecond = Math.max(pxPerSecond, MIN_PX_PER_SECOND);
	const totalWidthPx = safeDuration * safePxPerSecond;

	return {
		pxPerSecond: safePxPerSecond,
		durationSecs: safeDuration,
		totalWidthPx,
		secsToPx: (secs) => secs * safePxPerSecond,
		pxToSecs: (px) => px / safePxPerSecond,
	};
}

export function useTimelineGeometry(durationSecs: number, pxPerSecond: number): TimelineGeometry {
	return useMemo(
		() => computeTimelineGeometry(durationSecs, pxPerSecond),
		[durationSecs, pxPerSecond],
	);
}

/** Snap `secs` to the nearest frame boundary at `fps`. `fps <= 0` returns
 * `secs` unchanged. */
export function snapSecsToFrame(secs: number, fps: number): number {
	if (fps <= 0) return secs;
	return Math.round(secs * fps) / fps;
}

/**
 * Nominal frame rate for a DVD-Video standard, as an exact rational —
 * NTSC's 30000/1001 (~29.97 fps drop-frame) and PAL's flat 25 fps — so
 * repeated frame-stepping/snapping in the UI doesn't accumulate rounding
 * error the way reusing the `29.97` decimal would. `VideoStandard::frame_rate()`
 * on the Rust side uses that decimal for schedule-duration math, where the
 * tiny (~0.0001%) discrepancy against the exact rational doesn't matter.
 */
export function fpsForStandard(standard: VideoStandard): number {
	return standard === 'PAL' ? 25 : 30000 / 1001;
}
