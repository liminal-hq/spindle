// Zustand store for project state management.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { open, save, confirm } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
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
	generateBuildPlan: () => Promise<void>;
	executeBuild: () => Promise<void>;
	clearBuild: () => void;
	cancelBuild: () => Promise<void>;
	autoGenerateMenuNav: (menuId: string) => Promise<void>;
	checkToolchain: () => Promise<void>;
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

		const selected = await open({
			multiple: false,
			filters: [{ name: 'Spindle Project', extensions: ['spindle'] }],
		});
		if (!selected) return;

		set({ isLoading: true });
		try {
			const json = await readTextFile(selected);
			const project = await invoke<SpindleProjectFile>('plugin:spindle-project|parse_project', {
				json,
			});
			set({
				project,
				filePath: selected,
				isDirty: false,
				validationIssues: [],
			});
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
			await writeTextFile(filePath, json);
			set({ project: updated, isDirty: false });
		} finally {
			set({ isLoading: false });
		}
	},

	saveProjectAs: async () => {
		const { project } = get();
		if (!project) return;

		const selected = await save({
			filters: [{ name: 'Spindle Project', extensions: ['spindle'] }],
			defaultPath: `${project.project.name}.spindle`,
		});
		if (!selected) return;

		set({ isLoading: true });
		try {
			const updated = {
				...project,
				project: { ...project.project, modifiedAt: new Date().toISOString() },
			};
			const json = await invoke<string>('plugin:spindle-project|serialise_project', {
				project: updated,
			});
			await writeTextFile(selected, json);
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

		const selected = await open({
			multiple: true,
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
				fingerprint: null,
				thumbnailPath: null,
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
				const merged = { ...inspected, id: asset.id };
				set({
					project: {
						...current,
						assets: current.assets.map((a) => (a.id === asset.id ? merged : a)),
					},
				});

				// Extract thumbnail if the asset has video streams
				if (inspected.videoStreams.length > 0) {
					try {
						const thumbDir = await invoke<string>('plugin:spindle-project|get_cache_dir');
						const thumbPath = `${thumbDir}/thumb_${asset.id}.jpg`;
						const seekTo = Math.min(1, inspected.durationSecs ?? 0);
						await invoke('plugin:spindle-project|extract_thumbnail', {
							sourcePath: asset.sourcePath,
							outputPath: thumbPath,
							timestampSecs: seekTo,
						});
						const { project: afterThumb } = get();
						if (afterThumb) {
							set({
								project: {
									...afterThumb,
									assets: afterThumb.assets.map((a) =>
										a.id === asset.id ? { ...a, thumbnailPath: thumbPath } : a,
									),
								},
							});
						}
					} catch {
						// Thumbnail extraction is best-effort
					}
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

	generateBuildPlan: async () => {
		const { project } = get();
		if (!project) return;

		const outputDir =
			project.buildSettings.outputDirectory ??
			(await (async () => {
				const selected = await save({
					filters: [],
					defaultPath: `${project.project.name}_DVD`,
				});
				if (selected) {
					// Update the project with the chosen directory
					get().updateProject((p) => ({
						...p,
						buildSettings: { ...p.buildSettings, outputDirectory: selected },
					}));
				}
				return selected;
			})());

		if (!outputDir) return;

		set({ buildStatus: 'planning' });
		try {
			const plan = await invoke<BuildPlan>('plugin:spindle-project|generate_build_plan', {
				project,
				outputDirectory: outputDir,
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

		const outputDir = project.buildSettings.outputDirectory;
		if (!outputDir) {
			set({ buildLog: ['No output directory set.'] });
			return;
		}

		set({
			buildStatus: 'building',
			buildLog: ['Starting DVD-Video build…'],
			buildResult: null,
			buildProgress: null,
		});

		try {
			const result = await invoke<BuildResult>('plugin:spindle-project|execute_build', {
				project,
				outputDirectory: outputDir,
			});

			set({
				buildResult: result,
				buildStatus: result.success ? 'complete' : 'error',
				buildLog: result.logLines,
			});
		} catch (e) {
			set({
				buildStatus: 'error',
				buildLog: (prev) => [...(Array.isArray(prev) ? prev : []), `Build failed: ${e}`],
			} as Partial<ProjectState> as any);
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
			const statuses = await invoke<ToolchainStatus[]>('plugin:spindle-project|check_toolchain');
			set({ toolchain: statuses });
		} catch {
			// Toolchain check is best-effort
		}
	},
}));
