// Transient playback state for a motion menu's preview <video> element.
//
// Deliberately NOT part of project-store: play/pause/seek/currentTime are
// ephemeral UI state, not project data, and must never enter undo history.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { create } from 'zustand';

/** A source-relative playback loop window (`[startSecs, startSecs +
 * durationSecs)`), derived from a motion menu's authored `timing.loopStartSecs`
 * / `timing.loopDurationSecs`. */
export interface LoopRegion {
	startSecs: number;
	durationSecs: number;
}

export interface MenuPlaybackState {
	/** The `<video>` element currently registered by `BackgroundMedia`'s ref
	 * callback, or `null` when no motion background is mounted. */
	videoEl: HTMLVideoElement | null;
	/** Source-relative playback position in seconds. Updated by the
	 * `useVideoPlayhead` rAF loop while playing (smooth, per-frame), by
	 * `reportTime` from the registered video's coarse `timeupdate` events as a
	 * fallback when no rAF loop is mounted, and by `seek()`. */
	currentTime: number;
	playing: boolean;
	/** The video element's reported duration in seconds, or 0 before metadata
	 * has loaded. Kept in sync by `reportDuration`. */
	duration: number;
	/** The current menu's authored loop window, or `null` for a still menu /
	 * before timing is known. Set by `TimelineStrip` from the document. */
	loopRegion: LoopRegion | null;
	/** Whether playback should wrap back to `loopRegion.startSecs` on reaching
	 * the end of the loop window — the timeline scrubber's loop-region toggle. */
	loopRegionEnabled: boolean;
	/** Register (or clear, with `null`) the mounted preview `<video>` element. */
	registerVideo: (el: HTMLVideoElement | null) => void;
	/** Record the registered video's current playback position, e.g. from a
	 * `timeupdate` event. */
	reportTime: (tSecs: number) => void;
	/** Record the registered video's reported duration, e.g. from a
	 * `loadedmetadata`/`durationchange` event. */
	reportDuration: (durationSecs: number) => void;
	/** Record the registered video's actual play/pause state, e.g. from
	 * `onPlay`/`onPause` events. Keeps `playing` accurate when playback
	 * starts or stops outside of `play()`/`pause()` — notably muted
	 * `autoPlay` starting the element without either being called. */
	reportPlaying: (playing: boolean) => void;
	/** Seek the registered video to `tSecs` (source-relative). No-op if no
	 * video is registered. */
	seek: (tSecs: number) => void;
	play: () => void;
	pause: () => void;
	/** Step the registered video by `deltaFrames` frames (may be negative) at
	 * `fps`. No-op if no video is registered. */
	stepFrame: (deltaFrames: number, fps: number) => void;
	setLoopRegion: (region: LoopRegion | null) => void;
	setLoopRegionEnabled: (enabled: boolean) => void;
	toggleLoopRegionEnabled: () => void;
}

export const useMenuPlaybackStore = create<MenuPlaybackState>((set, get) => ({
	videoEl: null,
	currentTime: 0,
	playing: false,
	duration: 0,
	loopRegion: null,
	loopRegionEnabled: true,

	registerVideo: (el) => {
		set({
			videoEl: el,
			currentTime: el?.currentTime ?? 0,
			duration: el?.duration || 0,
			playing: el ? !el.paused : false,
		});
	},

	reportTime: (tSecs) => {
		set({ currentTime: Number.isFinite(tSecs) ? tSecs : 0 });
	},

	reportDuration: (durationSecs) => {
		set({ duration: Number.isFinite(durationSecs) ? durationSecs : 0 });
	},

	reportPlaying: (playing) => {
		set({ playing });
	},

	seek: (tSecs) => {
		const { videoEl } = get();
		if (!videoEl) return;
		videoEl.currentTime = tSecs;
		set({ currentTime: tSecs });
	},

	play: () => {
		const { videoEl } = get();
		if (!videoEl) return;
		// `HTMLMediaElement.play()` returns a promise that rejects if playback
		// is blocked (e.g. an autoplay policy) — set `playing` from its
		// outcome rather than optimistically, or a rejected play leaves the
		// transport showing "playing" while the video never actually started
		// (and the unhandled rejection warns in the console).
		videoEl
			.play()
			.then(() => set({ playing: true }))
			.catch(() => set({ playing: false }));
	},

	pause: () => {
		const { videoEl } = get();
		if (!videoEl) return;
		videoEl.pause();
		set({ playing: false });
	},

	stepFrame: (deltaFrames, fps) => {
		const { videoEl, seek } = get();
		if (!videoEl || fps <= 0) return;
		seek(Math.max(0, videoEl.currentTime + deltaFrames / fps));
	},

	setLoopRegion: (region) => set({ loopRegion: region }),
	setLoopRegionEnabled: (enabled) => set({ loopRegionEnabled: enabled }),
	toggleLoopRegionEnabled: () => set((s) => ({ loopRegionEnabled: !s.loopRegionEnabled })),
}));

/**
 * Pure loop-region wraparound check: given the current source-relative
 * playback position, the authored loop window, and whether looping is
 * enabled, returns the seconds to seek back to when playback has reached (or
 * passed) the end of the loop window — or `null` when no wraparound is due.
 *
 * Kept pure and separate from the store so `useVideoPlayhead`'s rAF loop can
 * call it without a React/zustand dependency, and so it's directly
 * unit-testable.
 */
export function computeLoopWraparound(
	currentTimeSecs: number,
	region: LoopRegion | null,
	enabled: boolean,
): number | null {
	if (!enabled || !region || region.durationSecs <= 0) return null;
	const end = region.startSecs + region.durationSecs;
	if (currentTimeSecs >= end) return region.startSecs;
	return null;
}
