// Tests for titles page titleset placement behaviour.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TitlesPage } from './TitlesPage';
import { useProjectStore } from '../store/project-store';
import type { ProjectState } from '../store/project-store';
import type { SpindleProjectFile } from '../types/project';

vi.mock('../App', () => ({
	useNavigation: () => ({
		consumePendingEntityId: () => null,
	}),
}));

function buildProject(): SpindleProjectFile {
	return {
		schemaVersion: 1,
		project: {
			id: 'project-1',
			name: 'DVD Navigation Lab',
			createdAt: '2026-04-01T00:00:00Z',
			modifiedAt: '2026-04-01T00:00:00Z',
		},
		disc: {
			family: 'dvd-video',
			standard: 'NTSC',
			capacityTarget: 'DVD5',
			firstPlayAction: null,
			globalMenus: [],
			titlesets: [
				{
					id: 'titleset-1',
					name: 'Titleset 1',
					menus: [],
					titles: [],
				},
				{
					id: 'titleset-2',
					name: 'Titleset 2',
					menus: [],
					titles: [],
				},
			],
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

describe('TitlesPage', () => {
	let initialState: ProjectState;

	beforeEach(() => {
		initialState = useProjectStore.getState();
		useProjectStore.setState({
			...initialState,
			project: buildProject(),
			updateProject: (updater) => {
				const current = useProjectStore.getState().project;
				if (!current) return;
				useProjectStore.setState({
					project: updater(current),
				});
			},
		});
	});

	afterEach(() => {
		cleanup();
		useProjectStore.setState(initialState);
	});

	it('adds an empty-state title to the clicked titleset section', () => {
		render(<TitlesPage />);

		const titlesetHeading = screen.getByDisplayValue('Titleset 2');
		const titlesetSection = titlesetHeading.closest('.titles__titleset-section');
		expect(titlesetSection).not.toBeNull();
		const titlesetSectionElement = titlesetSection as HTMLElement;
		fireEvent.click(within(titlesetSectionElement).getByRole('button', { name: 'Add one' }));

		const project = useProjectStore.getState().project;
		expect(project?.disc.titlesets[0].titles).toHaveLength(0);
		expect(project?.disc.titlesets[1].titles).toHaveLength(1);
		expect(project?.disc.titlesets[1].titles[0].name).toBe('Title 1');
	});
});
