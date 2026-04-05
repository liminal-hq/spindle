// Menus page — scene-document editor with layers, canvas, and inspector.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState, useEffect } from 'react';
import { useProjectStore } from '../store/project-store';
import { useNavigation } from '../App';
import type {
	Menu,
	MenuButton,
	MenuHighlightColours,
	SpindleProjectFile,
	VideoStandard,
	MenuEditorMode,
	SceneNode,
} from '../types/project';
import { DEFAULT_HIGHLIGHT_COLOURS } from '../types/project';
import { SceneCanvas } from '../components/menus/SceneCanvas';
import { LayersPanel } from '../components/menus/LayersPanel';
import { InspectorPanel } from '../components/menus/InspectorPanel';
import { BindMode } from '../components/menus/BindMode';
import { CompileMode } from '../components/menus/CompileMode';
import '../components/menus/SceneEditor.css';

import './MenusPage.css';

// DVD menu canvas dimensions vary by video standard
const MENU_HEIGHT: Record<VideoStandard, number> = { NTSC: 480, PAL: 576 };

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

	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [layersCollapsed, setLayersCollapsed] = useState(false);
	const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
	const [honestPreview, setHonestPreview] = useState(false);

	// Derive the scene nodes from the authoredDocument
	const sceneNodes: SceneNode[] = menu.authoredDocument?.scene.nodes ?? [];

	// Project buttons from authoredDocument (or legacy)
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

	const selectedNode = sceneNodes.find((n) => n.id === selectedNodeId) ?? null;
	const selectedButton = currentButtons.find((b) => b.id === selectedNodeId) ?? null;

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
						highlightMode: 'static' as const,
						highlightKeyframes: [],
						videoAssetId: null,
					},
				],
			};
		});
		setSelectedNodeId(id);
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
		if (selectedNodeId === buttonId) setSelectedNodeId(null);
	};

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

	return (
		<div className="menus__editor">
			{/* Header: name + mode switcher */}
			<div className="card">
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
						<button className="btn btn--sm btn--danger" onClick={onRemove}>
							Delete Menu
						</button>
					</div>
				</div>

				{/* Mode switcher */}
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
			</div>

			{/* Canvas-first scene editor */}
			{menuEditorMode === 'design' || menuEditorMode === 'remote' ? (
				<div className="scene-editor">
					{/* Canvas — full width, the primary workspace */}
					<div className="scene-canvas">
						{/* Background assignment */}
						{menuEditorMode === 'design' && (
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
									<option value="">Solid colour</option>
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
								{!menu.backgroundAssetId && (
									<input
										type="color"
										className="menus__bg-colour-input"
										value={menu.authoredDocument?.scene.background.colour ?? '#000000'}
										onChange={(e) =>
											onUpdate((m) => {
												if (m.authoredDocument) {
													return {
														...m,
														authoredDocument: {
															...m.authoredDocument,
															scene: {
																...m.authoredDocument.scene,
																background: {
																	...m.authoredDocument.scene.background,
																	colour: e.target.value,
																},
															},
														},
													};
												}
												return m;
											})
										}
										title="Background colour"
									/>
								)}
							</div>
						)}

						<SceneCanvas
							buttons={currentButtons}
							canvasHeight={canvasHeight}
							onUpdateButton={handleUpdateButton}
							showSafeArea={showSafeArea}
							backgroundLabel={backgroundAssetLabel}
							backgroundColour={menu.authoredDocument?.scene.background.colour ?? null}
							defaultButtonId={
								menu.authoredDocument?.interaction.defaultFocusId ?? menu.defaultButtonId
							}
							previewMode={previewMode && menuEditorMode === 'remote'}
							highlightColours={highlightColours}
							honestPreview={honestPreview}
							showNavLines={menuEditorMode === 'remote'}
							selectedNodeId={selectedNodeId}
							onSelectNode={setSelectedNodeId}
						/>

						{/* Canvas toolbar */}
						<div className="scene-canvas__toolbar">
							<label className="scene-canvas__toolbar-toggle" title="Show safe-area guides">
								<input
									type="checkbox"
									checked={showSafeArea}
									onChange={(e) => setShowSafeArea(e.target.checked)}
								/>
								Safe Area
							</label>
							<label className="scene-canvas__toolbar-toggle" title="Preview with DVD-safe colour reduction">
								<input
									type="checkbox"
									checked={honestPreview}
									onChange={(e) => setHonestPreview(e.target.checked)}
								/>
								DVD Preview
							</label>
							{menuEditorMode === 'remote' && (
								<label className="scene-canvas__toolbar-toggle" title="Navigate with arrow keys">
									<input
										type="checkbox"
										checked={previewMode}
										onChange={(e) => setPreviewMode(e.target.checked)}
									/>
									Keyboard Nav
								</label>
							)}
						</div>
					</div>

					{/* Secondary panels — layers and inspector below the canvas */}
					<div className="scene-editor__panels">
						<LayersPanel
							nodes={sceneNodes}
							selectedNodeId={selectedNodeId}
							onSelectNode={setSelectedNodeId}
							collapsed={layersCollapsed}
							onToggleCollapse={() => setLayersCollapsed(!layersCollapsed)}
						/>
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
							collapsed={inspectorCollapsed}
							onToggleCollapse={() => setInspectorCollapsed(!inspectorCollapsed)}
						/>
					</div>
				</div>
			) : menuEditorMode === 'bind' ? (
				<div className="card" style={{ padding: 'var(--space-4)' }}>
					<BindMode
						buttons={currentButtons}
						allTitles={allTitles}
						allMenus={allMenus}
						currentMenuId={menu.id}
						defaultFocusId={
							menu.authoredDocument?.interaction.defaultFocusId ?? menu.defaultButtonId
						}
						onUpdateButton={handleUpdateButton}
						onSetDefaultFocus={(btnId) =>
							onUpdate((m) => {
								if (m.authoredDocument) {
									return {
										...m,
										authoredDocument: {
											...m.authoredDocument,
											interaction: {
												...m.authoredDocument.interaction,
												defaultFocusId: btnId,
											},
										},
									};
								}
								return { ...m, defaultButtonId: btnId };
							})
						}
					/>
				</div>
			) : menuEditorMode === 'compile' ? (
				<div className="card" style={{ padding: 'var(--space-4)' }}>
					<CompileMode
						document={menu.authoredDocument ?? null}
						buttons={currentButtons}
						canvasHeight={canvasHeight}
						highlightColours={highlightColours}
						defaultFocusId={
							menu.authoredDocument?.interaction.defaultFocusId ?? menu.defaultButtonId
						}
						backgroundLabel={backgroundAssetLabel}
					/>
				</div>
			) : null}
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
