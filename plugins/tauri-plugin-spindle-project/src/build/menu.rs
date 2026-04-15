// Menu authoring helpers for rendered DVD menus.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashMap;
use std::path::Path;

use crate::models::*;

use super::ffmpeg::fps_rational_str;
use super::skia::render_menu_overlay_image_skia;
use super::types::MenuOverlayButton;
use super::util::{sanitise_filename, xml_escape};

#[derive(Clone, Copy)]
pub(crate) enum MenuDomain {
    Vmgm,
    Titleset(usize),
}

pub(crate) struct AuthorableMenuRef<'a> {
    pub(crate) menu: &'a Menu,
    pub(crate) domain: MenuDomain,
}

impl<'a> AuthorableMenuRef<'a> {
    pub(crate) fn name(&self) -> &str {
        self.menu
            .authored_document
            .as_ref()
            .map(|doc| doc.name.as_str())
            .unwrap_or(self.menu.name.as_str())
    }

    pub(crate) fn background_asset_id(&self) -> Option<&str> {
        self.menu.resolved_background_asset_id()
    }

    pub(crate) fn highlight_colours(&self) -> &MenuHighlightColours {
        self.menu
            .authored_document
            .as_ref()
            .map(|doc| &doc.highlight_colours)
            .unwrap_or(&self.menu.highlight_colours)
    }

    #[allow(dead_code)]
    pub(crate) fn background_mode(&self) -> BackgroundMode {
        self.menu.resolved_background_mode()
    }

    #[allow(dead_code)]
    pub(crate) fn timeout_action(&self) -> Option<&PlaybackAction> {
        self.menu
            .authored_document
            .as_ref()
            .and_then(|doc| doc.interaction.timeout_action.as_ref())
            .or(self.menu.timeout_action.as_ref())
    }

    #[allow(dead_code)]
    pub(crate) fn motion_duration_secs(&self) -> Option<f64> {
        self.menu.resolved_motion_duration_secs()
    }

    #[allow(dead_code)]
    pub(crate) fn motion_loop_count(&self) -> u32 {
        self.menu
            .authored_document
            .as_ref()
            .map(|doc| doc.timing.loop_count)
            .unwrap_or(self.menu.motion_loop_count)
    }

    pub(crate) fn display_aspect(&self, project: &SpindleProjectFile) -> AspectMode {
        let fallback = inferred_menu_output_aspect(project, self.domain);
        self.menu.resolved_display_aspect(fallback)
    }

    pub(crate) fn buttons(&self) -> Vec<AuthorableButtonRef<'_>> {
        if let Some(doc) = &self.menu.authored_document {
            doc.scene
                .nodes
                .iter()
                .filter_map(|node| {
                    if let SceneNode::Button {
                        id,
                        label,
                        x,
                        y,
                        width,
                        height,
                        ..
                    } = node
                    {
                        let interaction = doc.interaction.nodes.iter().find(|f| f.node_id == *id);

                        Some(AuthorableButtonRef {
                            id,
                            label,
                            x: *x,
                            y: *y,
                            width: *width,
                            height: *height,
                            action: interaction.and_then(|f| f.action.as_ref()),
                            nav_up: interaction.and_then(|f| f.nav_up.as_deref()),
                            nav_down: interaction.and_then(|f| f.nav_down.as_deref()),
                            nav_left: interaction.and_then(|f| f.nav_left.as_deref()),
                            nav_right: interaction.and_then(|f| f.nav_right.as_deref()),
                        })
                    } else {
                        None
                    }
                })
                .collect()
        } else {
            self.menu
                .buttons
                .iter()
                .map(|b| AuthorableButtonRef {
                    id: &b.id,
                    label: &b.label,
                    x: b.bounds.x,
                    y: b.bounds.y,
                    width: b.bounds.width,
                    height: b.bounds.height,
                    action: b.action.as_ref(),
                    nav_up: b.nav_up.as_deref(),
                    nav_down: b.nav_down.as_deref(),
                    nav_left: b.nav_left.as_deref(),
                    nav_right: b.nav_right.as_deref(),
                })
                .collect()
        }
    }

    pub(crate) fn default_button_id(&self) -> Option<&str> {
        self.menu
            .authored_document
            .as_ref()
            .and_then(|doc| doc.interaction.default_focus_id.as_deref())
            .or(self.menu.default_button_id.as_deref())
    }

    pub(crate) fn scene_nodes(&self) -> Vec<&SceneNode> {
        self.menu
            .authored_document
            .as_ref()
            .map(|doc| doc.scene.nodes.iter().collect())
            .unwrap_or_default()
    }
}

pub(crate) struct AuthorableButtonRef<'a> {
    pub(crate) id: &'a str,
    pub(crate) label: &'a str,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) action: Option<&'a PlaybackAction>,
    pub(crate) nav_up: Option<&'a str>,
    pub(crate) nav_down: Option<&'a str>,
    pub(crate) nav_left: Option<&'a str>,
    pub(crate) nav_right: Option<&'a str>,
}

pub(crate) fn authorable_menus(project: &SpindleProjectFile) -> Vec<AuthorableMenuRef<'_>> {
    let mut menus = Vec::new();
    for menu in &project.disc.global_menus {
        menus.push(AuthorableMenuRef {
            menu,
            domain: MenuDomain::Vmgm,
        });
    }
    for (titleset_index, titleset) in project.disc.titlesets.iter().enumerate() {
        for menu in &titleset.menus {
            menus.push(AuthorableMenuRef {
                menu,
                domain: MenuDomain::Titleset(titleset_index),
            });
        }
    }
    menus
}

pub(crate) fn inferred_menu_output_aspect(
    project: &SpindleProjectFile,
    domain: MenuDomain,
) -> AspectMode {
    match domain {
        MenuDomain::Vmgm => project.inferred_vmgm_menu_aspect(),
        MenuDomain::Titleset(index) => project.inferred_titleset_menu_aspect(index),
    }
}

/// Derive the path where the Skia scene PNG for a menu render will be written.
/// The PNG is placed alongside the output file with a `_scene.png` suffix.
pub(crate) fn menu_scene_png_path(output_path: &Path) -> std::path::PathBuf {
    let stem = output_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("menu");
    output_path
        .with_file_name(format!("{stem}_scene.png"))
}

pub(crate) fn build_ffmpeg_menu_command(
    ffmpeg_bin: &str,
    menu_ref: &AuthorableMenuRef<'_>,
    assets: &HashMap<&str, &Asset>,
    project: &SpindleProjectFile,
    standard: VideoStandard,
    output_path: &Path,
    scene_png_path: &Path,
) -> crate::Result<Vec<String>> {
    let aspect = menu_ref.display_aspect(project);
    let target = RenderTarget::from_disc(&project.disc, aspect);
    let width = target.raster_width;
    let height = target.raster_height;
    let sar = target.sar_string();

    let aspect_str = match aspect {
        AspectMode::FourByThree => "4:3",
        AspectMode::SixteenByNine => "16:9",
    };
    let fps = fps_rational_str(standard.frame_rate());

    let mut cmd = vec![ffmpeg_bin.to_string(), "-y".to_string()];
    let mut filter_complex_parts = Vec::new();
    let next_input_index;
    let background_label = "canvas0".to_string();

    if let Some(background_asset_id) = menu_ref.background_asset_id() {
        let asset = assets.get(background_asset_id).ok_or_else(|| {
            crate::Error::Build(format!(
                "Background asset not found for menu \"{}\"",
                menu_ref.name()
            ))
        })?;

        if asset.is_still_image() {
            cmd.extend([
                "-f".to_string(),
                "lavfi".to_string(),
                "-i".to_string(),
                format!("color=c=#101014:s={}x{}:d=1", width, height),
            ]);
            cmd.extend([
                "-loop".to_string(),
                "1".to_string(),
                "-i".to_string(),
                asset.source_path.clone(),
            ]);
            filter_complex_parts.push(format!(
                "[1:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2[background_fill]"
            ));
            filter_complex_parts.push(format!(
                "[0:v][background_fill]overlay=0:0[{background_label}]"
            ));
            next_input_index = 2;
        } else {
            cmd.extend(["-i".to_string(), asset.source_path.clone()]);
            filter_complex_parts.push(format!(
                "[0:v]fps={fps},scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,trim=start_frame=0:end_frame=1,loop=loop={}:size=1:start=0[{background_label}]",
                menu_loop_frame_count(standard).saturating_sub(1)
            ));
            next_input_index = 1;
        }
    } else {
        cmd.extend([
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            format!("color=c=#101014:s={}x{}:d=1", width, height),
        ]);
        filter_complex_parts.push(format!("[0:v]fps={fps}[{background_label}]"));
        next_input_index = 1;
    }

    // Add the pre-rendered Skia scene PNG as an input and composite it over the background.
    cmd.extend([
        "-loop".to_string(),
        "1".to_string(),
        "-i".to_string(),
        scene_png_path.display().to_string(),
    ]);
    let skia_input_index = next_input_index;

    filter_complex_parts.push(format!(
        "[{background_label}][{skia_input_index}:v]overlay=0:0,setsar={sar}[menuout]"
    ));

    cmd.extend([
        "-filter_complex".to_string(),
        filter_complex_parts.join(";"),
        "-map".to_string(),
        "[menuout]".to_string(),
        "-r".to_string(),
        fps.to_string(),
        "-c:v".to_string(),
        "mpeg2video".to_string(),
        "-b:v".to_string(),
        "4000k".to_string(),
        "-maxrate".to_string(),
        "7000k".to_string(),
        "-bufsize".to_string(),
        "1835k".to_string(),
        "-g".to_string(),
        if standard == VideoStandard::Pal {
            "12"
        } else {
            "18"
        }
        .to_string(),
        "-aspect".to_string(),
        aspect_str.to_string(),
        "-an".to_string(),
        "-t".to_string(),
        "1".to_string(),
        "-f".to_string(),
        "dvd".to_string(),
        "-muxrate".to_string(),
        "10080000".to_string(),
        output_path.display().to_string(),
    ]);

    Ok(cmd)
}

fn menu_loop_frame_count(standard: VideoStandard) -> u32 {
    match standard {
        VideoStandard::Ntsc => 30,
        VideoStandard::Pal => 25,
    }
}


pub(crate) fn generate_spumux_xml(
    menu_ref: &AuthorableMenuRef<'_>,
    standard: VideoStandard,
    menus_dir: &Path,
    scale_x: f64,
    scale_y: f64,
) -> String {
    let format_str = match standard {
        VideoStandard::Ntsc => "NTSC",
        VideoStandard::Pal => "PAL",
    };
    let base_name = sanitise_filename(menu_ref.menu.id.as_str());
    let highlight_path = menus_dir.join(format!("{base_name}_highlight.png"));
    let select_path = menus_dir.join(format!("{base_name}_select.png"));

    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str(&format!("<subpictures format=\"{format_str}\">\n"));
    xml.push_str("  <stream>\n");
    xml.push_str(&format!(
        "    <spu start=\"00:00:00.00\" image=\"{}\" highlight=\"{}\" select=\"{}\" transparent=\"#000000\" force=\"yes\">\n",
        xml_escape(&highlight_path.display().to_string()),
        xml_escape(&highlight_path.display().to_string()),
        xml_escape(&select_path.display().to_string())
    ));

    let buttons = menu_ref.buttons();
    for (index, button) in buttons.iter().enumerate() {
        let name = (index + 1).to_string();
        xml.push_str(&format!(
            "      <button name=\"{}\" x0=\"{}\" y0=\"{}\" x1=\"{}\" y1=\"{}\"{}{}{}{} />\n",
            name,
            (button.x * scale_x).round() as i32,
            (button.y * scale_y).round() as i32,
            ((button.x + button.width) * scale_x).round() as i32,
            ((button.y + button.height) * scale_y).round() as i32,
            button_nav_attr("up", button.nav_up, &buttons),
            button_nav_attr("down", button.nav_down, &buttons),
            button_nav_attr("left", button.nav_left, &buttons),
            button_nav_attr("right", button.nav_right, &buttons)
        ));
    }

    xml.push_str("    </spu>\n");
    xml.push_str("  </stream>\n");
    xml.push_str("</subpictures>\n");
    xml
}

fn button_nav_attr(
    direction: &str,
    target_button_id: Option<&str>,
    buttons: &[AuthorableButtonRef<'_>],
) -> String {
    let Some(target_button_id) = target_button_id else {
        return String::new();
    };
    let Some(index) = buttons
        .iter()
        .position(|button| button.id == target_button_id)
    else {
        return String::new();
    };
    format!(" {direction}=\"{}\"", index + 1)
}

pub(crate) fn generate_menu_overlay_images(
    render: &MenuOverlayRender<'_>,
    images: &MenuOverlayImages<'_>,
) -> std::result::Result<(), String> {
    render_menu_overlay_image_skia(
        render.button_bounds,
        images.highlight_colour,
        render.target,
        Path::new(images.highlight_image_path),
    )
    .map_err(|e| {
        format!(
            "Failed to render highlight overlay image for menu \"{}\": {e}",
            render.menu_id
        )
    })?;

    render_menu_overlay_image_skia(
        render.button_bounds,
        images.select_colour,
        render.target,
        Path::new(images.select_image_path),
    )
    .map_err(|e| {
        format!(
            "Failed to render select overlay image for menu \"{}\": {e}",
            render.menu_id
        )
    })?;

    Ok(())
}

pub(crate) struct MenuOverlayRender<'a> {
    pub(crate) menu_id: &'a str,
    pub(crate) button_bounds: &'a [MenuOverlayButton],
    pub(crate) target: RenderTarget,
}

pub(crate) struct MenuOverlayImages<'a> {
    pub(crate) highlight_image_path: &'a str,
    pub(crate) select_image_path: &'a str,
    pub(crate) highlight_colour: &'a str,
    pub(crate) select_colour: &'a str,
}

#[cfg(test)]
mod tests {
    use crate::models::*;

    use super::AuthorableMenuRef;

    #[test]
    fn authorable_menu_ref_prefers_authored_document() {
        let legacy_menu = Menu {
            id: "menu-1".to_string(),
            name: "Legacy Name".to_string(),
            background_asset_id: Some("asset-legacy".to_string()),
            buttons: vec![MenuButton {
                id: "btn-legacy".to_string(),
                label: "Legacy Button".to_string(),
                bounds: ButtonBounds {
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 100.0,
                },
                ..MenuButton::default()
            }],
            authored_document: Some(MenuDocument {
                id: "menu-1".to_string(),
                name: "Authored Name".to_string(),
                domain: crate::models::MenuDomain::Vmgm,
                scene: MenuScene {
                    design_size: MenuSize {
                        width: 720.0,
                        height: 480.0,
                        aspect: AspectMode::SixteenByNine,
                    },
                    background: SceneBackground {
                        asset_id: Some("asset-authored".to_string()),
                        colour: None,
                    },
                    nodes: vec![SceneNode::Button {
                        id: "btn-authored".to_string(),
                        label: "Authored Button".to_string(),
                        x: 50.0,
                        y: 50.0,
                        width: 200.0,
                        height: 80.0,
                        highlight_mode: HighlightMode::Static,
                        highlight_keyframes: vec![],
                        video_asset_id: None,
                        button_style: None,
                        label_style: None,
                    }],
                    guides: vec![],
                },
                interaction: MenuInteractionGraph {
                    default_focus_id: Some("btn-authored".to_string()),
                    nodes: vec![FocusNode {
                        node_id: "btn-authored".to_string(),
                        ..FocusNode::default()
                    }],
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
        };

        let menu_ref = AuthorableMenuRef {
            menu: &legacy_menu,
            domain: super::MenuDomain::Vmgm,
        };

        assert_eq!(menu_ref.name(), "Authored Name");
        assert_eq!(menu_ref.background_asset_id(), Some("asset-authored"));
        assert_eq!(menu_ref.default_button_id(), Some("btn-authored"));
        assert_eq!(
            menu_ref.display_aspect(&SpindleProjectFile::default()),
            AspectMode::SixteenByNine
        );

        let buttons = menu_ref.buttons();
        assert_eq!(buttons.len(), 1);
        assert_eq!(buttons[0].id, "btn-authored");
        assert_eq!(buttons[0].label, "Authored Button");
        assert_eq!(buttons[0].x, 50.0);
    }

    #[test]
    fn build_ffmpeg_menu_command_uses_skia_overlay_not_draw_filters() {
        // The command should not contain drawbox/drawtext; instead it should include
        // a Skia scene PNG input and an overlay=0:0 filter chain.
        let menu = Menu {
            id: "menu-1".to_string(),
            authored_document: Some(MenuDocument {
                id: "menu-1".to_string(),
                name: "Test Menu".to_string(),
                domain: crate::models::MenuDomain::Vmgm,
                scene: MenuScene {
                    design_size: MenuSize {
                        width: 720.0,
                        height: 480.0,
                        aspect: AspectMode::SixteenByNine,
                    },
                    background: SceneBackground {
                        asset_id: None,
                        colour: Some("#000000".to_string()),
                    },
                    nodes: vec![
                        SceneNode::Shape {
                            id: "shape-1".to_string(),
                            x: 10.0,
                            y: 20.0,
                            width: 100.0,
                            height: 50.0,
                            fill: Some("#ff0000".to_string()),
                        },
                        SceneNode::Button {
                            id: "btn-1".to_string(),
                            label: "Play".to_string(),
                            x: 100.0,
                            y: 150.0,
                            width: 200.0,
                            height: 40.0,
                            highlight_mode: HighlightMode::Static,
                            highlight_keyframes: vec![],
                            video_asset_id: None,
                            button_style: None,
                            label_style: None,
                        },
                    ],
                    guides: vec![],
                },
                interaction: MenuInteractionGraph {
                    default_focus_id: Some("btn-1".to_string()),
                    nodes: vec![FocusNode {
                        node_id: "btn-1".to_string(),
                        ..FocusNode::default()
                    }],
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
        };

        let project = SpindleProjectFile::default();
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: super::MenuDomain::Vmgm,
        };
        let assets = std::collections::HashMap::new();

        let cmd = super::build_ffmpeg_menu_command(
            "ffmpeg",
            &menu_ref,
            &assets,
            &project,
            VideoStandard::Ntsc,
            std::path::Path::new("/tmp/output.mpg"),
            std::path::Path::new("/tmp/output_scene.png"),
        )
        .unwrap();

        let cmd_str = cmd.join(" ");

        // Skia overlay path — no legacy draw filters.
        assert!(!cmd_str.contains("drawbox"), "should not contain drawbox: {cmd_str}");
        assert!(!cmd_str.contains("drawtext"), "should not contain drawtext: {cmd_str}");

        // Must reference the scene PNG and the overlay filter.
        assert!(cmd_str.contains("output_scene.png"), "should reference scene PNG: {cmd_str}");
        assert!(cmd_str.contains("overlay=0:0"), "should contain overlay=0:0: {cmd_str}");
        assert!(cmd_str.contains("-aspect 16:9"), "should contain aspect: {cmd_str}");
        assert!(cmd_str.contains("-filter_complex"), "should contain filter_complex: {cmd_str}");
        assert!(cmd_str.contains("-map [menuout]"), "should contain map: {cmd_str}");
    }

    #[test]
    fn build_ffmpeg_menu_command_includes_setsar_in_overlay_filter() {
        // The setsar filter must appear in the filter chain even with the Skia path.
        let menu = Menu {
            id: "menu-sar".to_string(),
            authored_document: Some(MenuDocument {
                id: "menu-sar".to_string(),
                name: "SAR Test Menu".to_string(),
                domain: crate::models::MenuDomain::Vmgm,
                scene: MenuScene {
                    design_size: MenuSize {
                        width: 1024.0,
                        height: 576.0,
                        aspect: AspectMode::SixteenByNine,
                    },
                    background: SceneBackground {
                        asset_id: None,
                        colour: Some("#000000".to_string()),
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
                compile_policy: MenuCompilePolicy {
                    display_aspect: Some(AspectMode::SixteenByNine),
                    ..MenuCompilePolicy::default()
                },
            }),
            ..Menu::default()
        };

        let project = SpindleProjectFile::default();
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: super::MenuDomain::Vmgm,
        };
        let assets = std::collections::HashMap::new();
        let cmd = super::build_ffmpeg_menu_command(
            "ffmpeg",
            &menu_ref,
            &assets,
            &project,
            VideoStandard::Ntsc,
            std::path::Path::new("/tmp/output.mpg"),
            std::path::Path::new("/tmp/output_scene.png"),
        )
        .unwrap();

        let cmd_str = cmd.join(" ");
        // DVD NTSC 16:9 SAR = 32/27
        assert!(
            cmd_str.contains("setsar=32/27"),
            "expected setsar=32/27 in filter chain, got: {cmd_str}"
        );
    }

    #[test]
    fn build_ffmpeg_menu_command_scales_still_image_backgrounds_into_dvd_raster() {
        let mut menu = Menu::default();
        menu.id = "menu-1".to_string();
        menu.name = "Image Menu".to_string();
        menu.authored_document = Some(MenuDocument {
            id: "menu-1".to_string(),
            name: "Image Menu".to_string(),
            domain: crate::models::MenuDomain::Vmgm,
            scene: MenuScene {
                design_size: MenuSize {
                    width: 720.0,
                    height: 480.0,
                    aspect: AspectMode::SixteenByNine,
                },
                background: SceneBackground {
                    asset_id: Some("asset-image".to_string()),
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
        });

        let project = SpindleProjectFile::default();
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: super::MenuDomain::Vmgm,
        };
        let mut assets = std::collections::HashMap::new();
        let mut image_asset = Asset::new(
            "background.png".to_string(),
            "/tmp/background.png".to_string(),
        );
        image_asset.container_format = Some("png_pipe".to_string());
        assets.insert("asset-image", &image_asset);

        let cmd = super::build_ffmpeg_menu_command(
            "ffmpeg",
            &menu_ref,
            &assets,
            &project,
            VideoStandard::Ntsc,
            std::path::Path::new("/tmp/output.mpg"),
            std::path::Path::new("/tmp/output_scene.png"),
        )
        .unwrap();

        let cmd_str = cmd.join(" ");

        assert!(cmd_str.contains("-loop 1 -i /tmp/background.png"));
        assert!(cmd_str.contains("[1:v]scale=720:480:force_original_aspect_ratio=decrease,pad=720:480:(ow-iw)/2:(oh-ih)/2[background_fill]"));
        assert!(cmd_str.contains("[0:v][background_fill]overlay=0:0[canvas0]"));
    }
}
