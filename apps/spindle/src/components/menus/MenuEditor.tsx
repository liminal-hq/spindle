// The unified per-menu editor: toolbar, scene canvas + tool palette, inspector
// panel, and the full navigation-map view for one menu.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { exportMenuRenderPreview, listAvailableFonts } from 'tauri-plugin-spindle-project-api';
import { useProjectStore } from '../../store/project-store';
import type { DisplayDensity } from '../../hooks/useDisplayDensity';
import type {
	AspectMode,
	FontEntry,
	Menu,
	MenuButton,
	MenuHighlightColours,
	MenuRole,
	SpindleProjectFile,
	SceneNode,
} from '../../types/project';
import {
	DEFAULT_HIGHLIGHT_COLOURS,
	createDefaultMenuCompilePolicy,
	inferDefaultMenuDisplayAspect,
} from '../../types/project';
import { SceneCanvas } from './SceneCanvas';
import { InspectorPanel } from './InspectorPanel';
import { FullMenuMap } from './MenuMap';
import { DEFAULT_BUTTON_STYLE_MAP, DEFAULT_TEXT_STYLE } from './menuDefaults';
import { getMenuButtons } from './menuProjectHelpers';
import { useFormatProfile } from '../../format/useFormatProfile';
import { terminologyFor } from '../../format/terminology';
import './SceneEditor.css';

function resolveMenuDisplayAspect(project: SpindleProjectFile, menu: Menu): AspectMode {
	return (
		menu.authoredDocument?.compilePolicy.displayAspect ??
		inferDefaultMenuDisplayAspect(project, {
			menuId: menu.id,
			domain: menu.authoredDocument?.domain ?? 'vmgm',
		})
	);
}

export interface MenuEditorProps {
	menu: Menu;
	project: SpindleProjectFile;
	canvasHeight: number;
	onUpdate: (updater: (m: Menu) => Menu) => void;
	onRemove: () => void;
	onAutoNav: () => void;
	density: Omit<DisplayDensity, 'containerRef'>;
	railIsOverlay: boolean;
	railVisible: boolean;
	onOpenRail: () => void;
}

export function MenuEditor({
	menu,
	project,
	canvasHeight,
	onUpdate,
	onRemove,
	onAutoNav,
	density,
	railIsOverlay,
	railVisible,
	onOpenRail,
}: MenuEditorProps) {
	const handleExportRenderPreview = useCallback(async () => {
		const outputPath = await save({
			title: 'Export Render Preview',
			filters: [{ name: 'PNG Image', extensions: ['png'] }],
			defaultPath: `${menu.name.replace(/[^a-z0-9_-]/gi, '_')}_preview.png`,
		});
		if (!outputPath) return;
		try {
			await exportMenuRenderPreview(project, menu.id, outputPath);
		} catch (err) {
			console.error('[MenuEditor] export_menu_render_preview failed', err);
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
	const formatProfile = useFormatProfile(project.disc.family);
	const terminology = terminologyFor(project.disc.family);
	const menuRole = menu.authoredDocument?.role ?? 'title-select';
	const menuDomainLabel = terminology.menuRole[menuRole];

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
		listAvailableFonts(project)
			.then((fonts) => {
				if (!cancelled) setAvailableFonts(fonts);
			})
			.catch((err) => {
				console.error('[MenuEditor] list_available_fonts failed', err);
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

	// Derive the scene nodes and button projections from authoredDocument,
	// which is guaranteed present for any menu loaded via parseProject or
	// created in-app (see MenusPage's createMenu).
	const sceneNodes: SceneNode[] = menu.authoredDocument?.scene.nodes ?? [];
	// `getMenuButtons` is the single "what counts as a button" join (scene
	// button node + its interaction-graph focus node), shared with
	// `menuProjectHelpers`'s connection-count computation and the Rust
	// `MenuDocument::buttons()` it mirrors — this used to be duplicated here.
	const currentButtons: MenuButton[] = getMenuButtons(menu);

	const backgroundAssetId = menu.authoredDocument?.scene.background.assetId ?? null;
	const backgroundAsset = backgroundAssetId
		? (project.assets.find((a) => a.id === backgroundAssetId) ?? null)
		: null;
	const backgroundAssetLabel = backgroundAsset ? backgroundAsset.fileName : null;
	const highlightColours = menu.authoredDocument?.highlightColours ?? DEFAULT_HIGHLIGHT_COLOURS;
	const defaultFocusId = menu.authoredDocument?.interaction.defaultFocusId ?? null;
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
		const btnCount = currentButtons.length;
		const label = `Button ${btnCount + 1}`;
		const x = 100 + btnCount * 20;
		const y = Math.min(300 + btnCount * 20, canvasHeight - 60);

		updateMenuDocument(menu.id, (document) => ({
			...document,
			scene: {
				...document.scene,
				nodes: [
					...document.scene.nodes,
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
				...document.interaction,
				nodes: [
					...document.interaction.nodes,
					{ nodeId: id, navUp: null, navDown: null, navLeft: null, navRight: null, action: null },
				],
			},
		}));
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
		updateMenuDocument(menu.id, (document) => ({
			...document,
			scene: {
				...document.scene,
				nodes: document.scene.nodes.map((node) => {
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
				}),
			},
			interaction: {
				...document.interaction,
				nodes: document.interaction.nodes.map((node) => {
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
				}),
			},
		}));
	};

	const handleRemoveButton = (buttonId: string) => {
		updateMenuDocument(menu.id, (document) => ({
			...document,
			scene: {
				...document.scene,
				nodes: document.scene.nodes.filter((n) => n.id !== buttonId),
			},
			interaction: {
				...document.interaction,
				nodes: document.interaction.nodes
					.filter((n) => n.nodeId !== buttonId)
					// Clear any surviving nav_* link that pointed at the
					// deleted button — otherwise it's left dangling and only
					// surfaces later as a `menu.dangling-nav-ref` validation
					// error, instead of being cleaned up at delete time.
					.map((n) => ({
						...n,
						navUp: n.navUp === buttonId ? null : n.navUp,
						navDown: n.navDown === buttonId ? null : n.navDown,
						navLeft: n.navLeft === buttonId ? null : n.navLeft,
						navRight: n.navRight === buttonId ? null : n.navRight,
					})),
				defaultFocusId:
					document.interaction.defaultFocusId === buttonId
						? null
						: document.interaction.defaultFocusId,
			},
		}));
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
		updateMenuDocument(menu.id, (document) => ({ ...document, highlightColours: colours }));
	};

	// Set default focus — updates authoredDocument interaction graph
	const handleSetDefaultFocus = (buttonId: string) => {
		updateMenuDocument(menu.id, (document) => ({
			...document,
			interaction: { ...document.interaction, defaultFocusId: buttonId },
		}));
	};

	// ── Background assignment (kept in canvas toolbar for now)

	const handleBackgroundChange = (newAssetId: string | null) => {
		updateMenuDocument(menu.id, (document) => ({
			...document,
			scene: {
				...document.scene,
				background: { ...document.scene.background, assetId: newAssetId },
			},
		}));
	};

	const handleBackgroundColourChange = (colour: string) => {
		updateMenuDocument(menu.id, (document) => ({
			...document,
			scene: { ...document.scene, background: { ...document.scene.background, colour } },
		}));
	};

	const handleBackgroundModeChange = (mode: 'still' | 'motion') => {
		updateMenuDocument(menu.id, (document) => ({ ...document, backgroundMode: mode }));
	};

	const handleMotionAudioChange = (assetId: string | null) => {
		updateMenuDocument(menu.id, (document) => ({
			...document,
			timing: { ...document.timing, audioAssetId: assetId },
		}));
	};

	const handleMotionDurationChange = (secs: number | null) => {
		// A cleared input writes the unset sentinel (0.0) rather than
		// snapping back to the previous value — `MenuDocument::motion_loop_duration`
		// on the Rust side already treats `<= 0.0` as "not authored".
		updateMenuDocument(menu.id, (document) => ({
			...document,
			timing: { ...document.timing, loopDurationSecs: secs ?? 0.0 },
		}));
	};

	const handleMotionLoopCountChange = (count: number) => {
		updateMenuDocument(menu.id, (document) => ({
			...document,
			timing: { ...document.timing, loopCount: count },
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

	const handleRoleChange = (role: MenuRole) => {
		updateMenuDocument(menu.id, (document) => ({ ...document, role }));
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
								<span
									className="editor-toolbar__format-badge"
									title={`${formatProfile.displayName} · ${project.disc.standard} · ${displayAspect === 'sixteen-by-nine' ? '16:9 anamorphic' : '4:3'}`}
								>
									{formatProfile.displayName}
								</span>
								<span className="editor-toolbar__separator">|</span>
								<span>{currentButtons.length} buttons</span>
								<span className="editor-toolbar__separator">|</span>
								<span>{menuDomainLabel}</span>
								<span className="editor-toolbar__separator">|</span>
								<span>{displayAspect === 'sixteen-by-nine' ? '16:9 anamorphic' : '4:3'}</span>
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
								title={`Toggle ${terminology.compilePreviewLabel.toLowerCase()}`}
							>
								<span className="editor-toolbar__toggle-dot" aria-hidden="true" />
								{terminology.compilePreviewLabel}
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
								formatProfile={formatProfile}
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
								formatProfile={formatProfile}
								onUpdateRole={handleRoleChange}
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
