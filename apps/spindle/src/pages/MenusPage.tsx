// Menus page — unified menu authoring workspace (Set 2b).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState, useEffect, useMemo } from 'react';
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
	const menuEditorMode = useProjectStore((s) => s.menuEditorMode);
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
	const menuConnectionCounts = useMemo(() => computeMenuConnectionCounts(project), [project]);
	const selectedEntry = allMenus.find((e) => e.menu.id === selectedMenuId) ?? null;
	const firstMenuId = allMenus[0]?.menu.id ?? null;
	const activeView = menuEditorMode === 'map' ? 'map' : 'editor';

	useEffect(() => {
		if (!firstMenuId) {
			if (selectedMenuId !== null) setSelectedMenuId(null);
			return;
		}

		if (!selectedEntry) {
			setSelectedMenuId(firstMenuId);
		}
	}, [firstMenuId, selectedEntry, selectedMenuId, setSelectedMenuId]);

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
			<div className="menus-content">
				<aside className="menu-nav">
					<div className="menu-nav__header">
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
							<MiniMenuMap
								project={project}
								selectedMenuId={selectedMenuId}
								onSelect={setSelectedMenuId}
								onExpand={() => setMenuEditorMode('map')}
							/>
						)}
					</div>
				</aside>

				{selectedEntry ? (
					<MenuEditor
						menu={selectedEntry.menu}
						project={project}
						canvasHeight={MENU_HEIGHT[disc.standard]}
						onUpdate={(updater) => handleUpdateMenu(selectedEntry.menu.id, updater)}
						onRemove={() => handleRemoveMenu(selectedEntry.menu.id)}
						onAutoNav={() => autoGenerateMenuNav(selectedEntry.menu.id)}
					/>
				) : (
					<EmptyMenuWorkspace />
				)}
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
	const menuDomainLabel = menu.authoredDocument?.domain === 'vmgm' ? 'VMGM' : 'Titleset';

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
	const defaultFocusId = menu.authoredDocument?.interaction.defaultFocusId ?? menu.defaultButtonId;

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

	return (
		<section className="editor-area">
			<div className={`editor-toolbar ${activeView === 'map' ? 'editor-toolbar--map' : ''}`}>
				<div className="editor-toolbar__left">
					{activeView === 'editor' ? (
						<input
							className="editor-toolbar__name"
							value={menu.name}
							onChange={(e) => onUpdate((m) => ({ ...m, name: e.target.value }))}
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
							<button
								className={`editor-toolbar__toggle ${previewMode ? 'editor-toolbar__toggle--active' : ''}`}
								onClick={() => setPreviewMode(!previewMode)}
								aria-pressed={previewMode}
								title="Navigate with the keyboard"
							>
								Keyboard Nav
							</button>
						</div>
						<div className="editor-toolbar__background">
							<span className="editor-toolbar__field-label">Background</span>
							<select
								className="editor-toolbar__select"
								value={menu.backgroundAssetId ?? ''}
								onChange={(e) => handleBackgroundChange(e.target.value || null)}
								aria-label="Background asset"
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
									className="editor-toolbar__colour-input"
									value={menu.authoredDocument?.scene.background.colour ?? '#000000'}
									onChange={(e) => handleBackgroundColourChange(e.target.value)}
									title="Background colour"
									aria-label="Background colour"
								/>
							)}
						</div>
						<div className="editor-toolbar__actions">
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
				<div className="editor-body">
					<div className="menus__canvas-zone">
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
					</div>

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
