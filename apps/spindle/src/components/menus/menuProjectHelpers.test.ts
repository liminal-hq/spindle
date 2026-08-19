// Tests for menuProjectHelpers: the "what counts as a button" join and the
// navigation connection-count computation that feeds MenuListItem badges.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { computeMenuConnectionCounts, getMenuButtons } from './menuProjectHelpers';
import type { Menu, SpindleProjectFile } from '../../types/project';
import { DEFAULT_HIGHLIGHT_COLOURS, createDefaultMenuCompilePolicy } from '../../types/project';

function emptyMenu(id: string, name: string): Menu {
	return {
		id,
		name,
		authoredDocument: {
			id,
			name,
			domain: 'vmgm',
			scene: {
				designSize: { width: 720, height: 480, aspect: 'four-by-three' },
				background: { assetId: null, colour: null },
				nodes: [],
				guides: [],
			},
			interaction: { defaultFocusId: null, nodes: [], timeoutAction: null },
			timing: {
				introStartSecs: 0,
				introDurationSecs: 0,
				loopStartSecs: 0,
				loopDurationSecs: 0,
				loopCount: 0,
				audioAssetId: null,
			},
			highlightColours: { ...DEFAULT_HIGHLIGHT_COLOURS },
			backgroundMode: 'still',
			themeRef: null,
			generationMeta: null,
			compilePolicy: createDefaultMenuCompilePolicy('four-by-three'),
		},
	};
}

function buildProject(menus: Menu[]): SpindleProjectFile {
	return {
		schemaVersion: 1,
		project: {
			id: 'project-1',
			name: 'Helpers Lab',
			createdAt: '2026-04-08T00:00:00Z',
			modifiedAt: '2026-04-08T00:00:00Z',
		},
		disc: {
			family: 'dvd-video',
			standard: 'NTSC',
			capacityTarget: 'DVD5',
			firstPlayAction: null,
			globalMenus: menus,
			titlesets: [],
		},
		assets: [],
		buildSettings: {
			outputDirectory: null,
			generateIso: false,
			safetyMarginBytes: 0,
			allocationStrategy: 'duration-weighted',
		},
	};
}

describe('computeMenuConnectionCounts', () => {
	it('counts an edge whose only source is a group-nested button focus node', () => {
		// Regression guard: `getMenuButtons` only sees top-level scene
		// buttons, so connection counts must walk ALL interaction nodes (not
		// just `getMenuButtons`'s view) to see an edge that comes from a
		// button nested inside a Group — the same edge MenuMap already draws
		// by scanning `interaction.nodes` directly.
		const menuA = emptyMenu('menu-a', 'Menu A');
		const menuB = emptyMenu('menu-b', 'Menu B');

		menuA.authoredDocument!.scene.nodes = [
			{
				type: 'group',
				id: 'group-1',
				name: 'Group',
				children: [
					{
						type: 'button',
						id: 'grouped-btn',
						label: 'Grouped',
						x: 0,
						y: 0,
						width: 100,
						height: 40,
						highlightMode: 'static',
						highlightKeyframes: [],
						videoAssetId: null,
					},
				],
			},
		];
		menuA.authoredDocument!.interaction.nodes = [
			{
				nodeId: 'grouped-btn',
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				action: { type: 'showMenu', menuId: 'menu-b' },
			},
		];

		// Sanity check: the grouped button is invisible to the top-level
		// button join, so it must not be how connection counts see the edge.
		expect(getMenuButtons(menuA)).toHaveLength(0);

		const project = buildProject([menuA, menuB]);
		const counts = computeMenuConnectionCounts(project);

		expect(counts['menu-a'].outgoing).toBeGreaterThanOrEqual(1);
		expect(counts['menu-b'].incoming).toBeGreaterThanOrEqual(1);
	});
});
