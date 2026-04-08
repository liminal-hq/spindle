// Tests for navigation map rendering and first-play visibility.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FullMenuMap, MiniMenuMap } from './MenuMap';
import { DEFAULT_HIGHLIGHT_COLOURS } from '../../types/project';
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
					backgroundAssetId: null,
					buttons: [],
					defaultButtonId: null,
					highlightColours: DEFAULT_HIGHLIGHT_COLOURS,
					backgroundMode: 'still',
					motionDurationSecs: null,
					motionAudioAssetId: null,
					motionLoopCount: 0,
					timeoutAction: null,
					authoredDocument: null,
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
});
