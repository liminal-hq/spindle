// Project-level menu helpers: locating/updating a menu by ID and computing
// the navigation graph's per-menu connection counts.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type {
	ButtonBounds,
	HighlightKeyframe,
	HighlightMode,
	Menu,
	PlaybackAction,
	SceneNode,
	SpindleProjectFile,
} from '../../types/project';

/** A top-level scene button joined with its interaction-graph node — the
 * shared "what counts as a button" view, mirroring
 * `MenuDocument::buttons()` on the Rust side, so every reader here agrees.
 * Scans only top-level `scene.nodes` `button` variants; recursive group
 * flattening is deferred to a later PR (matching the Rust side).
 *
 * Carries the same fields as the legacy `MenuButton` shape (bounds,
 * highlight authoring, button video) so this is the single "what counts as
 * a button" join for callers that need scene geometry (e.g. `MenuEditor`),
 * not just the navigation-graph fields connection-count callers use. */
export interface MenuButtonView {
	id: string;
	label: string;
	bounds: ButtonBounds;
	action: PlaybackAction | null;
	navUp: string | null;
	navDown: string | null;
	navLeft: string | null;
	navRight: string | null;
	highlightMode: HighlightMode;
	highlightKeyframes: HighlightKeyframe[];
	videoAssetId: string | null;
}

export function getMenuButtons(menu: Menu): MenuButtonView[] {
	const doc = menu.authoredDocument;
	if (!doc) return [];
	return doc.scene.nodes
		.filter((n): n is Extract<SceneNode, { type: 'button' }> => n.type === 'button')
		.map((node) => {
			const interaction = doc.interaction.nodes.find((i) => i.nodeId === node.id);
			return {
				id: node.id,
				label: node.label,
				bounds: { x: node.x, y: node.y, width: node.width, height: node.height },
				action: interaction?.action ?? null,
				navUp: interaction?.navUp ?? null,
				navDown: interaction?.navDown ?? null,
				navLeft: interaction?.navLeft ?? null,
				navRight: interaction?.navRight ?? null,
				highlightMode: node.highlightMode ?? 'static',
				highlightKeyframes: node.highlightKeyframes ?? [],
				videoAssetId: node.videoAssetId ?? null,
			};
		});
}

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

	const inspectAction = (action: PlaybackAction | null, source: string, menuId?: string) => {
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
		// Walk ALL interaction-graph nodes, not just top-level scene buttons
		// (`getMenuButtons`) — a group-nested button's focus node still lives
		// in `interaction.nodes` and contributes a real edge that MenuMap
		// draws, so connection counts must see it too or MenuListItem shows
		// a false "unconnected" badge for a menu that's actually reachable.
		(menu.authoredDocument?.interaction.nodes ?? []).forEach((node) =>
			inspectAction(node.action, `menu:${menu.id}:node:${node.nodeId}`, menu.id),
		);
		inspectAction(
			menu.authoredDocument?.interaction.timeoutAction ?? null,
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
