// Pure menu-generation logic: chapter-grid, audio-setup, and subtitle-setup
// menu builders, and the rail's generator-availability stats.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type {
	AspectMode,
	FocusNode,
	Menu,
	MenuDocument,
	PlaybackAction,
	SceneNode,
	SpindleProjectFile,
	VideoStandard,
} from '../../types/project';
import {
	DEFAULT_HIGHLIGHT_COLOURS,
	DEFAULT_MENU_BACKGROUND_COLOUR,
	createDefaultMenuCompilePolicy,
} from '../../types/project';
import { DEFAULT_BUTTON_STYLE_MAP, DEFAULT_TEXT_STYLE, MENU_HEIGHT } from './menuDefaults';

export function getChapterGenerationStats(
	titleset: SpindleProjectFile['disc']['titlesets'][number],
): {
	chapterCount: number;
	pageCount: number;
} {
	const chapterCount = titleset.titles.reduce((sum, title) => sum + title.chapters.length, 0);
	return {
		chapterCount,
		pageCount: chapterCount === 0 ? 0 : Math.ceil(chapterCount / 6),
	};
}

export function getMaxAudioTrackCount(
	titleset: SpindleProjectFile['disc']['titlesets'][number],
): number {
	return Math.max(0, ...titleset.titles.map((title) => title.audioMappings.length));
}

export function getMaxSubtitleTrackCount(
	titleset: SpindleProjectFile['disc']['titlesets'][number],
): number {
	return Math.max(0, ...titleset.titles.map((title) => title.subtitleMappings.length));
}

function resolveTitlesetDisplayAspect(
	titleset: SpindleProjectFile['disc']['titlesets'][number],
): AspectMode {
	return (
		titleset.titles.find((title) => title.videoOutputProfile?.aspect)?.videoOutputProfile?.aspect ??
		'four-by-three'
	);
}

function chunkArray<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
}

// ── Generated scene/interaction building blocks ─────────────────────────────
//
// Generators build a menu's scene nodes + interaction graph directly — there
// is no `MenuButton[]` intermediary (that legacy flat-button shape no longer
// exists on `Menu`). `GeneratedButtonSpec` is this module's own lightweight
// working shape for a button before it's lowered into scene/interaction
// nodes by `createGeneratedMenuDocument`.

interface GeneratedButtonSpec {
	id: string;
	label: string;
	x: number;
	y: number;
	width: number;
	height: number;
	action: PlaybackAction;
	navUp: string | null;
	navDown: string | null;
	navLeft: string | null;
	navRight: string | null;
}

function generatedButton(
	label: string,
	bounds: { x: number; y: number; width: number; height: number },
	action: PlaybackAction,
): GeneratedButtonSpec {
	return {
		id: crypto.randomUUID(),
		label,
		...bounds,
		action,
		navUp: null,
		navDown: null,
		navLeft: null,
		navRight: null,
	};
}

type NavDir = 'navUp' | 'navDown' | 'navLeft' | 'navRight';
const OPPOSITE_DIR: Record<NavDir, NavDir> = {
	navUp: 'navDown',
	navDown: 'navUp',
	navLeft: 'navRight',
	navRight: 'navLeft',
};

/** Link two buttons in `dir` *and* its opposite, so every link this module
 * creates is traversable both ways — the only thing that guarantees a
 * generated grid has no button unreachable from the default focus (issue
 * #36): a purely one-directional link graph can strand a button behind a
 * remote press with no way back to it. */
function linkNav(from: GeneratedButtonSpec, dir: NavDir, to: GeneratedButtonSpec): void {
	from[dir] = to.id;
	to[OPPOSITE_DIR[dir]] = from.id;
}

/** Wire simple vertical chain navigation (up/down) through `items` in order,
 * e.g. for the audio/subtitle setup menus' single-column lists. */
function wireVerticalListNav(items: GeneratedButtonSpec[]): void {
	for (let i = 0; i < items.length - 1; i++) {
		linkNav(items[i], 'navDown', items[i + 1]);
	}
}

/** Wire a `columns`-wide left-to-right, top-to-bottom grid's up/down/left/right
 * navigation from its geometry, then anchor an optional trailing utility row
 * (e.g. Previous/Next/Back) onto the grid's last row and chain the utility
 * row's own left/right links. Every link is bidirectional (see `linkNav`),
 * so the whole page — grid plus utility row — stays reachable from any
 * button, in particular the default focus (grid item 0). */
function wireGridNav(
	items: GeneratedButtonSpec[],
	columns: number,
	utilityRow: GeneratedButtonSpec[],
): void {
	const rows = Math.ceil(items.length / columns);
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < columns; col++) {
			const index = row * columns + col;
			if (index >= items.length) continue;
			const item = items[index];

			const rightIndex = row * columns + col + 1;
			if (col + 1 < columns && rightIndex < items.length) {
				linkNav(item, 'navRight', items[rightIndex]);
			}

			const downIndex = (row + 1) * columns + col;
			if (downIndex < items.length) {
				linkNav(item, 'navDown', items[downIndex]);
			}
		}
	}

	if (utilityRow.length === 0) return;

	// Chain the utility row left-to-right by x position.
	const orderedUtility = [...utilityRow].sort((a, b) => a.x - b.x);
	for (let i = 0; i < orderedUtility.length - 1; i++) {
		linkNav(orderedUtility[i], 'navRight', orderedUtility[i + 1]);
	}

	// Anchor the utility row onto the grid's last row via the closest column
	// (by x) so the whole page forms one connected graph.
	const lastRowStart = (rows - 1) * columns;
	const lastRow = items.slice(lastRowStart, lastRowStart + columns);
	const anchor = orderedUtility[0];
	const closestGridItem = lastRow.reduce((closest, candidate) =>
		Math.abs(candidate.x - anchor.x) < Math.abs(closest.x - anchor.x) ? candidate : closest,
	);
	linkNav(closestGridItem, 'navDown', anchor);
}

function toSceneNode(button: GeneratedButtonSpec): Extract<SceneNode, { type: 'button' }> {
	return {
		type: 'button',
		id: button.id,
		label: button.label,
		x: button.x,
		y: button.y,
		width: button.width,
		height: button.height,
		highlightMode: 'static',
		highlightKeyframes: [],
		videoAssetId: null,
		buttonStyle: { ...DEFAULT_BUTTON_STYLE_MAP },
		labelStyle: { ...DEFAULT_TEXT_STYLE },
	};
}

function toFocusNode(button: GeneratedButtonSpec): FocusNode {
	return {
		nodeId: button.id,
		navUp: button.navUp,
		navDown: button.navDown,
		navLeft: button.navLeft,
		navRight: button.navRight,
		action: button.action,
	};
}

function createGeneratedMenuDocument(
	id: string,
	name: string,
	buttons: GeneratedButtonSpec[],
	domain: 'vmgm' | 'titleset',
	designHeight: number,
	displayAspect: AspectMode,
	defaultFocusId: string | null,
): MenuDocument {
	return {
		id,
		name,
		domain,
		scene: {
			designSize: { width: 720, height: designHeight, aspect: displayAspect },
			background: { assetId: null, colour: DEFAULT_MENU_BACKGROUND_COLOUR },
			nodes: buttons.map(toSceneNode),
			guides: [],
		},
		interaction: {
			defaultFocusId,
			nodes: buttons.map(toFocusNode),
			timeoutAction: null,
		},
		timing: {
			introStartSecs: 0,
			introDurationSecs: 0,
			loopStartSecs: 0,
			loopDurationSecs: 0,
			loopCount: 0,
			audioAssetId: null,
		},
		highlightColours: { ...DEFAULT_HIGHLIGHT_COLOURS },
		backgroundMode: 'still',
		themeRef: null,
		generationMeta: {
			generatorId: 'menu-workspace',
			lastGeneratedAt: new Date().toISOString(),
		},
		compilePolicy: createDefaultMenuCompilePolicy(displayAspect),
	};
}

function createGeneratedMenu(document: MenuDocument): Menu {
	return { id: document.id, name: document.name, authoredDocument: document };
}

export function buildChapterMenusForTitleset(
	titleset: SpindleProjectFile['disc']['titlesets'][number],
	standard: VideoStandard,
	returnMenuId: string | null,
): Menu[] {
	const chapterTargets = titleset.titles.flatMap((title) =>
		title.chapters.map((chapter) => ({
			titleId: title.id,
			chapterId: chapter.id,
			label: chapter.name,
		})),
	);
	if (chapterTargets.length === 0) return [];

	const pages = chunkArray(chapterTargets, 6);
	const pageIds = pages.map(() => crypto.randomUUID());
	const displayAspect = resolveTitlesetDisplayAspect(titleset);

	return pages.map((page, pageIndex) => {
		const id = pageIds[pageIndex];

		// 2-column chapter grid — geometry drives both button placement and
		// (via wireGridNav below) directional navigation.
		const gridButtons = page.map((target, buttonIndex) => {
			const col = buttonIndex % 2;
			const row = Math.floor(buttonIndex / 2);
			return generatedButton(
				target.label,
				{ x: 72 + col * 292, y: 132 + row * 92, width: 248, height: 52 },
				{ type: 'playChapter', titleId: target.titleId, chapterId: target.chapterId },
			);
		});

		const utilityButtons: GeneratedButtonSpec[] = [];
		if (pageIndex > 0) {
			utilityButtons.push(
				generatedButton(
					'Previous',
					{ x: 72, y: 420, width: 148, height: 40 },
					{
						type: 'showMenu',
						menuId: pageIds[pageIndex - 1],
					},
				),
			);
		}
		if (returnMenuId) {
			utilityButtons.push(
				generatedButton(
					'Back',
					{ x: 286, y: 420, width: 148, height: 40 },
					{
						type: 'showMenu',
						menuId: returnMenuId,
					},
				),
			);
		}
		if (pageIndex < pages.length - 1) {
			utilityButtons.push(
				generatedButton(
					'Next',
					{ x: 500, y: 420, width: 148, height: 40 },
					{
						type: 'showMenu',
						menuId: pageIds[pageIndex + 1],
					},
				),
			);
		}

		wireGridNav(gridButtons, 2, utilityButtons);

		return createGeneratedMenu(
			createGeneratedMenuDocument(
				id,
				pageIndex === 0 ? 'Chapter Select' : `Chapter Select ${pageIndex + 1}`,
				[...gridButtons, ...utilityButtons],
				'titleset',
				MENU_HEIGHT[standard],
				displayAspect,
				gridButtons[0]?.id ?? utilityButtons[0]?.id ?? null,
			),
		);
	});
}

export function buildAudioSetupMenu(
	titleset: SpindleProjectFile['disc']['titlesets'][number],
	standard: VideoStandard,
	returnMenuId: string | null,
): Menu | null {
	const audioChoices = Array.from(
		titleset.titles.reduce((choices, title) => {
			title.audioMappings.forEach((mapping) => {
				const streamIndex = mapping.orderIndex;
				if (!choices.has(streamIndex)) {
					choices.set(streamIndex, {
						index: streamIndex,
						label: mapping.label || `Audio ${streamIndex + 1}`,
					});
				}
			});
			return choices;
		}, new Map<number, { index: number; label: string }>()),
	)
		.sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
		.map(([, choice]) => choice);
	if (audioChoices.length === 0) return null;

	const id = crypto.randomUUID();
	const buttons: GeneratedButtonSpec[] = audioChoices.map((choice) =>
		generatedButton(
			choice.label,
			{ x: 120, y: 132 + choice.index * 72, width: 480, height: 48 },
			{
				type: 'sequence',
				actions: [
					{ type: 'setAudioStream', streamIndex: choice.index },
					...(returnMenuId
						? ([{ type: 'showMenu', menuId: returnMenuId }] satisfies PlaybackAction[])
						: []),
				],
			},
		),
	);

	if (returnMenuId) {
		buttons.push(
			generatedButton(
				'Back',
				{ x: 286, y: 420, width: 148, height: 40 },
				{
					type: 'showMenu',
					menuId: returnMenuId,
				},
			),
		);
	}

	wireVerticalListNav(buttons);

	return createGeneratedMenu(
		createGeneratedMenuDocument(
			id,
			'Audio Setup',
			buttons,
			'titleset',
			MENU_HEIGHT[standard],
			resolveTitlesetDisplayAspect(titleset),
			buttons[0]?.id ?? null,
		),
	);
}

export function buildSubtitleSetupMenu(
	titleset: SpindleProjectFile['disc']['titlesets'][number],
	standard: VideoStandard,
	returnMenuId: string | null,
): Menu | null {
	const subtitleChoices = Array.from(
		titleset.titles.reduce((choices, title) => {
			title.subtitleMappings.forEach((mapping) => {
				const streamIndex = mapping.orderIndex;
				if (!choices.has(streamIndex)) {
					choices.set(streamIndex, {
						index: streamIndex,
						label: mapping.label || `Subtitle ${streamIndex + 1}`,
					});
				}
			});
			return choices;
		}, new Map<number, { index: number; label: string }>()),
	)
		.sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
		.map(([, choice]) => choice);
	if (subtitleChoices.length === 0) return null;

	const id = crypto.randomUUID();
	const buttons: GeneratedButtonSpec[] = subtitleChoices.map((choice) =>
		generatedButton(
			choice.label,
			{ x: 120, y: 116 + choice.index * 64, width: 480, height: 44 },
			{
				type: 'sequence',
				actions: [
					{ type: 'setSubtitleStream', streamIndex: choice.index },
					...(returnMenuId
						? ([{ type: 'showMenu', menuId: returnMenuId }] satisfies PlaybackAction[])
						: []),
				],
			},
		),
	);

	buttons.push(
		generatedButton(
			'Subtitles Off',
			{ x: 120, y: 116 + buttons.length * 64, width: 480, height: 44 },
			{
				type: 'sequence',
				actions: [
					{ type: 'setSubtitleStream', streamIndex: null },
					...(returnMenuId
						? ([{ type: 'showMenu', menuId: returnMenuId }] satisfies PlaybackAction[])
						: []),
				],
			},
		),
	);

	if (returnMenuId) {
		buttons.push(
			generatedButton(
				'Back',
				{ x: 286, y: 420, width: 148, height: 40 },
				{
					type: 'showMenu',
					menuId: returnMenuId,
				},
			),
		);
	}

	wireVerticalListNav(buttons);

	return createGeneratedMenu(
		createGeneratedMenuDocument(
			id,
			'Subtitle Setup',
			buttons,
			'titleset',
			MENU_HEIGHT[standard],
			resolveTitlesetDisplayAspect(titleset),
			buttons[0]?.id ?? null,
		),
	);
}
