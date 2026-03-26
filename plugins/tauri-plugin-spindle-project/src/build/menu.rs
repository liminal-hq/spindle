// Menu authoring helpers for rendered DVD menus.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashMap;
use std::path::Path;

use crate::models::*;

use super::ffmpeg::{dvd_sample_aspect_ratio, fps_rational_str, output_display_aspect_ratio_parts};
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

pub(crate) fn menu_output_aspect(project: &SpindleProjectFile, domain: MenuDomain) -> AspectMode {
    match domain {
        MenuDomain::Vmgm => project
            .disc
            .titlesets
            .iter()
            .flat_map(|titleset| titleset.titles.iter())
            .find_map(|title| title.video_output_profile.map(|profile| profile.aspect))
            .unwrap_or(AspectMode::SixteenByNine),
        MenuDomain::Titleset(index) => project
            .disc
            .titlesets
            .get(index)
            .and_then(|titleset| {
                titleset
                    .titles
                    .iter()
                    .find_map(|title| title.video_output_profile.map(|profile| profile.aspect))
            })
            .unwrap_or(AspectMode::SixteenByNine),
    }
}

pub(crate) fn build_ffmpeg_menu_command(
    ffmpeg_bin: &str,
    menu_ref: &AuthorableMenuRef<'_>,
    assets: &HashMap<&str, &Asset>,
    project: &SpindleProjectFile,
    standard: VideoStandard,
    output_path: &Path,
) -> crate::Result<Vec<String>> {
    let (width, height) = VideoRaster::FullD1.resolution(standard);
    let aspect = menu_output_aspect(project, menu_ref.domain);
    let (display_num, display_den) = output_display_aspect_ratio_parts(aspect);
    let sar = dvd_sample_aspect_ratio(width, height, display_num, display_den);
    let aspect_str = match aspect {
        AspectMode::FourByThree => "4:3",
        AspectMode::SixteenByNine => "16:9",
    };
    let fps = fps_rational_str(standard.frame_rate());

    let mut cmd = vec![ffmpeg_bin.to_string(), "-y".to_string()];
    let mut vf_parts = Vec::new();

    if let Some(background_asset_id) = menu_ref.menu.background_asset_id.as_deref() {
        let asset = assets.get(background_asset_id).ok_or_else(|| {
            crate::Error::Build(format!(
                "Background asset not found for menu \"{}\"",
                menu_ref.menu.name
            ))
        })?;
        cmd.extend(["-i".to_string(), asset.source_path.clone()]);
        vf_parts.push(format!("fps={fps}"));
        vf_parts.push(format!(
            "scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
        ));
        vf_parts.push("trim=start_frame=0:end_frame=1".to_string());
        vf_parts.push(format!(
            "loop=loop={}:size=1:start=0",
            menu_loop_frame_count(standard).saturating_sub(1)
        ));
    } else {
        cmd.extend([
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            format!("color=c=#101014:s={}x{}:d=1", width, height),
        ]);
        vf_parts.push(format!("fps={fps}"));
    }

    vf_parts.push(menu_button_overlay_filter(menu_ref.menu));
    vf_parts.push(format!("setsar={sar}"));

    cmd.extend([
        "-vf".to_string(),
        vf_parts.join(","),
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

fn menu_button_overlay_filter(menu: &Menu) -> String {
    if menu.buttons.is_empty() {
        return "null".to_string();
    }

    let mut filters = Vec::new();
    for button in &menu.buttons {
        let colour = if menu.default_button_id.as_deref() == Some(button.id.as_str()) {
            "#ffaa40@0.50"
        } else {
            "#ffffff@0.28"
        };
        filters.push(format!(
            "drawbox=x={}:y={}:w={}:h={}:color={}:t=2",
            button.bounds.x.round() as i32,
            button.bounds.y.round() as i32,
            button.bounds.width.round() as i32,
            button.bounds.height.round() as i32,
            colour
        ));
    }

    filters.join(",")
}

pub(crate) fn generate_spumux_xml(
    menu_ref: &AuthorableMenuRef<'_>,
    standard: VideoStandard,
    menus_dir: &Path,
) -> String {
    let format_str = match standard {
        VideoStandard::Ntsc => "NTSC",
        VideoStandard::Pal => "PAL",
    };
    let base_name = sanitise_filename(&menu_ref.menu.id);
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

    for (index, button) in menu_ref.menu.buttons.iter().enumerate() {
        let name = (index + 1).to_string();
        xml.push_str(&format!(
            "      <button name=\"{}\" x0=\"{}\" y0=\"{}\" x1=\"{}\" y1=\"{}\"{}{}{}{} />\n",
            name,
            button.bounds.x.round() as i32,
            button.bounds.y.round() as i32,
            (button.bounds.x + button.bounds.width).round() as i32,
            (button.bounds.y + button.bounds.height).round() as i32,
            button_nav_attr("up", button.nav_up.as_deref(), menu_ref.menu),
            button_nav_attr("down", button.nav_down.as_deref(), menu_ref.menu),
            button_nav_attr("left", button.nav_left.as_deref(), menu_ref.menu),
            button_nav_attr("right", button.nav_right.as_deref(), menu_ref.menu)
        ));
    }

    xml.push_str("    </spu>\n");
    xml.push_str("  </stream>\n");
    xml.push_str("</subpictures>\n");
    xml
}

fn button_nav_attr(direction: &str, target_button_id: Option<&str>, menu: &Menu) -> String {
    let Some(target_button_id) = target_button_id else {
        return String::new();
    };
    let Some(index) = menu
        .buttons
        .iter()
        .position(|button| button.id == target_button_id)
    else {
        return String::new();
    };
    format!(" {direction}=\"{}\"", index + 1)
}

pub(crate) fn generate_menu_overlay_images(
    ffmpeg_bin: &str,
    standard: VideoStandard,
    menu_id: &str,
    highlight_image_path: &str,
    select_image_path: &str,
    highlight_colour: &str,
    select_colour: &str,
    button_bounds: &[MenuOverlayButton],
    run_command: impl Fn(&[String]) -> std::result::Result<String, String>,
) -> std::result::Result<(), String> {
    render_menu_overlay_image(
        ffmpeg_bin,
        standard,
        highlight_image_path,
        highlight_colour,
        button_bounds,
        "highlight",
        menu_id,
        &run_command,
    )?;
    render_menu_overlay_image(
        ffmpeg_bin,
        standard,
        select_image_path,
        select_colour,
        button_bounds,
        "select",
        menu_id,
        &run_command,
    )?;
    Ok(())
}

fn render_menu_overlay_image(
    ffmpeg_bin: &str,
    standard: VideoStandard,
    output_path: &str,
    colour: &str,
    button_bounds: &[MenuOverlayButton],
    kind: &str,
    menu_id: &str,
    run_command: &impl Fn(&[String]) -> std::result::Result<String, String>,
) -> std::result::Result<(), String> {
    let (width, height) = VideoRaster::FullD1.resolution(standard);
    let mut vf_parts = vec!["format=rgba".to_string()];
    for button in button_bounds {
        let width = (button.x1 - button.x0).max(1);
        let height = (button.y1 - button.y0).max(1);
        vf_parts.push(format!(
            "drawbox=x={}:y={}:w={}:h={}:color={}:t=fill",
            button.x0, button.y0, width, height, colour
        ));
    }

    let args = vec![
        ffmpeg_bin.to_string(),
        "-y".to_string(),
        "-f".to_string(),
        "lavfi".to_string(),
        "-i".to_string(),
        format!("color=c=black@0.0:s={}x{}:d=1", width, height),
        "-frames:v".to_string(),
        "1".to_string(),
        "-vf".to_string(),
        vf_parts.join(","),
        output_path.to_string(),
    ];

    run_command(&args)
        .map(|_| ())
        .map_err(|msg| format!("Failed to render {kind} overlay image for menu \"{menu_id}\": {msg}"))
}
