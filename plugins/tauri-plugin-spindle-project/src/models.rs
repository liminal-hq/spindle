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

impl SpindleProjectFile {
    /// Ensure all menus in the project have an authored document by migrating
    /// any legacy flat menu structures.
    pub fn migrate_all_menus(&mut self) {
        let standard = self.disc.standard;
        for menu in &mut self.disc.global_menus {
            menu.migrate_to_document(MenuDomain::Vmgm, standard);
        }
        for titleset in &mut self.disc.titlesets {
            for menu in &mut titleset.menus {
                menu.migrate_to_document(MenuDomain::Titleset, standard);
            }
        }
    }
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

    pub fn default_resolution(&self) -> (f64, f64) {
        match self {
            VideoStandard::Ntsc => (720.0, 480.0),
            VideoStandard::Pal => (720.0, 576.0),
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

/// A chapter point detected in a source media file during inspection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceChapter {
    pub start_secs: f64,
    pub end_secs: f64,
    pub title: Option<String>,
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
    /// Highlight colours for the subpicture overlay (DVD 4-colour palette).
    #[serde(default)]
    pub highlight_colours: MenuHighlightColours,
    /// Whether the background is a still frame or looping video (Stage 2).
    #[serde(default)]
    pub background_mode: BackgroundMode,
    /// Duration of the motion loop in seconds (motion menus only).
    #[serde(default)]
    pub motion_duration_secs: Option<f64>,
    /// Optional audio asset for motion menu background music.
    #[serde(default)]
    pub motion_audio_asset_id: Option<String>,
    /// Number of times to loop before timeout action (0 = infinite, motion only).
    #[serde(default)]
    pub motion_loop_count: u32,
    /// Action when a motion menu times out after looping.
    #[serde(default)]
    pub timeout_action: Option<PlaybackAction>,
    /// The new authored scene document that replaces the flat button model.
    /// During the transition, this is optional.
    #[serde(default)]
    pub authored_document: Option<MenuDocument>,
}

impl Default for Menu {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: "Untitled Menu".to_string(),
            background_asset_id: None,
            buttons: Vec::new(),
            default_button_id: None,
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::Still,
            motion_duration_secs: None,
            motion_audio_asset_id: None,
            motion_loop_count: 0,
            timeout_action: None,
            authored_document: None,
        }
    }
}

impl Menu {
    /// Lift a legacy menu into the new authored document format.
    /// This is used during migration to ensure old projects can be edited in the new scene editor.
    pub fn migrate_to_document(&mut self, domain: MenuDomain, standard: VideoStandard) {
        if self.authored_document.is_some() {
            return;
        }

        let (res_w, res_h) = standard.default_resolution();

        let scene = MenuScene {
            design_size: MenuSize {
                width: res_w,
                height: res_h,
            },
            background: SceneBackground {
                asset_id: self.background_asset_id.clone(),
                colour: Some("#101014".to_string()),
            },
            nodes: self
                .buttons
                .iter()
                .map(|b| SceneNode::Button {
                    id: b.id.clone(),
                    label: b.label.clone(),
                    x: b.bounds.x,
                    y: b.bounds.y,
                    width: b.bounds.width,
                    height: b.bounds.height,
                    highlight_mode: b.highlight_mode,
                    highlight_keyframes: b.highlight_keyframes.clone(),
                    video_asset_id: b.video_asset_id.clone(),
                })
                .collect(),
            guides: Vec::new(),
        };

        let interaction = MenuInteractionGraph {
            default_focus_id: self.default_button_id.clone(),
            nodes: self
                .buttons
                .iter()
                .map(|b| FocusNode {
                    node_id: b.id.clone(),
                    nav_up: b.nav_up.clone(),
                    nav_down: b.nav_down.clone(),
                    nav_left: b.nav_left.clone(),
                    nav_right: b.nav_right.clone(),
                    action: b.action.clone(),
                })
                .collect(),
            timeout_action: self.timeout_action.clone(),
        };

        let timing = MenuTiming {
            intro_duration_secs: 0.0,
            loop_duration_secs: self.motion_duration_secs.unwrap_or(0.0),
            loop_count: self.motion_loop_count,
        };

        self.authored_document = Some(MenuDocument {
            id: self.id.clone(),
            name: self.name.clone(),
            domain,
            scene,
            interaction,
            timing,
            highlight_colours: self.highlight_colours.clone(),
            background_mode: self.background_mode,
            theme_ref: None,
            generation_meta: None,
            compile_policy: MenuCompilePolicy {
                safe_area_mode: SafeAreaMode::ActionSafe,
                palette_strategy: PaletteStrategy::Auto,
            },
        });
    }
}

/// A structured menu document that separates authored intent from target compilation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuDocument {
    pub id: String,
    pub name: String,
    pub domain: MenuDomain,
    pub scene: MenuScene,
    pub interaction: MenuInteractionGraph,
    pub timing: MenuTiming,
    pub highlight_colours: MenuHighlightColours,
    pub background_mode: BackgroundMode,
    pub theme_ref: Option<String>,
    pub generation_meta: Option<MenuGenerationMeta>,
    pub compile_policy: MenuCompilePolicy,
}

/// Menu domain indicates whether it belongs to the Video Manager (VMGM) or a Titleset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MenuDomain {
    Vmgm,
    Titleset,
}

/// The visual scene graph for the menu.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuScene {
    pub design_size: MenuSize,
    pub background: SceneBackground,
    pub nodes: Vec<SceneNode>,
    pub guides: Vec<SceneGuide>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneBackground {
    pub asset_id: Option<String>,
    pub colour: Option<String>,
}

/// A node within the authored menu scene graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum SceneNode {
    Group {
        id: String,
        name: String,
        children: Vec<SceneNode>,
    },
    Text {
        id: String,
        content: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        #[serde(default)]
        font_size: Option<f64>,
        #[serde(default)]
        colour: Option<String>,
    },
    Image {
        id: String,
        asset_id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    Shape {
        id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        #[serde(default)]
        fill: Option<String>,
    },
    Video {
        id: String,
        asset_id: String,
        x: f64,
        y: f64,
    },
    Button {
        id: String,
        label: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        #[serde(default)]
        highlight_mode: HighlightMode,
        #[serde(default)]
        highlight_keyframes: Vec<HighlightKeyframe>,
        #[serde(default)]
        video_asset_id: Option<String>,
    },
    ComponentInstance {
        id: String,
        component_id: String,
    },
    GeneratedCollection {
        id: String,
        source: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneGuide {
    pub orientation: GuideOrientation,
    pub position: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GuideOrientation {
    Horizontal,
    Vertical,
}

/// The interaction graph defining remote-driven behaviour.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuInteractionGraph {
    pub default_focus_id: Option<String>,
    pub nodes: Vec<FocusNode>,
    pub timeout_action: Option<PlaybackAction>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusNode {
    pub node_id: String,
    pub nav_up: Option<String>,
    pub nav_down: Option<String>,
    pub nav_left: Option<String>,
    pub nav_right: Option<String>,
    pub action: Option<PlaybackAction>,
}

/// Timing and motion rules for the menu.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuTiming {
    pub intro_duration_secs: f64,
    pub loop_duration_secs: f64,
    pub loop_count: u32, // 0 = infinite
}

impl Default for MenuTiming {
    fn default() -> Self {
        Self {
            intro_duration_secs: 0.0,
            loop_duration_secs: 0.0,
            loop_count: 0,
        }
    }
}

/// Metadata for generated menus.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuGenerationMeta {
    pub generator_id: String,
    pub last_generated_at: String,
}

/// Format-specific compilation rules and safe-area policies.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuCompilePolicy {
    pub safe_area_mode: SafeAreaMode,
    pub palette_strategy: PaletteStrategy,
}

impl Default for MenuCompilePolicy {
    fn default() -> Self {
        Self {
            safe_area_mode: SafeAreaMode::ActionSafe,
            palette_strategy: PaletteStrategy::Auto,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SafeAreaMode {
    ActionSafe,
    TitleSafe,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PaletteStrategy {
    Auto,
    Manual,
}

/// Whether a menu background is a still frame or looping video.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum BackgroundMode {
    #[default]
    Still,
    Motion,
}

/// DVD subpicture highlight palette colours.
///
/// DVD menus use a 4-colour CLUT (colour look-up table) for button overlays.
/// The "select" colour is shown when a button is navigated to; the "activate"
/// colour flashes briefly when the button is pressed. Colours are stored as
/// CSS-style hex strings (e.g. "#ffaa40").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuHighlightColours {
    /// Colour shown over a button when it is selected/focused.
    pub select_colour: String,
    /// Opacity of the select highlight (0.0–1.0).
    pub select_opacity: f64,
    /// Colour shown briefly when a button is activated/pressed.
    pub activate_colour: String,
    /// Opacity of the activate highlight (0.0–1.0).
    pub activate_opacity: f64,
}

impl Default for MenuHighlightColours {
    fn default() -> Self {
        Self {
            select_colour: "#ffaa40".to_string(),
            select_opacity: 0.6,
            activate_colour: "#ffffff".to_string(),
            activate_opacity: 0.8,
        }
    }
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
    /// Whether button highlights are static or animated (Stage 2).
    #[serde(default)]
    pub highlight_mode: HighlightMode,
    /// Animated highlight keyframes (Stage 2).
    #[serde(default)]
    pub highlight_keyframes: Vec<HighlightKeyframe>,
    /// Video asset composited into the menu background at this button's bounds (Stage 2).
    #[serde(default)]
    pub video_asset_id: Option<String>,
}

impl Default for MenuButton {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            label: "Untitled Button".to_string(),
            bounds: ButtonBounds {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 50.0,
            },
            action: None,
            nav_up: None,
            nav_down: None,
            nav_left: None,
            nav_right: None,
            highlight_mode: HighlightMode::Static,
            highlight_keyframes: Vec::new(),
            video_asset_id: None,
        }
    }
}

/// Whether button highlights are static or animated over the motion loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum HighlightMode {
    #[default]
    Static,
    Animated,
}

/// A keyframe for animated button highlights within a motion menu loop.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightKeyframe {
    /// Timestamp within the motion loop (seconds from start).
    pub timestamp_secs: f64,
    /// Override select colour at this keyframe (None = use menu default).
    pub select_colour: Option<String>,
    /// Override select opacity at this keyframe (None = use menu default).
    pub select_opacity: Option<f64>,
    /// Override activate colour at this keyframe (None = use menu default).
    pub activate_colour: Option<String>,
    /// Override activate opacity at this keyframe (None = use menu default).
    pub activate_opacity: Option<f64>,
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
    PlayTitle {
        #[serde(rename = "titleId")]
        title_id: String,
    },
    PlayChapter {
        #[serde(rename = "titleId")]
        title_id: String,
        #[serde(rename = "chapterId")]
        chapter_id: String,
    },
    ShowMenu {
        #[serde(rename = "menuId")]
        menu_id: String,
    },
    SetAudioStream {
        #[serde(rename = "streamIndex")]
        stream_index: u32,
    },
    SetSubtitleStream {
        #[serde(rename = "streamIndex")]
        stream_index: Option<u32>,
    },
    Sequence {
        actions: Vec<PlaybackAction>,
    },
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
    /// Detailed per-stream compatibility breakdown.
    #[serde(default)]
    pub compatibility_detail: Option<CompatibilityDetail>,
    pub fingerprint: Option<String>,
    #[serde(default)]
    pub warnings: Vec<AssetWarning>,
    #[serde(default)]
    pub thumbnail_path: Option<String>,
    #[serde(default)]
    pub thumbnail_error: Option<String>,
    /// Chapter markers detected in the source media file.
    #[serde(default)]
    pub source_chapters: Vec<SourceChapter>,
    /// Container-level title tag from source media metadata (e.g. MKV/MP4 title).
    #[serde(default)]
    pub format_title: Option<String>,
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
            compatibility_detail: None,
            fingerprint: None,
            warnings: Vec::new(),
            thumbnail_path: None,
            thumbnail_error: None,
            source_chapters: Vec::new(),
            format_title: None,
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
    #[serde(default)]
    pub title: Option<String>,
    /// OETF / transfer characteristics (e.g. "smpte2084" for HDR10, "arib-std-b67" for HLG).
    #[serde(default)]
    pub color_transfer: Option<String>,
    /// Color primaries (e.g. "bt2020" for wide-gamut HDR, "bt709" for SDR).
    #[serde(default)]
    pub color_primaries: Option<String>,
    /// Dolby Vision profile when ffprobe exposes DOVI side data.
    #[serde(default)]
    pub dolby_vision_profile: Option<u8>,
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
    #[serde(default)]
    pub title: Option<String>,
}

/// Detected subtitle stream metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStreamInfo {
    pub index: u32,
    pub codec: String,
    pub language: Option<String>,
    pub subtitle_type: SubtitleType,
    #[serde(default)]
    pub title: Option<String>,
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

/// Per-stream compatibility breakdown explaining why the overall assessment was given.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityDetail {
    pub overall: CompatibilityAssessment,
    pub video: Option<VideoCompatibility>,
    pub audio_streams: Vec<AudioStreamCompatibility>,
    pub container: ContainerCompatibility,
}

/// Compatibility detail for a single video stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoCompatibility {
    pub codec: PropertyCheck,
    pub resolution: PropertyCheck,
    pub frame_rate: PropertyCheck,
}

/// Compatibility detail for a single audio stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStreamCompatibility {
    pub stream_index: u32,
    pub codec: PropertyCheck,
}

/// Compatibility detail for the container format.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerCompatibility {
    pub format: PropertyCheck,
}

/// A single property compatibility check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyCheck {
    /// The source value (e.g. "h264", "1920x1080").
    pub value: String,
    /// What DVD requires (e.g. "mpeg2video", "720x480 or 720x576").
    pub dvd_requires: String,
    /// What action the build will take: "none", "remux", "re-encode", "scale".
    pub action: String,
    /// Whether this property is DVD-compatible as-is.
    pub compatible: bool,
}

/// Non-fatal asset warnings surfaced in the UI and diagnostics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetWarning {
    pub code: String,
    pub message: String,
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
    #[serde(default)]
    pub subtitle_render_mode: SubtitleRenderMode,
}

impl Default for BuildSettings {
    fn default() -> Self {
        Self {
            output_directory: None,
            generate_iso: false,
            // 50 MB default safety margin
            safety_margin_bytes: 50_000_000,
            allocation_strategy: AllocationStrategy::DurationWeighted,
            subtitle_render_mode: SubtitleRenderMode::TwoPass,
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

/// High-level subtitle rendering mode for text subtitle authoring.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum SubtitleRenderMode {
    OnePass,
    #[default]
    TwoPass,
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
    /// Entity type for navigation: "title", "menu", "titleset", "disc", "build".
    #[serde(default)]
    pub entity_type: Option<String>,
    /// Human-readable name of the affected entity.
    #[serde(default)]
    pub entity_name: Option<String>,
    /// Plain-language fix suggestion.
    #[serde(default)]
    pub suggested_fix: Option<String>,
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_project_round_trips_through_json() {
        let project = SpindleProjectFile::default();
        let json = serde_json::to_string_pretty(&project).unwrap();
        let parsed: SpindleProjectFile = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.schema_version, SCHEMA_VERSION);
        assert_eq!(parsed.project.name, "Untitled Project");
        assert_eq!(parsed.disc.family, DiscFamily::DvdVideo);
        assert_eq!(parsed.disc.standard, VideoStandard::Ntsc);
        assert_eq!(parsed.disc.capacity_target, CapacityTarget::Dvd5);
        assert_eq!(parsed.disc.titlesets.len(), 1);
        assert!(parsed.assets.is_empty());
    }

    #[test]
    fn project_with_titles_round_trips() {
        let mut project = SpindleProjectFile::default();
        project.project.name = "Wedding DVD".to_string();

        let title = Title::new("Ceremony".to_string(), 0);
        project.disc.titlesets[0].titles.push(title);

        let asset = Asset::new(
            "ceremony.mp4".to_string(),
            "/media/ceremony.mp4".to_string(),
        );
        project.assets.push(asset);

        let json = serde_json::to_string(&project).unwrap();
        let parsed: SpindleProjectFile = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.project.name, "Wedding DVD");
        assert_eq!(parsed.disc.titlesets[0].titles.len(), 1);
        assert_eq!(parsed.disc.titlesets[0].titles[0].name, "Ceremony");
        assert_eq!(parsed.assets.len(), 1);
        assert_eq!(parsed.assets[0].file_name, "ceremony.mp4");
    }

    #[test]
    fn schema_version_is_present_in_json() {
        let project = SpindleProjectFile::default();
        let json = serde_json::to_string(&project).unwrap();
        let raw: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(raw["schemaVersion"], SCHEMA_VERSION);
    }

    #[test]
    fn disc_family_serialises_as_kebab_case() {
        let json = serde_json::to_string(&DiscFamily::DvdVideo).unwrap();
        assert_eq!(json, "\"dvd-video\"");
    }

    #[test]
    fn video_standard_serialises_as_uppercase() {
        assert_eq!(
            serde_json::to_string(&VideoStandard::Ntsc).unwrap(),
            "\"NTSC\""
        );
        assert_eq!(
            serde_json::to_string(&VideoStandard::Pal).unwrap(),
            "\"PAL\""
        );
    }

    #[test]
    fn capacity_target_values_are_correct() {
        assert_eq!(CapacityTarget::Dvd5.capacity_bytes(), 4_700_000_000);
        assert_eq!(CapacityTarget::Dvd9.capacity_bytes(), 8_500_000_000);
    }

    #[test]
    fn video_raster_resolutions_are_correct() {
        assert_eq!(
            VideoRaster::FullD1.resolution(VideoStandard::Ntsc),
            (720, 480)
        );
        assert_eq!(
            VideoRaster::FullD1.resolution(VideoStandard::Pal),
            (720, 576)
        );
        assert_eq!(
            VideoRaster::HalfD1.resolution(VideoStandard::Ntsc),
            (352, 480)
        );
        assert_eq!(
            VideoRaster::QuarterD1.resolution(VideoStandard::Pal),
            (352, 288)
        );
    }

    #[test]
    fn frame_rates_match_standard() {
        assert!((VideoStandard::Ntsc.frame_rate() - 29.97).abs() < 0.01);
        assert!((VideoStandard::Pal.frame_rate() - 25.0).abs() < 0.01);
    }

    #[test]
    fn playback_action_serialises_as_tagged_union() {
        let action = PlaybackAction::PlayTitle {
            title_id: "t1".to_string(),
        };
        let json = serde_json::to_string(&action).unwrap();
        assert!(json.contains("\"type\":\"playTitle\""));
        assert!(json.contains("\"titleId\":\"t1\""));
    }

    #[test]
    fn ids_are_unique() {
        let t1 = Title::new("A".to_string(), 0);
        let t2 = Title::new("B".to_string(), 1);
        assert_ne!(t1.id, t2.id);
    }

    #[test]
    fn title_fields_initialise_correctly() {
        let title = Title::new("Test Title".to_string(), 3);
        assert_eq!(title.name, "Test Title");
        assert_eq!(title.order_index, 3);
        assert!(title.source_asset_id.is_none());
        assert!(title.video_mapping.is_none());
        assert!(title.chapters.is_empty());
        assert!(title.audio_mappings.is_empty());
    }

    #[test]
    fn pal_project_round_trips() {
        let mut project = SpindleProjectFile::default();
        project.disc.standard = VideoStandard::Pal;
        project.disc.capacity_target = CapacityTarget::Dvd9;

        let json = serde_json::to_string(&project).unwrap();
        let parsed: SpindleProjectFile = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.disc.standard, VideoStandard::Pal);
        assert_eq!(parsed.disc.capacity_target, CapacityTarget::Dvd9);
    }

    #[test]
    fn audio_output_targets_serialise_as_uppercase() {
        assert_eq!(
            serde_json::to_string(&AudioOutputTarget::Ac3).unwrap(),
            "\"AC3\""
        );
        assert_eq!(
            serde_json::to_string(&AudioOutputTarget::Lpcm).unwrap(),
            "\"LPCM\""
        );
        assert_eq!(
            serde_json::to_string(&AudioOutputTarget::Mp2).unwrap(),
            "\"MP2\""
        );
        assert_eq!(
            serde_json::to_string(&AudioOutputTarget::Dts).unwrap(),
            "\"DTS\""
        );
    }

    #[test]
    fn build_settings_default_is_conservative() {
        let settings = BuildSettings::default();
        assert!(!settings.generate_iso);
        assert_eq!(settings.safety_margin_bytes, 50_000_000);
        assert_eq!(
            settings.allocation_strategy,
            AllocationStrategy::DurationWeighted
        );
    }

    #[test]
    fn menu_migration_lifts_legacy_fields() {
        let mut menu = Menu {
            id: "menu-1".to_string(),
            name: "Main Menu".to_string(),
            background_asset_id: Some("asset-1".to_string()),
            buttons: vec![MenuButton {
                id: "btn-1".to_string(),
                label: "Play".to_string(),
                bounds: ButtonBounds {
                    x: 100.0,
                    y: 200.0,
                    width: 300.0,
                    height: 50.0,
                },
                action: Some(PlaybackAction::PlayTitle {
                    title_id: "title-1".to_string(),
                }),
                nav_up: None,
                nav_down: None,
                nav_left: None,
                nav_right: None,
                highlight_mode: HighlightMode::Static,
                highlight_keyframes: Vec::new(),
                video_asset_id: None,
            }],
            default_button_id: Some("btn-1".to_string()),
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::Still,
            motion_duration_secs: Some(10.0),
            motion_audio_asset_id: None,
            motion_loop_count: 0,
            timeout_action: None,
            authored_document: None,
        };

        menu.migrate_to_document(MenuDomain::Vmgm, VideoStandard::Ntsc);

        let doc = menu.authored_document.expect("should have migrated");
        assert_eq!(doc.id, "menu-1");
        assert_eq!(doc.name, "Main Menu");
        assert_eq!(doc.domain, MenuDomain::Vmgm);
        assert_eq!(doc.scene.background.asset_id, Some("asset-1".to_string()));
        assert_eq!(doc.scene.nodes.len(), 1);

        if let SceneNode::Button {
            id,
            label,
            x,
            y,
            width,
            height,
            ..
        } = &doc.scene.nodes[0]
        {
            assert_eq!(id, "btn-1");
            assert_eq!(label, "Play");
            assert_eq!(*x, 100.0);
            assert_eq!(*y, 200.0);
            assert_eq!(*width, 300.0);
            assert_eq!(*height, 50.0);
        } else {
            panic!("expected button node");
        }

        assert_eq!(doc.interaction.nodes.len(), 1);
        assert_eq!(doc.interaction.nodes[0].node_id, "btn-1");
        assert_eq!(doc.timing.loop_duration_secs, 10.0);
    }
}
