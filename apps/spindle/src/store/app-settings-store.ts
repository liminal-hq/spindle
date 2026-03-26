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
}

interface AppSettingsState extends AppSettings {
	setDevSkipSidecar: (value: boolean) => Promise<void>;
	loadSettings: () => Promise<void>;
}

const STORE_PATH = 'app-settings.json';

export const useAppSettingsStore = create<AppSettingsState>((set) => ({
	devSkipSidecar: false,

	loadSettings: async () => {
		const store = await load(STORE_PATH);
		const devSkipSidecar = await store.get<boolean>('devSkipSidecar');
		set({ devSkipSidecar: devSkipSidecar ?? false });
	},

	setDevSkipSidecar: async (value) => {
		set({ devSkipSidecar: value });
		const store = await load(STORE_PATH);
		await store.set('devSkipSidecar', value);
		await store.save();
	},
}));
