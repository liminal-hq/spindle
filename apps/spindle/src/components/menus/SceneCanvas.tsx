// Scene canvas — artboard viewport with node rendering, drag, resize, and snap guides.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState, useRef, useCallback } from 'react';
import type {
	MenuButton,
	MenuHighlightColours,
	ButtonBounds,
	SceneNode,
} from '../../types/project';

// DVD menu canvas dimensions
const MENU_WIDTH = 720;

// Safe-area margins (SMPTE RP 218)
const ACTION_SAFE_PCT = 0.05;
const TITLE_SAFE_PCT = 0.1;

const SNAP_THRESHOLD = 8;
const MIN_BUTTON_SIZE = 30;

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Direction-colour mapping for navigation lines. */
const NAV_COLOURS: Record<string, string> = {
	navUp: 'rgba(100, 200, 255, 0.5)',
	navDown: 'rgba(255, 170, 64, 0.5)',
	navLeft: 'rgba(180, 130, 255, 0.5)',
	navRight: 'rgba(130, 255, 130, 0.5)',
};

export interface SceneCanvasProps {
	buttons: MenuButton[];
	/** All scene nodes (text, image, shape, etc.) for rendering non-button elements. */
	sceneNodes: SceneNode[];
	canvasHeight: number;
	onUpdateButton: (buttonId: string, updates: Partial<MenuButton>) => void;
	/** Update a non-button scene node's position/size. */
	onUpdateSceneNode: (nodeId: string, updates: Record<string, unknown>) => void;
	showSafeArea: boolean;
	backgroundLabel: string | null;
	/** Solid background colour (CSS hex) when no asset is assigned. */
	backgroundColour: string | null;
	defaultButtonId: string | null;
	/** When true, render in navigation preview mode with highlight colours. */
	previewMode: boolean;
	highlightColours: MenuHighlightColours;
	/** When true, apply the DVD Preview treatment (DVD-safe visual filter). */
	honestPreview: boolean;
	/** Show navigation lines between buttons. */
	showNavLines: boolean;
	/** Currently selected node ID for selection ring. */
	selectedNodeId: string | null;
	/** Callback when a node is clicked to select it. */
	onSelectNode: (nodeId: string | null) => void;
}

export function SceneCanvas({
	buttons,
	sceneNodes,
	canvasHeight,
	onUpdateButton,
	onUpdateSceneNode,
	showSafeArea,
	backgroundLabel,
	backgroundColour,
	defaultButtonId,
	previewMode,
	highlightColours,
	honestPreview,
	showNavLines,
	selectedNodeId,
	onSelectNode,
}: SceneCanvasProps) {
	if (previewMode) {
		return (
			<NavigationPreview
				buttons={buttons}
				canvasHeight={canvasHeight}
				showSafeArea={showSafeArea}
				backgroundLabel={backgroundLabel}
				backgroundColour={backgroundColour}
				defaultButtonId={defaultButtonId}
				highlightColours={highlightColours}
				honestPreview={honestPreview}
			/>
		);
	}

	return (
		<DesignCanvas
			buttons={buttons}
			sceneNodes={sceneNodes}
			canvasHeight={canvasHeight}
			onUpdateButton={onUpdateButton}
			onUpdateSceneNode={onUpdateSceneNode}
			showSafeArea={showSafeArea}
			backgroundLabel={backgroundLabel}
			backgroundColour={backgroundColour}
			defaultButtonId={defaultButtonId}
			honestPreview={honestPreview}
			showNavLines={showNavLines}
			selectedNodeId={selectedNodeId}
			onSelectNode={onSelectNode}
		/>
	);
}

// ── Design Canvas ──────────────────────────────────────────────────────────

function DesignCanvas({
	buttons,
	sceneNodes,
	canvasHeight,
	onUpdateButton,
	onUpdateSceneNode,
	showSafeArea,
	backgroundLabel,
	backgroundColour,
	defaultButtonId,
	honestPreview,
	showNavLines,
	selectedNodeId,
	onSelectNode,
}: {
	buttons: MenuButton[];
	sceneNodes: SceneNode[];
	canvasHeight: number;
	onUpdateButton: (buttonId: string, updates: Partial<MenuButton>) => void;
	onUpdateSceneNode: (nodeId: string, updates: Record<string, unknown>) => void;
	showSafeArea: boolean;
	backgroundLabel: string | null;
	backgroundColour: string | null;
	defaultButtonId: string | null;
	honestPreview: boolean;
	showNavLines: boolean;
	selectedNodeId: string | null;
	onSelectNode: (nodeId: string | null) => void;
}) {
	const canvasRef = useRef<HTMLDivElement>(null);
	const dragState = useRef<{
		buttonId: string;
		isSceneNode?: boolean;
		mode: 'move' | ResizeEdge;
		startX: number;
		startY: number;
		startBounds: ButtonBounds;
	} | null>(null);
	const [snapLines, setSnapLines] = useState<{ axis: 'x' | 'y'; pos: number }[]>([]);

	/** Non-button scene nodes that have position and size. */
	const positionedNodes = sceneNodes.filter(
		(n): n is Extract<SceneNode, { x: number; width: number }> =>
			n.type !== 'button' &&
			n.type !== 'group' &&
			n.type !== 'componentInstance' &&
			n.type !== 'generatedCollection' &&
			'width' in n,
	);

	const getSnapTargets = useCallback(
		(excludeId: string) => {
			const xs: number[] = [];
			const ys: number[] = [];
			for (const btn of buttons) {
				if (btn.id === excludeId) continue;
				xs.push(btn.bounds.x, btn.bounds.x + btn.bounds.width, btn.bounds.x + btn.bounds.width / 2);
				ys.push(
					btn.bounds.y,
					btn.bounds.y + btn.bounds.height,
					btn.bounds.y + btn.bounds.height / 2,
				);
			}
			for (const node of positionedNodes) {
				if (node.id === excludeId) continue;
				xs.push(node.x, node.x + node.width, node.x + node.width / 2);
				ys.push(node.y, node.y + node.height, node.y + node.height / 2);
			}
			xs.push(0, MENU_WIDTH / 2, MENU_WIDTH);
			ys.push(0, canvasHeight / 2, canvasHeight);
			return { xs, ys };
		},
		[buttons, canvasHeight],
	);

	const snapValue = (val: number, targets: number[]): { snapped: number; line: number | null } => {
		let closest = val;
		let minDist = SNAP_THRESHOLD + 1;
		let line: number | null = null;
		for (const t of targets) {
			const d = Math.abs(val - t);
			if (d < minDist) {
				minDist = d;
				closest = t;
				line = t;
			}
		}
		return minDist <= SNAP_THRESHOLD ? { snapped: closest, line } : { snapped: val, line: null };
	};

	const startDrag = useCallback(
		(e: React.MouseEvent, btn: MenuButton, mode: 'move' | ResizeEdge) => {
			e.preventDefault();
			e.stopPropagation();
			const canvas = canvasRef.current;
			if (!canvas) return;

			onSelectNode(btn.id);

			dragState.current = {
				buttonId: btn.id,
				mode,
				startX: e.clientX,
				startY: e.clientY,
				startBounds: { ...btn.bounds },
			};

			const targets = getSnapTargets(btn.id);

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const state = dragState.current;
				if (!state || !canvas) return;

				const rect = canvas.getBoundingClientRect();
				const scaleX = MENU_WIDTH / rect.width;
				const scaleY = canvasHeight / rect.height;
				const dx = (moveEvent.clientX - state.startX) * scaleX;
				const dy = (moveEvent.clientY - state.startY) * scaleY;
				const sb = state.startBounds;

				let bounds: ButtonBounds;
				if (state.mode === 'move') {
					let newX = sb.x + dx;
					let newY = sb.y + dy;
					newX = Math.max(0, Math.min(MENU_WIDTH - sb.width, newX));
					newY = Math.max(0, Math.min(canvasHeight - sb.height, newY));

					const lines: { axis: 'x' | 'y'; pos: number }[] = [];
					const sLeft = snapValue(newX, targets.xs);
					const sRight = snapValue(newX + sb.width, targets.xs);
					const sCx = snapValue(newX + sb.width / 2, targets.xs);
					if (sLeft.line != null) {
						newX = sLeft.snapped;
						lines.push({ axis: 'x', pos: sLeft.line });
					} else if (sRight.line != null) {
						newX = sRight.snapped - sb.width;
						lines.push({ axis: 'x', pos: sRight.line });
					} else if (sCx.line != null) {
						newX = sCx.snapped - sb.width / 2;
						lines.push({ axis: 'x', pos: sCx.line });
					}

					const sTop = snapValue(newY, targets.ys);
					const sBottom = snapValue(newY + sb.height, targets.ys);
					const sCy = snapValue(newY + sb.height / 2, targets.ys);
					if (sTop.line != null) {
						newY = sTop.snapped;
						lines.push({ axis: 'y', pos: sTop.line });
					} else if (sBottom.line != null) {
						newY = sBottom.snapped - sb.height;
						lines.push({ axis: 'y', pos: sBottom.line });
					} else if (sCy.line != null) {
						newY = sCy.snapped - sb.height / 2;
						lines.push({ axis: 'y', pos: sCy.line });
					}

					setSnapLines(lines);
					bounds = { x: Math.round(newX), y: Math.round(newY), width: sb.width, height: sb.height };
				} else {
					let { x, y, width, height } = sb;
					const m = state.mode;
					if (m.includes('e')) width = Math.max(MIN_BUTTON_SIZE, sb.width + dx);
					if (m.includes('w')) {
						width = Math.max(MIN_BUTTON_SIZE, sb.width - dx);
						x = sb.x + sb.width - width;
					}
					if (m.includes('s')) height = Math.max(MIN_BUTTON_SIZE, sb.height + dy);
					if (m.includes('n')) {
						height = Math.max(MIN_BUTTON_SIZE, sb.height - dy);
						y = sb.y + sb.height - height;
					}

					x = Math.max(0, Math.min(MENU_WIDTH - MIN_BUTTON_SIZE, x));
					y = Math.max(0, Math.min(canvasHeight - MIN_BUTTON_SIZE, y));
					if (x + width > MENU_WIDTH) width = MENU_WIDTH - x;
					if (y + height > canvasHeight) height = canvasHeight - y;

					setSnapLines([]);
					bounds = {
						x: Math.round(x),
						y: Math.round(y),
						width: Math.round(width),
						height: Math.round(height),
					};
				}

				if (state.isSceneNode) {
					onUpdateSceneNode(state.buttonId, { ...bounds });
				} else {
					onUpdateButton(state.buttonId, { bounds });
				}
			};

			const handleMouseUp = () => {
				dragState.current = null;
				setSnapLines([]);
				document.removeEventListener('mousemove', handleMouseMove);
				document.removeEventListener('mouseup', handleMouseUp);
			};

			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
		},
		[onUpdateButton, onUpdateSceneNode, canvasHeight, getSnapTargets, onSelectNode],
	);

	const startNodeDrag = useCallback(
		(
			e: React.MouseEvent,
			node: { id: string; x: number; y: number; width: number; height: number },
			mode: 'move' | ResizeEdge,
		) => {
			e.preventDefault();
			e.stopPropagation();
			const canvas = canvasRef.current;
			if (!canvas) return;

			onSelectNode(node.id);

			dragState.current = {
				buttonId: node.id,
				isSceneNode: true,
				mode,
				startX: e.clientX,
				startY: e.clientY,
				startBounds: { x: node.x, y: node.y, width: node.width, height: node.height },
			};

			// Reuse the same mouse-move logic by re-triggering startDrag's pattern
			const targets = getSnapTargets(node.id);

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const state = dragState.current;
				if (!state || !canvas) return;

				const rect = canvas.getBoundingClientRect();
				const scaleX = MENU_WIDTH / rect.width;
				const scaleY = canvasHeight / rect.height;
				const dx = (moveEvent.clientX - state.startX) * scaleX;
				const dy = (moveEvent.clientY - state.startY) * scaleY;
				const sb = state.startBounds;

				let bounds: ButtonBounds;
				if (state.mode === 'move') {
					let newX = sb.x + dx;
					let newY = sb.y + dy;
					newX = Math.max(0, Math.min(MENU_WIDTH - sb.width, newX));
					newY = Math.max(0, Math.min(canvasHeight - sb.height, newY));

					const lines: { axis: 'x' | 'y'; pos: number }[] = [];
					const sLeft = snapValue(newX, targets.xs);
					const sRight = snapValue(newX + sb.width, targets.xs);
					const sCx = snapValue(newX + sb.width / 2, targets.xs);
					if (sLeft.line != null) {
						newX = sLeft.snapped;
						lines.push({ axis: 'x', pos: sLeft.line });
					} else if (sRight.line != null) {
						newX = sRight.snapped - sb.width;
						lines.push({ axis: 'x', pos: sRight.line });
					} else if (sCx.line != null) {
						newX = sCx.snapped - sb.width / 2;
						lines.push({ axis: 'x', pos: sCx.line });
					}

					const sTop = snapValue(newY, targets.ys);
					const sBottom = snapValue(newY + sb.height, targets.ys);
					const sCy = snapValue(newY + sb.height / 2, targets.ys);
					if (sTop.line != null) {
						newY = sTop.snapped;
						lines.push({ axis: 'y', pos: sTop.line });
					} else if (sBottom.line != null) {
						newY = sBottom.snapped - sb.height;
						lines.push({ axis: 'y', pos: sBottom.line });
					} else if (sCy.line != null) {
						newY = sCy.snapped - sb.height / 2;
						lines.push({ axis: 'y', pos: sCy.line });
					}

					setSnapLines(lines);
					bounds = { x: Math.round(newX), y: Math.round(newY), width: sb.width, height: sb.height };
				} else {
					let { x, y, width, height } = sb;
					const m = state.mode;
					if (m.includes('e')) width = Math.max(MIN_BUTTON_SIZE, sb.width + dx);
					if (m.includes('w')) {
						width = Math.max(MIN_BUTTON_SIZE, sb.width - dx);
						x = sb.x + sb.width - width;
					}
					if (m.includes('s')) height = Math.max(MIN_BUTTON_SIZE, sb.height + dy);
					if (m.includes('n')) {
						height = Math.max(MIN_BUTTON_SIZE, sb.height - dy);
						y = sb.y + sb.height - height;
					}

					x = Math.max(0, Math.min(MENU_WIDTH - MIN_BUTTON_SIZE, x));
					y = Math.max(0, Math.min(canvasHeight - MIN_BUTTON_SIZE, y));
					if (x + width > MENU_WIDTH) width = MENU_WIDTH - x;
					if (y + height > canvasHeight) height = canvasHeight - y;

					setSnapLines([]);
					bounds = {
						x: Math.round(x),
						y: Math.round(y),
						width: Math.round(width),
						height: Math.round(height),
					};
				}

				onUpdateSceneNode(state.buttonId, { ...bounds });
			};

			const handleMouseUp = () => {
				dragState.current = null;
				setSnapLines([]);
				document.removeEventListener('mousemove', handleMouseMove);
				document.removeEventListener('mouseup', handleMouseUp);
			};

			document.addEventListener('mousemove', handleMouseMove);
			document.addEventListener('mouseup', handleMouseUp);
		},
		[onUpdateSceneNode, canvasHeight, getSnapTargets, onSelectNode],
	);

	return (
		<div
			className={`scene-canvas__viewport ${honestPreview ? 'scene-canvas__viewport--honest' : ''}`}
			ref={canvasRef}
			style={{
				aspectRatio: `${MENU_WIDTH} / ${canvasHeight}`,
				...(backgroundColour && !backgroundLabel ? { backgroundColor: backgroundColour } : {}),
			}}
			onClick={() => onSelectNode(null)}
		>
			{backgroundLabel && (
				<div className="scene-canvas__bg-label text-muted">{backgroundLabel}</div>
			)}
			{honestPreview && (
				<CompileOverlay buttons={buttons} canvasHeight={canvasHeight} />
			)}
			{showNavLines && (
				<NavLines buttons={buttons} canvasWidth={MENU_WIDTH} canvasHeight={canvasHeight} />
			)}
			{snapLines.map((line, i) =>
				line.axis === 'x' ? (
					<div
						key={`snap-${i}`}
						className="scene-canvas__snap-line scene-canvas__snap-line--v"
						style={{ left: `${(line.pos / MENU_WIDTH) * 100}%` }}
					/>
				) : (
					<div
						key={`snap-${i}`}
						className="scene-canvas__snap-line scene-canvas__snap-line--h"
						style={{ top: `${(line.pos / canvasHeight) * 100}%` }}
					/>
				),
			)}
			{showSafeArea && (
				<>
					<div
						className="scene-canvas__safe-area scene-canvas__safe-area--action"
						style={{
							left: `${ACTION_SAFE_PCT * 100}%`,
							top: `${ACTION_SAFE_PCT * 100}%`,
							right: `${ACTION_SAFE_PCT * 100}%`,
							bottom: `${ACTION_SAFE_PCT * 100}%`,
						}}
					>
						<span className="scene-canvas__safe-area-label">Action Safe</span>
					</div>
					<div
						className="scene-canvas__safe-area scene-canvas__safe-area--title"
						style={{
							left: `${TITLE_SAFE_PCT * 100}%`,
							top: `${TITLE_SAFE_PCT * 100}%`,
							right: `${TITLE_SAFE_PCT * 100}%`,
							bottom: `${TITLE_SAFE_PCT * 100}%`,
						}}
					>
						<span className="scene-canvas__safe-area-label">Title Safe</span>
					</div>
				</>
			)}
			{/* Non-button scene nodes (text, image, shape) rendered first (below buttons) */}
			{positionedNodes.map((node) => (
				<div
					key={node.id}
					className={`scene-canvas__scene-node scene-canvas__scene-node--${node.type} ${
						selectedNodeId === node.id ? 'scene-canvas__scene-node--selected' : ''
					}`}
					style={{
						left: `${(node.x / MENU_WIDTH) * 100}%`,
						top: `${(node.y / canvasHeight) * 100}%`,
						width: `${(node.width / MENU_WIDTH) * 100}%`,
						height: `${(node.height / canvasHeight) * 100}%`,
						...(node.type === 'shape' && 'fill' in node && node.fill
							? { backgroundColor: node.fill }
							: {}),
						...(node.type === 'text' && 'colour' in node && node.colour
							? { color: node.colour }
							: {}),
						...(node.type === 'text' && 'fontSize' in node && node.fontSize
							? { fontSize: `${node.fontSize}px` }
							: {}),
					}}
					onClick={(e) => e.stopPropagation()}
					onMouseDown={(e) => {
						e.stopPropagation();
						startNodeDrag(e, node, 'move');
					}}
				>
					{node.type === 'text' && 'content' in node ? node.content : null}
					{node.type === 'image' ? (
						<span className="scene-canvas__scene-node-badge">Image</span>
					) : null}
					{(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeEdge[]).map((edge) => (
						<div
							key={edge}
							className={`scene-canvas__resize-handle scene-canvas__resize-handle--${edge}`}
							onMouseDown={(e) => startNodeDrag(e, node, edge)}
						/>
					))}
				</div>
			))}
			{/* Button nodes (on top) */}
			{buttons.map((btn) => (
				<div
					key={btn.id}
					className={`scene-canvas__node ${
						defaultButtonId === btn.id ? 'scene-canvas__node--default' : ''
					} ${selectedNodeId === btn.id ? 'scene-canvas__node--selected' : ''}`}
					style={{
						left: `${(btn.bounds.x / MENU_WIDTH) * 100}%`,
						top: `${(btn.bounds.y / canvasHeight) * 100}%`,
						width: `${(btn.bounds.width / MENU_WIDTH) * 100}%`,
						height: `${(btn.bounds.height / canvasHeight) * 100}%`,
					}}
					onClick={(e) => e.stopPropagation()}
					onMouseDown={(e) => {
						e.stopPropagation();
						startDrag(e, btn, 'move');
					}}
				>
					{btn.label}
					{(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeEdge[]).map((edge) => (
						<div
							key={edge}
							className={`scene-canvas__resize-handle scene-canvas__resize-handle--${edge}`}
							onMouseDown={(e) => startDrag(e, btn, edge)}
						/>
					))}
				</div>
			))}
		</div>
	);
}

// ── Navigation Preview ─────────────────────────────────────────────────────

function NavigationPreview({
	buttons,
	canvasHeight,
	showSafeArea,
	backgroundLabel,
	backgroundColour,
	defaultButtonId,
	highlightColours,
	honestPreview,
}: {
	buttons: MenuButton[];
	canvasHeight: number;
	showSafeArea: boolean;
	backgroundLabel: string | null;
	backgroundColour: string | null;
	defaultButtonId: string | null;
	highlightColours: MenuHighlightColours;
	honestPreview: boolean;
}) {
	const [focusedId, setFocusedId] = useState<string | null>(
		defaultButtonId ?? buttons[0]?.id ?? null,
	);
	const containerRef = useRef<HTMLDivElement>(null);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			const isNavKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(
				e.key,
			);
			if (!isNavKey) return;
			e.preventDefault();

			const btn = buttons.find((b) => b.id === focusedId);
			if (!btn) return;

			let nextId: string | null = null;
			switch (e.key) {
				case 'ArrowUp':
					nextId = btn.navUp;
					break;
				case 'ArrowDown':
					nextId = btn.navDown;
					break;
				case 'ArrowLeft':
					nextId = btn.navLeft;
					break;
				case 'ArrowRight':
					nextId = btn.navRight;
					break;
			}
			if (nextId) setFocusedId(nextId);
		},
		[focusedId, buttons],
	);

	return (
		<div
			className={`scene-canvas__viewport scene-canvas__viewport--preview ${honestPreview ? 'scene-canvas__viewport--honest' : ''}`}
			ref={containerRef}
			tabIndex={0}
			onKeyDown={handleKeyDown}
			onFocus={() => containerRef.current?.focus()}
			style={{
				aspectRatio: `${MENU_WIDTH} / ${canvasHeight}`,
				...(backgroundColour && !backgroundLabel ? { backgroundColor: backgroundColour } : {}),
			}}
		>
			{backgroundLabel && (
				<div className="scene-canvas__bg-label text-muted">{backgroundLabel}</div>
			)}
			{honestPreview && (
				<CompileOverlay buttons={buttons} canvasHeight={canvasHeight} />
			)}
			{showSafeArea && (
				<>
					<div
						className="scene-canvas__safe-area scene-canvas__safe-area--action"
						style={{
							left: `${ACTION_SAFE_PCT * 100}%`,
							top: `${ACTION_SAFE_PCT * 100}%`,
							right: `${ACTION_SAFE_PCT * 100}%`,
							bottom: `${ACTION_SAFE_PCT * 100}%`,
						}}
					>
						<span className="scene-canvas__safe-area-label">Action Safe</span>
					</div>
					<div
						className="scene-canvas__safe-area scene-canvas__safe-area--title"
						style={{
							left: `${TITLE_SAFE_PCT * 100}%`,
							top: `${TITLE_SAFE_PCT * 100}%`,
							right: `${TITLE_SAFE_PCT * 100}%`,
							bottom: `${TITLE_SAFE_PCT * 100}%`,
						}}
					>
						<span className="scene-canvas__safe-area-label">Title Safe</span>
					</div>
				</>
			)}
			<div className="scene-canvas__preview-hint text-muted">
				Use arrow keys to navigate. Press Enter to activate.
			</div>
			<NavLines buttons={buttons} canvasWidth={MENU_WIDTH} canvasHeight={canvasHeight} />
			{buttons.map((btn) => {
				const isFocused = btn.id === focusedId;
				const hl = highlightColours;
				return (
					<div
						key={btn.id}
						className={`scene-canvas__node ${isFocused ? 'scene-canvas__node--focused' : ''} ${
							defaultButtonId === btn.id ? 'scene-canvas__node--default' : ''
						}`}
						style={{
							left: `${(btn.bounds.x / MENU_WIDTH) * 100}%`,
							top: `${(btn.bounds.y / canvasHeight) * 100}%`,
							width: `${(btn.bounds.width / MENU_WIDTH) * 100}%`,
							height: `${(btn.bounds.height / canvasHeight) * 100}%`,
							...(isFocused
								? {
										background: hexToRgba(hl.selectColour, hl.selectOpacity),
										borderColor: hl.selectColour,
										boxShadow: `0 0 12px ${hexToRgba(hl.selectColour, 0.5)}, 0 0 24px ${hexToRgba(hl.selectColour, 0.2)}`,
									}
								: {}),
						}}
						onClick={() => setFocusedId(btn.id)}
					>
						{btn.label}
					</div>
				);
			})}
		</div>
	);
}

// ── Nav Lines SVG ──────────────────────────────────────────────────────────

function NavLines({
	buttons,
	canvasWidth,
	canvasHeight,
}: {
	buttons: MenuButton[];
	canvasWidth: number;
	canvasHeight: number;
}) {
	const lines: { x1: number; y1: number; x2: number; y2: number; colour: string }[] = [];

	for (const btn of buttons) {
		const cx1 = btn.bounds.x + btn.bounds.width / 2;
		const cy1 = btn.bounds.y + btn.bounds.height / 2;

		for (const field of ['navUp', 'navDown', 'navLeft', 'navRight'] as const) {
			const targetId = btn[field];
			if (!targetId) continue;
			const target = buttons.find((b) => b.id === targetId);
			if (!target) continue;
			const cx2 = target.bounds.x + target.bounds.width / 2;
			const cy2 = target.bounds.y + target.bounds.height / 2;
			lines.push({ x1: cx1, y1: cy1, x2: cx2, y2: cy2, colour: NAV_COLOURS[field] });
		}
	}

	if (lines.length === 0) return null;

	return (
		<svg
			className="scene-canvas__nav-lines"
			viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
			preserveAspectRatio="none"
		>
			<defs>
				<marker id="nav-arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
					<path d="M0,0 L6,2 L0,4 Z" fill="rgba(255,255,255,0.6)" />
				</marker>
			</defs>
			{lines.map((l, i) => (
				<line
					key={i}
					x1={l.x1}
					y1={l.y1}
					x2={l.x2}
					y2={l.y2}
					stroke={l.colour}
					strokeWidth="2"
					markerEnd="url(#nav-arrow)"
				/>
			))}
		</svg>
	);
}

// ── Compile Preview Overlay ────────────────────────────────────────────────
// Honest DVD output simulation overlay: banner + stats bar.
// Replaces the old badge-only treatment with an informative diagnostic layer
// that communicates real DVD/VCD constraints at a glance.

const MAX_DVD_BUTTONS = 36;

function CompileOverlay({
	buttons,
	canvasHeight,
}: {
	buttons: MenuButton[];
	canvasHeight: number;
}) {
	const btnCount = buttons.length;
	const btnOk = btnCount <= MAX_DVD_BUTTONS;

	const actionsResolved = buttons.filter((b) => b.action !== null).length;
	const actionsTotal = buttons.length;
	const actionsOk = actionsTotal === 0 || actionsResolved === actionsTotal;

	let navLabel = 'N/A';
	let navOk = true;
	if (buttons.length > 1) {
		const totalDirs = buttons.length * 4;
		const filledDirs = buttons.reduce(
			(sum, b) =>
				sum +
				(b.navUp ? 1 : 0) +
				(b.navDown ? 1 : 0) +
				(b.navLeft ? 1 : 0) +
				(b.navRight ? 1 : 0),
			0,
		);
		navOk = filledDirs === totalDirs;
		navLabel = navOk ? 'Complete' : `${filledDirs}/${totalDirs}`;
	}

	const safeL = MENU_WIDTH * ACTION_SAFE_PCT;
	const safeT = canvasHeight * ACTION_SAFE_PCT;
	const safeR = MENU_WIDTH * (1 - ACTION_SAFE_PCT);
	const safeB = canvasHeight * (1 - ACTION_SAFE_PCT);
	const outsideCount = buttons.filter(
		(b) =>
			b.bounds.x < safeL ||
			b.bounds.y < safeT ||
			b.bounds.x + b.bounds.width > safeR ||
			b.bounds.y + b.bounds.height > safeB,
	).length;
	const safeOk = outsideCount === 0;

	return (
		<div className="compile-overlay">
			<div className="compile-overlay__banner">
				<svg
					width="10"
					height="10"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="3"
				>
					<circle cx="12" cy="12" r="10" />
					<line x1="12" y1="8" x2="12" y2="12" />
					<line x1="12" y1="16" x2="12.01" y2="16" />
				</svg>
				Compile Preview — DVD output simulation
			</div>
			<div className="compile-overlay__info">
				<div className="compile-overlay__stat">
					<span className="compile-overlay__stat-label">Buttons</span>
					<span
						className={`compile-overlay__stat-value ${btnOk ? 'compile-overlay__stat-value--ok' : 'compile-overlay__stat-value--warn'}`}
					>
						{btnCount} / {MAX_DVD_BUTTONS}
					</span>
				</div>
				<div className="compile-overlay__stat">
					<span className="compile-overlay__stat-label">Actions</span>
					<span
						className={`compile-overlay__stat-value ${actionsOk ? 'compile-overlay__stat-value--ok' : 'compile-overlay__stat-value--warn'}`}
					>
						{actionsTotal === 0
							? '—'
							: actionsOk
								? `${actionsResolved} resolved`
								: `${actionsResolved}/${actionsTotal}`}
					</span>
				</div>
				<div className="compile-overlay__stat">
					<span className="compile-overlay__stat-label">Nav</span>
					<span
						className={`compile-overlay__stat-value ${navOk ? 'compile-overlay__stat-value--ok' : 'compile-overlay__stat-value--warn'}`}
					>
						{navLabel}
					</span>
				</div>
				<div className="compile-overlay__stat">
					<span className="compile-overlay__stat-label">Safe areas</span>
					<span
						className={`compile-overlay__stat-value ${safeOk ? 'compile-overlay__stat-value--ok' : 'compile-overlay__stat-value--warn'}`}
					>
						{safeOk ? 'All clear' : `${outsideCount} outside`}
					</span>
				</div>
			</div>
		</div>
	);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function hexToRgba(hex: string, opacity: number): string {
	const h = hex.replace('#', '');
	const r = parseInt(h.substring(0, 2), 16) || 0;
	const g = parseInt(h.substring(2, 4), 16) || 0;
	const b = parseInt(h.substring(4, 6), 16) || 0;
	return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
