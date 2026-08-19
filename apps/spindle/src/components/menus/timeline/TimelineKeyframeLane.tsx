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
import type {
	AnimatableProperty,
	AnimationTrack,
	Easing,
	Keyframe,
	KeyValue,
} from '../../../types/project';
import type { TimelineGeometry } from './useTimelineGeometry';
import { snapSecsToFrame } from './useTimelineGeometry';
import { evaluateTrack } from '../../../utils/animation';
import { KeyframeEditorPopover } from './KeyframeEditorPopover';

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/** Whether retiming the keyframe at `index` to `newTimestampSecs` would move
 * it across an immediate neighbour, which `moveKeyframe` resolves by
 * re-sorting the whole array. Index-keyed UI state (selection, the open
 * popover) that refers to a DIFFERENT keyframe than the one just retimed
 * must not survive a reorder — it would silently point at whatever
 * keyframe the sort left behind at that index. */
function willReorder(keyframes: Keyframe[], index: number, newTimestampSecs: number): boolean {
	const prev = keyframes[index - 1];
	const next = keyframes[index + 1];
	if (prev && newTimestampSecs < prev.timestampSecs) return true;
	if (next && newTimestampSecs > next.timestampSecs) return true;
	return false;
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
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const [popoverIndex, setPopoverIndex] = useState<number | null>(null);
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dragTimestampSecs, setDragTimestampSecs] = useState<number | null>(null);
	const laneRef = useRef<HTMLDivElement>(null);
	// Whether a `pointermove` has actually landed since the current drag's
	// `pointerdown` — a plain click (down, up, no move) must NOT commit, or
	// every click-to-select on a diamond writes an identity retime and burns
	// an undo entry for nothing.
	const hasMovedRef = useRef(false);

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
			if (willReorder(keyframes, dragIndex, dragTimestampSecs)) {
				// The commit below re-sorts the array; any open popover or
				// selection keyed by index would silently start pointing at
				// whatever keyframe the sort left at that index. Close/clear
				// rather than risk an edit or delete landing on the wrong one.
				setSelectedIndex(null);
				setPopoverIndex(null);
			}
			onMoveKeyframe(nodeId, target, dragIndex, dragTimestampSecs);
		}
		setDragIndex(null);
		setDragTimestampSecs(null);
	}, [dragIndex, dragTimestampSecs, keyframes, nodeId, onMoveKeyframe, target]);

	const handleLaneDoubleClick = useCallback(
		(e: React.MouseEvent) => {
			const pxX = pxXFromClientX(e.clientX);
			const rawSecs = Math.max(0, geometry.pxToSecs(pxX) - loopStartSecs);
			const timestampSecs = clamp(snapSecsToFrame(rawSecs, fps), 0, loopDurationSecs);
			const sampled = track ? evaluateTrack(track, timestampSecs) : null;
			// Inserting re-sorts the track's keyframes (see `animationWriters`'
			// `addKeyframe`): a new keyframe timestamped strictly before the
			// popover's/selection's keyframe shifts that keyframe's index up by
			// one. Same stale-index hazard `willReorder` guards against above —
			// close rather than silently let the popover/selection drift onto
			// whatever keyframe the sort left behind at that index.
			if (popoverIndex !== null && timestampSecs < keyframes[popoverIndex].timestampSecs) {
				setPopoverIndex(null);
			}
			if (selectedIndex !== null && timestampSecs < keyframes[selectedIndex].timestampSecs) {
				setSelectedIndex(null);
			}
			onAddKeyframe(nodeId, target, timestampSecs, sampled ?? defaultValue);
		},
		[
			defaultValue,
			fps,
			geometry,
			keyframes,
			loopDurationSecs,
			loopStartSecs,
			nodeId,
			onAddKeyframe,
			popoverIndex,
			pxXFromClientX,
			selectedIndex,
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

	const handleDiamondDoubleClick = useCallback((index: number, e: React.MouseEvent) => {
		e.stopPropagation();
		setPopoverIndex(index);
	}, []);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIndex !== null) {
				e.preventDefault();
				// Deleting at or before the popover's index shifts what that
				// index points at — the same stale-index hazard the insert and
				// retime paths guard against, so close rather than let the
				// popover silently rebind to the next keyframe.
				if (popoverIndex !== null && selectedIndex <= popoverIndex) {
					setPopoverIndex(null);
				}
				onDeleteKeyframe(nodeId, target, selectedIndex);
				setSelectedIndex(null);
			}
		},
		[nodeId, onDeleteKeyframe, popoverIndex, selectedIndex, target],
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
					loopDurationSecs={loopDurationSecs}
					anchorPx={geometry.secsToPx(loopStartSecs + keyframes[popoverIndex].timestampSecs)}
					onChangeValue={(value) => onUpdateKeyframeValue(nodeId, target, popoverIndex, value)}
					onChangeEasing={(easing) => onUpdateKeyframeEasing(nodeId, target, popoverIndex, easing)}
					onChangeTimestamp={(timestampSecs) => {
						// Same stale-index hazard as the drag path above: retiming
						// past a neighbour re-sorts the array, so keep editing the
						// keyframe under the popover only while it's still the one
						// at `popoverIndex` after the commit — otherwise close it.
						if (willReorder(keyframes, popoverIndex, timestampSecs)) {
							setSelectedIndex(null);
							setPopoverIndex(null);
						}
						onMoveKeyframe(nodeId, target, popoverIndex, timestampSecs);
					}}
					onDelete={() => {
						onDeleteKeyframe(nodeId, target, popoverIndex);
						setPopoverIndex(null);
						// A successor keyframe inherits the deleted one's index
						// on the rerender — clear the selection too, or a lane
						// Delete keypress removes it unintentionally (same
						// guard as the keyboard-deletion path).
						setSelectedIndex(null);
					}}
					onClose={() => setPopoverIndex(null)}
				/>
			)}
		</div>
	);
}
