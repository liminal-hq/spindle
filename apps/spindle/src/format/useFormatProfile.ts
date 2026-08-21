// Fetches the Rust `FormatProfile` for a disc family — the constraint table
// (button limits, highlight model, supported roles, min font size, ...) that
// replaces hardcoded DVD-only constants across the menu workspace. See
// `docs/rich-menu-editor-plan.md` §3.1/§4A and
// `plugins/tauri-plugin-spindle-project/src/models/format_profile.rs`.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';
import { getFormatProfile } from 'tauri-plugin-spindle-project-api';
import type { DiscFamily, FormatProfile } from '../types/project';

/**
 * Synchronous fallback for the very first render (and for callers that
 * can't await a hook, e.g. plain functions). Mirrors
 * `DVD_VIDEO_PROFILE` in `format_profile.rs` exactly — pinned by
 * `useFormatProfile.test.ts` so the two can't silently drift.
 */
export const DEFAULT_DVD_FORMAT_PROFILE: FormatProfile = {
	family: 'dvd-video',
	displayName: 'DVD-Video',
	designSizes: [
		{ width: 1024, height: 768, aspect: 'four-by-three' },
		{ width: 1024, height: 576, aspect: 'sixteen-by-nine' },
	],
	maxButtonsPerMenu: 36,
	highlightModel: 'four-colour-subpicture',
	minFontSizePt: 12,
	supportedRoles: ['root', 'title-select', 'chapter', 'setup', 'extras'],
	supportedBackgroundModes: ['still', 'motion'],
	supportsStateAnimation: false,
};

const FALLBACK_BY_FAMILY: Record<DiscFamily, FormatProfile> = {
	'dvd-video': DEFAULT_DVD_FORMAT_PROFILE,
};

// Module-level cache: `FormatProfile` is pure format law, immutable for the
// lifetime of the app, so every component asking for the same family shares
// one fetch instead of round-tripping the command per mount.
const profileCache = new Map<DiscFamily, FormatProfile>();
const inFlight = new Map<DiscFamily, Promise<FormatProfile>>();

function fetchProfile(family: DiscFamily): Promise<FormatProfile> {
	const cached = profileCache.get(family);
	if (cached) return Promise.resolve(cached);

	let pending = inFlight.get(family);
	if (!pending) {
		pending = getFormatProfile(family)
			.then((profile) => {
				profileCache.set(family, profile);
				return profile;
			})
			.finally(() => {
				inFlight.delete(family);
			});
		inFlight.set(family, pending);
	}
	return pending;
}

/**
 * The live `FormatProfile` for `family`, falling back to a hardcoded DVD
 * snapshot until the command resolves (best-effort, matching
 * `MenuEditor`'s `listAvailableFonts` fetch pattern) — so callers never have
 * to handle `undefined`.
 */
export function useFormatProfile(family: DiscFamily): FormatProfile {
	const [profile, setProfile] = useState<FormatProfile>(
		() => profileCache.get(family) ?? FALLBACK_BY_FAMILY[family] ?? DEFAULT_DVD_FORMAT_PROFILE,
	);

	useEffect(() => {
		let cancelled = false;
		fetchProfile(family)
			.then((fetched) => {
				if (!cancelled) setProfile(fetched);
			})
			.catch((err) => {
				console.error('[useFormatProfile] get_format_profile failed', err);
			});
		return () => {
			cancelled = true;
		};
	}, [family]);

	return profile;
}
