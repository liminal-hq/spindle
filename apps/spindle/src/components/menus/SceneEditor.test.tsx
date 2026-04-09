// Tests for scene editor components (LayersPanel, InspectorPanel, SceneCanvas).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayersPanel } from './LayersPanel';
import { InspectorPanel } from './InspectorPanel';
import { SceneCanvas } from './SceneCanvas';
import type { SceneNode, MenuButton, MenuHighlightColours } from '../../types/project';
import { DEFAULT_HIGHLIGHT_COLOURS, createDefaultMenuCompilePolicy } from '../../types/project';
import {
	buildAudioSetupMenu,
	buildSubtitleSetupMenu,
	createGeneratedMenuFromButtons,
} from '../../pages/MenusPage';

// ── LayersPanel ────────────────────────────────────────────────────────────

describe('LayersPanel', () => {
	const nodes: SceneNode[] = [
		{ type: 'button', id: 'btn-1', label: 'Play Movie', x: 10, y: 20, width: 200, height: 40 },
		{ type: 'button', id: 'btn-2', label: 'Chapters', x: 10, y: 80, width: 200, height: 40 },
		{ type: 'text', id: 'txt-1', content: 'Welcome', x: 100, y: 10, width: 200, height: 40 },
	];

	it('renders scene nodes in reverse z-order', () => {
		const onSelect = vi.fn();
		render(<LayersPanel nodes={nodes} selectedNodeId={null} onSelectNode={onSelect} />);

		const items = screen.getAllByRole('button');
		// Reverse order: txt-1 first (top of stack), then btn-2, then btn-1
		const layerItems = items.filter((el) => el.classList.contains('layers-panel__item'));
		expect(layerItems).toHaveLength(3);
		expect(layerItems[0]).toHaveTextContent('Welcome');
		expect(layerItems[1]).toHaveTextContent('Chapters');
		expect(layerItems[2]).toHaveTextContent('Play Movie');
	});

	it('highlights the selected node', () => {
		render(<LayersPanel nodes={nodes} selectedNodeId="btn-1" onSelectNode={vi.fn()} />);

		const items = screen
			.getAllByRole('button')
			.filter((el) => el.classList.contains('layers-panel__item'));
		const selected = items.find((el) => el.classList.contains('layers-panel__item--selected'));
		expect(selected).toBeDefined();
		expect(selected).toHaveTextContent('Play Movie');
	});

	it('calls onSelectNode when a layer item is clicked', () => {
		const onSelect = vi.fn();
		render(<LayersPanel nodes={nodes} selectedNodeId={null} onSelectNode={onSelect} />);

		const items = screen
			.getAllByRole('button')
			.filter((el) => el.classList.contains('layers-panel__item'));
		fireEvent.click(items[1]); // Chapters
		expect(onSelect).toHaveBeenCalledWith('btn-2');
	});

	it('shows empty state when no nodes', () => {
		render(<LayersPanel nodes={[]} selectedNodeId={null} onSelectNode={vi.fn()} />);

		expect(screen.getByText('No scene nodes')).toBeTruthy();
	});
});

// ── InspectorPanel ─────────────────────────────────────────────────────────

describe('InspectorPanel', () => {
	const colours: MenuHighlightColours = { ...DEFAULT_HIGHLIGHT_COLOURS };
	const button: MenuButton = {
		id: 'btn-1',
		label: 'Play',
		bounds: { x: 10, y: 20, width: 200, height: 40 },
		action: null,
		navUp: null,
		navDown: null,
		navLeft: null,
		navRight: null,
		highlightMode: 'static',
		highlightKeyframes: [],
		videoAssetId: null,
	};
	const buttonNode: SceneNode = {
		type: 'button',
		id: 'btn-1',
		label: 'Play',
		x: 10,
		y: 20,
		width: 200,
		height: 40,
	};

	it('shows empty state when no node selected', () => {
		render(
			<InspectorPanel
				selectedNode={null}
				selectedButton={null}
				highlightColours={colours}
				allTitles={[]}
				allMenus={[]}
				currentMenuId="menu-1"
				onUpdateButton={vi.fn()}
				onUpdateHighlightColours={vi.fn()}
				onRemoveButton={vi.fn()}
			/>,
		);

		expect(screen.getByText(/Select a node/)).toBeTruthy();
	});

	it('renders button property fields when a button node is selected', () => {
		render(
			<InspectorPanel
				selectedNode={buttonNode}
				selectedButton={button}
				highlightColours={colours}
				allTitles={[]}
				allMenus={[]}
				currentMenuId="menu-1"
				onUpdateButton={vi.fn()}
				onUpdateHighlightColours={vi.fn()}
				onRemoveButton={vi.fn()}
			/>,
		);

		// Should show label input with current value
		const labelInput = screen.getByDisplayValue('Play');
		expect(labelInput).toBeTruthy();
	});

	it('calls onUpdateButton when label is changed', () => {
		const onUpdate = vi.fn();
		render(
			<InspectorPanel
				selectedNode={buttonNode}
				selectedButton={button}
				highlightColours={colours}
				allTitles={[]}
				allMenus={[]}
				currentMenuId="menu-1"
				onUpdateButton={onUpdate}
				onUpdateHighlightColours={vi.fn()}
				onRemoveButton={vi.fn()}
			/>,
		);

		const labelInput = screen.getByDisplayValue('Play');
		fireEvent.change(labelInput, { target: { value: 'Start' } });
		expect(onUpdate).toHaveBeenCalledWith('btn-1', { label: 'Start' });
	});

	it('calls onRemoveButton when remove button is clicked', () => {
		const onRemove = vi.fn();
		render(
			<InspectorPanel
				selectedNode={buttonNode}
				selectedButton={button}
				highlightColours={colours}
				allTitles={[]}
				allMenus={[]}
				currentMenuId="menu-1"
				onUpdateButton={vi.fn()}
				onUpdateHighlightColours={vi.fn()}
				onRemoveButton={onRemove}
			/>,
		);

		const removeBtn = screen.getByText('Remove Button');
		fireEvent.click(removeBtn);
		expect(onRemove).toHaveBeenCalledWith('btn-1');
	});

	it('writes authored display shape from the menu-level inspector', () => {
		const onDisplayAspectChange = vi.fn();

		render(
			<InspectorPanel
				selectedNode={null}
				selectedButton={null}
				highlightColours={colours}
				allTitles={[]}
				allMenus={[]}
				currentMenuId="menu-1"
				onUpdateButton={vi.fn()}
				onUpdateHighlightColours={vi.fn()}
				onRemoveButton={vi.fn()}
				buttons={[button]}
				interactionNodes={[]}
				defaultFocusId={null}
				document={{
					id: 'menu-1',
					name: 'Menu',
					domain: 'vmgm',
					scene: {
						designSize: { width: 720, height: 480 },
						background: { assetId: null, colour: '#000000' },
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
					highlightColours: colours,
					backgroundMode: 'still',
					themeRef: null,
					generationMeta: null,
					compilePolicy: createDefaultMenuCompilePolicy('four-by-three'),
				}}
				canvasHeight={480}
				menu={{
					id: 'menu-1',
					name: 'Menu',
					backgroundAssetId: null,
					buttons: [button],
					defaultButtonId: null,
					highlightColours: colours,
					backgroundMode: 'still',
					motionDurationSecs: null,
					motionAudioAssetId: null,
					motionLoopCount: 0,
					timeoutAction: null,
				}}
				displayAspect="four-by-three"
				onDisplayAspectChange={onDisplayAspectChange}
			/>,
		);

		const aspectButton = screen
			.getAllByRole('button')
			.find((control) => control.textContent === '16:9');
		expect(aspectButton).toBeTruthy();
		fireEvent.click(aspectButton!);
		expect(onDisplayAspectChange).toHaveBeenCalledWith('sixteen-by-nine');
		expect(
			screen.getByText(
				'16:9 here is anamorphic DVD output of the same raster, not a larger canvas.',
			),
		).toBeTruthy();
	});
});

// ── SceneCanvas ────────────────────────────────────────────────────────────

describe('SceneCanvas', () => {
	const buttons: MenuButton[] = [
		{
			id: 'btn-1',
			label: 'Play',
			bounds: { x: 100, y: 300, width: 200, height: 40 },
			action: null,
			navUp: null,
			navDown: 'btn-2',
			navLeft: null,
			navRight: null,
			highlightMode: 'static',
			highlightKeyframes: [],
			videoAssetId: null,
		},
		{
			id: 'btn-2',
			label: 'Chapters',
			bounds: { x: 100, y: 360, width: 200, height: 40 },
			action: null,
			navUp: 'btn-1',
			navDown: null,
			navLeft: null,
			navRight: null,
			highlightMode: 'static',
			highlightKeyframes: [],
			videoAssetId: null,
		},
	];

	it('renders button nodes on the canvas', () => {
		render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				defaultButtonId={null}
				previewMode={false}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		expect(screen.getByText('Play')).toBeTruthy();
		expect(screen.getByText('Chapters')).toBeTruthy();
	});

	it('applies selection class when a node is selected', () => {
		render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				defaultButtonId={null}
				previewMode={false}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId="btn-1"
				onSelectNode={vi.fn()}
			/>,
		);

		const playNode = screen.getByText('Play').closest('.scene-canvas__node');
		expect(playNode?.classList.contains('scene-canvas__node--selected')).toBe(true);
	});

	it('calls onSelectNode when a canvas node is clicked', () => {
		const onSelect = vi.fn();
		render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				defaultButtonId={null}
				previewMode={false}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={onSelect}
			/>,
		);

		fireEvent.mouseDown(screen.getByText('Play'));
		expect(onSelect).toHaveBeenCalledWith('btn-1');
	});

	it('applies honest preview class when enabled', () => {
		const { container } = render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				defaultButtonId={null}
				previewMode={false}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={true}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		const viewport = container.querySelector('.scene-canvas__viewport--honest');
		expect(viewport).toBeTruthy();
	});

	it('shows compile preview compass when honest preview is on', () => {
		render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				defaultButtonId={null}
				previewMode={false}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={true}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		expect(screen.getByText('Compile Preview — DVD output simulation')).toBeTruthy();
		expect(
			screen.getByText(
				'DVD fallback strips rich menu styling down to fewer colours and firmer edges.',
			),
		).toBeTruthy();
		expect(screen.getByText('Palette collapse')).toBeTruthy();
		expect(screen.getByText('Alpha flattening')).toBeTruthy();
	});

	it('renders safe-area guides when enabled', () => {
		const { container } = render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={true}
				backgroundLabel={null}
				backgroundColour={null}
				defaultButtonId={null}
				previewMode={false}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		expect(container.querySelector('.scene-canvas__safe-area--action')).toBeTruthy();
		expect(container.querySelector('.scene-canvas__safe-area--title')).toBeTruthy();
	});

	it('renders in navigation preview mode', () => {
		render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				defaultButtonId="btn-1"
				previewMode={true}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={true}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		expect(screen.getByText(/arrow keys/i)).toBeTruthy();
	});

	it('keeps authored text nodes visible in navigation preview mode', () => {
		render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				sceneNodes={[
					{
						type: 'text',
						id: 'text-1',
						content: 'Menu Title',
						x: 120,
						y: 72,
						width: 300,
						height: 48,
						fontSize: 32,
						colour: '#ffffff',
					},
				]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				defaultButtonId="btn-1"
				previewMode={true}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={true}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		expect(screen.getByText('Menu Title')).toBeTruthy();
	});

	it('resets preview focus when the active menu changes', () => {
		const { container, rerender } = render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				defaultButtonId="btn-1"
				previewMode={true}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={true}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		expect(container.querySelector('.scene-canvas__node--focused')).toHaveTextContent('Play');

		rerender(
			<SceneCanvas
				buttons={[
					{
						id: 'btn-3',
						label: 'Setup',
						bounds: { x: 120, y: 260, width: 220, height: 44 },
						action: null,
						navUp: null,
						navDown: null,
						navLeft: null,
						navRight: null,
						highlightMode: 'static',
						highlightKeyframes: [],
						videoAssetId: null,
					},
				]}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				defaultButtonId="btn-3"
				previewMode={true}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={true}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		expect(container.querySelector('.scene-canvas__node--focused')).toHaveTextContent('Setup');
	});

	it('preserves keyboard-moved focus while previewing the current menu', () => {
		const { container } = render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				defaultButtonId="btn-1"
				previewMode={true}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={true}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		const viewport = container.querySelector('.scene-canvas__viewport--preview');
		expect(viewport).toBeTruthy();

		fireEvent.keyDown(viewport!, { key: 'ArrowDown' });

		expect(container.querySelector('.scene-canvas__node--focused')).toHaveTextContent('Chapters');
	});

	it('applies the selected button preview state on the design canvas', () => {
		const styledNode: SceneNode = {
			type: 'button',
			id: 'btn-1',
			label: 'Play',
			x: 100,
			y: 300,
			width: 200,
			height: 40,
			buttonStyle: {
				normal: {
					bgFill: 'rgba(255,255,255,0.04)',
					borderColour: '#ffffff1f',
					borderWidth: 1,
					borderRadius: 6,
					paddingH: 12,
					paddingV: 0,
					shadowType: 'none',
					shadowColour: '#000000',
					shadowBlur: 0,
					shadowSpread: 0,
				},
				focus: {
					bgFill: 'rgb(255, 0, 0)',
					borderColour: '#ff0000',
					borderWidth: 1,
					borderRadius: 6,
					paddingH: 12,
					paddingV: 0,
					shadowType: 'none',
					shadowColour: '#000000',
					shadowBlur: 0,
					shadowSpread: 0,
				},
				activate: {
					bgFill: 'rgb(0, 255, 0)',
					borderColour: '#00ff00',
					borderWidth: 1,
					borderRadius: 6,
					paddingH: 12,
					paddingV: 0,
					shadowType: 'none',
					shadowColour: '#000000',
					shadowBlur: 0,
					shadowSpread: 0,
				},
			},
		};

		render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				sceneNodes={[styledNode]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				defaultButtonId={null}
				previewMode={false}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId="btn-1"
				onSelectNode={vi.fn()}
				buttonPreviewState="focus"
			/>,
		);

		const playNode = screen.getByText('Play').closest('.scene-canvas__node');
		expect(playNode).toHaveStyle({ background: 'rgb(255, 0, 0)' });
	});

	it('deselects node when canvas background is clicked', () => {
		const onSelect = vi.fn();
		const { container } = render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				defaultButtonId={null}
				previewMode={false}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId="btn-1"
				onSelectNode={onSelect}
			/>,
		);

		const viewport = container.querySelector('.scene-canvas__viewport');
		fireEvent.click(viewport!);
		expect(onSelect).toHaveBeenCalledWith(null);
	});

	it('simulates authored anamorphic display on the same raster', () => {
		const { container } = render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				defaultButtonId={null}
				previewMode={false}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
				displayAspect="sixteen-by-nine"
			/>,
		);

		expect(container.querySelector('.scene-canvas__viewport')).toHaveStyle({
			aspectRatio: '16 / 9',
		});
	});

	it('creates generated menus with the provided authored design height', () => {
		const menu = createGeneratedMenuFromButtons(
			'menu-generated',
			'Generated Menu',
			[
				{
					id: 'btn-generated',
					label: 'Play',
					bounds: { x: 96, y: 320, width: 220, height: 44 },
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
			'titleset',
			576,
			'four-by-three',
		);

		expect(menu.authoredDocument?.scene.designSize).toEqual({ width: 720, height: 576 });
	});

	it('builds audio setup choices from the titleset-wide audio union', () => {
		const menu = buildAudioSetupMenu(
			{
				id: 'titleset-1',
				name: 'Feature',
				menus: [],
				titles: [
					{
						id: 'title-1',
						name: 'Feature A',
						sourceAssetId: null,
						videoMapping: null,
						videoOutputProfile: { raster: 'full-d1', aspect: 'four-by-three' },
						audioMappings: [
							{
								id: 'audio-1',
								sourceStreamIndex: 0,
								outputTarget: 'AC3',
								copyMode: 'copy',
								label: 'English 2.0',
								language: 'en',
								orderIndex: 0,
								isDefault: true,
							},
						],
						subtitleMappings: [],
						chapters: [],
						endAction: null,
						orderIndex: 0,
					},
					{
						id: 'title-2',
						name: 'Feature B',
						sourceAssetId: null,
						videoMapping: null,
						videoOutputProfile: { raster: 'full-d1', aspect: 'four-by-three' },
						audioMappings: [
							{
								id: 'audio-2',
								sourceStreamIndex: 1,
								outputTarget: 'AC3',
								copyMode: 'copy',
								label: 'Commentary',
								language: 'en',
								orderIndex: 1,
								isDefault: false,
							},
						],
						subtitleMappings: [],
						chapters: [],
						endAction: null,
						orderIndex: 1,
					},
				],
			},
			'NTSC',
			null,
		);

		expect(menu).not.toBeNull();
		expect(menu?.buttons.map((button) => button.label)).toEqual(['English 2.0', 'Commentary']);
		expect(menu?.buttons[1]?.action).toEqual({
			type: 'sequence',
			actions: [{ type: 'setAudioStream', streamIndex: 1 }],
		});
	});

	it('builds subtitle setup choices from the titleset-wide subtitle union', () => {
		const menu = buildSubtitleSetupMenu(
			{
				id: 'titleset-1',
				name: 'Feature',
				menus: [],
				titles: [
					{
						id: 'title-1',
						name: 'Feature A',
						sourceAssetId: null,
						videoMapping: null,
						videoOutputProfile: { raster: 'full-d1', aspect: 'four-by-three' },
						audioMappings: [],
						subtitleMappings: [
							{
								id: 'sub-1',
								sourceStreamIndex: 0,
								label: 'English',
								language: 'en',
								orderIndex: 0,
								isDefault: true,
								isForced: false,
							},
						],
						chapters: [],
						endAction: null,
						orderIndex: 0,
					},
					{
						id: 'title-2',
						name: 'Feature B',
						sourceAssetId: null,
						videoMapping: null,
						videoOutputProfile: { raster: 'full-d1', aspect: 'four-by-three' },
						audioMappings: [],
						subtitleMappings: [
							{
								id: 'sub-2',
								sourceStreamIndex: 1,
								label: 'Spanish',
								language: 'es',
								orderIndex: 1,
								isDefault: false,
								isForced: false,
							},
						],
						chapters: [],
						endAction: null,
						orderIndex: 1,
					},
				],
			},
			'NTSC',
			null,
		);

		expect(menu).not.toBeNull();
		expect(menu?.buttons.map((button) => button.label)).toEqual([
			'English',
			'Spanish',
			'Subtitles Off',
		]);
		expect(menu?.buttons[1]?.action).toEqual({
			type: 'sequence',
			actions: [{ type: 'setSubtitleStream', streamIndex: 1 }],
		});
	});
});
