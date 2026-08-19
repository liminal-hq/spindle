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

function renderLane(overrides: { track: AnimationTrack }) {
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
});
