// Density- and size-aware layout signal for responsive UIs.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

// The breakpoint we care about is *effective logical width of the workspace
// being laid out*, not the whole window — the window also contains the app's
// own persistent sidebar and padding, so window.innerWidth overstates how
// much room a given workspace actually has (e.g. the default 1280px window
// leaves a menu workspace under 1100px after the sidebar). Callers pass a
// ref to the element whose width should drive the breakpoint; it is measured
// with a ResizeObserver, falling back to window.innerWidth only until the
// element is mounted or when no ref is supplied at all.
//
// At high DPI the logical viewport is also much smaller than the physical
// resolution (e.g. a 5120x2880 panel at 2x scale only offers ~2560 logical
// px), so keying off physical resolution instead of logical width would be
// wrong on top of the window-vs-workspace issue above.
//
// The display-awareness plugin augments the size signal with the active
// monitor's scale and best-effort physical size, surfaced for callers that
// want them, and drives re-evaluation when the window moves between monitors
// with different scale factors.

import { useEffect, useState, type RefObject } from 'react';
import {
	getActiveDisplay,
	onDisplayChanged,
	type DisplayGeometry,
} from 'tauri-plugin-display-awareness-api';

export type { DisplayGeometry };

/**
 * Layout breakpoints keyed off the workspace's effective logical width.
 *
 * - `compact`  (< 900):   single column; rail + inspector become slide-overs.
 * - `medium`   (900-1280): canvas central; side panels dock but are collapsible.
 * - `wide`     (>= 1280):  rail + canvas + inspector all persistent.
 */
export type LayoutBreakpoint = 'compact' | 'medium' | 'wide';

export interface DisplayDensity {
	/** Measured workspace (or window, if no container ref given) width in logical px. */
	viewportWidth: number;
	/** Measured workspace (or window) height in logical px. */
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

function readWindowSize(): { width: number; height: number } {
	if (typeof window === 'undefined') {
		return { width: WIDE_MIN, height: 800 };
	}
	return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Reactive display-density signal. Recomputes on resize of the given
 * container (or the window, if no container ref is supplied) and when the
 * active monitor changes (via the display-awareness plugin's change event).
 */
export function useDisplayDensity(containerRef?: RefObject<HTMLElement | null>): DisplayDensity {
	const [size, setSize] = useState(readWindowSize);
	const [scale, setScale] = useState(() =>
		typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
	);
	const [activeDisplay, setActiveDisplay] = useState<DisplayGeometry | null>(null);

	// Measure the container (preferred) or fall back to the window.
	useEffect(() => {
		const element = containerRef?.current;

		if (!element) {
			const onResize = () => setSize(readWindowSize());
			window.addEventListener('resize', onResize);
			return () => window.removeEventListener('resize', onResize);
		}

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const { width, height } = entry.contentRect;
			setSize({ width, height });
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [containerRef]);

	// Pull the active monitor's geometry from the plugin, and refresh it whenever
	// the window crosses to a monitor with a different scale factor.
	useEffect(() => {
		let cancelled = false;

		const refresh = async () => {
			try {
				const display = await getActiveDisplay();
				if (cancelled) return;
				setActiveDisplay(display);
				if (display) setScale(display.scale);
			} catch (error) {
				// Plugin unavailable (e.g. non-Tauri context) — size signal still works.
				console.debug('display-awareness unavailable, using window/DPR signals only', error);
			}
		};

		void refresh();
		const unlisten = onDisplayChanged(() => {
			setSize(readWindowSize());
			void refresh();
		});

		return () => {
			cancelled = true;
			unlisten.then((fn) => fn());
		};
	}, []);

	const breakpoint = classify(size.width);

	return {
		viewportWidth: size.width,
		viewportHeight: size.height,
		scale,
		activeDisplay,
		breakpoint,
		isCompact: breakpoint === 'compact',
		isMedium: breakpoint === 'medium',
		isWide: breakpoint === 'wide',
	};
}
