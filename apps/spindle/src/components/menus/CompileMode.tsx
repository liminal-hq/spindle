// Compile mode — DVD-safe preview and downgrade diagnostics.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { MenuButton, MenuHighlightColours, MenuDocument } from '../../types/project';

export interface CompileModeProps {
	document: MenuDocument | null;
	buttons: MenuButton[];
	canvasHeight: number;
	highlightColours: MenuHighlightColours;
	defaultFocusId: string | null;
	backgroundLabel: string | null;
}

/** DVD constraint thresholds. */
const MAX_DVD_BUTTONS = 36;
const DVD_PALETTE_COLOURS = 4; // highlight overlay is 4-colour max

interface Diagnostic {
	severity: 'info' | 'warning' | 'error';
	message: string;
}

export function CompileMode({
	document,
	buttons,
	canvasHeight,
	highlightColours,
	defaultFocusId,
	backgroundLabel,
}: CompileModeProps) {
	const diagnostics = computeDiagnostics(document, buttons);

	return (
		<div className="compile-mode">
			{/* DVD Preview */}
			<div className="compile-mode__preview">
				<h4 className="compile-mode__title">DVD-Safe Preview</h4>
				<p className="compile-mode__hint text-muted">
					This shows how the menu will appear after compilation to DVD format. Colours are reduced
					to the subpicture overlay palette.
				</p>
				<div className="compile-mode__canvas" style={{ aspectRatio: `720 / ${canvasHeight}` }}>
					{backgroundLabel && (
						<div className="compile-mode__bg-label text-muted">{backgroundLabel}</div>
					)}
					<div className="compile-mode__badge">DVD Output</div>
					{buttons.map((btn) => {
						const isFocused = btn.id === defaultFocusId;
						return (
							<div
								key={btn.id}
								className={`compile-mode__button ${isFocused ? 'compile-mode__button--focused' : ''}`}
								style={{
									left: `${(btn.bounds.x / 720) * 100}%`,
									top: `${(btn.bounds.y / canvasHeight) * 100}%`,
									width: `${(btn.bounds.width / 720) * 100}%`,
									height: `${(btn.bounds.height / canvasHeight) * 100}%`,
									...(isFocused
										? {
												background: hexToRgba(
													highlightColours.selectColour,
													highlightColours.selectOpacity,
												),
												borderColor: highlightColours.selectColour,
											}
										: {}),
								}}
							>
								{btn.label}
							</div>
						);
					})}
				</div>
			</div>

			{/* Compile Policy */}
			{document && (
				<div className="compile-mode__policy">
					<h4 className="compile-mode__title">Compile Policy</h4>
					<div className="compile-mode__policy-grid">
						<div className="compile-mode__policy-item">
							<span className="compile-mode__policy-label text-muted">Safe Area</span>
							<span className="compile-mode__policy-value">
								{document.compilePolicy.safeAreaMode}
							</span>
						</div>
						<div className="compile-mode__policy-item">
							<span className="compile-mode__policy-label text-muted">Palette Strategy</span>
							<span className="compile-mode__policy-value">
								{document.compilePolicy.paletteStrategy}
							</span>
						</div>
						<div className="compile-mode__policy-item">
							<span className="compile-mode__policy-label text-muted">Background Mode</span>
							<span className="compile-mode__policy-value">{document.backgroundMode}</span>
						</div>
					</div>
				</div>
			)}

			{/* Overlay Palette */}
			<div className="compile-mode__palette">
				<h4 className="compile-mode__title">Overlay Palette</h4>
				<p className="compile-mode__hint text-muted">
					DVD subpicture overlays support a maximum of {DVD_PALETTE_COLOURS} colours (including
					transparent).
				</p>
				<div className="compile-mode__palette-swatches">
					<div className="compile-mode__swatch">
						<div
							className="compile-mode__swatch-colour"
							style={{
								background: highlightColours.selectColour,
								opacity: highlightColours.selectOpacity,
							}}
						/>
						<span className="compile-mode__swatch-label text-muted">Select</span>
					</div>
					<div className="compile-mode__swatch">
						<div
							className="compile-mode__swatch-colour"
							style={{
								background: highlightColours.activateColour,
								opacity: highlightColours.activateOpacity,
							}}
						/>
						<span className="compile-mode__swatch-label text-muted">Activate</span>
					</div>
					<div className="compile-mode__swatch">
						<div
							className="compile-mode__swatch-colour"
							style={{ background: 'transparent', border: '1px dashed var(--border-subtle)' }}
						/>
						<span className="compile-mode__swatch-label text-muted">Transparent</span>
					</div>
				</div>
			</div>

			{/* Diagnostics */}
			<div className="compile-mode__diagnostics">
				<h4 className="compile-mode__title">Downgrade Report</h4>
				{diagnostics.length === 0 ? (
					<p className="compile-mode__hint" style={{ color: 'var(--colour-success, #4ade80)' }}>
						No issues detected. Menu is DVD-safe.
					</p>
				) : (
					<div className="compile-mode__diagnostic-list">
						{diagnostics.map((d, i) => (
							<div
								key={i}
								className={`compile-mode__diagnostic compile-mode__diagnostic--${d.severity}`}
							>
								<span className="compile-mode__diagnostic-badge">
									{d.severity === 'error' ? 'ERR' : d.severity === 'warning' ? 'WARN' : 'INFO'}
								</span>
								<span>{d.message}</span>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

// ── Diagnostics ────────────────────────────────────────────────────────────

function computeDiagnostics(doc: MenuDocument | null, buttons: MenuButton[]): Diagnostic[] {
	const results: Diagnostic[] = [];

	// Button count
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
			message: 'No default focus button set. The first button will be focused by default.',
		});
	}

	// Broken navigation references
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

	// Unreachable buttons (no navigation points to them and they're not default)
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

	// Motion menu info
	if (doc?.backgroundMode === 'motion') {
		results.push({
			severity: 'info',
			message: 'Motion menu: background will be rendered as looping MPEG video.',
		});
	}

	return results;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, opacity: number): string {
	const h = hex.replace('#', '');
	const r = parseInt(h.substring(0, 2), 16) || 0;
	const g = parseInt(h.substring(2, 4), 16) || 0;
	const b = parseInt(h.substring(4, 6), 16) || 0;
	return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
