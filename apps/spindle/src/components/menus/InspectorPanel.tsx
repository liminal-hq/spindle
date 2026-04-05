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
} from '../../types/project';

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
	collapsed: boolean;
	onToggleCollapse: () => void;
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
	collapsed,
	onToggleCollapse,
}: InspectorPanelProps) {
	if (collapsed) {
		return (
			<div className="inspector-panel inspector-panel--collapsed">
				<button
					className="inspector-panel__collapse-btn"
					onClick={onToggleCollapse}
					title="Expand inspector"
				>
					<span className="inspector-panel__collapse-icon">I</span>
				</button>
			</div>
		);
	}

	return (
		<div className="inspector-panel">
			<div className="inspector-panel__header">
				<button
					className="inspector-panel__collapse-btn"
					onClick={onToggleCollapse}
					title="Collapse inspector"
				>
					&rsaquo;
				</button>
				<h4 className="inspector-panel__title">Inspector</h4>
			</div>
			<div className="inspector-panel__body">
				{!selectedNode ? (
					<div className="inspector-panel__empty text-muted">
						Select a node to inspect its properties.
					</div>
				) : selectedNode.type === 'button' && selectedButton ? (
					<ButtonInspector
						button={selectedButton}
						highlightColours={highlightColours}
						allTitles={allTitles}
						allMenus={allMenus}
						currentMenuId={currentMenuId}
						onUpdateButton={onUpdateButton}
						onUpdateHighlightColours={onUpdateHighlightColours}
						onRemoveButton={onRemoveButton}
					/>
				) : (
					<GenericNodeInspector node={selectedNode} />
				)}
			</div>
		</div>
	);
}

// ── Button Inspector ───────────────────────────────────────────────────────

function ButtonInspector({
	button,
	highlightColours,
	allTitles,
	allMenus,
	currentMenuId,
	onUpdateButton,
	onUpdateHighlightColours,
	onRemoveButton,
}: {
	button: MenuButton;
	highlightColours: MenuHighlightColours;
	allTitles: Title[];
	allMenus: Menu[];
	currentMenuId: string;
	onUpdateButton: (buttonId: string, updates: Partial<MenuButton>) => void;
	onUpdateHighlightColours: (colours: MenuHighlightColours) => void;
	onRemoveButton: (buttonId: string) => void;
}) {
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
							.filter((m) => m.id !== currentMenuId)
							.map((m) => (
								<option key={m.id} value={`showMenu:${m.id}`}>
									{m.name}
								</option>
							))}
					</optgroup>
					<option value="stop">Stop</option>
				</select>
			</div>

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
				<HighlightColourFields
					colours={highlightColours}
					onChange={onUpdateHighlightColours}
				/>
			</div>

			{/* Remove */}
			<div className="inspector-panel__section">
				<button
					className="btn btn--sm btn--danger"
					onClick={() => onRemoveButton(button.id)}
				>
					Remove Button
				</button>
			</div>
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
