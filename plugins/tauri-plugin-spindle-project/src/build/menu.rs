// Menu authoring helpers for rendered DVD menus.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashMap;
use std::path::Path;

use crate::models::*;

use super::ffmpeg::{
    dvd_active_dimensions, fps_rational_str, output_display_aspect_ratio_parts,
    source_display_aspect_ratio,
};
use super::skia::{render_menu_overlay_image_skia, render_menu_overlay_image_skia_quantized};
use super::types::{MenuOverlayButton, OverlayKeyframeSpec};
use super::util::{sanitise_filename, xml_escape};

#[derive(Clone, Copy)]
pub enum MenuDomain {
    Vmgm,
    Titleset(usize),
}

pub struct AuthorableMenuRef<'a> {
    pub menu: &'a Menu,
    pub domain: MenuDomain,
}

impl<'a> AuthorableMenuRef<'a> {
    pub(crate) fn name(&self) -> &str {
        self.menu.doc().name.as_str()
    }

    pub(crate) fn background_asset_id(&self) -> Option<&str> {
        self.menu.resolved_background_asset_id()
    }

    pub(crate) fn highlight_colours(&self) -> &MenuHighlightColours {
        &self.menu.doc().highlight_colours
    }

    pub(crate) fn background_mode(&self) -> BackgroundMode {
        self.menu.resolved_background_mode()
    }

    pub(crate) fn timeout_action(&self) -> Option<&PlaybackAction> {
        self.menu.doc().interaction.timeout_action.as_ref()
    }

    pub(crate) fn motion_duration_secs(&self) -> Option<f64> {
        self.menu.resolved_motion_duration_secs()
    }

    pub(crate) fn motion_loop_count(&self) -> u32 {
        self.menu.doc().timing.loop_count
    }

    pub(crate) fn display_aspect(&self, project: &SpindleProjectFile) -> AspectMode {
        let fallback = inferred_menu_output_aspect(project, self.domain);
        self.menu.resolved_display_aspect(fallback)
    }

    pub(crate) fn buttons(&self) -> Vec<AuthorableButtonRef<'_>> {
        self.menu.doc().buttons()
    }

    pub(crate) fn default_button_id(&self) -> Option<&str> {
        self.menu.doc().interaction.default_focus_id.as_deref()
    }

    pub(crate) fn scene_nodes(&self) -> Vec<&SceneNode> {
        self.menu.doc().scene.nodes.iter().collect()
    }
}

/// The build pipeline's button view is exactly the shared
/// `MenuDocument::buttons()` view — see [`crate::models::MenuButtonView`].
pub(crate) type AuthorableButtonRef<'a> = crate::models::MenuButtonView<'a>;

pub fn authorable_menus(project: &SpindleProjectFile) -> Vec<AuthorableMenuRef<'_>> {
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
    output_path.with_file_name(format!("{stem}_scene.png"))
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

    let (target_dar_num, target_dar_den) = output_display_aspect_ratio_parts(aspect);
    let target_dar = target_dar_num as f64 / target_dar_den as f64;

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

        let source_dar = asset
            .video_streams
            .first()
            .and_then(source_display_aspect_ratio)
            .unwrap_or(target_dar);
        let (active_width, active_height) =
            dvd_active_dimensions(width, height, source_dar, target_dar);
        let pad_x = (width.saturating_sub(active_width)) / 2;
        let pad_y = (height.saturating_sub(active_height)) / 2;

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
                "[1:v]scale={active_width}:{active_height},pad={width}:{height}:{pad_x}:{pad_y}[background_fill]"
            ));
            filter_complex_parts.push(format!(
                "[0:v][background_fill]overlay=0:0[{background_label}]"
            ));
            next_input_index = 2;
        } else {
            cmd.extend(["-i".to_string(), asset.source_path.clone()]);
            filter_complex_parts.push(format!(
                "[0:v]fps={fps},scale={active_width}:{active_height},pad={width}:{height}:{pad_x}:{pad_y},trim=start_frame=0:end_frame=1,loop=loop={}:size=1:start=0[{background_label}]",
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

/// Emit the spumux XML for a menu's subpicture stream: one `<spu>` per
/// `frames` entry (design decision D8), with the same `<button>` children
/// repeated identically in every `<spu>` — the button rectangles/nav links
/// don't change across keyframes, only the highlight artwork does.
///
/// `frames` must have at least one entry (the planner always builds at
/// least a trivial single-frame schedule — see `planner::animation`). A
/// single-entry schedule uses the original, `end`-less `<spu>` form (start
/// pinned at `"00:00:00.00"`) so a menu with no animation tracks — the
/// overwhelmingly common case — produces byte-identical XML to a build with
/// no animation support at all. Two or more entries use `start`/`end`
/// timestamps formatted by [`format_spu_timestamp`].
pub(crate) fn generate_spumux_xml(
    menu_ref: &AuthorableMenuRef<'_>,
    standard: VideoStandard,
    menus_dir: &Path,
    scale_x: f64,
    scale_y: f64,
    frames: &[OverlayKeyframeSpec],
) -> String {
    let format_str = match standard {
        VideoStandard::Ntsc => "NTSC",
        VideoStandard::Pal => "PAL",
    };

    let buttons = menu_ref.buttons();
    let mut button_xml = String::new();
    for (index, button) in buttons.iter().enumerate() {
        let name = (index + 1).to_string();
        button_xml.push_str(&format!(
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

    let mut xml = String::new();
    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str(&format!("<subpictures format=\"{format_str}\">\n"));
    xml.push_str("  <stream>\n");

    if frames.len() <= 1 {
        let base_name = sanitise_filename(menu_ref.menu.id.as_str());
        let (image_path, select_path) = match frames.first() {
            Some(frame) => (
                frame.highlight_image_path.clone(),
                frame.select_image_path.clone(),
            ),
            None => (
                menus_dir
                    .join(format!("{base_name}_highlight.png"))
                    .display()
                    .to_string(),
                menus_dir
                    .join(format!("{base_name}_select.png"))
                    .display()
                    .to_string(),
            ),
        };
        xml.push_str(&format!(
            "    <spu start=\"00:00:00.00\" image=\"{}\" highlight=\"{}\" select=\"{}\" transparent=\"#000000\" force=\"yes\">\n",
            xml_escape(&image_path),
            xml_escape(&image_path),
            xml_escape(&select_path)
        ));
        xml.push_str(&button_xml);
        xml.push_str("    </spu>\n");
    } else {
        for frame in frames {
            xml.push_str(&format!(
                "    <spu start=\"{}\" end=\"{}\" image=\"{}\" highlight=\"{}\" select=\"{}\" transparent=\"#000000\" force=\"yes\">\n",
                format_spu_timestamp(frame.start_secs),
                format_spu_timestamp(frame.end_secs),
                xml_escape(&frame.highlight_image_path),
                xml_escape(&frame.highlight_image_path),
                xml_escape(&frame.select_image_path)
            ));
            xml.push_str(&button_xml);
            xml.push_str("    </spu>\n");
        }
    }

    xml.push_str("  </stream>\n");
    xml.push_str("</subpictures>\n");
    xml
}

/// Format a seconds offset as spumux's `hh:mm:ss.mmm` `<spu>` timestamp
/// (millisecond precision — the original single-`<spu>` still-menu form used
/// a hardcoded centisecond-precision `"00:00:00.00"`, kept verbatim by
/// [`generate_spumux_xml`]'s single-frame branch rather than routed through
/// here, so the no-animation case stays byte-identical).
pub(crate) fn format_spu_timestamp(total_secs: f64) -> String {
    let total_secs = total_secs.max(0.0);
    let mut millis = (total_secs.fract() * 1000.0).round() as u64;
    let mut secs = (total_secs % 60.0) as u64;
    if millis >= 1000 {
        millis -= 1000;
        secs += 1;
    }
    let mut minutes = ((total_secs % 3600.0) / 60.0) as u64;
    if secs >= 60 {
        secs -= 60;
        minutes += 1;
    }
    let mut hours = (total_secs / 3600.0) as u64;
    if minutes >= 60 {
        minutes -= 60;
        hours += 1;
    }
    format!("{hours:02}:{minutes:02}:{secs:02}.{millis:03}")
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
    let render_fn: fn(&[_], &str, _, &Path) -> crate::Result<()> = if images.quantize_palette {
        render_menu_overlay_image_skia_quantized
    } else {
        render_menu_overlay_image_skia
    };

    render_fn(
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

    render_fn(
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

/// Render one highlight/select overlay PNG pair per `frames` entry — the
/// multi-frame counterpart to [`generate_menu_overlay_images`], used by the
/// `RenderMenu` executor arm when a motion menu's `overlay_keyframes`
/// schedule (design decision D8) has more than the trivial single frame.
/// Anti-aliasing stays off in the underlying renderer regardless of
/// `quantize_palette` — spumux's ≤16-colour subpicture palette limit applies
/// to every frame, not just the first.
pub(crate) fn generate_menu_overlay_images_for_keyframes(
    menu_id: &str,
    button_bounds: &[MenuOverlayButton],
    target: RenderTarget,
    frames: &[OverlayKeyframeSpec],
    quantize_palette: bool,
) -> std::result::Result<(), String> {
    for frame in frames {
        generate_menu_overlay_images(
            &MenuOverlayRender {
                menu_id,
                button_bounds,
                target,
            },
            &MenuOverlayImages {
                highlight_image_path: &frame.highlight_image_path,
                select_image_path: &frame.select_image_path,
                highlight_colour: &frame.highlight_colour,
                select_colour: &frame.select_colour,
                quantize_palette,
            },
        )?;
    }
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
    /// When true, render with AA enabled and quantize to ≤4 colours (dev diagnostic).
    pub(crate) quantize_palette: bool,
}

#[cfg(test)]
mod spumux_frame_tests {
    use crate::models::*;

    use super::super::types::OverlayKeyframeSpec;
    use super::{format_spu_timestamp, generate_spumux_xml, AuthorableMenuRef};

    fn menu_with_one_button() -> Menu {
        Menu::new("menu-pin", "Pin Menu").with_document(MenuDocument {
            animation: vec![],
            id: "menu-pin".to_string(),
            name: "Pin Menu".to_string(),
            domain: crate::models::MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
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
                nodes: vec![SceneNode::Button {
                    id: "btn-1".to_string(),
                    label: "Play".to_string(),
                    x: 100.0,
                    y: 280.0,
                    width: 220.0,
                    height: 48.0,
                    highlight_mode: HighlightMode::Static,
                    highlight_keyframes: vec![],
                    video_asset_id: None,
                    button_style: None,
                    label_style: None,
                }],
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
        })
    }

    /// Pinned exactly to the XML `generate_spumux_xml` produced before the
    /// multi-`<spu>` DCSQ lowering landed (design decision D8) — a menu with
    /// no animation tracks (the overwhelmingly common case) must keep
    /// producing byte-identical output.
    #[test]
    fn no_tracks_single_frame_output_is_byte_identical_to_pre_animation_output() {
        let menu = menu_with_one_button();
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: super::MenuDomain::Vmgm,
        };
        let frames = vec![OverlayKeyframeSpec {
            start_secs: 0.0,
            end_secs: 0.0,
            highlight_image_path: "/tmp/menus/menu-pin_highlight.png".to_string(),
            select_image_path: "/tmp/menus/menu-pin_select.png".to_string(),
            highlight_colour: "#ffaa40".to_string(),
            select_colour: "#ffffff".to_string(),
        }];

        let xml = generate_spumux_xml(
            &menu_ref,
            VideoStandard::Ntsc,
            std::path::Path::new("/tmp/menus"),
            1.0,
            1.0,
            &frames,
        );

        let expected = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<subpictures format=\"NTSC\">\n  \
<stream>\n    \
<spu start=\"00:00:00.00\" image=\"/tmp/menus/menu-pin_highlight.png\" highlight=\"/tmp/menus/menu-pin_highlight.png\" select=\"/tmp/menus/menu-pin_select.png\" transparent=\"#000000\" force=\"yes\">\n      \
<button name=\"1\" x0=\"100\" y0=\"280\" x1=\"320\" y1=\"328\" />\n    \
</spu>\n  \
</stream>\n\
</subpictures>\n";
        assert_eq!(xml, expected);
    }

    #[test]
    fn empty_frames_falls_back_to_deriving_paths_from_menus_dir() {
        let menu = menu_with_one_button();
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: super::MenuDomain::Vmgm,
        };

        let xml = generate_spumux_xml(
            &menu_ref,
            VideoStandard::Ntsc,
            std::path::Path::new("/tmp/menus"),
            1.0,
            1.0,
            &[],
        );

        assert!(xml.contains("image=\"/tmp/menus/menu-pin_highlight.png\""));
        assert!(xml.contains("select=\"/tmp/menus/menu-pin_select.png\""));
        assert!(!xml.contains("end="));
    }

    #[test]
    fn multi_frame_schedule_emits_one_spu_per_frame_with_identical_buttons() {
        let menu = menu_with_one_button();
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: super::MenuDomain::Vmgm,
        };
        let frames = vec![
            OverlayKeyframeSpec {
                start_secs: 0.0,
                end_secs: 1.0,
                highlight_image_path: "/tmp/menus/menu-pin_hl_k0.png".to_string(),
                select_image_path: "/tmp/menus/menu-pin_sel_k0.png".to_string(),
                highlight_colour: "#ff0000ff".to_string(),
                select_colour: "#ffffffff".to_string(),
            },
            OverlayKeyframeSpec {
                start_secs: 1.0,
                end_secs: 2.5,
                highlight_image_path: "/tmp/menus/menu-pin_hl_k1.png".to_string(),
                select_image_path: "/tmp/menus/menu-pin_sel_k1.png".to_string(),
                highlight_colour: "#00ff00ff".to_string(),
                select_colour: "#ffffffff".to_string(),
            },
        ];

        let xml = generate_spumux_xml(
            &menu_ref,
            VideoStandard::Ntsc,
            std::path::Path::new("/tmp/menus"),
            1.0,
            1.0,
            &frames,
        );

        assert_eq!(
            xml.matches("<spu ").count(),
            2,
            "expected two <spu> entries, got:\n{xml}"
        );
        assert_eq!(
            xml.matches("<button name=\"1\" x0=\"100\" y0=\"280\" x1=\"320\" y1=\"328\" />")
                .count(),
            2,
            "expected identical <button> children in every <spu>, got:\n{xml}"
        );
        assert!(xml.contains("start=\"00:00:00.000\" end=\"00:00:01.000\""));
        assert!(xml.contains("start=\"00:00:01.000\" end=\"00:00:02.500\""));
        assert!(xml.contains("image=\"/tmp/menus/menu-pin_hl_k0.png\""));
        assert!(xml.contains("image=\"/tmp/menus/menu-pin_hl_k1.png\""));
    }

    #[test]
    fn format_spu_timestamp_formats_millisecond_precision() {
        assert_eq!(format_spu_timestamp(0.0), "00:00:00.000");
        assert_eq!(format_spu_timestamp(1.5), "00:00:01.500");
        assert_eq!(format_spu_timestamp(65.125), "00:01:05.125");
        assert_eq!(format_spu_timestamp(3661.001), "01:01:01.001");
    }

    #[test]
    fn format_spu_timestamp_carries_millisecond_rounding_into_seconds() {
        // 1.9996 rounds to 2000ms at millisecond precision, which must carry
        // into the seconds place rather than emitting an invalid ".1000".. suffix.
        assert_eq!(format_spu_timestamp(1.9996), "00:00:02.000");
    }
}

#[cfg(test)]
mod tests {
    use crate::models::*;

    use super::AuthorableMenuRef;

    #[test]
    fn authorable_menu_ref_reads_from_the_authored_document() {
        let menu = Menu::new("menu-1", "Legacy Name").with_document(MenuDocument {
            animation: vec![],
            id: "menu-1".to_string(),
            name: "Authored Name".to_string(),
            domain: crate::models::MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
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
        });

        let menu_ref = AuthorableMenuRef {
            menu: &menu,
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
        let menu = Menu::new("menu-1", "Untitled Menu").with_document(MenuDocument {
            animation: vec![],
            id: "menu-1".to_string(),
            name: "Test Menu".to_string(),
            domain: crate::models::MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
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
        });

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
        assert!(
            !cmd_str.contains("drawbox"),
            "should not contain drawbox: {cmd_str}"
        );
        assert!(
            !cmd_str.contains("drawtext"),
            "should not contain drawtext: {cmd_str}"
        );

        // Must reference the scene PNG and the overlay filter.
        assert!(
            cmd_str.contains("output_scene.png"),
            "should reference scene PNG: {cmd_str}"
        );
        assert!(
            cmd_str.contains("overlay=0:0"),
            "should contain overlay=0:0: {cmd_str}"
        );
        assert!(
            cmd_str.contains("-aspect 16:9"),
            "should contain aspect: {cmd_str}"
        );
        assert!(
            cmd_str.contains("-filter_complex"),
            "should contain filter_complex: {cmd_str}"
        );
        assert!(
            cmd_str.contains("-map [menuout]"),
            "should contain map: {cmd_str}"
        );
    }

    #[test]
    fn build_ffmpeg_menu_command_includes_setsar_in_overlay_filter() {
        // The setsar filter must appear in the filter chain even with the Skia path.
        let menu = Menu::new("menu-sar", "Untitled Menu").with_document(MenuDocument {
            animation: vec![],
            id: "menu-sar".to_string(),
            name: "SAR Test Menu".to_string(),
            domain: crate::models::MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
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
        });

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
        let menu = Menu::new("menu-1", "Image Menu").with_document(MenuDocument {
            animation: vec![],
            id: "menu-1".to_string(),
            name: "Image Menu".to_string(),
            domain: crate::models::MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
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
        assert!(cmd_str.contains("[1:v]scale=720:480,pad=720:480:0:0[background_fill]"));
        assert!(cmd_str.contains("[0:v][background_fill]overlay=0:0[canvas0]"));
    }

    #[test]
    fn build_ffmpeg_menu_command_fills_frame_for_16x9_background_on_16x9_menu() {
        // Regression test: a genuinely 16:9 background image (e.g. 1920x1080)
        // composited into a 16:9 anamorphic 720x480 DVD raster must fill the
        // frame exactly with no letterbox/pillarbox padding. Comparing the
        // image's aspect against the raw 720x480 pixel box (1.5:1) instead of
        // the true anamorphic display aspect (16:9, via the 32:27 SAR) used
        // to introduce spurious black bars even when source and target
        // aspect ratios matched.
        let menu = Menu::new("menu-1", "Image Menu").with_document(MenuDocument {
            animation: vec![],
            id: "menu-1".to_string(),
            name: "Image Menu".to_string(),
            domain: crate::models::MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
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
            "background.jpg".to_string(),
            "/tmp/background.jpg".to_string(),
        );
        image_asset.container_format = Some("jpeg_pipe".to_string());
        image_asset.video_streams = vec![VideoStreamInfo {
            index: 0,
            codec: "mjpeg".to_string(),
            width: 1920,
            height: 1080,
            frame_rate: None,
            aspect_ratio: None,
            scan_type: None,
            bitrate_bps: None,
            title: None,
            color_transfer: None,
            color_primaries: None,
            dolby_vision_profile: None,
        }];
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

        assert!(
            cmd_str.contains("[1:v]scale=720:480,pad=720:480:0:0[background_fill]"),
            "expected a 16:9 background to fill the frame with no padding, got: {cmd_str}"
        );
    }

    #[test]
    fn build_ffmpeg_menu_command_pillarboxes_4x3_background_on_16x9_menu() {
        // A genuinely narrower-than-16:9 background should still be
        // letterboxed/pillarboxed appropriately, proving the fix didn't just
        // remove padding outright.
        let menu = Menu::new("menu-1", "Image Menu").with_document(MenuDocument {
            animation: vec![],
            id: "menu-1".to_string(),
            name: "Image Menu".to_string(),
            domain: crate::models::MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
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
            "background.jpg".to_string(),
            "/tmp/background.jpg".to_string(),
        );
        image_asset.container_format = Some("jpeg_pipe".to_string());
        image_asset.video_streams = vec![VideoStreamInfo {
            index: 0,
            codec: "mjpeg".to_string(),
            width: 1440,
            height: 1080,
            frame_rate: None,
            aspect_ratio: None,
            scan_type: None,
            bitrate_bps: None,
            title: None,
            color_transfer: None,
            color_primaries: None,
            dolby_vision_profile: None,
        }];
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

        // 4:3 (1.333) is narrower than 16:9 (1.778), so width should shrink
        // and the frame should be pillarboxed left/right, not letterboxed.
        assert!(
            cmd_str.contains("[1:v]scale=540:480,pad=720:480:90:0[background_fill]"),
            "expected pillarboxed 4:3 background, got: {cmd_str}"
        );
    }
}
