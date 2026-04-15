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
        let global_display_aspect = self.inferred_vmgm_menu_aspect();
        let titleset_display_aspects: Vec<_> = (0..self.disc.titlesets.len())
            .map(|index| self.inferred_titleset_menu_aspect(index))
            .collect();
        for menu in &mut self.disc.global_menus {
            menu.migrate_to_document(MenuDomain::Vmgm, standard, global_display_aspect);
            menu.ensure_authored_compile_defaults(global_display_aspect);
            menu.backfill_design_size_aspect(global_display_aspect);
        }
        for (titleset_index, titleset) in self.disc.titlesets.iter_mut().enumerate() {
            let display_aspect = titleset_display_aspects[titleset_index];
            for menu in &mut titleset.menus {
                menu.migrate_to_document(MenuDomain::Titleset, standard, display_aspect);
                menu.ensure_authored_compile_defaults(display_aspect);
                menu.backfill_design_size_aspect(display_aspect);
            }
        }
    }

    pub fn inferred_vmgm_menu_aspect(&self) -> AspectMode {
        self.disc
            .titlesets
            .iter()
            .flat_map(|titleset| titleset.titles.iter())
            .find_map(|title| title.video_output_profile.map(|profile| profile.aspect))
            .unwrap_or(AspectMode::SixteenByNine)
    }

    pub fn inferred_titleset_menu_aspect(&self, titleset_index: usize) -> AspectMode {
        self.disc
            .titlesets
            .get(titleset_index)
            .and_then(|titleset| {
                titleset
                    .titles
                    .iter()
                    .find_map(|title| title.video_output_profile.map(|profile| profile.aspect))
            })
            .unwrap_or_else(|| self.inferred_vmgm_menu_aspect())
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

/// Disc format family. Controls raster dimensions, SAR, overlay mechanism, and minimum font size.
///
/// `DvdVideo` is fully supported end-to-end. `BluRay`, `Svcd`, and `Vcd` are wired in the model
/// and Skia render pipeline but are not exposed in the UI format picker — use
/// `is_ui_supported()` to gate UI controls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiscFamily {
    /// DVD-Video: MPEG-2 encode, spumux subpicture overlays. Fully supported.
    DvdVideo,
    /// Blu-ray Disc: square-pixel 1920×1080, full-colour PNG IG streams. Model and render only.
    BluRay,
    /// Super Video CD: limited overlay support. Model and render only.
    Svcd,
    /// Video CD: no standardised overlay. Model and render only.
    Vcd,
}

impl DiscFamily {
    /// Returns `true` only for formats that are fully supported in the UI.
    /// New variants are model-only until their authoring and render pipelines are complete.
    pub fn is_ui_supported(&self) -> bool {
        matches!(self, DiscFamily::DvdVideo)
    }
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AspectMode {
    FourByThree,
    #[default]
    SixteenByNine,
}

/// Render-time parameters derived from project disc settings. Not stored in the project file.
///
/// `RenderTarget` is computed once via `from_disc()` and threaded through the Skia renderer and
/// ffmpeg pipeline. It captures everything the renderer needs: raster dimensions, SAR, disc family
/// (which determines overlay strategy and minimum font size), and video standard.
///
/// Display width for DAR-corrected output = `raster_width × sar_num / sar_den`.
#[derive(Debug, Clone, Copy)]
pub struct RenderTarget {
    pub family: DiscFamily,
    /// `None` for Blu-ray (no NTSC/PAL distinction at this level).
    pub standard: Option<VideoStandard>,
    pub raster_width: u32,
    pub raster_height: u32,
    pub sar_num: u32,
    pub sar_den: u32,
}

impl RenderTarget {
    /// Derive a render target from the disc's family, video standard, and display aspect.
    pub fn from_disc(disc: &Disc, aspect: AspectMode) -> Self {
        match disc.family {
            DiscFamily::DvdVideo => {
                let (width, height) = VideoRaster::FullD1.resolution(disc.standard);
                let (dar_num, dar_den) = match aspect {
                    AspectMode::FourByThree => (4u64, 3u64),
                    AspectMode::SixteenByNine => (16u64, 9u64),
                };
                // SAR = (DAR_num * height) / (DAR_den * width), reduced by GCD.
                let mut num = dar_num * height as u64;
                let mut den = dar_den * width as u64;
                let g = gcd_u64(num, den);
                num /= g;
                den /= g;
                Self {
                    family: DiscFamily::DvdVideo,
                    standard: Some(disc.standard),
                    raster_width: width,
                    raster_height: height,
                    sar_num: num as u32,
                    sar_den: den as u32,
                }
            }
            DiscFamily::BluRay => Self {
                family: DiscFamily::BluRay,
                standard: None,
                raster_width: 1920,
                raster_height: 1080,
                sar_num: 1,
                sar_den: 1,
            },
            DiscFamily::Svcd => {
                let (width, height) = match disc.standard {
                    VideoStandard::Ntsc => (480u32, 480u32),
                    VideoStandard::Pal => (480u32, 576u32),
                };
                // SVCD SAR (4:3 only): 15:11
                Self {
                    family: DiscFamily::Svcd,
                    standard: Some(disc.standard),
                    raster_width: width,
                    raster_height: height,
                    sar_num: 15,
                    sar_den: 11,
                }
            }
            DiscFamily::Vcd => {
                let (width, height) = match disc.standard {
                    VideoStandard::Ntsc => (352u32, 240u32),
                    VideoStandard::Pal => (352u32, 288u32),
                };
                // VCD SAR (4:3 only): 10:11
                Self {
                    family: DiscFamily::Vcd,
                    standard: Some(disc.standard),
                    raster_width: width,
                    raster_height: height,
                    sar_num: 10,
                    sar_den: 11,
                }
            }
        }
    }

    /// SAR as an ffmpeg `setsar` string (e.g. `"10/11"`).
    pub fn sar_string(&self) -> String {
        format!("{}/{}", self.sar_num, self.sar_den)
    }
}

fn gcd_u64(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        let tmp = b;
        b = a % b;
        a = tmp;
    }
    a.max(1)
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
    pub fn migrate_to_document(
        &mut self,
        domain: MenuDomain,
        standard: VideoStandard,
        display_aspect: AspectMode,
    ) {
        if self.authored_document.is_some() {
            return;
        }

        let (res_w, res_h) = standard.default_resolution();

        let scene = MenuScene {
            design_size: MenuSize {
                width: res_w,
                height: res_h,
                aspect: display_aspect,
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
                    button_style: None,
                    label_style: None,
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
            intro_start_secs: 0.0,
            intro_duration_secs: 0.0,
            loop_start_secs: 0.0,
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
                display_aspect: Some(display_aspect),
                safe_area_mode: SafeAreaMode::ActionSafe,
                palette_strategy: PaletteStrategy::Auto,
            },
        });
    }

    pub fn ensure_authored_compile_defaults(&mut self, display_aspect: AspectMode) {
        if let Some(doc) = &mut self.authored_document {
            if doc.compile_policy.display_aspect.is_none() {
                doc.compile_policy.display_aspect = Some(display_aspect);
            }
        }
    }

    /// Back-fill `design_size.aspect` on existing authored documents where the field
    /// was absent (old project files deserialise it as the default `SixteenByNine`).
    /// We overwrite only when the compile policy has an explicit display aspect that
    /// differs, so we don't clobber intentionally authored values.
    pub fn backfill_design_size_aspect(&mut self, display_aspect: AspectMode) {
        if let Some(doc) = &mut self.authored_document {
            let policy_aspect = doc.compile_policy.display_aspect.unwrap_or(display_aspect);
            if doc.scene.design_size.aspect != policy_aspect {
                doc.scene.design_size.aspect = policy_aspect;
            }
        }
    }

    pub fn resolved_background_asset_id(&self) -> Option<&str> {
        self.authored_document
            .as_ref()
            .and_then(|doc| doc.scene.background.asset_id.as_deref())
            .or(self.background_asset_id.as_deref())
    }

    pub fn resolved_background_mode(&self) -> BackgroundMode {
        self.authored_document
            .as_ref()
            .map(|doc| doc.background_mode)
            .unwrap_or(self.background_mode)
    }

    pub fn resolved_motion_duration_secs(&self) -> Option<f64> {
        self.authored_document
            .as_ref()
            .map(|doc| doc.timing.loop_duration_secs)
            .or(self.motion_duration_secs)
    }

    pub fn resolved_motion_loop_start_secs(&self) -> Option<f64> {
        self.authored_document
            .as_ref()
            .map(|doc| doc.timing.loop_start_secs)
            .or_else(|| (self.background_mode == BackgroundMode::Motion).then_some(0.0))
    }

    pub fn resolved_motion_audio_asset_id(&self) -> Option<&str> {
        self.motion_audio_asset_id.as_deref()
    }

    pub fn authored_display_aspect(&self) -> Option<AspectMode> {
        self.authored_document
            .as_ref()
            .and_then(|doc| doc.compile_policy.display_aspect)
    }

    pub fn resolved_display_aspect(&self, fallback: AspectMode) -> AspectMode {
        self.authored_display_aspect().unwrap_or(fallback)
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

/// Design-space canvas size for a menu, expressed in square-pixel display-aspect coordinates.
///
/// The Skia renderer scales these dimensions to the raster target at build time:
/// `scale_x = raster_width / width`, `scale_y = raster_height / height`.
/// All scene node coordinates are stored in this space and are only rounded to integers
/// at render time.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuSize {
    pub width: f64,
    pub height: f64,
    /// Display aspect for this design canvas. Defaults to `SixteenByNine` for
    /// compatibility with project files written before this field existed.
    #[serde(default)]
    pub aspect: AspectMode,
}


impl Default for MenuSize {
    fn default() -> Self {
        Self::default_for(DiscFamily::DvdVideo, AspectMode::SixteenByNine)
    }
}

impl MenuSize {
    /// Default design-space canvas dimensions for a given disc family and aspect mode.
    pub fn default_for(family: DiscFamily, aspect: AspectMode) -> Self {
        let (width, height) = match (family, aspect) {
            (DiscFamily::DvdVideo, AspectMode::FourByThree) => (1024.0, 768.0),
            (DiscFamily::DvdVideo, AspectMode::SixteenByNine) => (1024.0, 576.0),
            (DiscFamily::BluRay, _) => (1920.0, 1080.0),
            (DiscFamily::Svcd, _) => (800.0, 600.0),
            (DiscFamily::Vcd, _) => (704.0, 528.0),
        };
        Self { width, height, aspect }
    }
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
#[allow(clippy::large_enum_variant)]
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
        #[serde(default, alias = "font_size")]
        font_size: Option<f64>,
        #[serde(default, alias = "font_family")]
        font_family: Option<String>,
        #[serde(default, alias = "font_weight")]
        font_weight: Option<FontWeight>,
        #[serde(default, alias = "font_italic")]
        font_italic: Option<bool>,
        #[serde(default, alias = "text_decoration")]
        text_decoration: Option<TextDecoration>,
        #[serde(default, alias = "text_align")]
        text_align: Option<TextAlign>,
        #[serde(default)]
        colour: Option<String>,
        #[serde(default, alias = "line_height")]
        line_height: Option<f64>,
        #[serde(default, alias = "letter_spacing")]
        letter_spacing: Option<f64>,
    },
    Image {
        id: String,
        #[serde(rename = "assetId", alias = "asset_id")]
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
        #[serde(rename = "assetId", alias = "asset_id")]
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
        #[serde(default, alias = "highlight_mode")]
        highlight_mode: HighlightMode,
        #[serde(default, alias = "highlight_keyframes")]
        highlight_keyframes: Vec<HighlightKeyframe>,
        #[serde(default, alias = "video_asset_id")]
        video_asset_id: Option<String>,
        #[serde(default, alias = "button_style")]
        button_style: Option<ButtonStyleMap>,
        #[serde(default, alias = "label_style")]
        label_style: Option<TextStyle>,
    },
    ComponentInstance {
        id: String,
        #[serde(alias = "component_id")]
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
    #[serde(default)]
    pub intro_start_secs: f64,
    pub intro_duration_secs: f64,
    #[serde(default)]
    pub loop_start_secs: f64,
    pub loop_duration_secs: f64,
    pub loop_count: u32, // 0 = infinite
}

impl Default for MenuTiming {
    fn default() -> Self {
        Self {
            intro_start_secs: 0.0,
            intro_duration_secs: 0.0,
            loop_start_secs: 0.0,
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
    pub display_aspect: Option<AspectMode>,
    pub safe_area_mode: SafeAreaMode,
    pub palette_strategy: PaletteStrategy,
}

impl Default for MenuCompilePolicy {
    fn default() -> Self {
        Self {
            display_aspect: None,
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

// ── Button & Text Style ─────────────────────────────────────────────────────

/// Legal shadow types for authored button styling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ButtonShadowType {
    #[default]
    None,
    BoxShadow,
    OuterGlow,
    InnerGlow,
}

/// Per-state visual appearance for a button node (authored layer only).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonStateStyle {
    pub bg_fill: String,
    pub border_colour: String,
    pub border_width: f64,
    pub border_radius: f64,
    pub padding_h: f64,
    pub padding_v: f64,
    pub shadow_type: ButtonShadowType,
    pub shadow_colour: String,
    pub shadow_blur: f64,
    pub shadow_spread: f64,
}

impl Default for ButtonStateStyle {
    fn default() -> Self {
        Self {
            bg_fill: "rgba(255, 255, 255, 0.04)".to_string(),
            border_colour: "rgba(255, 255, 255, 0.12)".to_string(),
            border_width: 1.5,
            border_radius: 6.0,
            padding_h: 16.0,
            padding_v: 0.0,
            shadow_type: ButtonShadowType::None,
            shadow_colour: "transparent".to_string(),
            shadow_blur: 0.0,
            shadow_spread: 0.0,
        }
    }
}

/// The three interactive states for a button.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonStyleMap {
    pub normal: ButtonStateStyle,
    pub focus: ButtonStateStyle,
    pub activate: ButtonStateStyle,
}

/// Typography style shared by button labels and standalone text nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    pub font_family: String,
    pub font_size: f64,
    pub font_weight: FontWeight,
    pub font_italic: bool,
    pub text_decoration: TextDecoration,
    pub text_align: TextAlign,
    pub colour: String,
    pub line_height: f64,
    pub letter_spacing: f64,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            font_family: "Inter".to_string(),
            font_size: 14.0,
            font_weight: FontWeight::Normal,
            font_italic: false,
            text_decoration: TextDecoration::None,
            text_align: TextAlign::Left,
            colour: "#ffffff".to_string(),
            line_height: 1.4,
            letter_spacing: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum FontWeight {
    #[default]
    Normal,
    Bold,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TextDecoration {
    #[default]
    None,
    Underline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
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
    Return,
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

    pub fn is_still_image(&self) -> bool {
        let extension = std::path::Path::new(&self.file_name)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase());

        if let Some(extension) = extension.as_deref() {
            if matches!(extension, "png" | "jpg" | "jpeg" | "bmp" | "tif" | "tiff") {
                return true;
            }
        }

        self.container_format
            .as_deref()
            .map(|format| matches!(format, "png_pipe" | "image2"))
            .unwrap_or(false)
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
    fn return_action_serialises_as_unit_variant() {
        let action = PlaybackAction::Return;
        let json = serde_json::to_string(&action).unwrap();
        assert_eq!(json, "{\"type\":\"return\"}");
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

        menu.migrate_to_document(
            MenuDomain::Vmgm,
            VideoStandard::Ntsc,
            AspectMode::FourByThree,
        );

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
        assert_eq!(
            doc.compile_policy.display_aspect,
            Some(AspectMode::FourByThree)
        );
    }

    #[test]
    fn legacy_authored_menu_document_deserialises() {
        let json = r##"
        {
          "schemaVersion": 1,
          "project": {
            "id": "project-1",
            "name": "Legacy Menu Project",
            "createdAt": "2026-04-01T00:00:00Z",
            "modifiedAt": "2026-04-01T00:00:00Z"
          },
          "disc": {
            "family": "dvd-video",
            "standard": "NTSC",
            "capacityTarget": "DVD5",
            "firstPlayAction": null,
            "titlesets": [
              {
                "id": "titleset-1",
                "name": "Titleset 1",
                "titles": [],
                "menus": [
                  {
                    "id": "menu-1",
                    "name": "Main Menu",
                    "backgroundAssetId": null,
                    "buttons": [],
                    "defaultButtonId": "btn-1",
                    "highlightColours": {
                      "selectColour": "#ffaa40",
                      "selectOpacity": 0.6,
                      "activateColour": "#ffffff",
                      "activateOpacity": 0.8
                    },
                    "backgroundMode": "still",
                    "motionDurationSecs": null,
                    "motionAudioAssetId": null,
                    "motionLoopCount": 0,
                    "timeoutAction": null,
                    "authoredDocument": {
                      "id": "menu-1",
                      "name": "Main Menu",
                      "domain": "titleset",
                      "scene": {
                        "designSize": {
                          "width": 720.0,
                          "height": 480.0
                        },
                        "background": {
                          "assetId": null,
                          "colour": "#101014"
                        },
                        "nodes": [
                          {
                            "type": "button",
                            "id": "btn-1",
                            "label": "Play",
                            "x": 100.0,
                            "y": 200.0,
                            "width": 240.0,
                            "height": 48.0,
                            "highlight_mode": "static",
                            "highlight_keyframes": [],
                            "video_asset_id": null
                          }
                        ],
                        "guides": []
                      },
                      "interaction": {
                        "defaultFocusId": "btn-1",
                        "nodes": [
                          {
                            "nodeId": "btn-1",
                            "navUp": null,
                            "navDown": null,
                            "navLeft": null,
                            "navRight": null,
                            "action": {
                              "type": "return"
                            }
                          }
                        ],
                        "timeoutAction": null
                      },
                      "timing": {
                        "introDurationSecs": 0.0,
                        "loopDurationSecs": 0.0,
                        "loopCount": 0
                      },
                      "highlightColours": {
                        "selectColour": "#ffaa40",
                        "selectOpacity": 0.6,
                        "activateColour": "#ffffff",
                        "activateOpacity": 0.8
                      },
                      "backgroundMode": "still",
                      "themeRef": null,
                      "generationMeta": null,
                      "compilePolicy": {
                        "safeAreaMode": "action-safe",
                        "paletteStrategy": "auto"
                      }
                    }
                  }
                ]
              }
            ],
            "globalMenus": []
          },
          "assets": [],
          "buildSettings": {
            "outputDirectory": null,
            "generateIso": false,
            "safetyMarginBytes": 50000000,
            "allocationStrategy": "duration-weighted"
          }
        }
        "##;

        let parsed: SpindleProjectFile = serde_json::from_str(json).unwrap();
        let doc = &parsed.disc.titlesets[0].menus[0]
            .authored_document
            .as_ref()
            .expect("legacy authored document should load");

        assert_eq!(doc.timing.intro_start_secs, 0.0);
        assert_eq!(doc.timing.loop_start_secs, 0.0);
        assert_eq!(doc.compile_policy.display_aspect, None);

        match &doc.scene.nodes[0] {
            SceneNode::Button {
                highlight_mode,
                highlight_keyframes,
                video_asset_id,
                ..
            } => {
                assert_eq!(*highlight_mode, HighlightMode::Static);
                assert!(highlight_keyframes.is_empty());
                assert!(video_asset_id.is_none());
            }
            other => panic!("expected button node, found {other:?}"),
        }
    }

    #[test]
    fn styled_scene_nodes_round_trip_through_json() {
        let project = SpindleProjectFile {
            disc: Disc {
                titlesets: vec![Titleset {
                    menus: vec![Menu {
                        id: "menu-1".to_string(),
                        name: "Styled Menu".to_string(),
                        authored_document: Some(MenuDocument {
                            id: "menu-1".to_string(),
                            name: "Styled Menu".to_string(),
                            domain: MenuDomain::Titleset,
                            scene: MenuScene {
                                design_size: MenuSize {
                                    width: 720.0,
                                    height: 480.0,
                                    aspect: AspectMode::SixteenByNine,
                                },
                                background: SceneBackground {
                                    asset_id: None,
                                    colour: Some("#101014".to_string()),
                                },
                                nodes: vec![
                                    SceneNode::Text {
                                        id: "text-1".to_string(),
                                        content: "Hello".to_string(),
                                        x: 24.0,
                                        y: 36.0,
                                        width: 320.0,
                                        height: 64.0,
                                        font_size: Some(28.0),
                                        font_family: Some("Aptos".to_string()),
                                        font_weight: Some(FontWeight::Bold),
                                        font_italic: Some(true),
                                        text_decoration: Some(TextDecoration::Underline),
                                        text_align: Some(TextAlign::Center),
                                        colour: Some("#ffeeaa".to_string()),
                                        line_height: Some(1.2),
                                        letter_spacing: Some(0.5),
                                    },
                                    SceneNode::Button {
                                        id: "button-1".to_string(),
                                        label: "Play".to_string(),
                                        x: 96.0,
                                        y: 192.0,
                                        width: 220.0,
                                        height: 52.0,
                                        highlight_mode: HighlightMode::Animated,
                                        highlight_keyframes: vec![HighlightKeyframe {
                                            timestamp_secs: 0.25,
                                            select_colour: Some("#ffaa40".to_string()),
                                            select_opacity: Some(0.8),
                                            activate_colour: None,
                                            activate_opacity: None,
                                        }],
                                        video_asset_id: Some("asset-1".to_string()),
                                        button_style: Some(ButtonStyleMap::default()),
                                        label_style: Some(TextStyle::default()),
                                    },
                                    SceneNode::Image {
                                        id: "image-1".to_string(),
                                        asset_id: "asset-image".to_string(),
                                        x: 420.0,
                                        y: 72.0,
                                        width: 180.0,
                                        height: 120.0,
                                    },
                                ],
                                guides: vec![],
                            },
                            interaction: MenuInteractionGraph {
                                default_focus_id: Some("button-1".to_string()),
                                nodes: vec![],
                                timeout_action: None,
                            },
                            timing: MenuTiming::default(),
                            highlight_colours: MenuHighlightColours::default(),
                            background_mode: BackgroundMode::Still,
                            theme_ref: None,
                            generation_meta: None,
                            compile_policy: MenuCompilePolicy::default(),
                        }),
                        ..Menu::default()
                    }],
                    ..Titleset::default()
                }],
                ..Disc::default()
            },
            ..SpindleProjectFile::default()
        };

        let json = serde_json::to_string(&project).unwrap();
        let parsed: SpindleProjectFile = serde_json::from_str(&json).unwrap();
        let doc = parsed.disc.titlesets[0].menus[0]
            .authored_document
            .as_ref()
            .expect("styled document should persist");

        match &doc.scene.nodes[0] {
            SceneNode::Text {
                font_family,
                font_weight,
                font_italic,
                text_decoration,
                text_align,
                line_height,
                letter_spacing,
                ..
            } => {
                assert_eq!(font_family.as_deref(), Some("Aptos"));
                assert_eq!(*font_weight, Some(FontWeight::Bold));
                assert_eq!(*font_italic, Some(true));
                assert_eq!(*text_decoration, Some(TextDecoration::Underline));
                assert_eq!(*text_align, Some(TextAlign::Center));
                assert_eq!(*line_height, Some(1.2));
                assert_eq!(*letter_spacing, Some(0.5));
            }
            other => panic!("expected text node, found {other:?}"),
        }

        match &doc.scene.nodes[1] {
            SceneNode::Button {
                button_style,
                label_style,
                highlight_mode,
                video_asset_id,
                ..
            } => {
                assert!(button_style.is_some());
                assert!(label_style.is_some());
                assert_eq!(*highlight_mode, HighlightMode::Animated);
                assert_eq!(video_asset_id.as_deref(), Some("asset-1"));
            }
            other => panic!("expected button node, found {other:?}"),
        }

        match &doc.scene.nodes[2] {
            SceneNode::Image { asset_id, .. } => {
                assert_eq!(asset_id, "asset-image");
            }
            other => panic!("expected image node, found {other:?}"),
        }
    }

    #[test]
    fn scene_image_nodes_accept_camel_case_asset_id() {
        let mut project = SpindleProjectFile::default();
        project.project.id = "project-1".to_string();
        project.project.name = "Image Menu".to_string();
        project.disc.global_menus.push(Menu {
            id: "menu-1".to_string(),
            name: "Main Menu".to_string(),
            authored_document: Some(MenuDocument {
                id: "menu-1".to_string(),
                name: "Main Menu".to_string(),
                domain: MenuDomain::Vmgm,
                scene: MenuScene {
                    design_size: MenuSize {
                        width: 720.0,
                        height: 480.0,
                        aspect: AspectMode::SixteenByNine,
                    },
                    background: SceneBackground {
                        asset_id: None,
                        colour: Some("#101014".to_string()),
                    },
                    nodes: vec![],
                    guides: vec![],
                },
                interaction: MenuInteractionGraph {
                    default_focus_id: None,
                    nodes: vec![],
                    timeout_action: None,
                },
                timing: MenuTiming::default(),
                highlight_colours: MenuHighlightColours::default(),
                background_mode: BackgroundMode::Still,
                theme_ref: None,
                generation_meta: None,
                compile_policy: MenuCompilePolicy::default(),
            }),
            ..Menu::default()
        });

        let mut value = serde_json::to_value(&project).unwrap();
        value["disc"]["globalMenus"][0]["authoredDocument"]["scene"]["nodes"] = serde_json::json!([
          {
            "type": "image",
            "id": "image-1",
            "assetId": "asset-image",
            "x": 96.0,
            "y": 72.0,
            "width": 180.0,
            "height": 120.0
          }
        ]);

        let parsed: SpindleProjectFile = serde_json::from_value(value).unwrap();

        match &parsed.disc.global_menus[0]
            .authored_document
            .as_ref()
            .expect("authored document should load")
            .scene
            .nodes[0]
        {
            SceneNode::Image { asset_id, .. } => assert_eq!(asset_id, "asset-image"),
            other => panic!("expected image node, found {other:?}"),
        }
    }

    #[test]
    fn disc_family_ui_support_gating() {
        assert!(DiscFamily::DvdVideo.is_ui_supported());
        assert!(!DiscFamily::BluRay.is_ui_supported());
        assert!(!DiscFamily::Svcd.is_ui_supported());
        assert!(!DiscFamily::Vcd.is_ui_supported());
    }

    #[test]
    fn render_target_dvd_ntsc_4by3() {
        // 720×480 raster, 4:3 DAR → SAR = (4×480)/(3×720) = 1920/2160 = 8/9
        let disc = Disc { family: DiscFamily::DvdVideo, standard: VideoStandard::Ntsc, ..Disc::default() };
        let target = RenderTarget::from_disc(&disc, AspectMode::FourByThree);
        assert_eq!(target.raster_width, 720);
        assert_eq!(target.raster_height, 480);
        assert_eq!((target.sar_num, target.sar_den), (8, 9));
    }

    #[test]
    fn render_target_dvd_ntsc_16by9() {
        // 720×480 raster, 16:9 DAR → SAR = (16×480)/(9×720) = 7680/6480 = 32/27
        let disc = Disc { family: DiscFamily::DvdVideo, standard: VideoStandard::Ntsc, ..Disc::default() };
        let target = RenderTarget::from_disc(&disc, AspectMode::SixteenByNine);
        assert_eq!(target.raster_width, 720);
        assert_eq!(target.raster_height, 480);
        assert_eq!((target.sar_num, target.sar_den), (32, 27));
    }

    #[test]
    fn render_target_dvd_pal_4by3() {
        // 720×576 raster, 4:3 DAR → SAR = (4×576)/(3×720) = 2304/2160 = 16/15
        let disc = Disc { family: DiscFamily::DvdVideo, standard: VideoStandard::Pal, ..Disc::default() };
        let target = RenderTarget::from_disc(&disc, AspectMode::FourByThree);
        assert_eq!(target.raster_width, 720);
        assert_eq!(target.raster_height, 576);
        assert_eq!((target.sar_num, target.sar_den), (16, 15));
    }

    #[test]
    fn render_target_bluray_is_square_pixels() {
        let disc = Disc { family: DiscFamily::BluRay, standard: VideoStandard::Ntsc, ..Disc::default() };
        let target = RenderTarget::from_disc(&disc, AspectMode::SixteenByNine);
        assert_eq!(target.raster_width, 1920);
        assert_eq!(target.raster_height, 1080);
        assert_eq!((target.sar_num, target.sar_den), (1, 1));
        assert!(target.standard.is_none());
    }

    #[test]
    fn menu_size_default_for_dvd_ntsc_4by3() {
        let size = MenuSize::default_for(DiscFamily::DvdVideo, AspectMode::FourByThree);
        assert_eq!(size.width, 1024.0);
        assert_eq!(size.height, 768.0);
        assert_eq!(size.aspect, AspectMode::FourByThree);
    }

    #[test]
    fn menu_size_default_for_dvd_ntsc_16by9() {
        let size = MenuSize::default_for(DiscFamily::DvdVideo, AspectMode::SixteenByNine);
        assert_eq!(size.width, 1024.0);
        assert_eq!(size.height, 576.0);
    }

    #[test]
    fn menu_size_default_for_bluray() {
        let size = MenuSize::default_for(DiscFamily::BluRay, AspectMode::SixteenByNine);
        assert_eq!(size.width, 1920.0);
        assert_eq!(size.height, 1080.0);
    }

    #[test]
    fn design_to_raster_scale_dvd_ntsc_16by9() {
        // MenuSize 1024×576 + DVD NTSC 16:9 → scale_x ≈ 0.703, scale_y ≈ 0.833
        let disc = Disc { family: DiscFamily::DvdVideo, standard: VideoStandard::Ntsc, ..Disc::default() };
        let target = RenderTarget::from_disc(&disc, AspectMode::SixteenByNine);
        let scale_x = target.raster_width as f64 / 1024.0;
        let scale_y = target.raster_height as f64 / 576.0;
        assert!((scale_x - 720.0 / 1024.0).abs() < 1e-9, "scale_x should be 720/1024, got {scale_x}");
        assert!((scale_y - 480.0 / 576.0).abs() < 1e-9, "scale_y should be 480/576, got {scale_y}");

        // A shape at design (100, 100) should map to raster (70, 83)
        let rx = (100.0 * scale_x).round() as i32;
        let ry = (100.0 * scale_y).round() as i32;
        assert_eq!(rx, 70);
        assert_eq!(ry, 83);
    }

    #[test]
    fn menu_size_aspect_defaults_to_sixteen_by_nine_on_deserialise() {
        // Old project files have no "aspect" field in designSize — should default to SixteenByNine.
        let json = r#"{"width": 720.0, "height": 480.0}"#;
        let size: MenuSize = serde_json::from_str(json).unwrap();
        assert_eq!(size.aspect, AspectMode::SixteenByNine);
    }

    #[test]
    fn migrate_all_menus_backfills_display_aspect_on_legacy_authored_documents() {
        let mut project = SpindleProjectFile::default();
        project.disc.titlesets[0].titles.push(Title {
            id: "title-1".to_string(),
            name: "Feature".to_string(),
            source_asset_id: None,
            video_mapping: None,
            video_output_profile: Some(VideoOutputProfile {
                raster: VideoRaster::FullD1,
                aspect: AspectMode::FourByThree,
            }),
            audio_mappings: vec![],
            subtitle_mappings: vec![],
            chapters: vec![],
            end_action: None,
            order_index: 0,
        });
        project.disc.titlesets[0].menus.push(Menu {
            id: "menu-1".to_string(),
            name: "Main Menu".to_string(),
            authored_document: Some(MenuDocument {
                id: "menu-1".to_string(),
                name: "Main Menu".to_string(),
                domain: MenuDomain::Titleset,
                scene: MenuScene {
                    design_size: MenuSize {
                        width: 720.0,
                        height: 480.0,
                        aspect: AspectMode::SixteenByNine,
                    },
                    background: SceneBackground {
                        asset_id: None,
                        colour: Some("#101014".to_string()),
                    },
                    nodes: vec![],
                    guides: vec![],
                },
                interaction: MenuInteractionGraph {
                    default_focus_id: None,
                    nodes: vec![],
                    timeout_action: None,
                },
                timing: MenuTiming::default(),
                highlight_colours: MenuHighlightColours::default(),
                background_mode: BackgroundMode::Still,
                theme_ref: None,
                generation_meta: None,
                compile_policy: MenuCompilePolicy::default(),
            }),
            ..Menu::default()
        });

        project.migrate_all_menus();

        let doc = project.disc.titlesets[0].menus[0]
            .authored_document
            .as_ref()
            .expect("menu should retain authored document");
        assert_eq!(
            doc.compile_policy.display_aspect,
            Some(AspectMode::FourByThree)
        );
    }
}
