// Pure helpers for the inspector header copy and PlaybackAction <-> <select> value
// serialisation used by the menu-level audit table and the button action select.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { SceneNode, MenuButton, PlaybackAction } from '../../types/project';

export function getInspectorTitle(
	selectedNode: SceneNode | null,
	selectedButton: MenuButton | null,
): string {
	if (!selectedNode) return 'Menu Inspector';
	if (selectedNode.type === 'button' && selectedButton) return selectedButton.label || 'Button';
	if (selectedNode.type === 'text') return selectedNode.content || 'Text';
	if (selectedNode.type === 'image') return selectedNode.assetId || 'Image';
	if (selectedNode.type === 'shape') return 'Shape';
	return selectedNode.type.charAt(0).toUpperCase() + selectedNode.type.slice(1);
}

export function getInspectorSubtitle(
	selectedNode: SceneNode | null,
	selectedButton: MenuButton | null,
	buttons?: MenuButton[],
): string {
	if (!selectedNode) {
		const buttonCount = buttons?.length ?? 0;
		return buttonCount === 0
			? 'Diagnostics, compile policy, and palette controls for this menu.'
			: `Diagnostics, palette, and default-focus controls across ${buttonCount} button${buttonCount === 1 ? '' : 's'}.`;
	}

	if (selectedNode.type === 'button' && selectedButton) {
		return `Button node with action, navigation, and authored highlight styling.`;
	}

	if (selectedNode.type === 'text') {
		return 'Typography, colour, and frame controls for the selected text node.';
	}

	if (selectedNode.type === 'image') {
		return 'Asset assignment and frame controls for the selected image node.';
	}

	if (selectedNode.type === 'shape') {
		return 'Fill and frame controls for the selected shape node.';
	}

	return 'Additional node controls will land in a future polish pass.';
}

export function actionToString(action: PlaybackAction | null): string {
	if (!action) return '';
	switch (action.type) {
		case 'playTitle':
			return `playTitle:${action.titleId}`;
		case 'playChapter':
			return `playChapter:${action.titleId}:${action.chapterId}`;
		case 'showMenu':
			return `showMenu:${action.menuId}`;
		case 'setAudioStream':
			return `setAudioStream:${action.streamIndex}`;
		case 'setSubtitleStream':
			return `setSubtitleStream:${action.streamIndex ?? 'null'}`;
		case 'stop':
			return 'stop';
		case 'return':
			return 'return';
		case 'playAllInTitleset':
			return 'playAllInTitleset';
		default:
			return '';
	}
}

export function stringToAction(str: string): PlaybackAction | null {
	if (!str) return null;
	if (str === 'stop') return { type: 'stop' };
	if (str === 'return') return { type: 'return' };
	if (str === 'playAllInTitleset') return { type: 'playAllInTitleset' };
	const parts = str.split(':');
	const type = parts[0];
	if (type === 'playTitle' && parts[1]) return { type: 'playTitle', titleId: parts[1] };
	if (type === 'playChapter' && parts[1] && parts[2])
		return { type: 'playChapter', titleId: parts[1], chapterId: parts[2] };
	if (type === 'showMenu' && parts[1]) return { type: 'showMenu', menuId: parts[1] };
	if (type === 'setAudioStream' && parts[1] !== undefined)
		return { type: 'setAudioStream', streamIndex: Number(parts[1]) };
	if (type === 'setSubtitleStream' && parts[1] !== undefined) {
		const idx = parts[1] === 'null' ? null : Number(parts[1]);
		return { type: 'setSubtitleStream', streamIndex: idx };
	}
	return null;
}
