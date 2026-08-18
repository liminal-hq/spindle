// Tests for project store actions.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useProjectStore } from './project-store';
import { createDefaultMenuCompilePolicy, createDefaultProject } from '../types/project';
import type { Menu, MenuDocument } from '../types/project';

function menuWithDocument(
	id: string,
	name: string,
	docOverrides: Partial<MenuDocument> = {},
): Menu {
	return {
		id,
		name,
		authoredDocument: {
			id,
			name,
			domain: 'vmgm',
			role: 'title-select',
			scene: {
				designSize: { width: 720, height: 480, aspect: 'four-by-three' },
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
				audioAssetId: null,
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
			...docOverrides,
		},
	};
}

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

	it('does nothing when the menu has no authored document', () => {
		const { project } = useProjectStore.getState();
		const menuId = 'menu-no-doc';

		useProjectStore.setState({
			project: {
				...project!,
				disc: {
					...project!.disc,
					globalMenus: [{ id: menuId, name: 'No Document Menu', authoredDocument: null }],
				},
			},
		});

		useProjectStore
			.getState()
			.updateMenuDocument(menuId, (doc) => ({ ...doc, name: 'Should not apply' }));

		const updatedMenu = useProjectStore.getState().project!.disc.globalMenus[0];
		expect(updatedMenu.authoredDocument).toBeNull();
		expect(updatedMenu.name).toBe('No Document Menu');
	});

	it('applies scene/interaction updates to the authored document', () => {
		const { project, updateMenuDocument } = useProjectStore.getState();
		const menuId = 'menu-1';

		useProjectStore.setState({
			project: {
				...project!,
				disc: {
					...project!.disc,
					globalMenus: [menuWithDocument(menuId, 'Menu')],
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
		const nodes = updatedMenu.authoredDocument!.scene.nodes;
		expect(nodes).toHaveLength(1);
		expect(nodes[0]).toMatchObject({
			id: 'btn-new',
			label: 'New Button',
			x: 50,
			y: 60,
			width: 150,
			height: 50,
		});
		expect(updatedMenu.authoredDocument!.interaction.nodes[0].action).toEqual({ type: 'stop' });
	});

	it('preserves authored menu renames across later document updates', () => {
		const menuId = 'menu-rename';
		const project = createDefaultProject('Rename Project');
		project.disc.globalMenus = [menuWithDocument(menuId, 'Original Menu')];

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

	it('preserves non-button nodes (Text, Image, Shape) during serialization', async () => {
		const { invoke } = await import('@tauri-apps/api/core');
		const { saveProjectAs } = useProjectStore.getState();

		// Setup a project with complex scene nodes
		const menuId = 'complex-menu';
		const project = createDefaultProject('Complex Project');
		const menu = menuWithDocument(menuId, 'Complex Menu', {
			compilePolicy: createDefaultMenuCompilePolicy('sixteen-by-nine'),
		});
		menu.authoredDocument!.scene.nodes = [
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
		];

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
