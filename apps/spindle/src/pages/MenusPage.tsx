// Menus page — define menu layouts, buttons, navigation, and visual editor.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState, useRef, useCallback, useEffect } from 'react';
import { useProjectStore } from '../store/project-store';
import type {
	Menu,
	MenuButton,
	MenuHighlightColours,
	ButtonBounds,
	PlaybackAction,
	SpindleProjectFile,
	VideoStandard,
} from '../types/project';
import { DEFAULT_HIGHLIGHT_COLOURS } from '../types/project';

// DVD menu canvas dimensions vary by video standard
const MENU_WIDTH = 720;
const MENU_HEIGHT: Record<VideoStandard, number> = { NTSC: 480, PAL: 576 };

// Safe-area margins (SMPTE RP 218 — 90% action-safe, 80% title-safe)
const ACTION_SAFE_PCT = 0.05; // 5% from each edge
const TITLE_SAFE_PCT = 0.1; // 10% from each edge

import './MenusPage.css';

export function MenusPage() {
	const project = useProjectStore((s) => s.project);
	const updateProject = useProjectStore((s) => s.updateProject);
	const autoGenerateMenuNav = useProjectStore((s) => s.autoGenerateMenuNav);
	const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);

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

	const handleAddGlobalMenu = () => {
		const newMenu: Menu = {
			id: crypto.randomUUID(),
			name: `Menu ${disc.globalMenus.length + 1}`,
			backgroundAssetId: null,
			buttons: [],
			defaultButtonId: null,
			highlightColours: { ...DEFAULT_HIGHLIGHT_COLOURS },
		};
		updateProject((p) => ({
			...p,
			disc: { ...p.disc, globalMenus: [...p.disc.globalMenus, newMenu] },
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
					{/* Menu list */}
					<div className="menus__list">
						{allMenus.map(({ menu, scope }) => (
							<div
								key={menu.id}
								className={`menus__item card ${menu.id === selectedMenuId ? 'menus__item--selected' : ''}`}
								onClick={() => setSelectedMenuId(menu.id)}
								role="button"
								tabIndex={0}
								onKeyDown={(e) => e.key === 'Enter' && setSelectedMenuId(menu.id)}
							>
								<div className="menus__item-info">
									<span className="menus__item-name">{menu.name}</span>
									<span className="menus__item-scope text-muted">
										{scope === 'global' ? 'Global' : 'Titleset'}
									</span>
								</div>
								<span className="badge badge--neutral">{menu.buttons.length} btn</span>
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
	const [showSafeArea, setShowSafeArea] = useState(true);
	const [previewMode, setPreviewMode] = useState(false);

	const backgroundAsset = menu.backgroundAssetId
		? (project.assets.find((a) => a.id === menu.backgroundAssetId) ?? null)
		: null;
	const backgroundAssetLabel = backgroundAsset ? backgroundAsset.fileName : null;

	const handleAddButton = () => {
		const newButton: MenuButton = {
			id: crypto.randomUUID(),
			label: `Button ${menu.buttons.length + 1}`,
			bounds: {
				x: 100 + menu.buttons.length * 20,
				y: Math.min(300 + menu.buttons.length * 20, canvasHeight - 60),
				width: 200,
				height: 40,
			},
			action: null,
			navUp: null,
			navDown: null,
			navLeft: null,
			navRight: null,
		};
		onUpdate((m) => ({ ...m, buttons: [...m.buttons, newButton] }));
	};

	const handleUpdateButton = (buttonId: string, updates: Partial<MenuButton>) => {
		onUpdate((m) => ({
			...m,
			buttons: m.buttons.map((b) => (b.id === buttonId ? { ...b, ...updates } : b)),
		}));
	};

	const handleRemoveButton = (buttonId: string) => {
		onUpdate((m) => ({
			...m,
			buttons: m.buttons.filter((b) => b.id !== buttonId),
			defaultButtonId: m.defaultButtonId === buttonId ? null : m.defaultButtonId,
		}));
	};

	return (
		<div className="menus__editor">
			{/* Menu canvas */}
			<div className="menus__canvas card">
				<div className="card__header">
					<input
						className="menus__editor-name"
						value={menu.name}
						onChange={(e) => onUpdate((m) => ({ ...m, name: e.target.value }))}
					/>
					<div className="menus__editor-actions">
						<button className="btn btn--sm" onClick={handleAddButton}>
							Add Button
						</button>
						<button
							className="btn btn--sm"
							onClick={onAutoNav}
							title="Auto-generate directional navigation from button positions"
						>
							Auto Nav
						</button>
						<label className="menus__toggle" title="Show safe-area guides">
							<input
								type="checkbox"
								checked={showSafeArea}
								onChange={(e) => setShowSafeArea(e.target.checked)}
							/>
							Safe Area
						</label>
						<label className="menus__toggle" title="Preview navigation with arrow keys">
							<input
								type="checkbox"
								checked={previewMode}
								onChange={(e) => setPreviewMode(e.target.checked)}
							/>
							Preview
						</label>
						<button className="btn btn--sm btn--danger" onClick={onRemove}>
							Delete Menu
						</button>
					</div>
				</div>

				{/* Background image assignment */}
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
						<option value="">None (solid colour)</option>
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
				</div>

				{/* Visual layout area */}
				<div className="menus__canvas-area">
					{previewMode ? (
						<NavigationPreview
							menu={menu}
							canvasHeight={canvasHeight}
							showSafeArea={showSafeArea}
							backgroundLabel={backgroundAssetLabel}
						/>
					) : (
						<MenuCanvas
							menu={menu}
							canvasHeight={canvasHeight}
							onUpdateButton={handleUpdateButton}
							showSafeArea={showSafeArea}
							backgroundLabel={backgroundAssetLabel}
						/>
					)}
				</div>
			</div>

			{/* Button properties */}
			{menu.buttons.length > 0 && (
				<div className="card menus__buttons">
					<h4 className="menus__section-heading">Buttons</h4>
					{menu.buttons.map((btn) => (
						<div key={btn.id} className="menus__button-row">
							<input
								className="menus__button-label"
								value={btn.label}
								onChange={(e) => handleUpdateButton(btn.id, { label: e.target.value })}
							/>
							<select
								className="menus__button-action"
								value={actionToString(btn.action)}
								onChange={(e) =>
									handleUpdateButton(btn.id, {
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
								<optgroup label="Show Menu">
									{allMenus
										.filter((m) => m.id !== menu.id)
										.map((m) => (
											<option key={m.id} value={`showMenu:${m.id}`}>
												{m.name}
											</option>
										))}
								</optgroup>
								<option value="stop">Stop</option>
							</select>
							<label className="menus__button-default" title="Default button">
								<input
									type="radio"
									name={`default-${menu.id}`}
									checked={menu.defaultButtonId === btn.id}
									onChange={() => onUpdate((m) => ({ ...m, defaultButtonId: btn.id }))}
								/>
								Default
							</label>
							<button
								className="menus__button-remove"
								onClick={() => handleRemoveButton(btn.id)}
								title="Remove button"
							>
								×
							</button>
						</div>
					))}

					{/* Navigation summary */}
					<div className="menus__nav-summary">
						<h4 className="menus__section-heading">Navigation</h4>
						{menu.buttons.map((btn) => (
							<div key={btn.id} className="menus__nav-row text-muted">
								<span className="menus__nav-btn-name">{btn.label}</span>
								<span>↑ {navLabel(btn.navUp, menu.buttons)}</span>
								<span>↓ {navLabel(btn.navDown, menu.buttons)}</span>
								<span>← {navLabel(btn.navLeft, menu.buttons)}</span>
								<span>→ {navLabel(btn.navRight, menu.buttons)}</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Highlight colours */}
			<div className="card menus__highlights">
				<h4 className="menus__section-heading">Overlay Highlight Colours</h4>
				<p className="menus__highlights-hint text-muted">
					DVD menus use a subpicture overlay with a 4-colour palette. The select colour is shown
					when a button is focused; the activate colour flashes when pressed.
				</p>
				<HighlightColourEditor
					colours={menu.highlightColours}
					onChange={(colours) => onUpdate((m) => ({ ...m, highlightColours: colours }))}
				/>
			</div>
		</div>
	);
}

function MenuCanvas({
	menu,
	canvasHeight,
	onUpdateButton,
	showSafeArea,
	backgroundLabel,
}: {
	menu: Menu;
	canvasHeight: number;
	onUpdateButton: (buttonId: string, updates: Partial<MenuButton>) => void;
	showSafeArea: boolean;
	backgroundLabel: string | null;
}) {
	const canvasRef = useRef<HTMLDivElement>(null);
	const dragState = useRef<{
		buttonId: string;
		startX: number;
		startY: number;
		startBounds: ButtonBounds;
	} | null>(null);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent, btn: MenuButton) => {
			e.preventDefault();
			const canvas = canvasRef.current;
			if (!canvas) return;

			dragState.current = {
				buttonId: btn.id,
				startX: e.clientX,
				startY: e.clientY,
				startBounds: { ...btn.bounds },
			};

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const state = dragState.current;
				if (!state || !canvas) return;

				const rect = canvas.getBoundingClientRect();
				const scaleX = MENU_WIDTH / rect.width;
				const scaleY = canvasHeight / rect.height;

				const dx = (moveEvent.clientX - state.startX) * scaleX;
				const dy = (moveEvent.clientY - state.startY) * scaleY;

				const newX = Math.max(
					0,
					Math.min(MENU_WIDTH - state.startBounds.width, state.startBounds.x + dx),
				);
				const newY = Math.max(
					0,
					Math.min(canvasHeight - state.startBounds.height, state.startBounds.y + dy),
				);

				onUpdateButton(state.buttonId, {
					bounds: {
						...state.startBounds,
						x: Math.round(newX),
						y: Math.round(newY),
					},
				});
			};

			const handleMouseUp = () => {
				dragState.current = null;
				document.removeEventListener('mousemove', handleMouseMove);
				document.removeEventListener('mouseup', handleMouseUp);
			};

			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
		},
		[onUpdateButton, canvasHeight],
	);

	return (
		<div
			className="menus__canvas-bg"
			ref={canvasRef}
			style={{ aspectRatio: `${MENU_WIDTH} / ${canvasHeight}` }}
		>
			{/* Background label */}
			{backgroundLabel && (
				<div className="menus__canvas-bg-label text-muted">{backgroundLabel}</div>
			)}
			{/* Safe-area guides */}
			{showSafeArea && (
				<>
					<div
						className="menus__safe-area menus__safe-area--action"
						style={{
							left: `${ACTION_SAFE_PCT * 100}%`,
							top: `${ACTION_SAFE_PCT * 100}%`,
							right: `${ACTION_SAFE_PCT * 100}%`,
							bottom: `${ACTION_SAFE_PCT * 100}%`,
						}}
					/>
					<div
						className="menus__safe-area menus__safe-area--title"
						style={{
							left: `${TITLE_SAFE_PCT * 100}%`,
							top: `${TITLE_SAFE_PCT * 100}%`,
							right: `${TITLE_SAFE_PCT * 100}%`,
							bottom: `${TITLE_SAFE_PCT * 100}%`,
						}}
					/>
				</>
			)}
			{menu.buttons.map((btn) => (
				<div
					key={btn.id}
					className={`menus__canvas-button ${menu.defaultButtonId === btn.id ? 'menus__canvas-button--default' : ''}`}
					style={{
						left: `${(btn.bounds.x / MENU_WIDTH) * 100}%`,
						top: `${(btn.bounds.y / canvasHeight) * 100}%`,
						width: `${(btn.bounds.width / MENU_WIDTH) * 100}%`,
						height: `${(btn.bounds.height / canvasHeight) * 100}%`,
					}}
					onMouseDown={(e) => handleMouseDown(e, btn)}
				>
					{btn.label}
				</div>
			))}
		</div>
	);
}

/** Keyboard-navigable preview of menu button focus. */
function NavigationPreview({
	menu,
	canvasHeight,
	showSafeArea,
	backgroundLabel,
}: {
	menu: Menu;
	canvasHeight: number;
	showSafeArea: boolean;
	backgroundLabel: string | null;
}) {
	const [focusedId, setFocusedId] = useState<string | null>(
		menu.defaultButtonId ?? menu.buttons[0]?.id ?? null,
	);
	const containerRef = useRef<HTMLDivElement>(null);

	// Focus the container so it receives key events
	useEffect(() => {
		containerRef.current?.focus();
	}, []);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			const btn = menu.buttons.find((b) => b.id === focusedId);
			if (!btn) return;

			let nextId: string | null = null;

			switch (e.key) {
				case 'ArrowUp':
					nextId = btn.navUp;
					break;
				case 'ArrowDown':
					nextId = btn.navDown;
					break;
				case 'ArrowLeft':
					nextId = btn.navLeft;
					break;
				case 'ArrowRight':
					nextId = btn.navRight;
					break;
				case 'Enter':
				case ' ':
					// Visual feedback for activation
					break;
				default:
					return;
			}

			e.preventDefault();
			if (nextId) {
				setFocusedId(nextId);
			}
		},
		[focusedId, menu.buttons],
	);

	return (
		<div
			className="menus__canvas-bg menus__canvas-bg--preview"
			ref={containerRef}
			tabIndex={0}
			onKeyDown={handleKeyDown}
			style={{ aspectRatio: `${MENU_WIDTH} / ${canvasHeight}` }}
		>
			{backgroundLabel && (
				<div className="menus__canvas-bg-label text-muted">{backgroundLabel}</div>
			)}
			{showSafeArea && (
				<>
					<div
						className="menus__safe-area menus__safe-area--action"
						style={{
							left: `${ACTION_SAFE_PCT * 100}%`,
							top: `${ACTION_SAFE_PCT * 100}%`,
							right: `${ACTION_SAFE_PCT * 100}%`,
							bottom: `${ACTION_SAFE_PCT * 100}%`,
						}}
					/>
					<div
						className="menus__safe-area menus__safe-area--title"
						style={{
							left: `${TITLE_SAFE_PCT * 100}%`,
							top: `${TITLE_SAFE_PCT * 100}%`,
							right: `${TITLE_SAFE_PCT * 100}%`,
							bottom: `${TITLE_SAFE_PCT * 100}%`,
						}}
					/>
				</>
			)}
			<div className="menus__preview-hint text-muted">
				Use arrow keys to navigate. Press Enter to activate.
			</div>
			{menu.buttons.map((btn) => {
				const isFocused = btn.id === focusedId;
				const hl = menu.highlightColours;
				return (
					<div
						key={btn.id}
						className={`menus__canvas-button ${isFocused ? 'menus__canvas-button--focused' : ''} ${menu.defaultButtonId === btn.id ? 'menus__canvas-button--default' : ''}`}
						style={{
							left: `${(btn.bounds.x / MENU_WIDTH) * 100}%`,
							top: `${(btn.bounds.y / canvasHeight) * 100}%`,
							width: `${(btn.bounds.width / MENU_WIDTH) * 100}%`,
							height: `${(btn.bounds.height / canvasHeight) * 100}%`,
							...(isFocused
								? {
										background: hexToRgba(hl.selectColour, hl.selectOpacity),
										borderColor: hl.selectColour,
										boxShadow: `0 0 12px ${hexToRgba(hl.selectColour, 0.5)}, 0 0 24px ${hexToRgba(hl.selectColour, 0.2)}`,
									}
								: {}),
						}}
						onClick={() => setFocusedId(btn.id)}
					>
						{btn.label}
					</div>
				);
			})}
		</div>
	);
}

/** Editor for DVD subpicture overlay highlight colours. */
function HighlightColourEditor({
	colours,
	onChange,
}: {
	colours: MenuHighlightColours;
	onChange: (colours: MenuHighlightColours) => void;
}) {
	return (
		<div className="menus__colour-grid">
			<div className="menus__colour-field">
				<label className="menus__colour-label">Select Colour</label>
				<div className="menus__colour-row">
					<input
						type="color"
						className="menus__colour-input"
						value={colours.selectColour}
						onChange={(e) => onChange({ ...colours, selectColour: e.target.value })}
					/>
					<input
						className="menus__colour-hex"
						value={colours.selectColour}
						onChange={(e) => onChange({ ...colours, selectColour: e.target.value })}
						maxLength={7}
					/>
				</div>
				<div className="menus__colour-row">
					<label className="text-muted">Opacity</label>
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
				<div
					className="menus__colour-swatch"
					style={{
						background: colours.selectColour,
						opacity: colours.selectOpacity,
					}}
				/>
			</div>
			<div className="menus__colour-field">
				<label className="menus__colour-label">Activate Colour</label>
				<div className="menus__colour-row">
					<input
						type="color"
						className="menus__colour-input"
						value={colours.activateColour}
						onChange={(e) => onChange({ ...colours, activateColour: e.target.value })}
					/>
					<input
						className="menus__colour-hex"
						value={colours.activateColour}
						onChange={(e) => onChange({ ...colours, activateColour: e.target.value })}
						maxLength={7}
					/>
				</div>
				<div className="menus__colour-row">
					<label className="text-muted">Opacity</label>
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
				<div
					className="menus__colour-swatch"
					style={{
						background: colours.activateColour,
						opacity: colours.activateOpacity,
					}}
				/>
			</div>
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
	const [type, id] = str.split(':');
	if (type === 'playTitle' && id) return { type: 'playTitle', titleId: id };
	if (type === 'showMenu' && id) return { type: 'showMenu', menuId: id };
	return null;
}

function navLabel(navId: string | null, buttons: MenuButton[]): string {
	if (!navId) return '—';
	const btn = buttons.find((b) => b.id === navId);
	return btn ? btn.label : '?';
}

/** Convert a CSS hex colour + opacity to an rgba() string. */
function hexToRgba(hex: string, opacity: number): string {
	const h = hex.replace('#', '');
	const r = parseInt(h.substring(0, 2), 16) || 0;
	const g = parseInt(h.substring(2, 4), 16) || 0;
	const b = parseInt(h.substring(4, 6), 16) || 0;
	return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
