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
    /// Render a menu background to MPEG-2 still frame (still menus) or the
    /// looping-video segment compose(s) (motion menus — see `menu_motion.rs`).
    RenderMenu {
        menu_id: String,
        menu_name: String,
        output_path: String,
        command: Vec<String>,
        /// Motion menus with an authored intro: the separate compose command
        /// for the intro segment, run before `command` (the loop segment) and
        /// written directly to its own final `{id}_intro.mpg` (no spumux
        /// pass — see design decision D1). `None` for still menus and motion
        /// menus without an intro.
        #[serde(default)]
        intro_command: Option<Vec<String>>,
        /// Loop segment duration in seconds for progress estimation, and the
        /// signal the executor uses to run `command`/`intro_command` via the
        /// progress-reporting ffmpeg runner rather than the plain one (mirrors
        /// `TranscodeTitle`'s `pass1_command` pattern). `None` for still menus.
        #[serde(default)]
        duration_secs: Option<f64>,
        /// Intro segment duration in seconds, used for `intro_command`'s
        /// progress estimation instead of the loop's `duration_secs` — an
        /// authored intro can run for a very different length of time than
        /// the loop, so reusing the loop duration misreports progress.
        /// `None` for still menus and motion menus without an intro.
        #[serde(default)]
        intro_duration_secs: Option<f64>,
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
        /// Per-keyframe overlay PNG schedule for the DCSQ lowering of animated
        /// highlight tracks (design decision D8) — always at least one entry.
        /// A menu with no relevant `AnimationTrack`s gets a single entry
        /// reusing `highlight_image_path`/`highlight_colour`/etc above, which
        /// keeps that (overwhelmingly common) case's rendered output and
        /// `<spu>` XML byte-identical to a build with no animation support at
        /// all. `#[serde(default)]` so plans built before this field existed
        /// deserialise cleanly.
        #[serde(default)]
        overlay_keyframes: Vec<OverlayKeyframeSpec>,
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

/// One overlay-image frame in a motion menu's DCSQ lowering schedule (design
/// decision D8) — a rendered highlight/select PNG pair, the effective
/// menu-highlight colours at that instant, and the loop-relative window
/// `[start_secs, end_secs)` it's shown for. `end_secs` is meaningless (and
/// ignored) when this is the schedule's only frame — see
/// `menu::generate_spumux_xml`, which keeps the single-frame case's `<spu>`
/// output byte-identical to a build with no animation tracks at all.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayKeyframeSpec {
    pub start_secs: f64,
    pub end_secs: f64,
    pub highlight_image_path: String,
    pub select_image_path: String,
    /// `#rrggbbaa` — opacity baked into the alpha channel.
    pub highlight_colour: String,
    pub select_colour: String,
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
