// Tests for the preview-sampling helpers: honest-preview quantization
// (union-of-tracks DCSQ schedule semantics, mirroring
// build/planner/animation.rs) and the still/motion preview dispatcher.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import type { AnimationTrack } from '../../../types/project';
import {
	keyValueToColour,
	keyValueToOpacity,
	sampleHonestFold,
	sampleHonestFoldStill,
	sampleHonestPreview,
	sampleTrackForPreview,
} from './timelineUtils';

describe('sampleHonestPreview', () => {
	it('returns null for an empty track', () => {
		const track: AnimationTrack = { nodeId: 'btn-1', target: 'highlight-colour', keyframes: [] };
		expect(sampleHonestPreview([track], track, 5, 10, 30)).toBeNull();
	});

	it('evaluates the queried track at the UNION schedule boundary, not its own last keyframe', () => {
		// Colour track: linear ease from red@0s to green@2s (a genuinely
		// eased, non-hold segment). Opacity track: one keyframe at 1s, which
		// on its own wouldn't affect the colour track's schedule at all — but
		// the DCSQ schedule is shared across the whole relevant-track group,
		// so it adds a boundary the colour track must be re-evaluated at.
		const colourTrack: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'highlight-colour',
			keyframes: [
				{ timestampSecs: 0, value: { kind: 'colour', hex: '#ff0000' }, easing: 'linear' },
				{ timestampSecs: 2, value: { kind: 'colour', hex: '#00ff00' }, easing: 'hold' },
			],
		};
		const opacityTrack: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'highlight-opacity',
			keyframes: [{ timestampSecs: 1, value: { kind: 'scalar', value: 0.3 }, easing: 'hold' }],
		};
		const relevantTracks = [colourTrack, opacityTrack];

		// At tSecs=1.5, the union of timestamps {0, 1, 2} puts the schedule
		// boundary at 1 (the opacity track's own keyframe) — NOT at the
		// colour track's own last-keyframe-at-or-before, which (ignoring the
		// opacity track) would be 0. Evaluating the colour track's linear
		// ease at boundary=1 (halfway to its 2s keyframe) gives the midpoint
		// colour, not the pure red a same-track hold would return.
		const sampled = sampleHonestPreview(relevantTracks, colourTrack, 1.5, 10, 30);
		const hex = keyValueToColour(sampled);
		expect(hex).not.toBe('#ff0000');
		expect(hex).toBe('#808000'); // u=0.5 lerp from #ff0000 to #00ff00

		// Below the opacity track's boundary (tSecs=0.5), the schedule
		// boundary is 0 — pure red, matching a same-track hold here since
		// there's no earlier sibling boundary to diverge on.
		expect(keyValueToColour(sampleHonestPreview(relevantTracks, colourTrack, 0.5, 10, 30))).toBe(
			'#ff0000',
		);
	});

	it('samples the opacity track at the same shared boundary', () => {
		const colourTrack: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'highlight-colour',
			keyframes: [
				{ timestampSecs: 0, value: { kind: 'colour', hex: '#ff0000' }, easing: 'hold' },
				{ timestampSecs: 2, value: { kind: 'colour', hex: '#00ff00' }, easing: 'hold' },
			],
		};
		const opacityTrack: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'highlight-opacity',
			keyframes: [
				{ timestampSecs: 0, value: { kind: 'scalar', value: 1 }, easing: 'linear' },
				{ timestampSecs: 3, value: { kind: 'scalar', value: 0 }, easing: 'hold' },
			],
		};
		const relevantTracks = [colourTrack, opacityTrack];

		// Boundary at tSecs=1.5 is 0 (colour track's own keyframe, the only
		// one before 1.5) — opacity evaluated there, not at 1.5 itself.
		const opacity = keyValueToOpacity(
			sampleHonestPreview(relevantTracks, opacityTrack, 1.5, 10, 30),
		);
		expect(opacity).toBeCloseTo(1, 9);

		// Boundary at tSecs=2.5 is 2 (colour track's second keyframe) —
		// opacity's linear ease evaluated at 2/3 of the way to its own 3s
		// keyframe, not at 2.5/3.
		const opacityAt2_5 = keyValueToOpacity(
			sampleHonestPreview(relevantTracks, opacityTrack, 2.5, 10, 30),
		);
		expect(opacityAt2_5).toBeCloseTo(1 / 3, 9);
	});

	it('clamps a relevant keyframe timestamp beyond loopDurationSecs into the schedule union', () => {
		const track: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'highlight-colour',
			keyframes: [
				{ timestampSecs: 0, value: { kind: 'colour', hex: '#ff0000' }, easing: 'linear' },
				{ timestampSecs: 100, value: { kind: 'colour', hex: '#00ff00' }, easing: 'hold' },
			],
		};
		// Unclamped, this track's own far-out keyframe at 100s would never
		// become a schedule boundary within the 5s loop, so every tSecs in
		// [0, 5) would resolve to the same boundary=0. Clamping the keyframe
		// into [0, lastPresentableSecs] adds a boundary near 5s instead — at
		// tSecs=5 the schedule has moved past 0, so `evaluateTrack` (still
		// using the keyframe's real, unclamped timestamp for its own
		// interpolation) reports a colour already nudged off pure red.
		expect(keyValueToColour(sampleHonestPreview([track], track, 4.9, 5, 30))).toBe('#ff0000');
		expect(keyValueToColour(sampleHonestPreview([track], track, 5, 5, 30))).not.toBe('#ff0000');
	});

	it('clamps a keyframe at exactly loopDurationSecs to the standard-aware last-presentable frame', () => {
		// Regression test: `scheduleBoundarySecs` used to clamp into
		// `[0, loopDurationSecs]`, the SAME bound the planner's
		// `last_presentable_secs = loop_duration_secs - frame_duration_secs`
		// clamps *short of* — a keyframe authored exactly at `loopDurationSecs`
		// only ever added a schedule boundary at `loopDurationSecs` itself, an
		// instant playback never actually reaches before wrapping to `0`, so
		// the preview kept showing boundary=0 (pure red) right up to the
		// wrap, no matter how close `tSecs` got to the end — unlike the
		// compiled disc, whose last frame starts at `last_presentable_secs`
		// and IS reached.
		const track: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'highlight-colour',
			keyframes: [
				{ timestampSecs: 0, value: { kind: 'colour', hex: '#ff0000' }, easing: 'linear' },
				{ timestampSecs: 5, value: { kind: 'colour', hex: '#00ff00' }, easing: 'hold' },
			],
		};
		// loopDurationSecs=5, fps=25 (PAL) -> frame duration 0.04s ->
		// last-presentable = 4.96s, an instant playback actually reaches
		// before wrapping.
		//
		// Just below that boundary, still held at the schedule's only other
		// instant (0) — pure red.
		expect(keyValueToColour(sampleHonestPreview([track], track, 4.9, 5, 25))).toBe('#ff0000');
		// At 4.96, the schedule has moved to the new boundary this clamp
		// adds — `evaluateTrack` reports the linear ease already 99.2% of
		// the way to green, clearly not red.
		expect(keyValueToColour(sampleHonestPreview([track], track, 4.96, 5, 25))).not.toBe('#ff0000');
	});
});

describe('sampleHonestFold', () => {
	it('folds the LAST track in document order per property, independently for colour vs opacity', () => {
		// Two buttons' highlight-colour tracks — the disc has one CLUT for
		// the whole menu, so the later track in `doc.animation` order wins,
		// not "this button's own track".
		const firstButtonColour: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'highlight-colour',
			keyframes: [{ timestampSecs: 0, value: { kind: 'colour', hex: '#ff0000' }, easing: 'hold' }],
		};
		const secondButtonColour: AnimationTrack = {
			nodeId: 'btn-2',
			target: 'highlight-colour',
			keyframes: [{ timestampSecs: 0, value: { kind: 'colour', hex: '#0000ff' }, easing: 'hold' }],
		};
		const opacity: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'highlight-opacity',
			keyframes: [{ timestampSecs: 0, value: { kind: 'scalar', value: 0.4 }, easing: 'hold' }],
		};
		const groupTracks = [firstButtonColour, secondButtonColour, opacity];

		const folded = sampleHonestFold(
			groupTracks,
			groupTracks,
			'highlight-colour',
			'highlight-opacity',
			'#000000',
			1,
			0,
			10,
			30,
		);

		expect(folded.hex).toBe('#0000ff'); // last colour-target track wins
		expect(folded.opacity).toBeCloseTo(0.4, 9); // untouched by the colour fold
	});

	it('falls back to the defaults when nothing in the group resolves that property', () => {
		const colourOnly: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'activate-colour',
			keyframes: [{ timestampSecs: 0, value: { kind: 'colour', hex: '#123456' }, easing: 'hold' }],
		};
		const folded = sampleHonestFold(
			[colourOnly],
			[colourOnly],
			'activate-colour',
			'activate-opacity',
			'#ffffff',
			0.5,
			0,
			10,
			30,
		);
		expect(folded.hex).toBe('#123456');
		expect(folded.opacity).toBe(0.5); // no activate-opacity track — default kept
	});

	it('quantizes at a boundary from the COMPLETE union across both groups, not just the folded group', () => {
		// The highlight group being folded has no keyframe of its own past
		// 0s, but an activate-group track (passed only via `schedulingTracks`)
		// adds a boundary at 3s — the disc bakes ONE overlay image per shared
		// schedule instant, so that boundary must still apply.
		const highlightColour: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'highlight-colour',
			keyframes: [
				{ timestampSecs: 0, value: { kind: 'colour', hex: '#ff0000' }, easing: 'linear' },
				{ timestampSecs: 6, value: { kind: 'colour', hex: '#00ff00' }, easing: 'hold' },
			],
		};
		const activateOpacity: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'activate-opacity',
			keyframes: [{ timestampSecs: 3, value: { kind: 'scalar', value: 0.1 }, easing: 'hold' }],
		};
		const groupTracks = [highlightColour];
		const schedulingTracks = [highlightColour, activateOpacity];

		// At tSecs=4, the union {0, 3} from `schedulingTracks` puts the
		// boundary at 3 — the highlight colour's own linear ease evaluated
		// at t=3 (halfway to its 6s keyframe), not at t=4 and not held at
		// its own last-keyframe-at-or-before (which, ignoring the activate
		// track, would still be 0).
		const folded = sampleHonestFold(
			groupTracks,
			schedulingTracks,
			'highlight-colour',
			'highlight-opacity',
			'#000000',
			1,
			4,
			10,
			30,
		);
		expect(folded.hex).toBe('#808000'); // u=0.5 lerp from #ff0000 to #00ff00
	});
});

describe('sampleHonestFoldStill', () => {
	it('folds every relevant track menu-wide at its own FIRST keyframe, last-track-wins', () => {
		// Mirrors `build_overlay_keyframe_schedule`'s still-menu degrade path
		// (`effective_colour_hex` sampled with `track.keyframes.first()`):
		// two buttons' highlight-colour tracks fold into ONE value (the
		// disc's single menu-wide CLUT), the later track in document order
		// winning, each read at its own first keyframe regardless of any
		// later keyframes it might carry.
		const firstButtonColour: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'highlight-colour',
			keyframes: [
				{ timestampSecs: 0, value: { kind: 'colour', hex: '#ff0000' }, easing: 'hold' },
				{ timestampSecs: 5, value: { kind: 'colour', hex: '#ff00ff' }, easing: 'hold' },
			],
		};
		const secondButtonColour: AnimationTrack = {
			nodeId: 'btn-2',
			target: 'highlight-colour',
			keyframes: [{ timestampSecs: 2, value: { kind: 'colour', hex: '#0000ff' }, easing: 'hold' }],
		};
		const opacity: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'highlight-opacity',
			keyframes: [{ timestampSecs: 0, value: { kind: 'scalar', value: 0.4 }, easing: 'hold' }],
		};
		const groupTracks = [firstButtonColour, secondButtonColour, opacity];

		const folded = sampleHonestFoldStill(
			groupTracks,
			'highlight-colour',
			'highlight-opacity',
			'#000000',
			1,
		);

		expect(folded.hex).toBe('#0000ff'); // last colour-target track wins, at ITS first keyframe
		expect(folded.opacity).toBeCloseTo(0.4, 9);
	});

	it('falls back to the defaults when nothing in the group resolves that property', () => {
		const colourOnly: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'activate-colour',
			keyframes: [{ timestampSecs: 0, value: { kind: 'colour', hex: '#123456' }, easing: 'hold' }],
		};
		const folded = sampleHonestFoldStill(
			[colourOnly],
			'activate-colour',
			'activate-opacity',
			'#ffffff',
			0.5,
		);
		expect(folded.hex).toBe('#123456');
		expect(folded.opacity).toBe(0.5);
	});
});

describe('sampleTrackForPreview', () => {
	const track: AnimationTrack = {
		nodeId: 'btn-1',
		target: 'highlight-colour',
		keyframes: [
			{ timestampSecs: 0, value: { kind: 'colour', hex: '#ff0000' }, easing: 'linear' },
			{ timestampSecs: 2, value: { kind: 'colour', hex: '#00ff00' }, easing: 'hold' },
		],
	};

	it('returns null for an undefined track', () => {
		expect(sampleTrackForPreview(undefined, [], 1, 10, 30, true, false)).toBeNull();
	});

	it('still menu: bakes in the first keyframe regardless of tSecs, mirroring the disc degrade path', () => {
		expect(keyValueToColour(sampleTrackForPreview(track, [track], 0, 10, 30, false, false))).toBe(
			'#ff0000',
		);
		expect(keyValueToColour(sampleTrackForPreview(track, [track], 1.9, 10, 30, false, false))).toBe(
			'#ff0000',
		);
		expect(keyValueToColour(sampleTrackForPreview(track, [track], 1.9, 10, 30, false, true))).toBe(
			'#ff0000',
		);
	});

	it('motion menu, not honest: full eased curve', () => {
		const hex = keyValueToColour(sampleTrackForPreview(track, [track], 1, 10, 30, true, false));
		expect(hex).toBe('#808000'); // u=0.5 lerp
	});

	it('motion menu, honest: quantized via the union schedule', () => {
		const hex = keyValueToColour(sampleTrackForPreview(track, [track], 1, 10, 30, true, true));
		expect(hex).toBe('#ff0000'); // boundary at 0, held there
	});
});
