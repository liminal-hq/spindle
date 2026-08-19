// Intro + loop region blocks. Dragging an edge retimes the corresponding
// `MenuTiming` field with a local live-preview offset, committed once on
// pointer-up via `onSetTimingField` (one undo entry per drag).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useCallback, useRef, useState } from 'react';
import type { MenuTiming } from '../../../types/project';
import type { TimelineGeometry } from './useTimelineGeometry';
import { snapSecsToFrame } from './useTimelineGeometry';

export interface TimelineRegionBarProps {
	geometry: TimelineGeometry;
	timing: MenuTiming;
	/** Frame rate used to snap dragged edges to frame boundaries, and to floor
	 * the minimum intro/loop duration at one frame — the project's disc
	 * standard (NTSC/PAL), not a hardcoded 30fps. */
	fps: number;
	onSetTimingField: (patch: Partial<MenuTiming>) => void;
}

type EdgeId = 'introStart' | 'introEnd' | 'loopStart' | 'loopEnd';

export function TimelineRegionBar({ geometry, timing, fps, onSetTimingField }: TimelineRegionBarProps) {
	const barRef = useRef<HTMLDivElement>(null);
	const [dragEdge, setDragEdge] = useState<EdgeId | null>(null);
	const [dragSecs, setDragSecs] = useState<number | null>(null);
	// Whether a `pointermove` has actually landed since the current drag's
	// `pointerdown` — a plain click on an edge handle (down, up, no move)
	// must NOT commit, or every click writes an identity retime and burns an
	// undo entry for nothing.
	const hasMovedRef = useRef(false);

	const hasIntro = timing.introDurationSecs > 0;
	const introStart = timing.introStartSecs;
	const introEnd = introStart + timing.introDurationSecs;
	const loopStart = timing.loopStartSecs;
	const loopEnd = loopStart + timing.loopDurationSecs;

	// A region can never collapse to zero (or negative) duration by dragging
	// one edge past the other — floor it at one frame's duration.
	const minDurationSecs = fps > 0 ? 1 / fps : 0;

	const secsFromClientX = useCallback(
		(clientX: number) => {
			const rect = barRef.current?.getBoundingClientRect();
			if (!rect) return 0;
			return Math.max(0, snapSecsToFrame(geometry.pxToSecs(clientX - rect.left), fps));
		},
		[fps, geometry],
	);

	const beginDrag = useCallback((edge: EdgeId, startSecs: number, e: React.PointerEvent) => {
		e.stopPropagation();
		setDragEdge(edge);
		setDragSecs(startSecs);
		hasMovedRef.current = false;
		(e.target as Element).setPointerCapture(e.pointerId);
	}, []);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (!dragEdge) return;
			hasMovedRef.current = true;
			setDragSecs(secsFromClientX(e.clientX));
		},
		[dragEdge, secsFromClientX],
	);

	const handlePointerUp = useCallback(() => {
		if (!dragEdge || dragSecs === null) return;
		if (hasMovedRef.current) {
			switch (dragEdge) {
				case 'introStart': {
					const maxStart = Math.max(0, introEnd - minDurationSecs);
					const start = Math.min(Math.max(0, dragSecs), maxStart);
					onSetTimingField({
						introStartSecs: start,
						introDurationSecs: Math.max(minDurationSecs, introEnd - start),
					});
					break;
				}
				case 'introEnd': {
					const end = Math.max(introStart + minDurationSecs, dragSecs);
					onSetTimingField({ introDurationSecs: end - introStart });
					break;
				}
				case 'loopStart': {
					const maxStart = Math.max(0, loopEnd - minDurationSecs);
					const start = Math.min(Math.max(0, dragSecs), maxStart);
					onSetTimingField({
						loopStartSecs: start,
						loopDurationSecs: Math.max(minDurationSecs, loopEnd - start),
					});
					break;
				}
				case 'loopEnd': {
					const end = Math.max(loopStart + minDurationSecs, dragSecs);
					onSetTimingField({ loopDurationSecs: end - loopStart });
					break;
				}
			}
		}
		setDragEdge(null);
		setDragSecs(null);
	}, [dragEdge, dragSecs, introEnd, introStart, loopEnd, loopStart, minDurationSecs, onSetTimingField]);

	const liveIntroStart = dragEdge === 'introStart' && dragSecs !== null ? dragSecs : introStart;
	const liveIntroEnd = dragEdge === 'introEnd' && dragSecs !== null ? dragSecs : introEnd;
	const liveLoopStart = dragEdge === 'loopStart' && dragSecs !== null ? dragSecs : loopStart;
	const liveLoopEnd = dragEdge === 'loopEnd' && dragSecs !== null ? dragSecs : loopEnd;

	return (
		<div
			className="timeline-region-bar"
			ref={barRef}
			style={{ width: geometry.totalWidthPx }}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
		>
			{hasIntro && (
				<div
					className="timeline-region-bar__region timeline-region-bar__region--intro"
					style={{
						left: geometry.secsToPx(liveIntroStart),
						width: geometry.secsToPx(Math.max(0, liveIntroEnd - liveIntroStart)),
					}}
				>
					<span className="timeline-region-bar__label">Intro</span>
					<div
						className="timeline-region-bar__edge timeline-region-bar__edge--start"
						onPointerDown={(e) => beginDrag('introStart', introStart, e)}
					/>
					<div
						className="timeline-region-bar__edge timeline-region-bar__edge--end"
						onPointerDown={(e) => beginDrag('introEnd', introEnd, e)}
					/>
				</div>
			)}
			<div
				className="timeline-region-bar__region timeline-region-bar__region--loop"
				style={{
					left: geometry.secsToPx(liveLoopStart),
					width: geometry.secsToPx(Math.max(0, liveLoopEnd - liveLoopStart)),
				}}
			>
				<span className="timeline-region-bar__label">
					Loop ({liveLoopStart.toFixed(1)}s &rarr; {liveLoopEnd.toFixed(1)}s)
				</span>
				<div
					className="timeline-region-bar__edge timeline-region-bar__edge--start"
					onPointerDown={(e) => beginDrag('loopStart', loopStart, e)}
				/>
				<div
					className="timeline-region-bar__edge timeline-region-bar__edge--end"
					onPointerDown={(e) => beginDrag('loopEnd', loopEnd, e)}
				/>
			</div>
		</div>
	);
}
