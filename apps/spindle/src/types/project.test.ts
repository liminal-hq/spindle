// Tests for project type helpers and constants.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import {
	CAPACITY_LABELS,
	CAPACITY_BYTES,
	createDefaultProject,
	type SpindleProjectFile,
} from './project';

describe('CAPACITY_LABELS', () => {
	it('covers DVD5 and DVD9', () => {
		expect(CAPACITY_LABELS.DVD5).toContain('4.7');
		expect(CAPACITY_LABELS.DVD9).toContain('8.5');
	});
});

describe('CAPACITY_BYTES', () => {
	it('returns correct byte counts', () => {
		expect(CAPACITY_BYTES.DVD5).toBe(4_700_000_000);
		expect(CAPACITY_BYTES.DVD9).toBe(8_500_000_000);
	});

	it('DVD9 is larger than DVD5', () => {
		expect(CAPACITY_BYTES.DVD9).toBeGreaterThan(CAPACITY_BYTES.DVD5);
	});
});

describe('createDefaultProject', () => {
	it('returns a valid project structure', () => {
		const project = createDefaultProject();
		expect(project.schemaVersion).toBe(1);
		expect(project.disc.family).toBe('dvd-video');
		expect(project.disc.standard).toBe('NTSC');
		expect(project.disc.capacityTarget).toBe('DVD5');
	});

	it('uses the provided name', () => {
		const project = createDefaultProject('My DVD');
		expect(project.project.name).toBe('My DVD');
	});

	it("defaults to 'Untitled Project' when no name is given", () => {
		const project = createDefaultProject();
		expect(project.project.name).toBe('Untitled Project');
	});

	it('generates unique project IDs', () => {
		const a = createDefaultProject();
		const b = createDefaultProject();
		expect(a.project.id).not.toBe(b.project.id);
	});

	it('creates one default titleset', () => {
		const project = createDefaultProject();
		expect(project.disc.titlesets).toHaveLength(1);
		expect(project.disc.titlesets[0].name).toBe('Default');
		expect(project.disc.titlesets[0].titles).toHaveLength(0);
	});

	it('initialises with empty assets', () => {
		const project = createDefaultProject();
		expect(project.assets).toEqual([]);
	});

	it('sets conservative build defaults', () => {
		const project = createDefaultProject();
		expect(project.buildSettings.generateIso).toBe(false);
		expect(project.buildSettings.safetyMarginBytes).toBe(50_000_000);
		expect(project.buildSettings.allocationStrategy).toBe('duration-weighted');
		expect(project.buildSettings.outputDirectory).toBeNull();
	});

	it('sets timestamps to ISO 8601 format', () => {
		const project = createDefaultProject();
		expect(() => new Date(project.project.createdAt)).not.toThrow();
		expect(project.project.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(project.project.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('sets firstPlayAction to null initially', () => {
		const project = createDefaultProject();
		expect(project.disc.firstPlayAction).toBeNull();
	});

	it('creates no global menus by default', () => {
		const project = createDefaultProject();
		expect(project.disc.globalMenus).toEqual([]);
	});

	it('is valid JSON-serialisable', () => {
		const project = createDefaultProject('Round-trip Test');
		const json = JSON.stringify(project);
		const parsed = JSON.parse(json) as SpindleProjectFile;
		expect(parsed.project.name).toBe('Round-trip Test');
		expect(parsed.schemaVersion).toBe(1);
		expect(parsed.disc.titlesets).toHaveLength(1);
	});
});
