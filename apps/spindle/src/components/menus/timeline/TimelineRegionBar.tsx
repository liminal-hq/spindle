// Intro + loop region blocks. Dragging an edge retimes the corresponding
// `MenuTiming` field with a local live-preview offset, committed once on
// pointer-up via `onSetTimingField` (one undo entry per drag).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useCallback, useRef, useState } from 'react';
import type { MenuTiming } from '../../../types/project';
import type { TimelineGeometry } from './useTimelineGeometry';

export interface TimelineRegionBarProps {
	geometry: TimelineGeometry;
	timing: MenuTiming;
	onSetTimingField: (patch: Partial<MenuTiming>) => void;
}

type EdgeId = 'introStart' | 'introEnd' | 'loopStart' | 'loopEnd';

export function TimelineRegionBar({ geometry, timing, onSetTimingField }: TimelineRegionBarProps) {
	const barRef = useRef<HTMLDivElement>(null);
	const [dragEdge, setDragEdge] = useState<EdgeId | null>(null);
	const [dragSecs, setDragSecs] = useState<number | null>(null);

	const hasIntro = timing.introDurationSecs > 0;
	const introStart = timing.introStartSecs;
	const introEnd = introStart + timing.introDurationSecs;
	const loopStart = timing.loopStartSecs;
	const loopEnd = loopStart + timing.loopDurationSecs;

	const secsFromClientX = useCallback(
		(clientX: number) => {
			const rect = barRef.current?.getBoundingClientRect();
			if (!rect) return 0;
			return Math.max(0, geometry.pxToSecs(clientX - rect.left));
		},
		[geometry],
	);

	const beginDrag = useCallback((edge: EdgeId, startSecs: number, e: React.PointerEvent) => {
		e.stopPropagation();
		setDragEdge(edge);
		setDragSecs(startSecs);
		(e.target as Element).setPointerCapture(e.pointerId);
	}, []);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (!dragEdge) return;
			setDragSecs(secsFromClientX(e.clientX));
		},
		[dragEdge, secsFromClientX],
	);

	const handlePointerUp = useCallback(() => {
		if (!dragEdge || dragSecs === null) return;
		switch (dragEdge) {
			case 'introStart':
				onSetTimingField({
					introStartSecs: Math.max(0, dragSecs),
					introDurationSecs: Math.max(0, introEnd - dragSecs),
				});
				break;
			case 'introEnd':
				onSetTimingField({ introDurationSecs: Math.max(0, dragSecs - introStart) });
				break;
			case 'loopStart':
				onSetTimingField({
					loopStartSecs: Math.max(0, dragSecs),
					loopDurationSecs: Math.max(0, loopEnd - dragSecs),
				});
				break;
			case 'loopEnd':
				onSetTimingField({ loopDurationSecs: Math.max(0, dragSecs - loopStart) });
				break;
		}
		setDragEdge(null);
		setDragSecs(null);
	}, [dragEdge, dragSecs, introEnd, introStart, loopEnd, loopStart, onSetTimingField]);

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
