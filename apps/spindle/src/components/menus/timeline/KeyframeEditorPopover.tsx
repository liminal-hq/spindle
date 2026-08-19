// Double-click-a-keyframe popover: value (colour/opacity), easing, timestamp,
// and delete.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useLayoutEffect, useRef } from 'react';
import type { AnimatableProperty, Easing, Keyframe, KeyValue } from '../../../types/project';

const EASING_OPTIONS: Easing[] = ['hold', 'linear', 'ease-in', 'ease-out', 'ease-in-out'];

/** The scroll container the popover must stay visible inside — see
 * `TimelineStrip`'s `.timeline-strip__scroll`, which the ruler/lanes (and
 * this popover, rendered as a keyframe lane's child) all live under. */
const SCROLL_VIEWPORT_SELECTOR = '.timeline-strip__scroll';

export interface KeyframeEditorPopoverProps {
	keyframe: Keyframe;
	target: AnimatableProperty;
	/** The motion loop's duration — the same upper bound drags/inserts clamp
	 * a keyframe's timestamp to, so a typed value can't persist past it and
	 * trip `menu.motion-keyframe-out-of-range`. */
	loopDurationSecs: number;
	/** The keyframe diamond's own x position, in the shared source-relative
	 * px space (same as `TimelineKeyframeLane`'s diamond `left`) — where the
	 * popover anchors before the visible-viewport clamp below runs. Without
	 * this the popover always opened at the scrolled content's x=0, which
	 * after scrolling to a later keyframe could land far outside the
	 * visible scroll viewport. */
	anchorPx: number;
	onChangeValue: (value: KeyValue) => void;
	onChangeEasing: (easing: Easing) => void;
	onChangeTimestamp: (timestampSecs: number) => void;
	onDelete: () => void;
	onClose: () => void;
}

export function KeyframeEditorPopover({
	keyframe,
	target,
	loopDurationSecs,
	anchorPx,
	onChangeValue,
	onChangeEasing,
	onChangeTimestamp,
	onDelete,
	onClose,
}: KeyframeEditorPopoverProps) {
	const isColour = keyframe.value.kind === 'colour';
	const isScalar = keyframe.value.kind === 'scalar';
	const popoverRef = useRef<HTMLDivElement>(null);

	// Anchor near the keyframe, then clamp fully inside the visible scroll
	// viewport — `anchorPx` alone can still overflow the viewport's right
	// (a keyframe near the end of a wide timeline, popover's own width) or
	// left (a keyframe right at the current scroll offset) edge. Measured
	// imperatively, like the scrubber/ruler scroll sync above it, rather
	// than kept in React state, since it only needs to run once per open
	// keyframe, not on every render.
	useLayoutEffect(() => {
		const popoverEl = popoverRef.current;
		if (!popoverEl) return;
		popoverEl.style.left = `${anchorPx}px`;
		const scrollEl = popoverEl.closest<HTMLElement>(SCROLL_VIEWPORT_SELECTOR);
		if (!scrollEl) return;
		const viewportLeft = scrollEl.scrollLeft;
		const viewportRight = viewportLeft + scrollEl.clientWidth;
		const width = popoverEl.offsetWidth;
		let left = anchorPx;
		if (left + width > viewportRight) left = viewportRight - width;
		if (left < viewportLeft) left = viewportLeft;
		popoverEl.style.left = `${Math.max(left, 0)}px`;
	}, [anchorPx]);

	return (
		<div
			ref={popoverRef}
			className="keyframe-popover"
			role="dialog"
			aria-label={`Edit ${target} keyframe`}
			onKeyDown={(e) => {
				// Delete/Backspace inside a popover input/select must edit the
				// input, not bubble to the lane's onKeyDown and delete the
				// keyframe this popover is editing (see `TimelineKeyframeLane`'s
				// `handleKeyDown`).
				if (e.key === 'Delete' || e.key === 'Backspace') {
					e.stopPropagation();
				}
			}}
			onClick={(e) => {
				// The popover renders as a child of the lane it edits — a click
				// on any of its inputs/buttons (including the number/colour
				// inputs' native chrome) would otherwise bubble to the lane's
				// `onClick` and seek playback underneath it.
				e.stopPropagation();
			}}
			onDoubleClick={(e) => {
				// Same hazard as `onClick` above, but for the lane's
				// `onDoubleClick` (`handleLaneDoubleClick`), which INSERTS a new
				// keyframe — double-clicking a popover field (e.g. to select an
				// input's text) must never edit the lane underneath it.
				e.stopPropagation();
			}}
		>
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
						onChange={(e) => {
							// `<input type="color">` only ever edits/reports 6-hex
							// RGB — reapply the keyframe's original alpha byte (if
							// it had one) so an alpha-carrying `#rrggbbaa` colour
							// doesn't silently go opaque on the next edit.
							const original = keyframe.value.kind === 'colour' ? keyframe.value.hex : '';
							const alphaSuffix = original.length === 9 ? original.slice(7, 9) : '';
							onChangeValue({ kind: 'colour', hex: `${e.target.value}${alphaSuffix}` });
						}}
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
					max={loopDurationSecs}
					step={0.1}
					value={keyframe.timestampSecs}
					onChange={(e) =>
						onChangeTimestamp(Math.min(Math.max(0, Number(e.target.value)), loopDurationSecs))
					}
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
