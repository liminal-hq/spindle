// Tests for scene editor components (LayersPanel, InspectorPanel, SceneCanvas).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { LayersPanel } from './LayersPanel';
import { InspectorPanel } from './InspectorPanel';
import { SceneCanvas } from './SceneCanvas';
import type {
	AnimationTrack,
	SceneNode,
	MenuButton,
	MenuDocument,
	MenuHighlightColours,
	Asset,
	Menu,
} from '../../types/project';
import { DEFAULT_HIGHLIGHT_COLOURS, createDefaultMenuCompilePolicy } from '../../types/project';
import {
	buildAudioSetupMenu,
	buildChapterMenusForTitleset,
	buildSubtitleSetupMenu,
} from './menuGenerators';
import { getMenuButtons } from './menuProjectHelpers';
import { TimelineStrip } from './timeline/TimelineStrip';
import { useMenuPlaybackStore } from '../../store/menu-playback-store';

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
					role: 'title-select',
					scene: {
						designSize: { width: 720, height: 480, aspect: 'four-by-three' },
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
						audioAssetId: null,
					},
					highlightColours: colours,
					backgroundMode: 'still',
					themeRef: null,
					generationMeta: null,
					compilePolicy: createDefaultMenuCompilePolicy('four-by-three'),
				}}
				canvasHeight={480}
				menu={{ id: 'menu-1', name: 'Menu', authoredDocument: null }}
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

	it('renders text node fields and propagates content/remove changes', () => {
		const onUpdate = vi.fn();
		const onRemove = vi.fn();
		const textNode: SceneNode = {
			type: 'text',
			id: 'txt-1',
			content: 'Welcome',
			x: 10,
			y: 20,
			width: 200,
			height: 40,
		};
		render(
			<InspectorPanel
				selectedNode={textNode}
				selectedButton={null}
				highlightColours={colours}
				allTitles={[]}
				allMenus={[]}
				currentMenuId="menu-1"
				onUpdateButton={vi.fn()}
				onUpdateHighlightColours={vi.fn()}
				onRemoveButton={vi.fn()}
				onUpdateSceneNode={onUpdate}
				onRemoveNode={onRemove}
			/>,
		);

		const contentInput = screen.getByDisplayValue('Welcome');
		fireEvent.change(contentInput, { target: { value: 'Hello' } });
		expect(onUpdate).toHaveBeenCalledWith('txt-1', { content: 'Hello' });

		fireEvent.click(screen.getByText('Remove Text'));
		expect(onRemove).toHaveBeenCalledWith('txt-1');
	});

	it('renders image node fields and propagates asset/remove changes', () => {
		const onUpdate = vi.fn();
		const onRemove = vi.fn();
		const imageNode: SceneNode = {
			type: 'image',
			id: 'img-1',
			assetId: '',
			x: 10,
			y: 20,
			width: 200,
			height: 150,
		};
		const assets: Asset[] = [
			{
				id: 'asset-1',
				fileName: 'background.png',
				sourcePath: '/tmp/background.png',
				fileSizeBytes: null,
				durationSecs: null,
				containerFormat: null,
				videoStreams: [],
				audioStreams: [],
				subtitleStreams: [],
				compatibility: null,
				compatibilityDetail: null,
				fingerprint: null,
				warnings: [],
				thumbnailPath: null,
				thumbnailError: null,
				sourceChapters: [],
				formatTitle: null,
			},
		];
		render(
			<InspectorPanel
				selectedNode={imageNode}
				selectedButton={null}
				highlightColours={colours}
				allTitles={[]}
				allMenus={[]}
				currentMenuId="menu-1"
				onUpdateButton={vi.fn()}
				onUpdateHighlightColours={vi.fn()}
				onRemoveButton={vi.fn()}
				onUpdateSceneNode={onUpdate}
				onRemoveNode={onRemove}
				assets={assets}
			/>,
		);

		expect(screen.getByText('background.png')).toBeTruthy();
		const assetSelect = screen.getByDisplayValue('None');
		fireEvent.change(assetSelect, { target: { value: 'asset-1' } });
		expect(onUpdate).toHaveBeenCalledWith('img-1', { assetId: 'asset-1' });

		fireEvent.click(screen.getByText('Remove Image'));
		expect(onRemove).toHaveBeenCalledWith('img-1');
	});

	it('renders shape node fields and propagates fill/remove changes', () => {
		const onUpdate = vi.fn();
		const onRemove = vi.fn();
		const shapeNode: SceneNode = {
			type: 'shape',
			id: 'shape-1',
			x: 10,
			y: 20,
			width: 200,
			height: 100,
			fill: '#333333',
		};
		render(
			<InspectorPanel
				selectedNode={shapeNode}
				selectedButton={null}
				highlightColours={colours}
				allTitles={[]}
				allMenus={[]}
				currentMenuId="menu-1"
				onUpdateButton={vi.fn()}
				onUpdateHighlightColours={vi.fn()}
				onRemoveButton={vi.fn()}
				onUpdateSceneNode={onUpdate}
				onRemoveNode={onRemove}
			/>,
		);

		const hexInput = screen
			.getAllByDisplayValue('#333333')
			.find((el) => el.classList.contains('inspector-panel__input--hex'))!;
		fireEvent.change(hexInput, { target: { value: '#ff0000' } });
		expect(onUpdate).toHaveBeenCalledWith('shape-1', { fill: '#ff0000' });

		fireEvent.click(screen.getByText('Remove Shape'));
		expect(onRemove).toHaveBeenCalledWith('shape-1');
	});

	it('falls back to the generic inspector for node types without a dedicated panel', () => {
		const groupNode: SceneNode = { type: 'group', id: 'group-1', name: 'Group', children: [] };
		render(
			<InspectorPanel
				selectedNode={groupNode}
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

		expect(screen.getAllByText('Group').length).toBeGreaterThanOrEqual(2);
		expect(
			screen.getByText('Properties for group nodes will be available in a future update.'),
		).toBeTruthy();
	});

	it('switches the menu-level background tab between solid/image/video/audio sources', () => {
		const menu: Menu = { id: 'menu-1', name: 'Menu', authoredDocument: null };
		const assets: Asset[] = [
			{
				id: 'video-asset',
				fileName: 'loop.mp4',
				sourcePath: '/tmp/loop.mp4',
				fileSizeBytes: null,
				durationSecs: null,
				containerFormat: null,
				videoStreams: [
					{
						index: 0,
						codec: 'h264',
						width: 720,
						height: 480,
						frameRate: null,
						aspectRatio: null,
						scanType: null,
						bitrateBps: null,
						title: null,
						colorTransfer: null,
						colorPrimaries: null,
						dolbyVisionProfile: null,
					},
				],
				audioStreams: [],
				subtitleStreams: [],
				compatibility: null,
				compatibilityDetail: null,
				fingerprint: null,
				warnings: [],
				thumbnailPath: null,
				thumbnailError: null,
				sourceChapters: [],
				formatTitle: null,
			},
		];

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
				menu={menu}
				assets={assets}
			/>,
		);

		// Defaults to the Solid tab for a still menu.
		expect(screen.getAllByDisplayValue('#101014').length).toBeGreaterThan(0);

		fireEvent.click(screen.getByText('Video'));
		expect(screen.getByText('loop.mp4')).toBeTruthy();

		fireEvent.click(screen.getByText('Audio'));
		expect(screen.getByText('Audio bed')).toBeTruthy();
	});

	it('switches ButtonStyleSection state tabs and edits the active state only', () => {
		const onUpdateSceneNode = vi.fn();
		const onButtonPreviewStateChange = vi.fn();

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
				onUpdateSceneNode={onUpdateSceneNode}
				buttonPreviewState="normal"
				onButtonPreviewStateChange={onButtonPreviewStateChange}
			/>,
		);

		fireEvent.click(screen.getByText('Focus'));
		expect(onButtonPreviewStateChange).toHaveBeenCalledWith('focus');
	});

	it('serialises and parses button actions via the Action select', () => {
		const onUpdate = vi.fn();
		const playTitleButton: MenuButton = {
			...button,
			action: { type: 'playTitle', titleId: 'title-1' },
		};
		render(
			<InspectorPanel
				selectedNode={buttonNode}
				selectedButton={playTitleButton}
				highlightColours={colours}
				allTitles={[
					{
						id: 'title-1',
						name: 'Feature',
						sourceAssetId: null,
						videoMapping: null,
						videoOutputProfile: null,
						audioMappings: [],
						subtitleMappings: [],
						chapters: [],
						endAction: null,
						orderIndex: 0,
						bitrateWeight: 1,
						bitrateFloorBps: null,
						bitrateCeilingBps: null,
						pinnedBitrateBps: null,
					},
				]}
				allMenus={[]}
				currentMenuId="menu-1"
				onUpdateButton={onUpdate}
				onUpdateHighlightColours={vi.fn()}
				onRemoveButton={vi.fn()}
			/>,
		);

		// actionToString: the select reflects the current action as 'playTitle:title-1'.
		const actionSelect = screen.getByDisplayValue('Feature');
		expect((actionSelect as HTMLSelectElement).value).toBe('playTitle:title-1');

		// stringToAction: choosing "Stop" must produce the Stop action object.
		fireEvent.change(actionSelect, { target: { value: 'stop' } });
		expect(onUpdate).toHaveBeenCalledWith('btn-1', { action: { type: 'stop' } });
	});

	it('reports diagnostics for button-count, unbound actions, and broken nav refs', () => {
		const manyButtons: MenuButton[] = Array.from({ length: 37 }, (_, i) => ({
			...button,
			id: `btn-${i}`,
			label: `Button ${i}`,
			action: null,
			navUp: i === 0 ? 'missing-button' : null,
		}));

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
				buttons={manyButtons}
			/>,
		);

		expect(
			screen.getByText('Too many buttons (37). DVD-Video supports a maximum of 36.'),
		).toBeTruthy();
		expect(screen.getByText('37 buttons have no action assigned.')).toBeTruthy();
		expect(screen.getByText('Button "Button 0" has a broken navUp reference.')).toBeTruthy();
	});

	it('shows the no-issues diagnostic message for a clean menu', () => {
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
				buttons={[]}
			/>,
		);

		expect(screen.getByText('No issues — menu is DVD-Video-safe.')).toBeTruthy();
	});
});

// ── SceneCanvas ────────────────────────────────────────────────────────────

vi.mock('@tauri-apps/plugin-fs', () => ({
	readFile: vi.fn().mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff])),
	BaseDirectory: { AppCache: 13 },
}));

vi.mock('@tauri-apps/api/core', () => ({
	convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

describe('SceneCanvas', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

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
	const imageAsset: Asset = {
		id: 'asset-image-1',
		fileName: 'chapter-card.png',
		sourcePath: '/tmp/chapter-card.png',
		fileSizeBytes: 1024,
		durationSecs: null,
		containerFormat: null,
		videoStreams: [],
		audioStreams: [],
		subtitleStreams: [],
		compatibility: null,
		fingerprint: null,
		compatibilityDetail: null,
		warnings: [],
		thumbnailPath: '/app/cache/thumbnails/thumb_asset-image-1.jpg',
		thumbnailError: null,
		sourceChapters: [],
		formatTitle: null,
	};

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

	it('renders imported image artwork for image nodes', async () => {
		render(
			<SceneCanvas
				buttons={buttons}
				assets={[imageAsset]}
				canvasHeight={480}
				sceneNodes={[
					{
						type: 'image',
						id: 'image-1',
						assetId: 'asset-image-1',
						x: 96,
						y: 72,
						width: 240,
						height: 160,
					},
				]}
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

		// Once the thumbnail cache read resolves, the image element should appear
		const img = await screen.findByAltText('chapter-card.png');
		expect(img).toBeTruthy();
		expect((img as HTMLImageElement).src).toBeTruthy();
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

	// ── BackgroundMedia (design decision D5) ────────────────────────────────

	const stillBackgroundAsset: Asset = {
		...imageAsset,
		id: 'asset-bg-still',
		fileName: 'menu-bg.png',
		sourcePath: '/tmp/menu-bg.png',
		thumbnailPath: null,
	};

	const motionBackgroundAsset: Asset = {
		...imageAsset,
		id: 'asset-bg-video',
		fileName: 'menu-bg.mp4',
		sourcePath: '/tmp/menu-bg.mp4',
		thumbnailPath: null,
		videoStreams: [
			{
				index: 0,
				codec: 'h264',
				width: 1920,
				height: 1080,
				frameRate: 30,
				aspectRatio: null,
				scanType: null,
				bitrateBps: null,
				title: null,
				colorTransfer: null,
				colorPrimaries: null,
				dolbyVisionProfile: null,
			},
		],
	};

	it('renders a still <img> background when the asset has no video stream', () => {
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
				backgroundAsset={stillBackgroundAsset}
				defaultButtonId={null}
				previewMode={false}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		const img = container.querySelector('img.scene-canvas__bg-image');
		expect(img).not.toBeNull();
		expect(img?.getAttribute('src')).toBe('asset://localhost//tmp/menu-bg.png');
		expect(container.querySelector('video')).toBeNull();
	});

	it('renders a still <img> background for a motion-capable asset when backgroundIsMotion is false', () => {
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
				backgroundAsset={motionBackgroundAsset}
				backgroundIsMotion={false}
				defaultButtonId={null}
				previewMode={false}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		expect(container.querySelector('video')).toBeNull();
		expect(container.querySelector('img.scene-canvas__bg-image')).not.toBeNull();
	});

	it('renders a looping <video> background via convertFileSrc when the menu is a motion menu', () => {
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
				backgroundAsset={motionBackgroundAsset}
				backgroundIsMotion={true}
				backgroundInitialTimeSecs={2.5}
				defaultButtonId={null}
				previewMode={false}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		const video = container.querySelector('video.scene-canvas__bg-image');
		expect(video).not.toBeNull();
		expect(video?.getAttribute('src')).toBe('asset://localhost//tmp/menu-bg.mp4');
		expect(video).toHaveAttribute('muted');
		// No native `loop` attribute: looping is driven by the playback
		// store's loop-region logic, not the browser's own end-of-file
		// restart (which would always jump to 0, ignoring the loop-region
		// toggle and the authored loop window's start — see SceneCanvas's
		// `BackgroundVideo` comment).
		expect(video).not.toHaveAttribute('loop');
		expect(container.querySelector('img.scene-canvas__bg-image')).toBeNull();
	});

	it("syncs the playback store's playing flag to false when the video reaches its natural end", () => {
		const initialPlaybackState = useMenuPlaybackStore.getState();
		useMenuPlaybackStore.setState({ playing: true }, false);

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
				backgroundAsset={motionBackgroundAsset}
				backgroundIsMotion={true}
				backgroundInitialTimeSecs={0}
				defaultButtonId={null}
				previewMode={false}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		const video = container.querySelector('video.scene-canvas__bg-image');
		expect(video).not.toBeNull();
		fireEvent.ended(video!);

		expect(useMenuPlaybackStore.getState().playing).toBe(false);
		useMenuPlaybackStore.setState(initialPlaybackState, true);
	});

	// WebKitGTK cannot stream media over the custom asset:// scheme (plain
	// fetches through it work fine), so BackgroundVideo falls back to fetching
	// the file through the asset protocol and playing an in-memory blob URL
	// after the element's own load fails past its one scope-grant retry.
	describe('blob-URL fallback when asset:// media streaming fails', () => {
		const renderMotionCanvas = () =>
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
					backgroundAsset={motionBackgroundAsset}
					backgroundIsMotion={true}
					backgroundInitialTimeSecs={0}
					defaultButtonId={null}
					previewMode={false}
					highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
					honestPreview={false}
					showNavLines={false}
					selectedNodeId={null}
					onSelectNode={vi.fn()}
				/>,
			);

		const failPastRetry = async (container: HTMLElement) => {
			const video = container.querySelector('video.scene-canvas__bg-image');
			expect(video).not.toBeNull();
			// First error schedules the scope-grant retry; second exhausts it
			// and starts the blob fallback fetch.
			fireEvent.error(video!);
			fireEvent.error(video!);
		};

		afterEach(() => {
			vi.unstubAllGlobals();
			delete (URL as { createObjectURL?: unknown }).createObjectURL;
			delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
		});

		it('swaps the video onto a blob URL fetched through the asset protocol', async () => {
			URL.createObjectURL = vi.fn(() => 'blob:spindle/preview-fallback');
			URL.revokeObjectURL = vi.fn();
			const fetchMock = vi.fn(async () => ({
				ok: true,
				headers: new Headers({ 'content-length': '3' }),
				blob: async () => new Blob(['abc']),
			}));
			vi.stubGlobal('fetch', fetchMock);

			const { container } = renderMotionCanvas();
			await failPastRetry(container);

			await waitFor(() => {
				const video = container.querySelector('video.scene-canvas__bg-image');
				expect(video).toHaveAttribute('src', 'blob:spindle/preview-fallback');
			});
			expect(fetchMock).toHaveBeenCalledWith('asset://localhost//tmp/menu-bg.mp4');
			expect(container.querySelector('.scene-canvas__image-placeholder')).toBeNull();
		});

		it('shows the preview-unavailable placeholder when the fallback fetch fails too', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => {
					throw new Error('scope denied');
				}),
			);

			const { container } = renderMotionCanvas();
			await failPastRetry(container);

			await waitFor(() => {
				expect(container.querySelector('video')).toBeNull();
			});
			expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
		});
	});

	it('creates generated menus with the standard-appropriate authored design height', () => {
		const [menu] = buildChapterMenusForTitleset(
			{
				id: 'titleset-1',
				name: 'Feature',
				menus: [],
				titles: [
					{
						id: 'title-1',
						name: 'Feature',
						sourceAssetId: null,
						videoMapping: null,
						videoOutputProfile: null,
						audioMappings: [],
						subtitleMappings: [],
						chapters: [{ id: 'ch-1', name: 'Chapter 1', timestampSecs: 0, orderIndex: 0 }],
						endAction: null,
						orderIndex: 0,
						bitrateWeight: 1.0,
						bitrateFloorBps: null,
						bitrateCeilingBps: null,
						pinnedBitrateBps: null,
					},
				],
			},
			'PAL',
			null,
		);

		expect(menu.authoredDocument?.scene.designSize).toEqual({
			width: 720,
			height: 576,
			aspect: 'four-by-three',
		});
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
								channelLayout: null,
								bitrateBps: null,
							},
						],
						subtitleMappings: [],
						chapters: [],
						endAction: null,
						orderIndex: 0,
						bitrateWeight: 1.0,
						bitrateFloorBps: null,
						bitrateCeilingBps: null,
						pinnedBitrateBps: null,
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
								channelLayout: null,
								bitrateBps: null,
							},
						],
						subtitleMappings: [],
						chapters: [],
						endAction: null,
						orderIndex: 1,
						bitrateWeight: 1.0,
						bitrateFloorBps: null,
						bitrateCeilingBps: null,
						pinnedBitrateBps: null,
					},
				],
			},
			'NTSC',
			null,
		);

		expect(menu).not.toBeNull();
		const buttons = getMenuButtons(menu!);
		expect(buttons.map((button) => button.label)).toEqual(['English 2.0', 'Commentary']);
		expect(buttons[1]?.action).toEqual({
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
						bitrateWeight: 1.0,
						bitrateFloorBps: null,
						bitrateCeilingBps: null,
						pinnedBitrateBps: null,
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
						bitrateWeight: 1.0,
						bitrateFloorBps: null,
						bitrateCeilingBps: null,
						pinnedBitrateBps: null,
					},
				],
			},
			'NTSC',
			null,
		);

		expect(menu).not.toBeNull();
		const buttons = getMenuButtons(menu!);
		expect(buttons.map((button) => button.label)).toEqual(['English', 'Spanish', 'Subtitles Off']);
		expect(buttons[1]?.action).toEqual({
			type: 'sequence',
			actions: [{ type: 'setSubtitleStream', streamIndex: 1 }],
		});
	});
});

// ── Timeline strip (PR 8) ────────────────────────────────────────────────

const timelineTestButton: MenuButton = {
	id: 'btn-1',
	label: 'Play',
	bounds: { x: 100, y: 300, width: 200, height: 40 },
	action: null,
	navUp: null,
	navDown: null,
	navLeft: null,
	navRight: null,
	highlightMode: 'static',
	highlightKeyframes: [],
	videoAssetId: null,
};

const timelineTestButtonNode: SceneNode = {
	type: 'button',
	id: 'btn-1',
	label: 'Play',
	x: 100,
	y: 300,
	width: 200,
	height: 40,
};

function buildMenuDocument(overrides: Partial<MenuDocument> = {}): MenuDocument {
	return {
		id: 'menu-1',
		name: 'Menu',
		domain: 'vmgm',
		role: 'title-select',
		scene: {
			designSize: { width: 720, height: 480, aspect: 'four-by-three' },
			background: { assetId: null, colour: '#000000' },
			nodes: [],
			guides: [],
		},
		interaction: { defaultFocusId: null, nodes: [], timeoutAction: null },
		timing: {
			introStartSecs: 0,
			introDurationSecs: 0,
			loopStartSecs: 0,
			loopDurationSecs: 10,
			loopCount: 0,
			audioAssetId: null,
		},
		highlightColours: DEFAULT_HIGHLIGHT_COLOURS,
		backgroundMode: 'still',
		themeRef: null,
		generationMeta: null,
		compilePolicy: createDefaultMenuCompilePolicy('four-by-three'),
		animation: [],
		...overrides,
	};
}

describe('TimelineStrip', () => {
	afterEach(() => {
		useMenuPlaybackStore.setState({ loopRegion: null }, false);
	});

	it('renders when the menu has a motion background', () => {
		render(
			<TimelineStrip
				document={buildMenuDocument({ backgroundMode: 'motion' })}
				buttons={[]}
				assets={[]}
				standard="NTSC"
				onAddKeyframe={vi.fn()}
				onMoveKeyframe={vi.fn()}
				onUpdateKeyframeValue={vi.fn()}
				onUpdateKeyframeEasing={vi.fn()}
				onDeleteKeyframe={vi.fn()}
				onSetTimingField={vi.fn()}
			/>,
		);

		expect(screen.getByTestId('timeline-strip')).toBeTruthy();
	});

	it('is hidden for a still menu with no animation tracks', () => {
		const { container } = render(
			<TimelineStrip
				document={buildMenuDocument({ backgroundMode: 'still', animation: [] })}
				buttons={[]}
				assets={[]}
				standard="NTSC"
				onAddKeyframe={vi.fn()}
				onMoveKeyframe={vi.fn()}
				onUpdateKeyframeValue={vi.fn()}
				onUpdateKeyframeEasing={vi.fn()}
				onDeleteKeyframe={vi.fn()}
				onSetTimingField={vi.fn()}
			/>,
		);

		expect(container.firstChild).toBeNull();
	});

	it('renders for a still menu that has an authored animation track', () => {
		const tracks: AnimationTrack[] = [
			{
				nodeId: 'btn-1',
				target: 'highlight-colour',
				keyframes: [
					{ timestampSecs: 0, value: { kind: 'colour', hex: '#ff0000' }, easing: 'hold' },
				],
			},
		];
		render(
			<TimelineStrip
				document={buildMenuDocument({ backgroundMode: 'still', animation: tracks })}
				buttons={[timelineTestButton]}
				assets={[]}
				standard="NTSC"
				onAddKeyframe={vi.fn()}
				onMoveKeyframe={vi.fn()}
				onUpdateKeyframeValue={vi.fn()}
				onUpdateKeyframeEasing={vi.fn()}
				onDeleteKeyframe={vi.fn()}
				onSetTimingField={vi.fn()}
			/>,
		);

		expect(screen.getByTestId('timeline-strip')).toBeTruthy();
	});

	it('mirrors the scroll area position onto the scrubber viewport', () => {
		// The scrubber track sits outside `.timeline-strip__scroll` (so the
		// transport controls stay pinned) but is rendered at the ruler's own
		// `geometry.totalWidthPx`, not stretched to fill the available width
		// (see TimelineScrubber). Its viewport's scrollLeft must therefore
		// track the scroll area's, or the playhead/ruler visually diverge
		// once the timeline scrolls.
		const { container } = render(
			<TimelineStrip
				document={buildMenuDocument({ backgroundMode: 'motion' })}
				buttons={[]}
				assets={[]}
				standard="NTSC"
				onAddKeyframe={vi.fn()}
				onMoveKeyframe={vi.fn()}
				onUpdateKeyframeValue={vi.fn()}
				onUpdateKeyframeEasing={vi.fn()}
				onDeleteKeyframe={vi.fn()}
				onSetTimingField={vi.fn()}
			/>,
		);

		const scrollArea = container.querySelector('.timeline-strip__scroll') as HTMLDivElement;
		const scrubberViewport = container.querySelector(
			'.timeline-scrubber__viewport',
		) as HTMLDivElement;
		expect(scrollArea).toBeTruthy();
		expect(scrubberViewport).toBeTruthy();

		scrollArea.scrollLeft = 240;
		fireEvent.scroll(scrollArea);

		expect(scrubberViewport.scrollLeft).toBe(240);
	});
});

describe('ButtonInspector highlight animation (PR 8)', () => {
	it('no longer renders the legacy Static/Animated highlight-mode dropdown', () => {
		render(
			<InspectorPanel
				selectedNode={timelineTestButtonNode}
				selectedButton={timelineTestButton}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				allTitles={[]}
				allMenus={[]}
				currentMenuId="menu-1"
				onUpdateButton={vi.fn()}
				onUpdateHighlightColours={vi.fn()}
				onRemoveButton={vi.fn()}
			/>,
		);

		expect(screen.queryByText('Highlight Mode')).toBeNull();
		expect(screen.getByText('Highlight Animation')).toBeTruthy();
		expect(screen.getByText(/No animated highlight yet/)).toBeTruthy();
	});

	it('shows a keyframe-count summary once the button has animation tracks', () => {
		const onAddKeyframeAtPlayhead = vi.fn();
		render(
			<InspectorPanel
				selectedNode={timelineTestButtonNode}
				selectedButton={timelineTestButton}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				allTitles={[]}
				allMenus={[]}
				currentMenuId="menu-1"
				onUpdateButton={vi.fn()}
				onUpdateHighlightColours={vi.fn()}
				onRemoveButton={vi.fn()}
				document={buildMenuDocument({
					backgroundMode: 'motion',
					animation: [
						{
							nodeId: timelineTestButton.id,
							target: 'highlight-colour',
							keyframes: [
								{ timestampSecs: 0, value: { kind: 'colour', hex: '#ff0000' }, easing: 'hold' },
								{ timestampSecs: 1, value: { kind: 'colour', hex: '#00ff00' }, easing: 'hold' },
							],
						},
					],
				})}
				onAddKeyframeAtPlayhead={onAddKeyframeAtPlayhead}
			/>,
		);

		expect(screen.getByText(/2 keyframes across 1 track/)).toBeTruthy();
		fireEvent.click(screen.getByText('Add keyframe at playhead'));
		expect(onAddKeyframeAtPlayhead).toHaveBeenCalledWith(timelineTestButton.id);
	});

	it('disables "Add keyframe at playhead" with an explanatory title on a still menu', () => {
		const onAddKeyframeAtPlayhead = vi.fn();
		render(
			<InspectorPanel
				selectedNode={timelineTestButtonNode}
				selectedButton={timelineTestButton}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				allTitles={[]}
				allMenus={[]}
				currentMenuId="menu-1"
				onUpdateButton={vi.fn()}
				onUpdateHighlightColours={vi.fn()}
				onRemoveButton={vi.fn()}
				document={buildMenuDocument({ backgroundMode: 'still' })}
				onAddKeyframeAtPlayhead={onAddKeyframeAtPlayhead}
			/>,
		);

		const button = screen.getByText('Add keyframe at playhead') as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(button.title).toMatch(/motion background/i);
		fireEvent.click(button);
		expect(onAddKeyframeAtPlayhead).not.toHaveBeenCalled();
	});
});

describe('Navigation preview highlight animation (PR 8)', () => {
	const initialPlaybackState = useMenuPlaybackStore.getState();

	afterEach(() => {
		useMenuPlaybackStore.setState(initialPlaybackState, true);
	});

	it("samples the focused button's highlight colour at the playhead and updates as it crosses a keyframe", () => {
		const previewButtons: MenuButton[] = [
			{
				id: 'btn-1',
				label: 'Play',
				bounds: { x: 100, y: 300, width: 200, height: 40 },
				action: null,
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static',
				highlightKeyframes: [],
				videoAssetId: null,
			},
		];
		const tracks: AnimationTrack[] = [
			{
				nodeId: 'btn-1',
				target: 'highlight-colour',
				keyframes: [
					{ timestampSecs: 0, value: { kind: 'colour', hex: '#ff0000' }, easing: 'hold' },
					{ timestampSecs: 2, value: { kind: 'colour', hex: '#00ff00' }, easing: 'hold' },
				],
			},
		];

		act(() => {
			useMenuPlaybackStore.setState({ currentTime: 0 });
		});

		const { container } = render(
			<SceneCanvas
				buttons={previewButtons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				backgroundIsMotion={true}
				backgroundInitialTimeSecs={0}
				animationTracks={tracks}
				defaultButtonId="btn-1"
				previewMode={true}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		// The outline's opacity is baked into its alpha (no `highlight-opacity`
		// track here, so it falls back to `DEFAULT_HIGHLIGHT_COLOURS.selectOpacity`
		// = 0.6), mirroring `bake_opacity_into_alpha`'s `highlight_colour`
		// handling.
		const focused = () => container.querySelector('.scene-canvas__node--focused') as HTMLElement;
		expect(focused().style.outline).toContain('rgba(255, 0, 0, 0.6)');

		act(() => {
			useMenuPlaybackStore.setState({ currentTime: 2.5 });
		});

		expect(focused().style.outline).toContain('rgba(0, 255, 0, 0.6)');
	});

	it("bakes in a still menu's first keyframe regardless of the playhead, mirroring the disc's degrade path", () => {
		const previewButtons: MenuButton[] = [
			{
				id: 'btn-1',
				label: 'Play',
				bounds: { x: 100, y: 300, width: 200, height: 40 },
				action: null,
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static',
				highlightKeyframes: [],
				videoAssetId: null,
			},
		];
		const tracks: AnimationTrack[] = [
			{
				nodeId: 'btn-1',
				target: 'highlight-colour',
				keyframes: [
					{ timestampSecs: 0, value: { kind: 'colour', hex: '#ff0000' }, easing: 'hold' },
					{ timestampSecs: 2, value: { kind: 'colour', hex: '#00ff00' }, easing: 'hold' },
				],
			},
		];

		act(() => {
			useMenuPlaybackStore.setState({ currentTime: 2.5 });
		});

		const { container } = render(
			<SceneCanvas
				buttons={previewButtons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				backgroundIsMotion={false}
				backgroundInitialTimeSecs={0}
				animationTracks={tracks}
				defaultButtonId="btn-1"
				previewMode={true}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		// Playhead is past the second keyframe (2.5s > 2s), but a still menu
		// can't host a schedule at all — the disc bakes in only the track's
		// first keyframe (`build_overlay_keyframe_schedule`'s still-menu
		// degrade path), so the preview must too.
		const focused = container.querySelector('.scene-canvas__node--focused') as HTMLElement;
		expect(focused.style.outline).toContain('rgba(255, 0, 0, 0.6)');
	});

	it("samples the activated button's outline from its activate-colour track", () => {
		const previewButtons: MenuButton[] = [
			{
				id: 'btn-1',
				label: 'Play',
				bounds: { x: 100, y: 300, width: 200, height: 40 },
				action: null,
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static',
				highlightKeyframes: [],
				videoAssetId: null,
			},
		];
		const tracks: AnimationTrack[] = [
			{
				nodeId: 'btn-1',
				target: 'activate-colour',
				keyframes: [
					{ timestampSecs: 0, value: { kind: 'colour', hex: '#0000ff' }, easing: 'hold' },
				],
			},
		];

		act(() => {
			useMenuPlaybackStore.setState({ currentTime: 0 });
		});

		const { container } = render(
			<SceneCanvas
				buttons={previewButtons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				backgroundIsMotion={true}
				backgroundInitialTimeSecs={0}
				animationTracks={tracks}
				defaultButtonId="btn-1"
				previewMode={true}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		// btn-1 starts focused (via defaultButtonId); Enter also activates it
		// — the activated-state outline (from its own `activate-colour`
		// track) then wins over the focused-state one in the merged style.
		fireEvent.keyDown(container.querySelector('.scene-canvas__viewport--preview')!, {
			key: 'Enter',
		});

		// No `activate-opacity` track, so the outline's alpha comes from the
		// menu's static `activateOpacity` default (0.8) baked in via
		// `hexToRgba` — the compiled disc has no separate opacity channel
		// for the activated state, only baked alpha (`bake_opacity_into_alpha`).
		const node = container.querySelector('.scene-canvas__node--focused') as HTMLElement;
		expect(node.style.outline).toContain('rgba(0, 0, 255, 0.8)');
	});

	it("bakes the activated button's activate-opacity track into the outline's alpha", () => {
		const previewButtons: MenuButton[] = [
			{
				id: 'btn-1',
				label: 'Play',
				bounds: { x: 100, y: 300, width: 200, height: 40 },
				action: null,
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static',
				highlightKeyframes: [],
				videoAssetId: null,
			},
		];
		const tracks: AnimationTrack[] = [
			{
				nodeId: 'btn-1',
				target: 'activate-colour',
				keyframes: [
					{ timestampSecs: 0, value: { kind: 'colour', hex: '#0000ff' }, easing: 'hold' },
				],
			},
			{
				nodeId: 'btn-1',
				target: 'activate-opacity',
				keyframes: [{ timestampSecs: 0, value: { kind: 'scalar', value: 0.25 }, easing: 'hold' }],
			},
		];

		act(() => {
			useMenuPlaybackStore.setState({ currentTime: 0 });
		});

		const { container } = render(
			<SceneCanvas
				buttons={previewButtons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				backgroundIsMotion={true}
				backgroundInitialTimeSecs={0}
				animationTracks={tracks}
				defaultButtonId="btn-1"
				previewMode={true}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		fireEvent.keyDown(container.querySelector('.scene-canvas__viewport--preview')!, {
			key: 'Enter',
		});

		const node = container.querySelector('.scene-canvas__node--focused') as HTMLElement;
		expect(node.style.outline).toContain('rgba(0, 0, 255, 0.25)');
	});

	it("bakes the focused button's highlight-opacity track into the outline's alpha", () => {
		// Regression test: the focused-state outline used the raw
		// `highlight-colour` hex with no alpha, ignoring `hlOpacity` entirely
		// — only the decorative glow (`boxShadow`) used it. The compiler
		// bakes highlight opacity into the highlight colour's own alpha
		// (`bake_opacity_into_alpha`'s `highlight_colour` handling, the same
		// treatment `select_colour`/the activated state already gets), so
		// the outline must match.
		const previewButtons: MenuButton[] = [
			{
				id: 'btn-1',
				label: 'Play',
				bounds: { x: 100, y: 300, width: 200, height: 40 },
				action: null,
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static',
				highlightKeyframes: [],
				videoAssetId: null,
			},
		];
		const tracks: AnimationTrack[] = [
			{
				nodeId: 'btn-1',
				target: 'highlight-colour',
				keyframes: [
					{ timestampSecs: 0, value: { kind: 'colour', hex: '#0000ff' }, easing: 'hold' },
				],
			},
			{
				nodeId: 'btn-1',
				target: 'highlight-opacity',
				keyframes: [{ timestampSecs: 0, value: { kind: 'scalar', value: 0.25 }, easing: 'hold' }],
			},
		];

		act(() => {
			useMenuPlaybackStore.setState({ currentTime: 0 });
		});

		const { container } = render(
			<SceneCanvas
				buttons={previewButtons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				backgroundIsMotion={true}
				backgroundInitialTimeSecs={0}
				animationTracks={tracks}
				defaultButtonId="btn-1"
				previewMode={true}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={false}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		const node = container.querySelector('.scene-canvas__node--focused') as HTMLElement;
		expect(node.style.outline).toContain('rgba(0, 0, 255, 0.25)');
	});

	it('honest preview folds every button into the same menu-wide activate colour', () => {
		// The compiled disc has exactly one CLUT for the whole menu — two
		// buttons with different `activate-colour` tracks can't both show
		// their own colour on the real disc. Honest preview must show the
		// SAME document-order-last-wins value for both, not each button's
		// own track.
		const previewButtons: MenuButton[] = [
			{
				id: 'btn-1',
				label: 'Play',
				bounds: { x: 100, y: 300, width: 200, height: 40 },
				action: null,
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static',
				highlightKeyframes: [],
				videoAssetId: null,
			},
			{
				id: 'btn-2',
				label: 'Setup',
				bounds: { x: 100, y: 360, width: 200, height: 40 },
				action: null,
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static',
				highlightKeyframes: [],
				videoAssetId: null,
			},
		];
		const tracks: AnimationTrack[] = [
			{
				nodeId: 'btn-1',
				target: 'activate-colour',
				keyframes: [
					{ timestampSecs: 0, value: { kind: 'colour', hex: '#0000ff' }, easing: 'hold' },
				],
			},
			{
				nodeId: 'btn-2',
				target: 'activate-colour',
				keyframes: [
					{ timestampSecs: 0, value: { kind: 'colour', hex: '#ff00ff' }, easing: 'hold' },
				],
			},
		];

		act(() => {
			useMenuPlaybackStore.setState({ currentTime: 0 });
		});

		const { container } = render(
			<SceneCanvas
				buttons={previewButtons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				backgroundIsMotion={true}
				backgroundInitialTimeSecs={0}
				animationTracks={tracks}
				defaultButtonId="btn-1"
				previewMode={true}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={true}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		// Activate btn-1 (the default focus). Its OWN track is `#0000ff`, but
		// the fold walks every relevant track in `doc.animation` order and
		// lets the last one win — btn-2's `#ff00ff` — since that's the one
		// shared CLUT entry the compiled disc would actually produce.
		fireEvent.keyDown(container.querySelector('.scene-canvas__viewport--preview')!, {
			key: 'Enter',
		});
		const activatedNode = container.querySelector('.scene-canvas__node--focused') as HTMLElement;
		expect(activatedNode.style.outline).toContain('rgba(255, 0, 255, 0.8)');
	});

	it('honest preview excludes tracks targeting nodes outside the compiled top-level button set', () => {
		// Regression test: the planner only ever lowers TOP-LEVEL buttons
		// (`menu_ref.buttons()`) — a track on a group-nested button (named by
		// `menu.animation-node-not-compiled`) is silently dropped from the
		// disc's schedule. The honest-preview fold must drop it too, or it
		// shows a colour the compiled disc never would. `buttons` here
		// stands in for the compiled top-level set; `group-nested-btn` is
		// NOT a member of it, even though it carries a track.
		const previewButtons: MenuButton[] = [
			{
				id: 'btn-1',
				label: 'Play',
				bounds: { x: 100, y: 300, width: 200, height: 40 },
				action: null,
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static',
				highlightKeyframes: [],
				videoAssetId: null,
			},
		];
		const tracks: AnimationTrack[] = [
			{
				nodeId: 'btn-1',
				target: 'activate-colour',
				keyframes: [
					{ timestampSecs: 0, value: { kind: 'colour', hex: '#0000ff' }, easing: 'hold' },
				],
			},
			// Last in document order — would win the fold's last-track-wins
			// tie-break if it weren't filtered out, since it isn't a member
			// of `buttons`.
			{
				nodeId: 'group-nested-btn',
				target: 'activate-colour',
				keyframes: [
					{ timestampSecs: 0, value: { kind: 'colour', hex: '#ff00ff' }, easing: 'hold' },
				],
			},
		];

		act(() => {
			useMenuPlaybackStore.setState({ currentTime: 0 });
		});

		const { container } = render(
			<SceneCanvas
				buttons={previewButtons}
				canvasHeight={480}
				sceneNodes={[]}
				onUpdateButton={vi.fn()}
				onUpdateSceneNode={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				backgroundColour={null}
				backgroundIsMotion={true}
				backgroundInitialTimeSecs={0}
				animationTracks={tracks}
				defaultButtonId="btn-1"
				previewMode={true}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={true}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		fireEvent.keyDown(container.querySelector('.scene-canvas__viewport--preview')!, {
			key: 'Enter',
		});
		const activatedNode = container.querySelector('.scene-canvas__node--focused') as HTMLElement;
		expect(activatedNode.style.outline).toContain('rgba(0, 0, 255, 0.8)');
	});
});
