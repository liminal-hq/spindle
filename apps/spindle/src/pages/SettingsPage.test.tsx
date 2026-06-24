// Tests for the Settings page.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useProjectStore } from '../store/project-store';
import { useAppSettingsStore } from '../store/app-settings-store';
import { createDefaultProject } from '../types/project';
import { SettingsPage } from './SettingsPage';

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
const { mockConfirm, mockSave } = vi.hoisted(() => ({
	mockConfirm: vi.fn(),
	mockSave: vi.fn(),
}));
const { mockExportDiagnostics } = vi.hoisted(() => ({ mockExportDiagnostics: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: mockInvoke,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
	confirm: mockConfirm,
	save: mockSave,
}));

vi.mock('tauri-plugin-spindle-project-api', () => ({
	exportDiagnostics: mockExportDiagnostics,
}));

const initialProjectState = useProjectStore.getState();
const initialSettingsState = useAppSettingsStore.getState();

describe('SettingsPage', () => {
	beforeEach(() => {
		mockInvoke.mockReset();
		mockInvoke.mockResolvedValue({ path: '/cache/thumbnails', sizeBytes: 0, fileCount: 0 });
		mockConfirm.mockReset();
		mockSave.mockReset();
		mockExportDiagnostics.mockReset();
	});

	afterEach(() => {
		useProjectStore.setState(initialProjectState, true);
		useAppSettingsStore.setState(initialSettingsState, true);
	});

	it('checks the toolchain on mount', () => {
		const checkToolchain = vi.fn();
		useProjectStore.setState({ checkToolchain });

		render(<SettingsPage />);

		expect(checkToolchain).toHaveBeenCalled();
	});

	it('shows "Checking toolchain…" when no toolchain entries are loaded yet', () => {
		useProjectStore.setState({ toolchain: [], checkToolchain: vi.fn() });

		render(<SettingsPage />);

		expect(screen.getByText('Checking toolchain…')).toBeInTheDocument();
	});

	it('renders toolchain entries with availability and version', () => {
		useProjectStore.setState({
			checkToolchain: vi.fn(),
			toolchain: [
				{ name: 'ffmpeg', purpose: 'encode', available: true, version: '6.0' },
				{ name: 'dvdauthor', purpose: 'author', available: false, version: null },
			],
		});

		render(<SettingsPage />);

		expect(screen.getByText('ffmpeg')).toBeInTheDocument();
		expect(screen.getByText('6.0')).toBeInTheDocument();
		expect(screen.getByText('dvdauthor')).toBeInTheDocument();
	});

	it('loads and displays thumbnail cache status on mount', async () => {
		mockInvoke.mockResolvedValue({ path: '/cache/thumbs', sizeBytes: 2_000_000, fileCount: 5 });
		useProjectStore.setState({ checkToolchain: vi.fn() });

		render(<SettingsPage />);

		await waitFor(() => {
			expect(screen.getByText('Items').nextElementSibling).toHaveTextContent('5');
		});
		expect(screen.getByText('Size').nextElementSibling).toHaveTextContent('2.0 MB');
		expect(screen.getByText('/cache/thumbs')).toBeInTheDocument();
	});

	it('shows a cache error message when the cache status lookup fails', async () => {
		mockInvoke.mockRejectedValue(new Error('cache unavailable'));
		useProjectStore.setState({ checkToolchain: vi.fn() });

		render(<SettingsPage />);

		await waitFor(() => {
			expect(screen.getByText('cache unavailable')).toBeInTheDocument();
		});
	});

	it('clears the thumbnail cache after confirmation', async () => {
		mockInvoke.mockResolvedValueOnce({ path: '/cache', sizeBytes: 1000, fileCount: 3 });
		mockConfirm.mockResolvedValue(true);
		useProjectStore.setState({ checkToolchain: vi.fn() });

		render(<SettingsPage />);
		await waitFor(() =>
			expect(screen.getByText('Items').nextElementSibling).toHaveTextContent('3'),
		);

		mockInvoke.mockResolvedValueOnce(undefined); // clear_thumbnail_cache
		mockInvoke.mockResolvedValueOnce({ path: '/cache', sizeBytes: 0, fileCount: 0 }); // refresh

		fireEvent.click(screen.getByText('Clear Thumbnail Cache'));

		await waitFor(() => {
			expect(mockInvoke).toHaveBeenCalledWith('clear_thumbnail_cache');
		});
	});

	it('does not clear the thumbnail cache when the confirmation is declined', async () => {
		mockInvoke.mockResolvedValueOnce({ path: '/cache', sizeBytes: 1000, fileCount: 3 });
		mockConfirm.mockResolvedValue(false);
		useProjectStore.setState({ checkToolchain: vi.fn() });

		render(<SettingsPage />);
		await waitFor(() =>
			expect(screen.getByText('Items').nextElementSibling).toHaveTextContent('3'),
		);

		fireEvent.click(screen.getByText('Clear Thumbnail Cache'));

		await waitFor(() => {
			expect(mockConfirm).toHaveBeenCalled();
		});
		expect(mockInvoke).not.toHaveBeenCalledWith('clear_thumbnail_cache');
	});

	it('toggles devSkipSidecar and re-checks the toolchain', async () => {
		const setDevSkipSidecar = vi.fn().mockResolvedValue(undefined);
		const checkToolchain = vi.fn();
		useAppSettingsStore.setState({ setDevSkipSidecar });
		useProjectStore.setState({ checkToolchain });

		render(<SettingsPage />);
		checkToolchain.mockClear();

		fireEvent.click(
			screen.getByText('Skip bundled sidecars').closest('label')!.querySelector('input')!,
		);

		expect(setDevSkipSidecar).toHaveBeenCalledWith(true);
		expect(checkToolchain).toHaveBeenCalled();
	});

	it('toggles devSkipUnsupportedStreams without re-checking the toolchain', () => {
		const setDevSkipUnsupportedStreams = vi.fn().mockResolvedValue(undefined);
		const checkToolchain = vi.fn();
		useAppSettingsStore.setState({ setDevSkipUnsupportedStreams });
		useProjectStore.setState({ checkToolchain });

		render(<SettingsPage />);
		checkToolchain.mockClear();

		fireEvent.click(
			screen.getByText('Skip unsupported streams').closest('label')!.querySelector('input')!,
		);

		expect(setDevSkipUnsupportedStreams).toHaveBeenCalledWith(true);
		expect(checkToolchain).not.toHaveBeenCalled();
	});

	it('toggles devQuantizeOverlayPalette without re-checking the toolchain', () => {
		const setDevQuantizeOverlayPalette = vi.fn().mockResolvedValue(undefined);
		const checkToolchain = vi.fn();
		useAppSettingsStore.setState({ setDevQuantizeOverlayPalette });
		useProjectStore.setState({ checkToolchain });

		render(<SettingsPage />);
		checkToolchain.mockClear();

		fireEvent.click(
			screen.getByText('Quantize overlay palette (dev)').closest('label')!.querySelector('input')!,
		);

		expect(setDevQuantizeOverlayPalette).toHaveBeenCalledWith(true);
		expect(checkToolchain).not.toHaveBeenCalled();
	});

	it('exports diagnostics via dialog save and write_text_file', async () => {
		useProjectStore.setState({ project: createDefaultProject(), checkToolchain: vi.fn() });
		mockExportDiagnostics.mockResolvedValue('{"diagnostics":true}');
		mockSave.mockResolvedValue('/tmp/diagnostics.json');

		render(<SettingsPage />);
		fireEvent.click(screen.getByText('Export Diagnostics…'));

		await waitFor(() => {
			expect(mockInvoke).toHaveBeenCalledWith('write_text_file', {
				path: '/tmp/diagnostics.json',
				contents: '{"diagnostics":true}',
			});
		});
	});

	it('does not write a file when the export save dialog is cancelled', async () => {
		useProjectStore.setState({ project: createDefaultProject(), checkToolchain: vi.fn() });
		mockExportDiagnostics.mockResolvedValue('{}');
		mockSave.mockResolvedValue(null);

		render(<SettingsPage />);
		fireEvent.click(screen.getByText('Export Diagnostics…'));

		await waitFor(() => expect(mockSave).toHaveBeenCalled());
		expect(mockInvoke).not.toHaveBeenCalledWith('write_text_file', expect.anything());
	});
});
