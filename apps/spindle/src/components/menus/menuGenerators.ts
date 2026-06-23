// Pure menu-generation logic: chapter-grid, audio-setup, and subtitle-setup
// menu builders, and the rail's generator-availability stats.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type {
	AspectMode,
	Menu,
	MenuButton,
	PlaybackAction,
	SpindleProjectFile,
	VideoStandard,
} from '../../types/project';
import { DEFAULT_HIGHLIGHT_COLOURS, createDefaultMenuCompilePolicy } from '../../types/project';
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

	return pages.map((page, pageIndex) => {
		const id = pageIds[pageIndex];
		const buttons = page.map((target, buttonIndex) => {
			const col = buttonIndex % 2;
			const row = Math.floor(buttonIndex / 2);
			return {
				id: crypto.randomUUID(),
				label: target.label,
				bounds: {
					x: 72 + col * 292,
					y: 132 + row * 92,
					width: 248,
					height: 52,
				},
				action: {
					type: 'playChapter' as const,
					titleId: target.titleId,
					chapterId: target.chapterId,
				},
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static' as const,
				highlightKeyframes: [],
				videoAssetId: null,
			};
		});

		const pageActions: Menu['buttons'] = [];
		if (pageIndex > 0) {
			pageActions.push({
				id: crypto.randomUUID(),
				label: 'Previous',
				bounds: { x: 72, y: 420, width: 148, height: 40 },
				action: { type: 'showMenu', menuId: pageIds[pageIndex - 1] },
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static',
				highlightKeyframes: [],
				videoAssetId: null,
			});
		}
		if (pageIndex < pages.length - 1) {
			pageActions.push({
				id: crypto.randomUUID(),
				label: 'Next',
				bounds: { x: 500, y: 420, width: 148, height: 40 },
				action: { type: 'showMenu', menuId: pageIds[pageIndex + 1] },
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static',
				highlightKeyframes: [],
				videoAssetId: null,
			});
		}
		if (returnMenuId) {
			pageActions.push({
				id: crypto.randomUUID(),
				label: 'Back',
				bounds: { x: 286, y: 420, width: 148, height: 40 },
				action: { type: 'showMenu', menuId: returnMenuId },
				navUp: null,
				navDown: null,
				navLeft: null,
				navRight: null,
				highlightMode: 'static',
				highlightKeyframes: [],
				videoAssetId: null,
			});
		}

		return createGeneratedMenuFromButtons(
			id,
			pageIndex === 0 ? 'Chapter Select' : `Chapter Select ${pageIndex + 1}`,
			[...buttons, ...pageActions],
			'titleset',
			MENU_HEIGHT[standard],
			resolveTitlesetDisplayAspect(titleset),
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
	const buttons: MenuButton[] = audioChoices.map((choice) => ({
		id: crypto.randomUUID(),
		label: choice.label,
		bounds: { x: 120, y: 132 + choice.index * 72, width: 480, height: 48 },
		action: {
			type: 'sequence' as const,
			actions: [
				{ type: 'setAudioStream' as const, streamIndex: choice.index },
				...(returnMenuId
					? ([{ type: 'showMenu', menuId: returnMenuId }] satisfies PlaybackAction[])
					: []),
			],
		},
		navUp: null,
		navDown: null,
		navLeft: null,
		navRight: null,
		highlightMode: 'static' as const,
		highlightKeyframes: [],
		videoAssetId: null,
	}));

	if (returnMenuId) {
		buttons.push({
			id: crypto.randomUUID(),
			label: 'Back',
			bounds: { x: 286, y: 420, width: 148, height: 40 },
			action: { type: 'showMenu', menuId: returnMenuId },
			navUp: null,
			navDown: null,
			navLeft: null,
			navRight: null,
			highlightMode: 'static',
			highlightKeyframes: [],
			videoAssetId: null,
		});
	}

	return createGeneratedMenuFromButtons(
		id,
		'Audio Setup',
		buttons,
		'titleset',
		MENU_HEIGHT[standard],
		resolveTitlesetDisplayAspect(titleset),
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
	const buttons: MenuButton[] = subtitleChoices.map((choice) => ({
		id: crypto.randomUUID(),
		label: choice.label,
		bounds: { x: 120, y: 116 + choice.index * 64, width: 480, height: 44 },
		action: {
			type: 'sequence' as const,
			actions: [
				{ type: 'setSubtitleStream' as const, streamIndex: choice.index },
				...(returnMenuId
					? ([{ type: 'showMenu', menuId: returnMenuId }] satisfies PlaybackAction[])
					: []),
			],
		},
		navUp: null,
		navDown: null,
		navLeft: null,
		navRight: null,
		highlightMode: 'static' as const,
		highlightKeyframes: [],
		videoAssetId: null,
	}));

	buttons.push({
		id: crypto.randomUUID(),
		label: 'Subtitles Off',
		bounds: { x: 120, y: 116 + buttons.length * 64, width: 480, height: 44 },
		action: {
			type: 'sequence' as const,
			actions: [
				{ type: 'setSubtitleStream' as const, streamIndex: null },
				...(returnMenuId
					? ([{ type: 'showMenu', menuId: returnMenuId }] satisfies PlaybackAction[])
					: []),
			],
		},
		navUp: null,
		navDown: null,
		navLeft: null,
		navRight: null,
		highlightMode: 'static',
		highlightKeyframes: [],
		videoAssetId: null,
	});

	if (returnMenuId) {
		buttons.push({
			id: crypto.randomUUID(),
			label: 'Back',
			bounds: { x: 286, y: 420, width: 148, height: 40 },
			action: { type: 'showMenu', menuId: returnMenuId },
			navUp: null,
			navDown: null,
			navLeft: null,
			navRight: null,
			highlightMode: 'static',
			highlightKeyframes: [],
			videoAssetId: null,
		});
	}

	return createGeneratedMenuFromButtons(
		id,
		'Subtitle Setup',
		buttons,
		'titleset',
		MENU_HEIGHT[standard],
		resolveTitlesetDisplayAspect(titleset),
	);
}

export function createGeneratedMenuFromButtons(
	id: string,
	name: string,
	buttons: Menu['buttons'],
	domain: 'vmgm' | 'titleset',
	designHeight: number,
	displayAspect: AspectMode,
): Menu {
	return {
		id,
		name,
		backgroundAssetId: null,
		buttons,
		defaultButtonId: buttons[0]?.id ?? null,
		highlightColours: { ...DEFAULT_HIGHLIGHT_COLOURS },
		backgroundMode: 'still',
		motionDurationSecs: null,
		motionAudioAssetId: null,
		motionLoopCount: 0,
		timeoutAction: null,
		authoredDocument: {
			id,
			name,
			domain,
			scene: {
				designSize: { width: 720, height: designHeight },
				background: { assetId: null, colour: '#0f0e1a' },
				nodes: buttons.map((button) => ({
					type: 'button' as const,
					id: button.id,
					label: button.label,
					x: button.bounds.x,
					y: button.bounds.y,
					width: button.bounds.width,
					height: button.bounds.height,
					highlightMode: button.highlightMode,
					highlightKeyframes: button.highlightKeyframes,
					videoAssetId: button.videoAssetId,
					buttonStyle: { ...DEFAULT_BUTTON_STYLE_MAP },
					labelStyle: { ...DEFAULT_TEXT_STYLE },
				})),
				guides: [],
			},
			interaction: {
				defaultFocusId: buttons[0]?.id ?? null,
				nodes: buttons.map((button) => ({
					nodeId: button.id,
					navUp: button.navUp,
					navDown: button.navDown,
					navLeft: button.navLeft,
					navRight: button.navRight,
					action: button.action,
				})),
				timeoutAction: null,
			},
			timing: {
				introStartSecs: 0,
				introDurationSecs: 0,
				loopStartSecs: 0,
				loopDurationSecs: 0,
				loopCount: 0,
			},
			highlightColours: { ...DEFAULT_HIGHLIGHT_COLOURS },
			backgroundMode: 'still',
			themeRef: null,
			generationMeta: {
				generatorId: 'menu-workspace',
				lastGeneratedAt: new Date().toISOString(),
			},
			compilePolicy: createDefaultMenuCompilePolicy(displayAspect),
		},
	};
}
