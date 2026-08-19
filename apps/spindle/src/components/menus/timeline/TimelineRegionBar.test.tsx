// Tests for TimelineRegionBar's edge-drag clamping: an edge drag must stay
// within the known source duration, or it persists an intro/loop end past
// the background asset and trips `menu.motion-loop-exceeds-source`/
// `menu.motion-intro-invalid` on the next validate.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { MenuTiming } from '../../../types/project';
import { TimelineRegionBar } from './TimelineRegionBar';
import { computeTimelineGeometry } from './useTimelineGeometry';

function renderBar(timing: MenuTiming, durationSecs: number, minLoopDurationSecs?: number) {
	const geometry = computeTimelineGeometry(durationSecs, 40); // 40px/sec
	const onSetTimingField = vi.fn();

	const utils = render(
		<TimelineRegionBar
			geometry={geometry}
			timing={timing}
			fps={30}
			minLoopDurationSecs={minLoopDurationSecs}
			onSetTimingField={onSetTimingField}
		/>,
	);

	return { ...utils, onSetTimingField };
}

const baseTiming: MenuTiming = {
	introStartSecs: 0,
	introDurationSecs: 0,
	loopStartSecs: 0,
	loopDurationSecs: 8,
	loopCount: 0,
	audioAssetId: null,
};

describe('TimelineRegionBar', () => {
	it('clamps a loop-end drag past the known duration to the duration', () => {
		// 10s source; dragging to 2000px (50s) must clamp to the 10s duration.
		const { container, onSetTimingField } = renderBar(baseTiming, 10);
		const loopEndHandle = container.querySelector(
			'.timeline-region-bar__region--loop .timeline-region-bar__edge--end',
		)!;
		(loopEndHandle as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
		const bar = container.querySelector('.timeline-region-bar')!;

		fireEvent.pointerDown(loopEndHandle, { clientX: 320, pointerId: 1 }); // 8s
		fireEvent.pointerMove(bar, { clientX: 2000 }); // 50s
		fireEvent.pointerUp(bar);

		expect(onSetTimingField).toHaveBeenCalledWith({ loopDurationSecs: 10 });
	});

	it('clamps an intro-end drag past the known duration to the duration', () => {
		const timing: MenuTiming = { ...baseTiming, introDurationSecs: 2 };
		const { container, onSetTimingField } = renderBar(timing, 10);
		const introEndHandle = container.querySelector(
			'.timeline-region-bar__region--intro .timeline-region-bar__edge--end',
		)!;
		(introEndHandle as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
		const bar = container.querySelector('.timeline-region-bar')!;

		fireEvent.pointerDown(introEndHandle, { clientX: 80, pointerId: 1 }); // 2s
		fireEvent.pointerMove(bar, { clientX: 2000 }); // 50s
		fireEvent.pointerUp(bar);

		expect(onSetTimingField).toHaveBeenCalledWith({ introDurationSecs: 10 });
	});

	it('refuses to shorten the loop below the latest animation keyframe', () => {
		// 8s loop, latest keyframe at 6s (loop-relative). Dragging loop-end to
		// 3s must clamp the duration to 6s, or the keyframe is stranded out of
		// range and `menu.motion-keyframe-out-of-range` fails the next build.
		const { container, onSetTimingField } = renderBar(baseTiming, 10, 6);
		const loopEndHandle = container.querySelector(
			'.timeline-region-bar__region--loop .timeline-region-bar__edge--end',
		)!;
		(loopEndHandle as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
		const bar = container.querySelector('.timeline-region-bar')!;

		fireEvent.pointerDown(loopEndHandle, { clientX: 320, pointerId: 1 }); // 8s
		fireEvent.pointerMove(bar, { clientX: 120 }); // 3s
		fireEvent.pointerUp(bar);

		expect(onSetTimingField).toHaveBeenCalledWith({ loopDurationSecs: 6 });
	});

	it('refuses to drag the loop start past the latest keyframe-preserving duration', () => {
		// Loop 0..8 with latest keyframe at 6s: dragging the start to 5s would
		// leave only 3s of loop — it must clamp to 2s so 6s of loop remain.
		const { container, onSetTimingField } = renderBar(baseTiming, 10, 6);
		const loopStartHandle = container.querySelector(
			'.timeline-region-bar__region--loop .timeline-region-bar__edge--start',
		)!;
		(loopStartHandle as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
		const bar = container.querySelector('.timeline-region-bar')!;

		fireEvent.pointerDown(loopStartHandle, { clientX: 0, pointerId: 1 }); // 0s
		fireEvent.pointerMove(bar, { clientX: 200 }); // 5s
		fireEvent.pointerUp(bar);

		expect(onSetTimingField).toHaveBeenCalledWith({
			loopStartSecs: 2,
			loopDurationSecs: 6,
		});
	});

	it('leaves an in-bounds loop-end drag unclamped', () => {
		const { container, onSetTimingField } = renderBar(baseTiming, 10);
		const loopEndHandle = container.querySelector(
			'.timeline-region-bar__region--loop .timeline-region-bar__edge--end',
		)!;
		(loopEndHandle as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
		const bar = container.querySelector('.timeline-region-bar')!;

		fireEvent.pointerDown(loopEndHandle, { clientX: 320, pointerId: 1 }); // 8s
		fireEvent.pointerMove(bar, { clientX: 360 }); // 9s
		fireEvent.pointerUp(bar);

		expect(onSetTimingField).toHaveBeenCalledWith({ loopDurationSecs: 9 });
	});
});
