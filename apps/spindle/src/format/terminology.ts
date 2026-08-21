// Per-format UI vocabulary: the words on screen for a menu role, its
// highlight treatment, its grouping unit, and its compile-preview label.
//
// The editor never invents a neutral vocabulary that satisfies neither
// format — shared *concepts* live in the model (`MenuRole`, `FormatProfile`),
// but the words shown to the author are the target format's. Components
// should stop writing strings like "DVD Preview" inline and instead render
// `terminologyFor(project.disc.family).compilePreviewLabel` — see
// `docs/rich-menu-editor-plan.md` §3.2.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { DiscFamily, MenuRole } from '../types/project';

export interface FormatTerminology {
	/** Display name for the format itself, e.g. "DVD-Video", "BDMV". */
	formatName: string;
	/** Per-role display name, in this format's own vocabulary. */
	menuRole: Record<MenuRole, string>;
	/** e.g. 'Subpicture highlight' | 'Button state bitmaps'. */
	highlightTreatment: string;
	/** e.g. '4-colour CLUT' | '256-colour palette'. */
	highlightPalette: string;
	/** e.g. 'Titleset' | 'Playlist'. */
	groupingUnit: string;
	/** e.g. 'DVD Preview' | 'BD Preview'. */
	compilePreviewLabel: string;
}

const DVD_VIDEO_TERMINOLOGY: FormatTerminology = {
	formatName: 'DVD-Video',
	menuRole: {
		root: 'VMGM Title Menu',
		'title-select': 'Title Menu',
		chapter: 'Chapter Menu',
		setup: 'Setup Menu',
		extras: 'Extras Menu',
		// Not authorable on DVD (no `FormatProfile.supportedRoles` includes
		// it yet) — this label exists so a project carrying a `role: 'popup'`
		// from a future format doesn't render undefined text.
		popup: 'Popup Menu (unsupported)',
	},
	highlightTreatment: 'Subpicture highlight',
	highlightPalette: '4-colour CLUT',
	groupingUnit: 'Titleset',
	compilePreviewLabel: 'DVD Preview',
};

/**
 * The per-family terminology map — the frontend counterpart of Rust's
 * `profile_for`. `DiscFamily` in the frontend is currently narrowed to
 * `'dvd-video'` (the only UI-supported family — `DiscFamily.isUiSupported`
 * in Rust), so this is a total function with one row today; BD/SVCD/VCD
 * terminology rows land alongside their `FormatProfile` rows and the widened
 * `DiscFamily` type, per `docs/rich-menu-editor-plan.md` §3.2's terminology
 * table (root -> "Top Menu", grouping unit -> "Playlist", etc.).
 */
export function terminologyFor(family: DiscFamily): FormatTerminology {
	switch (family) {
		case 'dvd-video':
		default:
			return DVD_VIDEO_TERMINOLOGY;
	}
}
