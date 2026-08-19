// Groups one scene node's animation tracks (e.g. highlight-colour,
// highlight-opacity) under a collapsible header showing the node's label.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import type { AnimatableProperty, AnimationTrack, Easing, KeyValue } from '../../../types/project';
import type { TimelineGeometry } from './useTimelineGeometry';
import { TimelineKeyframeLane } from './TimelineKeyframeLane';

const TARGET_LABELS: Record<AnimatableProperty, string> = {
	'highlight-colour': 'Highlight colour',
	'highlight-opacity': 'Highlight opacity',
	'activate-colour': 'Activate colour',
	'activate-opacity': 'Activate opacity',
	opacity: 'Opacity',
	position: 'Position',
};

export interface TimelineNodeLaneProps {
	nodeId: string;
	nodeLabel: string;
	tracks: AnimationTrack[];
	geometry: TimelineGeometry;
	loopStartSecs: number;
	loopDurationSecs: number;
	defaultValueForTarget: (target: AnimatableProperty) => KeyValue;
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
	onSeek?: (secs: number) => void;
}

export function TimelineNodeLane({
	nodeId,
	nodeLabel,
	tracks,
	geometry,
	loopStartSecs,
	loopDurationSecs,
	defaultValueForTarget,
	onAddKeyframe,
	onMoveKeyframe,
	onUpdateKeyframeValue,
	onUpdateKeyframeEasing,
	onDeleteKeyframe,
	onSeek,
}: TimelineNodeLaneProps) {
	const [collapsed, setCollapsed] = useState(false);

	return (
		<div className="timeline-node-lane">
			<button
				type="button"
				className="timeline-node-lane__header"
				onClick={() => setCollapsed((v) => !v)}
				aria-expanded={!collapsed}
			>
				<span className="timeline-node-lane__disclosure">{collapsed ? '▸' : '▾'}</span>
				<span className="timeline-node-lane__label">{nodeLabel}</span>
			</button>
			{!collapsed && (
				<div className="timeline-node-lane__tracks">
					{tracks.map((track) => (
						<div key={track.target} className="timeline-node-lane__track-row">
							<span className="timeline-node-lane__track-label">{TARGET_LABELS[track.target]}</span>
							<TimelineKeyframeLane
								geometry={geometry}
								track={track}
								nodeId={nodeId}
								target={track.target}
								loopStartSecs={loopStartSecs}
								loopDurationSecs={loopDurationSecs}
								defaultValue={defaultValueForTarget(track.target)}
								onAddKeyframe={onAddKeyframe}
								onMoveKeyframe={onMoveKeyframe}
								onUpdateKeyframeValue={onUpdateKeyframeValue}
								onUpdateKeyframeEasing={onUpdateKeyframeEasing}
								onDeleteKeyframe={onDeleteKeyframe}
								onSeek={onSeek}
							/>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
