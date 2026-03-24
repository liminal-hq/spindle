// Tauri commands for project lifecycle operations.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::Result;
use crate::SpindleProjectExt;

/// Create a new default project with the given settings.
#[command]
pub(crate) async fn create_project<R: Runtime>(
    app: AppHandle<R>,
    payload: CreateProjectRequest,
) -> Result<SpindleProjectFile> {
    app.spindle_project().create_project(payload)
}

/// Parse and validate a project file from its JSON content string.
#[command]
pub(crate) async fn parse_project<R: Runtime>(
    app: AppHandle<R>,
    json: String,
) -> Result<SpindleProjectFile> {
    app.spindle_project().parse_project(&json)
}

/// Serialise a project to its JSON string for saving via tauri-plugin-fs.
#[command]
pub(crate) async fn serialise_project<R: Runtime>(
    app: AppHandle<R>,
    project: SpindleProjectFile,
) -> Result<String> {
    app.spindle_project().serialise_project(&project)
}

/// Validate a project and return any issues found.
#[command]
pub(crate) async fn validate_project<R: Runtime>(
    app: AppHandle<R>,
    project: SpindleProjectFile,
) -> Result<Vec<ValidationIssue>> {
    app.spindle_project().validate_project(&project)
}

/// Inspect a media file and return its metadata as an Asset.
#[command]
pub(crate) async fn inspect_asset<R: Runtime>(_app: AppHandle<R>, path: String) -> Result<Asset> {
    // ffprobe is a short-lived subprocess, so running it directly is fine.
    // The async command handler already runs on a worker thread in Tauri.
    crate::inspect::inspect(&path)
}
