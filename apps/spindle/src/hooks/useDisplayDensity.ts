// Density- and size-aware layout signal for responsive UIs.
//
// The breakpoint we care about is *effective logical width* — how many CSS
// pixels the window actually has to lay out in — because that is what decides
// whether multi-column layouts fit. At high DPI the logical viewport is much
// smaller than the physical resolution (e.g. a 5120x2880 panel at 2x scale only
// offers ~2560 logical px, and a non-maximised window far less), so keying off
// physical resolution would be wrong.
//
// Primary source is the window's own viewport (`innerWidth`/`innerHeight`,
// already in logical px). The display-awareness plugin augments this with the
// active monitor's scale and best-effort physical size, surfaced for callers
// that want them, and drives re-evaluation when the window moves between
// monitors with different scale factors.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Mirrors `DisplayGeometry` from tauri-plugin-display-awareness. */
export interface DisplayGeometry {
	name: string;
	isPrimary: boolean;
	scale: number;
	physicalWidth: number;
	physicalHeight: number;
	logicalWidth: number;
	logicalHeight: number;
	positionX: number;
	positionY: number;
	/** Best-effort physical size in millimetres; null when unavailable. */
	widthMm: number | null;
	heightMm: number | null;
}

/**
 * Layout breakpoints keyed off the window's effective logical width.
 *
 * - `compact`  (< 900):   single column; rail + inspector become slide-overs.
 * - `medium`   (900-1280): canvas central; side panels dock but are collapsible.
 * - `wide`     (>= 1280):  rail + canvas + inspector all persistent.
 */
export type LayoutBreakpoint = 'compact' | 'medium' | 'wide';

export interface DisplayDensity {
	/** Window viewport width in logical (CSS) pixels. */
	viewportWidth: number;
	/** Window viewport height in logical (CSS) pixels. */
	viewportHeight: number;
	/** Device pixel ratio of the window's current monitor. */
	scale: number;
	/** Active monitor geometry from the plugin, or null before it resolves. */
	activeDisplay: DisplayGeometry | null;
	breakpoint: LayoutBreakpoint;
	isCompact: boolean;
	isMedium: boolean;
	isWide: boolean;
}

const MEDIUM_MIN = 900;
const WIDE_MIN = 1280;

function classify(width: number): LayoutBreakpoint {
	if (width >= WIDE_MIN) return 'wide';
	if (width >= MEDIUM_MIN) return 'medium';
	return 'compact';
}

function readViewport(): { width: number; height: number; scale: number } {
	if (typeof window === 'undefined') {
		return { width: WIDE_MIN, height: 800, scale: 1 };
	}
	return {
		width: window.innerWidth,
		height: window.innerHeight,
		scale: window.devicePixelRatio || 1,
	};
}

/**
 * Reactive display-density signal. Recomputes on window resize and when the
 * active monitor changes (via the `display://changed` plugin event).
 */
export function useDisplayDensity(): DisplayDensity {
	const [viewport, setViewport] = useState(readViewport);
	const [activeDisplay, setActiveDisplay] = useState<DisplayGeometry | null>(null);

	// Track viewport changes (resize + DPR shifts surface here as resize events).
	useEffect(() => {
		const onResize = () => setViewport(readViewport());
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	}, []);

	// Pull the active monitor's geometry from the plugin, and refresh it whenever
	// the window crosses to a monitor with a different scale factor.
	useEffect(() => {
		let cancelled = false;

		const refresh = async () => {
			try {
				const display = await invoke<DisplayGeometry | null>(
					'plugin:display-awareness|get_active_display',
				);
				if (!cancelled) setActiveDisplay(display);
			} catch (error) {
				// Plugin unavailable (e.g. non-Tauri context) — viewport signals still work.
				console.debug('display-awareness unavailable, using viewport signals only', error);
			}
		};

		void refresh();
		const unlisten = listen('display://changed', () => {
			setViewport(readViewport());
			void refresh();
		});

		return () => {
			cancelled = true;
			unlisten.then((fn) => fn());
		};
	}, []);

	const breakpoint = classify(viewport.width);

	return {
		viewportWidth: viewport.width,
		viewportHeight: viewport.height,
		scale: activeDisplay?.scale ?? viewport.scale,
		activeDisplay,
		breakpoint,
		isCompact: breakpoint === 'compact',
		isMedium: breakpoint === 'medium',
		isWide: breakpoint === 'wide',
	};
}
