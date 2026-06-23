// Small reusable inspector fields shared between the menu-level and button
// inspectors: the action-target option list and the CLUT highlight colour pair.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { Title, Menu, MenuDomain, MenuHighlightColours } from '../../types/project';

export function ActionOptions({
	allTitles,
	allMenus,
	currentMenuId,
	menuDomain,
}: {
	allTitles: Title[];
	allMenus: Menu[];
	currentMenuId: string;
	menuDomain?: MenuDomain;
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

export function HighlightColourFields({
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
