// Playhead line + drag-to-seek, and the playback transport (play/pause,
// ±1 frame step, loop-region toggle).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

// The playhead line uses a transient zustand subscription and a direct DOM
// style transform instead of a selector hook — `currentTime` changes at
// rAF cadence while playing, and re-rendering this component's React tree
// on every frame would fight the "60Hz playhead must not re-render the
// world" rule (see design decision D9 and useVideoPlayhead.ts).
//
// The track itself is rendered at the SAME `geometry.totalWidthPx` as the
// ruler/region/audio/keyframe rows below it — never stretched to fill the
// available width — so `geometry.secsToPx`/`pxToSecs` stay valid for both
// the playhead transform and click-to-seek. Because that can make the track
// wider than the visible strip, it sits inside its own `overflow: hidden`
// viewport whose `scrollLeft` `TimelineStrip` keeps mirrored to the
// scrollable ruler area beneath it (also imperatively, for the same
// no-re-render reason), so the two stay visually locked together.
//
// The transport controls are laid out ahead of the viewport in markup, but
// CSS overlays them on top of it (see `.timeline-scrubber__controls` in
// SceneEditor.css) rather than placing them in a flex row before it — a
// flex row would push the viewport's own left edge, and with it
// `geometry.secsToPx(0)`, right by the controls' width, offsetting the
// scrubber/playhead from the ruler/region/audio/keyframe rows below by a
// fixed physical amount despite sharing the same `TimelineGeometry`.

import { useCallback, useEffect, useRef } from 'react';
import { useMenuPlaybackStore } from '../../../store/menu-playback-store';
import type { TimelineGeometry } from './useTimelineGeometry';

export interface TimelineScrubberProps {
	geometry: TimelineGeometry;
	/** Frame rate for the ±1-frame step buttons — the project's disc standard
	 * (NTSC 30000/1001, PAL 25), not a hardcoded 30fps (see `fpsForStandard`). */
	fps: number;
	/** Ref assigned to the track's scroll viewport, so `TimelineStrip` can
	 * mirror the main timeline area's horizontal scroll position onto it. */
	viewportRef: React.RefObject<HTMLDivElement | null>;
}

export function TimelineScrubber({ geometry, fps, viewportRef }: TimelineScrubberProps) {
	const trackRef = useRef<HTMLDivElement>(null);
	const playheadRef = useRef<HTMLDivElement>(null);
	const seek = useMenuPlaybackStore((s) => s.seek);
	const play = useMenuPlaybackStore((s) => s.play);
	const pause = useMenuPlaybackStore((s) => s.pause);
	const stepFrame = useMenuPlaybackStore((s) => s.stepFrame);
	const toggleLoopRegionEnabled = useMenuPlaybackStore((s) => s.toggleLoopRegionEnabled);
	const playing = useMenuPlaybackStore((s) => s.playing);
	const loopRegionEnabled = useMenuPlaybackStore((s) => s.loopRegionEnabled);

	// Transient subscription: move the playhead line without re-rendering.
	useEffect(() => {
		const applyPosition = (currentTime: number) => {
			if (playheadRef.current) {
				playheadRef.current.style.transform = `translateX(${geometry.secsToPx(currentTime)}px)`;
			}
		};
		applyPosition(useMenuPlaybackStore.getState().currentTime);
		return useMenuPlaybackStore.subscribe((state, prevState) => {
			if (state.currentTime !== prevState.currentTime) applyPosition(state.currentTime);
		});
	}, [geometry]);

	const handleTrackClick = useCallback(
		(e: React.MouseEvent) => {
			const rect = trackRef.current?.getBoundingClientRect();
			if (!rect) return;
			seek(Math.max(0, geometry.pxToSecs(e.clientX - rect.left)));
		},
		[geometry, seek],
	);

	return (
		<div className="timeline-scrubber">
			<div className="timeline-scrubber__controls">
				<button
					type="button"
					className="btn btn--sm btn--ghost"
					onClick={() => stepFrame(-1, fps)}
					title="Step back one frame"
					aria-label="Step back one frame"
				>
					⏮
				</button>
				<button
					type="button"
					className="btn btn--sm btn--ghost"
					onClick={() => (playing ? pause() : play())}
					aria-pressed={playing}
					title={playing ? 'Pause' : 'Play'}
				>
					{playing ? '⏸' : '▶'}
				</button>
				<button
					type="button"
					className="btn btn--sm btn--ghost"
					onClick={() => stepFrame(1, fps)}
					title="Step forward one frame"
					aria-label="Step forward one frame"
				>
					⏭
				</button>
				<button
					type="button"
					className={`btn btn--sm btn--ghost ${loopRegionEnabled ? 'btn--active' : ''}`}
					onClick={toggleLoopRegionEnabled}
					aria-pressed={loopRegionEnabled}
					title="Loop the loop region during preview playback"
				>
					⟲ Loop
				</button>
			</div>
			<div className="timeline-scrubber__viewport" ref={viewportRef}>
				<div
					className="timeline-scrubber__track"
					ref={trackRef}
					style={{ width: geometry.totalWidthPx }}
					onClick={handleTrackClick}
				>
					<div className="timeline-scrubber__playhead" ref={playheadRef} />
				</div>
			</div>
		</div>
	);
}
