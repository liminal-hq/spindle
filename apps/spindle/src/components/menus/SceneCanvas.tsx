// Scene canvas — artboard viewport with node rendering, drag, resize, and snap guides.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { readFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type {
	AnimationTrack,
	MenuButton,
	MenuHighlightColours,
	ButtonBounds,
	SceneNode,
	ButtonStateStyle,
	AspectMode,
	Asset,
	FormatProfile,
	VideoStandard,
} from '../../types/project';
import { DEFAULT_DVD_FORMAT_PROFILE } from '../../format/useFormatProfile';
import { useShallow } from 'zustand/react/shallow';
import { useMenuPlaybackStore } from '../../store/menu-playback-store';
import {
	keyValueToColour,
	keyValueToOpacity,
	sampleHonestFold,
	sampleTrackForPreview,
} from './timeline/timelineUtils';
import { fpsForStandard } from './timeline/useTimelineGeometry';

// The canvas's fixed interactive coordinate space width. This is *not* yet
// sourced from `FormatProfile.designSizes` (1024 for DVD-Video) — every menu
// document in this codebase is still authored at the pre-BD-readiness
// 720-wide raster-matched design space (`MenusPage.tsx::createMenu`,
// `menuGenerators.ts`), so switching this to the profile's design width
// would desynchronise the canvas from every already-authored button
// position. Retiring this "720-raster remnant" in favour of genuinely
// per-document design space is Slice B, not this format-profile/role slice
// — see `docs/rich-menu-editor-plan.md` decision 5.
const CANVAS_DESIGN_WIDTH = 720;

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
	/** Background image or video asset to render behind scene nodes. */
	backgroundAsset?: Asset | null;
	/** When true and `backgroundAsset` has a video stream, render it as a
	 * looping `<video>` instead of a static image. */
	backgroundIsMotion?: boolean;
	/** Source-relative seconds to seek the background `<video>` to once its
	 * metadata loads — the menu's authored `timing.loopStartSecs` in design
	 * mode. Ignored for still backgrounds. */
	backgroundInitialTimeSecs?: number;
	/** The menu's authored `timing.loopDurationSecs` — used by the navigation
	 * preview's honest-preview quantization to clamp keyframe timestamps into
	 * the loop window (mirrors `build_overlay_keyframe_schedule`). */
	loopDurationSecs?: number;
	/** Animation tracks from `document.animation` — used by the navigation
	 * preview to sample the focused/activated button's highlight colour and
	 * opacity at the playhead's loop-relative time. */
	animationTracks?: AnimationTrack[];
	/** The project's disc video standard — drives the honest-preview
	 * schedule's standard-aware last-presentable-frame clamp (`fpsForStandard`),
	 * mirroring `build_overlay_keyframe_schedule`'s `frame_duration_secs`.
	 * Defaults to NTSC when not supplied. */
	standard?: VideoStandard;
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
	/** Format-law row driving the compile-overlay's button-count check. */
	formatProfile?: FormatProfile;
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
	backgroundAsset = null,
	backgroundIsMotion = false,
	backgroundInitialTimeSecs = 0,
	loopDurationSecs = 0,
	animationTracks = [],
	standard = 'NTSC',
	defaultButtonId,
	previewMode,
	highlightColours,
	honestPreview,
	showNavLines,
	selectedNodeId,
	onSelectNode,
	buttonPreviewState = 'normal',
	displayAspect = 'four-by-three',
	formatProfile = DEFAULT_DVD_FORMAT_PROFILE,
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
				backgroundAsset={backgroundAsset}
				backgroundIsMotion={backgroundIsMotion}
				backgroundInitialTimeSecs={backgroundInitialTimeSecs}
				loopDurationSecs={loopDurationSecs}
				animationTracks={animationTracks}
				fps={fpsForStandard(standard)}
				defaultButtonId={defaultButtonId}
				highlightColours={highlightColours}
				honestPreview={honestPreview}
				displayAspect={displayAspect}
				formatProfile={formatProfile}
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
			backgroundAsset={backgroundAsset}
			backgroundIsMotion={backgroundIsMotion}
			backgroundInitialTimeSecs={backgroundInitialTimeSecs}
			defaultButtonId={defaultButtonId}
			honestPreview={honestPreview}
			showNavLines={showNavLines}
			selectedNodeId={selectedNodeId}
			onSelectNode={onSelectNode}
			buttonPreviewState={buttonPreviewState}
			displayAspect={displayAspect}
			formatProfile={formatProfile}
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
	backgroundAsset,
	backgroundIsMotion,
	backgroundInitialTimeSecs,
	defaultButtonId,
	honestPreview,
	showNavLines,
	selectedNodeId,
	onSelectNode,
	buttonPreviewState,
	displayAspect,
	formatProfile,
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
	backgroundAsset: Asset | null;
	backgroundIsMotion: boolean;
	backgroundInitialTimeSecs: number;
	defaultButtonId: string | null;
	honestPreview: boolean;
	showNavLines: boolean;
	selectedNodeId: string | null;
	onSelectNode: (nodeId: string | null) => void;
	buttonPreviewState: 'normal' | 'focus' | 'activate';
	displayAspect: AspectMode;
	formatProfile: FormatProfile;
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
			xs.push(0, CANVAS_DESIGN_WIDTH / 2, CANVAS_DESIGN_WIDTH);
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
				const scaleX = CANVAS_DESIGN_WIDTH / rect.width;
				const scaleY = canvasHeight / rect.height;
				const dx = (moveEvent.clientX - state.startX) * scaleX;
				const dy = (moveEvent.clientY - state.startY) * scaleY;
				const sb = state.startBounds;

				let bounds: ButtonBounds;
				if (state.mode === 'move') {
					let newX = sb.x + dx;
					let newY = sb.y + dy;
					newX = Math.max(0, Math.min(CANVAS_DESIGN_WIDTH - sb.width, newX));
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

					x = Math.max(0, Math.min(CANVAS_DESIGN_WIDTH - MIN_BUTTON_SIZE, x));
					y = Math.max(0, Math.min(canvasHeight - MIN_BUTTON_SIZE, y));
					if (x + width > CANVAS_DESIGN_WIDTH) width = CANVAS_DESIGN_WIDTH - x;
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
				const scaleX = CANVAS_DESIGN_WIDTH / rect.width;
				const scaleY = canvasHeight / rect.height;
				const dx = (moveEvent.clientX - state.startX) * scaleX;
				const dy = (moveEvent.clientY - state.startY) * scaleY;
				const sb = state.startBounds;

				let bounds: ButtonBounds;
				if (state.mode === 'move') {
					let newX = sb.x + dx;
					let newY = sb.y + dy;
					newX = Math.max(0, Math.min(CANVAS_DESIGN_WIDTH - sb.width, newX));
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

					x = Math.max(0, Math.min(CANVAS_DESIGN_WIDTH - MIN_BUTTON_SIZE, x));
					y = Math.max(0, Math.min(canvasHeight - MIN_BUTTON_SIZE, y));
					if (x + width > CANVAS_DESIGN_WIDTH) width = CANVAS_DESIGN_WIDTH - x;
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
				...(backgroundColour ? { backgroundColor: backgroundColour } : {}),
			}}
			onClick={() => onSelectNode(null)}
		>
			{backgroundAsset && (
				<BackgroundMedia
					asset={backgroundAsset}
					isMotion={backgroundIsMotion}
					initialTimeSecs={backgroundInitialTimeSecs}
				/>
			)}
			{backgroundLabel && (
				<div className="scene-canvas__bg-label text-muted">{backgroundLabel}</div>
			)}
			{honestPreview && (
				<CompileOverlay
					buttons={buttons}
					canvasHeight={canvasHeight}
					formatProfile={formatProfile}
				/>
			)}
			{showNavLines && (
				<NavLines buttons={buttons} canvasWidth={CANVAS_DESIGN_WIDTH} canvasHeight={canvasHeight} />
			)}
			{snapLines.map((line, i) =>
				line.axis === 'x' ? (
					<div
						key={`snap-${i}`}
						className="scene-canvas__snap-line scene-canvas__snap-line--v"
						style={{ left: `${(line.pos / CANVAS_DESIGN_WIDTH) * 100}%` }}
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
							left: `${(btn.bounds.x / CANVAS_DESIGN_WIDTH) * 100}%`,
							top: `${(btn.bounds.y / canvasHeight) * 100}%`,
							width: `${(btn.bounds.width / CANVAS_DESIGN_WIDTH) * 100}%`,
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
	backgroundAsset,
	backgroundIsMotion,
	backgroundInitialTimeSecs,
	loopDurationSecs = 0,
	animationTracks = [],
	fps,
	defaultButtonId,
	highlightColours,
	honestPreview,
	displayAspect,
	formatProfile,
}: {
	buttons: MenuButton[];
	assets: Asset[];
	sceneNodes: SceneNode[];
	canvasHeight: number;
	showSafeArea: boolean;
	backgroundLabel: string | null;
	backgroundColour: string | null;
	backgroundAsset: Asset | null;
	backgroundIsMotion: boolean;
	backgroundInitialTimeSecs: number;
	loopDurationSecs?: number;
	animationTracks?: AnimationTrack[];
	/** Frame rate for the honest-preview schedule's last-presentable-frame
	 * clamp — the project's disc standard (NTSC/PAL), not a hardcoded 30fps
	 * (see `fpsForStandard`). */
	fps: number;
	defaultButtonId: string | null;
	highlightColours: MenuHighlightColours;
	honestPreview: boolean;
	displayAspect: AspectMode;
	formatProfile: FormatProfile;
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
	// The compiled disc only ever lowers TOP-LEVEL buttons (`buttons`, which
	// mirrors `MenuDocument::buttons()`/`menu_ref.buttons()` — see
	// `PreviewButtonNode`'s doc comment) — a track targeting any other node
	// (e.g. a group-nested button, named by `menu.animation-node-not-compiled`)
	// is silently dropped by the planner and must be excluded here too, or
	// the honest-preview fold would include a track the disc never shows.
	const compiledButtonIds = useMemo(() => new Set(buttons.map((b) => b.id)), [buttons]);

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
				...(backgroundColour ? { backgroundColor: backgroundColour } : {}),
			}}
		>
			{backgroundAsset && (
				<BackgroundMedia
					asset={backgroundAsset}
					isMotion={backgroundIsMotion}
					initialTimeSecs={backgroundInitialTimeSecs}
				/>
			)}
			{backgroundLabel && (
				<div className="scene-canvas__bg-label text-muted">{backgroundLabel}</div>
			)}
			{honestPreview && (
				<CompileOverlay
					buttons={buttons}
					canvasHeight={canvasHeight}
					formatProfile={formatProfile}
				/>
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
			<NavLines buttons={buttons} canvasWidth={CANVAS_DESIGN_WIDTH} canvasHeight={canvasHeight} />
			{positionedNodes.map((node) => (
				<RenderedSceneNode
					key={node.id}
					node={node}
					asset={node.type === 'image' ? (assetMap.get(node.assetId) ?? null) : null}
					canvasHeight={canvasHeight}
				/>
			))}
			{buttons.map((btn) => (
				<PreviewButtonNode
					key={btn.id}
					btn={btn}
					isFocused={btn.id === focusedId}
					isActivated={btn.id === activatedId}
					isDefault={defaultButtonId === btn.id}
					buttonNode={buttonNodeMap.get(btn.id)}
					highlightColours={highlightColours}
					animationTracks={animationTracks}
					compiledButtonIds={compiledButtonIds}
					loopStartSecs={backgroundInitialTimeSecs}
					loopDurationSecs={loopDurationSecs}
					fps={fps}
					isMotion={backgroundIsMotion}
					honestPreview={honestPreview}
					canvasHeight={canvasHeight}
					onFocus={() => setFocusedId(btn.id)}
				/>
			))}
		</div>
	);
}

/**
 * One button in the navigation preview.
 *
 * Focused-state highlight colour/opacity are sampled from this node's
 * `highlight-colour`/`highlight-opacity` tracks; activated-state colour and
 * opacity are sampled from its `activate-colour`/`activate-opacity` tracks
 * (DVD naming: spumux's "highlight" state is the focused/selected one, its
 * "select" state is the activated/pressed one — see `AnimatableProperty`'s
 * doc comment) — both fall back to the menu's static `highlightColours`
 * when there's no track. Activate opacity is baked into the outline's
 * alpha via `hexToRgba` rather than kept as a separate CSS property,
 * mirroring `bake_opacity_into_alpha`'s `select_colour` handling.
 *
 * Sampling dispatches on `isMotion`/`honestPreview`:
 *
 * - Still menu: bakes in this button's own track's first keyframe
 *   regardless of the playhead (`sampleTrackForPreview`), mirroring the
 *   disc's still-menu degrade path (a still menu can't host a schedule at
 *   all — see `build_overlay_keyframe_schedule`).
 * - Motion menu, honest preview: menu-wide fold (`sampleHonestFold`) —
 *   every button's relevant track for the state group is folded into ONE
 *   value, document-order last-track-wins, quantized to the compiled
 *   disc's actual DCSQ schedule boundary (the UNION of every highlight AND
 *   activate relevant track's keyframe timestamps together, since a
 *   keyframe in either group can force a new shared schedule instant —
 *   see `scheduleBoundarySecs`). This is the disc's actual one-CLUT
 *   behaviour: it cannot show a different colour per button the way this
 *   node's own track might suggest.
 * - Motion menu, not honest: this button's own track, continuously eased,
 *   friendlier than the disc actually produces, matching this file's
 *   preview posture elsewhere — see design decision D9.
 *
 * Each sampled value is read via its own zustand selector rather than a
 * raw `currentTime` subscription, so this component only re-renders when
 * the SAMPLED value changes (e.g. never, for Hold easing, except right at
 * a keyframe boundary) instead of at rAF/timeupdate cadence for every
 * button on the canvas while playing.
 */
function PreviewButtonNode({
	btn,
	isFocused,
	isActivated,
	isDefault,
	buttonNode,
	highlightColours,
	animationTracks,
	compiledButtonIds,
	loopStartSecs,
	loopDurationSecs,
	fps,
	isMotion,
	honestPreview,
	canvasHeight,
	onFocus,
}: {
	btn: MenuButton;
	isFocused: boolean;
	isActivated: boolean;
	isDefault: boolean;
	buttonNode: Extract<SceneNode, { type: 'button' }> | undefined;
	highlightColours: MenuHighlightColours;
	animationTracks: AnimationTrack[];
	/** The menu's top-level (compiled) button IDs — mirrors
	 * `MenuDocument::buttons()`/`menu_ref.buttons()`, which the planner
	 * restricts relevant tracks to. */
	compiledButtonIds: Set<string>;
	loopStartSecs: number;
	loopDurationSecs: number;
	/** Frame rate for the honest-preview schedule's last-presentable-frame
	 * clamp — the project's disc standard (NTSC/PAL), not a hardcoded 30fps
	 * (see `fpsForStandard`). */
	fps: number;
	isMotion: boolean;
	honestPreview: boolean;
	canvasHeight: number;
	onFocus: () => void;
}) {
	const visualState = isActivated ? 'activate' : isFocused ? 'focus' : 'normal';
	const buttonStyle = buttonNode?.buttonStyle?.[visualState];
	const labelStyle = buttonNode?.labelStyle;

	// Only look up a track when the corresponding state is actually shown —
	// an unfocused/inactive button never needs its track sampled.
	const colourTrack = isFocused
		? animationTracks.find((t) => t.nodeId === btn.id && t.target === 'highlight-colour')
		: undefined;
	const opacityTrack = isFocused
		? animationTracks.find((t) => t.nodeId === btn.id && t.target === 'highlight-opacity')
		: undefined;
	const activateColourTrack = isActivated
		? animationTracks.find((t) => t.nodeId === btn.id && t.target === 'activate-colour')
		: undefined;
	const activateOpacityTrack = isActivated
		? animationTracks.find((t) => t.nodeId === btn.id && t.target === 'activate-opacity')
		: undefined;

	// The DCSQ schedule is shared across every relevant track for a given
	// state (highlight vs. select — see `sampleHonestPreview`'s doc
	// comment), so the "relevant tracks" group passed to it must include
	// every highlight/activate-target track across every button, not just
	// this one — mirroring `build_overlay_keyframe_schedule`'s
	// `relevant_highlight_tracks`/`relevant_select_tracks`. The
	// `compiledButtonIds` check mirrors that same function's
	// `button_ids.contains(track.node_id)` guard: a track targeting a node
	// that isn't a top-level button (e.g. group-nested) is dropped by the
	// planner and must be excluded here too.
	const relevantHighlightTracks = useMemo(
		() =>
			animationTracks.filter(
				(t) =>
					(t.target === 'highlight-colour' || t.target === 'highlight-opacity') &&
					t.keyframes.length > 0 &&
					compiledButtonIds.has(t.nodeId),
			),
		[animationTracks, compiledButtonIds],
	);
	const relevantActivateTracks = useMemo(
		() =>
			animationTracks.filter(
				(t) =>
					(t.target === 'activate-colour' || t.target === 'activate-opacity') &&
					t.keyframes.length > 0 &&
					compiledButtonIds.has(t.nodeId),
			),
		[animationTracks, compiledButtonIds],
	);
	// The compiled disc bakes ONE overlay image per schedule instant
	// covering BOTH states, so a keyframe in either group can force a new
	// shared boundary — the honest-preview schedule union must be the
	// complete set, not just the group being sampled (see
	// `build_overlay_keyframe_schedule`'s `timestamps`, which chains both
	// groups together before dedup).
	const relevantSchedulingTracks = useMemo(
		() => [...relevantHighlightTracks, ...relevantActivateTracks],
		[relevantHighlightTracks, relevantActivateTracks],
	);

	// Each selector reads out a SAMPLED value (`{hex, opacity}`), not the
	// raw `currentTime`. `useShallow` shallow-compares that object across
	// renders so this node only re-renders when the sampled value itself
	// changes (e.g. never, for Hold easing, except right at a keyframe
	// boundary) instead of at rAF/timeupdate cadence for every button while
	// playing — zustand's default `Object.is` would otherwise treat every
	// render's freshly-built object as a change.
	//
	// Honest preview folds every button's relevant track into the disc's
	// single menu-wide value (`sampleHonestFold`) rather than showing this
	// button's own track — the DVD subpicture CLUT can't hold a different
	// colour per button. Still-menu and non-honest motion preview keep
	// showing this button's own track (`sampleTrackForPreview`): a still
	// menu bakes in a track's first keyframe regardless of state group, and
	// non-honest preview is deliberately a friendlier per-button view (see
	// this function's doc comment).
	const sampledHl = useMenuPlaybackStore(
		useShallow((s) => {
			const tSecs = s.currentTime - loopStartSecs;
			if (isMotion && honestPreview) {
				return sampleHonestFold(
					relevantHighlightTracks,
					relevantSchedulingTracks,
					'highlight-colour',
					'highlight-opacity',
					highlightColours.selectColour,
					highlightColours.selectOpacity,
					tSecs,
					loopDurationSecs,
					fps,
				);
			}
			return {
				hex:
					keyValueToColour(
						sampleTrackForPreview(
							colourTrack,
							relevantHighlightTracks,
							tSecs,
							loopDurationSecs,
							fps,
							isMotion,
							honestPreview,
						),
					) ?? highlightColours.selectColour,
				opacity:
					keyValueToOpacity(
						sampleTrackForPreview(
							opacityTrack,
							relevantHighlightTracks,
							tSecs,
							loopDurationSecs,
							fps,
							isMotion,
							honestPreview,
						),
					) ?? highlightColours.selectOpacity,
			};
		}),
	);
	const sampledActivate = useMenuPlaybackStore(
		useShallow((s) => {
			const tSecs = s.currentTime - loopStartSecs;
			if (isMotion && honestPreview) {
				return sampleHonestFold(
					relevantActivateTracks,
					relevantSchedulingTracks,
					'activate-colour',
					'activate-opacity',
					highlightColours.activateColour,
					highlightColours.activateOpacity,
					tSecs,
					loopDurationSecs,
					fps,
				);
			}
			return {
				hex:
					keyValueToColour(
						sampleTrackForPreview(
							activateColourTrack,
							relevantActivateTracks,
							tSecs,
							loopDurationSecs,
							fps,
							isMotion,
							honestPreview,
						),
					) ?? highlightColours.activateColour,
				opacity:
					keyValueToOpacity(
						sampleTrackForPreview(
							activateOpacityTrack,
							relevantActivateTracks,
							tSecs,
							loopDurationSecs,
							fps,
							isMotion,
							honestPreview,
						),
					) ?? highlightColours.activateOpacity,
			};
		}),
	);

	const hlColour = sampledHl.hex;
	const hlOpacity = sampledHl.opacity;
	// Baked into the outline's alpha via `hexToRgba` rather than kept as a
	// separate CSS property, mirroring `bake_opacity_into_alpha`'s
	// `highlight_colour`/`select_colour` handling — the compiled disc has no
	// separate opacity channel for either the focused or activated state,
	// only the baked alpha.
	const focusedOutlineColour = hexToRgba(hlColour, hlOpacity);
	const activateColour = hexToRgba(sampledActivate.hex, sampledActivate.opacity);

	return (
		<div
			className={`scene-canvas__node ${isFocused ? 'scene-canvas__node--focused' : ''} ${
				isDefault ? 'scene-canvas__node--default' : ''
			}`}
			style={{
				left: `${(btn.bounds.x / CANVAS_DESIGN_WIDTH) * 100}%`,
				top: `${(btn.bounds.y / canvasHeight) * 100}%`,
				width: `${(btn.bounds.width / CANVAS_DESIGN_WIDTH) * 100}%`,
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
							outline: `1px solid ${focusedOutlineColour}`,
							outlineOffset: '-1px',
							boxShadow: buttonStyle
								? `${buttonShadowCss(buttonStyle)}, 0 0 12px ${hexToRgba(hlColour, hlOpacity)}`
								: `0 0 12px ${hexToRgba(hlColour, hlOpacity)}, 0 0 24px ${hexToRgba(hlColour, hlOpacity * 0.4)}`,
						}
					: {}),
				...(isActivated
					? {
							outline: `2px solid ${activateColour}`,
							outlineOffset: '-2px',
						}
					: {}),
			}}
			onClick={onFocus}
		>
			<div className="scene-canvas__node-body">
				<span className="scene-canvas__node-label">{btn.label}</span>
			</div>
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
				left: `${(node.x / CANVAS_DESIGN_WIDTH) * 100}%`,
				top: `${(node.y / canvasHeight) * 100}%`,
				width: `${(node.width / CANVAS_DESIGN_WIDTH) * 100}%`,
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

/**
 * Background renderer for a menu's assigned background asset — a looping
 * `<video>` for motion menus whose asset has a video stream, otherwise a
 * still `<img>` (see design decision D5).
 */
function BackgroundMedia({
	asset,
	isMotion = false,
	initialTimeSecs = 0,
}: {
	asset: Asset;
	isMotion?: boolean;
	initialTimeSecs?: number;
}) {
	if (isMotion && asset.videoStreams.length > 0) {
		return <BackgroundVideo asset={asset} initialTimeSecs={initialTimeSecs} />;
	}
	return <BackgroundImage asset={asset} />;
}

/** Load a menu background asset's cached thumbnail as a blob URL, or `null`
 * when there is no cached thumbnail or the read fails. Used as the poster
 * frame for `BackgroundVideo` so the canvas shows something before the
 * video's own first frame decodes. */
function useThumbnailBlobUrl(asset: Asset): string | null {
	const [url, setUrl] = useState<string | null>(null);

	useEffect(() => {
		let revokedUrl: string | null = null;
		let cancelled = false;

		async function load() {
			if (!asset.thumbnailPath) {
				setUrl(null);
				return;
			}
			const fileName = asset.thumbnailPath.split(/[/\\]/).pop();
			if (!fileName) {
				setUrl(null);
				return;
			}
			try {
				const bytes = await readFile(`thumbnails/${fileName}`, {
					baseDir: BaseDirectory.AppCache,
				});
				if (cancelled) return;
				const blob = new Blob([bytes], { type: 'image/jpeg' });
				const objectUrl = URL.createObjectURL(blob);
				revokedUrl = objectUrl;
				setUrl(objectUrl);
			} catch {
				if (!cancelled) setUrl(null);
			}
		}
		void load();

		return () => {
			cancelled = true;
			if (revokedUrl) URL.revokeObjectURL(revokedUrl);
		};
	}, [asset.id, asset.thumbnailPath]);

	return url;
}

function BackgroundVideo({ asset, initialTimeSecs }: { asset: Asset; initialTimeSecs: number }) {
	const [loadFailed, setLoadFailed] = useState(false);
	const posterUrl = useThumbnailBlobUrl(asset);
	const registerVideo = useMenuPlaybackStore((s) => s.registerVideo);
	const reportTime = useMenuPlaybackStore((s) => s.reportTime);
	const reportDuration = useMenuPlaybackStore((s) => s.reportDuration);
	const reportPlaying = useMenuPlaybackStore((s) => s.reportPlaying);
	const videoElRef = useRef<HTMLVideoElement | null>(null);
	// Whether this mount has already retried a load failure once — the
	// asset-scope grant (`allowAssetScope`, project-store's openProject/
	// importAssets/relinkAsset) can still be landing when this element starts
	// loading, so one retry avoids a permanent "Preview unavailable" for a
	// background that's actually fine.
	const retriedRef = useRef(false);

	const setVideoRef = useCallback(
		(el: HTMLVideoElement | null) => {
			videoElRef.current = el;
			registerVideo(el);
		},
		[registerVideo],
	);

	useEffect(() => {
		setLoadFailed(false);
		retriedRef.current = false;
	}, [asset.id]);

	// Unregister the video from the playback store on unmount (e.g. switching
	// away from this menu or out of design mode) so a stale element reference
	// doesn't linger.
	useEffect(() => {
		return () => registerVideo(null);
	}, [registerVideo]);

	if (loadFailed) {
		return (
			<div className="scene-canvas__image-placeholder" aria-hidden="true">
				<div className="scene-canvas__image-placeholder-sun" />
				<div className="scene-canvas__image-placeholder-horizon" />
				<div className="scene-canvas__image-overlay">
					<span className="scene-canvas__image-kicker">Background</span>
					<span className="scene-canvas__image-caption">Preview unavailable</span>
				</div>
			</div>
		);
	}

	return (
		<video
			ref={setVideoRef}
			className="scene-canvas__bg-image"
			src={convertFileSrc(asset.sourcePath)}
			muted
			autoPlay
			// No native `loop` attribute: looping is driven by the playback
			// store's loop-region logic (`computeLoopWraparound`, applied by
			// `useVideoPlayhead`'s rAF tick), which wraps back to the authored
			// loop *region* start — not necessarily 0. The native attribute
			// would always restart at 0 the instant the file reaches its end,
			// racing the store's own wraparound and ignoring the loop-region
			// toggle entirely. With `loop` removed, reaching end-of-file while
			// loop-region playback is disabled (or the loop region ends at the
			// file's end) just pauses there, which is the sane fallback.
			playsInline
			preload="auto"
			poster={posterUrl ?? undefined}
			onLoadedMetadata={(e) => {
				e.currentTarget.currentTime = initialTimeSecs;
				reportDuration(e.currentTarget.duration);
			}}
			onDurationChange={(e) => reportDuration(e.currentTarget.duration)}
			onTimeUpdate={(e) => reportTime(e.currentTarget.currentTime)}
			onPlay={() => reportPlaying(true)}
			onPause={() => reportPlaying(false)}
			onEnded={() => useMenuPlaybackStore.getState().pause()}
			onError={() => {
				if (!retriedRef.current) {
					retriedRef.current = true;
					setTimeout(() => videoElRef.current?.load(), 300);
					return;
				}
				setLoadFailed(true);
			}}
		/>
	);
}

function BackgroundImage({ asset }: { asset: Asset }) {
	// Falls back to the original source file (via the asset:// protocol) when
	// no cached thumbnail exists yet or the cached read fails, so a background
	// still renders instead of silently showing nothing — see issue #57.
	const [imageSrc, setImageSrc] = useState<string | null>(() =>
		asset.thumbnailPath ? null : convertFileSrc(asset.sourcePath),
	);
	const [loadFailed, setLoadFailed] = useState(false);

	useEffect(() => {
		let revokedUrl: string | null = null;
		let cancelled = false;

		async function load() {
			if (!asset.thumbnailPath) {
				setImageSrc(convertFileSrc(asset.sourcePath));
				setLoadFailed(false);
				return;
			}

			const fileName = asset.thumbnailPath.split(/[/\\]/).pop();
			if (!fileName) {
				setImageSrc(convertFileSrc(asset.sourcePath));
				setLoadFailed(false);
				return;
			}

			try {
				const bytes = await readFile(`thumbnails/${fileName}`, {
					baseDir: BaseDirectory.AppCache,
				});
				if (cancelled) return;
				const blob = new Blob([bytes], { type: 'image/jpeg' });
				const url = URL.createObjectURL(blob);
				revokedUrl = url;
				setImageSrc(url);
				setLoadFailed(false);
			} catch (error) {
				if (cancelled) return;
				console.warn('[scene-canvas] Background thumbnail load failed, falling back to source', {
					assetId: asset.id,
					thumbnailPath: asset.thumbnailPath,
					error,
				});
				setImageSrc(convertFileSrc(asset.sourcePath));
				setLoadFailed(false);
			}
		}
		void load();

		return () => {
			cancelled = true;
			if (revokedUrl) URL.revokeObjectURL(revokedUrl);
		};
	}, [asset.id, asset.thumbnailPath, asset.sourcePath]);

	if (!imageSrc || loadFailed) {
		return (
			<div className="scene-canvas__image-placeholder" aria-hidden="true">
				<div className="scene-canvas__image-placeholder-sun" />
				<div className="scene-canvas__image-placeholder-horizon" />
				<div className="scene-canvas__image-overlay">
					<span className="scene-canvas__image-kicker">Background</span>
					<span className="scene-canvas__image-caption">
						{loadFailed ? 'Preview unavailable' : 'Loading…'}
					</span>
				</div>
			</div>
		);
	}

	return (
		<img
			className="scene-canvas__bg-image"
			src={imageSrc}
			alt="Menu background"
			draggable={false}
			onError={() => setLoadFailed(true)}
		/>
	);
}

function ImageNodeArtwork({ asset, label }: { asset?: Asset | null; label: string | null }) {
	const [imageSrc, setImageSrc] = useState<string | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);

	useEffect(() => {
		let revokedUrl: string | null = null;
		let cancelled = false;

		async function loadImage() {
			if (!asset || !asset.thumbnailPath) {
				setImageSrc(null);
				setLoadFailed(false);
				return;
			}

			const fileName = asset.thumbnailPath.split(/[/\\]/).pop();
			if (!fileName) {
				setImageSrc(null);
				setLoadFailed(false);
				return;
			}

			try {
				const bytes = await readFile(`thumbnails/${fileName}`, {
					baseDir: BaseDirectory.AppCache,
				});
				if (cancelled) {
					return;
				}
				const blob = new Blob([bytes], { type: 'image/jpeg' });
				const objectUrl = URL.createObjectURL(blob);
				revokedUrl = objectUrl;
				setImageSrc(objectUrl);
				setLoadFailed(false);
			} catch (error) {
				if (!cancelled) {
					console.warn('[scene-canvas] Image node preview load failed', {
						assetId: asset.id,
						thumbnailPath: asset.thumbnailPath,
						error,
					});
					setImageSrc(null);
					setLoadFailed(true);
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
	}, [asset?.id, asset?.thumbnailPath]);

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
			{!imageSrc ? (
				<div className="scene-canvas__image-overlay">
					<span className="scene-canvas__image-kicker">Image</span>
					<span className="scene-canvas__image-caption">
						{loadFailed ? 'Preview unavailable' : label || 'Assign an image asset'}
					</span>
				</div>
			) : null}
		</>
	);
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

interface CompileOverlayCheck {
	label: string;
	value: string;
	ok: boolean;
}

function CompileOverlay({
	buttons,
	canvasHeight,
	formatProfile,
}: {
	buttons: MenuButton[];
	canvasHeight: number;
	formatProfile: FormatProfile;
}) {
	const maxButtons = formatProfile.maxButtonsPerMenu;
	const btnCount = buttons.length;
	const btnOk = btnCount <= maxButtons;

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

	const safeL = CANVAS_DESIGN_WIDTH * ACTION_SAFE_PCT;
	const safeT = canvasHeight * ACTION_SAFE_PCT;
	const safeR = CANVAS_DESIGN_WIDTH * (1 - ACTION_SAFE_PCT);
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
			value: `${btnCount} / ${maxButtons}`,
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
