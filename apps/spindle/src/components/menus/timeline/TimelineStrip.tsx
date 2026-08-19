// The timeline strip mounted below the canvas: playback transport, intro/loop
// region bar, audio-bed lane, and one keyframe lane group per animated node.
// Visible when the menu has a motion background or any authored animation
// track — see design decision D9.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useMemo } from 'react';
import type {
	AnimatableProperty,
	AnimationTrack,
	Asset,
	Easing,
	KeyValue,
	MenuButton,
	MenuDocument,
	MenuTiming,
	VideoStandard,
} from '../../../types/project';
import { useMenuPlaybackStore } from '../../../store/menu-playback-store';
import { fpsForStandard, useTimelineGeometry } from './useTimelineGeometry';
import { useVideoPlayhead } from './useVideoPlayhead';
import { TimelineRuler } from './TimelineRuler';
import { TimelineRegionBar } from './TimelineRegionBar';
import { TimelineScrubber } from './TimelineScrubber';
import { TimelineAudioLane } from './TimelineAudioLane';
import { TimelineNodeLane } from './TimelineNodeLane';

const PX_PER_SECOND = 40;

export interface TimelineStripProps {
	document: MenuDocument;
	buttons: MenuButton[];
	assets: Asset[];
	/** The project's disc video standard — drives the timeline's frame rate
	 * (NTSC 30000/1001, PAL 25) for frame-stepping and snapping, instead of a
	 * hardcoded 30fps. */
	standard: VideoStandard;
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
	onSetTimingField: (patch: Partial<MenuTiming>) => void;
}

/** Group tracks by nodeId, preserving first-seen order. */
function groupTracksByNode(tracks: AnimationTrack[]): Map<string, AnimationTrack[]> {
	const map = new Map<string, AnimationTrack[]>();
	for (const track of tracks) {
		const existing = map.get(track.nodeId);
		if (existing) {
			existing.push(track);
		} else {
			map.set(track.nodeId, [track]);
		}
	}
	return map;
}

export function TimelineStrip({
	document,
	buttons,
	assets,
	standard,
	onAddKeyframe,
	onMoveKeyframe,
	onUpdateKeyframeValue,
	onUpdateKeyframeEasing,
	onDeleteKeyframe,
	onSetTimingField,
}: TimelineStripProps) {
	const tracks = document.animation ?? [];
	const isMotion = document.backgroundMode === 'motion';
	const visible = isMotion || tracks.length > 0;
	const fps = fpsForStandard(standard);

	const playbackDuration = useMenuPlaybackStore((s) => s.duration);
	const seek = useMenuPlaybackStore((s) => s.seek);
	const setLoopRegion = useMenuPlaybackStore((s) => s.setLoopRegion);

	const { timing, highlightColours } = document;
	const loopStartSecs = timing.loopStartSecs;
	const loopDurationSecs = timing.loopDurationSecs;

	// Keep the playback store's loop-region window in sync with the authored
	// timing so `useVideoPlayhead`'s wraparound check has the right window.
	useEffect(() => {
		setLoopRegion(
			loopDurationSecs > 0 ? { startSecs: loopStartSecs, durationSecs: loopDurationSecs } : null,
		);
	}, [loopStartSecs, loopDurationSecs, setLoopRegion]);

	useVideoPlayhead();

	const fallbackDurationSecs = Math.max(
		timing.introStartSecs + timing.introDurationSecs,
		loopStartSecs + loopDurationSecs,
		...tracks.flatMap((t) => t.keyframes.map((kf) => loopStartSecs + kf.timestampSecs)),
		10,
	);
	const durationSecs = playbackDuration > 0 ? playbackDuration : fallbackDurationSecs;
	const geometry = useTimelineGeometry(durationSecs, PX_PER_SECOND);

	const audioAsset = timing.audioAssetId
		? (assets.find((a) => a.id === timing.audioAssetId) ?? null)
		: null;
	const audioDurationSecs = loopDurationSecs > 0 ? loopDurationSecs : 0;

	const buttonLabelById = useMemo(() => new Map(buttons.map((b) => [b.id, b.label])), [buttons]);
	const tracksByNode = useMemo(() => groupTracksByNode(tracks), [tracks]);

	const defaultValueForTarget = (target: AnimatableProperty): KeyValue => {
		if (target === 'highlight-colour')
			return { kind: 'colour', hex: highlightColours.selectColour };
		if (target === 'highlight-opacity')
			return { kind: 'scalar', value: highlightColours.selectOpacity };
		if (target === 'opacity') return { kind: 'scalar', value: 1 };
		return { kind: 'point', x: 0, y: 0 };
	};

	if (!visible) return null;

	return (
		<div className="timeline-strip" data-testid="timeline-strip">
			<TimelineScrubber geometry={geometry} fps={fps} />
			<div className="timeline-strip__scroll">
				<TimelineRuler geometry={geometry} onSeek={seek} />
				<TimelineRegionBar
					geometry={geometry}
					timing={timing}
					fps={fps}
					onSetTimingField={onSetTimingField}
				/>
				<TimelineAudioLane
					geometry={geometry}
					audioAsset={audioAsset}
					startSecs={loopStartSecs}
					durationSecs={audioDurationSecs}
				/>
				<div className="timeline-strip__node-lanes">
					{[...tracksByNode.entries()].map(([nodeId, nodeTracks]) => (
						<TimelineNodeLane
							key={nodeId}
							nodeId={nodeId}
							nodeLabel={buttonLabelById.get(nodeId) ?? nodeId}
							tracks={nodeTracks}
							geometry={geometry}
							loopStartSecs={loopStartSecs}
							loopDurationSecs={loopDurationSecs}
							fps={fps}
							defaultValueForTarget={defaultValueForTarget}
							onAddKeyframe={onAddKeyframe}
							onMoveKeyframe={onMoveKeyframe}
							onUpdateKeyframeValue={onUpdateKeyframeValue}
							onUpdateKeyframeEasing={onUpdateKeyframeEasing}
							onDeleteKeyframe={onDeleteKeyframe}
							onSeek={seek}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
