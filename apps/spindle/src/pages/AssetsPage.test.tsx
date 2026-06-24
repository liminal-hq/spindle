// Tests for the Assets page.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useProjectStore } from '../store/project-store';
import { createDefaultProject } from '../types/project';
import { AssetsPage } from './AssetsPage';
import type { Asset } from 'tauri-plugin-spindle-project-api';

const { mockReadFile } = vi.hoisted(() => ({ mockReadFile: vi.fn() }));

vi.mock('@tauri-apps/plugin-fs', () => ({
	BaseDirectory: { AppCache: 0 },
	readFile: mockReadFile,
}));

function buildAsset(overrides: Partial<Asset> = {}): Asset {
	return {
		id: 'asset-1',
		fileName: 'feature.mkv',
		sourcePath: '/media/feature.mkv',
		fileSizeBytes: 2_000_000_000,
		durationSecs: 3725,
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

const initialState = useProjectStore.getState();

describe('AssetsPage', () => {
	beforeEach(() => {
		mockReadFile.mockReset();
		mockReadFile.mockRejectedValue(new Error('no thumbnail'));
	});

	afterEach(() => {
		useProjectStore.setState(initialState, true);
	});

	it('shows the no-project state when no project is open', () => {
		useProjectStore.setState({ project: null });

		render(<AssetsPage />);

		expect(screen.getByText('No Project Open')).toBeInTheDocument();
	});

	it('shows the empty-assets view and calls importAssets when there are no assets', () => {
		const importAssets = vi.fn();
		const project = createDefaultProject();
		useProjectStore.setState({ project, importAssets });

		render(<AssetsPage />);
		expect(screen.getByText('No assets imported')).toBeInTheDocument();

		fireEvent.click(screen.getAllByText('Import Media')[0]);
		expect(importAssets).toHaveBeenCalledTimes(1);
	});

	it('renders an asset row with duration, container, and size', () => {
		const project = createDefaultProject();
		project.assets = [buildAsset()];
		useProjectStore.setState({ project });

		render(<AssetsPage />);

		expect(screen.getByText('feature.mkv')).toBeInTheDocument();
		expect(screen.getByText('1:02:05')).toBeInTheDocument();
		expect(screen.getByText('matroska')).toBeInTheDocument();
		expect(screen.getByText('2.0 GB')).toBeInTheDocument();
	});

	it('shows stream-count badges for video/audio/subtitle streams', () => {
		const project = createDefaultProject();
		project.assets = [
			buildAsset({
				videoStreams: [{ index: 0 } as any],
				audioStreams: [{ index: 0 } as any, { index: 1 } as any],
				subtitleStreams: [{ index: 0 } as any],
			}),
		];
		useProjectStore.setState({ project });

		render(<AssetsPage />);

		expect(screen.getByText('1 video')).toBeInTheDocument();
		expect(screen.getByText('2 audio')).toBeInTheDocument();
		expect(screen.getByText('1 sub')).toBeInTheDocument();
	});

	it('shows the "image" badge for still-image assets', () => {
		const project = createDefaultProject();
		project.assets = [buildAsset({ fileName: 'cover.png' })];
		useProjectStore.setState({ project });

		render(<AssetsPage />);

		expect(screen.getByText('image')).toBeInTheDocument();
	});

	it('selects an asset on click and shows its detail panel', () => {
		const project = createDefaultProject();
		project.assets = [buildAsset()];
		useProjectStore.setState({ project });

		render(<AssetsPage />);
		fireEvent.click(screen.getByText('feature.mkv'));

		expect(screen.getByText('/media/feature.mkv')).toBeInTheDocument();
		expect(screen.getByText('Relink…')).toBeInTheDocument();
	});

	it('calls removeAsset and clears selection when Remove is clicked', () => {
		const removeAsset = vi.fn();
		const project = createDefaultProject();
		project.assets = [buildAsset()];
		useProjectStore.setState({ project, removeAsset });

		render(<AssetsPage />);
		fireEvent.click(screen.getByText('feature.mkv'));
		fireEvent.click(screen.getByText('Remove'));

		expect(removeAsset).toHaveBeenCalledWith('asset-1');
		expect(screen.queryByText('/media/feature.mkv')).not.toBeInTheDocument();
	});

	it('calls relinkAsset when Relink is clicked', () => {
		const relinkAsset = vi.fn().mockResolvedValue(undefined);
		const project = createDefaultProject();
		project.assets = [buildAsset()];
		useProjectStore.setState({ project, relinkAsset });

		render(<AssetsPage />);
		fireEvent.click(screen.getByText('feature.mkv'));
		fireEvent.click(screen.getByText('Relink…'));

		expect(relinkAsset).toHaveBeenCalledWith('asset-1');
	});

	it('renders video/audio/subtitle stream details when present', () => {
		const project = createDefaultProject();
		project.assets = [
			buildAsset({
				videoStreams: [
					{ index: 0, codec: 'h264', width: 1920, height: 1080, frameRate: 23.976 } as any,
				],
				audioStreams: [
					{ index: 0, codec: 'aac', channels: 2, sampleRate: 48000, language: 'eng' } as any,
				],
				subtitleStreams: [
					{ index: 0, codec: 'subrip', subtitleType: 'text', language: 'eng' } as any,
				],
			}),
		];
		useProjectStore.setState({ project });

		render(<AssetsPage />);
		fireEvent.click(screen.getByText('feature.mkv'));

		expect(screen.getByText('Video Streams')).toBeInTheDocument();
		expect(screen.getByText(/h264/)).toBeInTheDocument();
		expect(screen.getByText('Audio Streams')).toBeInTheDocument();
		expect(screen.getByText(/aac/)).toBeInTheDocument();
		expect(screen.getByText('Subtitle Streams')).toBeInTheDocument();
		expect(screen.getByText(/subrip/)).toBeInTheDocument();
	});

	it('shows asset warnings in both the row and the detail panel', () => {
		const project = createDefaultProject();
		project.assets = [buildAsset({ warnings: [{ code: 'W1', message: 'Unusual frame rate' }] })];
		useProjectStore.setState({ project });

		render(<AssetsPage />);

		expect(screen.getByText('Unusual frame rate')).toBeInTheDocument();
		fireEvent.click(screen.getByText('feature.mkv'));
		expect(screen.getAllByText('Unusual frame rate').length).toBeGreaterThanOrEqual(1);
	});

	it('shows a compatibility badge based on the assessment', () => {
		const project = createDefaultProject();
		project.assets = [buildAsset({ compatibility: 're-encode-required' })];
		useProjectStore.setState({ project });

		render(<AssetsPage />);

		expect(screen.getByText('Re-encode')).toBeInTheDocument();
	});

	it('expands compatibility detail rows when "Show details" is clicked', () => {
		const project = createDefaultProject();
		project.assets = [
			buildAsset({
				compatibility: 're-encode-required',
				compatibilityDetail: {
					overall: 're-encode-required',
					video: {
						codec: { value: 'hevc', dvdRequires: 'mpeg2', action: 'transcode', compatible: false },
						resolution: {
							value: '1920x1080',
							dvdRequires: '720x480',
							action: 'scale',
							compatible: false,
						},
						frameRate: { value: '24', dvdRequires: '29.97', action: 'none', compatible: true },
					},
					audioStreams: [],
					container: {
						format: { value: 'matroska', dvdRequires: 'vob', action: 'remux', compatible: false },
					},
				},
			}),
		];
		useProjectStore.setState({ project });

		render(<AssetsPage />);
		fireEvent.click(screen.getByText('feature.mkv'));
		fireEvent.click(screen.getByText('Show details'));

		expect(screen.getByText('Video codec')).toBeInTheDocument();
		expect(screen.getByText('hevc')).toBeInTheDocument();
		expect(screen.getByText('Hide details')).toBeInTheDocument();
	});

	it('loads a still-image preview via readFile and renders an img element', async () => {
		mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
		const project = createDefaultProject();
		project.assets = [buildAsset({ fileName: 'cover.png', sourcePath: '/media/cover.png' })];
		useProjectStore.setState({ project });

		const { container } = render(<AssetsPage />);

		await waitFor(() => {
			expect(mockReadFile).toHaveBeenCalledWith('/media/cover.png');
		});
		await waitFor(() => {
			expect(container.querySelector('img.assets__row-thumb')).not.toBeNull();
		});
	});

	it('retries once before showing a failure placeholder for a non-still-image thumbnail', async () => {
		mockReadFile.mockRejectedValue(new Error('not found'));
		const project = createDefaultProject();
		project.assets = [buildAsset({ thumbnailPath: '/cache/thumbnails/abc.jpg' })];
		useProjectStore.setState({ project });

		render(<AssetsPage />);

		await waitFor(() => {
			expect(mockReadFile).toHaveBeenCalledTimes(2);
		});
		expect(mockReadFile).toHaveBeenCalledWith('thumbnails/abc.jpg', { baseDir: 0 });
		await waitFor(() => {
			expect(screen.getByText('!')).toBeInTheDocument();
		});
	});

	it('shows a placeholder when no thumbnail is available', () => {
		const project = createDefaultProject();
		project.assets = [buildAsset()];
		useProjectStore.setState({ project });

		render(<AssetsPage />);

		expect(screen.getByText('No preview')).toBeInTheDocument();
	});
});
