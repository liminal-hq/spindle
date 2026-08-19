// Tests for TimelineKeyframeLane's drag interaction: a keyframe drag that
// generates several pointermove events must still commit exactly once, on
// pointer-up — that's what gives one undo entry per drag (see
// `project-store`'s `updateMenuDocument`, which pushes one undo entry per
// call).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { AnimationTrack } from '../../../types/project';
import { TimelineKeyframeLane } from './TimelineKeyframeLane';
import type { TimelineKeyframeLaneProps } from './TimelineKeyframeLane';
import { computeTimelineGeometry } from './useTimelineGeometry';

function renderLane(overrides: { track: AnimationTrack; fps?: number }) {
	const geometry = computeTimelineGeometry(20, 40); // 40px/sec
	const onMoveKeyframe = vi.fn();
	const onAddKeyframe = vi.fn();
	const onDeleteKeyframe = vi.fn();

	const utils = render(
		<TimelineKeyframeLane
			geometry={geometry}
			track={overrides.track}
			nodeId="btn-1"
			target="highlight-colour"
			loopStartSecs={0}
			loopDurationSecs={10}
			fps={overrides.fps ?? 30}
			defaultValue={{ kind: 'colour', hex: '#ffffff' }}
			onAddKeyframe={onAddKeyframe as TimelineKeyframeLaneProps['onAddKeyframe']}
			onMoveKeyframe={onMoveKeyframe as TimelineKeyframeLaneProps['onMoveKeyframe']}
			onUpdateKeyframeValue={vi.fn() as TimelineKeyframeLaneProps['onUpdateKeyframeValue']}
			onUpdateKeyframeEasing={vi.fn() as TimelineKeyframeLaneProps['onUpdateKeyframeEasing']}
			onDeleteKeyframe={onDeleteKeyframe as TimelineKeyframeLaneProps['onDeleteKeyframe']}
		/>,
	);

	return { ...utils, onMoveKeyframe, onAddKeyframe, onDeleteKeyframe };
}

const oneKeyframeTrack: AnimationTrack = {
	nodeId: 'btn-1',
	target: 'highlight-colour',
	keyframes: [{ timestampSecs: 1, value: { kind: 'colour', hex: '#111111' }, easing: 'hold' }],
};

const twoKeyframeTrack: AnimationTrack = {
	nodeId: 'btn-1',
	target: 'highlight-colour',
	keyframes: [
		{ timestampSecs: 1, value: { kind: 'colour', hex: '#111111' }, easing: 'hold' },
		{ timestampSecs: 5, value: { kind: 'colour', hex: '#222222' }, easing: 'hold' },
	],
};

describe('TimelineKeyframeLane', () => {
	it('renders one diamond per keyframe', () => {
		const { getAllByRole } = renderLane({ track: oneKeyframeTrack });
		expect(getAllByRole('button', { name: /keyframe at/i })).toHaveLength(1);
	});

	it('commits exactly once on pointer-up after several pointermoves', () => {
		const { getByRole, onMoveKeyframe } = renderLane({ track: oneKeyframeTrack });
		const diamond = getByRole('button', { name: /keyframe at/i });
		(diamond as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};

		fireEvent.pointerDown(diamond, { clientX: 40, pointerId: 1 });
		const lane = diamond.closest('[role="group"]')!;
		fireEvent.pointerMove(lane, { clientX: 60 });
		fireEvent.pointerMove(lane, { clientX: 80 });
		fireEvent.pointerMove(lane, { clientX: 120 });
		expect(onMoveKeyframe).not.toHaveBeenCalled();

		fireEvent.pointerUp(lane);

		expect(onMoveKeyframe).toHaveBeenCalledTimes(1);
		// getBoundingClientRect() is 0 in jsdom, so clientX == px offset from
		// the lane's left edge: 120px / 40px-per-sec = 3s.
		expect(onMoveKeyframe).toHaveBeenCalledWith('btn-1', 'highlight-colour', 0, 3);
	});

	it('double-clicking empty lane space adds a keyframe sampling the current value', () => {
		const { getByRole, onAddKeyframe } = renderLane({ track: oneKeyframeTrack });
		const lane = getByRole('group');
		fireEvent.doubleClick(lane, { clientX: 200 }); // 200px / 40px-per-sec = 5s

		expect(onAddKeyframe).toHaveBeenCalledTimes(1);
		const [nodeId, target, timestampSecs] = onAddKeyframe.mock.calls[0];
		expect(nodeId).toBe('btn-1');
		expect(target).toBe('highlight-colour');
		expect(timestampSecs).toBe(5);
	});

	it('Delete key removes the selected keyframe', () => {
		const { getByRole, onDeleteKeyframe } = renderLane({ track: oneKeyframeTrack });
		const diamond = getByRole('button', { name: /keyframe at/i });
		fireEvent.click(diamond);
		const lane = getByRole('group');
		fireEvent.keyDown(lane, { key: 'Delete' });

		expect(onDeleteKeyframe).toHaveBeenCalledWith('btn-1', 'highlight-colour', 0);
	});

	it('a click without a drag (pointerdown, pointerup, no pointermove) does not commit a move', () => {
		// Regression test: selecting a diamond with a plain click must not
		// write an identity retime and burn an undo entry.
		const { getByRole, onMoveKeyframe } = renderLane({ track: oneKeyframeTrack });
		const diamond = getByRole('button', { name: /keyframe at/i });
		(diamond as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};

		fireEvent.pointerDown(diamond, { clientX: 40, pointerId: 1 });
		fireEvent.pointerUp(diamond.closest('[role="group"]')!);

		expect(onMoveKeyframe).not.toHaveBeenCalled();
	});

	it('clamps a drag to the loop window and snaps it to a frame boundary', () => {
		// 40px/sec, 10fps, loopDurationSecs=10: dragging to 1000px (25s) must
		// clamp to the 10s loop end; dragging to 41px (1.025s) must snap to the
		// nearest 0.1s frame boundary (1.0s).
		const { getByRole, onMoveKeyframe } = renderLane({ track: oneKeyframeTrack, fps: 10 });
		const diamond = getByRole('button', { name: /keyframe at/i });
		(diamond as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
		const lane = diamond.closest('[role="group"]')!;

		fireEvent.pointerDown(diamond, { clientX: 40, pointerId: 1 });
		fireEvent.pointerMove(lane, { clientX: 1000 });
		fireEvent.pointerUp(lane);

		expect(onMoveKeyframe).toHaveBeenCalledWith('btn-1', 'highlight-colour', 0, 10);
	});

	it('snaps an inserted keyframe to a frame boundary', () => {
		const { getByRole, onAddKeyframe } = renderLane({ track: oneKeyframeTrack, fps: 10 });
		const lane = getByRole('group');
		// 41px / 40px-per-sec = 1.025s, which snaps to 1.0s at 10fps.
		fireEvent.doubleClick(lane, { clientX: 41 });

		const [, , timestampSecs] = onAddKeyframe.mock.calls[0];
		expect(timestampSecs).toBeCloseTo(1.0, 9);
	});

	it('closes the popover when its own timestamp edit retimes it past a neighbour', () => {
		// Regression test: editing the timestamp field inside an open popover
		// so it crosses the OTHER keyframe re-sorts the array. The popover
		// must close rather than keep editing under a now-stale index.
		const { getAllByRole, getByRole, queryByRole, onMoveKeyframe } = renderLane({
			track: twoKeyframeTrack,
		});
		const [firstDiamond] = getAllByRole('button', { name: /keyframe at/i });
		fireEvent.doubleClick(firstDiamond);
		expect(getByRole('dialog')).toBeTruthy();

		const timestampInput = getByRole('spinbutton', { name: /timestamp/i });
		fireEvent.change(timestampInput, { target: { value: '6' } });

		expect(onMoveKeyframe).toHaveBeenCalledWith('btn-1', 'highlight-colour', 0, 6);
		expect(queryByRole('dialog')).toBeNull();
	});

	it('keeps the popover open when a timestamp edit does not cross a neighbour', () => {
		const { getAllByRole, getByRole, onMoveKeyframe } = renderLane({ track: twoKeyframeTrack });
		const [firstDiamond] = getAllByRole('button', { name: /keyframe at/i });
		fireEvent.doubleClick(firstDiamond);

		const timestampInput = getByRole('spinbutton', { name: /timestamp/i });
		fireEvent.change(timestampInput, { target: { value: '2' } }); // still before the 5s keyframe

		expect(onMoveKeyframe).toHaveBeenCalledWith('btn-1', 'highlight-colour', 0, 2);
		expect(getByRole('dialog')).toBeTruthy();
	});

	it('closes an open popover when a DIFFERENT keyframe is dragged past it', () => {
		// The finding's core scenario: dragging one keyframe across another
		// re-sorts the array out from under an unrelated open popover.
		const { getAllByRole, getByRole, queryByRole } = renderLane({ track: twoKeyframeTrack });
		const [firstDiamond, secondDiamond] = getAllByRole('button', { name: /keyframe at/i });
		fireEvent.doubleClick(secondDiamond); // popover open on the 5s keyframe (index 1)
		expect(getByRole('dialog')).toBeTruthy();

		(firstDiamond as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
		fireEvent.pointerDown(firstDiamond, { clientX: 40, pointerId: 1 }); // 1s keyframe
		const lane = firstDiamond.closest('[role="group"]')!;
		fireEvent.pointerMove(lane, { clientX: 280 }); // 7s, past the 5s neighbour
		fireEvent.pointerUp(lane);

		expect(queryByRole('dialog')).toBeNull();
	});
});
