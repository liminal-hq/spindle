// One (node, target) property row of keyframe diamonds on a loop-relative
// time axis.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

// Drawn in the shared source-relative px space. Drag retimes with a local
// live-preview offset, committed once via `onMoveKeyframe` on pointer-up
// (one undo entry per drag, since the parent's writer maps straight onto a
// single `updateMenuDocument` call). Double-click a diamond opens the
// value/easing popover; double-click empty lane space inserts a keyframe at
// that time; Delete/Backspace removes the selected keyframe.

import { useCallback, useRef, useState } from 'react';
import type { AnimatableProperty, AnimationTrack, Easing, KeyValue } from '../../../types/project';
import type { TimelineGeometry } from './useTimelineGeometry';
import { snapSecsToFrame } from './useTimelineGeometry';
import { evaluateTrack } from '../../../utils/animation';
import { KeyframeEditorPopover } from './KeyframeEditorPopover';

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

export interface TimelineKeyframeLaneProps {
	geometry: TimelineGeometry;
	track: AnimationTrack | null;
	nodeId: string;
	target: AnimatableProperty;
	loopStartSecs: number;
	loopDurationSecs: number;
	/** Frame rate used to snap dragged/inserted keyframe timestamps to frame
	 * boundaries — the project's disc standard (NTSC/PAL), not a hardcoded
	 * 30fps. */
	fps: number;
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
	fps,
	defaultValue,
	onAddKeyframe,
	onMoveKeyframe,
	onUpdateKeyframeValue,
	onUpdateKeyframeEasing,
	onDeleteKeyframe,
	onSeek,
}: TimelineKeyframeLaneProps) {
	// Selection and the open popover are bound by keyframe IDENTITY — the
	// keyframe's timestamp — not by array index. The array can be re-sorted or
	// grown by paths this lane never sees (the inspector's add-at-playhead,
	// the editor's global undo, a drag or retime crossing a neighbour), and
	// every index-keyed binding eventually pointed at the wrong keyframe in
	// one of them. A timestamp binding follows its keyframe through all of
	// that; the indices the parent's writers need are derived fresh each
	// render, and a binding whose keyframe no longer exists derives to null.
	const [selectedStamp, setSelectedStamp] = useState<number | null>(null);
	const [popoverStamp, setPopoverStamp] = useState<number | null>(null);
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dragTimestampSecs, setDragTimestampSecs] = useState<number | null>(null);
	const laneRef = useRef<HTMLDivElement>(null);
	// Whether a `pointermove` has actually landed since the current drag's
	// `pointerdown` — a plain click (down, up, no move) must NOT commit, or
	// every click-to-select on a diamond writes an identity retime and burns
	// an undo entry for nothing.
	const hasMovedRef = useRef(false);

	const keyframes = track?.keyframes ?? [];

	const indexForStamp = (stamp: number | null): number | null => {
		if (stamp === null) return null;
		const i = keyframes.findIndex((kf) => kf.timestampSecs === stamp);
		return i >= 0 ? i : null;
	};
	const selectedIndex = indexForStamp(selectedStamp);
	const popoverIndex = indexForStamp(popoverStamp);
	// A binding whose keyframe doesn't (currently) exist derives to null and
	// renders nothing — deliberately WITHOUT clearing the stored stamp, so a
	// retime whose parent commit lands a render later re-binds seamlessly.
	// Deleting through the popover clears its stamps explicitly below.

	const pxXFromClientX = useCallback((clientX: number) => {
		const rect = laneRef.current?.getBoundingClientRect();
		return rect ? clientX - rect.left : 0;
	}, []);

	const handleDiamondPointerDown = useCallback(
		(index: number, e: React.PointerEvent) => {
			e.stopPropagation();
			setSelectedStamp(keyframes[index].timestampSecs);
			setDragIndex(index);
			setDragTimestampSecs(keyframes[index].timestampSecs);
			hasMovedRef.current = false;
			(e.target as Element).setPointerCapture(e.pointerId);
		},
		[keyframes],
	);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (dragIndex === null) return;
			hasMovedRef.current = true;
			const pxX = pxXFromClientX(e.clientX);
			const rawSecs = Math.max(0, geometry.pxToSecs(pxX) - loopStartSecs);
			const snapped = snapSecsToFrame(rawSecs, fps);
			const newTimestamp = clamp(snapped, 0, loopDurationSecs);
			setDragTimestampSecs(newTimestamp);
		},
		[dragIndex, fps, geometry, loopDurationSecs, loopStartSecs, pxXFromClientX],
	);

	const handlePointerUp = useCallback(() => {
		if (dragIndex === null || dragTimestampSecs === null) return;
		if (hasMovedRef.current) {
			// The dragged keyframe's identity IS its timestamp — retarget any
			// binding that referred to the old one before committing, so the
			// selection/popover follow the keyframe to its new time (a reorder
			// re-sorts the array, but identity bindings don't care).
			const oldStamp = keyframes[dragIndex]?.timestampSecs ?? null;
			if (oldStamp !== null) {
				if (selectedStamp === oldStamp) setSelectedStamp(dragTimestampSecs);
				if (popoverStamp === oldStamp) setPopoverStamp(dragTimestampSecs);
			}
			onMoveKeyframe(nodeId, target, dragIndex, dragTimestampSecs);
		}
		setDragIndex(null);
		setDragTimestampSecs(null);
	}, [
		dragIndex,
		dragTimestampSecs,
		keyframes,
		nodeId,
		onMoveKeyframe,
		popoverStamp,
		selectedStamp,
		target,
	]);

	const handleLaneDoubleClick = useCallback(
		(e: React.MouseEvent) => {
			const pxX = pxXFromClientX(e.clientX);
			const rawSecs = Math.max(0, geometry.pxToSecs(pxX) - loopStartSecs);
			const timestampSecs = clamp(snapSecsToFrame(rawSecs, fps), 0, loopDurationSecs);
			const sampled = track ? evaluateTrack(track, timestampSecs) : null;
			// Insertion re-sorts the array, but the popover/selection bindings
			// are timestamp-keyed and simply follow their keyframe — no
			// clearing needed.
			onAddKeyframe(nodeId, target, timestampSecs, sampled ?? defaultValue);
		},
		[
			defaultValue,
			fps,
			geometry,
			loopDurationSecs,
			loopStartSecs,
			nodeId,
			onAddKeyframe,
			pxXFromClientX,
			target,
			track,
		],
	);

	const handleLaneClick = useCallback(
		(e: React.MouseEvent) => {
			if (!onSeek) return;
			const pxX = pxXFromClientX(e.clientX);
			onSeek(Math.max(0, geometry.pxToSecs(pxX)));
		},
		[geometry, onSeek, pxXFromClientX],
	);

	const handleDiamondDoubleClick = useCallback(
		(index: number, e: React.MouseEvent) => {
			e.stopPropagation();
			setPopoverStamp(keyframes[index].timestampSecs);
		},
		[keyframes],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIndex !== null) {
				e.preventDefault();
				// Deleting the popover's OWN keyframe closes it; deleting a
				// different one leaves it bound (identity-keyed) to its own.
				if (popoverStamp !== null && popoverStamp === selectedStamp) {
					setPopoverStamp(null);
				}
				onDeleteKeyframe(nodeId, target, selectedIndex);
				setSelectedStamp(null);
			}
		},
		[nodeId, onDeleteKeyframe, popoverStamp, selectedIndex, selectedStamp, target],
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
							// The pointerup that ends a real drag is followed by a
							// trailing native `click` on this same element. After a
							// reorder, `index` may now be a DIFFERENT keyframe than
							// the one dragged — consume the click so it can't move
							// the selection off the keyframe the user actually
							// dragged (pointer-up already retargeted its binding).
							if (hasMovedRef.current) {
								hasMovedRef.current = false;
								return;
							}
							setSelectedStamp(kf.timestampSecs);
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
					loopDurationSecs={loopDurationSecs}
					anchorPx={geometry.secsToPx(loopStartSecs + keyframes[popoverIndex].timestampSecs)}
					onChangeValue={(value) => onUpdateKeyframeValue(nodeId, target, popoverIndex, value)}
					onChangeEasing={(easing) => onUpdateKeyframeEasing(nodeId, target, popoverIndex, easing)}
					onChangeTimestamp={(timestampSecs) => {
						// The keyframe's identity IS its timestamp — retarget the
						// bindings to the new time before committing so they keep
						// following the keyframe through any re-sort.
						if (selectedStamp === popoverStamp) setSelectedStamp(timestampSecs);
						setPopoverStamp(timestampSecs);
						onMoveKeyframe(nodeId, target, popoverIndex, timestampSecs);
					}}
					onDelete={() => {
						onDeleteKeyframe(nodeId, target, popoverIndex);
						setPopoverStamp(null);
						// Clear a selection bound to the same (deleted) keyframe so
						// a follow-up lane Delete keypress can't fire on nothing —
						// a selection on a DIFFERENT keyframe stays.
						if (selectedStamp === popoverStamp) setSelectedStamp(null);
					}}
					onClose={() => setPopoverStamp(null)}
				/>
			)}
		</div>
	);
}
