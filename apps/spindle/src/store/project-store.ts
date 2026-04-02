// Zustand store for project state management.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { open, save, confirm } from '@tauri-apps/plugin-dialog';
import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs';
import { useAppSettingsStore } from './app-settings-store';
import type {
	SpindleProjectFile,
	CreateProjectRequest,
	ValidationIssue,
	Asset,
	BuildPlan,
	BuildResult,
	BuildProgress,
	Menu,
	ToolchainStatus,
} from '../types/project';

export type BuildStatus = 'idle' | 'planning' | 'building' | 'complete' | 'error';

export interface ProjectState {
	/** The current project data, or null if no project is loaded. */
	project: SpindleProjectFile | null;
	/** File path where the project is saved, or null for unsaved projects. */
	filePath: string | null;
	/** Whether the project has unsaved changes. */
	isDirty: boolean;
	/** Validation issues from the last check. */
	validationIssues: ValidationIssue[];
	/** Whether a project operation is in progress. */
	isLoading: boolean;
	/** Current build plan (from dry-run preview). */
	buildPlan: BuildPlan | null;
	/** Current build status. */
	buildStatus: BuildStatus;
	/** Build result from the last build attempt. */
	buildResult: BuildResult | null;
	/** Build progress events. */
	buildProgress: BuildProgress | null;
	/** Build log lines. */
	buildLog: string[];
	/** Detected toolchain status. */
	toolchain: ToolchainStatus[];

	// Actions
	createProject: (req: CreateProjectRequest) => Promise<void>;
	openProject: () => Promise<void>;
	saveProject: () => Promise<void>;
	saveProjectAs: () => Promise<void>;
	closeProject: () => void;
	updateProject: (updater: (project: SpindleProjectFile) => SpindleProjectFile) => void;
	validateProject: () => Promise<void>;
	importAssets: () => Promise<void>;
	removeAsset: (assetId: string) => void;
	relinkAsset: (assetId: string) => Promise<void>;
	generateBuildPlan: () => Promise<void>;
	executeBuild: () => Promise<void>;
	clearBuild: () => void;
	cancelBuild: () => Promise<void>;
	browseOutputDir: () => Promise<void>;
	autoGenerateMenuNav: (menuId: string) => Promise<void>;
	checkToolchain: () => Promise<void>;
}

function parentDir(filePath: string): string {
	return filePath.replace(/[/\\][^/\\]+$/, '') || filePath;
}

function mergeInspectedAsset(existingAsset: Asset, inspected: Asset): Asset {
	return {
		...inspected,
		id: existingAsset.id,
		thumbnailPath: existingAsset.thumbnailPath,
		thumbnailError: existingAsset.thumbnailError,
	};
}

async function extractAssetThumbnail(
	asset: Asset,
): Promise<Pick<Asset, 'thumbnailPath' | 'thumbnailError'>> {
	if (asset.videoStreams.length === 0) {
		return { thumbnailPath: null, thumbnailError: null };
	}

	try {
		const thumbDir = await invoke<string>('plugin:spindle-project|get_cache_dir');
		const thumbPath = `${thumbDir}/thumb_${asset.id}.jpg`;
		const durationSecs = asset.durationSecs ?? 0;
		const seekTo = chooseThumbnailTimestamp(durationSecs);
		await invoke('plugin:spindle-project|extract_thumbnail', {
			sourcePath: asset.sourcePath,
			outputPath: thumbPath,
			timestampSecs: seekTo,
		});
		return { thumbnailPath: thumbPath, thumbnailError: null };
	} catch (error) {
		const message =
			error instanceof Error ? error.message : `Thumbnail extraction failed: ${String(error)}`;
		return { thumbnailPath: null, thumbnailError: message };
	}
}

function chooseThumbnailTimestamp(durationSecs: number): number {
	if (durationSecs <= 0) {
		return 0;
	}
	if (durationSecs <= 10) {
		return Math.max(0, durationSecs / 2);
	}

	return Math.min(Math.max(durationSecs * 0.1, 3), 30);
}

async function cachedThumbnailExists(thumbnailPath: string | null): Promise<boolean> {
	if (!thumbnailPath) {
		return false;
	}

	const fileName = thumbnailPath.split(/[/\\]/).pop();
	if (!fileName) {
		return false;
	}

	try {
		await readFile(`thumbnails/${fileName}`, {
			baseDir: BaseDirectory.AppCache,
		});
		return true;
	} catch {
		return false;
	}
}

async function ensureProjectAssetThumbnails(project: SpindleProjectFile): Promise<void> {
	for (const asset of project.assets) {
		if (asset.videoStreams.length === 0) {
			continue;
		}

		const hasCachedThumbnail = await cachedThumbnailExists(asset.thumbnailPath);
		if (hasCachedThumbnail) {
			continue;
		}

		const { project: beforeRegeneration } = useProjectStore.getState();
		if (!beforeRegeneration) {
			return;
		}

		setProjectAssetThumbnail(beforeRegeneration, asset.id, {
			thumbnailPath: null,
			thumbnailError: null,
		});

		const thumbnail = await extractAssetThumbnail(asset);
		const { project: current } = useProjectStore.getState();
		if (!current) {
			return;
		}

		setProjectAssetThumbnail(current, asset.id, thumbnail);
	}
}

/**
 * Re-inspect assets missing formatTitle (projects saved before the field existed).
 *
 * Uses a session-level set to avoid redundant ffprobe calls on repeated opens.
 * Assets that genuinely have no embedded title are updated to an empty string
 * sentinel so they are not re-inspected next time.
 */
const backfilledProjectIds = new Set<string>();

async function backfillAssetFormatTitles(project: SpindleProjectFile): Promise<void> {
	if (backfilledProjectIds.has(project.project.id)) return;
	backfilledProjectIds.add(project.project.id);

	const stale = project.assets.filter((a) => a.formatTitle === null);
	if (stale.length === 0) return;

	for (const asset of stale) {
		try {
			const inspected = await invoke<Asset>('plugin:spindle-project|inspect_asset', {
				path: asset.sourcePath,
			});

			const { project: current } = useProjectStore.getState();
			if (!current) return;
			useProjectStore.setState({
				project: {
					...current,
					assets: current.assets.map((a) =>
						a.id === asset.id
							? { ...a, formatTitle: inspected.formatTitle ?? '' }
							: a,
					),
				},
			});
		} catch {
			// Source file may be missing — skip silently
		}
	}
}

function setProjectAssetThumbnail(
	project: SpindleProjectFile,
	assetId: string,
	thumbnail: Pick<Asset, 'thumbnailPath' | 'thumbnailError'>,
): void {
	useProjectStore.setState({
		project: {
			...project,
			assets: project.assets.map((asset) =>
				asset.id === assetId ? { ...asset, ...thumbnail } : asset,
			),
		},
	});
}

// Prompt for an output directory if one isn't already set, persist the choice
// to the project, and return it. Returns null if the user cancels.
async function resolveOutputDir(
	project: SpindleProjectFile,
	updateProject: (updater: (p: SpindleProjectFile) => SpindleProjectFile) => void,
): Promise<string | null> {
	if (project.buildSettings.outputDirectory) {
		return project.buildSettings.outputDirectory;
	}
	const { lastOutputDir } = useAppSettingsStore.getState();
	const selected = await save({
		title: 'Choose Output Directory',
		filters: [],
		defaultPath: lastOutputDir
			? `${lastOutputDir}/${project.project.name}_DVD`
			: `${project.project.name}_DVD`,
	});
	if (selected) {
		updateProject((p) => ({
			...p,
			buildSettings: { ...p.buildSettings, outputDirectory: selected },
		}));
		useAppSettingsStore.getState().setLastOutputDir(parentDir(selected));
	}
	return selected ?? null;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
	project: null,
	filePath: null,
	isDirty: false,
	validationIssues: [],
	isLoading: false,
	buildPlan: null,
	buildStatus: 'idle',
	buildResult: null,
	buildProgress: null,
	buildLog: [],
	toolchain: [],

	createProject: async (req) => {
		set({ isLoading: true });
		try {
			const project = await invoke<SpindleProjectFile>('plugin:spindle-project|create_project', {
				payload: req,
			});
			set({ project, filePath: null, isDirty: true, validationIssues: [] });
		} finally {
			set({ isLoading: false });
		}
	},

	openProject: async () => {
		// Guard against losing unsaved changes
		const { isDirty } = get();
		if (isDirty) {
			const discard = await confirm(
				'You have unsaved changes. Discard them and open a different project?',
			);
			if (!discard) return;
		}

		const { lastProjectDir } = useAppSettingsStore.getState();
		const selected = await open({
			title: 'Open Spindle Project',
			multiple: false,
			filters: [{ name: 'Spindle Project', extensions: ['spindle'] }],
			defaultPath: lastProjectDir ?? undefined,
		});
		if (!selected) return;

		useAppSettingsStore.getState().setLastProjectDir(parentDir(selected));
		set({ isLoading: true });
		try {
			const json = await invoke<string>('read_text_file', { path: selected });
			const project = await invoke<SpindleProjectFile>('plugin:spindle-project|parse_project', {
				json,
			});
			set({
				project,
				filePath: selected,
				isDirty: false,
				validationIssues: [],
			});
			await ensureProjectAssetThumbnails(project);
			void backfillAssetFormatTitles(project);
		} finally {
			set({ isLoading: false });
		}
	},

	saveProject: async () => {
		const { project, filePath } = get();
		if (!project) return;

		if (!filePath) {
			return get().saveProjectAs();
		}

		set({ isLoading: true });
		try {
			const updated = {
				...project,
				project: { ...project.project, modifiedAt: new Date().toISOString() },
			};
			const json = await invoke<string>('plugin:spindle-project|serialise_project', {
				project: updated,
			});
			await invoke('write_text_file', { path: filePath, contents: json });
			set({ project: updated, isDirty: false });
		} finally {
			set({ isLoading: false });
		}
	},

	saveProjectAs: async () => {
		const { project } = get();
		if (!project) return;

		const { lastProjectDir } = useAppSettingsStore.getState();
		const selected = await save({
			title: 'Save Spindle Project',
			filters: [{ name: 'Spindle Project', extensions: ['spindle'] }],
			defaultPath: lastProjectDir
				? `${lastProjectDir}/${project.project.name}.spindle`
				: `${project.project.name}.spindle`,
		});
		if (!selected) return;

		useAppSettingsStore.getState().setLastProjectDir(parentDir(selected));

		set({ isLoading: true });
		try {
			const updated = {
				...project,
				project: { ...project.project, modifiedAt: new Date().toISOString() },
			};
			const json = await invoke<string>('plugin:spindle-project|serialise_project', {
				project: updated,
			});
			await invoke('write_text_file', { path: selected, contents: json });
			set({ project: updated, filePath: selected, isDirty: false });
		} finally {
			set({ isLoading: false });
		}
	},

	closeProject: () => {
		set({
			project: null,
			filePath: null,
			isDirty: false,
			validationIssues: [],
			buildPlan: null,
			buildStatus: 'idle',
			buildResult: null,
			buildProgress: null,
			buildLog: [],
		});
	},

	updateProject: (updater) => {
		const { project } = get();
		if (!project) return;
		set({ project: updater(project), isDirty: true });
	},

	validateProject: async () => {
		const { project } = get();
		if (!project) return;

		const issues = await invoke<ValidationIssue[]>('plugin:spindle-project|validate_project', {
			project,
		});
		set({ validationIssues: issues });
	},

	importAssets: async () => {
		const { project } = get();
		if (!project) return;

		const { lastMediaDir } = useAppSettingsStore.getState();
		const selected = await open({
			title: 'Import Media Files',
			multiple: true,
			defaultPath: lastMediaDir ?? undefined,
			filters: [
				{
					name: 'Media Files',
					extensions: [
						'mpg',
						'mpeg',
						'vob',
						'm2v',
						'mp4',
						'mkv',
						'avi',
						'mov',
						'ts',
						'ac3',
						'dts',
						'lpcm',
						'wav',
						'mp2',
						'mp3',
						'aac',
						'sub',
						'idx',
						'srt',
						'sup',
					],
				},
			],
		});
		if (!selected) return;

		const paths = Array.isArray(selected) ? selected : [selected];
		useAppSettingsStore.getState().setLastMediaDir(parentDir(paths[0]));

		// Create stub assets for each imported file — inspection fills in metadata later
		const newAssets: Asset[] = paths.map((filePath) => {
			const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
			return {
				id: crypto.randomUUID(),
				fileName,
				sourcePath: filePath,
				fileSizeBytes: null,
				durationSecs: null,
				containerFormat: null,
				videoStreams: [],
				audioStreams: [],
				subtitleStreams: [],
				compatibility: null,
				compatibilityDetail: null,
				fingerprint: null,
				warnings: [],
				thumbnailPath: null,
				thumbnailError: null,
				sourceChapters: [],
				formatTitle: null,
			};
		});

		set({
			project: {
				...project,
				assets: [...project.assets, ...newAssets],
			},
			isDirty: true,
		});

		// Trigger inspection and thumbnail extraction for each new asset
		for (const asset of newAssets) {
			try {
				const inspected = await invoke<Asset>('plugin:spindle-project|inspect_asset', {
					path: asset.sourcePath,
				});
				// Merge inspection results, preserving the ID we assigned
				const { project: current } = get();
				if (!current) break;
				const merged = mergeInspectedAsset(asset, inspected);
				set({
					project: {
						...current,
						assets: current.assets.map((a) => (a.id === asset.id ? merged : a)),
					},
				});

				const thumbnail = await extractAssetThumbnail(merged);
				const { project: afterThumb } = get();
				if (afterThumb) {
					set({
						project: {
							...afterThumb,
							assets: afterThumb.assets.map((a) =>
								a.id === asset.id ? { ...a, ...thumbnail } : a,
							),
						},
					});
				}
			} catch {
				// Inspection failed — asset stays as stub with null metadata
			}
		}
	},

	removeAsset: (assetId) => {
		const { project } = get();
		if (!project) return;
		// Remove asset and clear any dangling sourceAssetId references in titles
		set({
			project: {
				...project,
				assets: project.assets.filter((a) => a.id !== assetId),
				disc: {
					...project.disc,
					titlesets: project.disc.titlesets.map((ts) => ({
						...ts,
						titles: ts.titles.map((t) =>
							t.sourceAssetId === assetId
								? {
										...t,
										sourceAssetId: null,
										videoMapping: null,
										audioMappings: [],
										subtitleMappings: [],
									}
								: t,
						),
					})),
				},
			},
			isDirty: true,
		});
	},

	relinkAsset: async (assetId) => {
		const { project } = get();
		if (!project) return;

		const asset = project.assets.find((a) => a.id === assetId);
		if (!asset) return;

		const { lastMediaDir } = useAppSettingsStore.getState();
		const selected = await open({
			title: 'Relink Media File',
			multiple: false,
			defaultPath: lastMediaDir ?? undefined,
			filters: [
				{
					name: 'Media Files',
					extensions: [
						'mpg',
						'mpeg',
						'vob',
						'm2v',
						'mp4',
						'mkv',
						'avi',
						'mov',
						'ts',
						'ac3',
						'dts',
						'lpcm',
						'wav',
						'mp2',
						'mp3',
						'aac',
						'sub',
						'idx',
						'srt',
						'sup',
					],
				},
			],
		});
		if (!selected) return;

		const newPath = Array.isArray(selected) ? selected[0] : selected;
		useAppSettingsStore.getState().setLastMediaDir(parentDir(newPath));
		const newFileName = newPath.split(/[/\\]/).pop() ?? newPath;

		// Update path immediately
		set({
			project: {
				...project,
				assets: project.assets.map((a) =>
					a.id === assetId ? { ...a, sourcePath: newPath, fileName: newFileName } : a,
				),
			},
			isDirty: true,
		});

		// Re-inspect the relinked file
		try {
			const inspected = await invoke<Asset>('plugin:spindle-project|inspect_asset', {
				path: newPath,
			});
			const { project: current } = get();
			if (!current) return;
			const currentAsset = current.assets.find((a) => a.id === assetId);
			if (!currentAsset) return;
			const merged = mergeInspectedAsset(currentAsset, inspected);
			set({
				project: {
					...current,
					assets: current.assets.map((a) => (a.id === assetId ? merged : a)),
				},
			});

			const thumbnail = await extractAssetThumbnail(merged);
			const { project: afterThumb } = get();
			if (!afterThumb) return;
			set({
				project: {
					...afterThumb,
					assets: afterThumb.assets.map((a) => (a.id === assetId ? { ...a, ...thumbnail } : a)),
				},
			});
		} catch {
			// Re-inspection failed — keep the path update
		}
	},

	generateBuildPlan: async () => {
		const { project } = get();
		if (!project) return;

		const outputDir = await resolveOutputDir(project, get().updateProject);
		if (!outputDir) return;

		const skipSidecar = useAppSettingsStore.getState().devSkipSidecar;
		const skipUnsupportedStreams = useAppSettingsStore.getState().devSkipUnsupportedStreams;
		set({ buildStatus: 'planning' });
		try {
			const plan = await invoke<BuildPlan>('plugin:spindle-project|generate_build_plan', {
				project,
				outputDirectory: outputDir,
				skipSidecar,
				skipUnsupportedStreams,
			});
			set({ buildPlan: plan, buildStatus: 'idle' });
		} catch (e) {
			set({
				buildStatus: 'error',
				buildLog: [`Build plan generation failed: ${e}`],
			});
		}
	},

	executeBuild: async () => {
		const { project } = get();
		if (!project) return;

		const outputDir = await resolveOutputDir(project, get().updateProject);
		if (!outputDir) return;

		const skipSidecar = useAppSettingsStore.getState().devSkipSidecar;
		const skipUnsupportedStreams = useAppSettingsStore.getState().devSkipUnsupportedStreams;
		set({
			buildStatus: 'building',
			buildLog: ['Starting DVD-Video build…'],
			buildResult: null,
			buildProgress: null,
			buildPlan: null,
		});

		try {
			const result = await invoke<BuildResult>('plugin:spindle-project|execute_build', {
				project,
				outputDirectory: outputDir,
				skipSidecar,
				skipUnsupportedStreams,
			});

			set({
				buildResult: result,
				buildStatus: result.success ? 'complete' : 'error',
				buildLog: result.logLines,
			});
		} catch (e) {
			set((state) => ({
				buildStatus: 'error' as const,
				buildLog: [...state.buildLog, `Build failed: ${e}`],
			}));
		}
	},

	clearBuild: () => {
		set({
			buildPlan: null,
			buildStatus: 'idle',
			buildResult: null,
			buildProgress: null,
			buildLog: [],
		});
	},

	cancelBuild: async () => {
		try {
			await invoke('plugin:spindle-project|cancel_build');
			set((state) => ({
				buildLog: [...state.buildLog, 'Cancellation requested…'],
			}));
		} catch {
			// Best-effort cancellation
		}
	},

	browseOutputDir: async () => {
		const { project, updateProject } = get();
		if (!project) return;
		const { lastOutputDir } = useAppSettingsStore.getState();
		const selected = await save({
			title: 'Choose Output Directory',
			filters: [],
			defaultPath: lastOutputDir
				? `${lastOutputDir}/${project.project.name}_DVD`
				: `${project.project.name}_DVD`,
		});
		if (selected) {
			updateProject((p) => ({
				...p,
				buildSettings: { ...p.buildSettings, outputDirectory: selected },
			}));
			useAppSettingsStore.getState().setLastOutputDir(parentDir(selected));
		}
	},

	autoGenerateMenuNav: async (menuId) => {
		const { project } = get();
		if (!project) return;

		// Find the menu
		const globalMenu = project.disc.globalMenus.find((m) => m.id === menuId);
		let foundMenu: Menu | undefined = globalMenu;
		let scope: 'global' | 'titleset' = 'global';
		let titlesetId: string | null = null;

		if (!foundMenu) {
			for (const ts of project.disc.titlesets) {
				const tsMenu = ts.menus.find((m) => m.id === menuId);
				if (tsMenu) {
					foundMenu = tsMenu;
					scope = 'titleset';
					titlesetId = ts.id;
					break;
				}
			}
		}

		if (!foundMenu) return;

		const updated = await invoke<Menu>('plugin:spindle-project|auto_generate_menu_nav', {
			menu: foundMenu,
		});

		get().updateProject((p) => {
			if (scope === 'global') {
				return {
					...p,
					disc: {
						...p.disc,
						globalMenus: p.disc.globalMenus.map((m) => (m.id === menuId ? updated : m)),
					},
				};
			} else {
				return {
					...p,
					disc: {
						...p.disc,
						titlesets: p.disc.titlesets.map((ts) =>
							ts.id === titlesetId
								? { ...ts, menus: ts.menus.map((m) => (m.id === menuId ? updated : m)) }
								: ts,
						),
					},
				};
			}
		});
	},

	checkToolchain: async () => {
		try {
			const skipSidecar = useAppSettingsStore.getState().devSkipSidecar;
			const statuses = await invoke<ToolchainStatus[]>('plugin:spindle-project|check_toolchain', {
				skipSidecar,
			});
			set({ toolchain: statuses });
		} catch {
			// Toolchain check is best-effort
		}
	},
}));
