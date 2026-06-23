// Inspector panel — contextual property editor for the selected scene node.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type {
	SceneNode,
	MenuButton,
	MenuHighlightColours,
	Title,
	Menu,
	Asset,
	MenuDocument,
	FocusNode,
	AspectMode,
	FontEntry,
} from '../../types/project';
import { LayersPanel } from './LayersPanel';
import { CollapsibleSection } from './InspectorCollapsibleSection';
import { MenuLevelInspector } from './MenuLevelInspector';
import { ButtonInspector } from './ButtonInspector';
import {
	TextNodeInspector,
	ImageNodeInspector,
	ShapeNodeInspector,
	GenericNodeInspector,
} from './SceneNodeInspectors';
import { getInspectorTitle, getInspectorSubtitle } from './inspectorHelpers';

export interface InspectorPanelProps {
	selectedNode: SceneNode | null;
	/** The corresponding MenuButton projection for the selected node (buttons only). */
	selectedButton: MenuButton | null;
	highlightColours: MenuHighlightColours;
	allTitles: Title[];
	allMenus: Menu[];
	currentMenuId: string;
	onUpdateButton: (buttonId: string, updates: Partial<MenuButton>) => void;
	onUpdateHighlightColours: (colours: MenuHighlightColours) => void;
	onRemoveButton: (buttonId: string) => void;
	/** Update a non-button scene node's properties. */
	onUpdateSceneNode?: (nodeId: string, updates: Record<string, unknown>) => void;
	/** Remove any scene node. */
	onRemoveNode?: (nodeId: string) => void;
	/** Available assets for image node picker. */
	assets?: Asset[];

	// ── Unified editor additions ─────────────────────────────────────────────

	/** All button projections in this menu (for Navigation section and diagnostics). */
	buttons?: MenuButton[];
	/** Interaction graph nodes (for navigation editing source of truth). */
	interactionNodes?: FocusNode[];
	/** Current default focus button ID. */
	defaultFocusId?: string | null;
	/** Full authored document (for diagnostics and compile policy). */
	document?: MenuDocument | null;
	/** Scene nodes for the layer stack embedded in the inspector rail. */
	sceneNodes?: SceneNode[];
	/** Current selected scene node ID. */
	selectedNodeId?: string | null;
	/** Select a node from the layer stack. */
	onSelectSceneNode?: (nodeId: string | null) => void;
	/** DVD canvas height for diagnostic context. */
	canvasHeight?: number;
	/** Set the default focus to a button. */
	onSetDefaultFocus?: (buttonId: string) => void;
	/** Current menu context for menu-level controls. */
	menu?: Menu | null;
	/** Update the menu background asset reference. */
	onUpdateBackgroundAsset?: (assetId: string | null) => void;
	/** Update the menu background colour. */
	onUpdateBackgroundColour?: (colour: string) => void;
	/** Toggle still vs motion background mode. */
	onUpdateBackgroundMode?: (mode: 'still' | 'motion') => void;
	/** Update the optional motion-menu audio bed. */
	onUpdateMotionAudioAsset?: (assetId: string | null) => void;
	/** Update the motion menu loop duration. */
	onUpdateMotionDurationSecs?: (secs: number | null) => void;
	/** Update the motion menu loop count. */
	onUpdateMotionLoopCount?: (count: number) => void;
	/** Run automatic navigation generation for the current menu. */
	onAutoNav?: () => void;
	/** Export a DAR-corrected render preview PNG for the current menu. */
	onExportRenderPreview?: () => void;
	/** Canvas preview state for the selected button. */
	buttonPreviewState?: 'normal' | 'focus' | 'activate';
	/** Update the canvas preview state for the selected button. */
	onButtonPreviewStateChange?: (state: 'normal' | 'focus' | 'activate') => void;
	/** Current authored DVD display aspect for this menu. */
	displayAspect?: AspectMode;
	/** Update the authored DVD display aspect for the current menu. */
	onDisplayAspectChange?: (aspect: AspectMode) => void;
	/** Fonts available to the Skia renderer for this project, from `list_available_fonts`. */
	availableFonts?: FontEntry[];
}

export function InspectorPanel({
	selectedNode,
	selectedButton,
	highlightColours,
	allTitles,
	allMenus,
	currentMenuId,
	onUpdateButton,
	onUpdateHighlightColours,
	onRemoveButton,
	onUpdateSceneNode,
	onRemoveNode,
	assets,
	buttons,
	interactionNodes,
	defaultFocusId,
	document,
	sceneNodes,
	selectedNodeId,
	onSelectSceneNode,
	canvasHeight,
	onSetDefaultFocus,
	menu,
	onUpdateBackgroundAsset,
	onUpdateBackgroundColour,
	onUpdateBackgroundMode,
	onUpdateMotionAudioAsset,
	onUpdateMotionDurationSecs,
	onUpdateMotionLoopCount,
	onAutoNav,
	onExportRenderPreview,
	buttonPreviewState,
	onButtonPreviewStateChange,
	displayAspect,
	onDisplayAspectChange,
	availableFonts,
}: InspectorPanelProps) {
	const inspectorTitle = getInspectorTitle(selectedNode, selectedButton);
	const inspectorSubtitle = getInspectorSubtitle(selectedNode, selectedButton, buttons);

	return (
		<div className="inspector-panel">
			<div className="inspector-panel__header">
				<div className="inspector-panel__header-copy">
					<h4 className="inspector-panel__title">{inspectorTitle}</h4>
					<p className="inspector-panel__subtitle">{inspectorSubtitle}</p>
				</div>
			</div>
			<div className="inspector-panel__body">
				{sceneNodes && onSelectSceneNode && (
					<CollapsibleSection title="Layers" defaultOpen={false}>
						<LayersPanel
							nodes={sceneNodes}
							selectedNodeId={selectedNodeId ?? null}
							onSelectNode={onSelectSceneNode}
							showHeader={false}
						/>
					</CollapsibleSection>
				)}
				{!selectedNode ? (
					// When nothing is selected and menu-level context is provided,
					// show the menu-level inspector. Otherwise show the selection prompt.
					buttons !== undefined ? (
						<MenuLevelInspector
							buttons={buttons}
							interactionNodes={interactionNodes ?? []}
							document={document ?? null}
							highlightColours={highlightColours}
							defaultFocusId={defaultFocusId ?? null}
							canvasHeight={canvasHeight ?? 480}
							allTitles={allTitles}
							allMenus={allMenus}
							currentMenuId={currentMenuId}
							menuDomain={menu?.authoredDocument?.domain}
							onUpdateHighlightColours={onUpdateHighlightColours}
							onSetDefaultFocus={onSetDefaultFocus}
							onUpdateButton={onUpdateButton}
							menu={menu ?? null}
							assets={assets ?? []}
							onUpdateBackgroundAsset={onUpdateBackgroundAsset}
							onUpdateBackgroundColour={onUpdateBackgroundColour}
							onUpdateBackgroundMode={onUpdateBackgroundMode}
							onUpdateMotionAudioAsset={onUpdateMotionAudioAsset}
							onUpdateMotionDurationSecs={onUpdateMotionDurationSecs}
							onUpdateMotionLoopCount={onUpdateMotionLoopCount}
							onAutoNav={onAutoNav}
							onExportRenderPreview={onExportRenderPreview}
							displayAspect={displayAspect ?? 'four-by-three'}
							onDisplayAspectChange={onDisplayAspectChange}
						/>
					) : (
						<div className="inspector-panel__empty text-muted">
							Select a node to inspect its properties.
						</div>
					)
				) : selectedNode.type === 'button' && selectedButton ? (
					<ButtonInspector
						button={selectedButton}
						buttonNode={selectedNode}
						buttons={buttons ?? []}
						defaultFocusId={defaultFocusId ?? null}
						highlightColours={highlightColours}
						allTitles={allTitles}
						allMenus={allMenus}
						currentMenuId={currentMenuId}
						menuDomain={menu?.authoredDocument?.domain}
						onUpdateButton={onUpdateButton}
						onUpdateHighlightColours={onUpdateHighlightColours}
						onRemoveButton={onRemoveButton}
						onSetDefaultFocus={onSetDefaultFocus}
						onUpdateSceneNode={onUpdateSceneNode}
						buttonPreviewState={buttonPreviewState ?? 'normal'}
						onButtonPreviewStateChange={onButtonPreviewStateChange}
						availableFonts={availableFonts}
					/>
				) : selectedNode.type === 'text' ? (
					<TextNodeInspector
						node={selectedNode}
						onUpdate={onUpdateSceneNode}
						onRemove={onRemoveNode}
						availableFonts={availableFonts}
					/>
				) : selectedNode.type === 'image' ? (
					<ImageNodeInspector
						node={selectedNode}
						assets={assets}
						onUpdate={onUpdateSceneNode}
						onRemove={onRemoveNode}
					/>
				) : selectedNode.type === 'shape' ? (
					<ShapeNodeInspector
						node={selectedNode}
						onUpdate={onUpdateSceneNode}
						onRemove={onRemoveNode}
					/>
				) : (
					<GenericNodeInspector node={selectedNode} />
				)}
			</div>
		</div>
	);
}
