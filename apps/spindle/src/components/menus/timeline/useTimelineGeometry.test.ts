// Tests for the timeline's pure px<->seconds geometry, region-edge
// hit-testing, and frame snapping.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { computeTimelineGeometry, hitTestRegionEdge, snapSecsToFrame } from './useTimelineGeometry';

describe('computeTimelineGeometry', () => {
	it('maps seconds to px and back losslessly at a fixed scale', () => {
		const geometry = computeTimelineGeometry(20, 40);
		expect(geometry.secsToPx(5)).toBe(200);
		expect(geometry.pxToSecs(200)).toBe(5);
		expect(geometry.totalWidthPx).toBe(800);
	});

	it('clamps a negative duration to zero width', () => {
		const geometry = computeTimelineGeometry(-5, 40);
		expect(geometry.durationSecs).toBe(0);
		expect(geometry.totalWidthPx).toBe(0);
	});

	it('clamps pxPerSecond to a small positive minimum instead of dividing by zero', () => {
		const geometry = computeTimelineGeometry(10, 0);
		expect(geometry.pxPerSecond).toBeGreaterThan(0);
		expect(Number.isFinite(geometry.secsToPx(1))).toBe(true);
	});

	it('is a stable round trip across a range of values', () => {
		const geometry = computeTimelineGeometry(120, 25);
		for (const secs of [0, 1.5, 30, 59.999, 120]) {
			expect(geometry.pxToSecs(geometry.secsToPx(secs))).toBeCloseTo(secs, 9);
		}
	});
});

describe('hitTestRegionEdge', () => {
	const geometry = computeTimelineGeometry(60, 10); // 10px/sec

	it('detects the start edge within the threshold', () => {
		expect(hitTestRegionEdge(50, geometry, 5, 20)).toBe('start');
	});

	it('detects the end edge within the threshold', () => {
		expect(hitTestRegionEdge(200, geometry, 5, 20)).toBe('end');
	});

	it('returns null outside both thresholds', () => {
		expect(hitTestRegionEdge(120, geometry, 5, 20)).toBeNull();
	});

	it('prefers the start edge on an exact tie between coincident edges', () => {
		// Degenerate zero-width region: both edges sit at the same px.
		expect(hitTestRegionEdge(50, geometry, 5, 5)).toBe('start');
	});

	it('respects a custom threshold', () => {
		expect(hitTestRegionEdge(58, geometry, 5, 20, 10)).toBe('start');
		expect(hitTestRegionEdge(58, geometry, 5, 20, 2)).toBeNull();
	});
});

describe('snapSecsToFrame', () => {
	it('snaps to the nearest frame boundary', () => {
		// 10fps: frame duration 0.1s, so frame boundaries land on clean decimals.
		expect(snapSecsToFrame(0.24, 10)).toBeCloseTo(0.2, 9);
		expect(snapSecsToFrame(0.26, 10)).toBeCloseTo(0.3, 9);
		expect(snapSecsToFrame(1.0, 10)).toBeCloseTo(1.0, 9);
	});

	it('is a no-op at fps <= 0', () => {
		expect(snapSecsToFrame(1.2345, 0)).toBe(1.2345);
		expect(snapSecsToFrame(1.2345, -1)).toBe(1.2345);
	});
});
