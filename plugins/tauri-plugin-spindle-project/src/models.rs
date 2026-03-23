// Defines the serialisable project schema for Spindle disc authoring projects.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Schema Version ──────────────────────────────────────────────────────────

/// Current schema version. Bump on breaking changes; migration logic keys off this.
pub const SCHEMA_VERSION: u32 = 1;

// ── Top-Level Project ───────────────────────────────────────────────────────

/// Root container for a Spindle authoring project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpindleProjectFile {
    pub schema_version: u32,
    pub project: ProjectMeta,
    pub disc: Disc,
    pub assets: Vec<Asset>,
    pub build_settings: BuildSettings,
}

impl Default for SpindleProjectFile {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            project: ProjectMeta::default(),
            disc: Disc::default(),
            assets: Vec::new(),
            build_settings: BuildSettings::default(),
        }
    }
}

/// Project-level metadata (name, ID, timestamps).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub modified_at: String,
}

impl Default for ProjectMeta {
    fn default() -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: Uuid::new_v4().to_string(),
            name: "Untitled Project".to_string(),
            created_at: now.clone(),
            modified_at: now,
        }
    }
}

// ── Disc ────────────────────────────────────────────────────────────────────

/// Represents the authored disc structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Disc {
    pub family: DiscFamily,
    pub standard: VideoStandard,
    pub capacity_target: CapacityTarget,
    pub first_play_action: Option<PlaybackAction>,
    pub titlesets: Vec<Titleset>,
    pub global_menus: Vec<Menu>,
}

impl Default for Disc {
    fn default() -> Self {
        Self {
            family: DiscFamily::DvdVideo,
            standard: VideoStandard::Ntsc,
            capacity_target: CapacityTarget::Dvd5,
            first_play_action: None,
            titlesets: vec![Titleset::default()],
            global_menus: Vec::new(),
        }
    }
}

/// Supported disc format families. DVD in v1, BD planned for future.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiscFamily {
    DvdVideo,
}

/// Video standard (affects resolution profiles, frame rates, timing).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum VideoStandard {
    Ntsc,
    Pal,
}

impl VideoStandard {
    pub fn frame_rate(&self) -> f64 {
        match self {
            VideoStandard::Ntsc => 29.97,
            VideoStandard::Pal => 25.0,
        }
    }
}

/// Disc capacity targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum CapacityTarget {
    Dvd5,
    Dvd9,
}

impl CapacityTarget {
    /// Nominal capacity in bytes.
    pub fn capacity_bytes(&self) -> u64 {
        match self {
            CapacityTarget::Dvd5 => 4_700_000_000,
            CapacityTarget::Dvd9 => 8_500_000_000,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            CapacityTarget::Dvd5 => "DVD-5 (4.7 GB)",
            CapacityTarget::Dvd9 => "DVD-9 (8.5 GB)",
        }
    }
}

// ── Titleset ────────────────────────────────────────────────────────────────

/// DVD titleset — a compatibility grouping of titles that share format assumptions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Titleset {
    pub id: String,
    pub name: String,
    pub titles: Vec<Title>,
    pub menus: Vec<Menu>,
}

impl Default for Titleset {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: "Default".to_string(),
            titles: Vec::new(),
            menus: Vec::new(),
        }
    }
}

// ── Title ───────────────────────────────────────────────────────────────────

/// A single playable title on the disc.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Title {
    pub id: String,
    pub name: String,
    pub source_asset_id: Option<String>,
    pub video_mapping: Option<VideoTrackMapping>,
    pub video_output_profile: Option<VideoOutputProfile>,
    pub audio_mappings: Vec<AudioTrackMapping>,
    pub subtitle_mappings: Vec<SubtitleTrackMapping>,
    pub chapters: Vec<ChapterPoint>,
    pub end_action: Option<PlaybackAction>,
    pub order_index: u32,
}

impl Title {
    pub fn new(name: String, order_index: u32) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            source_asset_id: None,
            video_mapping: None,
            video_output_profile: None,
            audio_mappings: Vec::new(),
            subtitle_mappings: Vec::new(),
            chapters: Vec::new(),
            end_action: None,
            order_index,
        }
    }
}

// ── Track Mappings ──────────────────────────────────────────────────────────

/// Maps a source video stream to the authored output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoTrackMapping {
    pub source_stream_index: u32,
    pub copy_mode: CopyMode,
}

/// Maps a source audio stream to the authored output with explicit output config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackMapping {
    pub id: String,
    pub source_stream_index: u32,
    pub output_target: AudioOutputTarget,
    pub copy_mode: CopyMode,
    pub label: String,
    pub language: String,
    pub order_index: u32,
    pub is_default: bool,
}

/// Maps a source subtitle stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrackMapping {
    pub id: String,
    pub source_stream_index: u32,
    pub label: String,
    pub language: String,
    pub order_index: u32,
    pub is_default: bool,
    pub is_forced: bool,
}

/// Whether a stream can be copied as-is or must be re-encoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CopyMode {
    Copy,
    ReEncode,
}

// ── Output Profiles ─────────────────────────────────────────────────────────

/// Legal DVD video output raster and format profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoOutputProfile {
    pub raster: VideoRaster,
    pub aspect: AspectMode,
}

/// DVD-legal video rasters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VideoRaster {
    /// Full D1 — 720×480 (NTSC) or 720×576 (PAL)
    #[serde(rename = "full-d1")]
    FullD1,
    /// 704-wide — 704×480 (NTSC) or 704×576 (PAL)
    #[serde(rename = "704-wide")]
    Wide704,
    /// Half D1 — 352×480 (NTSC) or 352×576 (PAL)
    #[serde(rename = "half-d1")]
    HalfD1,
    /// Quarter D1 — 352×240 (NTSC) or 352×288 (PAL)
    #[serde(rename = "quarter-d1")]
    QuarterD1,
}

impl VideoRaster {
    pub fn resolution(&self, standard: VideoStandard) -> (u32, u32) {
        match (self, standard) {
            (VideoRaster::FullD1, VideoStandard::Ntsc) => (720, 480),
            (VideoRaster::FullD1, VideoStandard::Pal) => (720, 576),
            (VideoRaster::Wide704, VideoStandard::Ntsc) => (704, 480),
            (VideoRaster::Wide704, VideoStandard::Pal) => (704, 576),
            (VideoRaster::HalfD1, VideoStandard::Ntsc) => (352, 480),
            (VideoRaster::HalfD1, VideoStandard::Pal) => (352, 576),
            (VideoRaster::QuarterD1, VideoStandard::Ntsc) => (352, 240),
            (VideoRaster::QuarterD1, VideoStandard::Pal) => (352, 288),
        }
    }
}

/// Aspect ratio presentation mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AspectMode {
    FourByThree,
    SixteenByNine,
}

/// DVD-legal audio output targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AudioOutputTarget {
    Ac3,
    Lpcm,
    Mp2,
    Dts,
}

// ── Chapters ────────────────────────────────────────────────────────────────

/// A chapter marker within a title.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterPoint {
    pub id: String,
    pub name: String,
    /// Timestamp in seconds from title start.
    pub timestamp_secs: f64,
    pub order_index: u32,
}

// ── Menus ───────────────────────────────────────────────────────────────────

/// A menu page with buttons and navigation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Menu {
    pub id: String,
    pub name: String,
    pub background_asset_id: Option<String>,
    pub buttons: Vec<MenuButton>,
    pub default_button_id: Option<String>,
}

/// A navigable button within a menu.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuButton {
    pub id: String,
    pub label: String,
    pub bounds: ButtonBounds,
    pub action: Option<PlaybackAction>,
    pub nav_up: Option<String>,
    pub nav_down: Option<String>,
    pub nav_left: Option<String>,
    pub nav_right: Option<String>,
}

/// Button position and size in menu coordinates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Target action for a button activation or end-of-title event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum PlaybackAction {
    PlayTitle { title_id: String },
    PlayChapter { title_id: String, chapter_id: String },
    ShowMenu { menu_id: String },
    Stop,
}

// ── Assets ──────────────────────────────────────────────────────────────────

/// A source media file registered in the project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub file_name: String,
    pub source_path: String,
    pub file_size_bytes: Option<u64>,
    pub duration_secs: Option<f64>,
    pub container_format: Option<String>,
    pub video_streams: Vec<VideoStreamInfo>,
    pub audio_streams: Vec<AudioStreamInfo>,
    pub subtitle_streams: Vec<SubtitleStreamInfo>,
    pub compatibility: Option<CompatibilityAssessment>,
    pub fingerprint: Option<String>,
}

impl Asset {
    pub fn new(file_name: String, source_path: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            file_name,
            source_path,
            file_size_bytes: None,
            duration_secs: None,
            container_format: None,
            video_streams: Vec::new(),
            audio_streams: Vec::new(),
            subtitle_streams: Vec::new(),
            compatibility: None,
            fingerprint: None,
        }
    }
}

/// Detected video stream metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoStreamInfo {
    pub index: u32,
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub frame_rate: Option<f64>,
    pub aspect_ratio: Option<String>,
    pub scan_type: Option<String>,
    pub bitrate_bps: Option<u64>,
}

/// Detected audio stream metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStreamInfo {
    pub index: u32,
    pub codec: String,
    pub channels: u32,
    pub sample_rate: u32,
    pub language: Option<String>,
    pub bitrate_bps: Option<u64>,
}

/// Detected subtitle stream metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStreamInfo {
    pub index: u32,
    pub codec: String,
    pub language: Option<String>,
    pub subtitle_type: SubtitleType,
}

/// Whether a subtitle source is bitmap or text-based.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SubtitleType {
    Bitmap,
    Text,
    Unknown,
}

/// Per-asset compatibility assessment relative to the disc target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CompatibilityAssessment {
    RemuxCompatible,
    TransformCompatible,
    ReEncodeRequired,
    Unsupported,
}

// ── Build Settings ──────────────────────────────────────────────────────────

/// Build configuration and preferences.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSettings {
    pub output_directory: Option<String>,
    pub generate_iso: bool,
    pub safety_margin_bytes: u64,
    pub allocation_strategy: AllocationStrategy,
}

impl Default for BuildSettings {
    fn default() -> Self {
        Self {
            output_directory: None,
            generate_iso: false,
            // 50 MB default safety margin
            safety_margin_bytes: 50_000_000,
            allocation_strategy: AllocationStrategy::DurationWeighted,
        }
    }
}

/// How to distribute bitrate budget across titles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AllocationStrategy {
    EqualShare,
    DurationWeighted,
    PriorityWeighted,
}

// ── Command payloads ────────────────────────────────────────────────────────

/// Request to create a new project with initial settings.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub name: String,
    pub standard: VideoStandard,
    pub capacity_target: CapacityTarget,
}

// ── Validation ──────────────────────────────────────────────────────────────

/// Severity of a validation issue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IssueSeverity {
    Info,
    Warning,
    Error,
}

/// A single validation finding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub severity: IssueSeverity,
    pub code: String,
    pub message: String,
    pub context: Option<String>,
}
