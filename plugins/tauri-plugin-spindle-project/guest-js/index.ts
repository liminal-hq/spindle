import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

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
	| { type: 'setAudioStream'; streamIndex: number }
	| { type: 'setSubtitleStream'; streamIndex: number | null }
	| { type: 'sequence'; actions: PlaybackAction[] }
	| { type: 'stop' }
	| { type: 'return' }
	| { type: 'playNextInTitleset' }
	| { type: 'playAllInTitleset' };

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

/** A chapter point detected in a source media file during inspection. */
export interface SourceChapter {
	startSecs: number;
	endSecs: number;
	title: string | null;
}

// ── Menus ───────────────────────────────────────────────────────────────────

export type MenuEditorMode = 'editor' | 'map' | 'design' | 'bind' | 'remote' | 'compile';
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
	/** The new authored scene document that replaces the flat button model. */
	authoredDocument?: MenuDocument | null;
}

/** A structured menu document that separates authored intent from target compilation. */
export interface MenuDocument {
	id: string;
	name: string;
	domain: MenuDomain;
	scene: MenuScene;
	interaction: MenuInteractionGraph;
	timing: MenuTiming;
	highlightColours: MenuHighlightColours;
	backgroundMode: BackgroundMode;
	themeRef: string | null;
	generationMeta: MenuGenerationMeta | null;
	compilePolicy: MenuCompilePolicy;
}

/** Menu domain indicates whether it belongs to the Video Manager (VMGM) or a Titleset. */
export type MenuDomain = 'vmgm' | 'titleset';

/** The visual scene graph for the menu. */
export interface MenuScene {
	designSize: MenuSize;
	background: SceneBackground;
	nodes: SceneNode[];
	guides: SceneGuide[];
}

export interface MenuSize {
	width: number;
	height: number;
}

export interface SceneBackground {
	assetId: string | null;
	colour: string | null;
}

// ── Button & Text Style ─────────────────────────────────────────────────────

export type ButtonShadowType = 'none' | 'box-shadow' | 'outer-glow' | 'inner-glow';

/** Per-state visual appearance for a button node (authored layer only). */
export interface ButtonStateStyle {
	bgFill: string;
	borderColour: string;
	borderWidth: number;
	borderRadius: number;
	paddingH: number;
	paddingV: number;
	shadowType: ButtonShadowType;
	shadowColour: string;
	shadowBlur: number;
	shadowSpread: number;
}

/** The three interactive states for a button. */
export interface ButtonStyleMap {
	normal: ButtonStateStyle;
	focus: ButtonStateStyle;
	activate: ButtonStateStyle;
}

/** Typography style shared by button labels and standalone text nodes. */
export interface TextStyle {
	fontFamily: string;
	fontSize: number;
	fontWeight: 'normal' | 'bold';
	fontItalic: boolean;
	textDecoration: 'none' | 'underline';
	textAlign: 'left' | 'center' | 'right';
	colour: string;
	lineHeight: number;
	letterSpacing: number;
}

/** A node within the authored menu scene graph. */
export type SceneNode =
	| { type: 'group'; id: string; name: string; children: SceneNode[] }
	| {
			type: 'text';
			id: string;
			content: string;
			x: number;
			y: number;
			width: number;
			height: number;
			fontSize?: number;
			colour?: string;
			fontFamily?: string;
			fontWeight?: 'normal' | 'bold';
			fontItalic?: boolean;
			textDecoration?: 'none' | 'underline';
			textAlign?: 'left' | 'center' | 'right';
			lineHeight?: number;
			letterSpacing?: number;
	  }
	| {
			type: 'image';
			id: string;
			assetId: string;
			x: number;
			y: number;
			width: number;
			height: number;
	  }
	| {
			type: 'shape';
			id: string;
			x: number;
			y: number;
			width: number;
			height: number;
			fill?: string;
	  }
	| { type: 'video'; id: string; assetId: string; x: number; y: number }
	| {
			type: 'button';
			id: string;
			label: string;
			x: number;
			y: number;
			width: number;
			height: number;
			highlightMode?: HighlightMode;
			highlightKeyframes?: HighlightKeyframe[];
			videoAssetId?: string | null;
			/** Per-state visual appearance (authored layer). */
			buttonStyle?: ButtonStyleMap;
			/** Label typography. */
			labelStyle?: TextStyle;
	  }
	| { type: 'componentInstance'; id: string; componentId: string }
	| { type: 'generatedCollection'; id: string; source: string };

export interface SceneGuide {
	orientation: 'horizontal' | 'vertical';
	position: number;
}

/** The interaction graph defining remote-driven behaviour. */
export interface MenuInteractionGraph {
	defaultFocusId: string | null;
	nodes: FocusNode[];
	timeoutAction: PlaybackAction | null;
}

export interface FocusNode {
	nodeId: string;
	navUp: string | null;
	navDown: string | null;
	navLeft: string | null;
	navRight: string | null;
	action: PlaybackAction | null;
}

/** Timing and motion rules for the menu. */
export interface MenuTiming {
	introStartSecs: number;
	introDurationSecs: number;
	loopStartSecs: number;
	loopDurationSecs: number;
	loopCount: number; // 0 = infinite
}

/** Metadata for generated menus. */
export interface MenuGenerationMeta {
	generatorId: string;
	lastGeneratedAt: string;
}

/** Format-specific compilation rules and safe-area policies. */
export interface MenuCompilePolicy {
	displayAspect: AspectMode;
	safeAreaMode: 'action-safe' | 'title-safe' | 'none';
	paletteStrategy: 'auto' | 'manual';
}

/** DVD subpicture highlight palette for button overlays. */
export interface MenuHighlightColours {
	/** CSS hex colour shown when a button is selected/focused. */
	selectColour: string;
	/** Opacity of the select highlight (0.0-1.0). */
	selectOpacity: number;
	/** CSS hex colour shown briefly when a button is activated/pressed. */
	activateColour: string;
	/** Opacity of the activate highlight (0.0-1.0). */
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
	/** Detailed per-stream compatibility breakdown. */
	compatibilityDetail: CompatibilityDetail | null;
	warnings: AssetWarning[];
	thumbnailPath: string | null;
	thumbnailError: string | null;
	/** Chapter markers detected in the source media file. */
	sourceChapters: SourceChapter[];
	/** Container-level title tag from source media metadata (e.g. MKV/MP4 title). */
	formatTitle: string | null;
}

export interface AssetWarning {
	code: string;
	message: string;
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
	title: string | null;
	/** OETF transfer characteristics, e.g. "smpte2084" (HDR10), "arib-std-b67" (HLG). */
	colorTransfer: string | null;
	/** Colour primaries, e.g. "bt2020" (HDR), "bt709" (SDR). */
	colorPrimaries: string | null;
	/** Dolby Vision profile when ffprobe exposes DOVI side data. */
	dolbyVisionProfile: number | null;
}

export interface AudioStreamInfo {
	index: number;
	codec: string;
	channels: number;
	sampleRate: number;
	language: string | null;
	bitrateBps: number | null;
	title: string | null;
}

export interface SubtitleStreamInfo {
	index: number;
	codec: string;
	language: string | null;
	subtitleType: SubtitleType;
	title: string | null;
}

// ── Compatibility Detail ────────────────────────────────────────────────

/** Per-stream compatibility breakdown explaining why the overall assessment was given. */
export interface CompatibilityDetail {
	overall: CompatibilityAssessment;
	video: VideoCompatibility | null;
	audioStreams: AudioStreamCompatibility[];
	container: ContainerCompatibility;
}

export interface VideoCompatibility {
	codec: PropertyCheck;
	resolution: PropertyCheck;
	frameRate: PropertyCheck;
}

export interface AudioStreamCompatibility {
	streamIndex: number;
	codec: PropertyCheck;
}

export interface ContainerCompatibility {
	format: PropertyCheck;
}

/** A single property compatibility check result. */
export interface PropertyCheck {
	value: string;
	dvdRequires: string;
	action: string;
	compatible: boolean;
}

// ── Disc Capacity ────────────────────────────────────────────────────────────

/** Per-title average video bitrate after distributing the disc-wide budget
 * according to `BuildSettings.allocationStrategy`. */
export interface TitleBitrateAllocation {
	titleId: string;
	bitsPerSecond: number;
}

/** Disc-capacity usage and the per-title bitrate budget the build pipeline
 * actually encodes at — the single source of truth shared by the
 * Overview/Planner UI and the build pipeline. */
export interface CapacityEstimate {
	capacityBytes: number;
	totalDurationSecs: number;
	estimatedMenuBytes: number;
	safetyMarginBytes: number;
	estimatedOverheadBytes: number;
	usableBytes: number;
	availableBitsPerSecond: number;
	isCapacityConstrained: boolean;
	estimatedOutputBytes: number;
	usagePct: number;
	isOverCapacity: boolean;
	titleBitrates: TitleBitrateAllocation[];
}

// ── Build Settings ──────────────────────────────────────────────────────────

export interface BuildSettings {
	outputDirectory: string | null;
	generateIso: boolean;
	safetyMarginBytes: number;
	allocationStrategy: AllocationStrategy;
	subtitleRenderMode?: 'one-pass' | 'two-pass';
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface ValidationIssue {
	severity: IssueSeverity;
	code: string;
	message: string;
	context: string | null;
	/** Entity type for navigation: "title", "menu", "titleset", "disc", "build". */
	entityType?: string | null;
	/** Human-readable name of the affected entity. */
	entityName?: string | null;
	/** Actionable guidance on how to resolve the issue. */
	suggestedFix?: string | null;
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
			/** Source asset duration in seconds, used for step-progress estimation. */
			durationSecs: number | null;
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
			type: 'linkTitle';
			titleId: string;
			titleName: string;
			sourcePath: string;
			linkPath: string;
			label: string;
	  }
	| {
			type: 'extractSubtitles';
			titleId: string;
			titleName: string;
			sourcePath: string;
			outputPath: string;
			command: string[];
			label: string;
	  }
	| {
			type: 'renderTextSubtitles';
			titleId: string;
			titleName: string;
			sourcePath: string;
			sourceStreamIndex: number;
			inputPath: string;
			outputPath: string;
			subtitlePath: string;
			prepareCommand: string[];
			spumuxXml: string;
			command: string[];
			label: string;
			renderMode: 'one-pass' | 'two-pass';
			fontFamily: string;
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
	/** Short name for the active sub-operation (e.g. "FFmpeg transcode"). */
	stepLabel?: string | null;
	/** Estimated completion of the current sub-operation, clamped to 0-100. */
	stepPercent?: number | null;
	/** Freeform detail such as media timestamp or encoding phase. */
	stepDetail?: string | null;
	/** Lifecycle state of the sub-operation. */
	stepStatus?: 'starting' | 'running' | 'complete' | 'failed' | null;
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

// ── Font Enumeration ────────────────────────────────────────────────────────

/** Where a font family came from in the Skia renderer's resolution priority chain. */
export type FontSource = 'project-asset' | 'app-sidecar' | 'system';

/** A font family available to the Skia renderer, with its source tier. */
export interface FontEntry {
	/** Display name shown in the UI (e.g. "DejaVu Sans"). */
	family: string;
	/** Where this font came from. */
	source: FontSource;
}

// ── Command Payloads ────────────────────────────────────────────────────────

export interface CreateProjectRequest {
	name: string;
	standard: VideoStandard;
	capacityTarget: CapacityTarget;
}

// ── Build Progress Event ────────────────────────────────────────────────────

/** Event name emitted on build progress (see `execute_build`). */
export const BUILD_PROGRESS_EVENT = 'spindle://build-progress';

/** Subscribe to build-progress notifications for the current window. */
export async function onBuildProgress(
	handler: (progress: BuildProgress) => void,
): Promise<UnlistenFn> {
	return await listen<BuildProgress>(BUILD_PROGRESS_EVENT, (event) => handler(event.payload));
}

// ── Commands ─────────────────────────────────────────────────────────────────

/** Create a new default project with the given settings. */
export async function createProject(payload: CreateProjectRequest): Promise<SpindleProjectFile> {
	return await invoke('plugin:spindle-project|create_project', { payload });
}

/** Parse and validate a project file from its JSON content string. */
export async function parseProject(json: string): Promise<SpindleProjectFile> {
	return await invoke('plugin:spindle-project|parse_project', { json });
}

/** Serialise a project to its JSON string for saving via tauri-plugin-fs. */
export async function serialiseProject(project: SpindleProjectFile): Promise<string> {
	return await invoke('plugin:spindle-project|serialise_project', { project });
}

/** Validate a project and return any issues found. */
export async function validateProject(project: SpindleProjectFile): Promise<ValidationIssue[]> {
	return await invoke('plugin:spindle-project|validate_project', { project });
}

/** Estimate disc-capacity usage and the per-title bitrate budget the build
 * pipeline will actually encode at. */
export async function estimateDiscCapacity(
	project: SpindleProjectFile,
): Promise<CapacityEstimate> {
	return await invoke('plugin:spindle-project|estimate_disc_capacity', { project });
}

/** Inspect a media file and return its metadata as an Asset. */
export async function inspectAsset(path: string): Promise<Asset> {
	return await invoke('plugin:spindle-project|inspect_asset', { path });
}

/** Extract a thumbnail from a video asset at a given timestamp. */
export async function extractVideoThumbnail(
	sourcePath: string,
	outputPath: string,
	timestampSecs: number,
): Promise<void> {
	await invoke('plugin:spindle-project|extract_video_thumbnail', {
		sourcePath,
		outputPath,
		timestampSecs,
	});
}

/** Extract a scaled-down JPEG thumbnail from a still image asset. */
export async function extractImageThumbnail(sourcePath: string, outputPath: string): Promise<void> {
	await invoke('plugin:spindle-project|extract_image_thumbnail', { sourcePath, outputPath });
}

/** Options shared by build-plan generation and build execution. */
export interface BuildOptions {
	skipSidecar: boolean;
	skipUnsupportedStreams: boolean;
	quantizeOverlayPalette: boolean;
}

/** Generate a build plan without executing it (dry-run / preview). */
export async function generateBuildPlan(
	project: SpindleProjectFile,
	outputDirectory: string,
	options: BuildOptions,
): Promise<BuildPlan> {
	return await invoke('plugin:spindle-project|generate_build_plan', {
		project,
		outputDirectory,
		skipSidecar: options.skipSidecar,
		skipUnsupportedStreams: options.skipUnsupportedStreams,
		quantizeOverlayPalette: options.quantizeOverlayPalette,
	});
}

/** Execute a build plan, emitting progress events (see `onBuildProgress`). */
export async function executeBuild(
	project: SpindleProjectFile,
	outputDirectory: string,
	options: BuildOptions,
): Promise<BuildResult> {
	return await invoke('plugin:spindle-project|execute_build', {
		project,
		outputDirectory,
		skipSidecar: options.skipSidecar,
		skipUnsupportedStreams: options.skipUnsupportedStreams,
		quantizeOverlayPalette: options.quantizeOverlayPalette,
	});
}

/** Cancel a running build. */
export async function cancelBuild(): Promise<void> {
	await invoke('plugin:spindle-project|cancel_build');
}

/** Auto-generate directional navigation for a menu's buttons based on geometry. */
export async function autoGenerateMenuNav(menu: Menu): Promise<Menu> {
	return await invoke('plugin:spindle-project|auto_generate_menu_nav', { menu });
}

/** Check which external tools are available on the system PATH. */
export async function checkToolchain(skipSidecar: boolean): Promise<ToolchainStatus[]> {
	return await invoke('plugin:spindle-project|check_toolchain', { skipSidecar });
}

/** Export a DAR-corrected render preview PNG for the given menu. */
export async function exportMenuRenderPreview(
	project: SpindleProjectFile,
	menuId: string,
	outputPath: string,
): Promise<void> {
	await invoke('plugin:spindle-project|export_menu_render_preview', {
		project,
		menuId,
		outputPath,
	});
}

/** List all font families available to the Skia renderer for the given project. */
export async function listAvailableFonts(project: SpindleProjectFile): Promise<FontEntry[]> {
	return await invoke('plugin:spindle-project|list_available_fonts', { project });
}

/** Return the application cache directory for storing thumbnails and other transient data. */
export async function getCacheDir(): Promise<string> {
	return await invoke('plugin:spindle-project|get_cache_dir');
}

/** Export a diagnostics bundle as a JSON string for troubleshooting. */
export async function exportDiagnostics(
	project: SpindleProjectFile | null,
	buildLog: string[],
	validationIssues: ValidationIssue[],
	options: BuildOptions,
): Promise<string> {
	return await invoke('plugin:spindle-project|export_diagnostics', {
		project,
		buildLog,
		validationIssues,
		skipSidecar: options.skipSidecar,
		skipUnsupportedStreams: options.skipUnsupportedStreams,
		quantizeOverlayPalette: options.quantizeOverlayPalette,
	});
}
