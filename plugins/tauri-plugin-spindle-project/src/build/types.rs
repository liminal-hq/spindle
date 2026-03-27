// Public build planning and execution types.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};

use crate::models::VideoStandard;

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
        command: Vec<String>,
        label: String,
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
            | BuildJob::RenderMenu { label, .. }
            | BuildJob::ComposeMenuHighlights { label, .. }
            | BuildJob::AuthorDvd { label, .. }
            | BuildJob::CreateIso { label, .. } => label,
        }
    }

    pub fn command(&self) -> Option<&[String]> {
        match self {
            BuildJob::PrepareWorkspace { .. } => None,
            BuildJob::TranscodeTitle { command, .. }
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
