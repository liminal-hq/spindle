// Project-level menu helpers: locating/updating a menu by ID and computing
// the navigation graph's per-menu connection counts.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { Menu, SpindleProjectFile } from '../../types/project';

export function updateMenuInProject(
	project: SpindleProjectFile,
	menuId: string,
	updater: (m: Menu) => Menu,
): SpindleProjectFile {
	return {
		...project,
		disc: {
			...project.disc,
			globalMenus: project.disc.globalMenus.map((m) => (m.id === menuId ? updater(m) : m)),
			titlesets: project.disc.titlesets.map((ts) => ({
				...ts,
				menus: ts.menus.map((m) => (m.id === menuId ? updater(m) : m)),
			})),
		},
	};
}

export type MenuConnectionCounts = {
	incoming: number;
	outgoing: number;
};

export const EMPTY_MENU_CONNECTION_COUNTS: MenuConnectionCounts = {
	incoming: 0,
	outgoing: 0,
};

export function computeMenuConnectionCounts(
	project: SpindleProjectFile,
): Record<string, MenuConnectionCounts> {
	const countSets = new Map<string, { incoming: Set<string>; outgoing: Set<string> }>();

	const ensureCounts = (menuId: string) => {
		const existing = countSets.get(menuId);
		if (existing) return existing;
		const next = { incoming: new Set<string>(), outgoing: new Set<string>() };
		countSets.set(menuId, next);
		return next;
	};

	const registerOutgoing = (menuId: string, key: string) => {
		ensureCounts(menuId).outgoing.add(key);
	};

	const registerIncoming = (menuId: string, key: string) => {
		ensureCounts(menuId).incoming.add(key);
	};

	const inspectAction = (action: Menu['timeoutAction'], source: string, menuId?: string) => {
		if (!action) return;
		switch (action.type) {
			case 'showMenu':
				if (menuId) registerOutgoing(menuId, `show:${action.menuId}`);
				registerIncoming(action.menuId, `${source}:show:${action.menuId}`);
				break;
			case 'playTitle':
				if (menuId) registerOutgoing(menuId, `title:${action.titleId}`);
				break;
			case 'playChapter':
				if (menuId) registerOutgoing(menuId, `chapter:${action.titleId}:${action.chapterId}`);
				break;
			case 'sequence':
				action.actions.forEach((nestedAction, index) =>
					inspectAction(nestedAction, `${source}:sequence:${index}`, menuId),
				);
				break;
			case 'return':
				if (menuId) registerOutgoing(menuId, 'return');
				break;
			default:
				break;
		}
	};

	project.disc.globalMenus.forEach((menu) => ensureCounts(menu.id));
	project.disc.titlesets.forEach((titleset) =>
		titleset.menus.forEach((menu) => ensureCounts(menu.id)),
	);

	if (project.disc.firstPlayAction) {
		inspectAction(project.disc.firstPlayAction, 'disc:first-play');
	}

	project.disc.titlesets.forEach((titleset) =>
		titleset.titles.forEach((title) => {
			if (title.endAction) {
				inspectAction(title.endAction, `title:${title.id}`);
			}
		}),
	);

	const authoredMenus = [
		...project.disc.globalMenus,
		...project.disc.titlesets.flatMap((titleset) => titleset.menus),
	];

	authoredMenus.forEach((menu) => {
		const interactionNodes = menu.authoredDocument?.interaction.nodes ?? [];
		if (interactionNodes.length > 0) {
			interactionNodes.forEach((node, index) =>
				inspectAction(node.action, `menu:${menu.id}:node:${index}`, menu.id),
			);
		} else {
			menu.buttons.forEach((button) =>
				inspectAction(button.action, `menu:${menu.id}:button:${button.id}`, menu.id),
			);
		}
		inspectAction(
			menu.authoredDocument?.interaction.timeoutAction ?? menu.timeoutAction,
			`menu:${menu.id}:timeout`,
			menu.id,
		);
	});

	return Object.fromEntries(
		[...countSets.entries()].map(([menuId, counts]) => [
			menuId,
			{
				incoming: counts.incoming.size,
				outgoing: counts.outgoing.size,
			},
		]),
	);
}
