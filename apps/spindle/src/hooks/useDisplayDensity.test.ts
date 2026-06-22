// Tests for the display-density breakpoint hook.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { classify, useDisplayDensity, type DisplayGeometry } from './useDisplayDensity';

class MockResizeObserver {
	static instances: MockResizeObserver[] = [];
	observedElements: Element[] = [];
	disconnected = false;

	constructor(public callback: ResizeObserverCallback) {
		MockResizeObserver.instances.push(this);
	}

	observe(element: Element) {
		this.observedElements.push(element);
	}

	unobserve() {}

	disconnect() {
		this.disconnected = true;
	}
}

const { getActiveDisplay, onDisplayChanged } = vi.hoisted(() => ({
	getActiveDisplay: vi.fn(),
	onDisplayChanged: vi.fn(),
}));

vi.mock('tauri-plugin-display-awareness-api', () => ({
	getActiveDisplay,
	onDisplayChanged,
}));

function makeDisplay(overrides: Partial<DisplayGeometry> = {}): DisplayGeometry {
	return {
		name: 'DP-1',
		isPrimary: true,
		scale: 2,
		physicalWidth: 3840,
		physicalHeight: 2160,
		logicalWidth: 1920,
		logicalHeight: 1080,
		positionX: 0,
		positionY: 0,
		widthMm: 620,
		heightMm: 340,
		...overrides,
	};
}

function setWindowInnerSize(width: number, height: number) {
	Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
	Object.defineProperty(window, 'innerHeight', {
		writable: true,
		configurable: true,
		value: height,
	});
}

describe('classify', () => {
	it('classifies widths below 900 as compact', () => {
		expect(classify(0)).toBe('compact');
		expect(classify(899)).toBe('compact');
	});

	it('classifies widths from 900 up to (not including) 1280 as medium', () => {
		expect(classify(900)).toBe('medium');
		expect(classify(1279)).toBe('medium');
	});

	it('classifies widths from 1280 and up as wide', () => {
		expect(classify(1280)).toBe('wide');
		expect(classify(5000)).toBe('wide');
	});
});

describe('useDisplayDensity', () => {
	beforeEach(() => {
		getActiveDisplay.mockReset();
		onDisplayChanged.mockReset();
		onDisplayChanged.mockReturnValue(Promise.resolve(() => {}));
		setWindowInnerSize(1280, 800);
		MockResizeObserver.instances = [];
		vi.stubGlobal('ResizeObserver', MockResizeObserver);
	});

	it('falls back to window size and classifies the breakpoint when no container ref is given', () => {
		getActiveDisplay.mockResolvedValue(null);
		const { result } = renderHook(() => useDisplayDensity());

		expect(result.current.viewportWidth).toBe(1280);
		expect(result.current.viewportHeight).toBe(800);
		expect(result.current.breakpoint).toBe('wide');
		expect(result.current.isWide).toBe(true);
		expect(result.current.isCompact).toBe(false);
	});

	it('classifies a narrower window as compact', () => {
		setWindowInnerSize(800, 600);
		getActiveDisplay.mockResolvedValue(null);
		const { result } = renderHook(() => useDisplayDensity());

		expect(result.current.breakpoint).toBe('compact');
		expect(result.current.isCompact).toBe(true);
	});

	it('applies the active display scale once the plugin resolves', async () => {
		getActiveDisplay.mockResolvedValue(makeDisplay({ scale: 2 }));
		const { result } = renderHook(() => useDisplayDensity());

		await waitFor(() => expect(result.current.activeDisplay).not.toBeNull());
		expect(result.current.scale).toBe(2);
	});

	it('keeps working off window/DPR signals when the plugin is unavailable', async () => {
		getActiveDisplay.mockRejectedValue(new Error('not running in a Tauri context'));
		const { result } = renderHook(() => useDisplayDensity());

		await waitFor(() => expect(getActiveDisplay).toHaveBeenCalled());
		expect(result.current.activeDisplay).toBeNull();
		expect(result.current.breakpoint).toBe('wide');
	});

	it('switches from the window fallback to observing the container once it attaches', () => {
		// Regression test: the hook used to accept a plain useRef object, whose
		// .current only updates on commit with no signal an effect can depend
		// on — so a node that mounts on a *later* render than the one where
		// the hook first ran (e.g. a parent that renders null until some data
		// loads) was never observed; the breakpoint silently kept measuring
		// the window forever. A callback ref fixes this by re-firing exactly
		// when the node attaches, regardless of which render that happens on.
		getActiveDisplay.mockResolvedValue(null);
		const { result } = renderHook(() => useDisplayDensity());

		// Nothing attached yet — falls back to the window-resize listener,
		// not a ResizeObserver.
		expect(MockResizeObserver.instances).toHaveLength(0);

		const node = document.createElement('div');
		act(() => {
			result.current.containerRef(node);
		});

		// Attaching the node (simulating React committing the ref on a later
		// render) must start observing it.
		expect(MockResizeObserver.instances).toHaveLength(1);
		expect(MockResizeObserver.instances[0]?.observedElements).toContain(node);

		act(() => {
			result.current.containerRef(null);
		});

		// Detaching tears down the observer and falls back to the window again.
		expect(MockResizeObserver.instances[0]?.disconnected).toBe(true);
	});

	it('subscribes to and unsubscribes from display-change notifications', () => {
		getActiveDisplay.mockResolvedValue(null);
		const unlisten = vi.fn();
		onDisplayChanged.mockReturnValue(Promise.resolve(unlisten));

		const { unmount } = renderHook(() => useDisplayDensity());
		expect(onDisplayChanged).toHaveBeenCalledTimes(1);

		unmount();
		return Promise.resolve().then(() => {
			expect(unlisten).toHaveBeenCalledTimes(1);
		});
	});

	it('re-measures the attached container, not the window, on a display-change event', () => {
		// Regression test: a display-change event used to call
		// setSize(readWindowSize()) unconditionally, clobbering a correct
		// container-based measurement with the window's width — with nothing
		// to correct it afterwards unless the container's own size also
		// happened to change. The handler must re-measure the container
		// directly when one is attached, and only fall back to the window
		// when none is.
		getActiveDisplay.mockResolvedValue(null);
		let displayChangeHandler: (() => void) | undefined;
		onDisplayChanged.mockImplementation((handler: () => void) => {
			displayChangeHandler = handler;
			return Promise.resolve(() => {});
		});

		const { result } = renderHook(() => useDisplayDensity());

		const node = document.createElement('div');
		vi.spyOn(node, 'getBoundingClientRect').mockReturnValue({
			width: 700,
			height: 500,
			top: 0,
			left: 0,
			right: 700,
			bottom: 500,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		});

		act(() => {
			result.current.containerRef(node);
		});

		act(() => {
			displayChangeHandler?.();
		});

		expect(result.current.viewportWidth).toBe(700);
		expect(result.current.viewportWidth).not.toBe(window.innerWidth);
	});
});
