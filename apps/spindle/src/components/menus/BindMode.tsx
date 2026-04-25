// Bind mode — connect authored scene nodes to project metadata.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { MenuButton, MenuDomain, PlaybackAction, Title, Menu } from '../../types/project';

export interface BindModeProps {
	buttons: MenuButton[];
	allTitles: Title[];
	allMenus: Menu[];
	currentMenuId: string;
	menuDomain?: MenuDomain;
	defaultFocusId: string | null;
	onUpdateButton: (buttonId: string, updates: Partial<MenuButton>) => void;
	onSetDefaultFocus: (buttonId: string) => void;
}

export function BindMode({
	buttons,
	allTitles,
	allMenus,
	currentMenuId,
	menuDomain,
	defaultFocusId,
	onUpdateButton,
	onSetDefaultFocus,
}: BindModeProps) {
	return (
		<div className="bind-mode">
			<div className="bind-mode__header">
				<h4 className="bind-mode__title">Action Bindings</h4>
				<p className="bind-mode__hint text-muted">
					Connect each button to a playback action. Set which button receives initial focus.
				</p>
			</div>

			{buttons.length === 0 ? (
				<div className="bind-mode__empty text-muted">
					No buttons to bind. Switch to Design mode and add buttons first.
				</div>
			) : (
				<div className="bind-mode__table">
					<div className="bind-mode__row bind-mode__row--header">
						<span className="bind-mode__col bind-mode__col--name">Button</span>
						<span className="bind-mode__col bind-mode__col--action">Action</span>
						<span className="bind-mode__col bind-mode__col--default">Default</span>
					</div>
					{buttons.map((btn) => (
						<div key={btn.id} className="bind-mode__row">
							<span className="bind-mode__col bind-mode__col--name">{btn.label}</span>
							<span className="bind-mode__col bind-mode__col--action">
								<select
									className="bind-mode__select"
									value={actionToString(btn.action)}
									onChange={(e) =>
										onUpdateButton(btn.id, {
											action: stringToAction(e.target.value),
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
									{menuDomain === 'titleset' && (
										<optgroup label="Titleset">
											<option value="playAllInTitleset">Play All in Titleset</option>
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
							</span>
							<span className="bind-mode__col bind-mode__col--default">
								<input
									type="radio"
									name="default-focus"
									checked={defaultFocusId === btn.id}
									onChange={() => onSetDefaultFocus(btn.id)}
								/>
							</span>
						</div>
					))}
				</div>
			)}

			{/* Navigation summary */}
			{buttons.length > 0 && (
				<div className="bind-mode__nav-section">
					<h4 className="bind-mode__title">Navigation</h4>
					<p className="bind-mode__hint text-muted">
						Directional navigation for DVD remote control.
					</p>
					<div className="bind-mode__table">
						<div className="bind-mode__row bind-mode__row--header">
							<span className="bind-mode__col bind-mode__col--name">Button</span>
							<span className="bind-mode__col bind-mode__col--nav">Up</span>
							<span className="bind-mode__col bind-mode__col--nav">Down</span>
							<span className="bind-mode__col bind-mode__col--nav">Left</span>
							<span className="bind-mode__col bind-mode__col--nav">Right</span>
						</div>
						{buttons.map((btn) => (
							<div key={btn.id} className="bind-mode__row">
								<span className="bind-mode__col bind-mode__col--name">{btn.label}</span>
								{(['navUp', 'navDown', 'navLeft', 'navRight'] as const).map((dir) => (
									<span key={dir} className="bind-mode__col bind-mode__col--nav">
										<select
											className="bind-mode__select bind-mode__select--nav"
											value={btn[dir] ?? ''}
											onChange={(e) => onUpdateButton(btn.id, { [dir]: e.target.value || null })}
										>
											<option value="">—</option>
											{buttons
												.filter((b) => b.id !== btn.id)
												.map((b) => (
													<option key={b.id} value={b.id}>
														{b.label}
													</option>
												))}
										</select>
									</span>
								))}
							</div>
						))}
					</div>
				</div>
			)}
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
		case 'setAudioStream':
			return `setAudioStream:${action.streamIndex}`;
		case 'setSubtitleStream':
			return `setSubtitleStream:${action.streamIndex ?? 'null'}`;
		case 'stop':
			return 'stop';
		case 'playAllInTitleset':
			return 'playAllInTitleset';
		default:
			return '';
	}
}

function stringToAction(str: string): PlaybackAction | null {
	if (!str) return null;
	if (str === 'stop') return { type: 'stop' };
	if (str === 'playAllInTitleset') return { type: 'playAllInTitleset' };
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
