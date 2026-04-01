// Persistent application-level settings, separate from per-project state.
//
// Backed by tauri-plugin-store so values survive across sessions.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { load } from '@tauri-apps/plugin-store';
import { create } from 'zustand';

export interface AppSettings {
	devSkipSidecar: boolean;
	devSkipUnsupportedStreams: boolean;
	lastMediaDir: string | null;
	lastProjectDir: string | null;
	lastOutputDir: string | null;
}

interface AppSettingsState extends AppSettings {
	setDevSkipSidecar: (value: boolean) => Promise<void>;
	setDevSkipUnsupportedStreams: (value: boolean) => Promise<void>;
	setLastMediaDir: (path: string) => Promise<void>;
	setLastProjectDir: (path: string) => Promise<void>;
	setLastOutputDir: (path: string) => Promise<void>;
	loadSettings: () => Promise<void>;
}

const STORE_PATH = 'app-settings.json';

async function persist(key: string, value: unknown): Promise<void> {
	const store = await load(STORE_PATH);
	await store.set(key, value);
	await store.save();
}

export const useAppSettingsStore = create<AppSettingsState>((set) => ({
	devSkipSidecar: false,
	devSkipUnsupportedStreams: false,
	lastMediaDir: null,
	lastProjectDir: null,
	lastOutputDir: null,

	loadSettings: async () => {
		const store = await load(STORE_PATH);
		const [devSkipSidecar, devSkipUnsupportedStreams, lastMediaDir, lastProjectDir, lastOutputDir] =
			await Promise.all([
				store.get<boolean>('devSkipSidecar'),
				store.get<boolean>('devSkipUnsupportedStreams'),
				store.get<string>('lastMediaDir'),
				store.get<string>('lastProjectDir'),
				store.get<string>('lastOutputDir'),
			]);
		set({
			devSkipSidecar: devSkipSidecar ?? false,
			devSkipUnsupportedStreams: devSkipUnsupportedStreams ?? false,
			lastMediaDir: lastMediaDir ?? null,
			lastProjectDir: lastProjectDir ?? null,
			lastOutputDir: lastOutputDir ?? null,
		});
	},

	setDevSkipSidecar: async (value) => {
		set({ devSkipSidecar: value });
		await persist('devSkipSidecar', value);
	},

	setDevSkipUnsupportedStreams: async (value) => {
		set({ devSkipUnsupportedStreams: value });
		await persist('devSkipUnsupportedStreams', value);
	},

	setLastMediaDir: async (path) => {
		set({ lastMediaDir: path });
		await persist('lastMediaDir', path);
	},

	setLastProjectDir: async (path) => {
		set({ lastProjectDir: path });
		await persist('lastProjectDir', path);
	},

	setLastOutputDir: async (path) => {
		set({ lastOutputDir: path });
		await persist('lastOutputDir', path);
	},
}));
