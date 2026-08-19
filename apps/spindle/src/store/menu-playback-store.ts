// Transient playback state for a motion menu's preview <video> element.
//
// Deliberately NOT part of project-store: play/pause/seek/currentTime are
// ephemeral UI state, not project data, and must never enter undo history.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { create } from 'zustand';

export interface MenuPlaybackState {
	/** The `<video>` element currently registered by `BackgroundMedia`'s ref
	 * callback, or `null` when no motion background is mounted. */
	videoEl: HTMLVideoElement | null;
	/** Source-relative playback position in seconds. Kept in sync by
	 * `reportTime`, called from the registered video's `timeupdate` handler
	 * (coarse, browser-native ~4Hz — a rAF loop for smoother scrubbing is a
	 * later PR) as well as `seek()`. */
	currentTime: number;
	playing: boolean;
	/** The video element's reported duration in seconds, or 0 before metadata
	 * has loaded. Kept in sync by `reportDuration`. */
	duration: number;
	/** Register (or clear, with `null`) the mounted preview `<video>` element. */
	registerVideo: (el: HTMLVideoElement | null) => void;
	/** Record the registered video's current playback position, e.g. from a
	 * `timeupdate` event. */
	reportTime: (tSecs: number) => void;
	/** Record the registered video's reported duration, e.g. from a
	 * `loadedmetadata`/`durationchange` event. */
	reportDuration: (durationSecs: number) => void;
	/** Seek the registered video to `tSecs` (source-relative). No-op if no
	 * video is registered. */
	seek: (tSecs: number) => void;
	play: () => void;
	pause: () => void;
}

export const useMenuPlaybackStore = create<MenuPlaybackState>((set, get) => ({
	videoEl: null,
	currentTime: 0,
	playing: false,
	duration: 0,

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

	seek: (tSecs) => {
		const { videoEl } = get();
		if (!videoEl) return;
		videoEl.currentTime = tSecs;
		set({ currentTime: tSecs });
	},

	play: () => {
		const { videoEl } = get();
		if (!videoEl) return;
		void videoEl.play();
		set({ playing: true });
	},

	pause: () => {
		const { videoEl } = get();
		if (!videoEl) return;
		videoEl.pause();
		set({ playing: false });
	},
}));
