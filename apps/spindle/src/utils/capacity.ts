// Shared disc-capacity estimation hook: a thin wrapper around the plugin's
// `estimateDiscCapacity` command, the single source of truth used by both
// the Overview and Planner pages and the build pipeline itself, so none of
// them can disagree about whether a project fits on its target disc.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';
import { estimateDiscCapacity } from 'tauri-plugin-spindle-project-api';
import type { CapacityEstimate, SpindleProjectFile } from 'tauri-plugin-spindle-project-api';

export type { CapacityEstimate, TitleBitrateAllocation } from 'tauri-plugin-spindle-project-api';

// Display-only constants mirroring plugins/tauri-plugin-spindle-project/src/build/capacity.rs.
// These aren't part of the fit/budget calculation itself (that's 100% computed
// in Rust via `estimateDiscCapacity` above) — they only label informational
// breakdown rows in the Planner UI. Keep in sync if the Rust values change.
export const DVD_MAX_VIDEO_RATE_BPS = 9_800_000;
export const STILL_MENU_BYTES = 1_500_000;
export const MOTION_MENU_BITRATE = 5_000_000;

/** Live disc-capacity estimate for the given project, recomputed by the Rust
 * backend whenever the project changes. Returns `null` until the first
 * estimate has loaded (e.g. on initial mount). */
export function useDiscCapacityEstimate(
	project: SpindleProjectFile | null,
): CapacityEstimate | null {
	const [estimate, setEstimate] = useState<CapacityEstimate | null>(null);

	useEffect(() => {
		if (!project) {
			setEstimate(null);
			return;
		}

		let cancelled = false;
		estimateDiscCapacity(project).then((result) => {
			if (!cancelled) setEstimate(result);
		});

		return () => {
			cancelled = true;
		};
	}, [project]);

	return estimate;
}

/** Format a byte count as a human-readable size, handling negative values
 * (e.g. "remaining" figures once a project goes over budget). */
export function formatBytes(bytes: number): string {
	const sign = bytes < 0 ? '-' : '';
	const abs = Math.abs(bytes);
	if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)} GB`;
	if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)} MB`;
	if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)} KB`;
	return `${sign}${abs} B`;
}
