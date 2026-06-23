// Inspector panel shown when a button scene node is selected: identity,
// transform, action, navigation, per-state visual style, label typography,
// highlight mode, and overlay colours.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type {
	MenuButton,
	SceneNode,
	MenuHighlightColours,
	Title,
	Menu,
	MenuDomain,
	TextStyle,
	FontEntry,
} from '../../types/project';
import { CollapsibleSection } from './InspectorCollapsibleSection';
import { ActionOptions, HighlightColourFields } from './InspectorSharedFields';
import { ButtonStyleSection } from './ButtonStyleSection';
import type { ButtonVisualState } from './ButtonStyleSection';
import { TextStyleSection } from './TextStyleSection';
import { actionToString, stringToAction } from './inspectorHelpers';
import { DEFAULT_BUTTON_STYLE_MAP, DEFAULT_TEXT_STYLE } from './menuDefaults';

export function ButtonInspector({
	button,
	buttonNode,
	buttons,
	defaultFocusId,
	highlightColours,
	allTitles,
	allMenus,
	currentMenuId,
	menuDomain,
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
	menuDomain?: MenuDomain;
	onUpdateButton: (buttonId: string, updates: Partial<MenuButton>) => void;
	onUpdateHighlightColours: (colours: MenuHighlightColours) => void;
	onRemoveButton: (buttonId: string) => void;
	onSetDefaultFocus?: (buttonId: string) => void;
	onUpdateSceneNode?: (nodeId: string, updates: Record<string, unknown>) => void;
	buttonPreviewState: ButtonVisualState;
	onButtonPreviewStateChange?: (state: ButtonVisualState) => void;
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
					<ActionOptions
						allTitles={allTitles}
						allMenus={allMenus}
						currentMenuId={currentMenuId}
						menuDomain={menuDomain}
					/>
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
