// Tests for navigation map rendering and first-play visibility.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FullMenuMap, MiniMenuMap } from './MenuMap';
import { DEFAULT_HIGHLIGHT_COLOURS, createDefaultMenuCompilePolicy } from '../../types/project';
import type { SpindleProjectFile } from '../../types/project';

function buildProject(): SpindleProjectFile {
	return {
		schemaVersion: 1,
		project: {
			id: 'project-1',
			name: 'Navigation Lab',
			createdAt: '2026-04-08T00:00:00Z',
			modifiedAt: '2026-04-08T00:00:00Z',
		},
		disc: {
			family: 'dvd-video',
			standard: 'NTSC',
			capacityTarget: 'DVD5',
			firstPlayAction: { type: 'showMenu', menuId: 'menu-main' },
			globalMenus: [
				{
					id: 'menu-main',
					name: 'Main Menu',
					authoredDocument: {
						id: 'menu-main',
						name: 'Main Menu',
						domain: 'vmgm',
						role: 'title-select',
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
						highlightColours: DEFAULT_HIGHLIGHT_COLOURS,
						backgroundMode: 'still',
						themeRef: null,
						generationMeta: null,
						compilePolicy: createDefaultMenuCompilePolicy('four-by-three'),
					},
				},
			],
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

describe('MiniMenuMap', () => {
	it('renders the first-play start node alongside its target menu', () => {
		render(
			<MiniMenuMap
				project={buildProject()}
				selectedMenuId={null}
				onSelect={vi.fn()}
				onExpand={vi.fn()}
			/>,
		);

		expect(screen.getByText('Disc')).toBeTruthy();
		expect(screen.getByText('Main Menu')).toBeTruthy();
	});
});

describe('FullMenuMap', () => {
	it('selects a menu from the central chart and updates the inspector', () => {
		const onSelectMenu = vi.fn();
		const onOpenInEditor = vi.fn();

		render(
			<FullMenuMap
				project={buildProject()}
				selectedMenuId={null}
				onSelectMenu={onSelectMenu}
				onOpenInEditor={onOpenInEditor}
			/>,
		);

		fireEvent.click(screen.getByTestId('menu-map-node-menu-main'));

		expect(onSelectMenu).toHaveBeenCalledWith('menu-main');
	});

	it('marks a title node as having a runtime action when endAction is playNextInTitleset or playAllInTitleset', () => {
		const project = buildProject();
		const titleId = 'title-1';
		project.disc.titlesets = [
			{
				id: 'ts-1',
				name: 'Titleset 1',
				menus: [],
				titles: [
					{
						id: titleId,
						name: 'Episode 1',
						sourceAssetId: null,
						videoMapping: null,
						videoOutputProfile: null,
						audioMappings: [],
						subtitleMappings: [],
						chapters: [],
						endAction: { type: 'playNextInTitleset' },
						orderIndex: 0,
						bitrateWeight: 1.0,
						bitrateFloorBps: null,
						bitrateCeilingBps: null,
						pinnedBitrateBps: null,
					},
					{
						id: 'title-2',
						name: 'Episode 2',
						sourceAssetId: null,
						videoMapping: null,
						videoOutputProfile: null,
						audioMappings: [],
						subtitleMappings: [],
						chapters: [],
						endAction: { type: 'playAllInTitleset' },
						orderIndex: 1,
						bitrateWeight: 1.0,
						bitrateFloorBps: null,
						bitrateCeilingBps: null,
						pinnedBitrateBps: null,
					},
				],
			},
		];

		render(
			<FullMenuMap
				project={project}
				selectedMenuId={null}
				onSelectMenu={vi.fn()}
				onOpenInEditor={vi.fn()}
			/>,
		);

		// Both title nodes should carry the return/runtime-action indicator
		expect(screen.getByTestId(`menu-map-node-${titleId}`).dataset.hasReturn).toBe('true');
		expect(screen.getByTestId('menu-map-node-title-2').dataset.hasReturn).toBe('true');
	});
});
