// Pure px<->seconds mapping for the timeline strip, plus region-edge
// hit-testing and time snapping — kept dependency-free so it's directly
// unit-testable without mounting React.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useMemo } from 'react';

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

/**
 * Hit-test a pointer x position (px, relative to the same origin as
 * `geometry`) against a region's start/end edges. Returns which edge (if
 * any) is within `thresholdPx`, preferring `start` on an exact tie.
 */
export function hitTestRegionEdge(
	pxX: number,
	geometry: TimelineGeometry,
	regionStartSecs: number,
	regionEndSecs: number,
	thresholdPx = 6,
): 'start' | 'end' | null {
	const startPx = geometry.secsToPx(regionStartSecs);
	const endPx = geometry.secsToPx(regionEndSecs);
	if (Math.abs(pxX - startPx) <= thresholdPx) return 'start';
	if (Math.abs(pxX - endPx) <= thresholdPx) return 'end';
	return null;
}

/** Snap `secs` to the nearest frame boundary at `fps`. `fps <= 0` returns
 * `secs` unchanged. */
export function snapSecsToFrame(secs: number, fps: number): number {
	if (fps <= 0) return secs;
	return Math.round(secs * fps) / fps;
}
