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
	const onSeek = vi.fn();

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
			onSeek={onSeek}
		/>,
	);

	return { ...utils, onMoveKeyframe, onAddKeyframe, onDeleteKeyframe, onSeek };
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

	it('clears the selection when deleting through the popover button', () => {
		// Regression test: the popover's Delete Keyframe button cleared only
		// the popover; the successor keyframe inherited the deleted one's
		// index and its stale selection, so a follow-up lane Delete keypress
		// removed it unintentionally.
		const { getAllByRole, getByRole, getByText, onDeleteKeyframe } = renderLane({
			track: twoKeyframeTrack,
		});
		const [firstDiamond] = getAllByRole('button', { name: /keyframe at/i });
		fireEvent.click(firstDiamond);
		fireEvent.doubleClick(firstDiamond);
		fireEvent.click(getByText('Delete Keyframe'));
		expect(onDeleteKeyframe).toHaveBeenCalledTimes(1);

		const lane = getByRole('group');
		fireEvent.keyDown(lane, { key: 'Delete' });
		expect(onDeleteKeyframe).toHaveBeenCalledTimes(1);
	});

	it('closes an open popover when keyboard deletion removes its keyframe', () => {
		// Regression test: double-clicking a diamond opens the popover AND
		// leaves that diamond focused/selected, so Delete reaches the lane's
		// key handler. Deleting at/before the popover's index re-points that
		// index at the next keyframe — the popover must close, not rebind.
		const { getAllByRole, getByRole, queryByRole, onDeleteKeyframe } = renderLane({
			track: twoKeyframeTrack,
		});
		const [firstDiamond] = getAllByRole('button', { name: /keyframe at/i });
		fireEvent.click(firstDiamond);
		fireEvent.doubleClick(firstDiamond);
		expect(getByRole('dialog')).toBeTruthy();

		const lane = getByRole('group');
		fireEvent.keyDown(lane, { key: 'Delete' });

		expect(onDeleteKeyframe).toHaveBeenCalledWith('btn-1', 'highlight-colour', 0);
		expect(queryByRole('dialog')).toBeNull();
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

	it('clamps a typed timestamp past loopDurationSecs to the loop end', () => {
		// Regression test: only the lower bound (0) was clamped on the
		// popover's timestamp field, so typing a value past loopDurationSecs
		// persisted it unclamped and tripped `menu.motion-keyframe-out-of-range`.
		const { getAllByRole, getByRole, onMoveKeyframe } = renderLane({ track: twoKeyframeTrack });
		const [firstDiamond] = getAllByRole('button', { name: /keyframe at/i });
		fireEvent.doubleClick(firstDiamond);

		const timestampInput = getByRole('spinbutton', { name: /timestamp/i });
		fireEvent.change(timestampInput, { target: { value: '15' } }); // past loopDurationSecs=10

		expect(onMoveKeyframe).toHaveBeenCalledWith('btn-1', 'highlight-colour', 0, 10);
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

	it('does not seek or insert a keyframe when clicking/double-clicking inside the open popover', () => {
		// Regression test: the popover is rendered as a child of the lane it
		// edits, so a click/double-click on one of its fields would otherwise
		// bubble up to the lane's own click (seek) and double-click (insert)
		// handlers.
		const { getAllByRole, getByRole, onAddKeyframe, onSeek } = renderLane({
			track: twoKeyframeTrack,
		});
		const [firstDiamond] = getAllByRole('button', { name: /keyframe at/i });
		fireEvent.doubleClick(firstDiamond);
		expect(getByRole('dialog')).toBeTruthy();
		onAddKeyframe.mockClear();

		const timestampInput = getByRole('spinbutton', { name: /timestamp/i });
		fireEvent.click(timestampInput);
		fireEvent.doubleClick(timestampInput);

		expect(onSeek).not.toHaveBeenCalled();
		expect(onAddKeyframe).not.toHaveBeenCalled();
		expect(getByRole('dialog')).toBeTruthy();
	});

	it('closes the popover when a keyframe is inserted before it', () => {
		// Regression test: inserting a keyframe re-sorts the track's array
		// (see `animationWriters.addKeyframe`) — a new keyframe timestamped
		// before the open popover's keyframe shifts that keyframe's index up
		// by one. Without a fix, the popover would silently keep editing
		// whatever keyframe the sort left behind at the stale index.
		const { getAllByRole, getByRole, queryByRole } = renderLane({ track: twoKeyframeTrack });
		const [, secondDiamond] = getAllByRole('button', { name: /keyframe at/i });
		fireEvent.doubleClick(secondDiamond); // popover open on the 5s keyframe (index 1)
		expect(getByRole('dialog')).toBeTruthy();

		const lane = getByRole('group');
		fireEvent.doubleClick(lane, { clientX: 80 }); // 2s, before the open 5s keyframe

		expect(queryByRole('dialog')).toBeNull();
	});

	it('keeps the popover open when a keyframe is inserted after it', () => {
		const { getAllByRole, getByRole } = renderLane({ track: twoKeyframeTrack });
		const [firstDiamond] = getAllByRole('button', { name: /keyframe at/i });
		fireEvent.doubleClick(firstDiamond); // popover open on the 1s keyframe (index 0)
		expect(getByRole('dialog')).toBeTruthy();

		const lane = getByRole('group');
		fireEvent.doubleClick(lane, { clientX: 320 }); // 8s, after the open 1s keyframe

		expect(getByRole('dialog')).toBeTruthy();
	});

	it('does not retime a keyframe to 0 while its popover timestamp field is emptied', () => {
		// Regression test: the controlled timestamp input committed on every
		// change, so clearing the field made `Number('') === 0` retime the
		// keyframe to 0 immediately — for a non-first keyframe that crosses its
		// neighbour, re-sorts the array, and closes the popover before a
		// replacement value could be typed.
		const { getAllByRole, getByRole, queryByRole, onMoveKeyframe } = renderLane({
			track: twoKeyframeTrack,
		});
		const [, secondDiamond] = getAllByRole('button', { name: /keyframe at/i });
		fireEvent.doubleClick(secondDiamond); // popover open on the 5s keyframe (index 1)
		expect(getByRole('dialog')).toBeTruthy();

		const timestampInput = getByRole('spinbutton', { name: /timestamp/i });
		fireEvent.change(timestampInput, { target: { value: '' } });

		expect(onMoveKeyframe).not.toHaveBeenCalled();
		expect(queryByRole('dialog')).toBeTruthy();
		expect((timestampInput as HTMLInputElement).value).toBe('');

		// Typing a replacement value still commits normally.
		fireEvent.change(timestampInput, { target: { value: '3' } });
		expect(onMoveKeyframe).toHaveBeenCalledWith('btn-1', 'highlight-colour', 1, 3);
	});
});
