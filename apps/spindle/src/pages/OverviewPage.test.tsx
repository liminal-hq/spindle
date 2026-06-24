// Tests for the Overview dashboard page.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useProjectStore } from '../store/project-store';
import { createDefaultProject } from '../types/project';
import { OverviewPage } from './OverviewPage';
import type { CapacityEstimate } from 'tauri-plugin-spindle-project-api';

const { estimateDiscCapacity } = vi.hoisted(() => ({
	estimateDiscCapacity: vi.fn(),
}));

vi.mock('tauri-plugin-spindle-project-api', () => ({
	estimateDiscCapacity,
}));

function buildEstimate(overrides: Partial<CapacityEstimate> = {}): CapacityEstimate {
	return {
		capacityBytes: 4_700_000_000,
		totalDurationSecs: 0,
		estimatedMenuBytes: 0,
		safetyMarginBytes: 50_000_000,
		estimatedOverheadBytes: 0,
		usableBytes: 4_650_000_000,
		availableBitsPerSecond: 9_800_000,
		isCapacityConstrained: false,
		estimatedOutputBytes: 0,
		usagePct: 0,
		isOverCapacity: false,
		titleBitrates: [],
		floorInfeasible: false,
		...overrides,
	};
}

const initialState = useProjectStore.getState();

describe('OverviewPage', () => {
	beforeEach(() => {
		estimateDiscCapacity.mockReset();
		estimateDiscCapacity.mockResolvedValue(buildEstimate());
	});

	afterEach(() => {
		useProjectStore.setState(initialState, true);
	});

	it('shows the no-project welcome state when no project is open', () => {
		useProjectStore.setState({ project: null });

		render(<OverviewPage />);

		expect(screen.getByText('Welcome to Spindle')).toBeInTheDocument();
	});

	it('renders title/asset/menu/chapter stat counts', async () => {
		const project = createDefaultProject('My Disc');
		project.disc.globalMenus = [{ id: 'menu-1' } as any];
		project.assets = [{ id: 'asset-1' } as any];

		useProjectStore.setState({ project, validationIssues: [] });

		render(<OverviewPage />);

		await waitFor(() => expect(estimateDiscCapacity).toHaveBeenCalled());

		expect(screen.getByDisplayValue('My Disc')).toBeInTheDocument();
		expect(screen.getByText('Titles')).toBeInTheDocument();
		expect(screen.getByText('Assets')).toBeInTheDocument();
		expect(screen.getByText('Menus')).toBeInTheDocument();
		expect(screen.getByText('Chapters')).toBeInTheDocument();
	});

	it('renames the project when the title input changes', async () => {
		const project = createDefaultProject('Old Name');
		useProjectStore.setState({ project, validationIssues: [] });

		render(<OverviewPage />);
		fireEvent.change(screen.getByDisplayValue('Old Name'), { target: { value: 'New Name' } });

		expect(useProjectStore.getState().project?.project.name).toBe('New Name');
	});

	it('shows "No titles added yet" when capacity is loaded but there are no titles', async () => {
		useProjectStore.setState({ project: createDefaultProject(), validationIssues: [] });

		render(<OverviewPage />);

		await waitFor(() => {
			expect(screen.getByText(/No titles added yet/)).toBeInTheDocument();
		});
	});

	it('shows "Calculating…" before the capacity estimate resolves', () => {
		estimateDiscCapacity.mockReturnValue(new Promise(() => {})); // never resolves
		useProjectStore.setState({ project: createDefaultProject(), validationIssues: [] });

		render(<OverviewPage />);

		expect(screen.getByText('Calculating…')).toBeInTheDocument();
	});

	it('shows estimated/remaining bytes once titles exist and capacity has loaded', async () => {
		const project = createDefaultProject();
		project.disc.titlesets[0].titles = [{ id: 'title-1', chapters: [] } as any];
		estimateDiscCapacity.mockResolvedValue(
			buildEstimate({ estimatedOutputBytes: 1_000_000_000, usableBytes: 4_650_000_000 }),
		);

		useProjectStore.setState({ project, validationIssues: [] });

		render(<OverviewPage />);

		await waitFor(() => {
			expect(screen.getByText(/estimated/)).toBeInTheDocument();
		});
		expect(screen.getByText(/remaining/)).toBeInTheDocument();
	});

	it('shows "No issues found" when there are no validation issues and titles exist', async () => {
		const project = createDefaultProject();
		project.disc.titlesets[0].titles = [{ id: 'title-1', chapters: [] } as any];
		useProjectStore.setState({ project, validationIssues: [] });

		render(<OverviewPage />);

		await waitFor(() => {
			expect(
				screen.getByText('No issues found. Project looks ready to build.'),
			).toBeInTheDocument();
		});
	});

	it('renders validation issue rows when issues exist', async () => {
		useProjectStore.setState({
			project: createDefaultProject(),
			validationIssues: [
				{ severity: 'error', message: 'Dangling reference', suggestedFix: 'Remove it' } as any,
			],
		});

		render(<OverviewPage />);

		await waitFor(() => {
			expect(screen.getByText('Dangling reference')).toBeInTheDocument();
		});
		expect(screen.getByText('Remove it')).toBeInTheDocument();
	});

	it('updates the video standard when the select changes', () => {
		useProjectStore.setState({ project: createDefaultProject(), validationIssues: [] });

		render(<OverviewPage />);
		fireEvent.change(screen.getByDisplayValue('NTSC (29.97 fps, 720×480)'), {
			target: { value: 'PAL' },
		});

		expect(useProjectStore.getState().project?.disc.standard).toBe('PAL');
	});

	it('updates generateIso when the ISO checkbox is toggled', () => {
		useProjectStore.setState({ project: createDefaultProject(), validationIssues: [] });

		render(<OverviewPage />);
		fireEvent.click(
			screen.getByText('Generate ISO image').closest('label')!.querySelector('input')!,
		);

		expect(useProjectStore.getState().project?.buildSettings.generateIso).toBe(true);
	});

	it('updates twoPassVideoEncoding when the two-pass checkbox is toggled', () => {
		useProjectStore.setState({ project: createDefaultProject(), validationIssues: [] });

		render(<OverviewPage />);
		fireEvent.click(
			screen
				.getByText('Two-pass encoding (slower, more accurate sizing & quality)')
				.closest('label')!
				.querySelector('input')!,
		);

		expect(useProjectStore.getState().project?.buildSettings.twoPassVideoEncoding).toBe(true);
	});
});
