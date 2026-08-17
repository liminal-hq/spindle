// Tests for the generator navigation wiring (issue #36): a generated
// chapter grid must ship with complete directional nav — no button left
// unreachable from the default focus — rather than requiring a manual
// Auto Nav pass.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { buildChapterMenusForTitleset } from './menuGenerators';
import type { FocusNode, SpindleProjectFile } from '../../types/project';

function buildTitleset(chapterCount: number): SpindleProjectFile['disc']['titlesets'][number] {
	return {
		id: 'titleset-1',
		name: 'Feature',
		menus: [],
		titles: [
			{
				id: 'title-1',
				name: 'Feature',
				sourceAssetId: null,
				videoMapping: null,
				videoOutputProfile: null,
				audioMappings: [],
				subtitleMappings: [],
				chapters: Array.from({ length: chapterCount }, (_, i) => ({
					id: `ch-${i}`,
					name: `Chapter ${i + 1}`,
					timestampSecs: i * 60,
					orderIndex: i,
				})),
				endAction: null,
				orderIndex: 0,
				bitrateWeight: 1.0,
				bitrateFloorBps: null,
				bitrateCeilingBps: null,
				pinnedBitrateBps: null,
			},
		],
	};
}

/** Every node reachable from `startId`, treating each interaction node's
 * four directional pointers as directed edges — proves actual navigability,
 * not just that some `nav*` field happens to be non-null. */
function reachableFrom(startId: string, nodes: FocusNode[]): Set<string> {
	const byId = new Map(nodes.map((n) => [n.nodeId, n]));
	const visited = new Set<string>();
	const stack = [startId];
	while (stack.length > 0) {
		const id = stack.pop()!;
		if (visited.has(id)) continue;
		visited.add(id);
		const node = byId.get(id);
		if (!node) continue;
		for (const next of [node.navUp, node.navDown, node.navLeft, node.navRight]) {
			if (next && !visited.has(next)) stack.push(next);
		}
	}
	return visited;
}

describe('buildChapterMenusForTitleset navigation', () => {
	it('wires complete directional nav with no unreachable buttons and a default focus on every page', () => {
		// 8 chapters over a 6-per-page cap forces 2 pages (6 + 2), exercising
		// the grid + Previous/Next/Back utility row wiring on both a full page
		// and a partial last page.
		const menus = buildChapterMenusForTitleset(buildTitleset(8), 'NTSC', 'return-menu');

		expect(menus).toHaveLength(2);

		for (const menu of menus) {
			const doc = menu.authoredDocument;
			expect(doc).not.toBeNull();

			const buttonIds = doc!.scene.nodes.filter((n) => n.type === 'button').map((n) => n.id);
			expect(buttonIds.length).toBeGreaterThan(0);

			const defaultFocusId = doc!.interaction.defaultFocusId;
			expect(defaultFocusId).not.toBeNull();
			expect(buttonIds).toContain(defaultFocusId);

			const reachable = reachableFrom(defaultFocusId!, doc!.interaction.nodes);
			for (const id of buttonIds) {
				expect(reachable.has(id)).toBe(true);
			}
		}
	});

	it('wires complete directional nav for a single-page grid with no return menu', () => {
		// No Previous/Next/Back utility row at all — the grid itself must
		// still be fully connected from the default focus.
		const [menu] = buildChapterMenusForTitleset(buildTitleset(3), 'NTSC', null);

		const doc = menu.authoredDocument!;
		const buttonIds = doc.scene.nodes.filter((n) => n.type === 'button').map((n) => n.id);
		expect(buttonIds).toHaveLength(3);

		const reachable = reachableFrom(doc.interaction.defaultFocusId!, doc.interaction.nodes);
		for (const id of buttonIds) {
			expect(reachable.has(id)).toBe(true);
		}
	});
});
