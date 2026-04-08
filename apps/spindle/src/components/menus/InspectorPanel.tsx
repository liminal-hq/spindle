// Inspector panel — contextual property editor for the selected scene node.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

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
} from '../../types/project';

/** DVD constraint thresholds (shared with compile diagnostics). */
const MAX_DVD_BUTTONS = 36;

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
	/** DVD canvas height for diagnostic context. */
	canvasHeight?: number;
	/** Set the default focus to a button. */
	onSetDefaultFocus?: (buttonId: string) => void;
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
	canvasHeight,
	onSetDefaultFocus,
}: InspectorPanelProps) {
	return (
		<div className="inspector-panel">
			<div className="inspector-panel__header">
				<h4 className="inspector-panel__title">Inspector</h4>
			</div>
			<div className="inspector-panel__body">
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
						/>
					) : (
						<div className="inspector-panel__empty text-muted">
							Select a node to inspect its properties.
						</div>
					)
				) : selectedNode.type === 'button' && selectedButton ? (
					<ButtonInspector
						button={selectedButton}
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
					/>
				) : selectedNode.type === 'text' ? (
					<TextNodeInspector
						node={selectedNode}
						onUpdate={onUpdateSceneNode}
						onRemove={onRemoveNode}
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
}) {
	const diagnostics = computeDiagnostics(document, buttons);

	return (
		<div className="inspector-panel__section-group">
			{/* Diagnostics — always visible, cannot disappear */}
			<div className="inspector-panel__section">
				<h5 className="inspector-panel__section-heading">Diagnostics</h5>
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
			</div>

			{/* All Buttons Audit — batch action and default-focus overview */}
			{buttons.length > 0 && (
				<div className="inspector-panel__section">
					<h5 className="inspector-panel__section-heading">All Buttons</h5>
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
										<ActionOptions allTitles={allTitles} allMenus={allMenus} currentMenuId={currentMenuId} />
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
				</div>
			)}

			{/* Compile Policy */}
			{document && (
				<div className="inspector-panel__section">
					<h5 className="inspector-panel__section-heading">Compile Policy</h5>
					<div className="inspector-panel__policy-grid">
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
				</div>
			)}

			{/* CLUT Palette — DVD subpicture highlight colours */}
			<div className="inspector-panel__section">
				<h5 className="inspector-panel__section-heading">CLUT Palette</h5>
				<p className="inspector-panel__hint text-muted">
					DVD subpicture overlays use a 4-colour palette. These colours apply to all buttons in
					this menu.
				</p>
				<HighlightColourFields colours={highlightColours} onChange={onUpdateHighlightColours} />
			</div>
		</div>
	);
}

// ── Button Inspector ───────────────────────────────────────────────────────

function ButtonInspector({
	button,
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
}: {
	button: MenuButton;
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
}) {
	const isDefault = defaultFocusId === button.id;

	return (
		<div className="inspector-panel__section-group">
			{/* Identity */}
			<div className="inspector-panel__section">
				<h5 className="inspector-panel__section-heading">Button</h5>
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
						<button
							className="btn btn--ghost btn--sm"
							onClick={() => onSetDefaultFocus(button.id)}
						>
							Set as default focus
						</button>
					) : null}
				</div>
			</div>

			{/* Geometry */}
			<div className="inspector-panel__section">
				<h5 className="inspector-panel__section-heading">Position & Size</h5>
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
			</div>

			{/* Action */}
			<div className="inspector-panel__section">
				<h5 className="inspector-panel__section-heading">Action</h5>
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
			</div>

			{/* Navigation — directional remote control, folded from Bind mode */}
			{buttons.length > 1 && (
				<div className="inspector-panel__section">
					<h5 className="inspector-panel__section-heading">Navigation</h5>
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
										onChange={(e) =>
											onUpdateButton(button.id, { [dir]: e.target.value || null })
										}
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
				</div>
			)}

			{/* Highlight */}
			<div className="inspector-panel__section">
				<h5 className="inspector-panel__section-heading">Highlight Mode</h5>
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
			</div>

			{/* Overlay Colours */}
			<div className="inspector-panel__section">
				<h5 className="inspector-panel__section-heading">Overlay Colours</h5>
				<p className="inspector-panel__hint text-muted">
					DVD subpicture highlight palette (menu-level).
				</p>
				<HighlightColourFields colours={highlightColours} onChange={onUpdateHighlightColours} />
			</div>

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
		</>
	);
}

// ── Text Node Inspector ────────────────────────────────────────────────────

function TextNodeInspector({
	node,
	onUpdate,
	onRemove,
}: {
	node: Extract<SceneNode, { type: 'text' }>;
	onUpdate?: (nodeId: string, updates: Record<string, unknown>) => void;
	onRemove?: (nodeId: string) => void;
}) {
	return (
		<div className="inspector-panel__section-group">
			<div className="inspector-panel__section">
				<h5 className="inspector-panel__section-heading">Text</h5>
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Content</span>
					<input
						className="inspector-panel__input"
						value={node.content}
						onChange={(e) => onUpdate?.(node.id, { content: e.target.value })}
					/>
				</label>
			</div>
			<div className="inspector-panel__section">
				<h5 className="inspector-panel__section-heading">Position & Size</h5>
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
			</div>
			<div className="inspector-panel__section">
				<h5 className="inspector-panel__section-heading">Style</h5>
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Font Size</span>
					<input
						className="inspector-panel__input inspector-panel__input--num"
						type="number"
						value={node.fontSize ?? 24}
						onChange={(e) => onUpdate?.(node.id, { fontSize: Number(e.target.value) })}
					/>
				</label>
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Colour</span>
					<div className="inspector-panel__colour-row">
						<input
							type="color"
							className="inspector-panel__colour-input"
							value={node.colour ?? '#ffffff'}
							onChange={(e) => onUpdate?.(node.id, { colour: e.target.value })}
						/>
						<input
							className="inspector-panel__input inspector-panel__input--hex"
							value={node.colour ?? '#ffffff'}
							onChange={(e) => onUpdate?.(node.id, { colour: e.target.value })}
							maxLength={7}
						/>
					</div>
				</label>
			</div>
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
			<div className="inspector-panel__section">
				<h5 className="inspector-panel__section-heading">Image</h5>
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
			</div>
			<div className="inspector-panel__section">
				<h5 className="inspector-panel__section-heading">Position & Size</h5>
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
			</div>
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
			<div className="inspector-panel__section">
				<h5 className="inspector-panel__section-heading">Shape</h5>
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
			</div>
			<div className="inspector-panel__section">
				<h5 className="inspector-panel__section-heading">Position & Size</h5>
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
			</div>
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

	// Motion menu timing safety gate
	if (doc?.backgroundMode === 'motion') {
		if (doc.timing.loopStartSecs === 0.0) {
			results.push({
				severity: 'warning',
				message:
					'Motion menu: loop start time is 0.0 s. Set a loop start point to avoid a hard cut at the beginning of playback.',
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
		default:
			return '';
	}
}

function stringToAction(str: string): PlaybackAction | null {
	if (!str) return null;
	if (str === 'stop') return { type: 'stop' };
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
