// Characterization tests for the menus workspace page, written before
// splitting MenusPage.tsx into smaller files so the split can be verified
// against pre-existing behaviour rather than just types/lint/build.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MenusPage } from './MenusPage';
import { useProjectStore } from '../store/project-store';
import type { ProjectState } from '../store/project-store';
import type { Menu, SpindleProjectFile } from '../types/project';
import { DEFAULT_HIGHLIGHT_COLOURS, createDefaultMenuCompilePolicy } from '../types/project';

vi.mock('../App', () => ({
	useNavigation: () => ({
		consumePendingEntityId: () => null,
	}),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
	save: vi.fn(),
}));

vi.mock('tauri-plugin-spindle-project-api', () => ({
	exportMenuRenderPreview: vi.fn(),
	listAvailableFonts: vi.fn().mockResolvedValue([]),
}));

const { getActiveDisplay, onDisplayChanged } = vi.hoisted(() => ({
	getActiveDisplay: vi.fn(),
	onDisplayChanged: vi.fn(),
}));

vi.mock('tauri-plugin-display-awareness-api', () => ({
	getActiveDisplay,
	onDisplayChanged,
}));

class MockResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

function setWindowInnerSize(width: number, height: number) {
	Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
	Object.defineProperty(window, 'innerHeight', {
		writable: true,
		configurable: true,
		value: height,
	});
}

function buildButtonMenu(id: string, name: string): Menu {
	const button = {
		id: `${id}-button-1`,
		label: 'Play',
		bounds: { x: 100, y: 100, width: 200, height: 40 },
		action: null,
		navUp: null,
		navDown: null,
		navLeft: null,
		navRight: null,
		highlightMode: 'static' as const,
		highlightKeyframes: [],
		videoAssetId: null,
	};
	return {
		id,
		name,
		backgroundAssetId: null,
		buttons: [button],
		defaultButtonId: button.id,
		highlightColours: { ...DEFAULT_HIGHLIGHT_COLOURS },
		backgroundMode: 'still',
		motionDurationSecs: null,
		motionAudioAssetId: null,
		motionLoopCount: 0,
		timeoutAction: null,
		authoredDocument: {
			id,
			name,
			domain: 'vmgm',
			scene: {
				designSize: { width: 720, height: 480 },
				background: { assetId: null, colour: null },
				nodes: [
					{
						type: 'button',
						id: button.id,
						label: 'Play',
						x: 100,
						y: 100,
						width: 200,
						height: 40,
						highlightMode: 'static',
						highlightKeyframes: [],
						videoAssetId: null,
					},
				],
				guides: [],
			},
			interaction: {
				defaultFocusId: button.id,
				nodes: [
					{
						nodeId: button.id,
						navUp: null,
						navDown: null,
						navLeft: null,
						navRight: null,
						action: null,
					},
				],
				timeoutAction: null,
			},
			timing: {
				introStartSecs: 0,
				introDurationSecs: 0,
				loopStartSecs: 0,
				loopDurationSecs: 0,
				loopCount: 0,
			},
			highlightColours: { ...DEFAULT_HIGHLIGHT_COLOURS },
			backgroundMode: 'still',
			themeRef: null,
			generationMeta: null,
			compilePolicy: createDefaultMenuCompilePolicy('four-by-three'),
		},
	};
}

function buildProject(): SpindleProjectFile {
	const globalMenu = buildButtonMenu('global-menu-1', 'Main Menu');
	const titlesetMenu = buildButtonMenu('titleset-menu-1', 'Setup Menu');
	// Global menu links into the titleset menu, titleset menu links back —
	// gives both menus one incoming and one outgoing connection.
	globalMenu.buttons[0].action = { type: 'showMenu', menuId: titlesetMenu.id };
	globalMenu.authoredDocument!.interaction.nodes[0].action = globalMenu.buttons[0].action;
	titlesetMenu.buttons[0].action = { type: 'showMenu', menuId: globalMenu.id };
	titlesetMenu.authoredDocument!.interaction.nodes[0].action = titlesetMenu.buttons[0].action;

	const orphanMenu = buildButtonMenu('orphan-menu-1', 'Orphan Menu');
	orphanMenu.buttons[0].action = null;
	orphanMenu.authoredDocument!.interaction.nodes[0].action = null;

	return {
		schemaVersion: 1,
		project: {
			id: 'project-1',
			name: 'Menus Lab',
			createdAt: '2026-04-01T00:00:00Z',
			modifiedAt: '2026-04-01T00:00:00Z',
		},
		disc: {
			family: 'dvd-video',
			standard: 'NTSC',
			capacityTarget: 'DVD5',
			firstPlayAction: null,
			globalMenus: [globalMenu, orphanMenu],
			titlesets: [
				{
					id: 'titleset-1',
					name: 'Titleset 1',
					menus: [titlesetMenu],
					titles: [
						{
							id: 'title-1',
							name: 'Feature',
							sourceAssetId: null,
							videoMapping: null,
							videoOutputProfile: null,
							audioMappings: [
								{
									id: 'audio-1',
									sourceStreamIndex: 0,
									outputTarget: 'AC3',
									copyMode: 'copy',
									label: 'English',
									language: 'eng',
									orderIndex: 0,
									isDefault: true,
									channelLayout: null,
									bitrateBps: null,
								},
							],
							subtitleMappings: [
								{
									id: 'sub-1',
									sourceStreamIndex: 0,
									label: 'English Subs',
									language: 'eng',
									orderIndex: 0,
									isDefault: true,
									isForced: false,
								},
							],
							chapters: [
								{ id: 'ch-1', name: 'Chapter 1', timestampSecs: 0, orderIndex: 0 },
								{ id: 'ch-2', name: 'Chapter 2', timestampSecs: 60, orderIndex: 1 },
							],
							endAction: null,
							orderIndex: 0,
							bitrateWeight: 1,
							bitrateFloorBps: null,
							bitrateCeilingBps: null,
							pinnedBitrateBps: null,
						},
					],
				},
			],
		},
		assets: [],
		buildSettings: {
			outputDirectory: null,
			generateIso: false,
			safetyMarginBytes: 0,
			allocationStrategy: 'duration-weighted',
		},
	};
}

describe('MenusPage', () => {
	let initialState: ProjectState;

	beforeEach(() => {
		setWindowInnerSize(1400, 900);
		vi.stubGlobal('ResizeObserver', MockResizeObserver);
		getActiveDisplay.mockReset();
		getActiveDisplay.mockResolvedValue(null);
		onDisplayChanged.mockReset();
		onDisplayChanged.mockReturnValue(Promise.resolve(() => {}));

		initialState = useProjectStore.getState();
		useProjectStore.setState({
			...initialState,
			project: buildProject(),
			selectedMenuId: null,
			menuEditorMode: 'editor',
			previewMode: false,
			showSafeArea: true,
			updateProject: (updater) => {
				const current = useProjectStore.getState().project;
				if (!current) return;
				useProjectStore.setState({ project: updater(current) });
			},
			updateMenuDocument: (menuId, updater) => {
				const current = useProjectStore.getState().project;
				if (!current) return;
				const apply = (m: Menu) =>
					m.authoredDocument ? { ...m, authoredDocument: updater(m.authoredDocument) } : m;
				useProjectStore.setState({
					project: {
						...current,
						disc: {
							...current.disc,
							globalMenus: current.disc.globalMenus.map((m) => (m.id === menuId ? apply(m) : m)),
							titlesets: current.disc.titlesets.map((ts) => ({
								...ts,
								menus: ts.menus.map((m) => (m.id === menuId ? apply(m) : m)),
							})),
						},
					},
				});
			},
		});
	});

	afterEach(() => {
		cleanup();
		useProjectStore.setState(initialState);
	});

	// The rail's MiniMenuMap also renders each menu's name as SVG text, so
	// queries for menu names must be scoped to the rail's plain menu list to
	// avoid "Found multiple elements" failures.
	function railList(): HTMLElement {
		return document.querySelector('.menu-nav__list') as HTMLElement;
	}

	it('selects the first menu by default and renders the rail entries', () => {
		render(<MenusPage />);

		expect(useProjectStore.getState().selectedMenuId).toBe('global-menu-1');
		expect(screen.getByDisplayValue('Main Menu')).toBeInTheDocument();
		expect(within(railList()).getByText('Setup Menu')).toBeInTheDocument();
		expect(within(railList()).getByText('Orphan Menu')).toBeInTheDocument();
	});

	it('shows connection counts reflecting the inter-menu showMenu links', () => {
		render(<MenusPage />);

		const setupItem = within(railList())
			.getByText('Setup Menu')
			.closest('.menus__item') as HTMLElement;
		expect(within(setupItem).getByTitle('1 outgoing connection')).toBeInTheDocument();
		expect(within(setupItem).getByTitle('1 incoming connection')).toBeInTheDocument();

		const orphanItem = within(railList())
			.getByText('Orphan Menu')
			.closest('.menus__item') as HTMLElement;
		expect(orphanItem.querySelector('.menus__item-status--warn')).not.toBeNull();
	});

	it('selects a menu when clicked in the rail', () => {
		render(<MenusPage />);

		fireEvent.click(within(railList()).getByText('Setup Menu'));

		expect(useProjectStore.getState().selectedMenuId).toBe('titleset-menu-1');
		expect(screen.getByDisplayValue('Setup Menu')).toBeInTheDocument();
	});

	it('adds a new global menu via the rail "+" button', () => {
		render(<MenusPage />);

		fireEvent.click(screen.getByTitle('Add global menu'));

		const project = useProjectStore.getState().project!;
		expect(project.disc.globalMenus).toHaveLength(3);
		const newMenu = project.disc.globalMenus[2];
		expect(useProjectStore.getState().selectedMenuId).toBe(newMenu.id);
	});

	it('adds a new titleset menu via the rail "+" button', () => {
		render(<MenusPage />);

		fireEvent.click(screen.getByTitle('Add menu to Titleset 1'));

		const project = useProjectStore.getState().project!;
		expect(project.disc.titlesets[0].menus).toHaveLength(2);
	});

	it('deletes the selected menu via the toolbar Delete Menu button', () => {
		render(<MenusPage />);

		fireEvent.click(screen.getByRole('button', { name: 'Delete Menu' }));

		const project = useProjectStore.getState().project!;
		expect(project.disc.globalMenus.map((m) => m.id)).not.toContain('global-menu-1');
	});

	it('generates a chapter-grid menu from the Generate Menus panel', () => {
		render(<MenusPage />);

		fireEvent.click(screen.getByRole('button', { name: /Generate Menus/ }));
		fireEvent.click(screen.getByRole('button', { name: /Chapter Grid/ }));

		const project = useProjectStore.getState().project!;
		expect(project.disc.titlesets[0].menus).toHaveLength(2);
		const generated = project.disc.titlesets[0].menus[1];
		expect(generated.name).toBe('Chapter Select');
		const labels = generated.buttons.map((b) => b.label);
		expect(labels).toContain('Chapter 1');
		expect(labels).toContain('Chapter 2');
		expect(labels).toContain('Back');
	});

	it('generates an audio-setup menu from the Generate Menus panel', () => {
		render(<MenusPage />);

		fireEvent.click(screen.getByRole('button', { name: /Generate Menus/ }));
		fireEvent.click(screen.getByRole('button', { name: /Audio Setup/ }));

		const project = useProjectStore.getState().project!;
		const generated = project.disc.titlesets[0].menus[1];
		expect(generated.name).toBe('Audio Setup');
		expect(generated.buttons.map((b) => b.label)).toEqual(['English', 'Back']);
	});

	it('generates a subtitle-setup menu from the Generate Menus panel', () => {
		render(<MenusPage />);

		fireEvent.click(screen.getByRole('button', { name: /Generate Menus/ }));
		fireEvent.click(screen.getByRole('button', { name: /Subtitle Setup/ }));

		const project = useProjectStore.getState().project!;
		const generated = project.disc.titlesets[0].menus[1];
		expect(generated.name).toBe('Subtitle Setup');
		expect(generated.buttons.map((b) => b.label)).toEqual([
			'English Subs',
			'Subtitles Off',
			'Back',
		]);
	});

	it('adjusts canvas zoom via the toolbar zoom controls', () => {
		render(<MenusPage />);

		const readout = screen.getByTitle('Reset zoom');
		expect(readout).toHaveTextContent('100%');

		fireEvent.click(screen.getByTitle('Zoom in'));
		expect(readout).toHaveTextContent('110%');

		fireEvent.click(screen.getByTitle('Zoom out'));
		fireEvent.click(screen.getByTitle('Zoom out'));
		expect(readout).toHaveTextContent('90%');

		fireEvent.click(readout);
		expect(readout).toHaveTextContent('100%');
	});

	it('toggles Safe Area and Preview overlays', () => {
		render(<MenusPage />);

		const safeArea = screen.getByTitle('Show safe-area guides');
		expect(safeArea).toHaveAttribute('aria-pressed', 'true');
		fireEvent.click(safeArea);
		expect(safeArea).toHaveAttribute('aria-pressed', 'false');
		expect(useProjectStore.getState().showSafeArea).toBe(false);

		const preview = screen.getByTitle('Enter remote preview mode');
		expect(preview).toHaveAttribute('aria-pressed', 'false');
		fireEvent.click(preview);
		expect(preview).toHaveAttribute('aria-pressed', 'true');
		expect(useProjectStore.getState().previewMode).toBe(true);
	});

	it('adds a button to the canvas via the tool palette', () => {
		render(<MenusPage />);

		const toolbarInfo = () => document.querySelector('.editor-toolbar__info') as HTMLElement;
		expect(within(toolbarInfo()).getByText('1 buttons')).toBeInTheDocument();
		fireEvent.click(screen.getByTitle('Add button'));
		expect(within(toolbarInfo()).getByText('2 buttons')).toBeInTheDocument();

		const project = useProjectStore.getState().project!;
		const updated = project.disc.globalMenus.find((m) => m.id === 'global-menu-1')!;
		expect(updated.authoredDocument!.scene.nodes).toHaveLength(2);
		// handleAddButton only appends to authoredDocument.scene.nodes; the
		// legacy `buttons` mirror is only synced by handleUpdateButton, so it
		// stays at its pre-add length until something edits the new button.
		expect(updated.buttons).toHaveLength(1);
	});

	it('switches between editor and map views', () => {
		render(<MenusPage />);

		expect(screen.queryByRole('heading', { name: 'Navigation Map' })).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Map' }));
		expect(useProjectStore.getState().menuEditorMode).toBe('map');
		expect(screen.getByRole('heading', { name: 'Navigation Map' })).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', { name: 'Editor' }));
		expect(useProjectStore.getState().menuEditorMode).toBe('editor');
	});

	it('shows the empty workspace state when there are no menus', () => {
		useProjectStore.setState({
			project: {
				...useProjectStore.getState().project!,
				disc: {
					...useProjectStore.getState().project!.disc,
					globalMenus: [],
					titlesets: [{ id: 'titleset-1', name: 'Titleset 1', menus: [], titles: [] }],
				},
			},
			selectedMenuId: null,
		});

		render(<MenusPage />);

		expect(screen.getByText('No menus yet')).toBeInTheDocument();
	});
});
