// Inspector panel — contextual property editor for the selected scene node.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import type {
	SceneNode,
	MenuButton,
	MenuHighlightColours,
	PlaybackAction,
	Title,
	Menu,
	Asset,
	MenuDocument,
	FocusNode,
	ButtonStyleMap,
	ButtonStateStyle,
	TextStyle,
	AspectMode,
	FontEntry,
} from '../../types/project';
import { LayersPanel } from './LayersPanel';

/** DVD constraint thresholds (shared with compile diagnostics). */
const MAX_DVD_BUTTONS = 36;

const DEFAULT_BUTTON_STATE_STYLE: ButtonStateStyle = {
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
};

const DEFAULT_BUTTON_STYLE_MAP: ButtonStyleMap = {
	normal: DEFAULT_BUTTON_STATE_STYLE,
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

// ── Menu-level Inspector ───────────────────────────────────────────────────
// Shown when no node is selected; surfaces diagnostics, batch audit, and
// CLUT palette — capabilities previously split across Bind and Compile modes.

function MenuLevelInspector({
	buttons,
	document,
	highlightColours,
	defaultFocusId,
	// canvasHeight reserved for future safe-area bounds diagnostics
	allTitles,
	allMenus,
	currentMenuId,
	onUpdateHighlightColours,
	onSetDefaultFocus,
	onUpdateButton,
	menu,
	assets,
	onUpdateBackgroundAsset,
	onUpdateBackgroundColour,
	onUpdateBackgroundMode,
	onUpdateMotionAudioAsset,
	onUpdateMotionDurationSecs,
	onUpdateMotionLoopCount,
	onAutoNav,
	onExportRenderPreview,
	displayAspect,
	onDisplayAspectChange,
}: {
	buttons: MenuButton[];
	interactionNodes: FocusNode[];
	document: MenuDocument | null;
	highlightColours: MenuHighlightColours;
	defaultFocusId: string | null;
	canvasHeight: number;
	allTitles: Title[];
	allMenus: Menu[];
	currentMenuId: string;
	onUpdateHighlightColours: (colours: MenuHighlightColours) => void;
	onSetDefaultFocus?: (buttonId: string) => void;
	onUpdateButton: (buttonId: string, updates: Partial<MenuButton>) => void;
	menu: Menu | null;
	assets: Asset[];
	onUpdateBackgroundAsset?: (assetId: string | null) => void;
	onUpdateBackgroundColour?: (colour: string) => void;
	onUpdateBackgroundMode?: (mode: 'still' | 'motion') => void;
	onUpdateMotionAudioAsset?: (assetId: string | null) => void;
	onUpdateMotionDurationSecs?: (secs: number | null) => void;
	onUpdateMotionLoopCount?: (count: number) => void;
	onAutoNav?: () => void;
	onExportRenderPreview?: () => void;
	displayAspect: AspectMode;
	onDisplayAspectChange?: (aspect: AspectMode) => void;
}) {
	const diagnostics = computeDiagnostics(document, buttons);
	const backgroundAssets = assets.filter(
		(asset) =>
			asset.videoStreams.length > 0 || asset.fileName.match(/\.(png|jpg|jpeg|bmp|tiff?)$/i),
	);
	const audioAssets = assets.filter((asset) => asset.audioStreams.length > 0);
	const [backgroundTab, setBackgroundTab] = useState<'solid' | 'image' | 'video' | 'audio'>(
		menu?.backgroundMode === 'motion' ? 'video' : 'solid',
	);

	return (
		<div className="inspector-panel__section-group">
			<CollapsibleSection title="Diagnostics" defaultOpen>
				{diagnostics.length === 0 ? (
					<p className="inspector-panel__hint" style={{ color: 'var(--colour-success, #4ade80)' }}>
						No issues — menu is DVD-safe.
					</p>
				) : (
					<div className="inspector-panel__diagnostic-list">
						{diagnostics.map((d, i) => (
							<div
								key={i}
								className={`inspector-panel__diagnostic inspector-panel__diagnostic--${d.severity}`}
							>
								<span className="inspector-panel__diagnostic-badge">
									{d.severity === 'error' ? 'ERR' : d.severity === 'warning' ? 'WARN' : 'INFO'}
								</span>
								<span>{d.message}</span>
							</div>
						))}
					</div>
				)}
			</CollapsibleSection>

			{menu && (
				<CollapsibleSection title="Background" defaultOpen>
					<div className="inspector-panel__state-tabs">
						{(
							[
								['solid', 'Solid'],
								['image', 'Image'],
								['video', 'Video'],
								['audio', 'Audio'],
							] as const
						).map(([tab, label]) => (
							<button
								key={tab}
								className={`inspector-panel__state-tab ${backgroundTab === tab ? 'inspector-panel__state-tab--active' : ''}`}
								type="button"
								onClick={() => setBackgroundTab(tab)}
							>
								{label}
							</button>
						))}
					</div>

					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">Mode</span>
						<div className="inspector-panel__style-pills">
							{(['still', 'motion'] as const).map((mode) => (
								<button
									key={mode}
									type="button"
									className={`inspector-panel__style-pill ${menu.backgroundMode === mode ? 'inspector-panel__style-pill--active' : ''}`}
									onClick={() => onUpdateBackgroundMode?.(mode)}
									title={mode === 'still' ? 'Still background' : 'Motion background'}
								>
									{mode === 'still' ? 'Still' : 'Motion'}
								</button>
							))}
						</div>
					</label>

					{backgroundTab === 'solid' && (
						<label className="inspector-panel__field">
							<span className="inspector-panel__field-label">Colour</span>
							<div className="inspector-panel__colour-row">
								<input
									type="color"
									className="inspector-panel__colour-input"
									value={document?.scene.background.colour ?? '#0f0e1a'}
									onChange={(e) => onUpdateBackgroundColour?.(e.target.value)}
								/>
								<input
									className="inspector-panel__input inspector-panel__input--hex"
									value={document?.scene.background.colour ?? '#0f0e1a'}
									onChange={(e) => onUpdateBackgroundColour?.(e.target.value)}
									maxLength={7}
								/>
							</div>
						</label>
					)}

					{(backgroundTab === 'image' || backgroundTab === 'video') && (
						<label className="inspector-panel__field">
							<span className="inspector-panel__field-label">
								{backgroundTab === 'image' ? 'Background asset' : 'Video loop'}
							</span>
							<select
								className="inspector-panel__select"
								value={menu.backgroundAssetId ?? ''}
								onChange={(e) => onUpdateBackgroundAsset?.(e.target.value || null)}
							>
								<option value="">
									{backgroundTab === 'image' ? 'No background asset' : 'No motion video'}
								</option>
								{backgroundAssets.map((asset) => (
									<option key={asset.id} value={asset.id}>
										{asset.fileName}
									</option>
								))}
							</select>
						</label>
					)}

					{backgroundTab === 'audio' && (
						<label className="inspector-panel__field">
							<span className="inspector-panel__field-label">Audio bed</span>
							<select
								className="inspector-panel__select"
								value={menu.motionAudioAssetId ?? ''}
								onChange={(e) => onUpdateMotionAudioAsset?.(e.target.value || null)}
								disabled={menu.backgroundMode !== 'motion'}
							>
								<option value="">No background audio</option>
								{audioAssets.map((asset) => (
									<option key={asset.id} value={asset.id}>
										{asset.fileName}
									</option>
								))}
							</select>
						</label>
					)}

					<div
						className={`inspector-panel__fieldset ${menu.backgroundMode !== 'motion' ? 'inspector-panel__fieldset--disabled' : ''}`}
					>
						<div className="inspector-panel__sub-label">Motion Settings</div>
						<p className="inspector-panel__hint text-muted">
							These controls preserve authored intent, but motion-menu build and runtime support are
							still blocked until the next backend slice lands.
						</p>
						<div className="inspector-panel__grid-2">
							<label className="inspector-panel__field">
								<span className="inspector-panel__field-label">Duration</span>
								<div className="inspector-panel__inline-unit">
									<input
										className="inspector-panel__input inspector-panel__input--num"
										type="number"
										min="0"
										step="0.5"
										value={menu.motionDurationSecs ?? ''}
										onChange={(e) =>
											onUpdateMotionDurationSecs?.(
												e.target.value === '' ? null : Number(e.target.value),
											)
										}
										disabled={menu.backgroundMode !== 'motion'}
									/>
									<span className="inspector-panel__unit">s</span>
								</div>
							</label>
							<label className="inspector-panel__field">
								<span className="inspector-panel__field-label">Loops</span>
								<div className="inspector-panel__inline-unit">
									<input
										className="inspector-panel__input inspector-panel__input--num"
										type="number"
										min="0"
										value={menu.motionLoopCount}
										onChange={(e) => onUpdateMotionLoopCount?.(Number(e.target.value))}
										disabled={menu.backgroundMode !== 'motion'}
									/>
									<span className="inspector-panel__unit">x</span>
								</div>
							</label>
						</div>
						<label className="inspector-panel__field">
							<span className="inspector-panel__field-label">Audio asset</span>
							<select
								className="inspector-panel__select"
								value={menu.motionAudioAssetId ?? ''}
								onChange={(e) => onUpdateMotionAudioAsset?.(e.target.value || null)}
								disabled={menu.backgroundMode !== 'motion'}
							>
								<option value="">No background audio</option>
								{audioAssets.map((asset) => (
									<option key={asset.id} value={asset.id}>
										{asset.fileName}
									</option>
								))}
							</select>
						</label>
					</div>
				</CollapsibleSection>
			)}

			<CollapsibleSection title="Display" defaultOpen>
				<p className="inspector-panel__hint text-muted">
					Choose how this 720-line DVD menu should display on the player: classic 4:3 or anamorphic
					16:9.
				</p>
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Display shape</span>
					<div className="inspector-panel__style-pills">
						{(
							[
								['four-by-three', '4:3'],
								['sixteen-by-nine', '16:9'],
							] as const
						).map(([aspect, label]) => (
							<button
								key={aspect}
								type="button"
								className={`inspector-panel__style-pill ${displayAspect === aspect ? 'inspector-panel__style-pill--active' : ''}`}
								onClick={() => onDisplayAspectChange?.(aspect)}
							>
								{label}
							</button>
						))}
					</div>
				</label>
				<p className="inspector-panel__hint text-muted">
					16:9 here is anamorphic DVD output of the same raster, not a larger canvas.
				</p>
			</CollapsibleSection>

			{/* All Buttons Audit — batch action and default-focus overview */}
			{buttons.length > 0 && (
				<CollapsibleSection title="All Buttons" defaultOpen>
					<p className="inspector-panel__hint text-muted">
						Action bindings and default focus for all buttons in this menu.
					</p>
					<div className="inspector-panel__audit-table">
						{buttons.map((btn) => {
							const isDefault = defaultFocusId === btn.id;
							return (
								<div key={btn.id} className="inspector-panel__audit-row">
									<span
										className={`inspector-panel__audit-name ${isDefault ? 'inspector-panel__audit-name--default' : ''}`}
										title={isDefault ? 'Default focus' : undefined}
									>
										{btn.label}
										{isDefault && (
											<span className="inspector-panel__default-badge" title="Default focus">
												◆
											</span>
										)}
									</span>
									<select
										className="inspector-panel__select inspector-panel__select--sm"
										value={actionToString(btn.action)}
										onChange={(e) =>
											onUpdateButton(btn.id, { action: stringToAction(e.target.value) })
										}
									>
										<ActionOptions
											allTitles={allTitles}
											allMenus={allMenus}
											currentMenuId={currentMenuId}
										/>
									</select>
									{onSetDefaultFocus && !isDefault && (
										<button
											className="btn btn--ghost btn--xs"
											onClick={() => onSetDefaultFocus(btn.id)}
											title="Set as default focus"
										>
											◎
										</button>
									)}
								</div>
							);
						})}
					</div>
				</CollapsibleSection>
			)}

			{/* Compile Policy */}
			{document && (
				<CollapsibleSection title="Compile Policy" defaultOpen>
					<div className="inspector-panel__policy-grid">
						<div className="inspector-panel__policy-item">
							<span className="inspector-panel__field-label">Display</span>
							<span className="inspector-panel__policy-value">
								{document.compilePolicy.displayAspect === 'sixteen-by-nine'
									? '16:9 anamorphic DVD'
									: '4:3 DVD'}
							</span>
						</div>
						<div className="inspector-panel__policy-item">
							<span className="inspector-panel__field-label">Safe Area</span>
							<span className="inspector-panel__policy-value">
								{document.compilePolicy.safeAreaMode}
							</span>
						</div>
						<div className="inspector-panel__policy-item">
							<span className="inspector-panel__field-label">Palette</span>
							<span className="inspector-panel__policy-value">
								{document.compilePolicy.paletteStrategy}
							</span>
						</div>
						<div className="inspector-panel__policy-item">
							<span className="inspector-panel__field-label">Background</span>
							<span className="inspector-panel__policy-value">{document.backgroundMode}</span>
						</div>
					</div>
				</CollapsibleSection>
			)}

			{/* CLUT Palette — DVD subpicture highlight colours */}
			<CollapsibleSection title="CLUT Palette" defaultOpen>
				<p className="inspector-panel__hint text-muted">
					DVD subpicture overlays use a 4-colour palette. These colours apply to all buttons in this
					menu.
				</p>
				<HighlightColourFields colours={highlightColours} onChange={onUpdateHighlightColours} />
			</CollapsibleSection>

			{onAutoNav && (
				<CollapsibleSection title="Navigation Tools" defaultOpen>
					<p className="inspector-panel__hint text-muted">
						Generate a first-pass remote-navigation graph for the current menu.
					</p>
					<div className="inspector-panel__actions-row">
						<button className="btn btn--sm btn--ghost" type="button" onClick={onAutoNav}>
							Auto Nav
						</button>
					</div>
				</CollapsibleSection>
			)}

			{onExportRenderPreview && document && (
				<CollapsibleSection title="Render Preview" defaultOpen>
					<p className="inspector-panel__hint text-muted">
						Export a DAR-corrected PNG showing what this menu will look like after encode, without
						running a full build.
					</p>
					<div className="inspector-panel__actions-row">
						<button
							className="btn btn--sm btn--ghost"
							type="button"
							onClick={onExportRenderPreview}
						>
							Export Render Preview
						</button>
					</div>
				</CollapsibleSection>
			)}
		</div>
	);
}

// ── Button Inspector ───────────────────────────────────────────────────────

function ButtonInspector({
	button,
	buttonNode,
	buttons,
	defaultFocusId,
	highlightColours,
	allTitles,
	allMenus,
	currentMenuId,
	onUpdateButton,
	onUpdateHighlightColours,
	onRemoveButton,
	onSetDefaultFocus,
	onUpdateSceneNode,
	buttonPreviewState,
	onButtonPreviewStateChange,
	availableFonts,
}: {
	button: MenuButton;
	buttonNode: Extract<SceneNode, { type: 'button' }>;
	buttons: MenuButton[];
	defaultFocusId: string | null;
	highlightColours: MenuHighlightColours;
	allTitles: Title[];
	allMenus: Menu[];
	currentMenuId: string;
	onUpdateButton: (buttonId: string, updates: Partial<MenuButton>) => void;
	onUpdateHighlightColours: (colours: MenuHighlightColours) => void;
	onRemoveButton: (buttonId: string) => void;
	onSetDefaultFocus?: (buttonId: string) => void;
	onUpdateSceneNode?: (nodeId: string, updates: Record<string, unknown>) => void;
	buttonPreviewState: 'normal' | 'focus' | 'activate';
	onButtonPreviewStateChange?: (state: 'normal' | 'focus' | 'activate') => void;
	availableFonts?: FontEntry[];
}) {
	const isDefault = defaultFocusId === button.id;

	return (
		<div className="inspector-panel__section-group">
			{/* Identity */}
			<CollapsibleSection title="Button" defaultOpen>
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Label</span>
					<input
						className="inspector-panel__input"
						value={button.label}
						onChange={(e) => onUpdateButton(button.id, { label: e.target.value })}
					/>
				</label>
				{/* Explicit default focus control */}
				<div className="inspector-panel__default-focus-row">
					{isDefault ? (
						<span className="inspector-panel__default-focus-badge">Default focus ◆</span>
					) : onSetDefaultFocus ? (
						<button className="btn btn--ghost btn--sm" onClick={() => onSetDefaultFocus(button.id)}>
							Set as default focus
						</button>
					) : null}
				</div>
			</CollapsibleSection>

			{/* Geometry */}
			<CollapsibleSection title="Transform" defaultOpen>
				<div className="inspector-panel__grid-2">
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">X</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={button.bounds.x}
							onChange={(e) =>
								onUpdateButton(button.id, {
									bounds: { ...button.bounds, x: Number(e.target.value) },
								})
							}
						/>
					</label>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">Y</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={button.bounds.y}
							onChange={(e) =>
								onUpdateButton(button.id, {
									bounds: { ...button.bounds, y: Number(e.target.value) },
								})
							}
						/>
					</label>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">W</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={button.bounds.width}
							onChange={(e) =>
								onUpdateButton(button.id, {
									bounds: { ...button.bounds, width: Number(e.target.value) },
								})
							}
						/>
					</label>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">H</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={button.bounds.height}
							onChange={(e) =>
								onUpdateButton(button.id, {
									bounds: { ...button.bounds, height: Number(e.target.value) },
								})
							}
						/>
					</label>
				</div>
			</CollapsibleSection>

			{/* Action */}
			<CollapsibleSection title="Action" defaultOpen>
				<select
					className="inspector-panel__select"
					value={actionToString(button.action)}
					onChange={(e) =>
						onUpdateButton(button.id, {
							action: stringToAction(e.target.value),
						})
					}
				>
					<ActionOptions allTitles={allTitles} allMenus={allMenus} currentMenuId={currentMenuId} />
				</select>
			</CollapsibleSection>

			{/* Navigation — directional remote control, folded from Bind mode */}
			{buttons.length > 1 && (
				<CollapsibleSection title="Navigation" defaultOpen>
					<p className="inspector-panel__hint text-muted">
						Directional remote navigation from this button.
					</p>
					<div className="inspector-panel__nav-grid">
						{(['navUp', 'navDown', 'navLeft', 'navRight'] as const).map((dir) => {
							const arrows: Record<typeof dir, string> = {
								navUp: '↑',
								navDown: '↓',
								navLeft: '←',
								navRight: '→',
							};
							const labels: Record<typeof dir, string> = {
								navUp: 'Up',
								navDown: 'Down',
								navLeft: 'Left',
								navRight: 'Right',
							};
							return (
								<label key={dir} className="inspector-panel__field">
									<span className="inspector-panel__field-label">
										{arrows[dir]} {labels[dir]}
									</span>
									<select
										className="inspector-panel__select"
										value={button[dir] ?? ''}
										onChange={(e) => onUpdateButton(button.id, { [dir]: e.target.value || null })}
									>
										<option value="">—</option>
										{buttons
											.filter((b) => b.id !== button.id)
											.map((b) => (
												<option key={b.id} value={b.id}>
													{b.label}
												</option>
											))}
									</select>
								</label>
							);
						})}
					</div>
				</CollapsibleSection>
			)}

			{/* Button Style — per-state visual controls */}
			<ButtonStyleSection
				style={buttonNode.buttonStyle ?? DEFAULT_BUTTON_STYLE_MAP}
				onChange={(style) => onUpdateSceneNode?.(buttonNode.id, { buttonStyle: style })}
				activeState={buttonPreviewState}
				onActiveStateChange={onButtonPreviewStateChange}
			/>

			{/* Text Style — label typography */}
			{(() => {
				const ls = { ...DEFAULT_TEXT_STYLE, ...buttonNode.labelStyle };
				const update = (patch: Partial<TextStyle>) =>
					onUpdateSceneNode?.(buttonNode.id, { labelStyle: { ...ls, ...patch } });
				return (
					<TextStyleSection
						fontFamily={ls.fontFamily}
						fontSize={ls.fontSize}
						fontWeight={ls.fontWeight}
						fontItalic={ls.fontItalic}
						textDecoration={ls.textDecoration}
						textAlign={ls.textAlign}
						colour={ls.colour}
						lineHeight={ls.lineHeight}
						letterSpacing={ls.letterSpacing}
						onFontFamilyChange={(v) => update({ fontFamily: v })}
						onFontSizeChange={(v) => update({ fontSize: v })}
						onFontWeightChange={(v) => update({ fontWeight: v })}
						onFontItalicChange={(v) => update({ fontItalic: v })}
						onTextDecorationChange={(v) => update({ textDecoration: v })}
						onTextAlignChange={(v) => update({ textAlign: v })}
						onColourChange={(v) => update({ colour: v })}
						onLineHeightChange={(v) => update({ lineHeight: v })}
						onLetterSpacingChange={(v) => update({ letterSpacing: v })}
						availableFonts={availableFonts}
					/>
				);
			})()}

			{/* Highlight */}
			<CollapsibleSection title="Highlight Mode" defaultOpen>
				<select
					className="inspector-panel__select"
					value={button.highlightMode}
					onChange={(e) =>
						onUpdateButton(button.id, {
							highlightMode: e.target.value as 'static' | 'animated',
						})
					}
				>
					<option value="static">Static</option>
					<option value="animated">Animated</option>
				</select>
			</CollapsibleSection>

			{/* Overlay Colours */}
			<CollapsibleSection title="Overlay Colours" defaultOpen>
				<p className="inspector-panel__hint text-muted">
					DVD subpicture highlight palette (menu-level).
				</p>
				<HighlightColourFields colours={highlightColours} onChange={onUpdateHighlightColours} />
			</CollapsibleSection>

			{/* Remove */}
			<div className="inspector-panel__section">
				<button className="btn btn--sm btn--danger" onClick={() => onRemoveButton(button.id)}>
					Remove Button
				</button>
			</div>
		</div>
	);
}

// ── Shared Action Options ──────────────────────────────────────────────────
// Used in both the batch audit and button inspector action selectors.

function ActionOptions({
	allTitles,
	allMenus,
	currentMenuId,
}: {
	allTitles: Title[];
	allMenus: Menu[];
	currentMenuId: string;
}) {
	return (
		<>
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
					.filter((m) => m.id !== currentMenuId)
					.map((m) => (
						<option key={m.id} value={`showMenu:${m.id}`}>
							{m.name}
						</option>
					))}
			</optgroup>
			{/* Stream selection actions — validated by backend (Set 2b) */}
			<optgroup label="Stream Selection">
				{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
					<option key={`audio-${i}`} value={`setAudioStream:${i}`}>
						Audio Stream {i}
					</option>
				))}
				{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
					<option key={`sub-${i}`} value={`setSubtitleStream:${i}`}>
						Subtitle Stream {i}
					</option>
				))}
				<option value="setSubtitleStream:null">Subtitles Off</option>
			</optgroup>
			<option value="stop">Stop</option>
			<option value="return">Return (Resume Playback)</option>
		</>
	);
}

// ── Text Node Inspector ────────────────────────────────────────────────────

function TextNodeInspector({
	node,
	onUpdate,
	onRemove,
	availableFonts,
}: {
	node: Extract<SceneNode, { type: 'text' }>;
	onUpdate?: (nodeId: string, updates: Record<string, unknown>) => void;
	onRemove?: (nodeId: string) => void;
	availableFonts?: FontEntry[];
}) {
	return (
		<div className="inspector-panel__section-group">
			<CollapsibleSection title="Text" defaultOpen>
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Content</span>
					<input
						className="inspector-panel__input"
						value={node.content}
						onChange={(e) => onUpdate?.(node.id, { content: e.target.value })}
					/>
				</label>
			</CollapsibleSection>
			<CollapsibleSection title="Transform" defaultOpen>
				<div className="inspector-panel__grid-2">
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">X</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={node.x}
							onChange={(e) => onUpdate?.(node.id, { x: Number(e.target.value) })}
						/>
					</label>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">Y</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={node.y}
							onChange={(e) => onUpdate?.(node.id, { y: Number(e.target.value) })}
						/>
					</label>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">W</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={node.width}
							onChange={(e) => onUpdate?.(node.id, { width: Number(e.target.value) })}
						/>
					</label>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">H</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={node.height}
							onChange={(e) => onUpdate?.(node.id, { height: Number(e.target.value) })}
						/>
					</label>
				</div>
			</CollapsibleSection>
			{/* Text Style — full typography panel */}
			<TextStyleSection
				fontFamily={node.fontFamily}
				fontSize={node.fontSize ?? 24}
				fontWeight={node.fontWeight}
				fontItalic={node.fontItalic}
				textDecoration={node.textDecoration}
				textAlign={node.textAlign}
				colour={node.colour ?? '#ffffff'}
				lineHeight={node.lineHeight}
				letterSpacing={node.letterSpacing}
				onFontFamilyChange={(fontFamily) => onUpdate?.(node.id, { fontFamily })}
				onFontSizeChange={(fontSize) => onUpdate?.(node.id, { fontSize })}
				onFontWeightChange={(fontWeight) => onUpdate?.(node.id, { fontWeight })}
				onFontItalicChange={(fontItalic) => onUpdate?.(node.id, { fontItalic })}
				onTextDecorationChange={(textDecoration) => onUpdate?.(node.id, { textDecoration })}
				onTextAlignChange={(textAlign) => onUpdate?.(node.id, { textAlign })}
				onColourChange={(colour) => onUpdate?.(node.id, { colour })}
				onLineHeightChange={(lineHeight) => onUpdate?.(node.id, { lineHeight })}
				onLetterSpacingChange={(letterSpacing) => onUpdate?.(node.id, { letterSpacing })}
				availableFonts={availableFonts}
			/>
			{onRemove && (
				<div className="inspector-panel__section">
					<button className="btn btn--sm btn--danger" onClick={() => onRemove(node.id)}>
						Remove Text
					</button>
				</div>
			)}
		</div>
	);
}

// ── Image Node Inspector ───────────────────────────────────────────────────

function ImageNodeInspector({
	node,
	assets,
	onUpdate,
	onRemove,
}: {
	node: Extract<SceneNode, { type: 'image' }>;
	assets?: Asset[];
	onUpdate?: (nodeId: string, updates: Record<string, unknown>) => void;
	onRemove?: (nodeId: string) => void;
}) {
	const imageAssets = assets?.filter((a) => a.fileName.match(/\.(png|jpg|jpeg|bmp|tiff?)$/i)) ?? [];

	return (
		<div className="inspector-panel__section-group">
			<CollapsibleSection title="Image" defaultOpen>
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Asset</span>
					<select
						className="inspector-panel__select"
						value={node.assetId}
						onChange={(e) => onUpdate?.(node.id, { assetId: e.target.value })}
					>
						<option value="">None</option>
						{imageAssets.map((a) => (
							<option key={a.id} value={a.id}>
								{a.fileName}
							</option>
						))}
					</select>
				</label>
			</CollapsibleSection>
			<CollapsibleSection title="Transform" defaultOpen>
				<div className="inspector-panel__grid-2">
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">X</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={node.x}
							onChange={(e) => onUpdate?.(node.id, { x: Number(e.target.value) })}
						/>
					</label>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">Y</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={node.y}
							onChange={(e) => onUpdate?.(node.id, { y: Number(e.target.value) })}
						/>
					</label>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">W</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={node.width}
							onChange={(e) => onUpdate?.(node.id, { width: Number(e.target.value) })}
						/>
					</label>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">H</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={node.height}
							onChange={(e) => onUpdate?.(node.id, { height: Number(e.target.value) })}
						/>
					</label>
				</div>
			</CollapsibleSection>
			{onRemove && (
				<div className="inspector-panel__section">
					<button className="btn btn--sm btn--danger" onClick={() => onRemove(node.id)}>
						Remove Image
					</button>
				</div>
			)}
		</div>
	);
}

// ── Shape Node Inspector ───────────────────────────────────────────────────

function ShapeNodeInspector({
	node,
	onUpdate,
	onRemove,
}: {
	node: Extract<SceneNode, { type: 'shape' }>;
	onUpdate?: (nodeId: string, updates: Record<string, unknown>) => void;
	onRemove?: (nodeId: string) => void;
}) {
	return (
		<div className="inspector-panel__section-group">
			<CollapsibleSection title="Shape" defaultOpen>
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Fill</span>
					<div className="inspector-panel__colour-row">
						<input
							type="color"
							className="inspector-panel__colour-input"
							value={node.fill ?? '#333333'}
							onChange={(e) => onUpdate?.(node.id, { fill: e.target.value })}
						/>
						<input
							className="inspector-panel__input inspector-panel__input--hex"
							value={node.fill ?? '#333333'}
							onChange={(e) => onUpdate?.(node.id, { fill: e.target.value })}
							maxLength={7}
						/>
					</div>
				</label>
			</CollapsibleSection>
			<CollapsibleSection title="Transform" defaultOpen>
				<div className="inspector-panel__grid-2">
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">X</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={node.x}
							onChange={(e) => onUpdate?.(node.id, { x: Number(e.target.value) })}
						/>
					</label>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">Y</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={node.y}
							onChange={(e) => onUpdate?.(node.id, { y: Number(e.target.value) })}
						/>
					</label>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">W</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={node.width}
							onChange={(e) => onUpdate?.(node.id, { width: Number(e.target.value) })}
						/>
					</label>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">H</span>
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={node.height}
							onChange={(e) => onUpdate?.(node.id, { height: Number(e.target.value) })}
						/>
					</label>
				</div>
			</CollapsibleSection>
			{onRemove && (
				<div className="inspector-panel__section">
					<button className="btn btn--sm btn--danger" onClick={() => onRemove(node.id)}>
						Remove Shape
					</button>
				</div>
			)}
		</div>
	);
}

// ── Collapsible Section ───────────────────────────────────────────────────
// Reusable wrapper with chevron toggle for inspector sections.

function CollapsibleSection({
	title,
	defaultOpen = true,
	children,
}: {
	title: string;
	defaultOpen?: boolean;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<div
			className={`inspector-panel__section inspector-panel__collapsible ${open ? 'inspector-panel__collapsible--open' : ''}`}
		>
			<div
				className="inspector-panel__collapsible-header"
				onClick={() => setOpen(!open)}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)}
			>
				<svg
					className="inspector-panel__collapsible-chevron"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
				>
					<polyline points="6 9 12 15 18 9" />
				</svg>
				<span className="inspector-panel__section-heading" style={{ margin: 0 }}>
					{title}
				</span>
			</div>
			{open && <div className="inspector-panel__collapsible-body">{children}</div>}
		</div>
	);
}

// ── Button Style Section ──────────────────────────────────────────────────
// Per-state visual controls: Normal/Focus/Activate with background, border,
// radius, padding, and shadow/glow. Fully wired to ButtonStyleMap on the node.

type ButtonVisualState = 'normal' | 'focus' | 'activate';

function ButtonStyleSection({
	style,
	onChange,
	activeState,
	onActiveStateChange,
}: {
	style: ButtonStyleMap;
	onChange: (style: ButtonStyleMap) => void;
	activeState: ButtonVisualState;
	onActiveStateChange?: (state: ButtonVisualState) => void;
}) {
	const s = style[activeState];
	const update = (patch: Partial<ButtonStateStyle>) =>
		onChange({ ...style, [activeState]: { ...s, ...patch } });

	return (
		<CollapsibleSection title="Button Style">
			{/* State sub-tabs */}
			<div className="inspector-panel__state-tabs">
				{(['normal', 'focus', 'activate'] as const).map((state) => (
					<button
						key={state}
						className={`inspector-panel__state-tab ${activeState === state ? 'inspector-panel__state-tab--active' : ''}`}
						type="button"
						onClick={() => onActiveStateChange?.(state)}
					>
						{state.charAt(0).toUpperCase() + state.slice(1)}
					</button>
				))}
			</div>

			{/* Background */}
			<div className="inspector-panel__sub-label">Background</div>
			<div className="inspector-panel__field">
				<span className="inspector-panel__field-label">Fill</span>
				<input
					className="inspector-panel__input"
					value={s.bgFill}
					onChange={(e) => update({ bgFill: e.target.value })}
					style={{ flex: 1 }}
				/>
			</div>

			{/* Border */}
			<div className="inspector-panel__sub-label">Border</div>
			<div className="inspector-panel__grid-2">
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Colour</span>
					<div className="inspector-panel__colour-row">
						<input
							type="color"
							className="inspector-panel__colour-input"
							value={s.borderColour.length <= 7 ? s.borderColour : '#ffffff'}
							onChange={(e) => update({ borderColour: e.target.value })}
						/>
						<input
							className="inspector-panel__input inspector-panel__input--hex"
							value={s.borderColour}
							onChange={(e) => update({ borderColour: e.target.value })}
						/>
					</div>
				</label>
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Width</span>
					<div className="inspector-panel__inline-unit">
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={s.borderWidth}
							onChange={(e) => update({ borderWidth: Number(e.target.value) })}
						/>
						<span className="inspector-panel__unit">px</span>
					</div>
				</label>
			</div>
			<label className="inspector-panel__field">
				<span className="inspector-panel__field-label">Radius</span>
				<div className="inspector-panel__inline-unit">
					<input
						className="inspector-panel__input inspector-panel__input--num"
						type="number"
						value={s.borderRadius}
						onChange={(e) => update({ borderRadius: Number(e.target.value) })}
					/>
					<span className="inspector-panel__unit">px</span>
				</div>
			</label>

			{/* Padding */}
			<div className="inspector-panel__sub-label">Padding</div>
			<div className="inspector-panel__grid-2">
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">H</span>
					<input
						className="inspector-panel__input inspector-panel__input--num"
						type="number"
						value={s.paddingH}
						onChange={(e) => update({ paddingH: Number(e.target.value) })}
					/>
				</label>
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">V</span>
					<input
						className="inspector-panel__input inspector-panel__input--num"
						type="number"
						value={s.paddingV}
						onChange={(e) => update({ paddingV: Number(e.target.value) })}
					/>
				</label>
			</div>

			{/* Shadow / Glow */}
			<div className="inspector-panel__sub-label">Shadow / Glow</div>
			<label className="inspector-panel__field">
				<span className="inspector-panel__field-label">Type</span>
				<select
					className="inspector-panel__select"
					value={s.shadowType}
					onChange={(e) => update({ shadowType: e.target.value as ButtonStateStyle['shadowType'] })}
				>
					<option value="none">None</option>
					<option value="box-shadow">Box shadow</option>
					<option value="outer-glow">Outer glow</option>
					<option value="inner-glow">Inner glow</option>
				</select>
			</label>
			{s.shadowType !== 'none' && (
				<>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">Colour</span>
						<div className="inspector-panel__colour-row">
							<input
								type="color"
								className="inspector-panel__colour-input"
								value={s.shadowColour.length <= 7 ? s.shadowColour : '#ffa840'}
								onChange={(e) => update({ shadowColour: e.target.value })}
							/>
							<input
								className="inspector-panel__input inspector-panel__input--hex"
								value={s.shadowColour}
								onChange={(e) => update({ shadowColour: e.target.value })}
							/>
						</div>
					</label>
					<div className="inspector-panel__grid-2">
						<label className="inspector-panel__field">
							<span className="inspector-panel__field-label">Blur</span>
							<input
								className="inspector-panel__input inspector-panel__input--num"
								type="number"
								value={s.shadowBlur}
								onChange={(e) => update({ shadowBlur: Number(e.target.value) })}
							/>
						</label>
						<label className="inspector-panel__field">
							<span className="inspector-panel__field-label">Spread</span>
							<input
								className="inspector-panel__input inspector-panel__input--num"
								type="number"
								value={s.shadowSpread}
								onChange={(e) => update({ shadowSpread: Number(e.target.value) })}
							/>
						</label>
					</div>
				</>
			)}
		</CollapsibleSection>
	);
}

// ── Text Style Section ────────────────────────────────────────────────────
// Typography controls for button labels and text nodes. Fully wired to the
// node's TextStyle (label) or individual typography fields (text node).

function TextStyleSection({
	fontFamily,
	fontSize,
	fontWeight,
	fontItalic,
	textDecoration,
	textAlign,
	colour,
	lineHeight,
	letterSpacing,
	onFontFamilyChange,
	onFontSizeChange,
	onFontWeightChange,
	onFontItalicChange,
	onTextDecorationChange,
	onTextAlignChange,
	onColourChange,
	onLineHeightChange,
	onLetterSpacingChange,
	availableFonts,
}: {
	fontFamily?: string;
	fontSize?: number;
	fontWeight?: 'normal' | 'bold';
	fontItalic?: boolean;
	textDecoration?: 'none' | 'underline';
	textAlign?: 'left' | 'center' | 'right';
	colour?: string;
	lineHeight?: number;
	letterSpacing?: number;
	onFontFamilyChange?: (v: string) => void;
	onFontSizeChange?: (v: number) => void;
	onFontWeightChange?: (v: 'normal' | 'bold') => void;
	onFontItalicChange?: (v: boolean) => void;
	onTextDecorationChange?: (v: 'none' | 'underline') => void;
	onTextAlignChange?: (v: 'left' | 'center' | 'right') => void;
	onColourChange?: (v: string) => void;
	onLineHeightChange?: (v: number) => void;
	onLetterSpacingChange?: (v: number) => void;
	availableFonts?: FontEntry[];
}) {
	const bold = fontWeight === 'bold';
	const italic = fontItalic ?? false;
	const underline = textDecoration === 'underline';
	const align = textAlign ?? 'left';

	const projectFonts = availableFonts?.filter((f) => f.source === 'project-asset') ?? [];
	const sidecarFonts = availableFonts?.filter((f) => f.source === 'app-sidecar') ?? [];
	const systemFonts = availableFonts?.filter((f) => f.source === 'system') ?? [];

	return (
		<CollapsibleSection title="Text Style">
			<label className="inspector-panel__field">
				<span className="inspector-panel__field-label">Font</span>
				<select
					className="inspector-panel__select"
					value={fontFamily ?? 'Space Grotesk'}
					onChange={(e) => onFontFamilyChange?.(e.target.value)}
				>
					{availableFonts ? (
						<>
							{projectFonts.length > 0 && (
								<optgroup label="Project fonts">
									{projectFonts.map((f) => (
										<option key={f.family} value={f.family}>
											{f.family}
										</option>
									))}
								</optgroup>
							)}
							{sidecarFonts.length > 0 && (
								<optgroup label="Application fonts">
									{sidecarFonts.map((f) => (
										<option key={f.family} value={f.family}>
											{f.family}
										</option>
									))}
								</optgroup>
							)}
							{systemFonts.length > 0 && (
								<optgroup label="System fonts">
									{systemFonts.map((f) => (
										<option key={f.family} value={f.family}>
											{f.family}
										</option>
									))}
								</optgroup>
							)}
						</>
					) : (
						<>
							<option value="Space Grotesk">Space Grotesk</option>
							<option value="Inter">Inter</option>
							<option value="System UI">System UI</option>
							<option value="Georgia">Georgia</option>
							<option value="Courier New">Courier New</option>
						</>
					)}
				</select>
			</label>
			<div className="inspector-panel__grid-2">
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Size</span>
					<div className="inspector-panel__inline-unit">
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={fontSize ?? 14}
							onChange={(e) => onFontSizeChange?.(Number(e.target.value))}
						/>
						<span className="inspector-panel__unit">px</span>
					</div>
				</label>
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Height</span>
					<input
						className="inspector-panel__input inspector-panel__input--num"
						type="number"
						value={lineHeight ?? 1.4}
						step={0.1}
						onChange={(e) => onLineHeightChange?.(Number(e.target.value))}
					/>
				</label>
			</div>

			{/* Weight + style toggles */}
			<label className="inspector-panel__field">
				<span className="inspector-panel__field-label">Style</span>
				<div className="inspector-panel__style-pills">
					<button
						className={`inspector-panel__style-pill ${bold ? 'inspector-panel__style-pill--active' : ''}`}
						onClick={() => onFontWeightChange?.(bold ? 'normal' : 'bold')}
						title="Bold"
						style={{ fontWeight: 700 }}
					>
						B
					</button>
					<button
						className={`inspector-panel__style-pill ${italic ? 'inspector-panel__style-pill--active' : ''}`}
						onClick={() => onFontItalicChange?.(!italic)}
						title="Italic"
						style={{ fontStyle: 'italic' }}
					>
						I
					</button>
					<button
						className={`inspector-panel__style-pill ${underline ? 'inspector-panel__style-pill--active' : ''}`}
						onClick={() => onTextDecorationChange?.(underline ? 'none' : 'underline')}
						title="Underline"
						style={{ textDecoration: 'underline' }}
					>
						U
					</button>
				</div>
			</label>

			{/* Colour */}
			<label className="inspector-panel__field">
				<span className="inspector-panel__field-label">Colour</span>
				<div className="inspector-panel__colour-row">
					<input
						type="color"
						className="inspector-panel__colour-input"
						value={colour ?? '#ffffff'}
						onChange={(e) => onColourChange?.(e.target.value)}
					/>
					<input
						className="inspector-panel__input inspector-panel__input--hex"
						value={colour ?? '#ffffff'}
						onChange={(e) => onColourChange?.(e.target.value)}
						maxLength={7}
					/>
				</div>
			</label>

			{/* Alignment */}
			<label className="inspector-panel__field">
				<span className="inspector-panel__field-label">Align</span>
				<div className="inspector-panel__align-row">
					{(['left', 'center', 'right'] as const).map((a) => (
						<button
							key={a}
							className={`inspector-panel__align-btn ${align === a ? 'inspector-panel__align-btn--active' : ''}`}
							onClick={() => onTextAlignChange?.(a)}
							title={a === 'center' ? 'Centre' : a.charAt(0).toUpperCase() + a.slice(1)}
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								{a === 'left' && (
									<>
										<line x1="3" y1="6" x2="21" y2="6" />
										<line x1="3" y1="12" x2="15" y2="12" />
										<line x1="3" y1="18" x2="18" y2="18" />
									</>
								)}
								{a === 'center' && (
									<>
										<line x1="3" y1="6" x2="21" y2="6" />
										<line x1="6" y1="12" x2="18" y2="12" />
										<line x1="4" y1="18" x2="20" y2="18" />
									</>
								)}
								{a === 'right' && (
									<>
										<line x1="3" y1="6" x2="21" y2="6" />
										<line x1="9" y1="12" x2="21" y2="12" />
										<line x1="6" y1="18" x2="21" y2="18" />
									</>
								)}
							</svg>
						</button>
					))}
				</div>
			</label>

			{/* Letter spacing */}
			<label className="inspector-panel__field">
				<span className="inspector-panel__field-label">Spacing</span>
				<div className="inspector-panel__inline-unit">
					<input
						className="inspector-panel__input inspector-panel__input--num"
						type="number"
						value={letterSpacing ?? 0}
						step={0.5}
						onChange={(e) => onLetterSpacingChange?.(Number(e.target.value))}
					/>
					<span className="inspector-panel__unit">px</span>
				</div>
			</label>
		</CollapsibleSection>
	);
}

// ── Generic Node Inspector ─────────────────────────────────────────────────

function GenericNodeInspector({ node }: { node: SceneNode }) {
	return (
		<div className="inspector-panel__section">
			<h5 className="inspector-panel__section-heading">
				{node.type.charAt(0).toUpperCase() + node.type.slice(1)}
			</h5>
			<p className="inspector-panel__hint text-muted">
				Properties for {node.type} nodes will be available in a future update.
			</p>
		</div>
	);
}

// ── Highlight Colour Fields ────────────────────────────────────────────────

function HighlightColourFields({
	colours,
	onChange,
}: {
	colours: MenuHighlightColours;
	onChange: (colours: MenuHighlightColours) => void;
}) {
	return (
		<div className="inspector-panel__colour-grid">
			<div className="inspector-panel__colour-field">
				<label className="inspector-panel__field-label">Select</label>
				<div className="inspector-panel__colour-row">
					<input
						type="color"
						className="inspector-panel__colour-input"
						value={colours.selectColour}
						onChange={(e) => onChange({ ...colours, selectColour: e.target.value })}
					/>
					<input
						className="inspector-panel__input inspector-panel__input--hex"
						value={colours.selectColour}
						onChange={(e) => onChange({ ...colours, selectColour: e.target.value })}
						maxLength={7}
					/>
				</div>
				<div className="inspector-panel__colour-row">
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
			</div>
			<div className="inspector-panel__colour-field">
				<label className="inspector-panel__field-label">Activate</label>
				<div className="inspector-panel__colour-row">
					<input
						type="color"
						className="inspector-panel__colour-input"
						value={colours.activateColour}
						onChange={(e) => onChange({ ...colours, activateColour: e.target.value })}
					/>
					<input
						className="inspector-panel__input inspector-panel__input--hex"
						value={colours.activateColour}
						onChange={(e) => onChange({ ...colours, activateColour: e.target.value })}
						maxLength={7}
					/>
				</div>
				<div className="inspector-panel__colour-row">
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
			</div>
		</div>
	);
}

function getInspectorTitle(
	selectedNode: SceneNode | null,
	selectedButton: MenuButton | null,
): string {
	if (!selectedNode) return 'Menu Inspector';
	if (selectedNode.type === 'button' && selectedButton) return selectedButton.label || 'Button';
	if (selectedNode.type === 'text') return selectedNode.content || 'Text';
	if (selectedNode.type === 'image') return selectedNode.assetId || 'Image';
	if (selectedNode.type === 'shape') return 'Shape';
	return selectedNode.type.charAt(0).toUpperCase() + selectedNode.type.slice(1);
}

function getInspectorSubtitle(
	selectedNode: SceneNode | null,
	selectedButton: MenuButton | null,
	buttons?: MenuButton[],
): string {
	if (!selectedNode) {
		const buttonCount = buttons?.length ?? 0;
		return buttonCount === 0
			? 'Diagnostics, compile policy, and palette controls for this menu.'
			: `Diagnostics, palette, and default-focus controls across ${buttonCount} button${buttonCount === 1 ? '' : 's'}.`;
	}

	if (selectedNode.type === 'button' && selectedButton) {
		return `Button node with action, navigation, and authored highlight styling.`;
	}

	if (selectedNode.type === 'text') {
		return 'Typography, colour, and frame controls for the selected text node.';
	}

	if (selectedNode.type === 'image') {
		return 'Asset assignment and frame controls for the selected image node.';
	}

	if (selectedNode.type === 'shape') {
		return 'Fill and frame controls for the selected shape node.';
	}

	return 'Additional node controls will land in a future polish pass.';
}

// ── Diagnostics ────────────────────────────────────────────────────────────

interface Diagnostic {
	severity: 'info' | 'warning' | 'error';
	message: string;
}

function computeDiagnostics(doc: MenuDocument | null, buttons: MenuButton[]): Diagnostic[] {
	const results: Diagnostic[] = [];

	// Button count against DVD limit
	if (buttons.length > MAX_DVD_BUTTONS) {
		results.push({
			severity: 'error',
			message: `Too many buttons (${buttons.length}). DVD supports a maximum of ${MAX_DVD_BUTTONS}.`,
		});
	} else if (buttons.length > 12) {
		results.push({
			severity: 'warning',
			message: `${buttons.length} buttons. Dense menus may be difficult to navigate with a remote control.`,
		});
	}

	// Missing actions
	const unbound = buttons.filter((b) => !b.action);
	if (unbound.length > 0) {
		results.push({
			severity: 'warning',
			message: `${unbound.length} button${unbound.length > 1 ? 's have' : ' has'} no action assigned.`,
		});
	}

	// Missing default focus
	if (doc && !doc.interaction.defaultFocusId && buttons.length > 0) {
		results.push({
			severity: 'warning',
			message: 'No default focus button set. The first button will receive focus by default.',
		});
	}

	// Broken directional navigation references
	const buttonIds = new Set(buttons.map((b) => b.id));
	for (const btn of buttons) {
		for (const dir of ['navUp', 'navDown', 'navLeft', 'navRight'] as const) {
			const target = btn[dir];
			if (target && !buttonIds.has(target)) {
				results.push({
					severity: 'error',
					message: `Button "${btn.label}" has a broken ${dir} reference.`,
				});
			}
		}
	}

	// Unreachable buttons (no navigation leads to them and they are not default)
	if (buttons.length > 1) {
		const reachable = new Set<string>();
		if (doc?.interaction.defaultFocusId) reachable.add(doc.interaction.defaultFocusId);
		else if (buttons.length > 0) reachable.add(buttons[0].id);

		for (const btn of buttons) {
			for (const dir of ['navUp', 'navDown', 'navLeft', 'navRight'] as const) {
				if (btn[dir]) reachable.add(btn[dir]!);
			}
		}
		const unreachable = buttons.filter((b) => !reachable.has(b.id));
		if (unreachable.length > 0) {
			results.push({
				severity: 'warning',
				message: `${unreachable.length} button${unreachable.length > 1 ? 's are' : ' is'} unreachable via remote navigation.`,
			});
		}
	}

	// Motion menu timing safety gate — a loop start of 0.0 blocks the build.
	if (doc?.backgroundMode === 'motion') {
		if (doc.timing.loopStartSecs === 0.0) {
			results.push({
				severity: 'error',
				message:
					'Motion menu: loop start time is 0.0 s. Set a loop start point before building — this will block the build.',
			});
		}
		results.push({
			severity: 'info',
			message: 'Motion menu: background will be rendered as looping MPEG video.',
		});
	}

	return results;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function actionToString(action: PlaybackAction | null): string {
	if (!action) return '';
	switch (action.type) {
		case 'playTitle':
			return `playTitle:${action.titleId}`;
		case 'playChapter':
			return `playChapter:${action.titleId}:${action.chapterId}`;
		case 'showMenu':
			return `showMenu:${action.menuId}`;
		case 'setAudioStream':
			return `setAudioStream:${action.streamIndex}`;
		case 'setSubtitleStream':
			return `setSubtitleStream:${action.streamIndex ?? 'null'}`;
		case 'stop':
			return 'stop';
		case 'return':
			return 'return';
		default:
			return '';
	}
}

function stringToAction(str: string): PlaybackAction | null {
	if (!str) return null;
	if (str === 'stop') return { type: 'stop' };
	if (str === 'return') return { type: 'return' };
	const parts = str.split(':');
	const type = parts[0];
	if (type === 'playTitle' && parts[1]) return { type: 'playTitle', titleId: parts[1] };
	if (type === 'playChapter' && parts[1] && parts[2])
		return { type: 'playChapter', titleId: parts[1], chapterId: parts[2] };
	if (type === 'showMenu' && parts[1]) return { type: 'showMenu', menuId: parts[1] };
	if (type === 'setAudioStream' && parts[1] !== undefined)
		return { type: 'setAudioStream', streamIndex: Number(parts[1]) };
	if (type === 'setSubtitleStream' && parts[1] !== undefined) {
		const idx = parts[1] === 'null' ? null : Number(parts[1]);
		return { type: 'setSubtitleStream', streamIndex: idx };
	}
	return null;
}
