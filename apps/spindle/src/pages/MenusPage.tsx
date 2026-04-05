// Menus page — define menu layouts, buttons, navigation, and visual editor.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState, useRef, useCallback, useEffect } from 'react';
import { useProjectStore } from '../store/project-store';
import { useNavigation } from '../App';
import type {
	Menu,
	MenuButton,
	MenuHighlightColours,
	ButtonBounds,
	PlaybackAction,
	SpindleProjectFile,
	VideoStandard,
	MenuEditorMode,
	SceneNode,
} from '../types/project';
import { DEFAULT_HIGHLIGHT_COLOURS } from '../types/project';

// DVD menu canvas dimensions vary by video standard
const MENU_WIDTH = 720;
const MENU_HEIGHT: Record<VideoStandard, number> = { NTSC: 480, PAL: 576 };

// Safe-area margins (SMPTE RP 218 — 90% action-safe, 80% title-safe)
const ACTION_SAFE_PCT = 0.05; // 5% from each edge
const TITLE_SAFE_PCT = 0.1; // 10% from each edge

import './MenusPage.css';

export function MenusPage() {
	const project = useProjectStore((s) => s.project);
	const updateProject = useProjectStore((s) => s.updateProject);
	const autoGenerateMenuNav = useProjectStore((s) => s.autoGenerateMenuNav);
	const selectedMenuId = useProjectStore((s) => s.selectedMenuId);
	const setSelectedMenuId = useProjectStore((s) => s.setSelectedMenuId);
	const { consumePendingEntityId } = useNavigation();

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
	const selectedEntry = allMenus.find((e) => e.menu.id === selectedMenuId) ?? null;

	const createMenu = (name: string, domain: 'vmgm' | 'titleset'): Menu => {
		const id = crypto.randomUUID();
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
					introDurationSecs: 0,
					loopDurationSecs: 0,
					loopCount: 0,
				},
				highlightColours: { ...DEFAULT_HIGHLIGHT_COLOURS },
				backgroundMode: 'still',
				themeRef: null,
				generationMeta: null,
				compilePolicy: { safeAreaMode: 'title-safe', paletteStrategy: 'auto' },
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

	return (
		<div className="menus">
			<div className="page-header">
				<h1 className="page-title">Menus</h1>
				<button className="btn btn--primary" onClick={handleAddGlobalMenu}>
					Add Menu
				</button>
			</div>

			{allMenus.length === 0 ? (
				<EmptyMenusView onAdd={handleAddGlobalMenu} />
			) : (
				<div className="menus__layout">
					{/* Menu list — grouped by scope */}
					<div className="menus__list">
						{/* Global menus */}
						<div className="menus__scope-section">
							<div className="menus__scope-header">
								<span className="menus__scope-heading">Global</span>
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
									<div
										key={menu.id}
										className={`menus__item card ${menu.id === selectedMenuId ? 'menus__item--selected' : ''}`}
										onClick={() => setSelectedMenuId(menu.id)}
										role="button"
										tabIndex={0}
										onKeyDown={(e) => e.key === 'Enter' && setSelectedMenuId(menu.id)}
									>
										<span className="menus__item-name">{menu.name}</span>
										<span className="badge badge--neutral">
											{menu.authoredDocument
												? menu.authoredDocument.scene.nodes.filter((n) => n.type === 'button').length
												: menu.buttons.length}{' '}
											btn
										</span>
									</div>
								))
							)}
						</div>

						{/* Per-titleset menus */}
						{disc.titlesets.map((ts) => (
							<div key={ts.id} className="menus__scope-section">
								<div className="menus__scope-header">
									<span className="menus__scope-heading">{ts.name}</span>
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
										<div
											key={menu.id}
											className={`menus__item card ${menu.id === selectedMenuId ? 'menus__item--selected' : ''}`}
											onClick={() => setSelectedMenuId(menu.id)}
											role="button"
											tabIndex={0}
											onKeyDown={(e) => e.key === 'Enter' && setSelectedMenuId(menu.id)}
										>
											<span className="menus__item-name">{menu.name}</span>
											<span className="badge badge--neutral">
											{menu.authoredDocument
												? menu.authoredDocument.scene.nodes.filter((n) => n.type === 'button').length
												: menu.buttons.length}{' '}
											btn
										</span>
										</div>
									))
								)}
							</div>
						))}
					</div>

					{/* Menu editor */}
					{selectedEntry && (
						<MenuEditor
							menu={selectedEntry.menu}
							project={project}
							canvasHeight={MENU_HEIGHT[disc.standard]}
							onUpdate={(updater) => handleUpdateMenu(selectedEntry.menu.id, updater)}
							onRemove={() => handleRemoveMenu(selectedEntry.menu.id)}
							onAutoNav={() => autoGenerateMenuNav(selectedEntry.menu.id)}
						/>
					)}
				</div>
			)}
		</div>
	);
}

// ── Sub-components ──────────────────────────────────────────────────────────

function EmptyMenusView({ onAdd }: { onAdd: () => void }) {
	return (
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
				Add menus to create navigation for your disc. Each menu can have buttons that link to
				titles, chapters, or other menus.
			</p>
			<button className="btn btn--primary" onClick={onAdd}>
				Add Menu
			</button>
		</div>
	);
}

function MenuEditor({
	menu,
	project,
	canvasHeight,
	onUpdate,
	onRemove,
	onAutoNav,
}: {
	menu: Menu;
	project: SpindleProjectFile;
	canvasHeight: number;
	onUpdate: (updater: (m: Menu) => Menu) => void;
	onRemove: () => void;
	onAutoNav: () => void;
}) {
	const allTitles = project.disc.titlesets.flatMap((ts) => ts.titles);
	const allMenus = [
		...project.disc.globalMenus,
		...project.disc.titlesets.flatMap((ts) => ts.menus),
	];
	const menuEditorMode = useProjectStore((s) => s.menuEditorMode);
	const setMenuEditorMode = useProjectStore((s) => s.setMenuEditorMode);
	const previewMode = useProjectStore((s) => s.previewMode);
	const setPreviewMode = useProjectStore((s) => s.setPreviewMode);
	const showSafeArea = useProjectStore((s) => s.showSafeArea);
	const setShowSafeArea = useProjectStore((s) => s.setShowSafeArea);

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

	const handleAddButton = () => {
		const id = crypto.randomUUID();
		const label = `Button ${(menu.authoredDocument?.scene.nodes.filter((n) => n.type === 'button').length ?? menu.buttons.length) + 1}`;
		const x = 100 + (menu.authoredDocument?.scene.nodes.filter((n) => n.type === 'button').length ?? menu.buttons.length) * 20;
		const y = Math.min(300 + (menu.authoredDocument?.scene.nodes.filter((n) => n.type === 'button').length ?? menu.buttons.length) * 20, canvasHeight - 60);

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
									type: 'button',
									id,
									label,
									x,
									y,
									width: 200,
									height: 40,
									highlightMode: 'static',
									highlightKeyframes: [],
									videoAssetId: null,
								},
							],
						},
						interaction: {
							...m.authoredDocument.interaction,
							nodes: [
								...m.authoredDocument.interaction.nodes,
								{ nodeId: id, navUp: null, navDown: null, navLeft: null, navRight: null, action: null },
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
						highlightMode: 'static',
						highlightKeyframes: [],
						videoAssetId: null,
					},
				],
			};
		});
	};

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

				return {
					...m,
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
	};

	return (
		<div className="menus__editor">
			{/* Mode Switcher */}
			<div className="menus__mode-switcher">
				{(['design', 'bind', 'remote', 'compile'] as MenuEditorMode[]).map((mode) => (
					<button
						key={mode}
						className={`btn btn--sm ${menuEditorMode === mode ? 'btn--primary' : 'btn--ghost'}`}
						onClick={() => setMenuEditorMode(mode)}
					>
						{mode.charAt(0).toUpperCase() + mode.slice(1)}
					</button>
				))}
			</div>

			{/* Menu canvas */}
			<div className="menus__canvas card">
				<div className="card__header">
					<input
						className="menus__editor-name"
						value={menu.name}
						onChange={(e) => onUpdate((m) => ({ ...m, name: e.target.value }))}
					/>
					<div className="menus__editor-actions">
						{menuEditorMode === 'design' && (
							<button className="btn btn--sm" onClick={handleAddButton}>
								Add Button
							</button>
						)}
						<button
							className="btn btn--sm"
							onClick={onAutoNav}
							title="Auto-generate directional navigation from button positions"
						>
							Auto Nav
						</button>
						<label className="menus__toggle" title="Show safe-area guides">
							<input
								type="checkbox"
								checked={showSafeArea}
								onChange={(e) => setShowSafeArea(e.target.checked)}
							/>
							Safe Area
						</label>
						<label className="menus__toggle" title="Preview navigation with arrow keys">
							<input
								type="checkbox"
								checked={previewMode}
								onChange={(e) => setPreviewMode(e.target.checked)}
							/>
							Preview
						</label>
						<button className="btn btn--sm btn--danger" onClick={onRemove}>
							Delete Menu
						</button>
					</div>
				</div>

				{/* Editor Content Seams */}
				{menuEditorMode === 'design' ? (
					<>
						{/* Background image assignment */}
						<div className="menus__bg-select">
							<label className="text-muted">Background: </label>
							<select
								className="menus__select-sm"
								value={menu.backgroundAssetId ?? ''}
								onChange={(e) =>
									onUpdate((m) => ({
										...m,
										backgroundAssetId: e.target.value || null,
									}))
								}
							>
								<option value="">None (solid colour)</option>
								{project.assets
									.filter(
										(a) =>
											a.videoStreams.length > 0 || a.fileName.match(/\.(png|jpg|jpeg|bmp|tiff?)$/i),
									)
									.map((a) => (
										<option key={a.id} value={a.id}>
											{a.fileName}
										</option>
									))}
							</select>
						</div>

						{/* Visual layout area */}
						<div className="menus__canvas-area">
							{previewMode ? (
								<NavigationPreview
									buttons={currentButtons}
									canvasHeight={canvasHeight}
									showSafeArea={showSafeArea}
									backgroundLabel={backgroundAssetLabel}
									defaultButtonId={
										menu.authoredDocument?.interaction.defaultFocusId ?? menu.defaultButtonId
									}
									highlightColours={
										menu.authoredDocument?.highlightColours ?? menu.highlightColours
									}
								/>
							) : (
								<MenuCanvas
									buttons={currentButtons}
									canvasHeight={canvasHeight}
									onUpdateButton={handleUpdateButton}
									showSafeArea={showSafeArea}
									backgroundLabel={backgroundAssetLabel}
									defaultButtonId={
										menu.authoredDocument?.interaction.defaultFocusId ?? menu.defaultButtonId
									}
								/>
							)}
						</div>
					</>
				) : (
					<div className="menus__editor-placeholder text-muted">
						{menuEditorMode.charAt(0).toUpperCase() + menuEditorMode.slice(1)} View (Coming in
						Milestone 2.2)
					</div>
				)}
			</div>

			{/* Button properties and Navigation (Design/Bind/Remote modes) */}
			{currentButtons.length > 0 && menuEditorMode !== 'compile' && (
				<div className="card menus__buttons">
					<h4 className="menus__section-heading">Buttons</h4>
					{currentButtons.map((btn) => (
						<div key={btn.id} className="menus__button-row">
							<input
								className="menus__button-label"
								value={btn.label}
								onChange={(e) => handleUpdateButton(btn.id, { label: e.target.value })}
							/>
							<select
								className="menus__button-action"
								value={actionToString(btn.action)}
								onChange={(e) =>
									handleUpdateButton(btn.id, {
										action: stringToAction(e.target.value, allTitles, allMenus),
									})
								}
							>
								<option value="">No action</option>
								<optgroup label="Play Title">
									{allTitles.map((t) => (
										<option key={t.id} value={`playTitle:${t.id}`}>
											{t.name}
										</option>
									))}
								</optgroup>
								{allTitles.some((t) => t.chapters.length > 0) && (
									<optgroup label="Play Chapter">
										{allTitles
											.filter((t) => t.chapters.length > 0)
											.flatMap((t) =>
												t.chapters.map((ch) => (
													<option key={`${t.id}:${ch.id}`} value={`playChapter:${t.id}:${ch.id}`}>
														{t.name} — {ch.name}
													</option>
												)),
											)}
									</optgroup>
								)}
								<optgroup label="Show Menu">
									{allMenus
										.filter((m) => m.id !== menu.id)
										.map((m) => (
											<option key={m.id} value={`showMenu:${m.id}`}>
												{m.name}
											</option>
										))}
								</optgroup>
								<option value="stop">Stop</option>
							</select>
							<label className="menus__button-default" title="Default button">
								<input
									type="radio"
									name={`default-${menu.id}`}
									checked={
										(menu.authoredDocument?.interaction.defaultFocusId ?? menu.defaultButtonId) ===
										btn.id
									}
									onChange={() =>
										onUpdate((m) => {
											if (m.authoredDocument) {
												return {
													...m,
													authoredDocument: {
														...m.authoredDocument,
														interaction: {
															...m.authoredDocument.interaction,
															defaultFocusId: btn.id,
														},
													},
												};
											}
											return { ...m, defaultButtonId: btn.id };
										})
									}
								/>
								Default
							</label>
							<button
								className="menus__button-remove"
								onClick={() => handleRemoveButton(btn.id)}
								title="Remove button"
							>
								×
							</button>
						</div>
					))}

					{/* Navigation editor */}
					<div className="menus__nav-summary">
						<h4 className="menus__section-heading">Navigation</h4>
						{currentButtons.map((btn) => (
							<div key={btn.id} className="menus__nav-editor-row">
								<span className="menus__nav-btn-name">{btn.label}</span>
								<div className="menus__nav-dirs">
									{(
										[
											['navUp', '↑'],
											['navDown', '↓'],
											['navLeft', '←'],
											['navRight', '→'],
										] as const
									).map(([field, arrow]) => (
										<label key={field} className="menus__nav-dir">
											<span className="menus__nav-arrow">{arrow}</span>
											<select
												className="menus__nav-select"
												value={btn[field] ?? ''}
												onChange={(e) =>
													handleUpdateButton(btn.id, {
														[field]: e.target.value || null,
													})
												}
											>
												<option value="">—</option>
												{currentButtons
													.filter((b) => b.id !== btn.id)
													.map((b) => (
														<option key={b.id} value={b.id}>
															{b.label}
														</option>
													))}
											</select>
										</label>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Highlight colours */}
			{menuEditorMode !== 'compile' && (
				<div className="card menus__highlights">
					<h4 className="menus__section-heading">Overlay Highlight Colours</h4>
					<p className="menus__highlights-hint text-muted">
						DVD menus use a subpicture overlay with a 4-colour palette. The select colour is shown
						when a button is focused; the activate colour flashes when pressed.
					</p>
					<HighlightColourEditor
						colours={menu.highlightColours}
						onChange={(colours) => onUpdate((m) => ({ ...m, highlightColours: colours }))}
					/>
				</div>
			)}
		</div>
	);
}

/** Snap threshold in menu coordinates. */
const SNAP_THRESHOLD = 8;

/** Minimum button size in menu coordinates. */
const MIN_BUTTON_SIZE = 30;

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

function MenuCanvas({
	buttons,
	canvasHeight,
	onUpdateButton,
	showSafeArea,
	backgroundLabel,
	defaultButtonId,
}: {
	buttons: MenuButton[];
	canvasHeight: number;
	onUpdateButton: (buttonId: string, updates: Partial<MenuButton>) => void;
	showSafeArea: boolean;
	backgroundLabel: string | null;
	defaultButtonId: string | null;
}) {
	const canvasRef = useRef<HTMLDivElement>(null);
	const dragState = useRef<{
		buttonId: string;
		mode: 'move' | ResizeEdge;
		startX: number;
		startY: number;
		startBounds: ButtonBounds;
	} | null>(null);
	const [snapLines, setSnapLines] = useState<{ axis: 'x' | 'y'; pos: number }[]>([]);

	/** Compute snap targets from other buttons (edges + centres). */
	const getSnapTargets = useCallback(
		(excludeId: string) => {
			const xs: number[] = [];
			const ys: number[] = [];
			for (const btn of buttons) {
				if (btn.id === excludeId) continue;
				xs.push(btn.bounds.x, btn.bounds.x + btn.bounds.width, btn.bounds.x + btn.bounds.width / 2);
				ys.push(
					btn.bounds.y,
					btn.bounds.y + btn.bounds.height,
					btn.bounds.y + btn.bounds.height / 2,
				);
			}
			// Canvas edges and centres
			xs.push(0, MENU_WIDTH / 2, MENU_WIDTH);
			ys.push(0, canvasHeight / 2, canvasHeight);
			return { xs, ys };
		},
		[buttons, canvasHeight],
	);

	/** Snap a value to the nearest target within threshold. */
	const snapValue = (val: number, targets: number[]): { snapped: number; line: number | null } => {
		let closest = val;
		let minDist = SNAP_THRESHOLD + 1;
		let line: number | null = null;
		for (const t of targets) {
			const d = Math.abs(val - t);
			if (d < minDist) {
				minDist = d;
				closest = t;
				line = t;
			}
		}
		return minDist <= SNAP_THRESHOLD ? { snapped: closest, line } : { snapped: val, line: null };
	};

	const startDrag = useCallback(
		(e: React.MouseEvent, btn: MenuButton, mode: 'move' | ResizeEdge) => {
			e.preventDefault();
			e.stopPropagation();
			const canvas = canvasRef.current;
			if (!canvas) return;

			dragState.current = {
				buttonId: btn.id,
				mode,
				startX: e.clientX,
				startY: e.clientY,
				startBounds: { ...btn.bounds },
			};

			const targets = getSnapTargets(btn.id);

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const state = dragState.current;
				if (!state || !canvas) return;

				const rect = canvas.getBoundingClientRect();
				const scaleX = MENU_WIDTH / rect.width;
				const scaleY = canvasHeight / rect.height;
				const dx = (moveEvent.clientX - state.startX) * scaleX;
				const dy = (moveEvent.clientY - state.startY) * scaleY;
				const sb = state.startBounds;

				let bounds: ButtonBounds;
				if (state.mode === 'move') {
					let newX = sb.x + dx;
					let newY = sb.y + dy;
					newX = Math.max(0, Math.min(MENU_WIDTH - sb.width, newX));
					newY = Math.max(0, Math.min(canvasHeight - sb.height, newY));

					// Snap edges and centre
					const lines: { axis: 'x' | 'y'; pos: number }[] = [];
					const sLeft = snapValue(newX, targets.xs);
					const sRight = snapValue(newX + sb.width, targets.xs);
					const sCx = snapValue(newX + sb.width / 2, targets.xs);
					if (sLeft.line != null) {
						newX = sLeft.snapped;
						lines.push({ axis: 'x', pos: sLeft.line });
					} else if (sRight.line != null) {
						newX = sRight.snapped - sb.width;
						lines.push({ axis: 'x', pos: sRight.line });
					} else if (sCx.line != null) {
						newX = sCx.snapped - sb.width / 2;
						lines.push({ axis: 'x', pos: sCx.line });
					}

					const sTop = snapValue(newY, targets.ys);
					const sBottom = snapValue(newY + sb.height, targets.ys);
					const sCy = snapValue(newY + sb.height / 2, targets.ys);
					if (sTop.line != null) {
						newY = sTop.snapped;
						lines.push({ axis: 'y', pos: sTop.line });
					} else if (sBottom.line != null) {
						newY = sBottom.snapped - sb.height;
						lines.push({ axis: 'y', pos: sBottom.line });
					} else if (sCy.line != null) {
						newY = sCy.snapped - sb.height / 2;
						lines.push({ axis: 'y', pos: sCy.line });
					}

					setSnapLines(lines);
					bounds = { x: Math.round(newX), y: Math.round(newY), width: sb.width, height: sb.height };
				} else {
					// Resize
					let { x, y, width, height } = sb;
					const m = state.mode;
					if (m.includes('e')) width = Math.max(MIN_BUTTON_SIZE, sb.width + dx);
					if (m.includes('w')) {
						width = Math.max(MIN_BUTTON_SIZE, sb.width - dx);
						x = sb.x + sb.width - width;
					}
					if (m.includes('s')) height = Math.max(MIN_BUTTON_SIZE, sb.height + dy);
					if (m.includes('n')) {
						height = Math.max(MIN_BUTTON_SIZE, sb.height - dy);
						y = sb.y + sb.height - height;
					}

					x = Math.max(0, Math.min(MENU_WIDTH - MIN_BUTTON_SIZE, x));
					y = Math.max(0, Math.min(canvasHeight - MIN_BUTTON_SIZE, y));
					if (x + width > MENU_WIDTH) width = MENU_WIDTH - x;
					if (y + height > canvasHeight) height = canvasHeight - y;

					setSnapLines([]);
					bounds = {
						x: Math.round(x),
						y: Math.round(y),
						width: Math.round(width),
						height: Math.round(height),
					};
				}

				onUpdateButton(state.buttonId, { bounds });
			};

			const handleMouseUp = () => {
				dragState.current = null;
				setSnapLines([]);
				document.removeEventListener('mousemove', handleMouseMove);
				document.removeEventListener('mouseup', handleMouseUp);
			};

			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
		},
		[onUpdateButton, canvasHeight, getSnapTargets],
	);

	return (
		<div
			className="menus__canvas-bg"
			ref={canvasRef}
			style={{ aspectRatio: `${MENU_WIDTH} / ${canvasHeight}` }}
		>
			{/* Background label */}
			{backgroundLabel && (
				<div className="menus__canvas-bg-label text-muted">{backgroundLabel}</div>
			)}
			{/* Navigation connection lines */}
			<NavLines buttons={buttons} canvasWidth={MENU_WIDTH} canvasHeight={canvasHeight} />
			{/* Snap guide lines */}
			{snapLines.map((line, i) =>
				line.axis === 'x' ? (
					<div
						key={`snap-${i}`}
						className="menus__snap-line menus__snap-line--v"
						style={{ left: `${(line.pos / MENU_WIDTH) * 100}%` }}
					/>
				) : (
					<div
						key={`snap-${i}`}
						className="menus__snap-line menus__snap-line--h"
						style={{ top: `${(line.pos / canvasHeight) * 100}%` }}
					/>
				),
			)}
			{/* Safe-area guides */}
			{showSafeArea && (
				<>
					<div
						className="menus__safe-area menus__safe-area--action"
						style={{
							left: `${ACTION_SAFE_PCT * 100}%`,
							top: `${ACTION_SAFE_PCT * 100}%`,
							right: `${ACTION_SAFE_PCT * 100}%`,
							bottom: `${ACTION_SAFE_PCT * 100}%`,
						}}
					/>
					<div
						className="menus__safe-area menus__safe-area--title"
						style={{
							left: `${TITLE_SAFE_PCT * 100}%`,
							top: `${TITLE_SAFE_PCT * 100}%`,
							right: `${TITLE_SAFE_PCT * 100}%`,
							bottom: `${TITLE_SAFE_PCT * 100}%`,
						}}
					/>
				</>
			)}
			{buttons.map((btn) => (
				<div
					key={btn.id}
					className={`menus__canvas-button ${defaultButtonId === btn.id ? 'menus__canvas-button--default' : ''}`}
					style={{
						left: `${(btn.bounds.x / MENU_WIDTH) * 100}%`,
						top: `${(btn.bounds.y / canvasHeight) * 100}%`,
						width: `${(btn.bounds.width / MENU_WIDTH) * 100}%`,
						height: `${(btn.bounds.height / canvasHeight) * 100}%`,
					}}
					onMouseDown={(e) => startDrag(e, btn, 'move')}
				>
					{btn.label}
					{/* Resize handles */}
					{(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeEdge[]).map((edge) => (
						<div
							key={edge}
							className={`menus__resize-handle menus__resize-handle--${edge}`}
							onMouseDown={(e) => startDrag(e, btn, edge)}
						/>
					))}
				</div>
			))}
		</div>
	);
}

/** Direction-colour mapping for navigation lines. */
const NAV_COLOURS: Record<string, string> = {
	navUp: 'rgba(100, 200, 255, 0.5)',
	navDown: 'rgba(255, 170, 64, 0.5)',
	navLeft: 'rgba(180, 130, 255, 0.5)',
	navRight: 'rgba(130, 255, 130, 0.5)',
};

/** SVG overlay that draws directional navigation arrows between buttons. */
function NavLines({
	buttons,
	canvasWidth,
	canvasHeight,
}: {
	buttons: MenuButton[];
	canvasWidth: number;
	canvasHeight: number;
}) {
	const lines: { x1: number; y1: number; x2: number; y2: number; colour: string }[] = [];

	for (const btn of buttons) {
		const cx1 = btn.bounds.x + btn.bounds.width / 2;
		const cy1 = btn.bounds.y + btn.bounds.height / 2;

		for (const field of ['navUp', 'navDown', 'navLeft', 'navRight'] as const) {
			const targetId = btn[field];
			if (!targetId) continue;
			const target = buttons.find((b) => b.id === targetId);
			if (!target) continue;
			const cx2 = target.bounds.x + target.bounds.width / 2;
			const cy2 = target.bounds.y + target.bounds.height / 2;
			lines.push({ x1: cx1, y1: cy1, x2: cx2, y2: cy2, colour: NAV_COLOURS[field] });
		}
	}

	if (lines.length === 0) return null;

	return (
		<svg
			className="menus__nav-lines"
			viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
			preserveAspectRatio="none"
		>
			<defs>
				<marker id="nav-arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
					<path d="M0,0 L6,2 L0,4 Z" fill="rgba(255,255,255,0.6)" />
				</marker>
			</defs>
			{lines.map((l, i) => (
				<line
					key={i}
					x1={l.x1}
					y1={l.y1}
					x2={l.x2}
					y2={l.y2}
					stroke={l.colour}
					strokeWidth="2"
					markerEnd="url(#nav-arrow)"
				/>
			))}
		</svg>
	);
}

/** Keyboard-navigable preview of menu button focus. */
function NavigationPreview({
	buttons,
	canvasHeight,
	showSafeArea,
	backgroundLabel,
	defaultButtonId,
	highlightColours,
}: {
	buttons: MenuButton[];
	canvasHeight: number;
	showSafeArea: boolean;
	backgroundLabel: string | null;
	defaultButtonId: string | null;
	highlightColours: MenuHighlightColours;
}) {
	const [focusedId, setFocusedId] = useState<string | null>(
		defaultButtonId ?? buttons[0]?.id ?? null,
	);
	const containerRef = useRef<HTMLDivElement>(null);

	// Focus the container so it receives key events
	useEffect(() => {
		containerRef.current?.focus();
	}, []);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			const isNavKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(
				e.key,
			);
			if (!isNavKey) return;
			e.preventDefault();

			const btn = buttons.find((b) => b.id === focusedId);
			if (!btn) return;

			let nextId: string | null = null;
			switch (e.key) {
				case 'ArrowUp':
					nextId = btn.navUp;
					break;
				case 'ArrowDown':
					nextId = btn.navDown;
					break;
				case 'ArrowLeft':
					nextId = btn.navLeft;
					break;
				case 'ArrowRight':
					nextId = btn.navRight;
					break;
			}

			if (nextId) {
				setFocusedId(nextId);
			}
		},
		[focusedId, buttons],
	);

	return (
		<div
			className="menus__canvas-bg menus__canvas-bg--preview"
			ref={containerRef}
			tabIndex={0}
			onKeyDown={handleKeyDown}
			style={{ aspectRatio: `${MENU_WIDTH} / ${canvasHeight}` }}
		>
			{backgroundLabel && (
				<div className="menus__canvas-bg-label text-muted">{backgroundLabel}</div>
			)}
			{showSafeArea && (
				<>
					<div
						className="menus__safe-area menus__safe-area--action"
						style={{
							left: `${ACTION_SAFE_PCT * 100}%`,
							top: `${ACTION_SAFE_PCT * 100}%`,
							right: `${ACTION_SAFE_PCT * 100}%`,
							bottom: `${ACTION_SAFE_PCT * 100}%`,
						}}
					/>
					<div
						className="menus__safe-area menus__safe-area--title"
						style={{
							left: `${TITLE_SAFE_PCT * 100}%`,
							top: `${TITLE_SAFE_PCT * 100}%`,
							right: `${TITLE_SAFE_PCT * 100}%`,
							bottom: `${TITLE_SAFE_PCT * 100}%`,
						}}
					/>
				</>
			)}
			<div className="menus__preview-hint text-muted">
				Use arrow keys to navigate. Press Enter to activate.
			</div>
			{buttons.map((btn) => {
				const isFocused = btn.id === focusedId;
				const hl = highlightColours;
				return (
					<div
						key={btn.id}
						className={`menus__canvas-button ${isFocused ? 'menus__canvas-button--focused' : ''} ${defaultButtonId === btn.id ? 'menus__canvas-button--default' : ''}`}
						style={{
							left: `${(btn.bounds.x / MENU_WIDTH) * 100}%`,
							top: `${(btn.bounds.y / canvasHeight) * 100}%`,
							width: `${(btn.bounds.width / MENU_WIDTH) * 100}%`,
							height: `${(btn.bounds.height / canvasHeight) * 100}%`,
							...(isFocused
								? {
										background: hexToRgba(hl.selectColour, hl.selectOpacity),
										borderColor: hl.selectColour,
										boxShadow: `0 0 12px ${hexToRgba(hl.selectColour, 0.5)}, 0 0 24px ${hexToRgba(hl.selectColour, 0.2)}`,
									}
								: {}),
						}}
						onClick={() => setFocusedId(btn.id)}
					>
						{btn.label}
					</div>
				);
			})}
		</div>
	);
}

/** Editor for DVD subpicture overlay highlight colours. */
function HighlightColourEditor({
	colours,
	onChange,
}: {
	colours: MenuHighlightColours;
	onChange: (colours: MenuHighlightColours) => void;
}) {
	return (
		<div className="menus__colour-grid">
			<div className="menus__colour-field">
				<label className="menus__colour-label">Select Colour</label>
				<div className="menus__colour-row">
					<input
						type="color"
						className="menus__colour-input"
						value={colours.selectColour}
						onChange={(e) => onChange({ ...colours, selectColour: e.target.value })}
					/>
					<input
						className="menus__colour-hex"
						value={colours.selectColour}
						onChange={(e) => onChange({ ...colours, selectColour: e.target.value })}
						maxLength={7}
					/>
				</div>
				<div className="menus__colour-row">
					<label className="text-muted">Opacity</label>
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={colours.selectOpacity}
						onChange={(e) => onChange({ ...colours, selectOpacity: Number(e.target.value) })}
					/>
					<span className="text-muted">{Math.round(colours.selectOpacity * 100)}%</span>
				</div>
				<div
					className="menus__colour-swatch"
					style={{
						background: colours.selectColour,
						opacity: colours.selectOpacity,
					}}
				/>
			</div>
			<div className="menus__colour-field">
				<label className="menus__colour-label">Activate Colour</label>
				<div className="menus__colour-row">
					<input
						type="color"
						className="menus__colour-input"
						value={colours.activateColour}
						onChange={(e) => onChange({ ...colours, activateColour: e.target.value })}
					/>
					<input
						className="menus__colour-hex"
						value={colours.activateColour}
						onChange={(e) => onChange({ ...colours, activateColour: e.target.value })}
						maxLength={7}
					/>
				</div>
				<div className="menus__colour-row">
					<label className="text-muted">Opacity</label>
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						value={colours.activateOpacity}
						onChange={(e) => onChange({ ...colours, activateOpacity: Number(e.target.value) })}
					/>
					<span className="text-muted">{Math.round(colours.activateOpacity * 100)}%</span>
				</div>
				<div
					className="menus__colour-swatch"
					style={{
						background: colours.activateColour,
						opacity: colours.activateOpacity,
					}}
				/>
			</div>
		</div>
	);
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

function actionToString(action: PlaybackAction | null): string {
	if (!action) return '';
	switch (action.type) {
		case 'playTitle':
			return `playTitle:${action.titleId}`;
		case 'playChapter':
			return `playChapter:${action.titleId}:${action.chapterId}`;
		case 'showMenu':
			return `showMenu:${action.menuId}`;
		case 'stop':
			return 'stop';
	}
}

function stringToAction(
	str: string,
	_titles: { id: string }[],
	_menus: { id: string }[],
): PlaybackAction | null {
	if (!str) return null;
	if (str === 'stop') return { type: 'stop' };
	const parts = str.split(':');
	const type = parts[0];
	if (type === 'playTitle' && parts[1]) return { type: 'playTitle', titleId: parts[1] };
	if (type === 'playChapter' && parts[1] && parts[2])
		return { type: 'playChapter', titleId: parts[1], chapterId: parts[2] };
	if (type === 'showMenu' && parts[1]) return { type: 'showMenu', menuId: parts[1] };
	return null;
}

/** Convert a CSS hex colour + opacity to an rgba() string. */
function hexToRgba(hex: string, opacity: number): string {
	const h = hex.replace('#', '');
	const r = parseInt(h.substring(0, 2), 16) || 0;
	const g = parseInt(h.substring(2, 4), 16) || 0;
	const b = parseInt(h.substring(4, 6), 16) || 0;
	return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
