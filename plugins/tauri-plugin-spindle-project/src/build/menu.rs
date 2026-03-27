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
    if let Some(label_filter) = menu_button_label_filter(menu_ref.menu) {
        vf_parts.push(label_filter);
    }
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

fn menu_button_label_filter(menu: &Menu) -> Option<String> {
    let filters = menu
        .buttons
        .iter()
        .filter_map(|button| {
            let label = button.label.trim();
            if label.is_empty() {
                return None;
            }

            let width = button.bounds.width.round().max(1.0) as i32;
            let height = button.bounds.height.round().max(1.0) as i32;
            let font_size = (height as f64 * 0.34).round().clamp(14.0, 30.0) as i32;
            let x = button.bounds.x.round() as i32;
            let y = button.bounds.y.round() as i32;
            let escaped_label = escape_drawtext_text(label);

            Some(format!(
                "drawtext=text='{escaped_label}':fontcolor=white:fontsize={font_size}:shadowcolor=black:shadowx=2:shadowy=2:x={x}+(({width}-text_w)/2):y={y}+(({height}-text_h)/2)"
            ))
        })
        .collect::<Vec<_>>();

    if filters.is_empty() {
        None
    } else {
        Some(filters.join(","))
    }
}

fn escape_drawtext_text(text: &str) -> String {
    text.chars()
        .flat_map(|ch| match ch {
            '\\' => ['\\', '\\'].into_iter().collect::<Vec<_>>(),
            '\'' => ['\\', '\''].into_iter().collect::<Vec<_>>(),
            ':' => ['\\', ':'].into_iter().collect::<Vec<_>>(),
            '%' => ['\\', '%'].into_iter().collect::<Vec<_>>(),
            '[' => ['\\', '['].into_iter().collect::<Vec<_>>(),
            ']' => ['\\', ']'].into_iter().collect::<Vec<_>>(),
            ',' => ['\\', ','].into_iter().collect::<Vec<_>>(),
            ';' => ['\\', ';'].into_iter().collect::<Vec<_>>(),
            other => [other].into_iter().collect::<Vec<_>>(),
        })
        .collect()
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
    render: &MenuOverlayRender<'_>,
    images: &MenuOverlayImages<'_>,
    run_command: impl Fn(&[String]) -> std::result::Result<String, String>,
) -> std::result::Result<(), String> {
    render_menu_overlay_image(
        render,
        images.highlight_image_path,
        images.highlight_colour,
        "highlight",
        &run_command,
    )?;
    render_menu_overlay_image(
        render,
        images.select_image_path,
        images.select_colour,
        "select",
        &run_command,
    )?;
    Ok(())
}

pub(crate) struct MenuOverlayRender<'a> {
    pub(crate) ffmpeg_bin: &'a str,
    pub(crate) standard: VideoStandard,
    pub(crate) menu_id: &'a str,
    pub(crate) button_bounds: &'a [MenuOverlayButton],
}

pub(crate) struct MenuOverlayImages<'a> {
    pub(crate) highlight_image_path: &'a str,
    pub(crate) select_image_path: &'a str,
    pub(crate) highlight_colour: &'a str,
    pub(crate) select_colour: &'a str,
}

fn render_menu_overlay_image(
    render: &MenuOverlayRender<'_>,
    output_path: &str,
    colour: &str,
    kind: &str,
    run_command: &impl Fn(&[String]) -> std::result::Result<String, String>,
) -> std::result::Result<(), String> {
    let (width, height) = VideoRaster::FullD1.resolution(render.standard);
    let mut vf_parts = vec!["format=rgba".to_string()];
    for button in render.button_bounds {
        let width = (button.x1 - button.x0).max(1);
        let height = (button.y1 - button.y0).max(1);
        vf_parts.push(format!(
            "drawbox=x={}:y={}:w={}:h={}:color={}:t=2",
            button.x0, button.y0, width, height, colour
        ));
    }

    let args = vec![
        render.ffmpeg_bin.to_string(),
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

    run_command(&args).map(|_| ()).map_err(|msg| {
        format!(
            "Failed to render {kind} overlay image for menu \"{}\": {msg}",
            render.menu_id
        )
    })
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use crate::models::VideoStandard;

    use super::{generate_menu_overlay_images, MenuOverlayImages, MenuOverlayRender};
    use crate::build::types::MenuOverlayButton;

    #[test]
    fn overlay_images_use_outline_boxes() {
        let render = MenuOverlayRender {
            ffmpeg_bin: "ffmpeg",
            standard: VideoStandard::Ntsc,
            menu_id: "menu-1",
            button_bounds: &[MenuOverlayButton {
                x0: 120,
                y0: 320,
                x1: 360,
                y1: 368,
            }],
        };
        let images = MenuOverlayImages {
            highlight_image_path: "/tmp/highlight.png",
            select_image_path: "/tmp/select.png",
            highlight_colour: "#ffaa40",
            select_colour: "#ffffff",
        };
        let calls = RefCell::new(Vec::<Vec<String>>::new());

        generate_menu_overlay_images(&render, &images, |args| {
            calls.borrow_mut().push(args.to_vec());
            Ok(String::new())
        })
        .unwrap();

        let calls = calls.into_inner();
        assert_eq!(calls.len(), 2);
        for args in calls {
            let vf_arg = args
                .iter()
                .skip_while(|arg| *arg != "-vf")
                .nth(1)
                .expect("-vf value");
            assert!(
                vf_arg.contains("drawbox=x=120:y=320:w=240:h=48"),
                "expected button outline drawbox in filter: {vf_arg}"
            );
            assert!(
                vf_arg.contains(":t=2"),
                "expected transparent-centre outline box in filter: {vf_arg}"
            );
            assert!(
                !vf_arg.contains(":t=fill"),
                "did not expect solid overlay fill in filter: {vf_arg}"
            );
        }
    }
}
