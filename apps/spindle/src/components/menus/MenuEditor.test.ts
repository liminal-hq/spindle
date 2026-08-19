// Tests for `collectSubtreeNodeIds`, the helper that finds every id in a
// scene node's own subtree (itself plus, for a `group`, every descendant).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import type { SceneNode } from '../../types/project';
import { collectSubtreeNodeIds } from './MenuEditor';

describe('collectSubtreeNodeIds', () => {
	it('returns just its own id for a leaf node', () => {
		const shape: SceneNode = { type: 'shape', id: 'shape-1', x: 0, y: 0, width: 10, height: 10 };
		expect(collectSubtreeNodeIds(shape)).toEqual(['shape-1']);
	});

	it('collects a group and all of its direct children', () => {
		const group: SceneNode = {
			type: 'group',
			id: 'group-1',
			name: 'Group',
			children: [
				{ type: 'shape', id: 'child-1', x: 0, y: 0, width: 10, height: 10 },
				{ type: 'text', id: 'child-2', content: 'hi', x: 0, y: 0, width: 10, height: 10 },
			],
		};
		expect(collectSubtreeNodeIds(group)).toEqual(['group-1', 'child-1', 'child-2']);
	});

	it('recurses into nested groups', () => {
		// Regression test: deleting a top-level group removes its whole child
		// subtree from `scene.nodes`, so the animation-track cleanup must walk
		// the same subtree — not just the group's own id — or a deeply nested
		// child's track is orphaned and trips `menu.animation-node-missing`.
		const nested: SceneNode = {
			type: 'group',
			id: 'outer',
			name: 'Outer',
			children: [
				{
					type: 'group',
					id: 'inner',
					name: 'Inner',
					children: [{ type: 'shape', id: 'leaf', x: 0, y: 0, width: 10, height: 10 }],
				},
				{ type: 'shape', id: 'sibling', x: 0, y: 0, width: 10, height: 10 },
			],
		};
		expect(collectSubtreeNodeIds(nested)).toEqual(['outer', 'inner', 'leaf', 'sibling']);
	});
});
