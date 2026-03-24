// Tauri commands for project lifecycle operations.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use tauri::{command, AppHandle, Emitter, Manager, Runtime};

use crate::build::{self, BuildPlan, BuildResult};
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

/// Extract a thumbnail from a video asset at a given timestamp.
#[command]
pub(crate) async fn extract_thumbnail<R: Runtime>(
    _app: AppHandle<R>,
    source_path: String,
    output_path: String,
    timestamp_secs: f64,
) -> Result<()> {
    crate::inspect::extract_thumbnail(&source_path, &output_path, timestamp_secs)
}

/// Generate a build plan without executing it (dry-run / preview).
#[command]
pub(crate) async fn generate_build_plan<R: Runtime>(
    _app: AppHandle<R>,
    project: SpindleProjectFile,
    output_directory: String,
) -> Result<BuildPlan> {
    build::generate_build_plan(&project, &output_directory)
}

/// Execute a build plan, emitting progress events to the frontend.
#[command]
pub(crate) async fn execute_build<R: Runtime>(
    app: AppHandle<R>,
    project: SpindleProjectFile,
    output_directory: String,
) -> Result<BuildResult> {
    let plan = build::generate_build_plan(&project, &output_directory)?;

    let result = build::execute_build_plan(&plan, |progress| {
        let _ = app.emit("spindle://build-progress", &progress);
    });

    Ok(result)
}

/// Cancel a running build.
#[command]
pub(crate) async fn cancel_build<R: Runtime>(_app: AppHandle<R>) -> Result<()> {
    build::cancel_build();
    Ok(())
}

/// Auto-generate directional navigation for a menu's buttons based on geometry.
#[command]
pub(crate) async fn auto_generate_menu_nav<R: Runtime>(
    _app: AppHandle<R>,
    mut menu: Menu,
) -> Result<Menu> {
    build::auto_generate_navigation(&mut menu);
    Ok(menu)
}

/// Check which external tools are available on the system PATH.
#[command]
pub(crate) async fn check_toolchain<R: Runtime>(
    _app: AppHandle<R>,
) -> Result<Vec<ToolchainStatus>> {
    let tools = vec![
        ("ffmpeg", "Video/audio transcoding"),
        ("ffprobe", "Media inspection"),
        ("dvdauthor", "DVD-Video authoring"),
        ("spumux", "DVD subtitle/highlight overlay"),
        ("genisoimage", "ISO 9660 image creation"),
        ("mkisofs", "ISO 9660 image creation (alternative)"),
    ];

    let statuses: Vec<ToolchainStatus> = tools
        .into_iter()
        .map(|(name, purpose)| {
            let version = detect_tool_version(name);
            ToolchainStatus {
                name: name.to_string(),
                purpose: purpose.to_string(),
                available: version.is_some(),
                version,
            }
        })
        .collect();

    Ok(statuses)
}

fn detect_tool_version(tool: &str) -> Option<String> {
    let output = std::process::Command::new(tool)
        .arg("-version")
        .output()
        .ok()?;

    if !output.status.success() {
        // Some tools use --version instead
        let output2 = std::process::Command::new(tool)
            .arg("--version")
            .output()
            .ok()?;

        if !output2.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&output2.stdout);
        return Some(stdout.lines().next().unwrap_or("unknown").to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    // ffmpeg prints version to stderr
    let version_line = if stdout.trim().is_empty() {
        stderr.lines().next().unwrap_or("unknown")
    } else {
        stdout.lines().next().unwrap_or("unknown")
    };
    Some(version_line.to_string())
}

/// Return the application cache directory for storing thumbnails and other transient data.
#[command]
pub(crate) async fn get_cache_dir<R: Runtime>(app: AppHandle<R>) -> Result<String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| crate::Error::Inspection(format!("Failed to get cache directory: {e}")))?;

    // Ensure the thumbnails subdirectory exists
    let thumb_dir = cache_dir.join("thumbnails");
    std::fs::create_dir_all(&thumb_dir)
        .map_err(|e| crate::Error::Inspection(format!("Failed to create thumbnail cache: {e}")))?;

    Ok(thumb_dir.to_string_lossy().to_string())
}

/// Export a diagnostics bundle as a JSON string for troubleshooting.
#[command]
pub(crate) async fn export_diagnostics<R: Runtime>(
    app: AppHandle<R>,
    project: Option<SpindleProjectFile>,
    build_log: Vec<String>,
    validation_issues: Vec<ValidationIssue>,
) -> Result<String> {
    let toolchain = {
        let tools = vec![
            ("ffmpeg", "Video/audio transcoding"),
            ("ffprobe", "Media inspection"),
            ("dvdauthor", "DVD-Video authoring"),
            ("spumux", "DVD subtitle/highlight overlay"),
            ("genisoimage", "ISO 9660 image creation"),
            ("mkisofs", "ISO 9660 image creation (alternative)"),
        ];
        tools
            .into_iter()
            .map(|(name, purpose)| {
                let version = detect_tool_version(name);
                ToolchainStatus {
                    name: name.to_string(),
                    purpose: purpose.to_string(),
                    available: version.is_some(),
                    version,
                }
            })
            .collect::<Vec<_>>()
    };

    let bundle = serde_json::json!({
        "spindle_version": "0.1.0",
        "generated_at": chrono::Utc::now().to_rfc3339(),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "toolchain": toolchain,
        "validation_issues": validation_issues,
        "build_log": build_log,
        "project_summary": project.as_ref().map(|p| serde_json::json!({
            "name": p.project.name,
            "schema_version": p.schema_version,
            "standard": p.disc.standard,
            "capacity_target": p.disc.capacity_target,
            "titleset_count": p.disc.titlesets.len(),
            "title_count": p.disc.titlesets.iter().map(|ts| ts.titles.len()).sum::<usize>(),
            "asset_count": p.assets.len(),
            "global_menu_count": p.disc.global_menus.len(),
        })),
    });

    serde_json::to_string_pretty(&bundle)
        .map_err(|e| crate::Error::Inspection(format!("Failed to serialise diagnostics: {e}")))
}

/// Status of an external tool in the authoring toolchain.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainStatus {
    pub name: String,
    pub purpose: String,
    pub available: bool,
    pub version: Option<String>,
}
