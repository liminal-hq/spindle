// Zustand store for project state management.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type {
  SpindleProjectFile,
  CreateProjectRequest,
  ValidationIssue,
  Asset,
} from "../types/project";

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
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  filePath: null,
  isDirty: false,
  validationIssues: [],
  isLoading: false,

  createProject: async (req) => {
    set({ isLoading: true });
    try {
      const project = await invoke<SpindleProjectFile>(
        "plugin:spindle-project|create_project",
        { payload: req },
      );
      set({ project, filePath: null, isDirty: true, validationIssues: [] });
    } finally {
      set({ isLoading: false });
    }
  },

  openProject: async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Spindle Project", extensions: ["spindle"] }],
    });
    if (!selected) return;

    set({ isLoading: true });
    try {
      const json = await readTextFile(selected);
      const project = await invoke<SpindleProjectFile>(
        "plugin:spindle-project|parse_project",
        { json },
      );
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
      const json = await invoke<string>(
        "plugin:spindle-project|serialise_project",
        { project: updated },
      );
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
      filters: [{ name: "Spindle Project", extensions: ["spindle"] }],
      defaultPath: `${project.project.name}.spindle`,
    });
    if (!selected) return;

    set({ isLoading: true });
    try {
      const updated = {
        ...project,
        project: { ...project.project, modifiedAt: new Date().toISOString() },
      };
      const json = await invoke<string>(
        "plugin:spindle-project|serialise_project",
        { project: updated },
      );
      await writeTextFile(selected, json);
      set({ project: updated, filePath: selected, isDirty: false });
    } finally {
      set({ isLoading: false });
    }
  },

  closeProject: () => {
    set({ project: null, filePath: null, isDirty: false, validationIssues: [] });
  },

  updateProject: (updater) => {
    const { project } = get();
    if (!project) return;
    set({ project: updater(project), isDirty: true });
  },

  validateProject: async () => {
    const { project } = get();
    if (!project) return;

    const issues = await invoke<ValidationIssue[]>(
      "plugin:spindle-project|validate_project",
      { project },
    );
    set({ validationIssues: issues });
  },

  importAssets: async () => {
    const { project } = get();
    if (!project) return;

    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Media Files",
          extensions: [
            "mpg", "mpeg", "vob", "m2v", "mp4", "mkv", "avi", "mov", "ts",
            "ac3", "dts", "lpcm", "wav", "mp2", "mp3", "aac",
            "sub", "idx", "srt", "sup",
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
      };
    });

    set({
      project: {
        ...project,
        assets: [...project.assets, ...newAssets],
      },
      isDirty: true,
    });

    // Trigger inspection for each new asset
    for (const asset of newAssets) {
      try {
        const inspected = await invoke<Asset>(
          "plugin:spindle-project|inspect_asset",
          { path: asset.sourcePath },
        );
        // Merge inspection results, preserving the ID we assigned
        const { project: current } = get();
        if (!current) break;
        set({
          project: {
            ...current,
            assets: current.assets.map((a) =>
              a.id === asset.id ? { ...inspected, id: asset.id } : a,
            ),
          },
        });
      } catch {
        // Inspection failed — asset stays as stub with null metadata
      }
    }
  },

  removeAsset: (assetId) => {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        assets: project.assets.filter((a) => a.id !== assetId),
      },
      isDirty: true,
    });
  },
}));
