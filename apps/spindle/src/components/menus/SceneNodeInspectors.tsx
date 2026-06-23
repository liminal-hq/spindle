// Per-node-type inspector panels for non-button scene nodes: text, image,
// shape, and the generic fallback for node types without a dedicated panel.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { SceneNode, Asset, FontEntry } from '../../types/project';
import { CollapsibleSection } from './InspectorCollapsibleSection';
import { TextStyleSection } from './TextStyleSection';

export function TextNodeInspector({
	node,
	onUpdate,
	onRemove,
	availableFonts,
}: {
	node: Extract<SceneNode, { type: 'text' }>;
	onUpdate?: (nodeId: string, updates: Record<string, unknown>) => void;
	onRemove?: (nodeId: string) => void;
	availableFonts?: FontEntry[];
}) {
	return (
		<div className="inspector-panel__section-group">
			<CollapsibleSection title="Text" defaultOpen>
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Content</span>
					<input
						className="inspector-panel__input"
						value={node.content}
						onChange={(e) => onUpdate?.(node.id, { content: e.target.value })}
					/>
				</label>
			</CollapsibleSection>
			<CollapsibleSection title="Transform" defaultOpen>
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
			</CollapsibleSection>
			{/* Text Style — full typography panel */}
			<TextStyleSection
				fontFamily={node.fontFamily}
				fontSize={node.fontSize ?? 24}
				fontWeight={node.fontWeight}
				fontItalic={node.fontItalic}
				textDecoration={node.textDecoration}
				textAlign={node.textAlign}
				colour={node.colour ?? '#ffffff'}
				lineHeight={node.lineHeight}
				letterSpacing={node.letterSpacing}
				onFontFamilyChange={(fontFamily) => onUpdate?.(node.id, { fontFamily })}
				onFontSizeChange={(fontSize) => onUpdate?.(node.id, { fontSize })}
				onFontWeightChange={(fontWeight) => onUpdate?.(node.id, { fontWeight })}
				onFontItalicChange={(fontItalic) => onUpdate?.(node.id, { fontItalic })}
				onTextDecorationChange={(textDecoration) => onUpdate?.(node.id, { textDecoration })}
				onTextAlignChange={(textAlign) => onUpdate?.(node.id, { textAlign })}
				onColourChange={(colour) => onUpdate?.(node.id, { colour })}
				onLineHeightChange={(lineHeight) => onUpdate?.(node.id, { lineHeight })}
				onLetterSpacingChange={(letterSpacing) => onUpdate?.(node.id, { letterSpacing })}
				availableFonts={availableFonts}
			/>
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

export function ImageNodeInspector({
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
			<CollapsibleSection title="Image" defaultOpen>
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
			</CollapsibleSection>
			<CollapsibleSection title="Transform" defaultOpen>
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
			</CollapsibleSection>
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

export function ShapeNodeInspector({
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
			<CollapsibleSection title="Shape" defaultOpen>
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
			</CollapsibleSection>
			<CollapsibleSection title="Transform" defaultOpen>
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
			</CollapsibleSection>
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

export function GenericNodeInspector({ node }: { node: SceneNode }) {
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
