// Drives the menu-playback store's `currentTime` from the registered
// preview `<video>` element via a requestAnimationFrame loop — deliberately
// NOT the browser's `timeupdate` event, which fires at ~4Hz and is too
// coarse for a smooth timeline playhead.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect } from 'react';
import { computeLoopWraparound, useMenuPlaybackStore } from '../../../store/menu-playback-store';

/**
 * Mount once while a motion menu's timeline is visible. Each animation
 * frame, reads the registered video element's `currentTime` and writes it
 * into the store — applying loop-region wraparound (seeking back to the
 * loop start) when enabled and the playhead has reached the end of the
 * loop window. A no-op (but still scheduled) when no video is registered or
 * it's paused, so scrubbing while paused isn't fought over.
 *
 * Pass `enabled: false` to schedule nothing at all — the caller renders for
 * a still menu whose timeline is hidden, and a hidden strip must not wake
 * the main thread every frame (hooks can't be mounted conditionally, so the
 * flag does it instead).
 */
export function useVideoPlayhead(enabled = true): void {
	useEffect(() => {
		if (!enabled) return;
		let raf = 0;

		const tick = () => {
			const { videoEl, playing, loopRegion, loopRegionEnabled, seek } =
				useMenuPlaybackStore.getState();
			if (videoEl && playing) {
				const t = videoEl.currentTime;
				const wrapTo = computeLoopWraparound(t, loopRegion, loopRegionEnabled);
				if (wrapTo !== null) {
					seek(wrapTo);
				} else {
					useMenuPlaybackStore.setState({ currentTime: t });
				}
			}
			raf = requestAnimationFrame(tick);
		};

		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [enabled]);
}
