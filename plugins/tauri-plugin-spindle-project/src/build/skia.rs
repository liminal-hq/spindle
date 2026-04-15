// Skia-based menu scene and subpicture overlay renderer.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashMap;
use std::path::Path;

use skia_safe::{
    self as skia, surfaces, AlphaType, Canvas, Color, ColorType, Data, EncodedImageFormat,
    Font, FontMgr, FontStyle, ISize, ImageInfo, Paint, PaintStyle, Point, Rect,
};

use crate::models::{Asset, RenderTarget, SceneNode};

use super::menu::AuthorableMenuRef;
use super::types::MenuOverlayButton;

// ── Colour parsing ────────────────────────────────────────────────────────────

/// Parse a CSS hex colour string (`#rrggbb` or `#rrggbbaa`) into a Skia `Color`.
/// Returns opaque black on parse failure.
pub(crate) fn parse_colour(s: &str) -> Color {
    let s = s.trim().trim_start_matches('#');
    match s.len() {
        6 => {
            let r = u8::from_str_radix(&s[0..2], 16).unwrap_or(0);
            let g = u8::from_str_radix(&s[2..4], 16).unwrap_or(0);
            let b = u8::from_str_radix(&s[4..6], 16).unwrap_or(0);
            Color::from_argb(255, r, g, b)
        }
        8 => {
            let r = u8::from_str_radix(&s[0..2], 16).unwrap_or(0);
            let g = u8::from_str_radix(&s[2..4], 16).unwrap_or(0);
            let b = u8::from_str_radix(&s[4..6], 16).unwrap_or(0);
            let a = u8::from_str_radix(&s[6..8], 16).unwrap_or(255);
            Color::from_argb(a, r, g, b)
        }
        _ => Color::BLACK,
    }
}

// ── Scene renderer ────────────────────────────────────────────────────────────

/// Render the full menu scene (shapes, text, images, button outlines) to a PNG
/// at raster resolution. This replaces the `drawbox`/`drawtext` filter chain in
/// `build_ffmpeg_menu_command`.
pub(crate) fn render_menu_scene_to_png(
    menu_ref: &AuthorableMenuRef<'_>,
    assets: &HashMap<&str, &Asset>,
    target: RenderTarget,
    output_path: &Path,
) -> crate::Result<()> {
    let w = target.raster_width as i32;
    let h = target.raster_height as i32;

    let info = ImageInfo::new(
        ISize::new(w, h),
        ColorType::RGBA8888,
        AlphaType::Opaque,
        None,
    );

    let mut surface = surfaces::raster(&info, None, None)
        .ok_or_else(|| crate::Error::Build("Failed to create Skia surface".into()))?;

    let canvas = surface.canvas();

    // Fill background with opaque black so the PNG is fully opaque.
    canvas.clear(Color::from_argb(255, 16, 16, 20));

    let design_size = menu_ref
        .menu
        .authored_document
        .as_ref()
        .map(|doc| &doc.scene.design_size);

    let (scale_x, scale_y) = if let Some(ds) = design_size {
        (
            target.raster_width as f64 / ds.width,
            target.raster_height as f64 / ds.height,
        )
    } else {
        (1.0, 1.0)
    };

    // Draw scene nodes.
    for node in menu_ref.scene_nodes() {
        draw_scene_node(canvas, node, assets, scale_x, scale_y)?;
    }

    // Draw button outlines and labels (preview hint layer).
    draw_button_hints(canvas, menu_ref, scale_x, scale_y);

    // Encode and write.
    let image = surface.image_snapshot();
    let encoded = image
        .encode(None, EncodedImageFormat::PNG, None)
        .ok_or_else(|| crate::Error::Build("Failed to encode Skia surface as PNG".into()))?;

    std::fs::write(output_path, encoded.as_bytes())
        .map_err(|e| crate::Error::Build(format!("Failed to write PNG to {}: {e}", output_path.display())))
}

fn draw_scene_node(
    canvas: &Canvas,
    node: &SceneNode,
    assets: &HashMap<&str, &Asset>,
    scale_x: f64,
    scale_y: f64,
) -> crate::Result<()> {
    match node {
        SceneNode::Shape {
            x,
            y,
            width,
            height,
            fill,
            ..
        } => {
            let colour = parse_colour(fill.as_deref().unwrap_or("#333333"));
            let mut paint = Paint::default();
            paint.set_color(colour);
            paint.set_anti_alias(true);
            paint.set_style(PaintStyle::Fill);

            let rect = Rect::from_xywh(
                (x * scale_x) as f32,
                (y * scale_y) as f32,
                (width * scale_x) as f32,
                (height * scale_y) as f32,
            );

            // No corner_radius in current model — draw as plain rect.
            canvas.draw_rect(rect, &paint);
        }

        SceneNode::Text {
            content,
            x,
            y,
            width,
            height,
            font_size,
            colour,
            ..
        } => {
            let colour = parse_colour_name_or_hex(colour.as_deref().unwrap_or("white"));
            let size = (font_size.unwrap_or(24.0) * scale_y) as f32;

            let typeface = FontMgr::new()
                .legacy_make_typeface(None, FontStyle::normal())
                .expect("default typeface should always be available");
            let font = Font::new(typeface, size);

            let mut paint = Paint::default();
            paint.set_color(colour);
            paint.set_anti_alias(true);

            // Shadow pass
            let mut shadow_paint = Paint::default();
            shadow_paint.set_color(Color::from_argb(153, 0, 0, 0)); // black@0.6
            shadow_paint.set_anti_alias(true);

            let scaled_x = (x * scale_x) as f32;
            let scaled_y = (y * scale_y) as f32;
            let scaled_w = (width * scale_x) as f32;
            let scaled_h = (height * scale_y) as f32;

            // Measure for centring.
            let (text_width, _) = font.measure_str(content.as_str(), Some(&paint));
            let text_x = scaled_x + (scaled_w - text_width) / 2.0;
            // Skia text origin is baseline; approximate vertical centre.
            let (_, metrics) = font.metrics();
            let text_height = metrics.descent - metrics.ascent;
            let text_y = scaled_y + (scaled_h - text_height) / 2.0 - metrics.ascent;

            // Draw shadow offset by 2px.
            canvas.draw_str(content.as_str(), Point::new(text_x + 2.0, text_y + 2.0), &font, &shadow_paint);
            canvas.draw_str(content.as_str(), Point::new(text_x, text_y), &font, &paint);
        }

        SceneNode::Image {
            asset_id,
            x,
            y,
            width,
            height,
            ..
        } => {
            if let Some(asset) = assets.get(asset_id.as_str()) {
                draw_image_asset(canvas, asset, (*x, *y, *width, *height), (scale_x, scale_y));
            }
        }

        // Button nodes are rendered separately as hint outlines.
        // Group, Video, ComponentInstance, GeneratedCollection → skip.
        _ => {}
    }
    Ok(())
}

fn draw_image_asset(
    canvas: &Canvas,
    asset: &Asset,
    bounds: (f64, f64, f64, f64),
    scale: (f64, f64),
) {
    let (x, y, width, height) = bounds;
    let (scale_x, scale_y) = scale;

    let path = std::path::Path::new(&asset.source_path);
    let Ok(bytes) = std::fs::read(path) else { return };
    let data = Data::new_copy(&bytes);
    let Some(image) = skia::Image::from_encoded(data) else { return };

    let dst = Rect::from_xywh(
        (x * scale_x) as f32,
        (y * scale_y) as f32,
        (width * scale_x) as f32,
        (height * scale_y) as f32,
    );

    let mut paint = Paint::default();
    paint.set_anti_alias(true);

    canvas.draw_image_rect(&image, None, dst, &paint);
}

/// Draw button outline hints on the scene PNG (mirrors the static preview
/// produced by the old `menu_button_overlay_filter` and `menu_button_label_filter`).
fn draw_button_hints(
    canvas: &Canvas,
    menu_ref: &AuthorableMenuRef<'_>,
    scale_x: f64,
    scale_y: f64,
) {
    let buttons = menu_ref.buttons();
    if buttons.is_empty() {
        return;
    }

    let default_button_id = menu_ref.default_button_id();
    let highlight_colours = menu_ref.highlight_colours();

    for button in &buttons {
        let is_default = default_button_id == Some(button.id);

        // Outline colour: select colour at 50% alpha for default, neutral hint otherwise.
        let outline_colour = if is_default {
            let mut c = parse_colour(&highlight_colours.select_colour);
            c = Color::from_argb(128, c.r(), c.g(), c.b()); // ~50% alpha
            c
        } else {
            Color::from_argb(71, 255, 255, 255) // white@0.28
        };

        let rect = Rect::from_xywh(
            (button.x * scale_x) as f32,
            (button.y * scale_y) as f32,
            (button.width * scale_x) as f32,
            (button.height * scale_y) as f32,
        );

        let mut paint = Paint::default();
        paint.set_color(outline_colour);
        paint.set_style(PaintStyle::Stroke);
        paint.set_stroke_width(2.0);
        paint.set_anti_alias(true);

        canvas.draw_rect(rect, &paint);

        // Button label
        let label = button.label.trim();
        if !label.is_empty() {
            let btn_h = (button.height * scale_y) as f32;
            let font_size = (btn_h * 0.34).clamp(14.0, 30.0);
            let typeface = FontMgr::new()
                .legacy_make_typeface(None, FontStyle::normal())
                .expect("default typeface should always be available");
            let font = Font::new(typeface, font_size);

            let mut text_paint = Paint::default();
            text_paint.set_color(Color::WHITE);
            text_paint.set_anti_alias(true);

            let mut shadow_paint = Paint::default();
            shadow_paint.set_color(Color::BLACK);
            shadow_paint.set_anti_alias(true);

            let btn_x = (button.x * scale_x) as f32;
            let btn_y = (button.y * scale_y) as f32;
            let btn_w = (button.width * scale_x) as f32;

            let (text_width, _) = font.measure_str(label, Some(&text_paint));
            let text_x = btn_x + (btn_w - text_width) / 2.0;
            let (_, metrics) = font.metrics();
            let text_height = metrics.descent - metrics.ascent;
            let text_y = btn_y + (btn_h - text_height) / 2.0 - metrics.ascent;

            canvas.draw_str(label, Point::new(text_x + 2.0, text_y + 2.0), &font, &shadow_paint);
            canvas.draw_str(label, Point::new(text_x, text_y), &font, &text_paint);
        }
    }
}

// ── Overlay renderer ──────────────────────────────────────────────────────────

/// Render a single subpicture overlay image (highlight or select) with Skia.
/// The surface is transparent; only the button outlines are drawn.
pub(crate) fn render_menu_overlay_image_skia(
    button_bounds: &[MenuOverlayButton],
    colour: &str,
    target: RenderTarget,
    output_path: &Path,
) -> crate::Result<()> {
    let w = target.raster_width as i32;
    let h = target.raster_height as i32;

    let info = ImageInfo::new(
        ISize::new(w, h),
        ColorType::RGBA8888,
        AlphaType::Premul,
        None,
    );

    let mut surface = surfaces::raster(&info, None, None)
        .ok_or_else(|| crate::Error::Build("Failed to create Skia overlay surface".into()))?;

    let canvas = surface.canvas();
    canvas.clear(Color::TRANSPARENT);

    let stroke_colour = parse_colour_name_or_hex(colour);

    let mut paint = Paint::default();
    paint.set_color(stroke_colour);
    paint.set_style(PaintStyle::Stroke);
    paint.set_stroke_width(2.0);
    paint.set_anti_alias(true);

    for button in button_bounds {
        let bw = (button.x1 - button.x0).max(1) as f32;
        let bh = (button.y1 - button.y0).max(1) as f32;
        let rect = Rect::from_xywh(button.x0 as f32, button.y0 as f32, bw, bh);
        canvas.draw_rect(rect, &paint);
    }

    let image = surface.image_snapshot();
    let encoded = image
        .encode(None, EncodedImageFormat::PNG, None)
        .ok_or_else(|| crate::Error::Build("Failed to encode Skia overlay as PNG".into()))?;

    std::fs::write(output_path, encoded.as_bytes())
        .map_err(|e| crate::Error::Build(format!("Failed to write overlay PNG to {}: {e}", output_path.display())))
}

// ── Named colour helper ───────────────────────────────────────────────────────

/// Accept either a CSS hex string or a small set of named colours used in menus.
fn parse_colour_name_or_hex(s: &str) -> Color {
    match s.to_ascii_lowercase().as_str() {
        "white" => Color::WHITE,
        "black" => Color::BLACK,
        "red" => Color::from_argb(255, 255, 0, 0),
        "green" => Color::from_argb(255, 0, 128, 0),
        "blue" => Color::from_argb(255, 0, 0, 255),
        "yellow" => Color::from_argb(255, 255, 255, 0),
        "cyan" => Color::from_argb(255, 0, 255, 255),
        "magenta" => Color::from_argb(255, 255, 0, 255),
        _ => parse_colour(s),
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::models::*;

    use super::super::menu::{AuthorableMenuRef, MenuDomain};
    use super::super::types::MenuOverlayButton;
    use super::*;

    fn minimal_menu_ref() -> (Menu, ()) {
        let menu = Menu {
            id: "test-menu".to_string(),
            name: "Test".to_string(),
            authored_document: Some(MenuDocument {
                id: "test-menu".to_string(),
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
                            id: "s1".to_string(),
                            x: 10.0,
                            y: 20.0,
                            width: 100.0,
                            height: 50.0,
                            fill: Some("#ff0000".to_string()),
                        },
                        SceneNode::Text {
                            id: "t1".to_string(),
                            content: "Hello".to_string(),
                            x: 50.0,
                            y: 100.0,
                            width: 200.0,
                            height: 40.0,
                            font_size: Some(24.0),
                            font_family: None,
                            font_weight: None,
                            font_italic: None,
                            text_decoration: None,
                            text_align: None,
                            colour: Some("white".to_string()),
                            line_height: None,
                            letter_spacing: None,
                        },
                        SceneNode::Button {
                            id: "btn-1".to_string(),
                            label: "Play".to_string(),
                            x: 100.0,
                            y: 200.0,
                            width: 200.0,
                            height: 50.0,
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
        (menu, ())
    }

    fn dvd_ntsc_target() -> RenderTarget {
        RenderTarget {
            family: DiscFamily::DvdVideo,
            standard: Some(VideoStandard::Ntsc),
            raster_width: 720,
            raster_height: 480,
            sar_num: 8,
            sar_den: 9,
        }
    }

    /// PNG magic bytes: 0x89 P N G \r \n \x1a \n
    fn is_valid_png(bytes: &[u8]) -> bool {
        bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    }

    /// Read a big-endian u32 from `bytes` at `offset`.
    fn read_u32_be(bytes: &[u8], offset: usize) -> u32 {
        u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap())
    }

    #[test]
    fn parse_colour_hex6_round_trips() {
        let c = parse_colour("#ff8040");
        assert_eq!(c.r(), 0xff);
        assert_eq!(c.g(), 0x80);
        assert_eq!(c.b(), 0x40);
        assert_eq!(c.a(), 255);
    }

    #[test]
    fn parse_colour_hex8_includes_alpha() {
        let c = parse_colour("#ff804080");
        assert_eq!(c.r(), 0xff);
        assert_eq!(c.g(), 0x80);
        assert_eq!(c.b(), 0x40);
        assert_eq!(c.a(), 0x80);
    }

    #[test]
    fn parse_colour_invalid_falls_back_to_black() {
        let c = parse_colour("notacolour");
        assert_eq!(c, Color::BLACK);
    }

    #[test]
    fn render_menu_scene_to_png_produces_valid_png_at_raster_dimensions() {
        let (menu, _) = minimal_menu_ref();
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: MenuDomain::Vmgm,
        };
        let assets: HashMap<&str, &Asset> = HashMap::new();
        let target = dvd_ntsc_target();
        let tmp = std::env::temp_dir().join("spindle_test_scene.png");

        render_menu_scene_to_png(&menu_ref, &assets, target, &tmp)
            .expect("render_menu_scene_to_png should succeed");

        let bytes = std::fs::read(&tmp).expect("output PNG should exist");

        assert!(is_valid_png(&bytes), "output should start with PNG magic bytes");

        // IHDR chunk starts at byte 8; width at byte 16, height at byte 20.
        let png_width = read_u32_be(&bytes, 16);
        let png_height = read_u32_be(&bytes, 20);
        assert_eq!(png_width, 720, "PNG width should match raster_width");
        assert_eq!(png_height, 480, "PNG height should match raster_height");

        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn render_menu_overlay_image_skia_produces_valid_png_with_transparent_background() {
        let target = dvd_ntsc_target();
        let buttons = vec![MenuOverlayButton {
            x0: 100,
            y0: 200,
            x1: 300,
            y1: 250,
        }];
        let tmp = std::env::temp_dir().join("spindle_test_overlay.png");

        render_menu_overlay_image_skia(&buttons, "#ffff00", target, &tmp)
            .expect("render_menu_overlay_image_skia should succeed");

        let bytes = std::fs::read(&tmp).expect("overlay PNG should exist");

        assert!(is_valid_png(&bytes), "output should start with PNG magic bytes");

        let png_width = read_u32_be(&bytes, 16);
        let png_height = read_u32_be(&bytes, 20);
        assert_eq!(png_width, 720);
        assert_eq!(png_height, 480);

        let _ = std::fs::remove_file(&tmp);
    }
}
