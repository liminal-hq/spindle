// Density- and size-aware layout signal for responsive UIs.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

// The breakpoint we care about is *effective logical width of the workspace
// being laid out*, not the whole window — the window also contains the app's
// own persistent sidebar and padding, so window.innerWidth overstates how
// much room a given workspace actually has (e.g. the default 1280px window
// leaves a menu workspace under 1100px after the sidebar). Callers attach
// the returned `containerRef` callback to the element whose width should
// drive the breakpoint; it is measured with a ResizeObserver, falling back
// to window.innerWidth until the element is mounted or when the callback
// isn't attached to anything.
//
// `containerRef` is a *callback* ref rather than a plain `useRef` object on
// purpose: a plain ref's `.current` only updates when React commits, with no
// signal that tells an effect to re-run, so an effect that captured the ref
// object early (e.g. before the element exists, such as while a parent
// component is still showing a loading/empty state) never re-measures once
// the element actually mounts later. A callback ref doesn't have that gap —
// React calls it directly with the node every time it attaches or detaches.
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

import { useCallback, useEffect, useRef, useState } from 'react';
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
	/** Measured workspace (or window, if containerRef isn't attached) width in logical px. */
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
	/** Attach to the element whose width should drive the breakpoint. */
	containerRef: (node: HTMLElement | null) => void;
}

const MEDIUM_MIN = 900;
const WIDE_MIN = 1280;

/** Exported for direct unit testing of the breakpoint boundaries. */
export function classify(width: number): LayoutBreakpoint {
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
 * Reactive display-density signal. Recomputes on resize of the element
 * attached via the returned `containerRef` (or the window, while nothing is
 * attached) and when the active monitor changes (via the display-awareness
 * plugin's change event).
 */
export function useDisplayDensity(): DisplayDensity {
	const [size, setSize] = useState(readWindowSize);
	const [scale, setScale] = useState(() =>
		typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
	);
	const [activeDisplay, setActiveDisplay] = useState<DisplayGeometry | null>(null);
	const [containerNode, setContainerNode] = useState<HTMLElement | null>(null);
	// Mirrors containerNode for synchronous reads from the display-change
	// effect below, without making that effect depend on (and resubscribe
	// its listener whenever) the container changes.
	const containerNodeRef = useRef<HTMLElement | null>(null);

	// A callback ref re-fires whenever the node actually attaches/detaches —
	// unlike a plain useRef object, which doesn't notify anything when its
	// .current changes, so an effect that captured it before the node existed
	// would never know to re-measure once it mounted.
	const containerRef = useCallback((node: HTMLElement | null) => {
		containerNodeRef.current = node;
		setContainerNode(node);
	}, []);

	// Measure the attached container (preferred) or fall back to the window.
	useEffect(() => {
		if (!containerNode) {
			const onResize = () => setSize(readWindowSize());
			window.addEventListener('resize', onResize);
			setSize(readWindowSize());
			return () => window.removeEventListener('resize', onResize);
		}

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const { width, height } = entry.contentRect;
			setSize({ width, height });
		});
		observer.observe(containerNode);
		return () => observer.disconnect();
	}, [containerNode]);

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
			// Re-measure whichever source is actually driving the breakpoint.
			// Falling back to the window unconditionally here would clobber a
			// correct container measurement with the window's width the moment
			// the window moves to a monitor with a different scale, with
			// nothing to correct it afterwards unless the container's actual
			// size also happened to change (which a ResizeObserver would catch,
			// but isn't guaranteed here).
			const node = containerNodeRef.current;
			if (node) {
				const rect = node.getBoundingClientRect();
				setSize({ width: rect.width, height: rect.height });
			} else {
				setSize(readWindowSize());
			}
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
		containerRef,
	};
}
