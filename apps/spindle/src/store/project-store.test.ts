// Tests for project store actions.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useProjectStore } from './project-store';
import { createDefaultMenuCompilePolicy, createDefaultProject } from '../types/project';

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

vi.mock('@tauri-apps/plugin-store', () => ({
	load: vi.fn().mockResolvedValue({
		get: vi.fn(),
		set: vi.fn(),
		save: vi.fn(),
	}),
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
		expect(updatedMenu.authoredDocument?.compilePolicy.displayAspect).toBe('four-by-three');
		expect(updatedMenu.authoredDocument?.scene.nodes).toHaveLength(1);
		expect(updatedMenu.authoredDocument?.scene.nodes[0].id).toBe('btn-1');
		expect(updatedMenu.name).toBe('Updated Name'); // Sync-back
	});

	it('infers authored display shape from titleset video aspect when initialising a legacy menu', () => {
		const menuId = 'titleset-menu-1';
		const project = createDefaultProject('Aspect Project');
		project.disc.titlesets = [
			{
				id: 'titleset-1',
				name: 'Feature',
				titles: [
					{
						id: 'title-1',
						name: 'Feature Film',
						sourceAssetId: null,
						videoMapping: null,
						videoOutputProfile: { aspect: 'sixteen-by-nine', raster: 'full-d1' },
						audioMappings: [],
						subtitleMappings: [],
						chapters: [],
						endAction: null,
						orderIndex: 0,
					},
				],
				menus: [
					{
						id: menuId,
						name: 'Legacy Titleset Menu',
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
		];
		project.disc.globalMenus = [];

		useProjectStore.setState({ project });

		useProjectStore.getState().updateMenuDocument(menuId, (doc) => doc);

		const updatedMenu = useProjectStore.getState().project!.disc.titlesets[0].menus[0];
		expect(updatedMenu.authoredDocument?.compilePolicy.displayAspect).toBe('sixteen-by-nine');
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
								timing: {
									introStartSecs: 0,
									introDurationSecs: 0,
									loopStartSecs: 0,
									loopDurationSecs: 0,
									loopCount: 0,
								},
								highlightColours: {
									selectColour: '#ffffff',
									selectOpacity: 1,
									activateColour: '#000000',
									activateOpacity: 1,
								},
								backgroundMode: 'still',
								themeRef: null,
								generationMeta: null,
								compilePolicy: createDefaultMenuCompilePolicy('four-by-three'),
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

	it('preserves authored menu renames across later document updates', () => {
		const menuId = 'menu-rename';
		const project = createDefaultProject('Rename Project');
		project.disc.globalMenus = [
			{
				id: menuId,
				name: 'Original Menu',
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
					name: 'Original Menu',
					domain: 'vmgm',
					scene: {
						designSize: { width: 720, height: 480 },
						background: { assetId: null, colour: null },
						nodes: [],
						guides: [],
					},
					interaction: { defaultFocusId: null, nodes: [], timeoutAction: null },
					timing: {
						introStartSecs: 0,
						introDurationSecs: 0,
						loopStartSecs: 0,
						loopDurationSecs: 0,
						loopCount: 0,
					},
					highlightColours: {
						selectColour: '#ffffff',
						selectOpacity: 1,
						activateColour: '#000000',
						activateOpacity: 1,
					},
					backgroundMode: 'still',
					themeRef: null,
					generationMeta: null,
					compilePolicy: createDefaultMenuCompilePolicy('four-by-three'),
				},
			},
		];

		useProjectStore.setState({ project });

		const { updateMenuDocument } = useProjectStore.getState();

		updateMenuDocument(menuId, (doc) => ({ ...doc, name: 'Renamed Menu' }));
		updateMenuDocument(menuId, (doc) => ({
			...doc,
			scene: {
				...doc.scene,
				background: { ...doc.scene.background, colour: '#101014' },
			},
		}));

		const updatedMenu = useProjectStore.getState().project!.disc.globalMenus[0];
		expect(updatedMenu.name).toBe('Renamed Menu');
		expect(updatedMenu.authoredDocument?.name).toBe('Renamed Menu');
		expect(updatedMenu.authoredDocument?.scene.background.colour).toBe('#101014');
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

	it('preserves non-button nodes (Text, Image, Shape) during serialization', async () => {
		const { invoke } = await import('@tauri-apps/api/core');
		const { saveProjectAs } = useProjectStore.getState();

		// Setup a project with complex scene nodes
		const menuId = 'complex-menu';
		const project = createDefaultProject('Complex Project');
		const menu: any = {
			id: menuId,
			name: 'Complex Menu',
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
				name: 'Complex Menu',
				domain: 'vmgm',
				scene: {
					designSize: { width: 720, height: 480 },
					background: { assetId: null, colour: null },
					nodes: [
						{
							type: 'text',
							id: 'text-1',
							content: 'Hello World',
							x: 10,
							y: 20,
							width: 100,
							height: 30,
							fontSize: 24,
							colour: '#ff0000',
						},
						{
							type: 'image',
							id: 'img-1',
							assetId: 'asset-123',
							x: 50,
							y: 100,
							width: 200,
							height: 150,
						},
						{
							type: 'shape',
							id: 'shape-1',
							x: 0,
							y: 0,
							width: 720,
							height: 480,
							fill: '#0000ff',
						},
					],
					guides: [],
				},
				interaction: { defaultFocusId: null, nodes: [], timeoutAction: null },
				timing: {
					introStartSecs: 0,
					introDurationSecs: 0,
					loopStartSecs: 0,
					loopDurationSecs: 0,
					loopCount: 0,
				},
				highlightColours: {
					selectColour: '#ffffff',
					selectOpacity: 1,
					activateColour: '#000000',
					activateOpacity: 1,
				},
				backgroundMode: 'still',
				themeRef: null,
				generationMeta: null,
				compilePolicy: createDefaultMenuCompilePolicy('sixteen-by-nine'),
			},
		};

		project.disc.globalMenus.push(menu);
		useProjectStore.setState({ project, filePath: null });

		// Mock the save dialogue and invoke
		const { save } = await import('@tauri-apps/plugin-dialog');
		vi.mocked(save).mockResolvedValue('/path/to/project.spindle');
		vi.mocked(invoke).mockResolvedValue(undefined);

		await saveProjectAs();

		// Verify the payload sent to Rust
		const lastCall = vi
			.mocked(invoke)
			.mock.calls.find((call) => call[0] === 'plugin:spindle-project|serialise_project');
		expect(lastCall).toBeDefined();

		const payload = lastCall![1] as any;
		const savedMenu = payload.project.disc.globalMenus.find((m: any) => m.id === menuId);
		expect(savedMenu.authoredDocument.compilePolicy.displayAspect).toBe('sixteen-by-nine');
		const nodes = savedMenu.authoredDocument.scene.nodes;

		const textNode = nodes.find((n: any) => n.type === 'text');
		expect(textNode).toEqual({
			type: 'text',
			id: 'text-1',
			content: 'Hello World',
			x: 10,
			y: 20,
			width: 100,
			height: 30,
			fontSize: 24,
			colour: '#ff0000',
		});

		const imgNode = nodes.find((n: any) => n.type === 'image');
		expect(imgNode).toEqual({
			type: 'image',
			id: 'img-1',
			assetId: 'asset-123',
			x: 50,
			y: 100,
			width: 200,
			height: 150,
		});

		const shapeNode = nodes.find((n: any) => n.type === 'shape');
		expect(shapeNode).toEqual({
			type: 'shape',
			id: 'shape-1',
			x: 0,
			y: 0,
			width: 720,
			height: 480,
			fill: '#0000ff',
		});
	});
});
