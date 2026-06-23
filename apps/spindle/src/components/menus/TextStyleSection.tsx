// Typography controls for button labels and text nodes: font, size, weight,
// italic, underline, colour, alignment, line height, letter spacing.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { FontEntry } from '../../types/project';
import { CollapsibleSection } from './InspectorCollapsibleSection';

export function TextStyleSection({
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
