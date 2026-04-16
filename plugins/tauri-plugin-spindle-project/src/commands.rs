// Tauri commands for project lifecycle operations.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use tauri::{command, AppHandle, Emitter, Manager, Runtime};

use crate::build::{self, BuildPlan, BuildResult};
use crate::models::*;
use crate::Result;
use crate::SpindleProjectExt;

fn trace_project_summary(project: &SpindleProjectFile) -> String {
    let titleset_titles: usize = project
        .disc
        .titlesets
        .iter()
        .map(|titleset| titleset.titles.len())
        .sum();
    let titleset_menus: usize = project
        .disc
        .titlesets
        .iter()
        .map(|titleset| titleset.menus.len())
        .sum();
    let image_nodes: usize = project
        .disc
        .global_menus
        .iter()
        .chain(
            project
                .disc
                .titlesets
                .iter()
                .flat_map(|titleset| titleset.menus.iter()),
        )
        .filter_map(|menu| menu.authored_document.as_ref())
        .map(|document| {
            document
                .scene
                .nodes
                .iter()
                .filter(|node| matches!(node, SceneNode::Image { .. }))
                .count()
        })
        .sum();

    format!(
        "name={} assets={} titles={} menus={} image_nodes={}",
        project.project.name,
        project.assets.len(),
        titleset_titles,
        project.disc.global_menus.len() + titleset_menus,
        image_nodes
    )
}

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
    eprintln!(
        "[spindle-project] parse_project starting json_bytes={}",
        json.len()
    );
    app.spindle_project().parse_project(&json)
}

/// Serialise a project to its JSON string for saving via tauri-plugin-fs.
#[command]
pub(crate) async fn serialise_project<R: Runtime>(
    app: AppHandle<R>,
    project: SpindleProjectFile,
) -> Result<String> {
    eprintln!(
        "[spindle-project] serialise_project {}",
        trace_project_summary(&project)
    );
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
pub(crate) async fn extract_video_thumbnail<R: Runtime>(
    _app: AppHandle<R>,
    source_path: String,
    output_path: String,
    timestamp_secs: f64,
) -> Result<()> {
    crate::inspect::extract_video_thumbnail(&source_path, &output_path, timestamp_secs)
}

/// Extract a scaled-down JPEG thumbnail from a still image asset.
///
/// Reads the source image, scales it so the longest edge is at most 1920 px,
/// and writes the result as JPEG to `output_path`. The output lands in the app
/// cache alongside video thumbnails so the frontend can read it through the
/// existing `$APPCACHE/thumbnails/*` fs capability.
#[command]
pub(crate) async fn extract_image_thumbnail<R: Runtime>(
    _app: AppHandle<R>,
    source_path: String,
    output_path: String,
) -> Result<()> {
    crate::inspect::extract_image_thumbnail(&source_path, &output_path)
}

/// Generate a build plan without executing it (dry-run / preview).
#[command]
pub(crate) async fn generate_build_plan<R: Runtime>(
    _app: AppHandle<R>,
    project: SpindleProjectFile,
    output_directory: String,
    skip_sidecar: bool,
    skip_unsupported_streams: bool,
) -> Result<BuildPlan> {
    eprintln!(
        "[spindle-project] generate_build_plan output_directory={} skip_sidecar={} skip_unsupported_streams={} {}",
        output_directory,
        skip_sidecar,
        skip_unsupported_streams,
        trace_project_summary(&project)
    );
    build::generate_build_plan_with_options(
        &project,
        &output_directory,
        skip_sidecar,
        skip_unsupported_streams,
    )
}

/// Execute a build plan, emitting progress events to the frontend.
#[command]
pub(crate) async fn execute_build<R: Runtime>(
    app: AppHandle<R>,
    project: SpindleProjectFile,
    output_directory: String,
    skip_sidecar: bool,
    skip_unsupported_streams: bool,
) -> Result<BuildResult> {
    let plan = build::generate_build_plan_with_options(
        &project,
        &output_directory,
        skip_sidecar,
        skip_unsupported_streams,
    )?;

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
    skip_sidecar: bool,
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
            let path = crate::toolchain::resolve_tool(name, skip_sidecar);
            let version = path.as_deref().and_then(detect_tool_version);
            ToolchainStatus {
                name: name.to_string(),
                purpose: purpose.to_string(),
                available: path.is_some(),
                version,
            }
        })
        .collect();

    Ok(statuses)
}

fn detect_tool_version(path: &std::path::Path) -> Option<String> {
    // Try both flag styles. Don't require a successful exit code — some tools
    // (e.g. dvdauthor) exit non-zero even for --version but still print output.
    for flag in &["-version", "--version"] {
        let Ok(output) = std::process::Command::new(path).arg(flag).output() else {
            continue;
        };
        // Prefer stdout; fall back to stderr (ffmpeg prints version to stderr).
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let text = if stdout.trim().is_empty() {
            &stderr
        } else {
            &stdout
        };
        if let Some(line) = text.lines().find(|l| !l.trim().is_empty()) {
            return Some(line.to_string());
        }
    }
    None
}

/// Export a DAR-corrected render preview PNG for the given menu.
///
/// Renders the menu scene at raster resolution and scales to display-aspect
/// dimensions so the preview reflects what a player would show, without
/// running a full build.
#[command]
pub(crate) async fn export_menu_render_preview<R: Runtime>(
    _app: AppHandle<R>,
    project: SpindleProjectFile,
    menu_id: String,
    output_path: String,
) -> Result<()> {
    let path = std::path::Path::new(&output_path);
    build::export_menu_render_preview(&project, &menu_id, path)
}

/// List all font families available to the Skia renderer for the given project.
///
/// Returns entries in priority order: project-asset fonts first, then system
/// fonts. The UI uses this to populate the font-family dropdown so that only
/// fonts the renderer can actually use are offered.
#[command]
pub(crate) async fn list_available_fonts<R: Runtime>(
    _app: AppHandle<R>,
    project: SpindleProjectFile,
) -> Result<Vec<build::FontEntry>> {
    let asset_refs: Vec<&Asset> = project.assets.iter().collect();
    Ok(build::enumerate_fonts(&asset_refs))
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
    _app: AppHandle<R>,
    project: Option<SpindleProjectFile>,
    build_log: Vec<String>,
    validation_issues: Vec<ValidationIssue>,
    skip_sidecar: bool,
    skip_unsupported_streams: bool,
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
                let path = crate::toolchain::resolve_tool(name, skip_sidecar);
                let version = path.as_deref().and_then(detect_tool_version);
                ToolchainStatus {
                    name: name.to_string(),
                    purpose: purpose.to_string(),
                    available: path.is_some(),
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
        "dev_options": {
            "skip_sidecar": skip_sidecar,
            "skip_unsupported_streams": skip_unsupported_streams,
        },
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
