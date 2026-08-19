// TypeScript twin of the Rust animation-track evaluator
// (plugins/tauri-plugin-spindle-project/src/models/animation.rs) — keep the
// two ports bit-for-bit identical. Pinned equal by the shared fixture at
// fixtures/animation-parity.json (see animation.test.ts and the Rust
// evaluator's own `evaluate_track_matches_the_shared_parity_fixture` test).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type {
	AnimatableProperty,
	AnimationTrack,
	Easing,
	KeyValue,
	Keyframe,
} from 'tauri-plugin-spindle-project-api';

export type { AnimatableProperty, AnimationTrack, Easing, KeyValue, Keyframe };

/**
 * Sample `track` at `t_secs`.
 *
 * - An empty track has no value: `null`.
 * - Before the first keyframe: the first keyframe's value (clamped, not
 *   extrapolated) — or, when more than one leading keyframe shares that
 *   timestamp, the last of that run (see the duplicate-timestamp note
 *   below).
 * - After the last keyframe: the last keyframe's value.
 * - Between two keyframes `k0`, `k1`: `k0.easing` is applied to
 *   `u = (t - k0.timestampSecs) / (k1.timestampSecs - k0.timestampSecs)` —
 *   `hold` returns `k0`'s value outright (no interpolation); the other
 *   curves reshape `u` before it's used to interpolate between `k0.value`
 *   and `k1.value`. When two adjacent keyframes share a timestamp (a
 *   degenerate zero-length segment), `u` is treated as `1.0` — the later
 *   keyframe wins exactly at that instant.
 */
export function evaluateTrack(track: AnimationTrack, tSecs: number): KeyValue | null {
	const keyframes = track.keyframes;
	if (keyframes.length === 0) {
		return null;
	}

	const first = keyframes[0];
	if (keyframes.length === 1 || tSecs <= first.timestampSecs) {
		// Mirror the mid-track duplicate-timestamp rule (see this fn's doc
		// comment): if more than one leading keyframe shares `first`'s
		// timestamp, the later one in authoring order wins at that instant.
		let leading = first;
		for (const kf of keyframes) {
			if (kf.timestampSecs !== first.timestampSecs) {
				break;
			}
			leading = kf;
		}
		return leading.value;
	}

	const last = keyframes[keyframes.length - 1];
	if (tSecs >= last.timestampSecs) {
		return last.value;
	}

	for (let i = 0; i < keyframes.length - 1; i++) {
		const k0 = keyframes[i];
		const k1 = keyframes[i + 1];
		if (tSecs >= k0.timestampSecs && tSecs < k1.timestampSecs) {
			return interpolate(k0, k1, tSecs);
		}
	}

	// Unreachable in practice (the first/last checks above bracket every
	// other `tSecs`), but keep evaluation total rather than throwing.
	return last.value;
}

function interpolate(k0: Keyframe, k1: Keyframe, tSecs: number): KeyValue {
	if (k0.easing === 'hold') {
		return k0.value;
	}

	const span = k1.timestampSecs - k0.timestampSecs;
	const u = span > 0 ? clamp((tSecs - k0.timestampSecs) / span, 0, 1) : 1;
	let easedU: number;
	switch (k0.easing) {
		case 'linear':
			easedU = u;
			break;
		case 'ease-in':
			easedU = u * u;
			break;
		case 'ease-out':
			easedU = 1 - (1 - u) * (1 - u);
			break;
		case 'ease-in-out':
			easedU = 3 * u * u - 2 * u * u * u;
			break;
		default:
			easedU = u;
			break;
	}
	return lerpValue(k0.value, k1.value, easedU);
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.min(Math.max(v, lo), hi);
}

function lerpValue(v0: KeyValue, v1: KeyValue, u: number): KeyValue {
	if (v0.kind === 'colour' && v1.kind === 'colour') {
		return { kind: 'colour', hex: lerpColourHex(v0.hex, v1.hex, u) };
	}
	if (v0.kind === 'scalar' && v1.kind === 'scalar') {
		return { kind: 'scalar', value: v0.value + (v1.value - v0.value) * u };
	}
	if (v0.kind === 'point' && v1.kind === 'point') {
		return {
			kind: 'point',
			x: v0.x + (v1.x - v0.x) * u,
			y: v0.y + (v1.y - v0.y) * u,
		};
	}
	// Mismatched variants shouldn't occur within a well-formed track (every
	// keyframe on a track shares the track's `target`), but stay total
	// rather than throwing on malformed data.
	return v0;
}

/**
 * Parse a `#rrggbb`/`#rrggbbaa` hex colour into [r, g, b, a, hadAlpha].
 * Matches the Rust port's `parse_hex_colour` byte-for-byte: a channel needs
 * exactly two hex digits present or it falls back to `00`/`0` — a lone
 * leftover digit (e.g. a 7-character string) does not get parsed as a
 * partial byte.
 */
function parseHexColour(hex: string): [number, number, number, number, boolean] {
	const h = hex.startsWith('#') ? hex.slice(1) : hex;
	const byte = (start: number) => {
		const chunk = h.slice(start, start + 2);
		return (chunk.length === 2 ? parseInt(chunk, 16) : NaN) || 0;
	};
	const r = byte(0);
	const g = byte(2);
	const b = byte(4);
	if (h.length >= 8) {
		return [r, g, b, byte(6), true];
	}
	return [r, g, b, 255, false];
}

function lerpU8(a: number, b: number, u: number): number {
	const v = a + (b - a) * u;
	return clamp(Math.round(v), 0, 255);
}

function toHexByte(n: number): string {
	return n.toString(16).padStart(2, '0');
}

/**
 * Componentwise sRGB `u8` lerp between two hex colours, round-half-up per
 * channel. The output includes an alpha channel (`#rrggbbaa`) iff either
 * input did; otherwise it's plain `#rrggbb`.
 */
function lerpColourHex(hex0: string, hex1: string, u: number): string {
	const [r0, g0, b0, a0, alpha0] = parseHexColour(hex0);
	const [r1, g1, b1, a1, alpha1] = parseHexColour(hex1);
	const r = lerpU8(r0, r1, u);
	const g = lerpU8(g0, g1, u);
	const b = lerpU8(b0, b1, u);
	if (alpha0 || alpha1) {
		const a = lerpU8(a0, a1, u);
		return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}${toHexByte(a)}`;
	}
	return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

/**
 * Sample `track` at exactly each of its own keyframe timestamps, in order.
 * Because sampling at a keyframe's own timestamp always yields that
 * keyframe's value (see {@link evaluateTrack}'s boundary semantics —
 * easing's effect is confined to the open interval *between* keyframes),
 * this is equivalent to reading the keyframes' `(timestamp, value)` pairs
 * directly, with no evaluator call needed.
 */
export function sampleAtKeyframes(track: AnimationTrack): Array<[number, KeyValue]> {
	return track.keyframes.map((kf) => [kf.timestampSecs, kf.value]);
}
