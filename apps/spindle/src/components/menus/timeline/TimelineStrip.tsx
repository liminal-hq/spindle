// The timeline strip mounted below the canvas: playback transport, intro/loop
// region bar, audio-bed lane, and one keyframe lane group per animated node.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

// Visible when the menu has a motion background or any authored animation
// track — see design decision D9.

import { useEffect, useMemo, useRef } from 'react';
import type {
	AnimatableProperty,
	AnimationTrack,
	Asset,
	Easing,
	KeyValue,
	MenuButton,
	MenuDocument,
	MenuHighlightColours,
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

/** The value a newly-inserted keyframe samples when its track has no
 * existing keyframes to sample from (double-clicking an empty lane, or the
 * lane's very first keyframe) — sourced from the menu's own authored
 * defaults so the inserted keyframe is visible rather than falling through
 * to the `position` fallback for a colour/opacity target. */
export function defaultValueForTarget(
	highlightColours: MenuHighlightColours,
	target: AnimatableProperty,
): KeyValue {
	if (target === 'highlight-colour') return { kind: 'colour', hex: highlightColours.selectColour };
	if (target === 'highlight-opacity')
		return { kind: 'scalar', value: highlightColours.selectOpacity };
	if (target === 'activate-colour') return { kind: 'colour', hex: highlightColours.activateColour };
	if (target === 'activate-opacity')
		return { kind: 'scalar', value: highlightColours.activateOpacity };
	if (target === 'opacity') return { kind: 'scalar', value: 1 };
	return { kind: 'point', x: 0, y: 0 };
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

	// The scrubber's track lives outside `.timeline-strip__scroll` (so the
	// transport controls stay pinned while the ruler/lanes scroll), but it's
	// rendered at the SAME `geometry.totalWidthPx` as everything inside that
	// scroll area. Mirror the scroll area's horizontal offset onto the
	// scrubber's own viewport imperatively — a plain DOM assignment, not
	// React state — so the two stay visually locked without re-rendering on
	// every scroll event.
	const scrollRef = useRef<HTMLDivElement>(null);
	const scrubberViewportRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const scrollEl = scrollRef.current;
		const viewportEl = scrubberViewportRef.current;
		if (!scrollEl || !viewportEl) return;
		const syncScrubber = () => {
			viewportEl.scrollLeft = scrollEl.scrollLeft;
		};
		syncScrubber();
		scrollEl.addEventListener('scroll', syncScrubber);
		return () => scrollEl.removeEventListener('scroll', syncScrubber);
	}, []);

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

	if (!visible) return null;

	return (
		<div className="timeline-strip" data-testid="timeline-strip">
			<TimelineScrubber geometry={geometry} fps={fps} viewportRef={scrubberViewportRef} />
			<div className="timeline-strip__scroll" ref={scrollRef}>
				<TimelineRuler geometry={geometry} onSeek={seek} />
				<TimelineRegionBar
					geometry={geometry}
					timing={timing}
					fps={fps}
					minLoopDurationSecs={Math.max(
						0,
						...tracks.flatMap((t) => t.keyframes.map((kf) => kf.timestampSecs)),
					)}
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
							defaultValueForTarget={(target) => defaultValueForTarget(highlightColours, target)}
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
