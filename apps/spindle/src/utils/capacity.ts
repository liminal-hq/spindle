// Shared disc-capacity estimation: a single budget-aware calculation used by
// both the Overview and Planner pages, so they never disagree about whether
// a project fits on its target disc.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { CAPACITY_BYTES } from '../types/project';
import type { SpindleProjectFile } from '../types/project';

// DVD-Video spec limits (ISO/IEC 13818-1)
const DVD_MAX_MUX_RATE_BPS = 10_080_000; // 10.08 Mbps total mux rate
export const DVD_MAX_VIDEO_RATE_BPS = 9_800_000; // 9.8 Mbps max video ES

// Menu size estimate constants: still menus are ~1-2 MB (MPEG-2 still + highlights),
// motion menus use their duration at a moderate bitrate.
export const STILL_MENU_BYTES = 1_500_000; // ~1.5 MB per still menu
export const MOTION_MENU_BITRATE = 5_000_000; // 5 Mbps for motion menus

export interface CapacityEstimate {
	capacityBytes: number;
	totalDurationSecs: number;
	estimatedMenuBytes: number;
	safetyMarginBytes: number;
	estimatedOverheadBytes: number;
	usableBytes: number;
	/** Average video bitrate available within budget, capped to DVD spec limits. */
	availableBitsPerSecond: number;
	/** True when the disc's capacity (not the DVD spec) is the binding constraint. */
	isCapacityConstrained: boolean;
	/** Estimated encoded size at the budgeted rate — not source file size, since
	 * source files are re-encoded to DVD-compliant MPEG-2 before authoring. */
	estimatedOutputBytes: number;
	usagePct: number;
	isOverCapacity: boolean;
}

/** Estimate encoded disc size and bitrate budget from total title duration,
 * the disc's capacity target, and authored menus — shared by Overview and
 * Planner so both pages report the same answer to "does this fit?" */
export function estimateDiscCapacity(project: SpindleProjectFile): CapacityEstimate {
	const disc = project.disc;
	const capacityBytes = CAPACITY_BYTES[disc.capacityTarget];

	const totalDurationSecs = disc.titlesets
		.flatMap((ts) => ts.titles)
		.reduce((sum, title) => {
			const asset = project.assets.find((a) => a.id === title.sourceAssetId);
			return sum + (asset?.durationSecs ?? 0);
		}, 0);

	const allMenus = [...disc.globalMenus, ...disc.titlesets.flatMap((ts) => ts.menus)];
	const estimatedMenuBytes = allMenus.reduce((sum, menu) => {
		if (menu.backgroundMode === 'motion' && menu.motionDurationSecs) {
			return sum + (MOTION_MENU_BITRATE * menu.motionDurationSecs) / 8;
		}
		return sum + STILL_MENU_BYTES;
	}, 0);

	const safetyMarginBytes = project.buildSettings.safetyMarginBytes;
	const estimatedOverheadBytes = 50_000_000 + estimatedMenuBytes; // IFOs, NAV packs + menus
	const usableBytes = capacityBytes - safetyMarginBytes - estimatedOverheadBytes;

	const rawBitsPerSecond = totalDurationSecs > 0 ? (usableBytes * 8) / totalDurationSecs : 0;
	const availableBitsPerSecond = Math.min(rawBitsPerSecond, DVD_MAX_VIDEO_RATE_BPS);
	const isCapacityConstrained = rawBitsPerSecond < DVD_MAX_VIDEO_RATE_BPS;

	const estimatedOutputBytes =
		totalDurationSecs > 0
			? (Math.min(rawBitsPerSecond, DVD_MAX_MUX_RATE_BPS) * totalDurationSecs) / 8
			: 0;
	const usagePct = estimatedOutputBytes > 0 ? (estimatedOutputBytes / capacityBytes) * 100 : 0;
	const isOverCapacity = estimatedOutputBytes > usableBytes;

	return {
		capacityBytes,
		totalDurationSecs,
		estimatedMenuBytes,
		safetyMarginBytes,
		estimatedOverheadBytes,
		usableBytes,
		availableBitsPerSecond,
		isCapacityConstrained,
		estimatedOutputBytes,
		usagePct,
		isOverCapacity,
	};
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
