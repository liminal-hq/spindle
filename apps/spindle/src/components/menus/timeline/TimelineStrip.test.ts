// Tests for `defaultValueForTarget`, the value a newly-inserted keyframe
// samples when its track has no existing keyframes to sample from.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { DEFAULT_HIGHLIGHT_COLOURS } from '../../../types/project';
import { defaultValueForTarget } from './TimelineStrip';

describe('defaultValueForTarget', () => {
	it('sources highlight-colour/opacity from the menu-highlight (select) pair', () => {
		expect(defaultValueForTarget(DEFAULT_HIGHLIGHT_COLOURS, 'highlight-colour')).toEqual({
			kind: 'colour',
			hex: DEFAULT_HIGHLIGHT_COLOURS.selectColour,
		});
		expect(defaultValueForTarget(DEFAULT_HIGHLIGHT_COLOURS, 'highlight-opacity')).toEqual({
			kind: 'scalar',
			value: DEFAULT_HIGHLIGHT_COLOURS.selectOpacity,
		});
	});

	it('sources activate-colour/opacity from the activate pair, not the point fallback', () => {
		// Regression test: an empty activate-colour/activate-opacity track's
		// double-click insertion fell through to the `position` (`point`)
		// default, which preview/planner ignore for a colour/scalar target,
		// making the inserted keyframe invisible.
		expect(defaultValueForTarget(DEFAULT_HIGHLIGHT_COLOURS, 'activate-colour')).toEqual({
			kind: 'colour',
			hex: DEFAULT_HIGHLIGHT_COLOURS.activateColour,
		});
		expect(defaultValueForTarget(DEFAULT_HIGHLIGHT_COLOURS, 'activate-opacity')).toEqual({
			kind: 'scalar',
			value: DEFAULT_HIGHLIGHT_COLOURS.activateOpacity,
		});
	});

	it('falls back to a scalar 1 for opacity and a zero point for position', () => {
		expect(defaultValueForTarget(DEFAULT_HIGHLIGHT_COLOURS, 'opacity')).toEqual({
			kind: 'scalar',
			value: 1,
		});
		expect(defaultValueForTarget(DEFAULT_HIGHLIGHT_COLOURS, 'position')).toEqual({
			kind: 'point',
			x: 0,
			y: 0,
		});
	});
});
