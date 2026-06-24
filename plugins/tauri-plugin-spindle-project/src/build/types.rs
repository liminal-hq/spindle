// Public build planning and execution types.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};

use crate::models::{SubtitleRenderMode, VideoStandard};

/// A complete build plan for authoring a DVD-Video disc.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildPlan {
    pub jobs: Vec<BuildJob>,
    pub output_directory: String,
    pub working_directory: String,
    pub dvdauthor_xml: String,
    pub summary: BuildSummary,
}

/// Summary statistics for the build plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSummary {
    pub total_jobs: usize,
    pub transcode_jobs: usize,
    pub titles_count: usize,
    pub menus_count: usize,
    pub generate_iso: bool,
    pub estimated_commands: Vec<String>,
}

/// A single step in the build pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum BuildJob {
    /// Create the working directory structure.
    PrepareWorkspace {
        reset_directories: Vec<String>,
        directories: Vec<String>,
    },
    /// Transcode a title's video and audio to DVD-compliant MPEG-2 PS.
    TranscodeTitle {
        title_id: String,
        title_name: String,
        source_path: String,
        output_path: String,
        /// When two-pass encoding is enabled, the analysis-only first pass
        /// run before `command` (the real encode). Its output is discarded;
        /// it only writes the `-passlogfile` stats `command` reads.
        #[serde(default)]
        pass1_command: Option<Vec<String>>,
        command: Vec<String>,
        label: String,
        /// Source asset duration in seconds, used for step-progress estimation.
        duration_secs: Option<f64>,
    },
    /// Render a menu background to MPEG-2 still frame.
    RenderMenu {
        menu_id: String,
        menu_name: String,
        output_path: String,
        command: Vec<String>,
        label: String,
        standard: VideoStandard,
        highlight_image_path: String,
        select_image_path: String,
        highlight_colour: String,
        select_colour: String,
        button_bounds: Vec<MenuOverlayButton>,
        /// Raster dimensions used for overlay image canvas.
        raster_width: u32,
        raster_height: u32,
        /// Path where the Skia scene PNG will be rendered before the ffmpeg encode.
        scene_png_path: String,
        /// JSON-encoded `MenuDocument` used to drive Skia scene rendering.
        menu_document_json: String,
        /// JSON-encoded map of `asset_id -> source_path` for image assets in the scene.
        scene_assets_json: String,
        /// When true, render the overlay with AA enabled and quantize to ≤4 colours
        /// before writing. Developer diagnostic option — not for normal builds.
        #[serde(default)]
        quantize_overlay_palette: bool,
    },
    /// Generate spumux XML and overlay subtitles/highlights on a menu.
    ComposeMenuHighlights {
        menu_id: String,
        menu_name: String,
        input_path: String,
        output_path: String,
        spumux_xml: String,
        command: Vec<String>,
        label: String,
    },
    /// Run dvdauthor to create the VIDEO_TS structure.
    AuthorDvd {
        xml_path: String,
        output_path: String,
        command: Vec<String>,
        label: String,
    },
    /// Extract bitmap subtitles from a source asset for spumux integration.
    ExtractSubtitles {
        title_id: String,
        title_name: String,
        source_path: String,
        output_path: String,
        command: Vec<String>,
        label: String,
    },
    /// Prepare and render a text subtitle mapping into the authored title MPEG.
    RenderTextSubtitles {
        title_id: String,
        title_name: String,
        source_path: String,
        source_stream_index: u32,
        input_path: String,
        output_path: String,
        subtitle_path: String,
        prepare_command: Vec<String>,
        spumux_xml: String,
        command: Vec<String>,
        label: String,
        render_mode: SubtitleRenderMode,
        font_family: String,
    },
    /// Symlink/copy a title's output from a shared transcode (deduplication).
    LinkTitle {
        title_id: String,
        title_name: String,
        source_path: String,
        link_path: String,
        label: String,
    },
    /// Generate an ISO image from VIDEO_TS.
    CreateIso {
        source_path: String,
        output_path: String,
        command: Vec<String>,
        label: String,
    },
}

impl BuildJob {
    pub fn label(&self) -> &str {
        match self {
            BuildJob::PrepareWorkspace { .. } => "Prepare workspace",
            BuildJob::TranscodeTitle { label, .. }
            | BuildJob::LinkTitle { label, .. }
            | BuildJob::ExtractSubtitles { label, .. }
            | BuildJob::RenderTextSubtitles { label, .. }
            | BuildJob::RenderMenu { label, .. }
            | BuildJob::ComposeMenuHighlights { label, .. }
            | BuildJob::AuthorDvd { label, .. }
            | BuildJob::CreateIso { label, .. } => label,
        }
    }

    pub fn command(&self) -> Option<&[String]> {
        match self {
            BuildJob::PrepareWorkspace { .. } | BuildJob::LinkTitle { .. } => None,
            BuildJob::TranscodeTitle { command, .. }
            | BuildJob::ExtractSubtitles { command, .. }
            | BuildJob::RenderTextSubtitles { command, .. }
            | BuildJob::RenderMenu { command, .. }
            | BuildJob::ComposeMenuHighlights { command, .. }
            | BuildJob::AuthorDvd { command, .. }
            | BuildJob::CreateIso { command, .. } => Some(command),
        }
    }
}

/// Progress event emitted during build execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildProgress {
    pub job_index: usize,
    pub total_jobs: usize,
    pub current_label: String,
    pub status: BuildJobStatus,
    pub output: Option<String>,

    /// Short name for the active sub-operation (e.g. "FFmpeg transcode").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_label: Option<String>,
    /// Estimated completion of the current sub-operation, clamped to 0–100.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_percent: Option<f64>,
    /// Freeform detail not covered by `elapsed_secs`/`eta_secs`, such as a
    /// file path for non-FFmpeg-progress steps.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_detail: Option<String>,
    /// Lifecycle state of the sub-operation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_status: Option<BuildJobStatus>,
    /// Wall-clock seconds elapsed since the current sub-operation started.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_secs: Option<f64>,
    /// Estimated remaining seconds for the current sub-operation, derived
    /// from FFmpeg's realtime `speed` multiplier rather than averaged
    /// elapsed time, so it reacts to the encode speeding up or slowing down.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eta_secs: Option<f64>,
}

impl BuildProgress {
    /// Create a progress event with no step-level detail.
    pub fn job(
        job_index: usize,
        total_jobs: usize,
        current_label: String,
        status: BuildJobStatus,
        output: Option<String>,
    ) -> Self {
        Self {
            job_index,
            total_jobs,
            current_label,
            status,
            output,
            step_label: None,
            step_percent: None,
            step_detail: None,
            step_status: None,
            elapsed_secs: None,
            eta_secs: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BuildJobStatus {
    Starting,
    Running,
    Complete,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuOverlayButton {
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    /// Corner radius of the button in raster pixels (from `button_style.border_radius`).
    #[serde(default)]
    pub border_radius: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub success: bool,
    pub output_directory: String,
    pub iso_path: Option<String>,
    pub log_lines: Vec<String>,
    pub failed_job_index: Option<usize>,
    pub error_message: Option<String>,
}
