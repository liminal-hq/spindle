// Tests for the transient menu-playback store.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMenuPlaybackStore } from './menu-playback-store';

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
});
