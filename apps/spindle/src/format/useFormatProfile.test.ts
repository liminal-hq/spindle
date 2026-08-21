// Pins the DVD fallback profile against the Rust `DVD_VIDEO_PROFILE` row
// (`format_profile.rs`) so the two constants can't silently drift, and
// verifies the hook resolves the live command result.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { DEFAULT_DVD_FORMAT_PROFILE, useFormatProfile } from './useFormatProfile';
import type { FormatProfile } from '../types/project';

const { getFormatProfile } = vi.hoisted(() => ({
	getFormatProfile: vi.fn(),
}));

vi.mock('tauri-plugin-spindle-project-api', () => ({
	getFormatProfile,
}));

describe('DEFAULT_DVD_FORMAT_PROFILE', () => {
	it('mirrors the Rust DVD_VIDEO_PROFILE row', () => {
		expect(DEFAULT_DVD_FORMAT_PROFILE.maxButtonsPerMenu).toBe(36);
		expect(DEFAULT_DVD_FORMAT_PROFILE.minFontSizePt).toBe(12);
		expect(DEFAULT_DVD_FORMAT_PROFILE.highlightModel).toBe('four-colour-subpicture');
		expect(DEFAULT_DVD_FORMAT_PROFILE.supportsStateAnimation).toBe(false);
		expect(DEFAULT_DVD_FORMAT_PROFILE.supportedRoles).not.toContain('popup');
	});
});

describe('useFormatProfile', () => {
	it('returns the DVD fallback synchronously, then the fetched profile', async () => {
		const fetched: FormatProfile = {
			...DEFAULT_DVD_FORMAT_PROFILE,
			maxButtonsPerMenu: 99,
		};
		getFormatProfile.mockResolvedValueOnce(fetched);

		const { result } = renderHook(() => useFormatProfile('dvd-video'));
		expect(result.current.maxButtonsPerMenu).toBe(36);

		await waitFor(() => expect(result.current.maxButtonsPerMenu).toBe(99));
	});
});
