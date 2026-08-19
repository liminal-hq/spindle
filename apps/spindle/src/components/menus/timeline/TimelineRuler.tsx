// Second ticks + labels along the top of the timeline strip. Clicking
// anywhere on the ruler seeks playback to that source-relative time.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useCallback, useRef } from 'react';
import type { TimelineGeometry } from './useTimelineGeometry';

export interface TimelineRulerProps {
	geometry: TimelineGeometry;
	onSeek: (secs: number) => void;
}

/** Pick a tick interval (seconds) that keeps labels legibly spaced at the
 * current px/second scale. */
function tickIntervalSecs(pxPerSecond: number): number {
	const candidates = [1, 2, 5, 10, 15, 30, 60];
	const minLabelPx = 48;
	for (const candidate of candidates) {
		if (candidate * pxPerSecond >= minLabelPx) return candidate;
	}
	return 120;
}

export function TimelineRuler({ geometry, onSeek }: TimelineRulerProps) {
	const rulerRef = useRef<HTMLDivElement>(null);

	const handleClick = useCallback(
		(e: React.MouseEvent) => {
			const rect = rulerRef.current?.getBoundingClientRect();
			if (!rect) return;
			onSeek(Math.max(0, geometry.pxToSecs(e.clientX - rect.left)));
		},
		[geometry, onSeek],
	);

	const interval = tickIntervalSecs(geometry.pxPerSecond);
	const tickCount = Math.max(0, Math.floor(geometry.durationSecs / interval));
	const ticks = Array.from({ length: tickCount + 1 }, (_, i) => i * interval);

	return (
		<div
			className="timeline-ruler"
			ref={rulerRef}
			style={{ width: geometry.totalWidthPx }}
			onClick={handleClick}
			role="slider"
			aria-label="Timeline position"
			aria-valuemin={0}
			aria-valuemax={geometry.durationSecs}
			tabIndex={0}
		>
			{ticks.map((secs) => (
				<div key={secs} className="timeline-ruler__tick" style={{ left: geometry.secsToPx(secs) }}>
					<span className="timeline-ruler__tick-label">{secs}s</span>
				</div>
			))}
		</div>
	);
}
