// Tests for the pure keyframe CRUD helpers backing the timeline's
// add/move/update/delete writers, plus a check that MenuEditor's writer
// pattern (one `updateMenuDocument` call per drag) produces exactly one
// undo entry.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import type { AnimationTrack } from '../../../types/project';
import {
	addKeyframe,
	deleteKeyframe,
	findTrack,
	moveKeyframe,
	removeNodeTracks,
	updateKeyframeEasing,
	updateKeyframeValue,
} from './animationWriters';

describe('addKeyframe', () => {
	it('creates a new track when none exists for the (node, target) pair', () => {
		const tracks = addKeyframe([], 'btn-1', 'highlight-colour', 1, {
			kind: 'colour',
			hex: '#ff0000',
		});
		expect(tracks).toHaveLength(1);
		expect(tracks[0]).toEqual({
			nodeId: 'btn-1',
			target: 'highlight-colour',
			keyframes: [{ timestampSecs: 1, value: { kind: 'colour', hex: '#ff0000' }, easing: 'hold' }],
		});
	});

	it('appends to an existing track and keeps keyframes sorted by timestamp', () => {
		const base: AnimationTrack[] = [
			{
				nodeId: 'btn-1',
				target: 'highlight-colour',
				keyframes: [
					{ timestampSecs: 2, value: { kind: 'colour', hex: '#00ff00' }, easing: 'hold' },
				],
			},
		];
		const tracks = addKeyframe(base, 'btn-1', 'highlight-colour', 0.5, {
			kind: 'colour',
			hex: '#0000ff',
		});
		expect(tracks).toHaveLength(1);
		expect(tracks[0].keyframes.map((k) => k.timestampSecs)).toEqual([0.5, 2]);
	});

	it('does not mutate the input array', () => {
		const base: AnimationTrack[] = [];
		addKeyframe(base, 'btn-1', 'highlight-colour', 1, { kind: 'colour', hex: '#fff' });
		expect(base).toHaveLength(0);
	});
});

describe('moveKeyframe', () => {
	const base: AnimationTrack[] = [
		{
			nodeId: 'btn-1',
			target: 'highlight-colour',
			keyframes: [
				{ timestampSecs: 0, value: { kind: 'colour', hex: '#111111' }, easing: 'hold' },
				{ timestampSecs: 5, value: { kind: 'colour', hex: '#222222' }, easing: 'linear' },
			],
		},
	];

	it('retimes the keyframe at the given index and re-sorts', () => {
		const tracks = moveKeyframe(base, 'btn-1', 'highlight-colour', 1, 1);
		expect(tracks[0].keyframes.map((k) => k.timestampSecs)).toEqual([0, 1]);
		// The moved keyframe keeps its value/easing.
		expect(tracks[0].keyframes[1].value).toEqual({ kind: 'colour', hex: '#222222' });
		expect(tracks[0].keyframes[1].easing).toBe('linear');
	});

	it('clamps a negative timestamp to zero', () => {
		const tracks = moveKeyframe(base, 'btn-1', 'highlight-colour', 0, -3);
		expect(tracks[0].keyframes[0].timestampSecs).toBe(0);
	});

	it('is a no-op for an unknown track', () => {
		const tracks = moveKeyframe(base, 'btn-does-not-exist', 'highlight-colour', 0, 3);
		expect(tracks).toBe(base);
	});

	it('is a no-op for an out-of-range keyframe index', () => {
		const tracks = moveKeyframe(base, 'btn-1', 'highlight-colour', 5, 3);
		expect(tracks).toBe(base);
	});

	it('replaces an existing keyframe when retimed onto its timestamp', () => {
		// Duplicate timestamps are one DCSQ boundary on the disc (later wins)
		// and would break the lane's timestamp-identity bindings — retiming
		// onto an occupied time merges: the moved keyframe survives.
		const tracks = moveKeyframe(base, 'btn-1', 'highlight-colour', 1, 0);
		expect(tracks[0].keyframes).toHaveLength(1);
		expect(tracks[0].keyframes[0].timestampSecs).toBe(0);
		expect(tracks[0].keyframes[0].value).toEqual({ kind: 'colour', hex: '#222222' });
	});
});

describe('addKeyframe timestamp collisions', () => {
	it('replaces an existing keyframe when inserting onto its timestamp', () => {
		const base: AnimationTrack[] = [
			{
				nodeId: 'btn-1',
				target: 'highlight-colour',
				keyframes: [
					{ timestampSecs: 2, value: { kind: 'colour', hex: '#111111' }, easing: 'hold' },
				],
			},
		];
		const tracks = addKeyframe(base, 'btn-1', 'highlight-colour', 2, {
			kind: 'colour',
			hex: '#999999',
		});
		expect(tracks[0].keyframes).toHaveLength(1);
		expect(tracks[0].keyframes[0].value).toEqual({ kind: 'colour', hex: '#999999' });
	});
});

describe('updateKeyframeValue / updateKeyframeEasing', () => {
	const base: AnimationTrack[] = [
		{
			nodeId: 'btn-1',
			target: 'highlight-opacity',
			keyframes: [{ timestampSecs: 0, value: { kind: 'scalar', value: 0.5 }, easing: 'hold' }],
		},
	];

	it('replaces the value at the given index', () => {
		const tracks = updateKeyframeValue(base, 'btn-1', 'highlight-opacity', 0, {
			kind: 'scalar',
			value: 0.9,
		});
		expect(tracks[0].keyframes[0].value).toEqual({ kind: 'scalar', value: 0.9 });
	});

	it('replaces the easing at the given index', () => {
		const tracks = updateKeyframeEasing(base, 'btn-1', 'highlight-opacity', 0, 'ease-in-out');
		expect(tracks[0].keyframes[0].easing).toBe('ease-in-out');
	});
});

describe('deleteKeyframe', () => {
	it('removes the keyframe at the given index', () => {
		const base: AnimationTrack[] = [
			{
				nodeId: 'btn-1',
				target: 'highlight-colour',
				keyframes: [
					{ timestampSecs: 0, value: { kind: 'colour', hex: '#111' }, easing: 'hold' },
					{ timestampSecs: 1, value: { kind: 'colour', hex: '#222' }, easing: 'hold' },
				],
			},
		];
		const tracks = deleteKeyframe(base, 'btn-1', 'highlight-colour', 0);
		expect(tracks[0].keyframes).toHaveLength(1);
		expect(tracks[0].keyframes[0].timestampSecs).toBe(1);
	});

	it('drops the whole track once its last keyframe is deleted', () => {
		const base: AnimationTrack[] = [
			{
				nodeId: 'btn-1',
				target: 'highlight-colour',
				keyframes: [{ timestampSecs: 0, value: { kind: 'colour', hex: '#111' }, easing: 'hold' }],
			},
		];
		const tracks = deleteKeyframe(base, 'btn-1', 'highlight-colour', 0);
		expect(tracks).toHaveLength(0);
	});
});

describe('removeNodeTracks', () => {
	it('drops every track belonging to the given node, regardless of target', () => {
		const base: AnimationTrack[] = [
			{ nodeId: 'btn-1', target: 'highlight-colour', keyframes: [] },
			{ nodeId: 'btn-1', target: 'activate-opacity', keyframes: [] },
			{ nodeId: 'btn-2', target: 'highlight-colour', keyframes: [] },
		];
		const tracks = removeNodeTracks(base, 'btn-1');
		expect(tracks).toHaveLength(1);
		expect(tracks[0].nodeId).toBe('btn-2');
	});

	it('is a no-op when the node has no tracks', () => {
		const base: AnimationTrack[] = [{ nodeId: 'btn-2', target: 'highlight-colour', keyframes: [] }];
		expect(removeNodeTracks(base, 'btn-1')).toEqual(base);
	});

	it('drops tracks for every id in an array, e.g. a deleted group subtree', () => {
		// Regression test: deleting a `group` node removes its whole child
		// subtree from `scene.nodes` in one go, so every descendant's tracks
		// must be droppable in the same call — not just the group's own id.
		const base: AnimationTrack[] = [
			{ nodeId: 'group-1', target: 'opacity', keyframes: [] },
			{ nodeId: 'child-1', target: 'highlight-colour', keyframes: [] },
			{ nodeId: 'child-2', target: 'position', keyframes: [] },
			{ nodeId: 'unrelated', target: 'highlight-colour', keyframes: [] },
		];
		const tracks = removeNodeTracks(base, ['group-1', 'child-1', 'child-2']);
		expect(tracks).toHaveLength(1);
		expect(tracks[0].nodeId).toBe('unrelated');
	});
});

describe('findTrack', () => {
	it('finds the track for a (node, target) pair', () => {
		const base: AnimationTrack[] = [
			{ nodeId: 'btn-1', target: 'highlight-colour', keyframes: [] },
			{ nodeId: 'btn-2', target: 'highlight-opacity', keyframes: [] },
		];
		expect(findTrack(base, 'btn-2', 'highlight-opacity')).toBe(base[1]);
		expect(findTrack(base, 'btn-2', 'highlight-colour')).toBeNull();
	});
});

// ── One undo entry per drag ──────────────────────────────────────────────
//
// The timeline's drag interactions (keyframe retiming, region-edge
// retiming) hold a local live-preview offset during pointer-move and defer
// the actual document write to a single call on pointer-up. Since
// `project-store`'s `updateMenuDocument` pushes exactly one undo entry per
// call (it delegates straight to `updateProject`, which does the pushing),
// asserting "one `updateMenuDocument` call" is equivalent to "one undo
// entry" without needing to stand up the full store here.

// The drag-commits-once-per-pointer-up behaviour is covered as a component
// test in `TimelineKeyframeLane.test.tsx`, since it depends on the pointer
// event sequence a real drag produces — see that file's "commits exactly
// once on pointer-up" test.
