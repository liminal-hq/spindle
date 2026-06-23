// Per-state visual controls for a button node: Normal/Focus/Activate with
// background, border, radius, padding, and shadow/glow. Wired to ButtonStyleMap.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { ButtonStyleMap, ButtonStateStyle } from '../../types/project';
import { CollapsibleSection } from './InspectorCollapsibleSection';

export type ButtonVisualState = 'normal' | 'focus' | 'activate';

export function ButtonStyleSection({
	style,
	onChange,
	activeState,
	onActiveStateChange,
}: {
	style: ButtonStyleMap;
	onChange: (style: ButtonStyleMap) => void;
	activeState: ButtonVisualState;
	onActiveStateChange?: (state: ButtonVisualState) => void;
}) {
	const s = style[activeState];
	const update = (patch: Partial<ButtonStateStyle>) =>
		onChange({ ...style, [activeState]: { ...s, ...patch } });

	return (
		<CollapsibleSection title="Button Style">
			{/* State sub-tabs */}
			<div className="inspector-panel__state-tabs">
				{(['normal', 'focus', 'activate'] as const).map((state) => (
					<button
						key={state}
						className={`inspector-panel__state-tab ${activeState === state ? 'inspector-panel__state-tab--active' : ''}`}
						type="button"
						onClick={() => onActiveStateChange?.(state)}
					>
						{state.charAt(0).toUpperCase() + state.slice(1)}
					</button>
				))}
			</div>

			{/* Background */}
			<div className="inspector-panel__sub-label">Background</div>
			<div className="inspector-panel__field">
				<span className="inspector-panel__field-label">Fill</span>
				<input
					className="inspector-panel__input"
					value={s.bgFill}
					onChange={(e) => update({ bgFill: e.target.value })}
					style={{ flex: 1 }}
				/>
			</div>

			{/* Border */}
			<div className="inspector-panel__sub-label">Border</div>
			<div className="inspector-panel__grid-2">
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Colour</span>
					<div className="inspector-panel__colour-row">
						<input
							type="color"
							className="inspector-panel__colour-input"
							value={s.borderColour.length <= 7 ? s.borderColour : '#ffffff'}
							onChange={(e) => update({ borderColour: e.target.value })}
						/>
						<input
							className="inspector-panel__input inspector-panel__input--hex"
							value={s.borderColour}
							onChange={(e) => update({ borderColour: e.target.value })}
						/>
					</div>
				</label>
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">Width</span>
					<div className="inspector-panel__inline-unit">
						<input
							className="inspector-panel__input inspector-panel__input--num"
							type="number"
							value={s.borderWidth}
							onChange={(e) => update({ borderWidth: Number(e.target.value) })}
						/>
						<span className="inspector-panel__unit">px</span>
					</div>
				</label>
			</div>
			<label className="inspector-panel__field">
				<span className="inspector-panel__field-label">Radius</span>
				<div className="inspector-panel__inline-unit">
					<input
						className="inspector-panel__input inspector-panel__input--num"
						type="number"
						value={s.borderRadius}
						onChange={(e) => update({ borderRadius: Number(e.target.value) })}
					/>
					<span className="inspector-panel__unit">px</span>
				</div>
			</label>

			{/* Padding */}
			<div className="inspector-panel__sub-label">Padding</div>
			<div className="inspector-panel__grid-2">
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">H</span>
					<input
						className="inspector-panel__input inspector-panel__input--num"
						type="number"
						value={s.paddingH}
						onChange={(e) => update({ paddingH: Number(e.target.value) })}
					/>
				</label>
				<label className="inspector-panel__field">
					<span className="inspector-panel__field-label">V</span>
					<input
						className="inspector-panel__input inspector-panel__input--num"
						type="number"
						value={s.paddingV}
						onChange={(e) => update({ paddingV: Number(e.target.value) })}
					/>
				</label>
			</div>

			{/* Shadow / Glow */}
			<div className="inspector-panel__sub-label">Shadow / Glow</div>
			<label className="inspector-panel__field">
				<span className="inspector-panel__field-label">Type</span>
				<select
					className="inspector-panel__select"
					value={s.shadowType}
					onChange={(e) => update({ shadowType: e.target.value as ButtonStateStyle['shadowType'] })}
				>
					<option value="none">None</option>
					<option value="box-shadow">Box shadow</option>
					<option value="outer-glow">Outer glow</option>
					<option value="inner-glow">Inner glow</option>
				</select>
			</label>
			{s.shadowType !== 'none' && (
				<>
					<label className="inspector-panel__field">
						<span className="inspector-panel__field-label">Colour</span>
						<div className="inspector-panel__colour-row">
							<input
								type="color"
								className="inspector-panel__colour-input"
								value={s.shadowColour.length <= 7 ? s.shadowColour : '#ffa840'}
								onChange={(e) => update({ shadowColour: e.target.value })}
							/>
							<input
								className="inspector-panel__input inspector-panel__input--hex"
								value={s.shadowColour}
								onChange={(e) => update({ shadowColour: e.target.value })}
							/>
						</div>
					</label>
					<div className="inspector-panel__grid-2">
						<label className="inspector-panel__field">
							<span className="inspector-panel__field-label">Blur</span>
							<input
								className="inspector-panel__input inspector-panel__input--num"
								type="number"
								value={s.shadowBlur}
								onChange={(e) => update({ shadowBlur: Number(e.target.value) })}
							/>
						</label>
						<label className="inspector-panel__field">
							<span className="inspector-panel__field-label">Spread</span>
							<input
								className="inspector-panel__input inspector-panel__input--num"
								type="number"
								value={s.shadowSpread}
								onChange={(e) => update({ shadowSpread: Number(e.target.value) })}
							/>
						</label>
					</div>
				</>
			)}
		</CollapsibleSection>
	);
}
