// Tests for the transient menu-playback store.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeLoopWraparound, useMenuPlaybackStore } from './menu-playback-store';
import type { LoopRegion } from './menu-playback-store';

const initialState = useMenuPlaybackStore.getState();

function fakeVideoEl(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
	return {
		currentTime: 0,
		duration: 12,
		paused: true,
		play: vi.fn().mockResolvedValue(undefined),
		pause: vi.fn(),
		...overrides,
	} as unknown as HTMLVideoElement;
}

describe('menu-playback-store', () => {
	afterEach(() => {
		useMenuPlaybackStore.setState(initialState, true);
	});

	it('starts with no video registered and playback idle', () => {
		const state = useMenuPlaybackStore.getState();
		expect(state.videoEl).toBeNull();
		expect(state.currentTime).toBe(0);
		expect(state.playing).toBe(false);
		expect(state.duration).toBe(0);
	});

	it('registerVideo captures the element and its initial time/duration/paused state', () => {
		const video = fakeVideoEl({ currentTime: 3, duration: 12, paused: false });

		useMenuPlaybackStore.getState().registerVideo(video);

		const state = useMenuPlaybackStore.getState();
		expect(state.videoEl).toBe(video);
		expect(state.currentTime).toBe(3);
		expect(state.duration).toBe(12);
		expect(state.playing).toBe(true);
	});

	it('registerVideo(null) clears the registered element and resets derived state', () => {
		const video = fakeVideoEl({ currentTime: 3, duration: 12, paused: false });
		useMenuPlaybackStore.getState().registerVideo(video);

		useMenuPlaybackStore.getState().registerVideo(null);

		const state = useMenuPlaybackStore.getState();
		expect(state.videoEl).toBeNull();
		expect(state.currentTime).toBe(0);
		expect(state.duration).toBe(0);
		expect(state.playing).toBe(false);
	});

	it('seek sets the registered video element currentTime and store currentTime', () => {
		const video = fakeVideoEl();
		useMenuPlaybackStore.getState().registerVideo(video);

		useMenuPlaybackStore.getState().seek(5.5);

		expect(video.currentTime).toBe(5.5);
		expect(useMenuPlaybackStore.getState().currentTime).toBe(5.5);
	});

	it('seek is a no-op when no video is registered', () => {
		expect(() => useMenuPlaybackStore.getState().seek(5)).not.toThrow();
		expect(useMenuPlaybackStore.getState().currentTime).toBe(0);
	});

	it('play calls videoEl.play() and sets playing true', () => {
		const video = fakeVideoEl();
		useMenuPlaybackStore.getState().registerVideo(video);

		useMenuPlaybackStore.getState().play();

		expect(video.play).toHaveBeenCalledTimes(1);
		expect(useMenuPlaybackStore.getState().playing).toBe(true);
	});

	it('pause calls videoEl.pause() and sets playing false', () => {
		const video = fakeVideoEl({ paused: false });
		useMenuPlaybackStore.getState().registerVideo(video);
		useMenuPlaybackStore.getState().play();

		useMenuPlaybackStore.getState().pause();

		expect(video.pause).toHaveBeenCalledTimes(1);
		expect(useMenuPlaybackStore.getState().playing).toBe(false);
	});

	it('reportTime updates currentTime, mirroring a video timeupdate event', () => {
		const video = fakeVideoEl();
		useMenuPlaybackStore.getState().registerVideo(video);

		useMenuPlaybackStore.getState().reportTime(7.25);

		expect(useMenuPlaybackStore.getState().currentTime).toBe(7.25);
	});

	it('reportDuration updates duration, mirroring a video loadedmetadata/durationchange event', () => {
		const video = fakeVideoEl({ duration: 0 });
		useMenuPlaybackStore.getState().registerVideo(video);
		expect(useMenuPlaybackStore.getState().duration).toBe(0);

		useMenuPlaybackStore.getState().reportDuration(42.5);

		expect(useMenuPlaybackStore.getState().duration).toBe(42.5);
	});

	it('"Set loop start from playhead" reads the value reportTime last wrote, not a stale 0', () => {
		// Regression test: before BackgroundVideo wired its `timeupdate` handler
		// into `reportTime`, nothing ever updated `currentTime` after
		// `registerVideo`, so MenuEditor's `handleSetLoopStartFromPlayhead` —
		// which reads `useMenuPlaybackStore.getState().currentTime` directly —
		// always saw 0 regardless of where playback actually was.
		const video = fakeVideoEl();
		useMenuPlaybackStore.getState().registerVideo(video);

		useMenuPlaybackStore.getState().reportTime(8.4);

		const loopStartFromPlayhead = useMenuPlaybackStore.getState().currentTime;
		expect(loopStartFromPlayhead).toBe(8.4);
	});

	it('play/pause are no-ops when no video is registered', () => {
		expect(() => useMenuPlaybackStore.getState().play()).not.toThrow();
		expect(() => useMenuPlaybackStore.getState().pause()).not.toThrow();
		expect(useMenuPlaybackStore.getState().playing).toBe(false);
	});

	it('reportPlaying(true) mirrors a video onPlay event, e.g. from muted autoPlay starting', () => {
		// Regression test: muted `autoPlay` starts the element without going
		// through `play()`, so `playing` must be updated from the video's own
		// `onPlay`/`onPause` events, not only from the store's own actions.
		const video = fakeVideoEl();
		useMenuPlaybackStore.getState().registerVideo(video);
		expect(useMenuPlaybackStore.getState().playing).toBe(false);

		useMenuPlaybackStore.getState().reportPlaying(true);

		expect(useMenuPlaybackStore.getState().playing).toBe(true);
	});

	it('reportPlaying(false) mirrors a video onPause event', () => {
		const video = fakeVideoEl({ paused: false });
		useMenuPlaybackStore.getState().registerVideo(video);
		expect(useMenuPlaybackStore.getState().playing).toBe(true);

		useMenuPlaybackStore.getState().reportPlaying(false);

		expect(useMenuPlaybackStore.getState().playing).toBe(false);
	});

	it('stepFrame seeks by deltaFrames/fps seconds, clamped at zero', () => {
		const video = fakeVideoEl({ currentTime: 1 });
		useMenuPlaybackStore.getState().registerVideo(video);

		useMenuPlaybackStore.getState().stepFrame(3, 30);
		expect(video.currentTime).toBeCloseTo(1.1, 9);

		useMenuPlaybackStore.getState().stepFrame(-100, 30);
		expect(video.currentTime).toBe(0);
	});

	it('stepFrame is a no-op with no video registered or fps <= 0', () => {
		expect(() => useMenuPlaybackStore.getState().stepFrame(1, 30)).not.toThrow();
		const video = fakeVideoEl({ currentTime: 1 });
		useMenuPlaybackStore.getState().registerVideo(video);
		useMenuPlaybackStore.getState().stepFrame(1, 0);
		expect(video.currentTime).toBe(1);
	});

	it('loop-region toggle flips loopRegionEnabled', () => {
		expect(useMenuPlaybackStore.getState().loopRegionEnabled).toBe(true);
		useMenuPlaybackStore.getState().toggleLoopRegionEnabled();
		expect(useMenuPlaybackStore.getState().loopRegionEnabled).toBe(false);
		useMenuPlaybackStore.getState().setLoopRegionEnabled(true);
		expect(useMenuPlaybackStore.getState().loopRegionEnabled).toBe(true);
	});

	it('setLoopRegion stores the region', () => {
		const region: LoopRegion = { startSecs: 2, durationSecs: 8 };
		useMenuPlaybackStore.getState().setLoopRegion(region);
		expect(useMenuPlaybackStore.getState().loopRegion).toEqual(region);
	});
});

describe('computeLoopWraparound', () => {
	const region: LoopRegion = { startSecs: 2, durationSecs: 8 }; // [2, 10)

	it('returns null before the loop window ends', () => {
		expect(computeLoopWraparound(5, region, true)).toBeNull();
	});

	it('returns the loop start once playback reaches the window end', () => {
		expect(computeLoopWraparound(10, region, true)).toBe(2);
	});

	it('returns the loop start once playback passes the window end', () => {
		expect(computeLoopWraparound(15, region, true)).toBe(2);
	});

	it('returns null when looping is disabled', () => {
		expect(computeLoopWraparound(10, region, false)).toBeNull();
	});

	it('returns null with no region', () => {
		expect(computeLoopWraparound(10, null, true)).toBeNull();
	});

	it('returns null for a zero-or-negative-duration region', () => {
		expect(computeLoopWraparound(10, { startSecs: 2, durationSecs: 0 }, true)).toBeNull();
	});
});
