// Tests for the display-density breakpoint hook.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { classify, useDisplayDensity, type DisplayGeometry } from './useDisplayDensity';

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
});
