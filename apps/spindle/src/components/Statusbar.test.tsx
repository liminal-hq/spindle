// Tests for the Statusbar component.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useProjectStore } from '../store/project-store';
import { createDefaultProject } from '../types/project';
import { Statusbar } from './Statusbar';

vi.mock('@tauri-apps/api/app', () => ({
	getVersion: vi.fn().mockResolvedValue('1.2.3'),
}));

const initialState = useProjectStore.getState();

describe('Statusbar', () => {
	afterEach(() => {
		useProjectStore.setState(initialState, true);
	});

	it('shows the no-project state when no project is open', () => {
		useProjectStore.setState({ project: null });

		render(<Statusbar />);

		expect(screen.getByText('No project open')).toBeInTheDocument();
	});

	it('shows disc standard, capacity, title/menu counts for an open project', () => {
		const project = createDefaultProject('My Disc');
		project.disc.standard = 'NTSC';
		project.disc.capacityTarget = 'DVD9';
		project.disc.titlesets[0].titles = [
			{
				id: 'title-1',
				name: 'Feature',
				sourceAssetId: null,
				videoMapping: null,
				videoOutputProfile: null,
				audioMappings: [],
				subtitleMappings: [],
				chapters: [],
				endAction: null,
				orderIndex: 0,
				bitrateWeight: 1,
				bitrateFloorBps: null,
				bitrateCeilingBps: null,
				pinnedBitrateBps: null,
			} as any,
		];

		useProjectStore.setState({ project, isDirty: false, validationIssues: [] });

		render(<Statusbar />);

		expect(screen.getByText(/DVD-Video/)).toBeInTheDocument();
		expect(screen.getByText(/NTSC/)).toBeInTheDocument();
		expect(screen.getByText('DVD-9 (8.5 GB)')).toBeInTheDocument();
		expect(screen.getByText(/1 title/)).toBeInTheDocument();
		expect(screen.getByText(/0 menus/)).toBeInTheDocument();
	});

	it('pluralises title/menu counts correctly for multiple items', () => {
		const project = createDefaultProject('Multi Disc');
		project.disc.globalMenus = [{ id: 'menu-1' } as any, { id: 'menu-2' } as any];

		useProjectStore.setState({ project, isDirty: false, validationIssues: [] });

		render(<Statusbar />);

		expect(screen.getByText(/0 titles/)).toBeInTheDocument();
		expect(screen.getByText(/2 menus/)).toBeInTheDocument();
	});

	it('shows an unsaved-changes indicator when the project is dirty', () => {
		useProjectStore.setState({
			project: createDefaultProject(),
			isDirty: true,
			validationIssues: [],
		});

		render(<Statusbar />);

		expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
	});

	it('does not show the unsaved-changes indicator when the project is clean', () => {
		useProjectStore.setState({
			project: createDefaultProject(),
			isDirty: false,
			validationIssues: [],
		});

		render(<Statusbar />);

		expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
	});

	it('shows an error dot when validation issues include an error', () => {
		const project = createDefaultProject();
		useProjectStore.setState({
			project,
			isDirty: false,
			validationIssues: [{ severity: 'error', message: 'bad', path: '' } as any],
		});

		const { container } = render(<Statusbar />);

		expect(container.querySelector('.statusbar__dot--error')).not.toBeNull();
	});

	it('shows a warning dot when validation issues include only warnings', () => {
		const project = createDefaultProject();
		useProjectStore.setState({
			project,
			isDirty: false,
			validationIssues: [{ severity: 'warning', message: 'meh', path: '' } as any],
		});

		const { container } = render(<Statusbar />);

		expect(container.querySelector('.statusbar__dot--warning')).not.toBeNull();
		expect(container.querySelector('.statusbar__dot--error')).toBeNull();
	});

	it('loads and displays the app version from the Tauri runtime', async () => {
		useProjectStore.setState({ project: null });

		render(<Statusbar />);

		await waitFor(() => {
			expect(screen.getByText('Spindle v1.2.3')).toBeInTheDocument();
		});
	});
});
