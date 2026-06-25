// Characterization tests for the Disc Planner page — capacity overview,
// bitrate budget, and per-title/menu breakdown rendering.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlannerPage } from './PlannerPage';
import { useProjectStore } from '../store/project-store';
import type { ProjectState } from '../store/project-store';
import { DEFAULT_HIGHLIGHT_COLOURS } from '../types/project';
import type { Asset, Menu, SpindleProjectFile, Title } from '../types/project';
import type { CapacityEstimate } from 'tauri-plugin-spindle-project-api';

const { estimateDiscCapacity } = vi.hoisted(() => ({
	estimateDiscCapacity: vi.fn(),
}));

vi.mock('tauri-plugin-spindle-project-api', () => ({
	estimateDiscCapacity,
}));

function buildAsset(overrides: Partial<Asset> = {}): Asset {
	return {
		id: 'asset-1',
		fileName: 'feature.mkv',
		sourcePath: '/media/feature.mkv',
		fileSizeBytes: 2_000_000_000,
		durationSecs: 3600,
		containerFormat: 'matroska',
		videoStreams: [],
		audioStreams: [],
		subtitleStreams: [],
		compatibility: null,
		fingerprint: null,
		compatibilityDetail: null,
		warnings: [],
		thumbnailPath: null,
		thumbnailError: null,
		sourceChapters: [],
		formatTitle: null,
		...overrides,
	};
}

function buildTitle(overrides: Partial<Title> = {}): Title {
	return {
		id: 'title-1',
		name: 'Feature',
		sourceAssetId: 'asset-1',
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
		...overrides,
	};
}

function buildMenu(overrides: Partial<Menu> = {}): Menu {
	return {
		id: 'menu-1',
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
		...overrides,
	};
}

function buildProject(overrides: Partial<SpindleProjectFile> = {}): SpindleProjectFile {
	return {
		schemaVersion: 1,
		project: {
			id: 'project-1',
			name: 'Planner Lab',
			createdAt: '2026-04-01T00:00:00Z',
			modifiedAt: '2026-04-01T00:00:00Z',
		},
		disc: {
			family: 'dvd-video',
			standard: 'NTSC',
			capacityTarget: 'DVD5',
			firstPlayAction: null,
			globalMenus: [],
			titlesets: [],
		},
		assets: [],
		buildSettings: {
			outputDirectory: null,
			generateIso: false,
			safetyMarginBytes: 0,
			allocationStrategy: 'duration-weighted',
		},
		...overrides,
	};
}

function buildCapacity(overrides: Partial<CapacityEstimate> = {}): CapacityEstimate {
	return {
		capacityBytes: 4_700_000_000,
		totalDurationSecs: 3600,
		estimatedMenuBytes: 1_500_000,
		safetyMarginBytes: 50_000_000,
		estimatedOverheadBytes: 50_000_000,
		usableBytes: 4_500_000_000,
		availableBitsPerSecond: 8_000_000,
		isCapacityConstrained: false,
		estimatedOutputBytes: 3_600_000_000,
		usagePct: 80,
		isOverCapacity: false,
		titleBitrates: [{ titleId: 'title-1', bitsPerSecond: 8_000_000, audioBitsPerSecond: 448_000 }],
		floorInfeasible: false,
		...overrides,
	};
}

describe('PlannerPage', () => {
	let initialState: ProjectState;

	beforeEach(() => {
		initialState = useProjectStore.getState();
		estimateDiscCapacity.mockReset();
	});

	afterEach(() => {
		cleanup();
		useProjectStore.setState(initialState);
	});

	it('shows guidance when no project is open', () => {
		useProjectStore.setState({ ...initialState, project: null });

		render(<PlannerPage />);

		expect(screen.getByText('No Project Open')).toBeInTheDocument();
	});

	it('shows an empty state when the project has no titles', async () => {
		estimateDiscCapacity.mockResolvedValue(buildCapacity());
		useProjectStore.setState({ ...initialState, project: buildProject() });

		render(<PlannerPage />);

		await waitFor(() => expect(screen.getByText('No titles to plan')).toBeInTheDocument());
	});

	it('renders the capacity overview and per-title breakdown', async () => {
		estimateDiscCapacity.mockResolvedValue(buildCapacity());
		const project = buildProject({
			assets: [buildAsset()],
			disc: {
				...buildProject().disc,
				titlesets: [{ id: 'ts-1', name: 'Main', titles: [buildTitle()], menus: [] }],
			},
		});
		useProjectStore.setState({ ...initialState, project });

		render(<PlannerPage />);

		await waitFor(() => expect(screen.getByText('Feature')).toBeInTheDocument());

		expect(screen.getByText('feature.mkv')).toBeInTheDocument();
		expect(screen.getByText('80.0%')).toBeInTheDocument();
		expect(screen.getByText('8.00 Mbps video')).toBeInTheDocument();
		expect(screen.getByText('448 kbps audio')).toBeInTheDocument();
		expect(screen.getByText('100.0% of disc')).toBeInTheDocument();
	});

	it('flags over-capacity projects', async () => {
		estimateDiscCapacity.mockResolvedValue(
			buildCapacity({ isOverCapacity: true, usagePct: 112.5 }),
		);
		const project = buildProject({
			assets: [buildAsset()],
			disc: {
				...buildProject().disc,
				titlesets: [{ id: 'ts-1', name: 'Main', titles: [buildTitle()], menus: [] }],
			},
		});
		useProjectStore.setState({ ...initialState, project });

		render(<PlannerPage />);

		await waitFor(() => expect(screen.getByText('Over capacity')).toBeInTheDocument());
	});

	it('flags an infeasible bitrate floor', async () => {
		estimateDiscCapacity.mockResolvedValue(buildCapacity({ floorInfeasible: true }));
		const project = buildProject({
			assets: [buildAsset()],
			disc: {
				...buildProject().disc,
				titlesets: [{ id: 'ts-1', name: 'Main', titles: [buildTitle()], menus: [] }],
			},
		});
		useProjectStore.setState({ ...initialState, project });

		render(<PlannerPage />);

		await waitFor(() =>
			expect(screen.getByText(/doesn.t fit at an acceptable quality/)).toBeInTheDocument(),
		);
	});

	it('shows a pinned-bitrate badge instead of weight/floor/ceiling for pinned titles', async () => {
		estimateDiscCapacity.mockResolvedValue(buildCapacity());
		const project = buildProject({
			assets: [buildAsset()],
			disc: {
				...buildProject().disc,
				titlesets: [
					{
						id: 'ts-1',
						name: 'Main',
						titles: [buildTitle({ pinnedBitrateBps: 6_000_000, bitrateWeight: 2 })],
						menus: [],
					},
				],
			},
		});
		useProjectStore.setState({ ...initialState, project });

		render(<PlannerPage />);

		await waitFor(() => expect(screen.getByText('Pinned')).toBeInTheDocument());
		expect(screen.queryByText('weight 2')).not.toBeInTheDocument();
	});

	it('shows floor and ceiling badges for unpinned titles that have them set', async () => {
		estimateDiscCapacity.mockResolvedValue(buildCapacity());
		const project = buildProject({
			assets: [buildAsset()],
			disc: {
				...buildProject().disc,
				titlesets: [
					{
						id: 'ts-1',
						name: 'Main',
						titles: [buildTitle({ bitrateFloorBps: 2_000_000, bitrateCeilingBps: 9_000_000 })],
						menus: [],
					},
				],
			},
		});
		useProjectStore.setState({ ...initialState, project });

		render(<PlannerPage />);

		await waitFor(() => expect(screen.getByText('floor 2.00 Mbps')).toBeInTheDocument());
		expect(screen.getByText('ceiling 9.00 Mbps')).toBeInTheDocument();
	});

	it('renders the menu breakdown for still and motion menus', async () => {
		estimateDiscCapacity.mockResolvedValue(buildCapacity());
		const project = buildProject({
			assets: [buildAsset()],
			disc: {
				...buildProject().disc,
				globalMenus: [buildMenu({ name: 'Main Menu' })],
				titlesets: [
					{
						id: 'ts-1',
						name: 'Bonus',
						titles: [buildTitle()],
						menus: [
							buildMenu({
								id: 'menu-2',
								name: 'Bonus Menu',
								backgroundMode: 'motion',
								motionDurationSecs: 10,
							}),
						],
					},
				],
			},
		});
		useProjectStore.setState({ ...initialState, project });

		render(<PlannerPage />);

		await waitFor(() => expect(screen.getByText('Main Menu')).toBeInTheDocument());

		expect(screen.getByText('Global · Still · 0 buttons')).toBeInTheDocument();
		expect(screen.getByText('Bonus · Motion (10s) · 0 buttons')).toBeInTheDocument();
		expect(screen.getByText('2 menus')).toBeInTheDocument();
	});

	it('omits the menu breakdown card entirely when there are no menus', async () => {
		estimateDiscCapacity.mockResolvedValue(buildCapacity());
		const project = buildProject({
			assets: [buildAsset()],
			disc: {
				...buildProject().disc,
				titlesets: [{ id: 'ts-1', name: 'Main', titles: [buildTitle()], menus: [] }],
			},
		});
		useProjectStore.setState({ ...initialState, project });

		render(<PlannerPage />);

		await waitFor(() => expect(screen.getByText('Feature')).toBeInTheDocument());
		expect(screen.queryByText('Menu Breakdown')).not.toBeInTheDocument();
	});

	it('prompts for assets with known durations when there is no available bitrate budget', async () => {
		estimateDiscCapacity.mockResolvedValue(buildCapacity({ availableBitsPerSecond: 0 }));
		const project = buildProject({
			assets: [buildAsset()],
			disc: {
				...buildProject().disc,
				titlesets: [{ id: 'ts-1', name: 'Main', titles: [buildTitle()], menus: [] }],
			},
		});
		useProjectStore.setState({ ...initialState, project });

		render(<PlannerPage />);

		await waitFor(() =>
			expect(
				screen.getByText('Add assets with known durations to calculate bitrate budgets.'),
			).toBeInTheDocument(),
		);
	});
});
