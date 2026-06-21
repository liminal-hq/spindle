// Menus page — unified menu authoring workspace (Set 2b).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState, useEffect, useMemo, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { useProjectStore } from '../store/project-store';
import { useNavigation } from '../App';
import { useDisplayDensity } from '../hooks/useDisplayDensity';
import type {
	AspectMode,
	ButtonStyleMap,
	FontEntry,
	Menu,
	MenuButton,
	MenuHighlightColours,
	PlaybackAction,
	SpindleProjectFile,
	TextStyle,
	VideoStandard,
	SceneNode,
} from '../types/project';
import {
	DEFAULT_HIGHLIGHT_COLOURS,
	createDefaultMenuCompilePolicy,
	inferDefaultMenuDisplayAspect,
} from '../types/project';
import { SceneCanvas } from '../components/menus/SceneCanvas';
import { InspectorPanel } from '../components/menus/InspectorPanel';
import { MiniMenuMap, FullMenuMap } from '../components/menus/MenuMap';
import '../components/menus/SceneEditor.css';

import './MenusPage.css';

// DVD menu canvas dimensions vary by video standard
const MENU_HEIGHT: Record<VideoStandard, number> = { NTSC: 480, PAL: 576 };

const DEFAULT_BUTTON_STYLE_MAP: ButtonStyleMap = {
	normal: {
		bgFill: 'rgba(255,255,255,0.04)',
		borderColour: '#ffffff1f',
		borderWidth: 1.5,
		borderRadius: 6,
		paddingH: 16,
		paddingV: 0,
		shadowType: 'none',
		shadowColour: '#ffa84020',
		shadowBlur: 16,
		shadowSpread: 0,
	},
	focus: {
		bgFill: 'rgba(255,170,64,0.15)',
		borderColour: '#ffaa40',
		borderWidth: 1.5,
		borderRadius: 6,
		paddingH: 16,
		paddingV: 0,
		shadowType: 'box-shadow',
		shadowColour: '#ffa84040',
		shadowBlur: 16,
		shadowSpread: 0,
	},
	activate: {
		bgFill: 'rgba(255,209,102,0.2)',
		borderColour: '#ffd166',
		borderWidth: 2,
		borderRadius: 6,
		paddingH: 16,
		paddingV: 0,
		shadowType: 'outer-glow',
		shadowColour: '#ffd16660',
		shadowBlur: 24,
		shadowSpread: 4,
	},
};

const DEFAULT_TEXT_STYLE: TextStyle = {
	fontFamily: 'Space Grotesk',
	fontSize: 14,
	fontWeight: 'normal',
	fontItalic: false,
	textDecoration: 'none',
	textAlign: 'left',
	colour: '#ffffff',
	lineHeight: 1.4,
	letterSpacing: 0,
};

export function MenusPage() {
	const project = useProjectStore((s) => s.project);
	const updateProject = useProjectStore((s) => s.updateProject);
	const autoGenerateMenuNav = useProjectStore((s) => s.autoGenerateMenuNav);
	const selectedMenuId = useProjectStore((s) => s.selectedMenuId);
	const setSelectedMenuId = useProjectStore((s) => s.setSelectedMenuId);
	const menuEditorMode = useProjectStore((s) => s.menuEditorMode);
	const setMenuEditorMode = useProjectStore((s) => s.setMenuEditorMode);
	const { consumePendingEntityId } = useNavigation();
	const density = useDisplayDensity();
	// Below 'wide' the rail becomes an overlay, but starts open — picking a
	// menu to work on is the first thing an author does, so it should not be
	// hidden by default the way the inspector (a detail panel) is.
	const [railOpenOverlay, setRailOpenOverlay] = useState(true);
	const railIsOverlay = !density.isWide;
	const railVisible = density.isWide || railOpenOverlay;

	// Consume navigation target from validation issue click
	useEffect(() => {
		const entityId = consumePendingEntityId();
		if (entityId) setSelectedMenuId(entityId);
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	if (!project) return null;

	const disc = project.disc;
	const allMenus = [
		...disc.globalMenus.map((m) => ({
			menu: m,
			scope: 'global' as const,
			titlesetId: null as string | null,
		})),
		...disc.titlesets.flatMap((ts) =>
			ts.menus.map((m) => ({ menu: m, scope: 'titleset' as const, titlesetId: ts.id })),
		),
	];
	const menuConnectionCounts = useMemo(() => computeMenuConnectionCounts(project), [project]);
	const selectedEntry = allMenus.find((e) => e.menu.id === selectedMenuId) ?? null;
	const firstMenuId = allMenus[0]?.menu.id ?? null;
	const activeView = menuEditorMode === 'map' ? 'map' : 'editor';
	// Titleset scope for menu generators. When ambiguous (multiple titlesets or a
	// global menu is selected), the user picks explicitly via generatorTitlesetId.
	const implicitTitlesetId =
		selectedEntry?.titlesetId ??
		(disc.titlesets.length === 1 ? disc.titlesets[0]?.id : null) ??
		null;
	const [generatorTitlesetId, setGeneratorTitlesetId] = useState<string | null>(implicitTitlesetId);

	// Sync the picker to the implicit titleset when a titleset-scoped menu is
	// selected and there is no ambiguity.
	useEffect(() => {
		if (implicitTitlesetId && disc.titlesets.length === 1) {
			setGeneratorTitlesetId(implicitTitlesetId);
		}
	}, [implicitTitlesetId, disc.titlesets.length]);

	const showTitlesetPicker =
		disc.titlesets.length > 1 || selectedEntry?.scope === 'global' || !selectedEntry;
	const resolvedTitlesetId =
		generatorTitlesetId ?? implicitTitlesetId ?? disc.titlesets[0]?.id ?? null;
	const selectedTitleset =
		disc.titlesets.find((ts) => ts.id === resolvedTitlesetId) ?? disc.titlesets[0] ?? null;
	const chapterGenerationStats = selectedTitleset
		? getChapterGenerationStats(selectedTitleset)
		: { chapterCount: 0, pageCount: 0 };
	const audioSetupCount = selectedTitleset ? getMaxAudioTrackCount(selectedTitleset) : 0;
	const subtitleSetupCount = selectedTitleset ? getMaxSubtitleTrackCount(selectedTitleset) : 0;
	const [templatesOpen, setTemplatesOpen] = useState(false);
	// Collapsed by default, matching Templates — an always-expanded generator
	// list crowds out the menu list and nav map above it, especially in the
	// rail's overlay form below 'wide'.
	const [generatorsOpen, setGeneratorsOpen] = useState(false);
	// Open by default (orientation at a glance is the point of the mini map),
	// but collapsible like its siblings so it can be tucked away on request
	// rather than always claiming rail space.
	const [navMapOpen, setNavMapOpen] = useState(true);

	useEffect(() => {
		if (!firstMenuId) {
			if (selectedMenuId !== null) setSelectedMenuId(null);
			return;
		}

		if (!selectedEntry) {
			setSelectedMenuId(firstMenuId);
		}
	}, [firstMenuId, selectedEntry, selectedMenuId, setSelectedMenuId]);

	const createMenu = (name: string, domain: 'vmgm' | 'titleset', titlesetId?: string): Menu => {
		const id = crypto.randomUUID();
		const displayAspect = inferDefaultMenuDisplayAspect(project, {
			titlesetId: titlesetId ?? null,
			domain,
		});
		return {
			id,
			name,
			backgroundAssetId: null,
			buttons: [],
			defaultButtonId: null,
			highlightColours: { ...DEFAULT_HIGHLIGHT_COLOURS },
			backgroundMode: 'still',
			motionDurationSecs: null,
			motionAudioAssetId: null,
			motionLoopCount: 0,
			timeoutAction: null,
			authoredDocument: {
				id,
				name,
				domain,
				scene: {
					designSize: { width: 720, height: MENU_HEIGHT[project.disc.standard] },
					background: { assetId: null, colour: null },
					nodes: [],
					guides: [],
				},
				interaction: {
					defaultFocusId: null,
					nodes: [],
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
				compilePolicy: createDefaultMenuCompilePolicy(displayAspect),
			},
		};
	};

	const handleAddGlobalMenu = () => {
		const newMenu = createMenu(`Menu ${disc.globalMenus.length + 1}`, 'vmgm');
		updateProject((p) => ({
			...p,
			disc: { ...p.disc, globalMenus: [...p.disc.globalMenus, newMenu] },
		}));
		setSelectedMenuId(newMenu.id);
	};

	const handleAddTitlesetMenu = (titlesetId: string) => {
		const ts = disc.titlesets.find((t) => t.id === titlesetId);
		const newMenu = createMenu(
			`${ts?.name ?? 'Titleset'} Menu ${(ts?.menus.length ?? 0) + 1}`,
			'titleset',
			titlesetId,
		);
		updateProject((p) => ({
			...p,
			disc: {
				...p.disc,
				titlesets: p.disc.titlesets.map((t) =>
					t.id === titlesetId ? { ...t, menus: [...t.menus, newMenu] } : t,
				),
			},
		}));
		setSelectedMenuId(newMenu.id);
	};

	const handleUpdateMenu = (menuId: string, updater: (m: Menu) => Menu) => {
		updateProject((p) => updateMenuInProject(p, menuId, updater));
	};

	const handleRemoveMenu = (menuId: string) => {
		updateProject((p) => ({
			...p,
			disc: {
				...p.disc,
				globalMenus: p.disc.globalMenus.filter((m) => m.id !== menuId),
				titlesets: p.disc.titlesets.map((ts) => ({
					...ts,
					menus: ts.menus.filter((m) => m.id !== menuId),
				})),
			},
		}));
		if (selectedMenuId === menuId) setSelectedMenuId(null);
	};

	const handleGenerateChapterMenus = () => {
		if (!selectedTitleset) return;
		const generated = buildChapterMenusForTitleset(
			selectedTitleset,
			project.disc.standard,
			selectedEntry?.menu.id ?? null,
		);
		if (generated.length === 0) return;

		updateProject((p) => ({
			...p,
			disc: {
				...p.disc,
				titlesets: p.disc.titlesets.map((ts) =>
					ts.id === selectedTitleset.id ? { ...ts, menus: [...ts.menus, ...generated] } : ts,
				),
			},
		}));
		setSelectedMenuId(generated[0].id);
	};

	const handleGenerateAudioSetup = () => {
		if (!selectedTitleset) return;
		const generated = buildAudioSetupMenu(
			selectedTitleset,
			project.disc.standard,
			selectedEntry?.menu.id ?? null,
		);
		if (!generated) return;

		updateProject((p) => ({
			...p,
			disc: {
				...p.disc,
				titlesets: p.disc.titlesets.map((ts) =>
					ts.id === selectedTitleset.id ? { ...ts, menus: [...ts.menus, generated] } : ts,
				),
			},
		}));
		setSelectedMenuId(generated.id);
	};

	const handleGenerateSubtitleSetup = () => {
		if (!selectedTitleset) return;
		const generated = buildSubtitleSetupMenu(
			selectedTitleset,
			project.disc.standard,
			selectedEntry?.menu.id ?? null,
		);
		if (!generated) return;

		updateProject((p) => ({
			...p,
			disc: {
				...p.disc,
				titlesets: p.disc.titlesets.map((ts) =>
					ts.id === selectedTitleset.id ? { ...ts, menus: [...ts.menus, generated] } : ts,
				),
			},
		}));
		setSelectedMenuId(generated.id);
	};

	return (
		<div className="menus" data-breakpoint={density.breakpoint}>
			<div className="menus-content">
				{railIsOverlay && railVisible && (
					<button
						type="button"
						className="menu-nav-scrim"
						aria-label="Close menu rail"
						onClick={() => setRailOpenOverlay(false)}
					/>
				)}
				<aside
					className={`menu-nav ${railIsOverlay ? 'menu-nav--overlay' : ''} ${
						railIsOverlay && !railVisible ? 'menu-nav--hidden' : ''
					}`}
				>
					<div className="menu-nav__header">
						{railIsOverlay && (
							<button
								type="button"
								className="menu-nav__rail-toggle"
								aria-label="Close menu rail"
								onClick={() => setRailOpenOverlay(false)}
							>
								✕
							</button>
						)}
						<span className="menu-nav__title">Menus</span>
						<div className="menu-nav__view-toggle" role="group" aria-label="Workspace view">
							<button
								className={`menu-nav__view-button ${
									activeView === 'editor' ? 'menu-nav__view-button--active' : ''
								}`}
								onClick={() => setMenuEditorMode('editor')}
							>
								Editor
							</button>
							<button
								className={`menu-nav__view-button ${
									activeView === 'map' ? 'menu-nav__view-button--active' : ''
								}`}
								onClick={() => setMenuEditorMode('map')}
							>
								Map
							</button>
						</div>
					</div>

					<div className="menu-nav__body">
						<div className="menu-nav__list">
							<div className="menus__scope-section">
								<div className="menus__scope-header">
									<span className="menus__scope-heading">
										<span className="menus__scope-badge menus__scope-badge--global">VMGM</span>
										Global
									</span>
									<button
										className="btn btn--ghost btn--sm"
										onClick={handleAddGlobalMenu}
										title="Add global menu"
									>
										+
									</button>
								</div>
								{disc.globalMenus.length === 0 ? (
									<div className="menus__scope-empty text-muted">No global menus</div>
								) : (
									disc.globalMenus.map((menu) => (
										<MenuListItem
											key={menu.id}
											menu={menu}
											connectionCounts={
												menuConnectionCounts[menu.id] ?? EMPTY_MENU_CONNECTION_COUNTS
											}
											isSelected={menu.id === selectedMenuId}
											onSelect={() => setSelectedMenuId(menu.id)}
										/>
									))
								)}
							</div>

							{disc.titlesets.map((ts, index) => (
								<div key={ts.id} className="menus__scope-section">
									<div className="menus__scope-header">
										<span className="menus__scope-heading">
											<span className="menus__scope-badge menus__scope-badge--titleset">
												VTS {index + 1}
											</span>
											{ts.name}
										</span>
										<button
											className="btn btn--ghost btn--sm"
											onClick={() => handleAddTitlesetMenu(ts.id)}
											title={`Add menu to ${ts.name}`}
										>
											+
										</button>
									</div>
									{ts.menus.length === 0 ? (
										<div className="menus__scope-empty text-muted">No menus</div>
									) : (
										ts.menus.map((menu) => (
											<MenuListItem
												key={menu.id}
												menu={menu}
												connectionCounts={
													menuConnectionCounts[menu.id] ?? EMPTY_MENU_CONNECTION_COUNTS
												}
												isSelected={menu.id === selectedMenuId}
												onSelect={() => setSelectedMenuId(menu.id)}
											/>
										))
									)}
								</div>
							))}
						</div>

						{allMenus.length === 0 ? (
							<div className="menu-nav__empty text-muted">
								Add a global or titleset menu to start authoring this disc.
							</div>
						) : (
							<div className="menu-nav__lower-stack">
								<MiniMenuMap
									project={project}
									selectedMenuId={selectedMenuId}
									onSelect={setSelectedMenuId}
									onExpand={() => setMenuEditorMode('map')}
									collapsed={!navMapOpen}
									onToggleCollapsed={() => setNavMapOpen((open) => !open)}
								/>
								<div className="menu-nav__panel">
									<button
										className="menu-nav__panel-header"
										type="button"
										onClick={() => setTemplatesOpen((open) => !open)}
										aria-expanded={templatesOpen}
									>
										<span>Templates</span>
										<span className="menu-nav__panel-chevron" aria-hidden="true">
											⌄
										</span>
									</button>
									{templatesOpen ? <div className="menu-nav__panel-body" /> : null}
								</div>
								<div className="menu-nav__panel">
									<button
										className="menu-nav__panel-header"
										type="button"
										onClick={() => setGeneratorsOpen((open) => !open)}
										aria-expanded={generatorsOpen}
									>
										<span>Generate Menus</span>
										<span className="menu-nav__panel-chevron" aria-hidden="true">
											⌄
										</span>
									</button>
									{generatorsOpen ? (
										<div className="menu-nav__generator-list">
											{showTitlesetPicker && disc.titlesets.length > 0 && (
												<select
													className="menu-nav__generator-titleset-picker"
													value={resolvedTitlesetId ?? ''}
													onChange={(e) => setGeneratorTitlesetId(e.target.value || null)}
													aria-label="Target titleset for menu generation"
												>
													{disc.titlesets.map((ts) => (
														<option key={ts.id} value={ts.id}>
															{ts.name}
														</option>
													))}
												</select>
											)}
											<button
												className="menu-nav__generator-item"
												type="button"
												onClick={handleGenerateChapterMenus}
												disabled={!selectedTitleset || chapterGenerationStats.chapterCount === 0}
											>
												<span className="menu-nav__generator-icon menu-nav__generator-icon--chapters">
													▦
												</span>
												<span className="menu-nav__generator-copy">
													<span className="menu-nav__generator-label">Chapter Grid</span>
													<span className="menu-nav__generator-meta">
														{chapterGenerationStats.chapterCount > 0
															? `${chapterGenerationStats.chapterCount} ch → ${chapterGenerationStats.pageCount} page${chapterGenerationStats.pageCount === 1 ? '' : 's'}`
															: 'No chapter data'}
													</span>
												</span>
											</button>
											<button
												className="menu-nav__generator-item"
												type="button"
												onClick={handleGenerateAudioSetup}
												disabled={!selectedTitleset || audioSetupCount === 0}
											>
												<span className="menu-nav__generator-icon menu-nav__generator-icon--audio">
													♪
												</span>
												<span className="menu-nav__generator-copy">
													<span className="menu-nav__generator-label">Audio Setup</span>
													<span className="menu-nav__generator-meta">
														{audioSetupCount > 0
															? `${audioSetupCount} stream${audioSetupCount === 1 ? '' : 's'}`
															: 'No audio mappings'}
													</span>
												</span>
											</button>
											<button
												className="menu-nav__generator-item"
												type="button"
												onClick={handleGenerateSubtitleSetup}
												disabled={!selectedTitleset || subtitleSetupCount === 0}
											>
												<span className="menu-nav__generator-icon menu-nav__generator-icon--subtitles">
													S
												</span>
												<span className="menu-nav__generator-copy">
													<span className="menu-nav__generator-label">Subtitle Setup</span>
													<span className="menu-nav__generator-meta">
														{subtitleSetupCount > 0
															? `${subtitleSetupCount} stream${subtitleSetupCount === 1 ? '' : 's'}`
															: 'No subtitle mappings'}
													</span>
												</span>
											</button>
										</div>
									) : null}
								</div>
							</div>
						)}
					</div>
				</aside>

				<div className="menus__editor-column">
					{selectedEntry ? (
						<MenuEditor
							menu={selectedEntry.menu}
							project={project}
							canvasHeight={MENU_HEIGHT[disc.standard]}
							onUpdate={(updater) => handleUpdateMenu(selectedEntry.menu.id, updater)}
							onRemove={() => handleRemoveMenu(selectedEntry.menu.id)}
							onAutoNav={() => autoGenerateMenuNav(selectedEntry.menu.id)}
							railIsOverlay={railIsOverlay}
							railVisible={railVisible}
							onOpenRail={() => setRailOpenOverlay(true)}
						/>
					) : (
						<EmptyMenuWorkspace />
					)}
				</div>
			</div>
		</div>
	);
}

// ── Menu List Item ──────────────────────────────────────────────────────────

function MenuListItem({
	menu,
	connectionCounts,
	isSelected,
	onSelect,
}: {
	menu: Menu;
	connectionCounts: MenuConnectionCounts;
	isSelected: boolean;
	onSelect: () => void;
}) {
	const previewBlocks = getMenuPreviewBlocks(menu);
	const buttonCount = previewBlocks.length;
	const previewBackground = getMenuPreviewBackground(menu);
	const hasWarning =
		buttonCount === 0 || (connectionCounts.incoming === 0 && connectionCounts.outgoing === 0);
	const modeLabel = menu.backgroundMode === 'motion' ? 'Motion' : 'Still';

	return (
		<div
			className={`menus__item ${isSelected ? 'menus__item--selected' : ''}`}
			onClick={onSelect}
			role="button"
			tabIndex={0}
			aria-pressed={isSelected}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onSelect();
				}
			}}
		>
			<div className="menus__item-preview" style={{ background: previewBackground }}>
				{previewBlocks.slice(0, 4).map((block, index) => (
					<div
						key={`${menu.id}-preview-${index}`}
						className="menus__item-preview-block"
						style={{
							left: `${block.x}%`,
							top: `${block.y}%`,
							width: `${block.width}%`,
						}}
					/>
				))}
				{previewBlocks.length === 0 && <div className="menus__item-preview-empty" />}
			</div>
			<div className="menus__item-info">
				<div className="menus__item-name">{menu.name}</div>
				<div className="menus__item-meta">
					<span>
						{buttonCount} button{buttonCount === 1 ? '' : 's'}
					</span>
					<span className="menus__item-bullet">•</span>
					<span>{modeLabel}</span>
					<div className="menus__item-conns">
						<span
							className="conn-indicator conn-indicator--out"
							title={`${connectionCounts.outgoing} outgoing connection${connectionCounts.outgoing === 1 ? '' : 's'}`}
						>
							&#8594;{connectionCounts.outgoing}
						</span>
						<span
							className="conn-indicator conn-indicator--in"
							title={`${connectionCounts.incoming} incoming connection${connectionCounts.incoming === 1 ? '' : 's'}`}
						>
							&#8592;{connectionCounts.incoming}
						</span>
					</div>
				</div>
			</div>
			<div
				className={`menus__item-status ${
					hasWarning ? 'menus__item-status--warn' : 'menus__item-status--ok'
				}`}
				aria-hidden="true"
			/>
		</div>
	);
}

function EmptyMenuWorkspace() {
	return (
		<section className="editor-area">
			<div className="editor-toolbar card">
				<div className="editor-toolbar__left">
					<h2 className="editor-toolbar__title">Menu Workspace</h2>
				</div>
			</div>
			<div className="editor-body editor-body--empty">
				<div className="menus__empty">
					<svg
						className="menus__empty-icon"
						viewBox="0 0 64 64"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
					>
						<rect x="8" y="8" width="48" height="48" rx="4" />
						<rect x="14" y="36" width="14" height="8" rx="2" />
						<rect x="36" y="36" width="14" height="8" rx="2" />
						<rect x="14" y="16" width="36" height="14" rx="2" />
					</svg>
					<h2>No menus yet</h2>
					<p className="text-muted">
						Use the rail to add a global or titleset menu, then author its canvas here.
					</p>
				</div>
			</div>
		</section>
	);
}

// ── Unified Menu Editor ─────────────────────────────────────────────────────

function MenuEditor({
	menu,
	project,
	canvasHeight,
	onUpdate,
	onRemove,
	onAutoNav,
	railIsOverlay,
	railVisible,
	onOpenRail,
}: {
	menu: Menu;
	project: SpindleProjectFile;
	canvasHeight: number;
	onUpdate: (updater: (m: Menu) => Menu) => void;
	onRemove: () => void;
	onAutoNav: () => void;
	railIsOverlay: boolean;
	railVisible: boolean;
	onOpenRail: () => void;
}) {
	const handleExportRenderPreview = useCallback(async () => {
		const outputPath = await save({
			title: 'Export Render Preview',
			filters: [{ name: 'PNG Image', extensions: ['png'] }],
			defaultPath: `${menu.name.replace(/[^a-z0-9_-]/gi, '_')}_preview.png`,
		});
		if (!outputPath) return;
		try {
			await invoke('plugin:spindle-project|export_menu_render_preview', {
				project,
				menuId: menu.id,
				outputPath,
			});
		} catch (err) {
			console.error('[MenusPage] export_menu_render_preview failed', err);
		}
	}, [menu.id, menu.name, project]);
	const allTitles = project.disc.titlesets.flatMap((ts) => ts.titles);
	const allMenus = [
		...project.disc.globalMenus,
		...project.disc.titlesets.flatMap((ts) => ts.menus),
	];

	// ── Workspace view: 'editor' or 'map'
	const menuEditorMode = useProjectStore((s) => s.menuEditorMode);
	const setMenuEditorMode = useProjectStore((s) => s.setMenuEditorMode);
	const setSelectedMenuId = useProjectStore((s) => s.setSelectedMenuId);
	const updateMenuDocument = useProjectStore((s) => s.updateMenuDocument);
	// Treat any legacy mode value as 'editor'
	const activeView = menuEditorMode === 'map' ? 'map' : 'editor';
	const menuDomainLabel = menu.authoredDocument?.domain === 'vmgm' ? 'VMGM' : 'Titleset';

	const previewMode = useProjectStore((s) => s.previewMode);
	const setPreviewMode = useProjectStore((s) => s.setPreviewMode);
	const showSafeArea = useProjectStore((s) => s.showSafeArea);
	const setShowSafeArea = useProjectStore((s) => s.setShowSafeArea);

	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [honestPreview, setHonestPreview] = useState(false);
	const [showNavLines, setShowNavLines] = useState(false);
	const [buttonPreviewState, setButtonPreviewState] = useState<'normal' | 'focus' | 'activate'>(
		'normal',
	);
	const [canvasZoom, setCanvasZoom] = useState(100);
	const [activeTool, setActiveTool] = useState<'select' | 'button' | 'text' | 'image' | 'shape'>(
		'select',
	);
	const density = useDisplayDensity();
	// At wide widths the inspector is a persistent column; below that it becomes
	// an overlay the author opens deliberately, since there isn't room for it
	// alongside a useable canvas.
	const [inspectorOpenOverlay, setInspectorOpenOverlay] = useState(false);
	const inspectorIsOverlay = !density.isWide;
	const inspectorVisible = density.isWide || inspectorOpenOverlay;
	const [availableFonts, setAvailableFonts] = useState<FontEntry[] | undefined>(undefined);

	// Load available fonts once when the menu is selected or when project assets change.
	// Best-effort: if the command fails, fall back to the hardcoded list (undefined).
	useEffect(() => {
		let cancelled = false;
		invoke<FontEntry[]>('plugin:spindle-project|list_available_fonts', { project })
			.then((fonts) => {
				if (!cancelled) setAvailableFonts(fonts);
			})
			.catch((err) => {
				console.error('[MenusPage] list_available_fonts failed', err);
			});
		return () => {
			cancelled = true;
		};
	}, [menu.id, project.assets]);

	const undo = useProjectStore((s) => s.undo);
	const redo = useProjectStore((s) => s.redo);

	// Ctrl+Z / Ctrl+Shift+Z for undo/redo
	// P for DVD preview toggle (format-scaling doc §2)
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const tag = (e.target as HTMLElement).tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

			if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
				e.preventDefault();
				if (e.shiftKey) {
					redo();
				} else {
					undo();
				}
				return;
			}

			// P — toggle DVD Preview (honest compile preview)
			if (e.key === 'p' || e.key === 'P') {
				e.preventDefault();
				setHonestPreview((v) => !v);
			}
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}, [undo, redo]);

	// Derive the scene nodes and button projections from authoredDocument
	const sceneNodes: SceneNode[] = menu.authoredDocument?.scene.nodes ?? [];
	const currentButtons: MenuButton[] = menu.authoredDocument
		? menu.authoredDocument.scene.nodes
				.filter((n): n is Extract<SceneNode, { type: 'button' }> => n.type === 'button')
				.map((node) => {
					const interaction = menu.authoredDocument!.interaction.nodes.find(
						(i) => i.nodeId === node.id,
					);
					return {
						id: node.id,
						label: node.label,
						bounds: { x: node.x, y: node.y, width: node.width, height: node.height },
						action: interaction?.action ?? null,
						navUp: interaction?.navUp ?? null,
						navDown: interaction?.navDown ?? null,
						navLeft: interaction?.navLeft ?? null,
						navRight: interaction?.navRight ?? null,
						highlightMode: node.highlightMode ?? 'static',
						highlightKeyframes: node.highlightKeyframes ?? [],
						videoAssetId: node.videoAssetId ?? null,
					};
				})
		: menu.buttons;

	const backgroundAsset = menu.backgroundAssetId
		? (project.assets.find((a) => a.id === menu.backgroundAssetId) ?? null)
		: null;
	const backgroundAssetLabel = backgroundAsset ? backgroundAsset.fileName : null;
	const highlightColours = menu.authoredDocument?.highlightColours ?? menu.highlightColours;
	const defaultFocusId = menu.authoredDocument?.interaction.defaultFocusId ?? menu.defaultButtonId;
	const displayAspect = resolveMenuDisplayAspect(project, menu);

	const selectedNode = sceneNodes.find((n) => n.id === selectedNodeId) ?? null;
	const selectedButton = currentButtons.find((b) => b.id === selectedNodeId) ?? null;

	useEffect(() => {
		if (!selectedNode || selectedNode.type !== 'button') {
			setButtonPreviewState('normal');
		}
	}, [selectedNode]);

	// ── Node addition handlers

	const handleAddButton = () => {
		const id = crypto.randomUUID();
		const btnCount =
			menu.authoredDocument?.scene.nodes.filter((n) => n.type === 'button').length ??
			menu.buttons.length;
		const label = `Button ${btnCount + 1}`;
		const x = 100 + btnCount * 20;
		const y = Math.min(300 + btnCount * 20, canvasHeight - 60);

		onUpdate((m) => {
			if (m.authoredDocument) {
				return {
					...m,
					authoredDocument: {
						...m.authoredDocument,
						scene: {
							...m.authoredDocument.scene,
							nodes: [
								...m.authoredDocument.scene.nodes,
								{
									type: 'button' as const,
									id,
									label,
									x,
									y,
									width: 200,
									height: 40,
									highlightMode: 'static' as const,
									highlightKeyframes: [],
									videoAssetId: null,
									buttonStyle: { ...DEFAULT_BUTTON_STYLE_MAP },
									labelStyle: { ...DEFAULT_TEXT_STYLE },
								},
							],
						},
						interaction: {
							...m.authoredDocument.interaction,
							nodes: [
								...m.authoredDocument.interaction.nodes,
								{
									nodeId: id,
									navUp: null,
									navDown: null,
									navLeft: null,
									navRight: null,
									action: null,
								},
							],
						},
					},
				};
			}
			return {
				...m,
				buttons: [
					...m.buttons,
					{
						id,
						label,
						bounds: { x, y, width: 200, height: 40 },
						action: null,
						navUp: null,
						navDown: null,
						navLeft: null,
						navRight: null,
						highlightMode: 'static' as const,
						highlightKeyframes: [],
						videoAssetId: null,
					},
				],
			};
		});
		setSelectedNodeId(id);
	};

	const handleAddSceneNode = (nodeType: 'text' | 'image' | 'shape') => {
		const id = crypto.randomUUID();
		const nodeCount =
			menu.authoredDocument?.scene.nodes.filter((n) => n.type === nodeType).length ?? 0;
		const x = 100 + nodeCount * 20;
		const y = Math.min(200 + nodeCount * 20, canvasHeight - 60);

		const newNode: SceneNode =
			nodeType === 'text'
				? {
						type: 'text',
						id,
						content: `Text ${nodeCount + 1}`,
						x,
						y,
						width: 200,
						height: 40,
						fontSize: 24,
						fontFamily: 'Space Grotesk',
						fontWeight: 'bold',
						colour: '#ffffff',
						textAlign: 'center',
					}
				: nodeType === 'image'
					? { type: 'image', id, assetId: '', x, y, width: 200, height: 150 }
					: { type: 'shape', id, x, y, width: 200, height: 100, fill: '#333333' };

		onUpdate((m) => {
			if (m.authoredDocument) {
				return {
					...m,
					authoredDocument: {
						...m.authoredDocument,
						scene: {
							...m.authoredDocument.scene,
							nodes: [...m.authoredDocument.scene.nodes, newNode],
						},
					},
				};
			}
			return m;
		});
		setSelectedNodeId(id);
	};

	// ── Update handlers

	const handleUpdateButton = (buttonId: string, updates: Partial<MenuButton>) => {
		onUpdate((m) => {
			if (m.authoredDocument) {
				const nodes = m.authoredDocument.scene.nodes.map((node) => {
					if (node.type === 'button' && node.id === buttonId) {
						return {
							...node,
							label: updates.label ?? node.label,
							x: updates.bounds?.x ?? node.x,
							y: updates.bounds?.y ?? node.y,
							width: updates.bounds?.width ?? node.width,
							height: updates.bounds?.height ?? node.height,
							highlightMode: updates.highlightMode ?? node.highlightMode,
							highlightKeyframes: updates.highlightKeyframes ?? node.highlightKeyframes,
							videoAssetId: updates.videoAssetId ?? node.videoAssetId,
						};
					}
					return node;
				});

				const interactionNodes = m.authoredDocument.interaction.nodes.map((node) => {
					if (node.nodeId === buttonId) {
						return {
							...node,
							action: updates.action !== undefined ? updates.action : node.action,
							navUp: updates.navUp !== undefined ? updates.navUp : node.navUp,
							navDown: updates.navDown !== undefined ? updates.navDown : node.navDown,
							navLeft: updates.navLeft !== undefined ? updates.navLeft : node.navLeft,
							navRight: updates.navRight !== undefined ? updates.navRight : node.navRight,
						};
					}
					return node;
				});

				// Mirror button changes back to the legacy buttons array so that
				// validation, planning, and compiler fallbacks see current state.
				const syncedButtons = nodes
					.filter((n): n is Extract<SceneNode, { type: 'button' }> => n.type === 'button')
					.map((node) => {
						const inode = interactionNodes.find((i) => i.nodeId === node.id);
						return {
							id: node.id,
							label: node.label,
							bounds: { x: node.x, y: node.y, width: node.width, height: node.height },
							action: inode?.action ?? null,
							navUp: inode?.navUp ?? null,
							navDown: inode?.navDown ?? null,
							navLeft: inode?.navLeft ?? null,
							navRight: inode?.navRight ?? null,
							highlightMode: node.highlightMode ?? ('static' as const),
							highlightKeyframes: node.highlightKeyframes ?? [],
							videoAssetId: node.videoAssetId ?? null,
						};
					});

				return {
					...m,
					buttons: syncedButtons,
					authoredDocument: {
						...m.authoredDocument,
						scene: { ...m.authoredDocument.scene, nodes },
						interaction: { ...m.authoredDocument.interaction, nodes: interactionNodes },
					},
				};
			}
			return {
				...m,
				buttons: m.buttons.map((b) => (b.id === buttonId ? { ...b, ...updates } : b)),
			};
		});
	};

	const handleRemoveButton = (buttonId: string) => {
		onUpdate((m) => {
			if (m.authoredDocument) {
				return {
					...m,
					authoredDocument: {
						...m.authoredDocument,
						scene: {
							...m.authoredDocument.scene,
							nodes: m.authoredDocument.scene.nodes.filter((n) => n.id !== buttonId),
						},
						interaction: {
							...m.authoredDocument.interaction,
							nodes: m.authoredDocument.interaction.nodes.filter((n) => n.nodeId !== buttonId),
							defaultFocusId:
								m.authoredDocument.interaction.defaultFocusId === buttonId
									? null
									: m.authoredDocument.interaction.defaultFocusId,
						},
					},
				};
			}
			return {
				...m,
				buttons: m.buttons.filter((b) => b.id !== buttonId),
				defaultButtonId: m.defaultButtonId === buttonId ? null : m.defaultButtonId,
			};
		});
		if (selectedNodeId === buttonId) setSelectedNodeId(null);
	};

	const handleUpdateSceneNode = (nodeId: string, updates: Record<string, unknown>) => {
		onUpdate((m) => {
			if (!m.authoredDocument) return m;
			return {
				...m,
				authoredDocument: {
					...m.authoredDocument,
					scene: {
						...m.authoredDocument.scene,
						nodes: m.authoredDocument.scene.nodes.map((node) => {
							if (node.id !== nodeId) return node;
							// Structural node types without a dedicated updater are blocked here.
							// Button nodes are allowed through so that style-only fields
							// (buttonStyle, labelStyle) written by the inspector can persist.
							// Geometry and interaction fields on buttons are owned by
							// handleUpdateButton and should not be sent through this path.
							if (
								node.type === 'group' ||
								node.type === 'componentInstance' ||
								node.type === 'generatedCollection'
							)
								return node;
							return { ...node, ...updates };
						}),
					},
				},
			};
		});
	};

	const handleRemoveNode = (nodeId: string) => {
		const isButton = currentButtons.some((b) => b.id === nodeId);
		if (isButton) {
			handleRemoveButton(nodeId);
			return;
		}
		onUpdate((m) => {
			if (!m.authoredDocument) return m;
			return {
				...m,
				authoredDocument: {
					...m.authoredDocument,
					scene: {
						...m.authoredDocument.scene,
						nodes: m.authoredDocument.scene.nodes.filter((n) => n.id !== nodeId),
					},
				},
			};
		});
		if (selectedNodeId === nodeId) setSelectedNodeId(null);
	};

	// Delete selected node with Delete/Backspace key
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (!selectedNodeId) return;
			if (e.key !== 'Delete' && e.key !== 'Backspace') return;
			const tag = (e.target as HTMLElement).tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
			e.preventDefault();
			handleRemoveNode(selectedNodeId);
		};
		document.addEventListener('keydown', handler);
		return () => document.removeEventListener('keydown', handler);
	}); // re-registers each render to close over current handlers

	const handleUpdateHighlightColours = (colours: MenuHighlightColours) => {
		onUpdate((m) => {
			if (m.authoredDocument) {
				return {
					...m,
					highlightColours: colours,
					authoredDocument: { ...m.authoredDocument, highlightColours: colours },
				};
			}
			return { ...m, highlightColours: colours };
		});
	};

	// Set default focus — updates authoredDocument interaction graph
	const handleSetDefaultFocus = (buttonId: string) => {
		onUpdate((m) => {
			if (m.authoredDocument) {
				return {
					...m,
					authoredDocument: {
						...m.authoredDocument,
						interaction: {
							...m.authoredDocument.interaction,
							defaultFocusId: buttonId,
						},
					},
				};
			}
			return { ...m, defaultButtonId: buttonId };
		});
	};

	// ── Background assignment (kept in canvas toolbar for now)

	const handleBackgroundChange = (newAssetId: string | null) => {
		onUpdate((m) => ({
			...m,
			backgroundAssetId: newAssetId,
			authoredDocument: m.authoredDocument
				? {
						...m.authoredDocument,
						scene: {
							...m.authoredDocument.scene,
							background: { ...m.authoredDocument.scene.background, assetId: newAssetId },
						},
					}
				: m.authoredDocument,
		}));
	};

	const handleBackgroundColourChange = (colour: string) => {
		onUpdate((m) => {
			if (m.authoredDocument) {
				return {
					...m,
					authoredDocument: {
						...m.authoredDocument,
						scene: {
							...m.authoredDocument.scene,
							background: { ...m.authoredDocument.scene.background, colour },
						},
					},
				};
			}
			return m;
		});
	};

	const handleBackgroundModeChange = (mode: 'still' | 'motion') => {
		onUpdate((m) => ({
			...m,
			backgroundMode: mode,
			authoredDocument: m.authoredDocument
				? {
						...m.authoredDocument,
						backgroundMode: mode,
					}
				: m.authoredDocument,
		}));
	};

	const handleMotionAudioChange = (assetId: string | null) => {
		onUpdate((m) => ({
			...m,
			motionAudioAssetId: assetId,
		}));
	};

	const handleMotionDurationChange = (secs: number | null) => {
		onUpdate((m) => ({
			...m,
			motionDurationSecs: secs,
			authoredDocument: m.authoredDocument
				? {
						...m.authoredDocument,
						timing: {
							...m.authoredDocument.timing,
							loopDurationSecs: secs ?? m.authoredDocument.timing.loopDurationSecs,
						},
					}
				: m.authoredDocument,
		}));
	};

	const handleMotionLoopCountChange = (count: number) => {
		onUpdate((m) => ({
			...m,
			motionLoopCount: count,
			authoredDocument: m.authoredDocument
				? {
						...m.authoredDocument,
						timing: {
							...m.authoredDocument.timing,
							loopCount: count,
						},
					}
				: m.authoredDocument,
		}));
	};

	const handleDisplayAspectChange = (aspect: AspectMode) => {
		updateMenuDocument(menu.id, (document) => ({
			...document,
			compilePolicy: {
				...createDefaultMenuCompilePolicy(resolveMenuDisplayAspect(project, menu)),
				...document.compilePolicy,
				displayAspect: aspect,
			},
		}));
	};

	const zoomOut = () => setCanvasZoom((value) => Math.max(50, value - 10));
	const zoomIn = () => setCanvasZoom((value) => Math.min(200, value + 10));
	const resetZoom = () => setCanvasZoom(100);

	return (
		<section className="editor-area">
			<div className={`editor-toolbar ${activeView === 'map' ? 'editor-toolbar--map' : ''}`}>
				<div className="editor-toolbar__left">
					{railIsOverlay && !railVisible && (
						<button
							type="button"
							className="editor-toolbar__toggle"
							onClick={onOpenRail}
							title="Show menus rail"
						>
							☰ Menus
						</button>
					)}
					{activeView === 'editor' ? (
						<input
							className="editor-toolbar__name"
							value={menu.name}
							onChange={(e) =>
								updateMenuDocument(menu.id, (document) => ({
									...document,
									name: e.target.value,
								}))
							}
							aria-label="Menu name"
						/>
					) : (
						<h2 className="editor-toolbar__title">Navigation Map</h2>
					)}
					<div className="editor-toolbar__info">
						{activeView === 'editor' ? (
							<>
								<span>{currentButtons.length} buttons</span>
								<span className="editor-toolbar__separator">|</span>
								<span>{menuDomainLabel}</span>
								<span className="editor-toolbar__separator">|</span>
								<span>
									{displayAspect === 'sixteen-by-nine' ? '16:9 anamorphic DVD' : '4:3 DVD'}
								</span>
								<span className="editor-toolbar__separator">|</span>
								<span>
									720 x {canvasHeight} {project.disc.standard}
								</span>
							</>
						) : (
							<>
								<span>{allMenus.length} menus</span>
								<span className="editor-toolbar__separator">|</span>
								<span>{project.disc.titlesets.length} titlesets</span>
								<span className="editor-toolbar__separator">|</span>
								<span>Double-click a card to open it in the editor</span>
							</>
						)}
					</div>
				</div>
				<div className="editor-toolbar__spacer" />
				{activeView === 'editor' ? (
					<>
						<div className="editor-toolbar__toggles" role="group" aria-label="Canvas overlays">
							<button
								className={`editor-toolbar__toggle ${showSafeArea ? 'editor-toolbar__toggle--active' : ''}`}
								onClick={() => setShowSafeArea(!showSafeArea)}
								aria-pressed={showSafeArea}
								title="Show safe-area guides"
							>
								Safe Area
							</button>
							<button
								className={`editor-toolbar__toggle editor-toolbar__toggle--preview ${
									honestPreview ? 'editor-toolbar__toggle--active' : ''
								}`}
								onClick={() => setHonestPreview((value) => !value)}
								aria-pressed={honestPreview}
								title="Toggle DVD preview"
							>
								<span className="editor-toolbar__toggle-dot" aria-hidden="true" />
								DVD Preview
							</button>
							<button
								className={`editor-toolbar__toggle ${previewMode ? 'editor-toolbar__toggle--active' : ''}`}
								onClick={() => setPreviewMode(!previewMode)}
								aria-pressed={previewMode}
								title="Enter remote preview mode"
							>
								Preview
							</button>
							<button
								className={`editor-toolbar__toggle ${showNavLines ? 'editor-toolbar__toggle--active' : ''}`}
								onClick={() => setShowNavLines((value) => !value)}
								aria-pressed={showNavLines}
								title="Show navigation lines between buttons"
							>
								Nav Lines
							</button>
						</div>
						<div className="editor-toolbar__zoom" role="group" aria-label="Canvas zoom">
							<button
								className="editor-toolbar__zoom-btn"
								type="button"
								onClick={zoomOut}
								title="Zoom out"
							>
								−
							</button>
							<button
								className="editor-toolbar__zoom-readout"
								type="button"
								onClick={resetZoom}
								title="Reset zoom"
							>
								{canvasZoom}%
							</button>
							<button
								className="editor-toolbar__zoom-btn"
								type="button"
								onClick={zoomIn}
								title="Zoom in"
							>
								+
							</button>
						</div>
						<div className="editor-toolbar__actions">
							<button className="btn btn--sm btn--danger" onClick={onRemove}>
								Delete Menu
							</button>
						</div>
						{inspectorIsOverlay && (
							<button
								type="button"
								className={`editor-toolbar__toggle editor-toolbar__toggle--inspector ${
									inspectorVisible ? 'editor-toolbar__toggle--active' : ''
								}`}
								onClick={() => setInspectorOpenOverlay((v) => !v)}
								aria-pressed={inspectorVisible}
								title="Toggle inspector panel"
							>
								Inspector
								<svg
									width="14"
									height="14"
									viewBox="0 0 16 16"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.5"
									aria-hidden="true"
								>
									<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
									<line x1="10" y1="2.5" x2="10" y2="13.5" />
								</svg>
							</button>
						)}
					</>
				) : (
					<div className="editor-toolbar__legend" aria-label="Map legend">
						<div className="editor-toolbar__legend-item">
							<span className="editor-toolbar__legend-line editor-toolbar__legend-line--show" />
							<span>Show</span>
						</div>
						<div className="editor-toolbar__legend-item">
							<span className="editor-toolbar__legend-line editor-toolbar__legend-line--play" />
							<span>Play</span>
						</div>
						<div className="editor-toolbar__legend-item">
							<span className="editor-toolbar__legend-line editor-toolbar__legend-line--return" />
							<span>Return</span>
						</div>
					</div>
				)}
			</div>

			{activeView === 'editor' ? (
				<div
					className={`editor-body ${
						inspectorIsOverlay && !inspectorVisible ? 'editor-body--inspector-closed' : ''
					}`}
				>
					<div className="menus__canvas-zone">
						<div className="menus__tools-floating" role="toolbar" aria-label="Scene tools">
							<button
								className={`menus__tool-button ${
									activeTool === 'select' ? 'menus__tool-button--active' : ''
								}`}
								type="button"
								onClick={() => setActiveTool('select')}
								title="Select"
							>
								↖
							</button>
							<button
								className={`menus__tool-button ${
									activeTool === 'text' ? 'menus__tool-button--active' : ''
								}`}
								type="button"
								onClick={() => {
									setActiveTool('text');
									handleAddSceneNode('text');
								}}
								title="Add text"
							>
								T
							</button>
							<button
								className={`menus__tool-button ${
									activeTool === 'button' ? 'menus__tool-button--active' : ''
								}`}
								type="button"
								onClick={() => {
									setActiveTool('button');
									handleAddButton();
								}}
								title="Add button"
							>
								▭
							</button>
							<button
								className={`menus__tool-button ${
									activeTool === 'image' ? 'menus__tool-button--active' : ''
								}`}
								type="button"
								onClick={() => {
									setActiveTool('image');
									handleAddSceneNode('image');
								}}
								title="Add image"
							>
								▧
							</button>
							<button
								className={`menus__tool-button ${
									activeTool === 'shape' ? 'menus__tool-button--active' : ''
								}`}
								type="button"
								onClick={() => {
									setActiveTool('shape');
									handleAddSceneNode('shape');
								}}
								title="Add shape"
							>
								□
							</button>
							<div className="menus__tool-sep" />
							<button
								className="menus__tool-button menus__tool-button--accent"
								type="button"
								onClick={onAutoNav}
								title="Auto-generate navigation"
							>
								➤
							</button>
						</div>
						<div
							className="menus__canvas-scroll"
							style={{ '--scene-zoom': `${canvasZoom / 100}` } as CSSProperties}
						>
							<SceneCanvas
								buttons={currentButtons}
								assets={project.assets}
								sceneNodes={sceneNodes}
								canvasHeight={canvasHeight}
								onUpdateButton={handleUpdateButton}
								onUpdateSceneNode={handleUpdateSceneNode}
								showSafeArea={showSafeArea}
								backgroundLabel={backgroundAssetLabel}
								backgroundColour={menu.authoredDocument?.scene.background.colour ?? null}
								backgroundAsset={backgroundAsset}
								defaultButtonId={defaultFocusId}
								previewMode={previewMode}
								highlightColours={highlightColours}
								honestPreview={honestPreview}
								showNavLines={showNavLines}
								selectedNodeId={selectedNodeId}
								onSelectNode={setSelectedNodeId}
								buttonPreviewState={buttonPreviewState}
								displayAspect={displayAspect}
							/>
						</div>
					</div>

					{(!inspectorIsOverlay || inspectorVisible) && (
						<div className="menus__side-panel">
							<InspectorPanel
								selectedNode={selectedNode}
								selectedButton={selectedButton}
								highlightColours={highlightColours}
								allTitles={allTitles}
								allMenus={allMenus}
								currentMenuId={menu.id}
								onUpdateButton={handleUpdateButton}
								onUpdateHighlightColours={handleUpdateHighlightColours}
								onRemoveButton={handleRemoveButton}
								onUpdateSceneNode={handleUpdateSceneNode}
								onRemoveNode={handleRemoveNode}
								assets={project.assets}
								buttons={currentButtons}
								interactionNodes={menu.authoredDocument?.interaction.nodes ?? []}
								defaultFocusId={defaultFocusId}
								document={menu.authoredDocument ?? null}
								canvasHeight={canvasHeight}
								onSetDefaultFocus={handleSetDefaultFocus}
								sceneNodes={sceneNodes}
								selectedNodeId={selectedNodeId}
								onSelectSceneNode={setSelectedNodeId}
								menu={menu}
								onUpdateBackgroundAsset={handleBackgroundChange}
								onUpdateBackgroundColour={handleBackgroundColourChange}
								onUpdateBackgroundMode={handleBackgroundModeChange}
								onUpdateMotionAudioAsset={handleMotionAudioChange}
								onUpdateMotionDurationSecs={handleMotionDurationChange}
								onUpdateMotionLoopCount={handleMotionLoopCountChange}
								onAutoNav={onAutoNav}
								onExportRenderPreview={
									menu.authoredDocument ? handleExportRenderPreview : undefined
								}
								buttonPreviewState={buttonPreviewState}
								onButtonPreviewStateChange={setButtonPreviewState}
								displayAspect={displayAspect}
								onDisplayAspectChange={handleDisplayAspectChange}
								availableFonts={availableFonts}
							/>
						</div>
					)}
				</div>
			) : (
				<div className="editor-body editor-body--map">
					<FullMenuMap
						project={project}
						selectedMenuId={menu.id}
						onSelectMenu={setSelectedMenuId}
						onOpenInEditor={(id) => {
							setSelectedMenuId(id);
							setMenuEditorMode('editor');
						}}
					/>
				</div>
			)}
		</section>
	);
}

function getChapterGenerationStats(titleset: SpindleProjectFile['disc']['titlesets'][number]): {
	chapterCount: number;
	pageCount: number;
} {
	const chapterCount = titleset.titles.reduce((sum, title) => sum + title.chapters.length, 0);
	return {
		chapterCount,
		pageCount: chapterCount === 0 ? 0 : Math.ceil(chapterCount / 6),
	};
}

function getMaxAudioTrackCount(titleset: SpindleProjectFile['disc']['titlesets'][number]): number {
	return Math.max(0, ...titleset.titles.map((title) => title.audioMappings.length));
}

function getMaxSubtitleTrackCount(
	titleset: SpindleProjectFile['disc']['titlesets'][number],
): number {
	return Math.max(0, ...titleset.titles.map((title) => title.subtitleMappings.length));
}

function buildChapterMenusForTitleset(
	titleset: SpindleProjectFile['disc']['titlesets'][number],
	standard: VideoStandard,
	returnMenuId: string | null,
): Menu[] {
	const chapterTargets = titleset.titles.flatMap((title) =>
		title.chapters.map((chapter) => ({
			titleId: title.id,
			chapterId: chapter.id,
			label: chapter.name,
		})),
	);
	if (chapterTargets.length === 0) return [];

	const pages = chunkArray(chapterTargets, 6);
	const pageIds = pages.map(() => crypto.randomUUID());

	return pages.map((page, pageIndex) => {
		const id = pageIds[pageIndex];
		const buttons = page.map((target, buttonIndex) => {
			const col = buttonIndex % 2;
			const row = Math.floor(buttonIndex / 2);
			return {
				id: crypto.randomUUID(),
				label: target.label,
				bounds: {
					x: 72 + col * 292,
					y: 132 + row * 92,
					width: 248,
					height: 52,
				},
				action: {
					type: 'playChapter' as const,
					titleId: target.titleId,
					chapterId: target.chapterId,
				},
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static' as const,
				highlightKeyframes: [],
				videoAssetId: null,
			};
		});

		const pageActions: Menu['buttons'] = [];
		if (pageIndex > 0) {
			pageActions.push({
				id: crypto.randomUUID(),
				label: 'Previous',
				bounds: { x: 72, y: 420, width: 148, height: 40 },
				action: { type: 'showMenu', menuId: pageIds[pageIndex - 1] },
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static',
				highlightKeyframes: [],
				videoAssetId: null,
			});
		}
		if (pageIndex < pages.length - 1) {
			pageActions.push({
				id: crypto.randomUUID(),
				label: 'Next',
				bounds: { x: 500, y: 420, width: 148, height: 40 },
				action: { type: 'showMenu', menuId: pageIds[pageIndex + 1] },
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static',
				highlightKeyframes: [],
				videoAssetId: null,
			});
		}
		if (returnMenuId) {
			pageActions.push({
				id: crypto.randomUUID(),
				label: 'Back',
				bounds: { x: 286, y: 420, width: 148, height: 40 },
				action: { type: 'showMenu', menuId: returnMenuId },
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static',
				highlightKeyframes: [],
				videoAssetId: null,
			});
		}

		return createGeneratedMenuFromButtons(
			id,
			pageIndex === 0 ? 'Chapter Select' : `Chapter Select ${pageIndex + 1}`,
			[...buttons, ...pageActions],
			'titleset',
			MENU_HEIGHT[standard],
			resolveTitlesetDisplayAspect(titleset),
		);
	});
}

export function buildAudioSetupMenu(
	titleset: SpindleProjectFile['disc']['titlesets'][number],
	standard: VideoStandard,
	returnMenuId: string | null,
): Menu | null {
	const audioChoices = Array.from(
		titleset.titles.reduce((choices, title) => {
			title.audioMappings.forEach((mapping) => {
				const streamIndex = mapping.orderIndex;
				if (!choices.has(streamIndex)) {
					choices.set(streamIndex, {
						index: streamIndex,
						label: mapping.label || `Audio ${streamIndex + 1}`,
					});
				}
			});
			return choices;
		}, new Map<number, { index: number; label: string }>()),
	)
		.sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
		.map(([, choice]) => choice);
	if (audioChoices.length === 0) return null;

	const id = crypto.randomUUID();
	const buttons: MenuButton[] = audioChoices.map((choice) => ({
		id: crypto.randomUUID(),
		label: choice.label,
		bounds: { x: 120, y: 132 + choice.index * 72, width: 480, height: 48 },
		action: {
			type: 'sequence' as const,
			actions: [
				{ type: 'setAudioStream' as const, streamIndex: choice.index },
				...(returnMenuId
					? ([{ type: 'showMenu', menuId: returnMenuId }] satisfies PlaybackAction[])
					: []),
			],
		},
		navUp: null,
		navDown: null,
		navLeft: null,
		navRight: null,
		highlightMode: 'static' as const,
		highlightKeyframes: [],
		videoAssetId: null,
	}));

	if (returnMenuId) {
		buttons.push({
			id: crypto.randomUUID(),
			label: 'Back',
			bounds: { x: 286, y: 420, width: 148, height: 40 },
			action: { type: 'showMenu', menuId: returnMenuId },
			navUp: null,
			navDown: null,
			navLeft: null,
			navRight: null,
			highlightMode: 'static',
			highlightKeyframes: [],
			videoAssetId: null,
		});
	}

	return createGeneratedMenuFromButtons(
		id,
		'Audio Setup',
		buttons,
		'titleset',
		MENU_HEIGHT[standard],
		resolveTitlesetDisplayAspect(titleset),
	);
}

export function buildSubtitleSetupMenu(
	titleset: SpindleProjectFile['disc']['titlesets'][number],
	standard: VideoStandard,
	returnMenuId: string | null,
): Menu | null {
	const subtitleChoices = Array.from(
		titleset.titles.reduce((choices, title) => {
			title.subtitleMappings.forEach((mapping) => {
				const streamIndex = mapping.orderIndex;
				if (!choices.has(streamIndex)) {
					choices.set(streamIndex, {
						index: streamIndex,
						label: mapping.label || `Subtitle ${streamIndex + 1}`,
					});
				}
			});
			return choices;
		}, new Map<number, { index: number; label: string }>()),
	)
		.sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
		.map(([, choice]) => choice);
	if (subtitleChoices.length === 0) return null;

	const id = crypto.randomUUID();
	const buttons: MenuButton[] = subtitleChoices.map((choice) => ({
		id: crypto.randomUUID(),
		label: choice.label,
		bounds: { x: 120, y: 116 + choice.index * 64, width: 480, height: 44 },
		action: {
			type: 'sequence' as const,
			actions: [
				{ type: 'setSubtitleStream' as const, streamIndex: choice.index },
				...(returnMenuId
					? ([{ type: 'showMenu', menuId: returnMenuId }] satisfies PlaybackAction[])
					: []),
			],
		},
		navUp: null,
		navDown: null,
		navLeft: null,
		navRight: null,
		highlightMode: 'static' as const,
		highlightKeyframes: [],
		videoAssetId: null,
	}));

	buttons.push({
		id: crypto.randomUUID(),
		label: 'Subtitles Off',
		bounds: { x: 120, y: 116 + buttons.length * 64, width: 480, height: 44 },
		action: {
			type: 'sequence' as const,
			actions: [
				{ type: 'setSubtitleStream' as const, streamIndex: null },
				...(returnMenuId
					? ([{ type: 'showMenu', menuId: returnMenuId }] satisfies PlaybackAction[])
					: []),
			],
		},
		navUp: null,
		navDown: null,
		navLeft: null,
		navRight: null,
		highlightMode: 'static',
		highlightKeyframes: [],
		videoAssetId: null,
	});

	if (returnMenuId) {
		buttons.push({
			id: crypto.randomUUID(),
			label: 'Back',
			bounds: { x: 286, y: 420, width: 148, height: 40 },
			action: { type: 'showMenu', menuId: returnMenuId },
			navUp: null,
			navDown: null,
			navLeft: null,
			navRight: null,
			highlightMode: 'static',
			highlightKeyframes: [],
			videoAssetId: null,
		});
	}

	return createGeneratedMenuFromButtons(
		id,
		'Subtitle Setup',
		buttons,
		'titleset',
		MENU_HEIGHT[standard],
		resolveTitlesetDisplayAspect(titleset),
	);
}

export function createGeneratedMenuFromButtons(
	id: string,
	name: string,
	buttons: Menu['buttons'],
	domain: 'vmgm' | 'titleset',
	designHeight: number,
	displayAspect: AspectMode,
): Menu {
	return {
		id,
		name,
		backgroundAssetId: null,
		buttons,
		defaultButtonId: buttons[0]?.id ?? null,
		highlightColours: { ...DEFAULT_HIGHLIGHT_COLOURS },
		backgroundMode: 'still',
		motionDurationSecs: null,
		motionAudioAssetId: null,
		motionLoopCount: 0,
		timeoutAction: null,
		authoredDocument: {
			id,
			name,
			domain,
			scene: {
				designSize: { width: 720, height: designHeight },
				background: { assetId: null, colour: '#0f0e1a' },
				nodes: buttons.map((button) => ({
					type: 'button' as const,
					id: button.id,
					label: button.label,
					x: button.bounds.x,
					y: button.bounds.y,
					width: button.bounds.width,
					height: button.bounds.height,
					highlightMode: button.highlightMode,
					highlightKeyframes: button.highlightKeyframes,
					videoAssetId: button.videoAssetId,
					buttonStyle: { ...DEFAULT_BUTTON_STYLE_MAP },
					labelStyle: { ...DEFAULT_TEXT_STYLE },
				})),
				guides: [],
			},
			interaction: {
				defaultFocusId: buttons[0]?.id ?? null,
				nodes: buttons.map((button) => ({
					nodeId: button.id,
					navUp: button.navUp,
					navDown: button.navDown,
					navLeft: button.navLeft,
					navRight: button.navRight,
					action: button.action,
				})),
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
			generationMeta: {
				generatorId: 'menu-workspace',
				lastGeneratedAt: new Date().toISOString(),
			},
			compilePolicy: createDefaultMenuCompilePolicy(displayAspect),
		},
	};
}

function chunkArray<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function updateMenuInProject(
	project: SpindleProjectFile,
	menuId: string,
	updater: (m: Menu) => Menu,
): SpindleProjectFile {
	return {
		...project,
		disc: {
			...project.disc,
			globalMenus: project.disc.globalMenus.map((m) => (m.id === menuId ? updater(m) : m)),
			titlesets: project.disc.titlesets.map((ts) => ({
				...ts,
				menus: ts.menus.map((m) => (m.id === menuId ? updater(m) : m)),
			})),
		},
	};
}

type MenuConnectionCounts = {
	incoming: number;
	outgoing: number;
};

const EMPTY_MENU_CONNECTION_COUNTS: MenuConnectionCounts = {
	incoming: 0,
	outgoing: 0,
};

function computeMenuConnectionCounts(
	project: SpindleProjectFile,
): Record<string, MenuConnectionCounts> {
	const countSets = new Map<string, { incoming: Set<string>; outgoing: Set<string> }>();

	const ensureCounts = (menuId: string) => {
		const existing = countSets.get(menuId);
		if (existing) return existing;
		const next = { incoming: new Set<string>(), outgoing: new Set<string>() };
		countSets.set(menuId, next);
		return next;
	};

	const registerOutgoing = (menuId: string, key: string) => {
		ensureCounts(menuId).outgoing.add(key);
	};

	const registerIncoming = (menuId: string, key: string) => {
		ensureCounts(menuId).incoming.add(key);
	};

	const inspectAction = (action: Menu['timeoutAction'], source: string, menuId?: string) => {
		if (!action) return;
		switch (action.type) {
			case 'showMenu':
				if (menuId) registerOutgoing(menuId, `show:${action.menuId}`);
				registerIncoming(action.menuId, `${source}:show:${action.menuId}`);
				break;
			case 'playTitle':
				if (menuId) registerOutgoing(menuId, `title:${action.titleId}`);
				break;
			case 'playChapter':
				if (menuId) registerOutgoing(menuId, `chapter:${action.titleId}:${action.chapterId}`);
				break;
			case 'sequence':
				action.actions.forEach((nestedAction, index) =>
					inspectAction(nestedAction, `${source}:sequence:${index}`, menuId),
				);
				break;
			case 'return':
				if (menuId) registerOutgoing(menuId, 'return');
				break;
			default:
				break;
		}
	};

	project.disc.globalMenus.forEach((menu) => ensureCounts(menu.id));
	project.disc.titlesets.forEach((titleset) =>
		titleset.menus.forEach((menu) => ensureCounts(menu.id)),
	);

	if (project.disc.firstPlayAction) {
		inspectAction(project.disc.firstPlayAction, 'disc:first-play');
	}

	project.disc.titlesets.forEach((titleset) =>
		titleset.titles.forEach((title) => {
			if (title.endAction) {
				inspectAction(title.endAction, `title:${title.id}`);
			}
		}),
	);

	const authoredMenus = [
		...project.disc.globalMenus,
		...project.disc.titlesets.flatMap((titleset) => titleset.menus),
	];

	authoredMenus.forEach((menu) => {
		const interactionNodes = menu.authoredDocument?.interaction.nodes ?? [];
		if (interactionNodes.length > 0) {
			interactionNodes.forEach((node, index) =>
				inspectAction(node.action, `menu:${menu.id}:node:${index}`, menu.id),
			);
		} else {
			menu.buttons.forEach((button) =>
				inspectAction(button.action, `menu:${menu.id}:button:${button.id}`, menu.id),
			);
		}
		inspectAction(
			menu.authoredDocument?.interaction.timeoutAction ?? menu.timeoutAction,
			`menu:${menu.id}:timeout`,
			menu.id,
		);
	});

	return Object.fromEntries(
		[...countSets.entries()].map(([menuId, counts]) => [
			menuId,
			{
				incoming: counts.incoming.size,
				outgoing: counts.outgoing.size,
			},
		]),
	);
}

function getMenuPreviewBlocks(menu: Menu): Array<{ x: number; y: number; width: number }> {
	const designWidth = menu.authoredDocument?.scene.designSize.width ?? 720;
	const designHeight = menu.authoredDocument?.scene.designSize.height ?? 480;
	const authoredButtons = menu.authoredDocument?.scene.nodes
		.filter((node): node is Extract<SceneNode, { type: 'button' }> => node.type === 'button')
		.map((button) => ({
			x: button.x,
			y: button.y,
			width: button.width,
		}));
	const legacyButtons =
		authoredButtons ??
		menu.buttons.map((button) => ({
			x: button.bounds.x,
			y: button.bounds.y,
			width: button.bounds.width,
		}));

	return legacyButtons
		.slice()
		.sort((left, right) => left.y - right.y || left.x - right.x)
		.map((button) => ({
			x: clampPercent((button.x / designWidth) * 100, 6, 82),
			y: clampPercent((button.y / designHeight) * 100, 12, 82),
			width: clampPercent((button.width / designWidth) * 100, 18, 82),
		}));
}

function resolveMenuDisplayAspect(project: SpindleProjectFile, menu: Menu): AspectMode {
	return (
		menu.authoredDocument?.compilePolicy.displayAspect ??
		inferDefaultMenuDisplayAspect(project, {
			menuId: menu.id,
			domain: menu.authoredDocument?.domain ?? 'vmgm',
		})
	);
}

function resolveTitlesetDisplayAspect(
	titleset: SpindleProjectFile['disc']['titlesets'][number],
): AspectMode {
	return (
		titleset.titles.find((title) => title.videoOutputProfile?.aspect)?.videoOutputProfile?.aspect ??
		'four-by-three'
	);
}

function getMenuPreviewBackground(menu: Menu): string {
	const backgroundColour = menu.authoredDocument?.scene.background.colour;
	if (backgroundColour) {
		return `linear-gradient(135deg, ${backgroundColour}, rgba(5, 5, 7, 0.92))`;
	}
	return 'linear-gradient(135deg, #1a1828, #0f0e1a)';
}

function clampPercent(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}
