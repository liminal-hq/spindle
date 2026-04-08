// Menus page — unified menu authoring workspace (Set 2b).
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
	SceneNode,
} from '../types/project';
import { DEFAULT_HIGHLIGHT_COLOURS } from '../types/project';
import { SceneCanvas } from '../components/menus/SceneCanvas';
import { LayersPanel } from '../components/menus/LayersPanel';
import { InspectorPanel } from '../components/menus/InspectorPanel';
import { MiniMenuMap, FullMenuMap } from '../components/menus/MenuMap';
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
	const setMenuEditorMode = useProjectStore((s) => s.setMenuEditorMode);
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
					{/* Left rail — menu list grouped by scope */}
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
									<MenuListItem
										key={menu.id}
										menu={menu}
										isSelected={menu.id === selectedMenuId}
										onSelect={() => setSelectedMenuId(menu.id)}
									/>
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
										<MenuListItem
											key={menu.id}
											menu={menu}
											isSelected={menu.id === selectedMenuId}
											onSelect={() => setSelectedMenuId(menu.id)}
										/>
									))
								)}
							</div>
						))}
					</div>

					{/* Mini navigation map — persistent in left rail */}
					<MiniMenuMap
						project={project}
						selectedMenuId={selectedMenuId}
						onSelect={setSelectedMenuId}
						onExpand={() => setMenuEditorMode('map')}
					/>

					{/* Unified editor workspace */}
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

// ── Menu List Item ──────────────────────────────────────────────────────────

function MenuListItem({
	menu,
	isSelected,
	onSelect,
}: {
	menu: Menu;
	isSelected: boolean;
	onSelect: () => void;
}) {
	const buttonCount = menu.authoredDocument
		? menu.authoredDocument.scene.nodes.filter((n) => n.type === 'button').length
		: menu.buttons.length;

	return (
		<div
			className={`menus__item card ${isSelected ? 'menus__item--selected' : ''}`}
			onClick={onSelect}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => e.key === 'Enter' && onSelect()}
		>
			<span className="menus__item-name">{menu.name}</span>
			<span className="badge badge--neutral">{buttonCount} btn</span>
		</div>
	);
}

// ── Empty State ─────────────────────────────────────────────────────────────

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

// ── Unified Menu Editor ─────────────────────────────────────────────────────

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

	// ── Workspace view: 'editor' or 'map'
	const menuEditorMode = useProjectStore((s) => s.menuEditorMode);
	const setMenuEditorMode = useProjectStore((s) => s.setMenuEditorMode);
	const setSelectedMenuId = useProjectStore((s) => s.setSelectedMenuId);
	// Treat any legacy mode value as 'editor'
	const activeView = menuEditorMode === 'map' ? 'map' : 'editor';

	const previewMode = useProjectStore((s) => s.previewMode);
	const setPreviewMode = useProjectStore((s) => s.setPreviewMode);
	const showSafeArea = useProjectStore((s) => s.showSafeArea);
	const setShowSafeArea = useProjectStore((s) => s.setShowSafeArea);

	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [honestPreview, setHonestPreview] = useState(false);
	const [showNavLines, setShowNavLines] = useState(false);

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
	const defaultFocusId =
		menu.authoredDocument?.interaction.defaultFocusId ?? menu.defaultButtonId;

	const selectedNode = sceneNodes.find((n) => n.id === selectedNodeId) ?? null;
	const selectedButton = currentButtons.find((b) => b.id === selectedNodeId) ?? null;

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
						colour: '#ffffff',
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
							if (
								node.type === 'button' ||
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

	return (
		<div className="menus__editor">
			{/* Toolbar: name + Editor/Map toggle + authoring actions */}
			<div className="menus__toolbar card">
				<div className="menus__toolbar-left">
					<input
						className="menus__editor-name"
						value={menu.name}
						onChange={(e) => onUpdate((m) => ({ ...m, name: e.target.value }))}
						aria-label="Menu name"
					/>
					{/* Editor / Map view toggle */}
					<div className="menus__view-toggle" role="group" aria-label="Workspace view">
						<button
							className={`btn btn--sm ${activeView === 'editor' ? 'btn--primary' : 'btn--ghost'}`}
							onClick={() => setMenuEditorMode('editor')}
						>
							Editor
						</button>
						<button
							className={`btn btn--sm ${activeView === 'map' ? 'btn--primary' : 'btn--ghost'}`}
							onClick={() => setMenuEditorMode('map')}
						>
							Map
						</button>
					</div>
				</div>
				<div className="menus__toolbar-right">
					{activeView === 'editor' && (
						<>
							<button className="btn btn--sm" onClick={handleAddButton}>
								+ Button
							</button>
							<button className="btn btn--sm" onClick={() => handleAddSceneNode('text')}>
								+ Text
							</button>
							<button className="btn btn--sm" onClick={() => handleAddSceneNode('image')}>
								+ Image
							</button>
							<button className="btn btn--sm" onClick={() => handleAddSceneNode('shape')}>
								+ Shape
							</button>
						</>
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

			{/* Workspace */}
			{activeView === 'editor' ? (
				<div className="menus__workspace">
					{/* Canvas zone — primary authoring surface */}
					<div className="menus__canvas-zone">
						{/* Background assignment strip */}
						<div className="menus__bg-select">
							<label className="text-muted">Background:</label>
							<select
								className="menus__select-sm"
								value={menu.backgroundAssetId ?? ''}
								onChange={(e) => handleBackgroundChange(e.target.value || null)}
							>
								<option value="">Solid colour</option>
								{project.assets
									.filter(
										(a) =>
											a.videoStreams.length > 0 ||
											a.fileName.match(/\.(png|jpg|jpeg|bmp|tiff?)$/i),
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
									onChange={(e) => handleBackgroundColourChange(e.target.value)}
									title="Background colour"
								/>
							)}
						</div>

						<SceneCanvas
							buttons={currentButtons}
							sceneNodes={sceneNodes}
							canvasHeight={canvasHeight}
							onUpdateButton={handleUpdateButton}
							onUpdateSceneNode={handleUpdateSceneNode}
							showSafeArea={showSafeArea}
							backgroundLabel={backgroundAssetLabel}
							backgroundColour={menu.authoredDocument?.scene.background.colour ?? null}
							defaultButtonId={defaultFocusId}
							previewMode={previewMode}
							highlightColours={highlightColours}
							honestPreview={honestPreview}
							showNavLines={showNavLines}
							selectedNodeId={selectedNodeId}
							onSelectNode={setSelectedNodeId}
						/>

						{/* Canvas toggles toolbar */}
						<div className="scene-canvas__toolbar">
							<label className="scene-canvas__toolbar-toggle" title="Show safe-area guides">
								<input
									type="checkbox"
									checked={showSafeArea}
									onChange={(e) => setShowSafeArea(e.target.checked)}
								/>
								Safe Area
							</label>
							<label
								className="scene-canvas__toolbar-toggle"
								title="Preview with DVD-safe colour reduction"
							>
								<input
									type="checkbox"
									checked={honestPreview}
									onChange={(e) => setHonestPreview(e.target.checked)}
								/>
								DVD Preview
							</label>
							<label
								className="scene-canvas__toolbar-toggle"
								title="Show navigation direction lines between buttons"
							>
								<input
									type="checkbox"
									checked={showNavLines}
									onChange={(e) => setShowNavLines(e.target.checked)}
								/>
								Nav Lines
							</label>
							<label
								className="scene-canvas__toolbar-toggle"
								title="Navigate with arrow keys (remote preview)"
							>
								<input
									type="checkbox"
									checked={previewMode}
									onChange={(e) => setPreviewMode(e.target.checked)}
								/>
								Keyboard Nav
							</label>
						</div>
					</div>

					{/* Side panel — layers and inspector */}
					<div className="menus__side-panel">
						<LayersPanel
							nodes={sceneNodes}
							selectedNodeId={selectedNodeId}
							onSelectNode={setSelectedNodeId}
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
							onUpdateSceneNode={handleUpdateSceneNode}
							onRemoveNode={handleRemoveNode}
							assets={project.assets}
							buttons={currentButtons}
							interactionNodes={menu.authoredDocument?.interaction.nodes ?? []}
							defaultFocusId={defaultFocusId}
							document={menu.authoredDocument ?? null}
							canvasHeight={canvasHeight}
							onSetDefaultFocus={handleSetDefaultFocus}
						/>
					</div>
				</div>
			) : (
				/* Map view — full navigation graph */
				<FullMenuMap
					project={project}
					selectedMenuId={menu.id}
					onSelectMenu={setSelectedMenuId}
					onOpenInEditor={(id) => {
						setSelectedMenuId(id);
						setMenuEditorMode('editor');
					}}
				/>
			)}
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
