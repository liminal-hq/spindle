// DVD-safety diagnostics surfaced in the menu-level inspector: button count,
// missing actions/default focus, broken nav references, and motion-menu timing.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { FormatProfile, MenuButton, MenuDocument } from '../../types/project';

export interface Diagnostic {
	severity: 'info' | 'warning' | 'error';
	message: string;
}

/**
 * `formatProfile` supplies the button-count ceiling that used to be a
 * hardcoded module constant — see `FormatProfile.maxButtonsPerMenu`
 * (`docs/rich-menu-editor-plan.md` §3.1/§4A). Pass the profile for the
 * project's own `disc.family`, e.g. via `useFormatProfile`.
 */
export function computeDiagnostics(
	doc: MenuDocument | null,
	buttons: MenuButton[],
	formatProfile: FormatProfile,
): Diagnostic[] {
	const results: Diagnostic[] = [];

	// Button count against the format's limit
	if (buttons.length > formatProfile.maxButtonsPerMenu) {
		results.push({
			severity: 'error',
			message: `Too many buttons (${buttons.length}). ${formatProfile.displayName} supports a maximum of ${formatProfile.maxButtonsPerMenu}.`,
		});
	} else if (buttons.length > 12) {
		results.push({
			severity: 'warning',
			message: `${buttons.length} buttons. Dense menus may be difficult to navigate with a remote control.`,
		});
	}

	// Missing actions
	const unbound = buttons.filter((b) => !b.action);
	if (unbound.length > 0) {
		results.push({
			severity: 'warning',
			message: `${unbound.length} button${unbound.length > 1 ? 's have' : ' has'} no action assigned.`,
		});
	}

	// Missing default focus
	if (doc && !doc.interaction.defaultFocusId && buttons.length > 0) {
		results.push({
			severity: 'warning',
			message: 'No default focus button set. The first button will receive focus by default.',
		});
	}

	// Broken directional navigation references
	const buttonIds = new Set(buttons.map((b) => b.id));
	for (const btn of buttons) {
		for (const dir of ['navUp', 'navDown', 'navLeft', 'navRight'] as const) {
			const target = btn[dir];
			if (target && !buttonIds.has(target)) {
				results.push({
					severity: 'error',
					message: `Button "${btn.label}" has a broken ${dir} reference.`,
				});
			}
		}
	}

	// Unreachable buttons (no navigation leads to them and they are not default)
	if (buttons.length > 1) {
		const reachable = new Set<string>();
		if (doc?.interaction.defaultFocusId) reachable.add(doc.interaction.defaultFocusId);
		else if (buttons.length > 0) reachable.add(buttons[0].id);

		for (const btn of buttons) {
			for (const dir of ['navUp', 'navDown', 'navLeft', 'navRight'] as const) {
				if (btn[dir]) reachable.add(btn[dir]!);
			}
		}
		const unreachable = buttons.filter((b) => !reachable.has(b.id));
		if (unreachable.length > 0) {
			results.push({
				severity: 'warning',
				message: `${unreachable.length} button${unreachable.length > 1 ? 's are' : ' is'} unreachable via remote navigation.`,
			});
		}
	}

	// Motion menu timing safety gate — a loop start of 0.0 blocks the build.
	if (doc?.backgroundMode === 'motion') {
		if (doc.timing.loopStartSecs === 0.0) {
			results.push({
				severity: 'error',
				message:
					'Motion menu: loop start time is 0.0 s. Set a loop start point before building — this will block the build.',
			});
		}
		results.push({
			severity: 'info',
			message: 'Motion menu: background will be rendered as looping MPEG video.',
		});
	}

	return results;
}
