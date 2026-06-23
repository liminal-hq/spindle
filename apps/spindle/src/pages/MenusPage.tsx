// Menus page — unified menu authoring workspace (Set 2b).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState, useEffect, useMemo } from 'react';
import { useProjectStore } from '../store/project-store';
import { useNavigation } from '../App';
import { NoProjectState } from '../components/NoProjectState';
import { useDisplayDensity } from '../hooks/useDisplayDensity';
import type { Menu } from '../types/project';
import {
	DEFAULT_HIGHLIGHT_COLOURS,
	createDefaultMenuCompilePolicy,
	inferDefaultMenuDisplayAspect,
} from '../types/project';
import { MiniMenuMap } from '../components/menus/MenuMap';
import { MenuEditor } from '../components/menus/MenuEditor';
import { MenuListItem, EmptyMenuWorkspace } from '../components/menus/MenuListItem';
import { MENU_HEIGHT } from '../components/menus/menuDefaults';
import {
	getChapterGenerationStats,
	getMaxAudioTrackCount,
	getMaxSubtitleTrackCount,
	buildChapterMenusForTitleset,
	buildAudioSetupMenu,
	buildSubtitleSetupMenu,
} from '../components/menus/menuGenerators';
import {
	updateMenuInProject,
	computeMenuConnectionCounts,
	EMPTY_MENU_CONNECTION_COUNTS,
} from '../components/menus/menuProjectHelpers';

import './MenusPage.css';

/**
 * Thin wrapper so the no-project guard doesn't sit between hooks.
 *
 * `MenusWorkspace` below calls many hooks unconditionally; if this component
 * rendered `<NoProjectState>` and then `<MenusWorkspace>` from the *same*
 * function on a later render (project going from null to non-null without
 * unmounting), React would see a different number of hooks called between
 * renders and throw. Returning a different child *component* for each case
 * means React unmounts/remounts the subtree on that transition instead,
 * so `MenusWorkspace` only ever mounts once a project already exists.
 */
export function MenusPage() {
	const project = useProjectStore((s) => s.project);

	if (!project) {
		return (
			<NoProjectState
				title="No Project Open"
				description="Open or create a project to design menu layouts and navigation."
				icon={
					<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
						<rect x="8" y="8" width="48" height="48" rx="4" />
						<rect x="14" y="36" width="14" height="8" rx="2" />
						<rect x="36" y="36" width="14" height="8" rx="2" />
						<rect x="14" y="16" width="36" height="14" rx="2" />
					</svg>
				}
			/>
		);
	}

	return <MenusWorkspace />;
}

function MenusWorkspace() {
	const project = useProjectStore((s) => s.project);
	const updateProject = useProjectStore((s) => s.updateProject);
	const autoGenerateMenuNav = useProjectStore((s) => s.autoGenerateMenuNav);
	const selectedMenuId = useProjectStore((s) => s.selectedMenuId);
	const setSelectedMenuId = useProjectStore((s) => s.setSelectedMenuId);
	const menuEditorMode = useProjectStore((s) => s.menuEditorMode);
	const setMenuEditorMode = useProjectStore((s) => s.setMenuEditorMode);
	const { consumePendingEntityId } = useNavigation();
	// Measured against the workspace container, not the window — the window
	// also contains the app's own sidebar and padding, so window width
	// overstates how much room the workspace actually has. `containerRef` is
	// a callback ref attached to the `.menus` div below, which re-measures
	// correctly even though that div doesn't exist yet on the first render.
	const { containerRef: menusContainerRef, ...density } = useDisplayDensity();
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

	// Unreachable in practice — MenusPage only mounts this component once a
	// project exists, and swaps to a different component (unmounting this
	// one) if it closes. Needed purely for TypeScript's narrowing below.
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
		<div className="menus" data-breakpoint={density.breakpoint} ref={menusContainerRef}>
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
							density={density}
							railIsOverlay={railIsOverlay}
							railVisible={railVisible}
							onOpenRail={() => setRailOpenOverlay(true)}
						/>
					) : (
						<EmptyMenuWorkspace
							railIsOverlay={railIsOverlay}
							railVisible={railVisible}
							onOpenRail={() => setRailOpenOverlay(true)}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
