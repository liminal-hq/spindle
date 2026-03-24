// Menus page — define menu layouts, buttons, and navigation for the disc.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState, useRef, useCallback } from 'react';
import { useProjectStore } from '../store/project-store';
import type {
	Menu,
	MenuButton,
	ButtonBounds,
	PlaybackAction,
	SpindleProjectFile,
	VideoStandard,
} from '../types/project';

// DVD menu canvas dimensions vary by video standard
const MENU_WIDTH = 720;
const MENU_HEIGHT: Record<VideoStandard, number> = { NTSC: 480, PAL: 576 };
import './MenusPage.css';

export function MenusPage() {
	const project = useProjectStore((s) => s.project);
	const updateProject = useProjectStore((s) => s.updateProject);
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
}: {
	menu: Menu;
	project: SpindleProjectFile;
	canvasHeight: number;
	onUpdate: (updater: (m: Menu) => Menu) => void;
	onRemove: () => void;
}) {
	const allTitles = project.disc.titlesets.flatMap((ts) => ts.titles);
	const allMenus = [
		...project.disc.globalMenus,
		...project.disc.titlesets.flatMap((ts) => ts.menus),
	];

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
			{/* Menu canvas (simplified) */}
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
						<button className="btn btn--sm btn--danger" onClick={onRemove}>
							Delete Menu
						</button>
					</div>
				</div>

				{/* Visual layout area */}
				<div className="menus__canvas-area">
					<MenuCanvas menu={menu} canvasHeight={canvasHeight} onUpdateButton={handleUpdateButton} />
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
				</div>
			)}
		</div>
	);
}

function MenuCanvas({
	menu,
	canvasHeight,
	onUpdateButton,
}: {
	menu: Menu;
	canvasHeight: number;
	onUpdateButton: (buttonId: string, updates: Partial<MenuButton>) => void;
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
