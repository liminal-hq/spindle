// Tests for the timeline's pure px<->seconds geometry, frame snapping, and
// disc-standard frame-rate lookup.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { computeTimelineGeometry, fpsForStandard, snapSecsToFrame } from './useTimelineGeometry';

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

describe('fpsForStandard', () => {
	it('returns the exact NTSC rational (30000/1001), not the 29.97 decimal', () => {
		expect(fpsForStandard('NTSC')).toBeCloseTo(29.97002997, 8);
		expect(fpsForStandard('NTSC')).toBe(30000 / 1001);
	});

	it('returns a flat 25fps for PAL', () => {
		expect(fpsForStandard('PAL')).toBe(25);
	});
});
