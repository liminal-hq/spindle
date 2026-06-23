// Menu scene graph, navigation/interaction graph, and button/text styling.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{AspectMode, DiscFamily, PlaybackAction, VideoStandard};

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
        Self {
            width,
            height,
            aspect,
        }
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
        #[serde(default, rename = "fontSize", alias = "font_size")]
        font_size: Option<f64>,
        #[serde(default, rename = "fontFamily", alias = "font_family")]
        font_family: Option<String>,
        #[serde(default, rename = "fontWeight", alias = "font_weight")]
        font_weight: Option<FontWeight>,
        #[serde(default, rename = "fontItalic", alias = "font_italic")]
        font_italic: Option<bool>,
        #[serde(default, rename = "textDecoration", alias = "text_decoration")]
        text_decoration: Option<TextDecoration>,
        #[serde(default, rename = "textAlign", alias = "text_align")]
        text_align: Option<TextAlign>,
        #[serde(default)]
        colour: Option<String>,
        #[serde(default, rename = "lineHeight", alias = "line_height")]
        line_height: Option<f64>,
        #[serde(default, rename = "letterSpacing", alias = "letter_spacing")]
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
        #[serde(default, rename = "highlightMode", alias = "highlight_mode")]
        highlight_mode: HighlightMode,
        #[serde(default, rename = "highlightKeyframes", alias = "highlight_keyframes")]
        highlight_keyframes: Vec<HighlightKeyframe>,
        #[serde(default, rename = "videoAssetId", alias = "video_asset_id")]
        video_asset_id: Option<String>,
        #[serde(default, rename = "buttonStyle", alias = "button_style")]
        button_style: Option<ButtonStyleMap>,
        #[serde(default, rename = "labelStyle", alias = "label_style")]
        label_style: Option<TextStyle>,
    },
    ComponentInstance {
        id: String,
        #[serde(rename = "componentId", alias = "component_id")]
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
