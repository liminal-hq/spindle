// Inspector panel shown when no scene node is selected: diagnostics, menu
// background (solid/image/video/audio), display aspect, button audit,
// compile policy, CLUT palette, auto-nav, and render preview export.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import type {
	MenuButton,
	MenuDocument,
	MenuHighlightColours,
	FocusNode,
	Title,
	Menu,
	MenuDomain,
	MenuRole,
	Asset,
	AspectMode,
	FormatProfile,
} from '../../types/project';
import { DEFAULT_MENU_BACKGROUND_COLOUR } from '../../types/project';
import { CollapsibleSection } from './InspectorCollapsibleSection';
import { ActionOptions, HighlightColourFields } from './InspectorSharedFields';
import { actionToString, stringToAction } from './inspectorHelpers';
import { computeDiagnostics } from './inspectorDiagnostics';
import { terminologyFor } from '../../format/terminology';
import { DEFAULT_DVD_FORMAT_PROFILE } from '../../format/useFormatProfile';

/** Every `MenuRole`, in a stable display order for the role picker. */
const ROLE_ORDER: MenuRole[] = ['root', 'title-select', 'chapter', 'setup', 'extras', 'popup'];

export function MenuLevelInspector({
	buttons,
	document,
	highlightColours,
	defaultFocusId,
	// canvasHeight reserved for future safe-area bounds diagnostics
	allTitles,
	allMenus,
	currentMenuId,
	menuDomain,
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
	formatProfile = DEFAULT_DVD_FORMAT_PROFILE,
	onUpdateRole,
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
	menuDomain?: MenuDomain;
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
	formatProfile?: FormatProfile;
	onUpdateRole?: (role: MenuRole) => void;
}) {
	const diagnostics = computeDiagnostics(document, buttons, formatProfile);
	const terminology = terminologyFor(formatProfile.family);
	const backgroundAssets = assets.filter(
		(asset) =>
			asset.videoStreams.length > 0 || asset.fileName.match(/\.(png|jpg|jpeg|bmp|tiff?)$/i),
	);
	const audioAssets = assets.filter((asset) => asset.audioStreams.length > 0);
	const [backgroundTab, setBackgroundTab] = useState<'solid' | 'image' | 'video' | 'audio'>(
		document?.backgroundMode === 'motion' ? 'video' : 'solid',
	);

	return (
		<div className="inspector-panel__section-group">
			<CollapsibleSection title="Diagnostics" defaultOpen>
				{diagnostics.length === 0 ? (
					<p className="inspector-panel__hint" style={{ color: 'var(--colour-success, #4ade80)' }}>
						{`No issues — menu is ${terminology.formatName}-safe.`}
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

			{document && onUpdateRole && (
				<CollapsibleSection title="Role" defaultOpen>
					<p className="inspector-panel__hint text-muted">
						What this menu is for — independent of where it lives in the disc structure. Backends
						map role to physical placement; generated menus and the navigation map group by role.
					</p>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">Menu role</span>
						<select
							className="inspector-panel__select"
							value={document.role}
							onChange={(e) => onUpdateRole(e.target.value as MenuRole)}
						>
							{ROLE_ORDER.filter(
								(role) => role !== 'popup' || formatProfile.supportedRoles.includes('popup'),
							).map((role) => (
								<option key={role} value={role}>
									{terminology.menuRole[role]}
								</option>
							))}
						</select>
					</label>
				</CollapsibleSection>
			)}

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
									className={`inspector-panel__style-pill ${document?.backgroundMode === mode ? 'inspector-panel__style-pill--active' : ''}`}
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
									value={document?.scene.background.colour ?? DEFAULT_MENU_BACKGROUND_COLOUR}
									onChange={(e) => onUpdateBackgroundColour?.(e.target.value)}
								/>
								<input
									className="inspector-panel__input inspector-panel__input--hex"
									value={document?.scene.background.colour ?? DEFAULT_MENU_BACKGROUND_COLOUR}
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
								value={document?.scene.background.assetId ?? ''}
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
								value={document?.timing.audioAssetId ?? ''}
								onChange={(e) => onUpdateMotionAudioAsset?.(e.target.value || null)}
								disabled={document?.backgroundMode !== 'motion'}
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
						className={`inspector-panel__fieldset ${document?.backgroundMode !== 'motion' ? 'inspector-panel__fieldset--disabled' : ''}`}
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
										value={
											document && document.timing.loopDurationSecs > 0
												? document.timing.loopDurationSecs
												: ''
										}
										onChange={(e) =>
											onUpdateMotionDurationSecs?.(
												e.target.value === '' ? null : Number(e.target.value),
											)
										}
										disabled={document?.backgroundMode !== 'motion'}
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
										value={document?.timing.loopCount ?? 0}
										onChange={(e) => onUpdateMotionLoopCount?.(Number(e.target.value))}
										disabled={document?.backgroundMode !== 'motion'}
									/>
									<span className="inspector-panel__unit">x</span>
								</div>
							</label>
						</div>
						<label className="inspector-panel__field">
							<span className="inspector-panel__field-label">Audio asset</span>
							<select
								className="inspector-panel__select"
								value={document?.timing.audioAssetId ?? ''}
								onChange={(e) => onUpdateMotionAudioAsset?.(e.target.value || null)}
								disabled={document?.backgroundMode !== 'motion'}
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
					{`Choose how this 720-line ${terminology.formatName} menu should display on the player: classic 4:3 or anamorphic 16:9.`}
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
											menuDomain={menuDomain}
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

			{/* CLUT Palette — highlight overlay colours */}
			<CollapsibleSection title="CLUT Palette" defaultOpen>
				<p className="inspector-panel__hint text-muted">
					{`${terminology.formatName} ${terminology.highlightTreatment.toLowerCase()} uses a ${terminology.highlightPalette.toLowerCase()}. These colours apply to all buttons in this menu.`}
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
