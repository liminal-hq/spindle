// Tests for project store actions.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useProjectStore } from './project-store';
import { createDefaultProject } from '../types/project';

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
	open: vi.fn(),
	save: vi.fn(),
	confirm: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
	BaseDirectory: { AppCache: 0 },
	readFile: vi.fn(),
}));

describe('ProjectStore: updateMenuDocument', () => {
	beforeEach(() => {
		// Reset store state
		useProjectStore.setState({
			project: createDefaultProject('Test Project'),
			isDirty: false,
			selectedMenuId: null,
			menuEditorMode: 'design',
			previewMode: false,
			showSafeArea: true,
		});
	});

	it('initialises authoredDocument from legacy fields if missing', () => {
		const { project, updateMenuDocument } = useProjectStore.getState();
		const menuId = 'menu-1';

		// Add a legacy menu manually
		useProjectStore.setState({
			project: {
				...project!,
				disc: {
					...project!.disc,
					globalMenus: [
						{
							id: menuId,
							name: 'Legacy Menu',
							backgroundAssetId: 'asset-1',
							buttons: [
								{
									id: 'btn-1',
									label: 'Play',
									bounds: { x: 10, y: 20, width: 100, height: 40 },
									action: null,
									navUp: null,
									navDown: null,
									navLeft: null,
									navRight: null,
									highlightMode: 'static',
									highlightKeyframes: [],
									videoAssetId: null,
								},
							],
							defaultButtonId: 'btn-1',
							highlightColours: {
								selectColour: '#ffffff',
								selectOpacity: 1,
								activateColour: '#000000',
								activateOpacity: 1,
							},
							backgroundMode: 'still',
							motionDurationSecs: null,
							motionAudioAssetId: null,
							motionLoopCount: 0,
							timeoutAction: null,
						},
					],
				},
			},
		});

		// Update the document (which should trigger initialization)
		updateMenuDocument(menuId, (doc) => ({
			...doc,
			name: 'Updated Name',
		}));

		const updatedProject = useProjectStore.getState().project!;
		const updatedMenu = updatedProject.disc.globalMenus[0];

		expect(updatedMenu.authoredDocument).toBeDefined();
		expect(updatedMenu.authoredDocument?.name).toBe('Updated Name');
		expect(updatedMenu.authoredDocument?.scene.background.assetId).toBe('asset-1');
		expect(updatedMenu.authoredDocument?.scene.nodes).toHaveLength(1);
		expect(updatedMenu.authoredDocument?.scene.nodes[0].id).toBe('btn-1');
		expect(updatedMenu.name).toBe('Updated Name'); // Sync-back
	});

	it('syncs scene button changes back to legacy buttons array', () => {
		const { project, updateMenuDocument } = useProjectStore.getState();
		const menuId = 'menu-1';

		// Add a menu with an existing authoredDocument
		useProjectStore.setState({
			project: {
				...project!,
				disc: {
					...project!.disc,
					globalMenus: [
						{
							id: menuId,
							name: 'Menu',
							backgroundAssetId: null,
							buttons: [],
							defaultButtonId: null,
							highlightColours: {
								selectColour: '#ffffff',
								selectOpacity: 1,
								activateColour: '#000000',
								activateOpacity: 1,
							},
							backgroundMode: 'still',
							motionDurationSecs: null,
							motionAudioAssetId: null,
							motionLoopCount: 0,
							timeoutAction: null,
							authoredDocument: {
								id: menuId,
								name: 'Menu',
								domain: 'vmgm',
								scene: {
									designSize: { width: 720, height: 480 },
									background: { assetId: null, colour: null },
									nodes: [],
									guides: [],
								},
								interaction: { defaultFocusId: null, nodes: [], timeoutAction: null },
								timing: { introDurationSecs: 0, loopDurationSecs: 0, loopCount: 0 },
								highlightColours: {
									selectColour: '#ffffff',
									selectOpacity: 1,
									activateColour: '#000000',
									activateOpacity: 1,
								},
								backgroundMode: 'still',
								themeRef: null,
								generationMeta: null,
								compilePolicy: { safeAreaMode: 'title-safe', paletteStrategy: 'auto' },
							},
						},
					],
				},
			},
		});

		// Add a button to the scene
		updateMenuDocument(menuId, (doc) => ({
			...doc,
			scene: {
				...doc.scene,
				nodes: [
					{
						type: 'button',
						id: 'btn-new',
						label: 'New Button',
						x: 50,
						y: 60,
						width: 150,
						height: 50,
						highlightMode: 'static',
						highlightKeyframes: [],
						videoAssetId: null,
					},
				],
			},
			interaction: {
				...doc.interaction,
				nodes: [
					{
						nodeId: 'btn-new',
						navUp: null,
						navDown: null,
						navLeft: null,
						navRight: null,
						action: { type: 'stop' },
					},
				],
			},
		}));

		const updatedMenu = useProjectStore.getState().project!.disc.globalMenus[0];
		expect(updatedMenu.buttons).toHaveLength(1);
		expect(updatedMenu.buttons[0].id).toBe('btn-new');
		expect(updatedMenu.buttons[0].label).toBe('New Button');
		expect(updatedMenu.buttons[0].bounds).toEqual({ x: 50, y: 60, width: 150, height: 50 });
		expect(updatedMenu.buttons[0].action).toEqual({ type: 'stop' });
	});

	it('respects NTSC/PAL resolution during initialization', () => {
		const menuId = 'menu-pal';

		// Setup a PAL project
		useProjectStore.setState({
			project: {
				...createDefaultProject('PAL Project'),
				disc: {
					...createDefaultProject().disc,
					standard: 'PAL',
					globalMenus: [
						{
							id: menuId,
							name: 'PAL Menu',
							backgroundAssetId: null,
							buttons: [],
							defaultButtonId: null,
							highlightColours: {
								selectColour: '#ffffff',
								selectOpacity: 1,
								activateColour: '#000000',
								activateOpacity: 1,
							},
							backgroundMode: 'still',
							motionDurationSecs: null,
							motionAudioAssetId: null,
							motionLoopCount: 0,
							timeoutAction: null,
						},
					],
				},
			},
		});

		const { updateMenuDocument } = useProjectStore.getState();
		updateMenuDocument(menuId, (doc) => doc);

		const updatedMenu = useProjectStore.getState().project!.disc.globalMenus[0];
		expect(updatedMenu.authoredDocument?.scene.designSize).toEqual({ width: 720, height: 576 });
	});
});
