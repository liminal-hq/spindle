// Tests for the app settings store.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGet, mockSet, mockSave, mockLoad } = vi.hoisted(() => {
	const mockGet = vi.fn();
	const mockSet = vi.fn();
	const mockSave = vi.fn();
	const mockLoad = vi.fn().mockResolvedValue({
		get: mockGet,
		set: mockSet,
		save: mockSave,
	});
	return { mockGet, mockSet, mockSave, mockLoad };
});

vi.mock('@tauri-apps/plugin-store', () => ({
	load: mockLoad,
}));

import { useAppSettingsStore } from './app-settings-store';

const initialState = useAppSettingsStore.getState();

describe('app-settings-store', () => {
	beforeEach(() => {
		mockGet.mockReset();
		mockSet.mockReset();
		mockSave.mockReset();
		mockLoad.mockClear();
	});

	afterEach(() => {
		useAppSettingsStore.setState(initialState, true);
	});

	describe('setters', () => {
		it('setDevSkipSidecar updates state optimistically and persists', async () => {
			await useAppSettingsStore.getState().setDevSkipSidecar(true);

			expect(useAppSettingsStore.getState().devSkipSidecar).toBe(true);
			expect(mockSet).toHaveBeenCalledWith('devSkipSidecar', true);
			expect(mockSave).toHaveBeenCalledTimes(1);
		});

		it('setDevSkipUnsupportedStreams updates state and persists', async () => {
			await useAppSettingsStore.getState().setDevSkipUnsupportedStreams(true);

			expect(useAppSettingsStore.getState().devSkipUnsupportedStreams).toBe(true);
			expect(mockSet).toHaveBeenCalledWith('devSkipUnsupportedStreams', true);
			expect(mockSave).toHaveBeenCalledTimes(1);
		});

		it('setDevQuantizeOverlayPalette updates state and persists', async () => {
			await useAppSettingsStore.getState().setDevQuantizeOverlayPalette(true);

			expect(useAppSettingsStore.getState().devQuantizeOverlayPalette).toBe(true);
			expect(mockSet).toHaveBeenCalledWith('devQuantizeOverlayPalette', true);
			expect(mockSave).toHaveBeenCalledTimes(1);
		});

		it('setLastMediaDir updates state and persists', async () => {
			await useAppSettingsStore.getState().setLastMediaDir('/media/dir');

			expect(useAppSettingsStore.getState().lastMediaDir).toBe('/media/dir');
			expect(mockSet).toHaveBeenCalledWith('lastMediaDir', '/media/dir');
			expect(mockSave).toHaveBeenCalledTimes(1);
		});

		it('setLastProjectDir updates state and persists', async () => {
			await useAppSettingsStore.getState().setLastProjectDir('/project/dir');

			expect(useAppSettingsStore.getState().lastProjectDir).toBe('/project/dir');
			expect(mockSet).toHaveBeenCalledWith('lastProjectDir', '/project/dir');
			expect(mockSave).toHaveBeenCalledTimes(1);
		});

		it('setLastOutputDir updates state and persists', async () => {
			await useAppSettingsStore.getState().setLastOutputDir('/output/dir');

			expect(useAppSettingsStore.getState().lastOutputDir).toBe('/output/dir');
			expect(mockSet).toHaveBeenCalledWith('lastOutputDir', '/output/dir');
			expect(mockSave).toHaveBeenCalledTimes(1);
		});

		it('persists via the app-settings.json store path', async () => {
			await useAppSettingsStore.getState().setDevSkipSidecar(true);

			expect(mockLoad).toHaveBeenCalledWith('app-settings.json');
		});
	});

	describe('loadSettings', () => {
		it('populates state from persisted values', async () => {
			mockGet.mockImplementation((key: string) => {
				const values: Record<string, unknown> = {
					devSkipSidecar: true,
					devSkipUnsupportedStreams: true,
					devQuantizeOverlayPalette: true,
					lastMediaDir: '/media',
					lastProjectDir: '/project',
					lastOutputDir: '/output',
				};
				return Promise.resolve(values[key]);
			});

			await useAppSettingsStore.getState().loadSettings();

			expect(useAppSettingsStore.getState()).toMatchObject({
				devSkipSidecar: true,
				devSkipUnsupportedStreams: true,
				devQuantizeOverlayPalette: true,
				lastMediaDir: '/media',
				lastProjectDir: '/project',
				lastOutputDir: '/output',
			});
		});

		it('falls back to defaults when persisted values are undefined', async () => {
			mockGet.mockResolvedValue(undefined);

			await useAppSettingsStore.getState().loadSettings();

			expect(useAppSettingsStore.getState()).toMatchObject({
				devSkipSidecar: false,
				devSkipUnsupportedStreams: false,
				devQuantizeOverlayPalette: false,
				lastMediaDir: null,
				lastProjectDir: null,
				lastOutputDir: null,
			});
		});

		it('reads from the app-settings.json store path', async () => {
			mockGet.mockResolvedValue(undefined);

			await useAppSettingsStore.getState().loadSettings();

			expect(mockLoad).toHaveBeenCalledWith('app-settings.json');
		});
	});
});
