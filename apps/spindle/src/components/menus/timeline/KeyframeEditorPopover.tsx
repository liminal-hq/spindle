// Double-click-a-keyframe popover: value (colour/opacity), easing, timestamp,
// and delete.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { AnimatableProperty, Easing, Keyframe, KeyValue } from '../../../types/project';

const EASING_OPTIONS: Easing[] = ['hold', 'linear', 'ease-in', 'ease-out', 'ease-in-out'];

export interface KeyframeEditorPopoverProps {
	keyframe: Keyframe;
	target: AnimatableProperty;
	onChangeValue: (value: KeyValue) => void;
	onChangeEasing: (easing: Easing) => void;
	onChangeTimestamp: (timestampSecs: number) => void;
	onDelete: () => void;
	onClose: () => void;
}

export function KeyframeEditorPopover({
	keyframe,
	target,
	onChangeValue,
	onChangeEasing,
	onChangeTimestamp,
	onDelete,
	onClose,
}: KeyframeEditorPopoverProps) {
	const isColour = keyframe.value.kind === 'colour';
	const isScalar = keyframe.value.kind === 'scalar';

	return (
		<div className="keyframe-popover" role="dialog" aria-label={`Edit ${target} keyframe`}>
			<div className="keyframe-popover__header">
				<span className="keyframe-popover__title">{target}</span>
				<button
					type="button"
					className="keyframe-popover__close"
					onClick={onClose}
					aria-label="Close"
				>
					×
				</button>
			</div>

			{isColour && (
				<label className="keyframe-popover__field">
					<span>Colour</span>
					<input
						type="color"
						value={keyframe.value.kind === 'colour' ? keyframe.value.hex.slice(0, 7) : '#ffffff'}
						onChange={(e) => onChangeValue({ kind: 'colour', hex: e.target.value })}
					/>
				</label>
			)}

			{isScalar && (
				<label className="keyframe-popover__field">
					<span>Opacity</span>
					<input
						type="number"
						min={0}
						max={1}
						step={0.05}
						value={keyframe.value.kind === 'scalar' ? keyframe.value.value : 0}
						onChange={(e) => onChangeValue({ kind: 'scalar', value: Number(e.target.value) })}
					/>
				</label>
			)}

			<label className="keyframe-popover__field">
				<span>Easing</span>
				<select value={keyframe.easing} onChange={(e) => onChangeEasing(e.target.value as Easing)}>
					{EASING_OPTIONS.map((easing) => (
						<option key={easing} value={easing}>
							{easing}
						</option>
					))}
				</select>
			</label>

			<label className="keyframe-popover__field">
				<span>Timestamp (s)</span>
				<input
					type="number"
					min={0}
					step={0.1}
					value={keyframe.timestampSecs}
					onChange={(e) => onChangeTimestamp(Math.max(0, Number(e.target.value)))}
				/>
			</label>

			<button
				type="button"
				className="btn btn--sm btn--danger keyframe-popover__delete"
				onClick={onDelete}
			>
				Delete Keyframe
			</button>
		</div>
	);
}
