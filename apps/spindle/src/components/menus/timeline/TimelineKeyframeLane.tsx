// One (node, target) property row: keyframe diamonds on a loop-relative time
// axis, drawn in the shared source-relative px space. Drag retimes with a
// local live-preview offset, committed once via `onMoveKeyframe` on
// pointer-up (one undo entry per drag, since the parent's writer maps
// straight onto a single `updateMenuDocument` call). Double-click a diamond
// opens the value/easing popover; double-click empty lane space inserts a
// keyframe at that time; Delete/Backspace removes the selected keyframe.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useCallback, useRef, useState } from 'react';
import type { AnimatableProperty, AnimationTrack, Easing, KeyValue } from '../../../types/project';
import type { TimelineGeometry } from './useTimelineGeometry';
import { evaluateTrack } from '../../../utils/animation';
import { KeyframeEditorPopover } from './KeyframeEditorPopover';

export interface TimelineKeyframeLaneProps {
	geometry: TimelineGeometry;
	track: AnimationTrack | null;
	nodeId: string;
	target: AnimatableProperty;
	loopStartSecs: number;
	loopDurationSecs: number;
	defaultValue: KeyValue;
	onAddKeyframe: (
		nodeId: string,
		target: AnimatableProperty,
		timestampSecs: number,
		value: KeyValue,
	) => void;
	onMoveKeyframe: (
		nodeId: string,
		target: AnimatableProperty,
		keyframeIndex: number,
		newTimestampSecs: number,
	) => void;
	onUpdateKeyframeValue: (
		nodeId: string,
		target: AnimatableProperty,
		keyframeIndex: number,
		value: KeyValue,
	) => void;
	onUpdateKeyframeEasing: (
		nodeId: string,
		target: AnimatableProperty,
		keyframeIndex: number,
		easing: Easing,
	) => void;
	onDeleteKeyframe: (nodeId: string, target: AnimatableProperty, keyframeIndex: number) => void;
	/** Seek playback (source-relative seconds) — called on a single click of
	 * the lane background (not a diamond). */
	onSeek?: (secs: number) => void;
}

export function TimelineKeyframeLane({
	geometry,
	track,
	nodeId,
	target,
	loopStartSecs,
	loopDurationSecs,
	defaultValue,
	onAddKeyframe,
	onMoveKeyframe,
	onUpdateKeyframeValue,
	onUpdateKeyframeEasing,
	onDeleteKeyframe,
	onSeek,
}: TimelineKeyframeLaneProps) {
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const [popoverIndex, setPopoverIndex] = useState<number | null>(null);
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dragTimestampSecs, setDragTimestampSecs] = useState<number | null>(null);
	const laneRef = useRef<HTMLDivElement>(null);

	const keyframes = track?.keyframes ?? [];

	const pxXFromClientX = useCallback((clientX: number) => {
		const rect = laneRef.current?.getBoundingClientRect();
		return rect ? clientX - rect.left : 0;
	}, []);

	const handleDiamondPointerDown = useCallback(
		(index: number, e: React.PointerEvent) => {
			e.stopPropagation();
			setSelectedIndex(index);
			setDragIndex(index);
			setDragTimestampSecs(keyframes[index].timestampSecs);
			(e.target as Element).setPointerCapture(e.pointerId);
		},
		[keyframes],
	);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (dragIndex === null) return;
			const pxX = pxXFromClientX(e.clientX);
			const newTimestamp = Math.max(0, geometry.pxToSecs(pxX) - loopStartSecs);
			setDragTimestampSecs(newTimestamp);
		},
		[dragIndex, geometry, loopStartSecs, pxXFromClientX],
	);

	const handlePointerUp = useCallback(() => {
		if (dragIndex === null || dragTimestampSecs === null) return;
		onMoveKeyframe(nodeId, target, dragIndex, dragTimestampSecs);
		setDragIndex(null);
		setDragTimestampSecs(null);
	}, [dragIndex, dragTimestampSecs, nodeId, onMoveKeyframe, target]);

	const handleLaneDoubleClick = useCallback(
		(e: React.MouseEvent) => {
			const pxX = pxXFromClientX(e.clientX);
			const timestampSecs = Math.max(0, geometry.pxToSecs(pxX) - loopStartSecs);
			const sampled = track ? evaluateTrack(track, timestampSecs) : null;
			onAddKeyframe(nodeId, target, timestampSecs, sampled ?? defaultValue);
		},
		[defaultValue, geometry, loopStartSecs, nodeId, onAddKeyframe, pxXFromClientX, target],
	);

	const handleLaneClick = useCallback(
		(e: React.MouseEvent) => {
			if (!onSeek) return;
			const pxX = pxXFromClientX(e.clientX);
			onSeek(Math.max(0, geometry.pxToSecs(pxX)));
		},
		[geometry, onSeek, pxXFromClientX],
	);

	const handleDiamondDoubleClick = useCallback((index: number, e: React.MouseEvent) => {
		e.stopPropagation();
		setPopoverIndex(index);
	}, []);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIndex !== null) {
				e.preventDefault();
				onDeleteKeyframe(nodeId, target, selectedIndex);
				setSelectedIndex(null);
			}
		},
		[nodeId, onDeleteKeyframe, selectedIndex, target],
	);

	const loopEndPx = geometry.secsToPx(loopStartSecs + Math.max(loopDurationSecs, 0));

	return (
		<div
			className="timeline-keyframe-lane"
			ref={laneRef}
			style={{ width: geometry.totalWidthPx }}
			onClick={handleLaneClick}
			onDoubleClick={handleLaneDoubleClick}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
			onKeyDown={handleKeyDown}
			tabIndex={0}
			role="group"
			aria-label={`${target} keyframes`}
		>
			<div className="timeline-keyframe-lane__loop-extent" style={{ width: loopEndPx }} />
			{keyframes.map((kf, index) => {
				const isDragging = dragIndex === index;
				const timestampSecs =
					isDragging && dragTimestampSecs !== null ? dragTimestampSecs : kf.timestampSecs;
				const pxX = geometry.secsToPx(loopStartSecs + timestampSecs);
				return (
					<button
						key={index}
						type="button"
						className={`timeline-keyframe-lane__diamond ${
							selectedIndex === index ? 'timeline-keyframe-lane__diamond--selected' : ''
						}`}
						style={{ left: pxX }}
						onPointerDown={(e) => handleDiamondPointerDown(index, e)}
						onDoubleClick={(e) => handleDiamondDoubleClick(index, e)}
						onClick={(e) => {
							e.stopPropagation();
							setSelectedIndex(index);
						}}
						title={`${kf.timestampSecs.toFixed(2)}s`}
						aria-label={`Keyframe at ${kf.timestampSecs.toFixed(2)} seconds`}
					>
						◆
					</button>
				);
			})}
			{popoverIndex !== null && keyframes[popoverIndex] && (
				<KeyframeEditorPopover
					keyframe={keyframes[popoverIndex]}
					target={target}
					onChangeValue={(value) => onUpdateKeyframeValue(nodeId, target, popoverIndex, value)}
					onChangeEasing={(easing) => onUpdateKeyframeEasing(nodeId, target, popoverIndex, easing)}
					onChangeTimestamp={(timestampSecs) =>
						onMoveKeyframe(nodeId, target, popoverIndex, timestampSecs)
					}
					onDelete={() => {
						onDeleteKeyframe(nodeId, target, popoverIndex);
						setPopoverIndex(null);
					}}
					onClose={() => setPopoverIndex(null)}
				/>
			)}
		</div>
	);
}
