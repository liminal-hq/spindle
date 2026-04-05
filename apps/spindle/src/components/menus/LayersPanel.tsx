// Layers panel — scene node list with type icons and selection.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { SceneNode } from '../../types/project';

/** Type icon map for scene node types. */
const NODE_TYPE_ICONS: Record<SceneNode['type'], string> = {
	button: 'B',
	text: 'T',
	image: 'I',
	shape: 'S',
	video: 'V',
	group: 'G',
	componentInstance: 'C',
	generatedCollection: 'R',
};

const NODE_TYPE_LABELS: Record<SceneNode['type'], string> = {
	button: 'Button',
	text: 'Text',
	image: 'Image',
	shape: 'Shape',
	video: 'Video',
	group: 'Group',
	componentInstance: 'Component',
	generatedCollection: 'Collection',
};

export interface LayersPanelProps {
	nodes: SceneNode[];
	selectedNodeId: string | null;
	onSelectNode: (nodeId: string | null) => void;
	collapsed: boolean;
	onToggleCollapse: () => void;
}

export function LayersPanel({
	nodes,
	selectedNodeId,
	onSelectNode,
	collapsed,
	onToggleCollapse,
}: LayersPanelProps) {
	if (collapsed) {
		return (
			<div className="layers-panel layers-panel--collapsed">
				<button
					className="layers-panel__collapse-btn"
					onClick={onToggleCollapse}
					title="Expand layers"
				>
					<span className="layers-panel__collapse-icon">L</span>
				</button>
			</div>
		);
	}

	return (
		<div className="layers-panel">
			<div className="layers-panel__header">
				<h4 className="layers-panel__title">Layers</h4>
				<button
					className="layers-panel__collapse-btn"
					onClick={onToggleCollapse}
					title="Collapse layers"
				>
					&lsaquo;
				</button>
			</div>
			<div className="layers-panel__list">
				{nodes.length === 0 ? (
					<div className="layers-panel__empty text-muted">No scene nodes</div>
				) : (
					[...nodes].reverse().map((node) => (
						<div
							key={node.id}
							className={`layers-panel__item ${
								selectedNodeId === node.id ? 'layers-panel__item--selected' : ''
							}`}
							onClick={() => onSelectNode(node.id)}
							role="button"
							tabIndex={0}
							onKeyDown={(e) => e.key === 'Enter' && onSelectNode(node.id)}
						>
							<span className="layers-panel__type-icon" title={NODE_TYPE_LABELS[node.type]}>
								{NODE_TYPE_ICONS[node.type]}
							</span>
							<span className="layers-panel__node-name">
								{getNodeLabel(node)}
							</span>
						</div>
					))
				)}
			</div>
		</div>
	);
}

function getNodeLabel(node: SceneNode): string {
	switch (node.type) {
		case 'button':
			return node.label;
		case 'text':
			return node.content || 'Text';
		case 'group':
			return node.name;
		case 'image':
		case 'video':
			return node.assetId || NODE_TYPE_LABELS[node.type];
		default:
			return NODE_TYPE_LABELS[node.type];
	}
}
