// Scene canvas — artboard viewport with node rendering, drag, resize, and snap guides.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { readFile } from '@tauri-apps/plugin-fs';
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type {
	MenuButton,
	MenuHighlightColours,
	ButtonBounds,
	SceneNode,
	ButtonStateStyle,
	AspectMode,
	Asset,
} from '../../types/project';

// DVD menu canvas dimensions
const MENU_WIDTH = 720;

// Safe-area margins (SMPTE RP 218)
const ACTION_SAFE_PCT = 0.05;
const TITLE_SAFE_PCT = 0.1;

const SNAP_THRESHOLD = 8;
const MIN_BUTTON_SIZE = 30;

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type PositionedSceneNode = Extract<SceneNode, { x: number; width: number }>;

/** Direction-colour mapping for navigation lines. */
const NAV_COLOURS: Record<string, string> = {
	navUp: 'rgba(100, 200, 255, 0.5)',
	navDown: 'rgba(255, 170, 64, 0.5)',
	navLeft: 'rgba(180, 130, 255, 0.5)',
	navRight: 'rgba(130, 255, 130, 0.5)',
};

export interface SceneCanvasProps {
	buttons: MenuButton[];
	assets?: Asset[];
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
	/** Preview state to apply to the selected button while styling. */
	buttonPreviewState?: 'normal' | 'focus' | 'activate';
	/** Display aspect used to simulate 4:3 vs anamorphic 16:9 rendering. */
	displayAspect?: AspectMode;
}

export function SceneCanvas({
	buttons,
	assets = [],
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
	buttonPreviewState = 'normal',
	displayAspect = 'four-by-three',
}: SceneCanvasProps) {
	if (previewMode) {
		return (
			<NavigationPreview
				buttons={buttons}
				assets={assets}
				sceneNodes={sceneNodes}
				canvasHeight={canvasHeight}
				showSafeArea={showSafeArea}
				backgroundLabel={backgroundLabel}
				backgroundColour={backgroundColour}
				defaultButtonId={defaultButtonId}
				highlightColours={highlightColours}
				honestPreview={honestPreview}
				displayAspect={displayAspect}
			/>
		);
	}

	return (
		<DesignCanvas
			buttons={buttons}
			assets={assets}
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
			buttonPreviewState={buttonPreviewState}
			displayAspect={displayAspect}
		/>
	);
}

// ── Design Canvas ──────────────────────────────────────────────────────────

function DesignCanvas({
	buttons,
	assets,
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
	buttonPreviewState,
	displayAspect,
}: {
	buttons: MenuButton[];
	assets: Asset[];
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
	buttonPreviewState: 'normal' | 'focus' | 'activate';
	displayAspect: AspectMode;
}) {
	const buttonNodeMap = useMemo(
		() =>
			new Map(
				sceneNodes
					.filter((node): node is Extract<SceneNode, { type: 'button' }> => node.type === 'button')
					.map((node) => [node.id, node]),
			),
		[sceneNodes],
	);
	const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
	const positionedNodes = useMemo(
		() =>
			sceneNodes.filter(
				(node): node is PositionedSceneNode =>
					node.type !== 'button' &&
					node.type !== 'group' &&
					node.type !== 'componentInstance' &&
					node.type !== 'generatedCollection' &&
					'width' in node,
			),
		[sceneNodes],
	);
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
				aspectRatio: aspectRatioForDisplay(displayAspect),
				...(backgroundColour && !backgroundLabel ? { backgroundColor: backgroundColour } : {}),
			}}
			onClick={() => onSelectNode(null)}
		>
			{backgroundLabel && (
				<div className="scene-canvas__bg-label text-muted">{backgroundLabel}</div>
			)}
			{honestPreview && <CompileOverlay buttons={buttons} canvasHeight={canvasHeight} />}
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
				<RenderedSceneNode
					key={node.id}
					node={node}
					asset={node.type === 'image' ? (assetMap.get(node.assetId) ?? null) : null}
					canvasHeight={canvasHeight}
					isSelected={selectedNodeId === node.id}
					interactive={true}
					onMouseDown={(e) => {
						e.stopPropagation();
						startNodeDrag(e, node, 'move');
					}}
					onResizeStart={(edge, e) => startNodeDrag(e, node, edge)}
				/>
			))}
			{/* Button nodes (on top) */}
			{buttons.map((btn) => {
				const buttonNode = buttonNodeMap.get(btn.id);
				const renderedState = selectedNodeId === btn.id ? buttonPreviewState : ('normal' as const);
				const buttonStyle = buttonNode?.buttonStyle?.[renderedState];
				const labelStyle = buttonNode?.labelStyle;
				return (
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
							...(buttonStyle
								? {
										background: buttonStyle.bgFill,
										borderColor: buttonStyle.borderColour,
										borderWidth: `${buttonStyle.borderWidth}px`,
										borderRadius: `${buttonStyle.borderRadius}px`,
										paddingInline: `${buttonStyle.paddingH}px`,
										paddingBlock: `${buttonStyle.paddingV}px`,
										boxShadow: buttonShadowCss(buttonStyle),
									}
								: {}),
							...(labelStyle
								? {
										fontFamily: labelStyle.fontFamily,
										fontSize: `${labelStyle.fontSize}px`,
										fontWeight: labelStyle.fontWeight === 'bold' ? 700 : 400,
										fontStyle: labelStyle.fontItalic ? 'italic' : 'normal',
										textDecoration: labelStyle.textDecoration,
										textAlign: labelStyle.textAlign,
										color: labelStyle.colour,
										lineHeight: labelStyle.lineHeight,
										letterSpacing: `${labelStyle.letterSpacing}px`,
									}
								: {}),
						}}
						onClick={(e) => e.stopPropagation()}
						onMouseDown={(e) => {
							e.stopPropagation();
							startDrag(e, btn, 'move');
						}}
					>
						<div className="scene-canvas__node-body">
							<span className="scene-canvas__node-label">{btn.label}</span>
						</div>
						{(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeEdge[]).map((edge) => (
							<div
								key={edge}
								className={`scene-canvas__resize-handle scene-canvas__resize-handle--${edge}`}
								onMouseDown={(e) => startDrag(e, btn, edge)}
							/>
						))}
					</div>
				);
			})}
		</div>
	);
}

// ── Navigation Preview ─────────────────────────────────────────────────────

function NavigationPreview({
	buttons,
	assets,
	sceneNodes,
	canvasHeight,
	showSafeArea,
	backgroundLabel,
	backgroundColour,
	defaultButtonId,
	highlightColours,
	honestPreview,
	displayAspect,
}: {
	buttons: MenuButton[];
	assets: Asset[];
	sceneNodes: SceneNode[];
	canvasHeight: number;
	showSafeArea: boolean;
	backgroundLabel: string | null;
	backgroundColour: string | null;
	defaultButtonId: string | null;
	highlightColours: MenuHighlightColours;
	honestPreview: boolean;
	displayAspect: AspectMode;
}) {
	const [focusedId, setFocusedId] = useState<string | null>(
		defaultButtonId ?? buttons[0]?.id ?? null,
	);
	const [activatedId, setActivatedId] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const previousPreviewTargetsRef = useRef<{
		buttonIdsKey: string;
		defaultButtonId: string | null;
	} | null>(null);
	const buttonNodeMap = useMemo(
		() =>
			new Map(
				sceneNodes
					.filter((node): node is Extract<SceneNode, { type: 'button' }> => node.type === 'button')
					.map((node) => [node.id, node]),
			),
		[sceneNodes],
	);
	const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
	const positionedNodes = useMemo(
		() =>
			sceneNodes.filter(
				(node): node is PositionedSceneNode =>
					node.type !== 'button' &&
					node.type !== 'group' &&
					node.type !== 'componentInstance' &&
					node.type !== 'generatedCollection' &&
					'width' in node,
			),
		[sceneNodes],
	);

	useEffect(() => {
		if (!activatedId) return;
		const timeout = window.setTimeout(() => setActivatedId(null), 260);
		return () => window.clearTimeout(timeout);
	}, [activatedId]);

	useEffect(() => {
		if (buttons.length === 0) {
			setFocusedId(null);
			previousPreviewTargetsRef.current = null;
			return;
		}

		const buttonIdsKey = buttons.map((button) => button.id).join('|');
		const preferredFocusId = defaultButtonId ?? buttons[0]?.id ?? null;
		const focusStillExists =
			focusedId !== null && buttons.some((button) => button.id === focusedId);
		const previousTargets = previousPreviewTargetsRef.current;
		const menuTargetsChanged =
			previousTargets === null || previousTargets.buttonIdsKey !== buttonIdsKey;
		const defaultFocusChanged =
			previousTargets !== null && previousTargets.defaultButtonId !== defaultButtonId;

		if (!focusStillExists || menuTargetsChanged || defaultFocusChanged) {
			setFocusedId(preferredFocusId);
		}

		previousPreviewTargetsRef.current = {
			buttonIdsKey,
			defaultButtonId,
		};
	}, [buttons, defaultButtonId, focusedId]);

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
				case 'Enter':
				case ' ':
					setActivatedId(btn.id);
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
				aspectRatio: aspectRatioForDisplay(displayAspect),
				...(backgroundColour && !backgroundLabel ? { backgroundColor: backgroundColour } : {}),
			}}
		>
			{backgroundLabel && (
				<div className="scene-canvas__bg-label text-muted">{backgroundLabel}</div>
			)}
			{honestPreview && <CompileOverlay buttons={buttons} canvasHeight={canvasHeight} />}
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
			{positionedNodes.map((node) => (
				<RenderedSceneNode
					key={node.id}
					node={node}
					asset={node.type === 'image' ? (assetMap.get(node.assetId) ?? null) : null}
					canvasHeight={canvasHeight}
				/>
			))}
			{buttons.map((btn) => {
				const isFocused = btn.id === focusedId;
				const isActivated = btn.id === activatedId;
				const hl = highlightColours;
				const buttonNode = buttonNodeMap.get(btn.id);
				const visualState = isActivated ? 'activate' : isFocused ? 'focus' : 'normal';
				const buttonStyle = buttonNode?.buttonStyle?.[visualState];
				const labelStyle = buttonNode?.labelStyle;
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
							...(buttonStyle
								? {
										background: buttonStyle.bgFill,
										borderColor: buttonStyle.borderColour,
										borderWidth: `${buttonStyle.borderWidth}px`,
										borderRadius: `${buttonStyle.borderRadius}px`,
										paddingInline: `${buttonStyle.paddingH}px`,
										paddingBlock: `${buttonStyle.paddingV}px`,
										boxShadow: buttonShadowCss(buttonStyle),
									}
								: {}),
							...(labelStyle
								? {
										fontFamily: labelStyle.fontFamily,
										fontSize: `${labelStyle.fontSize}px`,
										fontWeight: labelStyle.fontWeight === 'bold' ? 700 : 400,
										fontStyle: labelStyle.fontItalic ? 'italic' : 'normal',
										textDecoration: labelStyle.textDecoration,
										textAlign: labelStyle.textAlign,
										color: labelStyle.colour,
										lineHeight: labelStyle.lineHeight,
										letterSpacing: `${labelStyle.letterSpacing}px`,
									}
								: {}),
							...(isFocused
								? {
										outline: `1px solid ${hl.selectColour}`,
										outlineOffset: '-1px',
										boxShadow: buttonStyle
											? `${buttonShadowCss(buttonStyle)}, 0 0 12px ${hexToRgba(hl.selectColour, 0.5)}`
											: `0 0 12px ${hexToRgba(hl.selectColour, 0.5)}, 0 0 24px ${hexToRgba(hl.selectColour, 0.2)}`,
									}
								: {}),
							...(isActivated
								? {
										outline: `2px solid ${hl.activateColour}`,
										outlineOffset: '-2px',
									}
								: {}),
						}}
						onClick={() => setFocusedId(btn.id)}
					>
						<div className="scene-canvas__node-body">
							<span className="scene-canvas__node-label">{btn.label}</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}

function RenderedSceneNode({
	node,
	asset = null,
	canvasHeight,
	isSelected = false,
	interactive = false,
	onMouseDown,
	onResizeStart,
}: {
	node: PositionedSceneNode;
	asset?: Asset | null;
	canvasHeight: number;
	isSelected?: boolean;
	interactive?: boolean;
	onMouseDown?: (event: React.MouseEvent<HTMLDivElement>) => void;
	onResizeStart?: (edge: ResizeEdge, event: React.MouseEvent<HTMLDivElement>) => void;
}) {
	const imageLabel =
		node.type === 'image' ? (asset?.fileName ?? ('assetId' in node ? node.assetId : '')) : null;

	return (
		<div
			key={node.id}
			className={`scene-canvas__scene-node scene-canvas__scene-node--${node.type} ${
				isSelected ? 'scene-canvas__scene-node--selected' : ''
			}`}
			style={{
				left: `${(node.x / MENU_WIDTH) * 100}%`,
				top: `${(node.y / canvasHeight) * 100}%`,
				width: `${(node.width / MENU_WIDTH) * 100}%`,
				height: `${(node.height / canvasHeight) * 100}%`,
				...(node.type === 'shape' && 'fill' in node && node.fill
					? { backgroundColor: node.fill }
					: {}),
				...(node.type === 'text' && 'colour' in node && node.colour ? { color: node.colour } : {}),
				...(node.type === 'text' && 'fontSize' in node && node.fontSize
					? { fontSize: `${node.fontSize}px` }
					: {}),
				...(node.type === 'text' && 'fontFamily' in node && node.fontFamily
					? { fontFamily: node.fontFamily }
					: {}),
				...(node.type === 'text' && 'fontWeight' in node && node.fontWeight
					? { fontWeight: node.fontWeight === 'bold' ? 700 : 400 }
					: {}),
				...(node.type === 'text' && 'fontItalic' in node && node.fontItalic
					? { fontStyle: 'italic' }
					: {}),
				...(node.type === 'text' && 'textDecoration' in node && node.textDecoration
					? { textDecoration: node.textDecoration }
					: {}),
				...(node.type === 'text' && 'textAlign' in node && node.textAlign
					? { textAlign: node.textAlign }
					: {}),
				...(node.type === 'text' && 'lineHeight' in node && node.lineHeight
					? { lineHeight: node.lineHeight }
					: {}),
				...(node.type === 'text' && 'letterSpacing' in node && node.letterSpacing !== undefined
					? { letterSpacing: `${node.letterSpacing}px` }
					: {}),
			}}
			onClick={(event) => interactive && event.stopPropagation()}
			onMouseDown={onMouseDown}
		>
			{node.type === 'text' && 'content' in node ? node.content : null}
			{node.type === 'image' ? <ImageNodeArtwork asset={asset} label={imageLabel} /> : null}
			{interactive && onResizeStart
				? (['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeEdge[]).map((edge) => (
						<div
							key={edge}
							className={`scene-canvas__resize-handle scene-canvas__resize-handle--${edge}`}
							onMouseDown={(event) => onResizeStart(edge, event)}
						/>
					))
				: null}
		</div>
	);
}

function ImageNodeArtwork({ asset, label }: { asset?: Asset | null; label: string | null }) {
	const [imageSrc, setImageSrc] = useState<string | null>(null);

	useEffect(() => {
		let revokedUrl: string | null = null;
		let cancelled = false;

		async function loadImage() {
			if (!asset) {
				setImageSrc(null);
				return;
			}

			try {
				const bytes = await readFile(asset.sourcePath);
				if (cancelled) {
					return;
				}
				const blob = new Blob([bytes], { type: mimeTypeForImageAsset(asset.fileName) });
				const objectUrl = URL.createObjectURL(blob);
				revokedUrl = objectUrl;
				setImageSrc(objectUrl);
			} catch {
				if (!cancelled) {
					setImageSrc(asset.sourcePath);
				}
			}
		}

		void loadImage();

		return () => {
			cancelled = true;
			if (revokedUrl) {
				URL.revokeObjectURL(revokedUrl);
			}
		};
	}, [asset]);

	return (
		<>
			{imageSrc ? (
				<img
					className="scene-canvas__image-artwork"
					src={imageSrc}
					alt={label ?? 'Menu image'}
					draggable={false}
				/>
			) : (
				<div className="scene-canvas__image-placeholder" aria-hidden="true">
					<div className="scene-canvas__image-placeholder-sun" />
					<div className="scene-canvas__image-placeholder-horizon" />
				</div>
			)}
			<div className="scene-canvas__image-overlay">
				<span className="scene-canvas__image-kicker">Image</span>
				<span className="scene-canvas__image-caption">{label || 'Assign an image asset'}</span>
			</div>
		</>
	);
}

function mimeTypeForImageAsset(fileName: string): string {
	if (/\.png$/i.test(fileName)) return 'image/png';
	if (/\.jpe?g$/i.test(fileName)) return 'image/jpeg';
	if (/\.bmp$/i.test(fileName)) return 'image/bmp';
	if (/\.tiff?$/i.test(fileName)) return 'image/tiff';
	return 'application/octet-stream';
}

function buttonShadowCss(style: ButtonStateStyle): string {
	if (style.shadowType === 'none') return 'none';
	if (style.shadowType === 'inner-glow') {
		return `inset 0 0 ${style.shadowBlur}px ${style.shadowSpread}px ${style.shadowColour}`;
	}
	return `0 0 ${style.shadowBlur}px ${style.shadowSpread}px ${style.shadowColour}`;
}

function aspectRatioForDisplay(displayAspect: AspectMode): string {
	return displayAspect === 'sixteen-by-nine' ? '16 / 9' : '4 / 3';
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

interface CompileOverlayCheck {
	label: string;
	value: string;
	ok: boolean;
}

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
				sum + (b.navUp ? 1 : 0) + (b.navDown ? 1 : 0) + (b.navLeft ? 1 : 0) + (b.navRight ? 1 : 0),
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

	const checks: CompileOverlayCheck[] = [
		{
			label: 'Buttons',
			value: `${btnCount} / ${MAX_DVD_BUTTONS}`,
			ok: btnOk,
		},
		{
			label: 'Actions',
			value:
				actionsTotal === 0
					? '—'
					: actionsOk
						? `${actionsResolved} resolved`
						: `${actionsResolved}/${actionsTotal}`,
			ok: actionsOk,
		},
		{
			label: 'Nav',
			value: navLabel,
			ok: navOk,
		},
		{
			label: 'Safe areas',
			value: safeOk ? 'All clear' : `${outsideCount} outside`,
			ok: safeOk,
		},
	];

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
				<div className="compile-overlay__summary">
					<span className="compile-overlay__eyebrow">Preview compass</span>
					<p className="compile-overlay__headline">
						DVD fallback strips rich menu styling down to fewer colours and firmer edges.
					</p>
					<p className="compile-overlay__body">
						Use this pass to judge what the viewer actually loses before compile: gentle blends
						collapse, translucent overlays harden, and highlight states read more like blunt
						subpictures than polished UI.
					</p>
				</div>
				<div className="compile-overlay__compass">
					<div className="compile-overlay__card">
						<span className="compile-overlay__card-label">Palette collapse</span>
						<p className="compile-overlay__card-body">
							Close hues and soft gradients compress into a 4-colour CLUT, so accents can merge or
							posterise.
						</p>
					</div>
					<div className="compile-overlay__card">
						<span className="compile-overlay__card-label">Alpha flattening</span>
						<p className="compile-overlay__card-body">
							Soft glows, shadows, and translucent fills lose their softness and often land as
							harder mats.
						</p>
					</div>
					<div className="compile-overlay__card">
						<span className="compile-overlay__card-label">State simplification</span>
						<p className="compile-overlay__card-body">
							Focus and activate cues survive as simpler highlight planes, not layered,
							high-fidelity states.
						</p>
					</div>
				</div>
				<div className="compile-overlay__checks">
					{checks.map((check) => (
						<div key={check.label} className="compile-overlay__stat">
							<span className="compile-overlay__stat-label">{check.label}</span>
							<span
								className={`compile-overlay__stat-value ${
									check.ok ? 'compile-overlay__stat-value--ok' : 'compile-overlay__stat-value--warn'
								}`}
							>
								{check.value}
							</span>
						</div>
					))}
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
