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
import { DEFAULT_HIGHLIGHT_COLOURS } from '../../types/project';

// ── LayersPanel ────────────────────────────────────────────────────────────

describe('LayersPanel', () => {
	const nodes: SceneNode[] = [
		{ type: 'button', id: 'btn-1', label: 'Play Movie', x: 10, y: 20, width: 200, height: 40 },
		{ type: 'button', id: 'btn-2', label: 'Chapters', x: 10, y: 80, width: 200, height: 40 },
		{ type: 'text', id: 'txt-1', content: 'Welcome', x: 100, y: 10 },
	];

	it('renders scene nodes in reverse z-order', () => {
		const onSelect = vi.fn();
		render(
			<LayersPanel
				nodes={nodes}
				selectedNodeId={null}
				onSelectNode={onSelect}
				collapsed={false}
				onToggleCollapse={vi.fn()}
			/>,
		);

		const items = screen.getAllByRole('button');
		// Reverse order: txt-1 first (top of stack), then btn-2, then btn-1
		// Plus the collapse button, so filter to layer items
		const layerItems = items.filter((el) => el.classList.contains('layers-panel__item'));
		expect(layerItems).toHaveLength(3);
		expect(layerItems[0]).toHaveTextContent('Welcome');
		expect(layerItems[1]).toHaveTextContent('Chapters');
		expect(layerItems[2]).toHaveTextContent('Play Movie');
	});

	it('highlights the selected node', () => {
		render(
			<LayersPanel
				nodes={nodes}
				selectedNodeId="btn-1"
				onSelectNode={vi.fn()}
				collapsed={false}
				onToggleCollapse={vi.fn()}
			/>,
		);

		const items = screen.getAllByRole('button').filter((el) =>
			el.classList.contains('layers-panel__item'),
		);
		const selected = items.find((el) =>
			el.classList.contains('layers-panel__item--selected'),
		);
		expect(selected).toBeDefined();
		expect(selected).toHaveTextContent('Play Movie');
	});

	it('calls onSelectNode when a layer item is clicked', () => {
		const onSelect = vi.fn();
		render(
			<LayersPanel
				nodes={nodes}
				selectedNodeId={null}
				onSelectNode={onSelect}
				collapsed={false}
				onToggleCollapse={vi.fn()}
			/>,
		);

		const items = screen.getAllByRole('button').filter((el) =>
			el.classList.contains('layers-panel__item'),
		);
		fireEvent.click(items[1]); // Chapters
		expect(onSelect).toHaveBeenCalledWith('btn-2');
	});

	it('renders collapsed state with icon rail', () => {
		render(
			<LayersPanel
				nodes={nodes}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
				collapsed={true}
				onToggleCollapse={vi.fn()}
			/>,
		);

		const panel = document.querySelector('.layers-panel--collapsed');
		expect(panel).toBeTruthy();
		// No layer items visible when collapsed
		const items = screen.queryAllByRole('button').filter((el) =>
			el.classList.contains('layers-panel__item'),
		);
		expect(items).toHaveLength(0);
	});

	it('shows empty state when no nodes', () => {
		render(
			<LayersPanel
				nodes={[]}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
				collapsed={false}
				onToggleCollapse={vi.fn()}
			/>,
		);

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
				collapsed={false}
				onToggleCollapse={vi.fn()}
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
				collapsed={false}
				onToggleCollapse={vi.fn()}
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
				collapsed={false}
				onToggleCollapse={vi.fn()}
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
				collapsed={false}
				onToggleCollapse={vi.fn()}
			/>,
		);

		const removeBtn = screen.getByText('Remove Button');
		fireEvent.click(removeBtn);
		expect(onRemove).toHaveBeenCalledWith('btn-1');
	});

	it('shows collapsed state', () => {
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
				collapsed={true}
				onToggleCollapse={vi.fn()}
			/>,
		);

		const panel = document.querySelector('.inspector-panel--collapsed');
		expect(panel).toBeTruthy();
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
				onUpdateButton={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
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
				onUpdateButton={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
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
				onUpdateButton={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
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
				onUpdateButton={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
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

	it('shows DVD Preview badge when honest preview is on', () => {
		render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				onUpdateButton={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
				defaultButtonId={null}
				previewMode={false}
				highlightColours={DEFAULT_HIGHLIGHT_COLOURS}
				honestPreview={true}
				showNavLines={false}
				selectedNodeId={null}
				onSelectNode={vi.fn()}
			/>,
		);

		expect(screen.getByText('DVD Preview')).toBeTruthy();
	});

	it('renders safe-area guides when enabled', () => {
		const { container } = render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				onUpdateButton={vi.fn()}
				showSafeArea={true}
				backgroundLabel={null}
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
				onUpdateButton={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
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

	it('deselects node when canvas background is clicked', () => {
		const onSelect = vi.fn();
		const { container } = render(
			<SceneCanvas
				buttons={buttons}
				canvasHeight={480}
				onUpdateButton={vi.fn()}
				showSafeArea={false}
				backgroundLabel={null}
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
});
