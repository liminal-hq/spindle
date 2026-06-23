// Tests for the build progress step-detail line: elapsed/ETA formatting vs
// the raw stepDetail fallback for non-FFmpeg steps.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildPage } from './BuildPage';
import { useProjectStore } from '../store/project-store';
import type { ProjectState } from '../store/project-store';
import type { BuildProgress, SpindleProjectFile } from '../types/project';

vi.mock('../App', () => ({
	useNavigation: () => ({
		consumePendingEntityId: () => null,
		navigateTo: () => {},
	}),
}));

function buildProject(): SpindleProjectFile {
	return {
		schemaVersion: 1,
		project: {
			id: 'project-1',
			name: 'Build Progress Lab',
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
			outputDirectory: '/tmp/dvd_output',
			generateIso: false,
			safetyMarginBytes: 0,
			allocationStrategy: 'duration-weighted',
		},
	};
}

function baseProgress(overrides: Partial<BuildProgress> = {}): BuildProgress {
	return {
		jobIndex: 0,
		totalJobs: 1,
		currentLabel: 'Transcode "Feature"',
		status: 'running',
		output: null,
		stepLabel: 'FFmpeg transcode',
		stepPercent: 42,
		stepDetail: null,
		stepStatus: 'running',
		...overrides,
	};
}

describe('BuildPage step-detail line', () => {
	let initialState: ProjectState;

	beforeEach(() => {
		initialState = useProjectStore.getState();
		useProjectStore.setState({
			...initialState,
			project: buildProject(),
			validateProject: vi.fn().mockResolvedValue(undefined),
			buildStatus: 'building',
		});
	});

	afterEach(() => {
		cleanup();
		useProjectStore.setState(initialState);
	});

	it('shows elapsed time and an ETA when both are present', () => {
		useProjectStore.setState({
			buildProgress: baseProgress({ elapsedSecs: 754, etaSecs: 500 }),
		});

		render(<BuildPage />);

		expect(screen.getByText('12m34s elapsed · ~8m20s remaining')).toBeInTheDocument();
	});

	it('shows elapsed time alone when no ETA is available yet', () => {
		useProjectStore.setState({
			buildProgress: baseProgress({ elapsedSecs: 12, etaSecs: null }),
		});

		render(<BuildPage />);

		expect(screen.getByText('12s elapsed')).toBeInTheDocument();
		expect(screen.queryByText(/remaining/)).not.toBeInTheDocument();
	});

	it('falls back to the raw stepDetail for non-FFmpeg-progress steps', () => {
		useProjectStore.setState({
			buildProgress: baseProgress({
				stepLabel: 'Prepare subtitle text',
				stepDetail: '/tmp/dvd_output/_spindle_work/subtitles/title-1_sub_2.srt',
				elapsedSecs: null,
				etaSecs: null,
			}),
		});

		render(<BuildPage />);

		expect(
			screen.getByText('/tmp/dvd_output/_spindle_work/subtitles/title-1_sub_2.srt'),
		).toBeInTheDocument();
		expect(screen.queryByText(/elapsed/)).not.toBeInTheDocument();
	});
});
