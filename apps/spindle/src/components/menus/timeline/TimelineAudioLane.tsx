// Static audio-bed bar: name + duration, no waveform (v1 — see D9).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { Asset } from '../../../types/project';
import type { TimelineGeometry } from './useTimelineGeometry';

export interface TimelineAudioLaneProps {
	geometry: TimelineGeometry;
	audioAsset: Asset | null;
	/** Where the bed audibly starts, source-relative — the loop start (the
	 * bed loops continuously from the loop, per D1's audio-window design). */
	startSecs: number;
	durationSecs: number;
}

export function TimelineAudioLane({
	geometry,
	audioAsset,
	startSecs,
	durationSecs,
}: TimelineAudioLaneProps) {
	if (!audioAsset || durationSecs <= 0) {
		return (
			<div
				className="timeline-audio-lane timeline-audio-lane--empty"
				style={{ width: geometry.totalWidthPx }}
			>
				<span className="timeline-audio-lane__hint text-muted">No audio bed</span>
			</div>
		);
	}

	return (
		<div className="timeline-audio-lane" style={{ width: geometry.totalWidthPx }}>
			<div
				className="timeline-audio-lane__bar"
				style={{ left: geometry.secsToPx(startSecs), width: geometry.secsToPx(durationSecs) }}
				title={`${audioAsset.fileName} (${durationSecs.toFixed(1)}s)`}
			>
				<span className="timeline-audio-lane__label">
					♪ {audioAsset.fileName} ({durationSecs.toFixed(1)}s)
				</span>
			</div>
		</div>
	);
}
