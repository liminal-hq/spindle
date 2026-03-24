// TypeScript types mirroring the Rust project schema from tauri-plugin-spindle-project.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

// ── Enums ───────────────────────────────────────────────────────────────────

export type DiscFamily = 'dvd-video';
export type VideoStandard = 'NTSC' | 'PAL';
export type CapacityTarget = 'DVD5' | 'DVD9';
export type CopyMode = 'copy' | 're-encode';
export type AudioOutputTarget = 'AC3' | 'LPCM' | 'MP2' | 'DTS';
export type AllocationStrategy = 'equal-share' | 'duration-weighted' | 'priority-weighted';
export type CompatibilityAssessment =
	| 'remux-compatible'
	| 'transform-compatible'
	| 're-encode-required'
	| 'unsupported';
export type SubtitleType = 'bitmap' | 'text' | 'unknown';
export type IssueSeverity = 'info' | 'warning' | 'error';

export type VideoRaster = 'full-d1' | '704-wide' | 'half-d1' | 'quarter-d1';
export type AspectMode = 'four-by-three' | 'sixteen-by-nine';

// ── Playback Action ─────────────────────────────────────────────────────────

export type PlaybackAction =
	| { type: 'playTitle'; titleId: string }
	| { type: 'playChapter'; titleId: string; chapterId: string }
	| { type: 'showMenu'; menuId: string }
	| { type: 'stop' };

// ── Top-Level Project ───────────────────────────────────────────────────────

export interface SpindleProjectFile {
	schemaVersion: number;
	project: ProjectMeta;
	disc: Disc;
	assets: Asset[];
	buildSettings: BuildSettings;
}

export interface ProjectMeta {
	id: string;
	name: string;
	createdAt: string;
	modifiedAt: string;
}

// ── Disc ────────────────────────────────────────────────────────────────────

export interface Disc {
	family: DiscFamily;
	standard: VideoStandard;
	capacityTarget: CapacityTarget;
	firstPlayAction: PlaybackAction | null;
	titlesets: Titleset[];
	globalMenus: Menu[];
}

export interface Titleset {
	id: string;
	name: string;
	titles: Title[];
	menus: Menu[];
}

// ── Title ───────────────────────────────────────────────────────────────────

export interface Title {
	id: string;
	name: string;
	sourceAssetId: string | null;
	videoMapping: VideoTrackMapping | null;
	videoOutputProfile: VideoOutputProfile | null;
	audioMappings: AudioTrackMapping[];
	subtitleMappings: SubtitleTrackMapping[];
	chapters: ChapterPoint[];
	endAction: PlaybackAction | null;
	orderIndex: number;
}

// ── Track Mappings ──────────────────────────────────────────────────────────

export interface VideoTrackMapping {
	sourceStreamIndex: number;
	copyMode: CopyMode;
}

export interface AudioTrackMapping {
	id: string;
	sourceStreamIndex: number;
	outputTarget: AudioOutputTarget;
	copyMode: CopyMode;
	label: string;
	language: string;
	orderIndex: number;
	isDefault: boolean;
}

export interface SubtitleTrackMapping {
	id: string;
	sourceStreamIndex: number;
	label: string;
	language: string;
	orderIndex: number;
	isDefault: boolean;
	isForced: boolean;
}

// ── Output Profiles ─────────────────────────────────────────────────────────

export interface VideoOutputProfile {
	raster: VideoRaster;
	aspect: AspectMode;
}

// ── Chapters ────────────────────────────────────────────────────────────────

export interface ChapterPoint {
	id: string;
	name: string;
	timestampSecs: number;
	orderIndex: number;
}

// ── Menus ───────────────────────────────────────────────────────────────────

export type BackgroundMode = 'still' | 'motion';
export type HighlightMode = 'static' | 'animated';

export interface Menu {
	id: string;
	name: string;
	backgroundAssetId: string | null;
	buttons: MenuButton[];
	defaultButtonId: string | null;
	/** DVD subpicture highlight palette colours. */
	highlightColours: MenuHighlightColours;
	/** Whether the background is a still frame or looping video (Stage 2). */
	backgroundMode: BackgroundMode;
	/** Duration of the motion loop in seconds (motion menus only). */
	motionDurationSecs: number | null;
	/** Optional audio asset for motion menu background music. */
	motionAudioAssetId: string | null;
	/** Number of times to loop before timeout action (0 = infinite, motion only). */
	motionLoopCount: number;
	/** Action when a motion menu times out after looping. */
	timeoutAction: PlaybackAction | null;
}

/** DVD subpicture highlight palette for button overlays. */
export interface MenuHighlightColours {
	/** CSS hex colour shown when a button is selected/focused. */
	selectColour: string;
	/** Opacity of the select highlight (0.0–1.0). */
	selectOpacity: number;
	/** CSS hex colour shown briefly when a button is activated/pressed. */
	activateColour: string;
	/** Opacity of the activate highlight (0.0–1.0). */
	activateOpacity: number;
}

export interface MenuButton {
	id: string;
	label: string;
	bounds: ButtonBounds;
	action: PlaybackAction | null;
	navUp: string | null;
	navDown: string | null;
	navLeft: string | null;
	navRight: string | null;
	/** Whether button highlights are static or animated (Stage 2). */
	highlightMode: HighlightMode;
	/** Animated highlight keyframes (Stage 2). */
	highlightKeyframes: HighlightKeyframe[];
	/** Video asset composited into the menu background at this button's bounds (Stage 2). */
	videoAssetId: string | null;
}

export interface HighlightKeyframe {
	timestampSecs: number;
	selectColour: string | null;
	selectOpacity: number | null;
	activateColour: string | null;
	activateOpacity: number | null;
}

export interface ButtonBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

// ── Assets ──────────────────────────────────────────────────────────────────

export interface Asset {
	id: string;
	fileName: string;
	sourcePath: string;
	fileSizeBytes: number | null;
	durationSecs: number | null;
	containerFormat: string | null;
	videoStreams: VideoStreamInfo[];
	audioStreams: AudioStreamInfo[];
	subtitleStreams: SubtitleStreamInfo[];
	compatibility: CompatibilityAssessment | null;
	fingerprint: string | null;
}

export interface VideoStreamInfo {
	index: number;
	codec: string;
	width: number;
	height: number;
	frameRate: number | null;
	aspectRatio: string | null;
	scanType: string | null;
	bitrateBps: number | null;
}

export interface AudioStreamInfo {
	index: number;
	codec: string;
	channels: number;
	sampleRate: number;
	language: string | null;
	bitrateBps: number | null;
}

export interface SubtitleStreamInfo {
	index: number;
	codec: string;
	language: string | null;
	subtitleType: SubtitleType;
}

// ── Build Settings ──────────────────────────────────────────────────────────

export interface BuildSettings {
	outputDirectory: string | null;
	generateIso: boolean;
	safetyMarginBytes: number;
	allocationStrategy: AllocationStrategy;
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface ValidationIssue {
	severity: IssueSeverity;
	code: string;
	message: string;
	context: string | null;
}

// ── Build Pipeline ──────────────────────────────────────────────────────────

export interface BuildPlan {
	jobs: BuildJob[];
	outputDirectory: string;
	workingDirectory: string;
	dvdauthorXml: string;
	summary: BuildSummary;
}

export interface BuildSummary {
	totalJobs: number;
	transcodeJobs: number;
	titlesCount: number;
	menusCount: number;
	generateIso: boolean;
	estimatedCommands: string[];
}

export type BuildJob =
	| { type: 'prepareWorkspace'; directories: string[] }
	| {
			type: 'transcodeTitle';
			titleId: string;
			titleName: string;
			sourcePath: string;
			outputPath: string;
			command: string[];
			label: string;
	  }
	| {
			type: 'renderMenu';
			menuId: string;
			menuName: string;
			outputPath: string;
			command: string[];
			label: string;
	  }
	| {
			type: 'composeMenuHighlights';
			menuId: string;
			menuName: string;
			inputPath: string;
			outputPath: string;
			spumuxXml: string;
			command: string[];
			label: string;
	  }
	| {
			type: 'authorDvd';
			xmlPath: string;
			outputPath: string;
			command: string[];
			label: string;
	  }
	| {
			type: 'createIso';
			sourcePath: string;
			outputPath: string;
			command: string[];
			label: string;
	  };

export interface BuildProgress {
	jobIndex: number;
	totalJobs: number;
	currentLabel: string;
	status: 'starting' | 'running' | 'complete' | 'failed';
	output: string | null;
}

export interface BuildResult {
	success: boolean;
	outputDirectory: string;
	isoPath: string | null;
	logLines: string[];
	failedJobIndex: number | null;
	errorMessage: string | null;
}

export interface ToolchainStatus {
	name: string;
	purpose: string;
	available: boolean;
	version: string | null;
}

// ── Command Payloads ────────────────────────────────────────────────────────

export interface CreateProjectRequest {
	name: string;
	standard: VideoStandard;
	capacityTarget: CapacityTarget;
}

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
