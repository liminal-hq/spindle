// App-specific helpers around the project domain model owned by
// tauri-plugin-spindle-project-api.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

// The domain model types (SpindleProjectFile, Menu, Asset, BuildPlan, etc.)
// are owned by the plugin's guest-js package, since they mirror the Rust
// structs the plugin's commands actually serialise. Re-exporting them here
// keeps existing imports from '../types/project' working without every
// caller needing to know the model moved.
export type {
	DiscFamily,
	VideoStandard,
	CapacityTarget,
	CopyMode,
	AudioOutputTarget,
	AllocationStrategy,
	CompatibilityAssessment,
	SubtitleType,
	IssueSeverity,
	VideoRaster,
	AspectMode,
	PlaybackAction,
	SpindleProjectFile,
	ProjectMeta,
	Disc,
	Titleset,
	Title,
	VideoTrackMapping,
	AudioTrackMapping,
	SubtitleTrackMapping,
	VideoOutputProfile,
	ChapterPoint,
	SourceChapter,
	MenuEditorMode,
	BackgroundMode,
	HighlightMode,
	Menu,
	MenuDocument,
	MenuDomain,
	MenuScene,
	MenuSize,
	SceneBackground,
	ButtonShadowType,
	ButtonStateStyle,
	ButtonStyleMap,
	TextStyle,
	SceneNode,
	SceneGuide,
	MenuInteractionGraph,
	FocusNode,
	MenuTiming,
	MenuGenerationMeta,
	MenuCompilePolicy,
	MenuHighlightColours,
	MenuButton,
	HighlightKeyframe,
	ButtonBounds,
	Asset,
	AssetWarning,
	VideoStreamInfo,
	AudioStreamInfo,
	SubtitleStreamInfo,
	CompatibilityDetail,
	VideoCompatibility,
	AudioStreamCompatibility,
	ContainerCompatibility,
	PropertyCheck,
	BuildSettings,
	ValidationIssue,
	BuildPlan,
	BuildSummary,
	BuildJob,
	BuildProgress,
	BuildResult,
	ToolchainStatus,
	FontSource,
	FontEntry,
	CreateProjectRequest,
} from 'tauri-plugin-spindle-project-api';

import type {
	AspectMode,
	CapacityTarget,
	MenuCompilePolicy,
	MenuDomain,
	MenuHighlightColours,
	SpindleProjectFile,
} from 'tauri-plugin-spindle-project-api';

// ── Helpers ─────────────────────────────────────────────────────────────────

export const DEFAULT_HIGHLIGHT_COLOURS: MenuHighlightColours = {
	selectColour: '#ffaa40',
	selectOpacity: 0.6,
	activateColour: '#ffffff',
	activateOpacity: 0.8,
};

export const CAPACITY_LABELS: Record<CapacityTarget, string> = {
	DVD5: 'DVD-5 (4.7 GB)',
	DVD9: 'DVD-9 (8.5 GB)',
};

export const CAPACITY_BYTES: Record<CapacityTarget, number> = {
	DVD5: 4_700_000_000,
	DVD9: 8_500_000_000,
};

export function createDefaultMenuCompilePolicy(
	displayAspect: AspectMode = 'four-by-three',
): MenuCompilePolicy {
	return {
		displayAspect,
		safeAreaMode: 'title-safe',
		paletteStrategy: 'auto',
	};
}

export function inferDefaultMenuDisplayAspect(
	project: SpindleProjectFile,
	options: {
		menuId?: string;
		titlesetId?: string | null;
		domain?: MenuDomain;
	} = {},
): AspectMode {
	const lookupTitleset =
		(options.titlesetId
			? project.disc.titlesets.find((titleset) => titleset.id === options.titlesetId)
			: undefined) ??
		(options.menuId
			? project.disc.titlesets.find((titleset) =>
					titleset.menus.some((menu) => menu.id === options.menuId),
				)
			: undefined);

	const scopedAspect = lookupTitleset?.titles.find((title) => title.videoOutputProfile?.aspect)
		?.videoOutputProfile?.aspect;
	if (scopedAspect) return scopedAspect;

	if (options.domain === 'vmgm') {
		return (
			project.disc.titlesets
				.flatMap((titleset) => titleset.titles)
				.find((title) => title.videoOutputProfile?.aspect)?.videoOutputProfile?.aspect ??
			'four-by-three'
		);
	}

	return (
		project.disc.titlesets
			.flatMap((titleset) => titleset.titles)
			.find((title) => title.videoOutputProfile?.aspect)?.videoOutputProfile?.aspect ??
		'four-by-three'
	);
}

export function createDefaultProject(name = 'Untitled Project'): SpindleProjectFile {
	const now = new Date().toISOString();
	return {
		schemaVersion: 1,
		project: {
			id: crypto.randomUUID(),
			name,
			createdAt: now,
			modifiedAt: now,
		},
		disc: {
			family: 'dvd-video',
			standard: 'NTSC',
			capacityTarget: 'DVD5',
			firstPlayAction: null,
			titlesets: [
				{
					id: crypto.randomUUID(),
					name: 'Default',
					titles: [],
					menus: [],
				},
			],
			globalMenus: [],
		},
		assets: [],
		buildSettings: {
			outputDirectory: null,
			generateIso: false,
			safetyMarginBytes: 50_000_000,
			allocationStrategy: 'duration-weighted',
		},
	};
}
