// Rail entries for the menus workspace: a single menu's preview/status row,
// and the empty-state panel shown when no menu is selected.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { Menu, SceneNode } from '../../types/project';
import type { MenuConnectionCounts } from './menuProjectHelpers';

function clampPercent(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function getMenuPreviewBlocks(menu: Menu): Array<{ x: number; y: number; width: number }> {
	const designWidth = menu.authoredDocument?.scene.designSize.width ?? 720;
	const designHeight = menu.authoredDocument?.scene.designSize.height ?? 480;
	const authoredButtons = menu.authoredDocument?.scene.nodes
		.filter((node): node is Extract<SceneNode, { type: 'button' }> => node.type === 'button')
		.map((button) => ({
			x: button.x,
			y: button.y,
			width: button.width,
		}));
	const legacyButtons =
		authoredButtons ??
		menu.buttons.map((button) => ({
			x: button.bounds.x,
			y: button.bounds.y,
			width: button.bounds.width,
		}));

	return legacyButtons
		.slice()
		.sort((left, right) => left.y - right.y || left.x - right.x)
		.map((button) => ({
			x: clampPercent((button.x / designWidth) * 100, 6, 82),
			y: clampPercent((button.y / designHeight) * 100, 12, 82),
			width: clampPercent((button.width / designWidth) * 100, 18, 82),
		}));
}

function getMenuPreviewBackground(menu: Menu): string {
	const backgroundColour = menu.authoredDocument?.scene.background.colour;
	if (backgroundColour) {
		return `linear-gradient(135deg, ${backgroundColour}, rgba(5, 5, 7, 0.92))`;
	}
	return 'linear-gradient(135deg, #1a1828, #0f0e1a)';
}

export function MenuListItem({
	menu,
	connectionCounts,
	isSelected,
	onSelect,
}: {
	menu: Menu;
	connectionCounts: MenuConnectionCounts;
	isSelected: boolean;
	onSelect: () => void;
}) {
	const previewBlocks = getMenuPreviewBlocks(menu);
	const buttonCount = previewBlocks.length;
	const previewBackground = getMenuPreviewBackground(menu);
	const hasWarning =
		buttonCount === 0 || (connectionCounts.incoming === 0 && connectionCounts.outgoing === 0);
	const modeLabel = menu.backgroundMode === 'motion' ? 'Motion' : 'Still';

	return (
		<div
			className={`menus__item ${isSelected ? 'menus__item--selected' : ''}`}
			onClick={onSelect}
			role="button"
			tabIndex={0}
			aria-pressed={isSelected}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onSelect();
				}
			}}
		>
			<div className="menus__item-preview" style={{ background: previewBackground }}>
				{previewBlocks.slice(0, 4).map((block, index) => (
					<div
						key={`${menu.id}-preview-${index}`}
						className="menus__item-preview-block"
						style={{
							left: `${block.x}%`,
							top: `${block.y}%`,
							width: `${block.width}%`,
						}}
					/>
				))}
				{previewBlocks.length === 0 && <div className="menus__item-preview-empty" />}
			</div>
			<div className="menus__item-info">
				<div className="menus__item-name">{menu.name}</div>
				<div className="menus__item-meta">
					<span>
						{buttonCount} button{buttonCount === 1 ? '' : 's'}
					</span>
					<span className="menus__item-bullet">•</span>
					<span>{modeLabel}</span>
					<div className="menus__item-conns">
						<span
							className="conn-indicator conn-indicator--out"
							title={`${connectionCounts.outgoing} outgoing connection${connectionCounts.outgoing === 1 ? '' : 's'}`}
						>
							&#8594;{connectionCounts.outgoing}
						</span>
						<span
							className="conn-indicator conn-indicator--in"
							title={`${connectionCounts.incoming} incoming connection${connectionCounts.incoming === 1 ? '' : 's'}`}
						>
							&#8592;{connectionCounts.incoming}
						</span>
					</div>
				</div>
			</div>
			<div
				className={`menus__item-status ${
					hasWarning ? 'menus__item-status--warn' : 'menus__item-status--ok'
				}`}
				aria-hidden="true"
			/>
		</div>
	);
}

export function EmptyMenuWorkspace({
	railIsOverlay,
	railVisible,
	onOpenRail,
}: {
	railIsOverlay: boolean;
	railVisible: boolean;
	onOpenRail: () => void;
}) {
	return (
		<section className="editor-area">
			<div className="editor-toolbar card">
				<div className="editor-toolbar__left">
					{railIsOverlay && !railVisible && (
						<button
							type="button"
							className="editor-toolbar__toggle"
							onClick={onOpenRail}
							title="Show menus rail"
						>
							☰ Menus
						</button>
					)}
					<h2 className="editor-toolbar__title">Menu Workspace</h2>
				</div>
			</div>
			<div className="editor-body editor-body--empty">
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
						Use the rail to add a global or titleset menu, then author its canvas here.
					</p>
				</div>
			</div>
		</section>
	);
}
