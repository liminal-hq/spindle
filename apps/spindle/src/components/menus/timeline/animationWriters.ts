// Pure keyframe CRUD helpers over `MenuDocument.animation`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

// Kept free of React/store dependencies so timeline interactions (drag,
// popover edits, delete) can be unit-tested directly, and so every call site
// (MenuEditor's `updateMenuDocument` writers) shares exactly one code path
// for finding or creating the right track and keeping its keyframes sorted.

import type {
	AnimatableProperty,
	AnimationTrack,
	Easing,
	Keyframe,
	KeyValue,
} from '../../../types/project';

function findTrackIndex(
	tracks: AnimationTrack[],
	nodeId: string,
	target: AnimatableProperty,
): number {
	return tracks.findIndex((t) => t.nodeId === nodeId && t.target === target);
}

function sortedKeyframes(keyframes: Keyframe[]): Keyframe[] {
	return [...keyframes].sort((a, b) => a.timestampSecs - b.timestampSecs);
}

/**
 * Add a keyframe to the (node, target) track, creating the track if it
 * doesn't exist yet. Keyframes are kept sorted by timestamp.
 */
export function addKeyframe(
	tracks: AnimationTrack[],
	nodeId: string,
	target: AnimatableProperty,
	timestampSecs: number,
	value: KeyValue,
	easing: Easing = 'hold',
): AnimationTrack[] {
	const keyframe: Keyframe = { timestampSecs, value, easing };
	const index = findTrackIndex(tracks, nodeId, target);
	if (index === -1) {
		return [...tracks, { nodeId, target, keyframes: [keyframe] }];
	}
	// Two keyframes on the same timestamp are meaningless on the disc (one
	// DCSQ boundary; the evaluator lets the later one win) and would break
	// the lane's timestamp-identity bindings — inserting onto an existing
	// keyframe's time REPLACES it.
	return tracks.map((t, i) =>
		i === index
			? {
					...t,
					keyframes: sortedKeyframes([
						...t.keyframes.filter((kf) => kf.timestampSecs !== timestampSecs),
						keyframe,
					]),
				}
			: t,
	);
}

/** Retime the keyframe at `keyframeIndex` within the (node, target) track.
 * No-op (returns `tracks` unchanged) if the track or index doesn't exist. */
export function moveKeyframe(
	tracks: AnimationTrack[],
	nodeId: string,
	target: AnimatableProperty,
	keyframeIndex: number,
	newTimestampSecs: number,
): AnimationTrack[] {
	const index = findTrackIndex(tracks, nodeId, target);
	if (index === -1) return tracks;
	const track = tracks[index];
	if (keyframeIndex < 0 || keyframeIndex >= track.keyframes.length) return tracks;
	const clampedSecs = Math.max(0, newTimestampSecs);
	// Retiming onto another keyframe's timestamp REPLACES it — duplicates are
	// meaningless on the disc (one DCSQ boundary, later wins) and would break
	// the lane's timestamp-identity bindings.
	const updated = track.keyframes
		.filter((kf, i) => i === keyframeIndex || kf.timestampSecs !== clampedSecs)
		.map((kf) =>
			kf === track.keyframes[keyframeIndex] ? { ...kf, timestampSecs: clampedSecs } : kf,
		);
	return tracks.map((t, i) => (i === index ? { ...t, keyframes: sortedKeyframes(updated) } : t));
}

/** Replace the value at `keyframeIndex` within the (node, target) track. */
export function updateKeyframeValue(
	tracks: AnimationTrack[],
	nodeId: string,
	target: AnimatableProperty,
	keyframeIndex: number,
	value: KeyValue,
): AnimationTrack[] {
	const index = findTrackIndex(tracks, nodeId, target);
	if (index === -1) return tracks;
	const track = tracks[index];
	if (keyframeIndex < 0 || keyframeIndex >= track.keyframes.length) return tracks;
	const keyframes = track.keyframes.map((kf, i) => (i === keyframeIndex ? { ...kf, value } : kf));
	return tracks.map((t, i) => (i === index ? { ...t, keyframes } : t));
}

/** Replace the easing at `keyframeIndex` within the (node, target) track. */
export function updateKeyframeEasing(
	tracks: AnimationTrack[],
	nodeId: string,
	target: AnimatableProperty,
	keyframeIndex: number,
	easing: Easing,
): AnimationTrack[] {
	const index = findTrackIndex(tracks, nodeId, target);
	if (index === -1) return tracks;
	const track = tracks[index];
	if (keyframeIndex < 0 || keyframeIndex >= track.keyframes.length) return tracks;
	const keyframes = track.keyframes.map((kf, i) => (i === keyframeIndex ? { ...kf, easing } : kf));
	return tracks.map((t, i) => (i === index ? { ...t, keyframes } : t));
}

/** Remove the keyframe at `keyframeIndex` within the (node, target) track.
 * Drops the track entirely once it has no keyframes left, so an emptied
 * track doesn't linger in `doc.animation`. */
export function deleteKeyframe(
	tracks: AnimationTrack[],
	nodeId: string,
	target: AnimatableProperty,
	keyframeIndex: number,
): AnimationTrack[] {
	const index = findTrackIndex(tracks, nodeId, target);
	if (index === -1) return tracks;
	const track = tracks[index];
	if (keyframeIndex < 0 || keyframeIndex >= track.keyframes.length) return tracks;
	const keyframes = track.keyframes.filter((_, i) => i !== keyframeIndex);
	if (keyframes.length === 0) {
		return tracks.filter((_, i) => i !== index);
	}
	return tracks.map((t, i) => (i === index ? { ...t, keyframes } : t));
}

/** Drop every track belonging to `nodeId` (all targets), or to any of
 * several node ids at once — deleting a `group` node removes its whole
 * child subtree from `scene.nodes` in one go (see `SceneNode`'s `group`
 * variant, which embeds `children` directly), so the tracks for every
 * descendant need dropping atomically too, not just the group's own id.
 * Used when a scene node (or subtree) is deleted — `document.animation` is
 * not addressed by node-removal itself, so without this its tracks linger
 * and reference a scene node that no longer exists, tripping
 * `menu.animation-node-missing` on the next validate. */
export function removeNodeTracks(
	tracks: AnimationTrack[],
	nodeId: string | string[],
): AnimationTrack[] {
	const ids = new Set(Array.isArray(nodeId) ? nodeId : [nodeId]);
	return tracks.filter((t) => !ids.has(t.nodeId));
}

/** Find the (node, target) track, or `null` if none exists yet. */
export function findTrack(
	tracks: AnimationTrack[],
	nodeId: string,
	target: AnimatableProperty,
): AnimationTrack | null {
	return tracks.find((t) => t.nodeId === nodeId && t.target === target) ?? null;
}
