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
	/** Source-relative playback position in seconds. Updated by a rAF loop
	 * reading `videoEl.currentTime` (wired up in a later PR) — for now this
	 * mirrors the last `seek()` target so the scrub row stays in sync. */
	currentTime: number;
	playing: boolean;
	/** The video element's reported duration in seconds, or 0 before metadata
	 * has loaded. */
	duration: number;
	/** Register (or clear, with `null`) the mounted preview `<video>` element. */
	registerVideo: (el: HTMLVideoElement | null) => void;
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
