// Tests for navigation map rendering and first-play visibility.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MiniMenuMap } from './MenuMap';
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
