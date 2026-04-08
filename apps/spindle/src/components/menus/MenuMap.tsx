// MenuMap — shared navigation graph renderer for mini and full map views.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { SpindleProjectFile, PlaybackAction } from '../../types/project';

// ── Layout constants ────────────────────────────────────────────────────────

const FULL_NODE_W = 160;
const FULL_NODE_H = 60;
const FULL_COL_GAP = 100;
const FULL_ROW_GAP = 24;
const FULL_PADDING = 24;

const MINI_NODE_W = 80;
const MINI_NODE_H = 32;
const MINI_COL_GAP = 48;
const MINI_ROW_GAP = 12;
const MINI_PADDING = 12;

// ── Graph types ─────────────────────────────────────────────────────────────

interface LayoutNode {
	id: string;
	type: 'menu' | 'title';
	label: string;
	sublabel?: string;
	domain?: 'vmgm' | 'titleset';
	x: number;
	y: number;
	w: number;
	h: number;
}

type EdgeType = 'showMenu' | 'playTitle' | 'playChapter' | 'firstPlay' | 'endAction' | 'return';

interface LayoutEdge {
	key: string;
	fromId: string;
	toId: string;
	edgeType: EdgeType;
}

interface MapLayout {
	nodes: LayoutNode[];
	edges: LayoutEdge[];
	/** Node IDs that contain at least one Return action (resume playback). */
	returnNodeIds: Set<string>;
	totalWidth: number;
	totalHeight: number;
}

// ── Graph computation ───────────────────────────────────────────────────────

function extractEdgesFromAction(
	action: PlaybackAction,
	fromId: string,
	out: LayoutEdge[],
	returnIds: Set<string>,
	depth = 0,
): void {
	// Guard against pathological sequence recursion
	if (depth > 8) return;

	switch (action.type) {
		case 'showMenu':
			out.push({
				key: `${fromId}→showMenu→${action.menuId}`,
				fromId,
				toId: action.menuId,
				edgeType: 'showMenu',
			});
			break;
		case 'playTitle':
			out.push({
				key: `${fromId}→playTitle→${action.titleId}`,
				fromId,
				toId: action.titleId,
				edgeType: 'playTitle',
			});
			break;
		case 'playChapter':
			out.push({
				key: `${fromId}→playChapter→${action.titleId}`,
				fromId,
				toId: action.titleId,
				edgeType: 'playChapter',
			});
			break;
		case 'return':
			// Return resumes playback — no fixed target, so mark the source node
			returnIds.add(fromId);
			break;
		case 'sequence':
			for (const sub of action.actions) {
				extractEdgesFromAction(sub, fromId, out, returnIds, depth + 1);
			}
			break;
	}
}

function computeMapLayout(project: SpindleProjectFile, compact: boolean): MapLayout {
	const nw = compact ? MINI_NODE_W : FULL_NODE_W;
	const nh = compact ? MINI_NODE_H : FULL_NODE_H;
	const cg = compact ? MINI_COL_GAP : FULL_COL_GAP;
	const rg = compact ? MINI_ROW_GAP : FULL_ROW_GAP;
	const pad = compact ? MINI_PADDING : FULL_PADDING;

	const nodes: LayoutNode[] = [];
	const rawEdges: LayoutEdge[] = [];
	const returnIds = new Set<string>();

	// Column 0: Global (VMGM) menus
	project.disc.globalMenus.forEach((menu, row) => {
		nodes.push({
			id: menu.id,
			type: 'menu',
			label: menu.name,
			domain: 'vmgm',
			x: pad,
			y: pad + row * (nh + rg),
			w: nw,
			h: nh,
		});
	});

	// Columns 1..N: Per-titleset menus
	project.disc.titlesets.forEach((ts, tsIdx) => {
		const col = 1 + tsIdx;
		ts.menus.forEach((menu, row) => {
			nodes.push({
				id: menu.id,
				type: 'menu',
				label: menu.name,
				sublabel: ts.name,
				domain: 'titleset',
				x: pad + col * (nw + cg),
				y: pad + row * (nh + rg),
				w: nw,
				h: nh,
			});
		});
	});

	// Title column (rightmost)
	const titleCol = 1 + project.disc.titlesets.length;
	const allTitles = project.disc.titlesets.flatMap((ts) => ts.titles);
	allTitles.forEach((title, row) => {
		nodes.push({
			id: title.id,
			type: 'title',
			label: title.name,
			x: pad + titleCol * (nw + cg),
			y: pad + row * (nh + rg),
			w: nw,
			h: nh,
		});
	});

	// Build a set of known IDs for edge validation
	const knownIds = new Set(nodes.map((n) => n.id));

	// Extract edges from firstPlayAction
	if (project.disc.firstPlayAction) {
		extractEdgesFromAction(project.disc.firstPlayAction, '__disc__', rawEdges, returnIds);
	}

	// Extract edges from each menu's button actions and timeout
	const allMenus = [
		...project.disc.globalMenus,
		...project.disc.titlesets.flatMap((ts) => ts.menus),
	];
	for (const menu of allMenus) {
		const interactionNodes = menu.authoredDocument?.interaction.nodes ?? [];
		for (const inode of interactionNodes) {
			if (inode.action) {
				extractEdgesFromAction(inode.action, menu.id, rawEdges, returnIds);
			}
		}
		// Also scan legacy buttons
		if (!menu.authoredDocument) {
			for (const btn of menu.buttons) {
				if (btn.action) {
					extractEdgesFromAction(btn.action, menu.id, rawEdges, returnIds);
				}
			}
		}
		// Timeout action
		const timeoutAction = menu.authoredDocument?.interaction.timeoutAction ?? menu.timeoutAction;
		if (timeoutAction) {
			extractEdgesFromAction(timeoutAction, menu.id, rawEdges, returnIds);
		}
	}

	// Extract edges from title endActions
	for (const ts of project.disc.titlesets) {
		for (const title of ts.titles) {
			if (title.endAction) {
				extractEdgesFromAction(title.endAction, title.id, rawEdges, returnIds);
			}
		}
	}

	// Deduplicate edges and filter to known nodes
	const seen = new Set<string>();
	const edges: LayoutEdge[] = [];
	for (const e of rawEdges) {
		// Skip edges referencing unknown nodes (orphan references)
		if (!knownIds.has(e.fromId) || !knownIds.has(e.toId)) continue;
		if (seen.has(e.key)) continue;
		seen.add(e.key);
		edges.push(e);
	}

	// Compute canvas bounds
	const maxX = nodes.reduce((m, n) => Math.max(m, n.x + n.w), 0);
	const maxY = nodes.reduce((m, n) => Math.max(m, n.y + n.h), 0);
	const totalWidth = maxX + pad;
	const totalHeight = maxY + pad;

	return { nodes, edges, returnNodeIds: returnIds, totalWidth, totalHeight };
}

// ── Colour mapping ──────────────────────────────────────────────────────────

const EDGE_COLOURS: Record<EdgeType, string> = {
	showMenu: '#60a5fa', // blue
	playTitle: '#4ade80', // green
	playChapter: '#34d399', // teal
	firstPlay: '#ffaa40', // brand orange
	endAction: '#a78bfa', // violet
	return: '#f472b6', // pink — distinct from other edge types
};

const EDGE_LABELS: Record<EdgeType, string> = {
	showMenu: 'show',
	playTitle: 'play',
	playChapter: 'chapter',
	firstPlay: 'first play',
	endAction: 'end',
	return: 'return',
};

// ── SVG renderer ─────────────────────────────────────────────────────────────

function EdgePath({
	edge,
	fromNode,
	toNode,
	compact,
}: {
	edge: LayoutEdge;
	fromNode: LayoutNode;
	toNode: LayoutNode;
	compact: boolean;
}) {
	const colour = EDGE_COLOURS[edge.edgeType];
	const markerId = `arrow-${edge.edgeType}`;

	// Choose connection points: right edge of from, left edge of to
	// If from is to the right, use left/right swapped
	const fromRight = fromNode.x + fromNode.w;
	const fromCentreY = fromNode.y + fromNode.h / 2;
	const toLeft = toNode.x;
	const toCentreY = toNode.y + toNode.h / 2;

	let x1, y1, x2, y2, cp1x, cp1y, cp2x, cp2y: number;

	if (fromRight <= toLeft) {
		// from is left of to: draw right→left bezier
		x1 = fromRight;
		y1 = fromCentreY;
		x2 = toLeft;
		y2 = toCentreY;
		const offset = Math.max(30, (x2 - x1) * 0.5);
		cp1x = x1 + offset;
		cp1y = y1;
		cp2x = x2 - offset;
		cp2y = y2;
	} else {
		// from is right of or overlapping to: curve around with upward arc
		x1 = fromNode.x;
		y1 = fromCentreY;
		x2 = toNode.x + toNode.w;
		y2 = toCentreY;
		const offset = Math.max(40, Math.abs(x1 - x2) * 0.5 + 20);
		cp1x = x1 - offset;
		cp1y = y1 - offset * 0.5;
		cp2x = x2 + offset;
		cp2y = y2 - offset * 0.5;
	}

	const d = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
	const strokeWidth = compact ? 1 : 1.5;

	return (
		<path
			d={d}
			stroke={colour}
			strokeWidth={strokeWidth}
			fill="none"
			strokeOpacity={0.7}
			markerEnd={`url(#${markerId})`}
		/>
	);
}

function NodeRect({
	node,
	isSelected,
	compact,
	hasReturn,
	onClick,
	onDoubleClick,
}: {
	node: LayoutNode;
	isSelected: boolean;
	compact: boolean;
	hasReturn: boolean;
	onClick: (id: string) => void;
	onDoubleClick?: (id: string) => void;
}) {
	const isMenu = node.type === 'menu';
	const isVmgm = node.domain === 'vmgm';

	const fill = isSelected
		? 'rgba(255, 170, 64, 0.15)'
		: isMenu
			? isVmgm
				? 'rgba(34, 211, 238, 0.06)'
				: 'rgba(167, 139, 250, 0.06)'
			: 'rgba(74, 222, 128, 0.06)';

	const stroke = isSelected
		? '#ffaa40'
		: isMenu
			? isVmgm
				? 'rgba(34, 211, 238, 0.5)'
				: 'rgba(167, 139, 250, 0.4)'
			: 'rgba(74, 222, 128, 0.4)';

	const fontSize = compact ? 9 : 11;
	const subFontSize = compact ? 8 : 9;
	const labelY = node.y + (compact ? node.h / 2 + 3 : node.h / 2 + 4);
	const subY = labelY + (compact ? 10 : 13);

	return (
		<g
			style={{ cursor: 'pointer' }}
			onClick={() => onClick(node.id)}
			onDoubleClick={() => onDoubleClick?.(node.id)}
		>
			<rect
				x={node.x}
				y={node.y}
				width={node.w}
				height={node.h}
				rx={4}
				fill={fill}
				stroke={stroke}
				strokeWidth={isSelected ? 1.5 : 1}
			/>
			<text
				x={node.x + node.w / 2}
				y={labelY}
				textAnchor="middle"
				fontSize={fontSize}
				fill={isSelected ? '#ffaa40' : '#e2e8f0'}
				fontWeight={isSelected ? '600' : '500'}
				fontFamily="var(--font-body, system-ui, sans-serif)"
				style={{ pointerEvents: 'none', userSelect: 'none' }}
			>
				{truncate(node.label, compact ? 10 : 18)}
			</text>
			{node.sublabel && !compact && (
				<text
					x={node.x + node.w / 2}
					y={subY}
					textAnchor="middle"
					fontSize={subFontSize}
					fill="rgba(148, 163, 184, 0.7)"
					fontFamily="var(--font-body, system-ui, sans-serif)"
					style={{ pointerEvents: 'none', userSelect: 'none' }}
				>
					{truncate(node.sublabel, 20)}
				</text>
			)}
			{/* Type badge on the right edge of the node */}
			{!compact && (
				<text
					x={node.x + node.w - 4}
					y={node.y + 10}
					textAnchor="end"
					fontSize={8}
					fill="rgba(148, 163, 184, 0.5)"
					fontFamily="var(--font-body, system-ui, sans-serif)"
					style={{ pointerEvents: 'none', userSelect: 'none' }}
				>
					{node.type === 'title' ? 'TITLE' : isVmgm ? 'VMGM' : 'MENU'}
				</text>
			)}
			{/* Return badge — shows a loopback indicator for nodes with return actions */}
			{hasReturn && (
				<>
					<circle
						cx={node.x + node.w - (compact ? 6 : 8)}
						cy={node.y + node.h - (compact ? 6 : 8)}
						r={compact ? 4 : 6}
						fill="rgba(244, 114, 182, 0.2)"
						stroke="#f472b6"
						strokeWidth={compact ? 0.75 : 1}
					/>
					{!compact && (
						<text
							x={node.x + node.w - 8}
							y={node.y + node.h - 5}
							textAnchor="middle"
							fontSize={7}
							fill="#f472b6"
							fontWeight="700"
							fontFamily="var(--font-body, system-ui, sans-serif)"
							style={{ pointerEvents: 'none', userSelect: 'none' }}
						>
							R
						</text>
					)}
				</>
			)}
		</g>
	);
}

function truncate(str: string, max: number): string {
	return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

// ── Shared SVG map renderer ─────────────────────────────────────────────────

function MapSvg({
	layout,
	selectedMenuId,
	compact,
	onSelect,
	onOpenInEditor,
}: {
	layout: MapLayout;
	selectedMenuId: string | null;
	compact: boolean;
	onSelect: (id: string) => void;
	onOpenInEditor?: (id: string) => void;
}) {
	const { nodes, edges, returnNodeIds, totalWidth, totalHeight } = layout;
	const nodeMap = new Map(nodes.map((n) => [n.id, n]));

	const edgeTypes: EdgeType[] = ['showMenu', 'playTitle', 'playChapter', 'firstPlay', 'endAction'];
	const arrowSize = compact ? 4 : 6;

	return (
		<svg
			viewBox={`0 0 ${totalWidth} ${totalHeight}`}
			width="100%"
			height="100%"
			style={{ display: 'block' }}
		>
			<defs>
				{edgeTypes.map((type) => (
					<marker
						key={type}
						id={`arrow-${type}`}
						markerWidth={arrowSize}
						markerHeight={arrowSize}
						refX={arrowSize - 1}
						refY={arrowSize / 2}
						orient="auto"
					>
						<path
							d={`M 0 0 L ${arrowSize} ${arrowSize / 2} L 0 ${arrowSize} z`}
							fill={EDGE_COLOURS[type]}
							fillOpacity={0.7}
						/>
					</marker>
				))}
			</defs>

			{/* Edges drawn first so they appear behind nodes */}
			{edges.map((edge) => {
				const fromNode = nodeMap.get(edge.fromId);
				const toNode = nodeMap.get(edge.toId);
				if (!fromNode || !toNode) return null;
				return (
					<EdgePath
						key={edge.key}
						edge={edge}
						fromNode={fromNode}
						toNode={toNode}
						compact={compact}
					/>
				);
			})}

			{/* Nodes */}
			{nodes.map((node) => (
				<NodeRect
					key={node.id}
					node={node}
					isSelected={node.id === selectedMenuId}
					compact={compact}
					hasReturn={returnNodeIds.has(node.id)}
					onClick={(id) => {
						if (node.type === 'menu') onSelect(id);
					}}
					onDoubleClick={(id) => {
						if (node.type === 'menu') onOpenInEditor?.(id);
					}}
				/>
			))}
		</svg>
	);
}

// ── Mini Map (left rail) ────────────────────────────────────────────────────
// Compact read-only graph in the left nav rail for persistent orientation.

export function MiniMenuMap({
	project,
	selectedMenuId,
	onSelect,
	onExpand,
}: {
	project: SpindleProjectFile;
	selectedMenuId: string | null;
	onSelect: (id: string) => void;
	onExpand: () => void;
}) {
	const layout = computeMapLayout(project, true);

	if (layout.nodes.length === 0) return null;

	return (
		<div className="mini-map">
			<div className="mini-map__header">
				<span className="mini-map__label">Navigation Map</span>
				<button className="btn btn--ghost btn--xs" onClick={onExpand} title="Open full map">
					⤢
				</button>
			</div>
			<div className="mini-map__canvas">
				<MapSvg
					layout={layout}
					selectedMenuId={selectedMenuId}
					compact={true}
					onSelect={onSelect}
				/>
			</div>
			{/* Edge type legend */}
			<div className="mini-map__legend">
				<span className="mini-map__legend-item" style={{ color: EDGE_COLOURS.showMenu }}>
					● show
				</span>
				<span className="mini-map__legend-item" style={{ color: EDGE_COLOURS.playTitle }}>
					● play
				</span>
				<span className="mini-map__legend-item" style={{ color: EDGE_COLOURS.return }}>
					● return
				</span>
			</div>
		</div>
	);
}

// ── Full Map View ───────────────────────────────────────────────────────────
// Full workspace map view with connection inspector sidebar.

export function FullMenuMap({
	project,
	selectedMenuId,
	onSelectMenu,
	onOpenInEditor,
}: {
	project: SpindleProjectFile;
	selectedMenuId: string | null;
	onSelectMenu: (id: string) => void;
	onOpenInEditor: (id: string) => void;
}) {
	const layout = computeMapLayout(project, false);
	const allMenus = [
		...project.disc.globalMenus,
		...project.disc.titlesets.flatMap((ts) => ts.menus),
	];
	const selectedMenu = allMenus.find((m) => m.id === selectedMenuId) ?? null;

	// Compute outgoing and incoming connections for the selected menu
	const outgoing = layout.edges.filter((e) => e.fromId === selectedMenuId);
	const incoming = layout.edges.filter((e) => e.toId === selectedMenuId);

	return (
		<div className="menu-map">
			<div className="menu-map__canvas-area">
				{layout.nodes.length === 0 ? (
					<div className="menu-map__empty text-muted">
						Add menus to see the navigation map.
					</div>
				) : (
					<MapSvg
						layout={layout}
						selectedMenuId={selectedMenuId}
						compact={false}
						onSelect={onSelectMenu}
						onOpenInEditor={onOpenInEditor}
					/>
				)}
			</div>

			{/* Map inspector sidebar */}
			<div className="menu-map__inspector">
				{selectedMenu ? (
					<div className="menu-map__inspector-body">
						<h4 className="menu-map__inspector-heading">
							{selectedMenu.name}
						</h4>
						<p className="menu-map__inspector-hint text-muted">
							Double-click a menu card to open it in the editor.
						</p>

						<div className="menu-map__inspector-section">
							<h5 className="menu-map__inspector-subheading">Outgoing</h5>
							{outgoing.length === 0 ? (
								<p className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
									No outgoing connections.
								</p>
							) : (
								<ul className="menu-map__conn-list">
									{deduplicateEdges(outgoing).map((e) => {
										const target = layout.nodes.find((n) => n.id === e.toId);
										return (
											<li key={e.key} className="menu-map__conn-item">
												<span
													className="menu-map__conn-type"
													style={{ color: EDGE_COLOURS[e.edgeType] }}
												>
													{EDGE_LABELS[e.edgeType]}
												</span>
												<button
													className="btn btn--ghost btn--xs"
													onClick={() => {
														if (target?.type === 'menu') onSelectMenu(e.toId);
													}}
													title="Jump to this menu"
												>
													{target?.label ?? e.toId}
												</button>
											</li>
										);
									})}
								</ul>
							)}
						</div>

						<div className="menu-map__inspector-section">
							<h5 className="menu-map__inspector-subheading">Incoming</h5>
							{incoming.length === 0 ? (
								<p className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
									No incoming connections.
								</p>
							) : (
								<ul className="menu-map__conn-list">
									{deduplicateEdges(incoming).map((e) => {
										const source = layout.nodes.find((n) => n.id === e.fromId);
										return (
											<li key={e.key} className="menu-map__conn-item">
												<span
													className="menu-map__conn-type"
													style={{ color: EDGE_COLOURS[e.edgeType] }}
												>
													{EDGE_LABELS[e.edgeType]}
												</span>
												<button
													className="btn btn--ghost btn--xs"
													onClick={() => {
														if (source?.type === 'menu') onSelectMenu(e.fromId);
													}}
													title="Jump to source"
												>
													{source?.label ?? e.fromId}
												</button>
											</li>
										);
									})}
								</ul>
							)}
						</div>

						<div className="menu-map__inspector-section">
							<button className="btn btn--sm btn--primary" onClick={() => onOpenInEditor(selectedMenu.id)}>
								Open in Editor
							</button>
						</div>
					</div>
				) : (
					<div className="menu-map__inspector-empty text-muted">
						<p>Select a menu card to see its connections.</p>
					</div>
				)}

				{/* Edge type legend */}
				<div className="menu-map__legend">
					{(Object.entries(EDGE_COLOURS) as [EdgeType, string][]).map(([type, colour]) => (
						<div key={type} className="menu-map__legend-item">
							<span className="menu-map__legend-dot" style={{ background: colour }} />
							<span className="menu-map__legend-label">{EDGE_LABELS[type]}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Deduplicate edges by fromId+toId for display lists. */
function deduplicateEdges(edges: LayoutEdge[]): LayoutEdge[] {
	const seen = new Set<string>();
	return edges.filter((e) => {
		const k = `${e.fromId}:${e.toId}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}
