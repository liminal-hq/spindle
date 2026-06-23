// Shared default values for newly-created menu canvas geometry and node styling.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { ButtonStyleMap, TextStyle, VideoStandard } from '../../types/project';

// DVD menu canvas dimensions vary by video standard
export const MENU_HEIGHT: Record<VideoStandard, number> = { NTSC: 480, PAL: 576 };

export const DEFAULT_BUTTON_STYLE_MAP: ButtonStyleMap = {
	normal: {
		bgFill: 'rgba(255,255,255,0.04)',
		borderColour: '#ffffff1f',
		borderWidth: 1.5,
		borderRadius: 6,
		paddingH: 16,
		paddingV: 0,
		shadowType: 'none',
		shadowColour: '#ffa84020',
		shadowBlur: 16,
		shadowSpread: 0,
	},
	focus: {
		bgFill: 'rgba(255,170,64,0.15)',
		borderColour: '#ffaa40',
		borderWidth: 1.5,
		borderRadius: 6,
		paddingH: 16,
		paddingV: 0,
		shadowType: 'box-shadow',
		shadowColour: '#ffa84040',
		shadowBlur: 16,
		shadowSpread: 0,
	},
	activate: {
		bgFill: 'rgba(255,209,102,0.2)',
		borderColour: '#ffd166',
		borderWidth: 2,
		borderRadius: 6,
		paddingH: 16,
		paddingV: 0,
		shadowType: 'outer-glow',
		shadowColour: '#ffd16660',
		shadowBlur: 24,
		shadowSpread: 4,
	},
};

export const DEFAULT_TEXT_STYLE: TextStyle = {
	fontFamily: 'Space Grotesk',
	fontSize: 14,
	fontWeight: 'normal',
	fontItalic: false,
	textDecoration: 'none',
	textAlign: 'left',
	colour: '#ffffff',
	lineHeight: 1.4,
	letterSpacing: 0,
};
