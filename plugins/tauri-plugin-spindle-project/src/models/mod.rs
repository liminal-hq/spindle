// Defines the serialisable project schema for Spindle disc authoring projects.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

mod asset;
mod build_settings;
mod disc;
mod menu;
mod render_target;
mod title;

pub use asset::*;
pub use build_settings::*;
pub use disc::*;
pub use menu::*;
pub use render_target::*;
pub use title::*;

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

// ── Shared cross-domain types ───────────────────────────────────────────────

/// Aspect ratio presentation mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AspectMode {
    FourByThree,
    #[default]
    SixteenByNine,
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
    /// Advance to the next title in the same titleset. Expands to a `PlayTitle`
    /// action targeting the next `order_index` title at authoring time.
    /// No-ops (treated as `Stop`) if this is already the last title.
    /// DVD-only: Blu-ray can use native branching instead.
    PlayNextInTitleset,
    /// Play all titles in the current titleset in `order_index` order.
    /// Expands at authoring time to a `Sequence` of `PlayTitle` actions.
    PlayAllInTitleset,
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

    /// Confirm that SceneNode serialises with camelCase keys (not snake_case),
    /// so that the TS frontend receives `fontFamily`, `fontSize`, etc.
    #[test]
    fn scene_node_text_serialises_camel_case_keys() {
        let node = SceneNode::Text {
            id: "t1".to_string(),
            content: "Hello".to_string(),
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 40.0,
            font_size: Some(18.0),
            font_family: Some("MathJax_Fraktur".to_string()),
            font_weight: Some(FontWeight::Bold),
            font_italic: Some(false),
            text_decoration: None,
            text_align: None,
            colour: Some("#ffffff".to_string()),
            line_height: None,
            letter_spacing: None,
        };

        let json = serde_json::to_string(&node).unwrap();
        assert!(
            json.contains("\"fontFamily\""),
            "expected camelCase fontFamily, got: {json}"
        );
        assert!(
            json.contains("\"fontSize\""),
            "expected camelCase fontSize, got: {json}"
        );
        assert!(
            !json.contains("\"font_family\""),
            "snake_case font_family must not appear: {json}"
        );
        assert!(
            !json.contains("\"font_size\""),
            "snake_case font_size must not appear: {json}"
        );
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
        let disc = Disc {
            family: DiscFamily::DvdVideo,
            standard: VideoStandard::Ntsc,
            ..Disc::default()
        };
        let target = RenderTarget::from_disc(&disc, AspectMode::FourByThree);
        assert_eq!(target.raster_width, 720);
        assert_eq!(target.raster_height, 480);
        assert_eq!((target.sar_num, target.sar_den), (8, 9));
    }

    #[test]
    fn render_target_dvd_ntsc_16by9() {
        // 720×480 raster, 16:9 DAR → SAR = (16×480)/(9×720) = 7680/6480 = 32/27
        let disc = Disc {
            family: DiscFamily::DvdVideo,
            standard: VideoStandard::Ntsc,
            ..Disc::default()
        };
        let target = RenderTarget::from_disc(&disc, AspectMode::SixteenByNine);
        assert_eq!(target.raster_width, 720);
        assert_eq!(target.raster_height, 480);
        assert_eq!((target.sar_num, target.sar_den), (32, 27));
    }

    #[test]
    fn render_target_dvd_pal_4by3() {
        // 720×576 raster, 4:3 DAR → SAR = (4×576)/(3×720) = 2304/2160 = 16/15
        let disc = Disc {
            family: DiscFamily::DvdVideo,
            standard: VideoStandard::Pal,
            ..Disc::default()
        };
        let target = RenderTarget::from_disc(&disc, AspectMode::FourByThree);
        assert_eq!(target.raster_width, 720);
        assert_eq!(target.raster_height, 576);
        assert_eq!((target.sar_num, target.sar_den), (16, 15));
    }

    #[test]
    fn render_target_bluray_is_square_pixels() {
        let disc = Disc {
            family: DiscFamily::BluRay,
            standard: VideoStandard::Ntsc,
            ..Disc::default()
        };
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
        let disc = Disc {
            family: DiscFamily::DvdVideo,
            standard: VideoStandard::Ntsc,
            ..Disc::default()
        };
        let target = RenderTarget::from_disc(&disc, AspectMode::SixteenByNine);
        let scale_x = target.raster_width as f64 / 1024.0;
        let scale_y = target.raster_height as f64 / 576.0;
        assert!(
            (scale_x - 720.0 / 1024.0).abs() < 1e-9,
            "scale_x should be 720/1024, got {scale_x}"
        );
        assert!(
            (scale_y - 480.0 / 576.0).abs() < 1e-9,
            "scale_y should be 480/576, got {scale_y}"
        );

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
            bitrate_weight: 1.0,
            bitrate_floor_bps: None,
            bitrate_ceiling_bps: None,
            pinned_bitrate_bps: None,
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
