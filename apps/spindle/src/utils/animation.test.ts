// Tests for the animation-track evaluator — unit coverage plus the shared
// parity fixture that pins this port equal to
// plugins/tauri-plugin-spindle-project/src/models/animation.rs.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { evaluateTrack, sampleAtKeyframes } from './animation';
import type { AnimationTrack, Easing, KeyValue } from 'tauri-plugin-spindle-project-api';
// Statically imported (not read via node:fs) so this stays a plain Vite/tsc
// module graph rather than needing @types/node for this one file — Vite
// resolves relative imports outside the package root fine for build/test
// purposes, and `resolveJsonModule` is already on in tsconfig.base.json.
// Reads the exact same fixture file the Rust evaluator's
// `evaluate_track_matches_the_shared_parity_fixture` test parses via
// `CARGO_MANIFEST_DIR`.
import parityCasesData from '../../../../fixtures/animation-parity.json';

function colourTrack(stops: Array<[number, string, Easing]>): AnimationTrack {
	return {
		nodeId: 'btn-1',
		target: 'highlight-colour',
		keyframes: stops.map(([timestampSecs, hex, easing]) => ({
			timestampSecs,
			value: { kind: 'colour', hex },
			easing,
		})),
	};
}

describe('evaluateTrack', () => {
	it('returns null for an empty track', () => {
		const track: AnimationTrack = { nodeId: 'btn-1', target: 'highlight-colour', keyframes: [] };
		expect(evaluateTrack(track, 1.0)).toBeNull();
	});

	it('is constant everywhere for a single keyframe', () => {
		const track = colourTrack([[1.0, '#ff0000', 'linear']]);
		expect(evaluateTrack(track, -5.0)).toEqual({ kind: 'colour', hex: '#ff0000' });
		expect(evaluateTrack(track, 100.0)).toEqual({ kind: 'colour', hex: '#ff0000' });
	});

	it('clamps before the first and after the last keyframe', () => {
		const track = colourTrack([
			[1.0, '#000000', 'linear'],
			[2.0, '#ffffff', 'linear'],
		]);
		expect(evaluateTrack(track, 0.0)).toEqual({ kind: 'colour', hex: '#000000' });
		expect(evaluateTrack(track, 3.0)).toEqual({ kind: 'colour', hex: '#ffffff' });
	});

	it('holds at k0 across the whole segment for hold easing', () => {
		const track = colourTrack([
			[0.0, '#000000', 'hold'],
			[2.0, '#ffffff', 'linear'],
		]);
		for (const t of [0.0, 0.5, 1.0, 1.999]) {
			expect(evaluateTrack(track, t)).toEqual({ kind: 'colour', hex: '#000000' });
		}
	});

	it('interpolates a linear scalar track', () => {
		const track: AnimationTrack = {
			nodeId: 'btn-1',
			target: 'highlight-opacity',
			keyframes: [
				{ timestampSecs: 0.0, value: { kind: 'scalar', value: 0.0 }, easing: 'linear' },
				{ timestampSecs: 2.0, value: { kind: 'scalar', value: 1.0 }, easing: 'linear' },
			],
		};
		const value = evaluateTrack(track, 1.0) as KeyValue & { kind: 'scalar' };
		expect(value.value).toBeCloseTo(0.5, 9);
	});

	it('rounds colour lerp half-up at one third', () => {
		const track = colourTrack([
			[0.0, '#000000', 'linear'],
			[3.0, '#ffffff', 'linear'],
		]);
		expect(evaluateTrack(track, 1.0)).toEqual({ kind: 'colour', hex: '#555555' });
	});

	it('lets the later keyframe win at a shared duplicate timestamp', () => {
		const track = colourTrack([
			[0.0, '#000000', 'linear'],
			[1.0, '#ff0000', 'linear'],
			[1.0, '#00ff00', 'linear'],
			[2.0, '#0000ff', 'linear'],
		]);
		expect(evaluateTrack(track, 1.0)).toEqual({ kind: 'colour', hex: '#00ff00' });
	});
});

describe('sampleAtKeyframes', () => {
	it('returns each keyframe timestamp/value pair, in order, with no evaluation', () => {
		const track = colourTrack([
			[0.0, '#000000', 'linear'],
			[1.5, '#ff8040', 'ease-in-out'],
		]);
		expect(sampleAtKeyframes(track)).toEqual([
			[0.0, { kind: 'colour', hex: '#000000' }],
			[1.5, { kind: 'colour', hex: '#ff8040' }],
		]);
	});

	it('returns an empty array for an empty track', () => {
		const track: AnimationTrack = { nodeId: 'btn-1', target: 'highlight-colour', keyframes: [] };
		expect(sampleAtKeyframes(track)).toEqual([]);
	});
});

// ── Fixture parity (fixtures/animation-parity.json, shared with the Rust
// evaluator's `evaluate_track_matches_the_shared_parity_fixture` test) ──────

interface ParitySample {
	t: number;
	expected: KeyValue | null;
}

interface ParityCase {
	name: string;
	track: AnimationTrack;
	samples: ParitySample[];
}

describe('evaluateTrack parity fixture', () => {
	const cases = parityCasesData as unknown as ParityCase[];

	it('has at least one case', () => {
		expect(cases.length).toBeGreaterThan(0);
	});

	for (const testCase of cases) {
		it(testCase.name, () => {
			for (const sample of testCase.samples) {
				const actual = evaluateTrack(testCase.track, sample.t);
				if (actual?.kind === 'scalar' && sample.expected?.kind === 'scalar') {
					expect(actual.value).toBeCloseTo(sample.expected.value, 9);
				} else {
					expect(actual).toEqual(sample.expected);
				}
			}
		});
	}
});
