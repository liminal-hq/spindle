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

	describe('audio track bitrate control', () => {
		function buildProjectWithAudioMapping() {
			const project = buildProject();
			project.assets = [
				{
					id: 'asset-1',
					fileName: 'feature.mkv',
					sourcePath: '/media/feature.mkv',
					fileSizeBytes: null,
					durationSecs: null,
					containerFormat: null,
					videoStreams: [],
					audioStreams: [
						{
							index: 0,
							codec: 'ac3',
							channels: 2,
							sampleRate: 48000,
							language: 'eng',
							bitrateBps: null,
							title: null,
						},
					],
					subtitleStreams: [],
					compatibility: null,
					fingerprint: null,
					compatibilityDetail: null,
					warnings: [],
					thumbnailPath: null,
					thumbnailError: null,
					sourceChapters: [],
					formatTitle: null,
				},
			];
			project.disc.titlesets[0].titles = [
				{
					id: 'title-1',
					name: 'Feature',
					sourceAssetId: 'asset-1',
					videoMapping: null,
					videoOutputProfile: null,
					audioMappings: [
						{
							id: 'audio-1',
							sourceStreamIndex: 0,
							outputTarget: 'AC3',
							copyMode: 'copy',
							label: 'English',
							language: 'eng',
							orderIndex: 0,
							isDefault: true,
							channelLayout: null,
							bitrateBps: null,
						},
					],
					subtitleMappings: [],
					chapters: [],
					endAction: null,
					orderIndex: 0,
					bitrateWeight: 1,
					bitrateFloorBps: null,
					bitrateCeilingBps: null,
					pinnedBitrateBps: null,
				},
			];
			return project;
		}

		function selectFeatureTitleAndGetBitrateSelect() {
			fireEvent.click(screen.getByText('Feature'));
			const label = screen.getByDisplayValue('English');
			const row = label.closest('.titles__track-row') as HTMLElement;
			return within(row).getByTitle(
				/Selecting a bitrate switches this track to Re-encode|LPCM's bitrate is derived/,
			) as HTMLSelectElement;
		}

		beforeEach(() => {
			useProjectStore.setState({ project: buildProjectWithAudioMapping() });
		});

		it('defaults to Auto Bitrate (no override) for a track with no override', () => {
			render(<TitlesPage />);

			const select = selectFeatureTitleAndGetBitrateSelect();
			expect(select.value).toBe('');
		});

		it('selecting a bitrate sets bitrateBps and switches the track to re-encode', () => {
			render(<TitlesPage />);

			const select = selectFeatureTitleAndGetBitrateSelect();
			fireEvent.change(select, { target: { value: '192000' } });

			const mapping =
				useProjectStore.getState().project?.disc.titlesets[0].titles[0].audioMappings[0];
			expect(mapping?.bitrateBps).toBe(192000);
			expect(mapping?.copyMode).toBe('re-encode');
		});

		it('switching back to copy clears the bitrate override', () => {
			render(<TitlesPage />);

			const select = selectFeatureTitleAndGetBitrateSelect();
			fireEvent.change(select, { target: { value: '192000' } });

			const label = screen.getByDisplayValue('English');
			const row = label.closest('.titles__track-row') as HTMLElement;
			const copyModeSelect = within(row).getAllByRole('combobox')[1] as HTMLSelectElement;
			fireEvent.change(copyModeSelect, { target: { value: 'copy' } });

			const mapping =
				useProjectStore.getState().project?.disc.titlesets[0].titles[0].audioMappings[0];
			expect(mapping?.bitrateBps).toBeNull();
		});

		it('disables the bitrate control for LPCM tracks', () => {
			const project = buildProjectWithAudioMapping();
			project.disc.titlesets[0].titles[0].audioMappings[0].outputTarget = 'LPCM';
			useProjectStore.setState({ project });

			render(<TitlesPage />);

			const select = selectFeatureTitleAndGetBitrateSelect();
			expect(select.disabled).toBe(true);
		});

		it('clears a bitrate override when switching the output target to LPCM', () => {
			render(<TitlesPage />);

			const select = selectFeatureTitleAndGetBitrateSelect();
			fireEvent.change(select, { target: { value: '192000' } });

			const label = screen.getByDisplayValue('English');
			const row = label.closest('.titles__track-row') as HTMLElement;
			const outputTargetSelect = within(row).getAllByRole('combobox')[0] as HTMLSelectElement;
			fireEvent.change(outputTargetSelect, { target: { value: 'LPCM' } });

			const mapping =
				useProjectStore.getState().project?.disc.titlesets[0].titles[0].audioMappings[0];
			expect(mapping?.outputTarget).toBe('LPCM');
			expect(mapping?.bitrateBps).toBeNull();
		});
	});
});
