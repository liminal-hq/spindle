// Top-level menu scene rendering: shapes, text, images, and buttons, plus the
// default-button focus hint drawn over the preview (not the final DVD output).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashMap;
use std::path::Path;

use skia_safe::{
    self as skia, surfaces, AlphaType, Canvas, Color, ColorType, Data, EncodedImageFormat, Font,
    ISize, ImageInfo, Paint, PaintStyle, Point, RRect, Rect,
};

use crate::models::{Asset, FontWeight, RenderTarget, SceneNode, TextDecoration, TextStyle};

use crate::build::menu::AuthorableMenuRef;

use super::colour::{parse_colour, parse_colour_name_or_hex};
use super::fonts::{min_font_size_pt, FontCache};

/// Render the full menu scene (shapes, text, images, button outlines) to a PNG
/// at raster resolution. This replaces the `drawbox`/`drawtext` filter chain in
/// `build_ffmpeg_menu_command`.
///
/// When `transparent_bg` is `true` the PNG has a fully transparent background,
/// suitable for compositing over a separate background layer in the ffmpeg
/// pipeline.  When `false` the PNG gets an opaque dark fill so it works as a
/// standalone preview image.
pub fn render_menu_scene_to_png(
    menu_ref: &AuthorableMenuRef<'_>,
    assets: &HashMap<&str, &Asset>,
    target: RenderTarget,
    output_path: &Path,
    transparent_bg: bool,
) -> crate::Result<()> {
    let w = target.raster_width as i32;
    let h = target.raster_height as i32;

    let alpha_type = if transparent_bg {
        AlphaType::Premul
    } else {
        AlphaType::Opaque
    };
    let info = ImageInfo::new(ISize::new(w, h), ColorType::RGBA8888, alpha_type, None);

    let mut surface = surfaces::raster(&info, None, None)
        .ok_or_else(|| crate::Error::Build("Failed to create Skia surface".into()))?;

    let canvas = surface.canvas();

    if transparent_bg {
        canvas.clear(Color::TRANSPARENT);
    } else {
        canvas.clear(Color::from_argb(255, 16, 16, 20));
    }

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

    let asset_slice: Vec<&Asset> = assets.values().copied().collect();
    let font_cache = FontCache::new(&asset_slice);

    // Draw scene nodes.
    for node in menu_ref.scene_nodes() {
        draw_scene_node(canvas, node, assets, &font_cache, target, scale_x, scale_y)?;
    }

    // Draw focus indicator on the default button (preview hint only — not present in final DVD).
    // Skip in build mode (transparent_bg) since the DVD player draws its own subpicture highlight.
    if !transparent_bg {
        draw_default_button_hint(canvas, menu_ref, scale_x, scale_y);
    }

    // Encode and write.
    let image = surface.image_snapshot();
    let encoded = image
        .encode(None, EncodedImageFormat::PNG, None)
        .ok_or_else(|| crate::Error::Build("Failed to encode Skia surface as PNG".into()))?;

    std::fs::write(output_path, encoded.as_bytes()).map_err(|e| {
        crate::Error::Build(format!(
            "Failed to write PNG to {}: {e}",
            output_path.display()
        ))
    })
}

fn draw_scene_node(
    canvas: &Canvas,
    node: &SceneNode,
    assets: &HashMap<&str, &Asset>,
    font_cache: &FontCache,
    target: RenderTarget,
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
            font_family,
            font_weight,
            font_italic,
            text_decoration,
            letter_spacing,
            colour,
            ..
        } => {
            let colour = parse_colour_name_or_hex(colour.as_deref().unwrap_or("white"));

            let weight = font_weight.unwrap_or(FontWeight::Normal);
            let italic = font_italic.unwrap_or(false);

            // Apply per-format minimum font size before scaling.
            let raw_size = font_size.unwrap_or(24.0) as f32;
            let min_size = min_font_size_pt(target.family);
            let clamped_size = raw_size.max(min_size);
            let scaled_size = (clamped_size as f64 * scale_y) as f32;

            let default_family = TextStyle::default().font_family;
            let resolved_family = font_family.as_deref().unwrap_or(&default_family);
            let font = font_cache.resolve(Some(resolved_family), weight, italic, scaled_size);

            let mut paint = Paint::default();
            paint.set_color(colour);
            paint.set_anti_alias(true);

            let mut shadow_paint = Paint::default();
            shadow_paint.set_color(Color::from_argb(153, 0, 0, 0)); // black@0.6
            shadow_paint.set_anti_alias(true);

            let scaled_x = (x * scale_x) as f32;
            let scaled_y = (y * scale_y) as f32;
            let scaled_w = (width * scale_x) as f32;
            let scaled_h = (height * scale_y) as f32;

            let spacing = letter_spacing.unwrap_or(0.0) as f32;

            // Measure text width accounting for letter-spacing.
            let text_width = measure_text_with_spacing(content, &font, &paint, spacing);

            let text_x = scaled_x + (scaled_w - text_width) / 2.0;
            let (_, metrics) = font.metrics();
            let text_height = metrics.descent - metrics.ascent;
            let text_y = scaled_y + (scaled_h - text_height) / 2.0 - metrics.ascent;

            // Draw text — with manual letter-spacing if non-zero, otherwise use
            // the faster single draw_str path.
            if spacing.abs() > f32::EPSILON {
                draw_text_with_spacing(
                    canvas,
                    content,
                    &font,
                    Point::new(text_x + 2.0, text_y + 2.0),
                    spacing,
                    &shadow_paint,
                );
                draw_text_with_spacing(
                    canvas,
                    content,
                    &font,
                    Point::new(text_x, text_y),
                    spacing,
                    &paint,
                );
            } else {
                canvas.draw_str(
                    content.as_str(),
                    Point::new(text_x + 2.0, text_y + 2.0),
                    &font,
                    &shadow_paint,
                );
                canvas.draw_str(content.as_str(), Point::new(text_x, text_y), &font, &paint);
            }

            // Underline decoration: draw a line under the text bounds.
            if text_decoration == &Some(TextDecoration::Underline) {
                let underline_y = text_y + metrics.descent * 0.5;
                let mut ul_paint = paint.clone();
                ul_paint.set_stroke_width(1.5_f32.max(scaled_size * 0.05));
                ul_paint.set_style(PaintStyle::Stroke);
                canvas.draw_line(
                    Point::new(text_x, underline_y),
                    Point::new(text_x + text_width, underline_y),
                    &ul_paint,
                );
            }
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

        SceneNode::Button {
            id: _,
            label,
            x,
            y,
            width,
            height,
            button_style,
            label_style,
            ..
        } => {
            let style = button_style
                .as_ref()
                .map(|bsm| &bsm.normal)
                .cloned()
                .unwrap_or_default();

            let scaled_x = (x * scale_x) as f32;
            let scaled_y = (y * scale_y) as f32;
            let scaled_w = (width * scale_x) as f32;
            let scaled_h = (height * scale_y) as f32;

            let radius = (style.border_radius * scale_x.min(scale_y)) as f32;
            let rect = Rect::from_xywh(scaled_x, scaled_y, scaled_w, scaled_h);
            let rrect = if radius > 0.0 {
                RRect::new_rect_xy(rect, radius, radius)
            } else {
                RRect::new_rect(rect)
            };

            // Background fill.
            let fill_colour = parse_colour_name_or_hex(&style.bg_fill);
            if fill_colour.a() > 0 {
                let mut fill_paint = Paint::default();
                fill_paint.set_color(fill_colour);
                fill_paint.set_anti_alias(true);
                fill_paint.set_style(PaintStyle::Fill);
                canvas.draw_rrect(rrect, &fill_paint);
            }

            // Border stroke.
            let border_colour = parse_colour_name_or_hex(&style.border_colour);
            if style.border_width > 0.0 && border_colour.a() > 0 {
                let mut stroke_paint = Paint::default();
                stroke_paint.set_color(border_colour);
                stroke_paint.set_anti_alias(true);
                stroke_paint.set_style(PaintStyle::Stroke);
                stroke_paint.set_stroke_width((style.border_width * scale_x.min(scale_y)) as f32);
                canvas.draw_rrect(rrect, &stroke_paint);
            }

            // Label text — centred within padded area, scaled down to fit.
            let label = label.trim();
            if !label.is_empty() {
                let pad_h = style.padding_h as f32;
                let defaults = TextStyle::default();
                let (fam, raw_size, weight, italic, spacing, text_colour) =
                    if let Some(ls) = label_style {
                        (
                            ls.font_family.as_str(),
                            ls.font_size as f32,
                            ls.font_weight,
                            ls.font_italic,
                            ls.letter_spacing as f32,
                            parse_colour_name_or_hex(&ls.colour),
                        )
                    } else {
                        (
                            defaults.font_family.as_str(),
                            defaults.font_size as f32,
                            defaults.font_weight,
                            defaults.font_italic,
                            defaults.letter_spacing as f32,
                            parse_colour_name_or_hex(&defaults.colour),
                        )
                    };

                let min_size = min_font_size_pt(target.family);
                let clamped = raw_size.max(min_size);
                let scaled_size = (clamped as f64 * scale_y) as f32;
                let scaled_pad_h = (pad_h as f64 * scale_x) as f32;
                let inner_w = (scaled_w - scaled_pad_h * 2.0).max(0.0);

                // Scale the font down if the label text overflows the padded
                // button area, so the full label is always readable (matching
                // the front-end's visual shrink-to-fit behaviour).
                let (font, text_width) = fit_font_to_width(
                    font_cache,
                    Some(fam),
                    weight,
                    italic,
                    scaled_size,
                    label,
                    spacing,
                    inner_w,
                );

                let mut text_paint = Paint::default();
                text_paint.set_color(text_colour);
                text_paint.set_anti_alias(true);

                let mut shadow_paint = Paint::default();
                shadow_paint.set_color(Color::from_argb(153, 0, 0, 0));
                shadow_paint.set_anti_alias(true);

                let (_, metrics) = font.metrics();
                let text_height = metrics.descent - metrics.ascent;
                let text_x = scaled_x + scaled_pad_h + (inner_w - text_width) / 2.0;
                let text_y = scaled_y + (scaled_h - text_height) / 2.0 - metrics.ascent;

                if spacing.abs() > f32::EPSILON {
                    draw_text_with_spacing(
                        canvas,
                        label,
                        &font,
                        Point::new(text_x + 2.0, text_y + 2.0),
                        spacing,
                        &shadow_paint,
                    );
                    draw_text_with_spacing(
                        canvas,
                        label,
                        &font,
                        Point::new(text_x, text_y),
                        spacing,
                        &text_paint,
                    );
                } else {
                    canvas.draw_str(
                        label,
                        Point::new(text_x + 2.0, text_y + 2.0),
                        &font,
                        &shadow_paint,
                    );
                    canvas.draw_str(label, Point::new(text_x, text_y), &font, &text_paint);
                }
            }
        }

        // Group, Video, ComponentInstance, GeneratedCollection → skip.
        _ => {}
    }
    Ok(())
}

/// Measure the rendered width of `text` with extra letter-spacing applied.
fn measure_text_with_spacing(text: &str, font: &Font, paint: &Paint, spacing: f32) -> f32 {
    if text.is_empty() {
        return 0.0;
    }
    let (base_width, _) = font.measure_str(text, Some(paint));
    // Spacing is added between each pair of characters.
    let char_count = text.chars().count() as f32;
    base_width + spacing * (char_count - 1.0).max(0.0)
}

/// Draw `text` glyph-by-glyph, inserting `spacing` extra pixels between each character.
fn draw_text_with_spacing(
    canvas: &Canvas,
    text: &str,
    font: &Font,
    origin: Point,
    spacing: f32,
    paint: &Paint,
) {
    let mut cursor_x = origin.x;
    for ch in text.chars() {
        let ch_str: &str = &ch.to_string();
        canvas.draw_str(ch_str, Point::new(cursor_x, origin.y), font, paint);
        let (advance, _) = font.measure_str(ch_str, Some(paint));
        cursor_x += advance + spacing;
    }
}

/// Scale the font size down so that `text` fits within `max_width` pixels.
///
/// Returns the (possibly smaller) `Font` and the measured text width.
/// If the text already fits at `size`, returns the font unchanged.
#[allow(clippy::too_many_arguments)]
fn fit_font_to_width(
    font_cache: &FontCache,
    family: Option<&str>,
    weight: FontWeight,
    italic: bool,
    size: f32,
    text: &str,
    spacing: f32,
    max_width: f32,
) -> (Font, f32) {
    let font = font_cache.resolve(family, weight, italic, size);
    let paint = Paint::default();
    let text_width = measure_text_with_spacing(text, &font, &paint, spacing);

    if max_width <= 0.0 || text_width <= max_width {
        return (font, text_width);
    }

    // Scale down proportionally so the text fits, with a floor of 4px to
    // avoid degenerate zero-size fonts.
    let ratio = max_width / text_width;
    let new_size = (size * ratio).max(4.0);
    let new_font = font_cache.resolve(family, weight, italic, new_size);
    let new_width = measure_text_with_spacing(text, &new_font, &paint, spacing);
    (new_font, new_width)
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
    let Ok(bytes) = std::fs::read(path) else {
        return;
    };
    let data = Data::new_copy(&bytes);
    let Some(image) = skia::Image::from_encoded(data) else {
        return;
    };

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

/// Draw a focus indicator outline on the default (initially focused) button.
///
/// Buttons are already fully rendered by `draw_scene_node`. This layer adds a
/// subtle highlight ring over the default button so designers can tell at a
/// glance which button receives focus on disc load.
fn draw_default_button_hint(
    canvas: &Canvas,
    menu_ref: &AuthorableMenuRef<'_>,
    scale_x: f64,
    scale_y: f64,
) {
    let default_button_id = menu_ref.default_button_id();
    let Some(default_id) = default_button_id else {
        return;
    };

    let highlight_colours = menu_ref.highlight_colours();

    // Find the default button directly from scene nodes to get button_style.
    let node = menu_ref
        .scene_nodes()
        .into_iter()
        .find(|n| matches!(n, SceneNode::Button { id, .. } if id == default_id));
    let Some(node) = node else { return };

    let (x, y, width, height, border_radius) = match node {
        SceneNode::Button {
            x,
            y,
            width,
            height,
            button_style,
            ..
        } => {
            let raw_r = button_style
                .as_ref()
                .map(|bs| bs.normal.border_radius as f32)
                .unwrap_or(0.0);
            let r = (raw_r * scale_x.min(scale_y) as f32).max(0.0);
            (*x, *y, *width, *height, r)
        }
        _ => return,
    };

    let c = parse_colour(&highlight_colours.select_colour);
    let outline_colour = Color::from_argb(180, c.r(), c.g(), c.b());

    let stroke_width = 2.5_f32;
    let inset = stroke_width / 2.0;

    let rect = Rect::from_xywh(
        (x * scale_x) as f32 + inset,
        (y * scale_y) as f32 + inset,
        ((width * scale_x) as f32 - stroke_width).max(0.0),
        ((height * scale_y) as f32 - stroke_width).max(0.0),
    );

    let mut paint = Paint::default();
    paint.set_color(outline_colour);
    paint.set_style(PaintStyle::Stroke);
    paint.set_stroke_width(stroke_width);
    paint.set_anti_alias(true);

    if border_radius > 0.0 {
        let r = border_radius
            .min(rect.width() / 2.0)
            .min(rect.height() / 2.0);
        let rrect = RRect::new_rect_xy(rect, r, r);
        canvas.draw_rrect(rrect, &paint);
    } else {
        canvas.draw_rect(rect, &paint);
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::models::*;

    use super::*;
    use crate::build::menu::MenuDomain;
    use crate::build::skia::test_support::{
        dvd_ntsc_target, is_valid_png, menu_with_text_node, read_u32_be,
    };

    #[test]
    fn render_menu_scene_to_png_produces_valid_png_at_raster_dimensions() {
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
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: MenuDomain::Vmgm,
        };
        let assets: HashMap<&str, &Asset> = HashMap::new();
        let target = dvd_ntsc_target();
        let tmp = std::env::temp_dir().join("spindle_test_scene.png");

        render_menu_scene_to_png(&menu_ref, &assets, target, &tmp, false)
            .expect("render_menu_scene_to_png should succeed");

        let bytes = std::fs::read(&tmp).expect("output PNG should exist");

        assert!(
            is_valid_png(&bytes),
            "output should start with PNG magic bytes"
        );

        // IHDR chunk starts at byte 8; width at byte 16, height at byte 20.
        let png_width = read_u32_be(&bytes, 16);
        let png_height = read_u32_be(&bytes, 20);
        assert_eq!(png_width, 720, "PNG width should match raster_width");
        assert_eq!(png_height, 480, "PNG height should match raster_height");

        let _ = std::fs::remove_file(&tmp);
    }

    // ── Phase 4 typography tests ──────────────────────────────────────────────

    /// Bold text should produce a visibly different raster from normal-weight text.
    /// We render the same string twice and assert the PNGs differ.
    #[test]
    fn render_bold_text_differs_from_normal_weight() {
        fn render_with_weight(weight: FontWeight, path: &std::path::Path) {
            let menu = menu_with_text_node(weight, false, None, 24.0);
            let menu_ref = AuthorableMenuRef {
                menu: &menu,
                domain: MenuDomain::Vmgm,
            };
            let assets: HashMap<&str, &Asset> = HashMap::new();
            render_menu_scene_to_png(&menu_ref, &assets, dvd_ntsc_target(), path, false)
                .expect("render should succeed");
        }

        let tmp_normal = std::env::temp_dir().join("spindle_test_normal.png");
        let tmp_bold = std::env::temp_dir().join("spindle_test_bold.png");

        render_with_weight(FontWeight::Normal, &tmp_normal);
        render_with_weight(FontWeight::Bold, &tmp_bold);

        let normal_bytes = std::fs::read(&tmp_normal).unwrap();
        let bold_bytes = std::fs::read(&tmp_bold).unwrap();

        assert_ne!(
            normal_bytes, bold_bytes,
            "bold render should differ from normal render"
        );

        let _ = std::fs::remove_file(&tmp_normal);
        let _ = std::fs::remove_file(&tmp_bold);
    }

    /// Positive letter-spacing should produce a wider text rendering (different PNG).
    #[test]
    fn render_letter_spacing_affects_output() {
        fn render_with_spacing(spacing: f64, path: &std::path::Path) {
            let menu = menu_with_text_node(FontWeight::Normal, false, Some(spacing), 24.0);
            let menu_ref = AuthorableMenuRef {
                menu: &menu,
                domain: MenuDomain::Vmgm,
            };
            let assets: HashMap<&str, &Asset> = HashMap::new();
            render_menu_scene_to_png(&menu_ref, &assets, dvd_ntsc_target(), path, false)
                .expect("render should succeed");
        }

        let tmp_no_spacing = std::env::temp_dir().join("spindle_test_no_spacing.png");
        let tmp_with_spacing = std::env::temp_dir().join("spindle_test_with_spacing.png");

        render_with_spacing(0.0, &tmp_no_spacing);
        render_with_spacing(6.0, &tmp_with_spacing);

        let no_spacing_bytes = std::fs::read(&tmp_no_spacing).unwrap();
        let with_spacing_bytes = std::fs::read(&tmp_with_spacing).unwrap();

        assert_ne!(
            no_spacing_bytes, with_spacing_bytes,
            "letter-spacing should change the rendered output"
        );

        let _ = std::fs::remove_file(&tmp_no_spacing);
        let _ = std::fs::remove_file(&tmp_with_spacing);
    }

    /// A 10pt font on a VCD target should be clamped to the 18pt VCD minimum.
    #[test]
    fn font_size_clamped_to_vcd_minimum() {
        let vcd_target = RenderTarget {
            family: DiscFamily::Vcd,
            standard: Some(VideoStandard::Ntsc),
            raster_width: 352,
            raster_height: 240,
            sar_num: 10,
            sar_den: 11,
        };

        // Render with a 10pt font on VCD — should be clamped to 18pt.
        let menu = menu_with_text_node(FontWeight::Normal, false, None, 10.0);
        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: MenuDomain::Vmgm,
        };
        let assets: HashMap<&str, &Asset> = HashMap::new();
        let tmp = std::env::temp_dir().join("spindle_test_vcd_clamped.png");

        render_menu_scene_to_png(&menu_ref, &assets, vcd_target, &tmp, false)
            .expect("render should succeed with clamped font size");

        assert!(tmp.exists(), "output PNG should be written");

        // Render again with an 18pt font on VCD — should be identical (both clamped to 18pt).
        let menu_18 = menu_with_text_node(FontWeight::Normal, false, None, 18.0);
        let menu_ref_18 = AuthorableMenuRef {
            menu: &menu_18,
            domain: MenuDomain::Vmgm,
        };
        let tmp_18 = std::env::temp_dir().join("spindle_test_vcd_18pt.png");

        render_menu_scene_to_png(&menu_ref_18, &assets, vcd_target, &tmp_18, false)
            .expect("render should succeed at 18pt");

        let clamped_bytes = std::fs::read(&tmp).unwrap();
        let explicit_18_bytes = std::fs::read(&tmp_18).unwrap();

        assert_eq!(
            clamped_bytes, explicit_18_bytes,
            "10pt clamped to VCD minimum should render identically to 18pt"
        );

        let _ = std::fs::remove_file(&tmp);
        let _ = std::fs::remove_file(&tmp_18);
    }

    // ── Button rendering tests ─────────────────────────────────────────────────

    /// A menu with a styled button should produce a PNG that differs from an
    /// identical menu without the button — proving the button body is drawn.
    #[test]
    fn render_button_node_affects_scene_output() {
        fn make_menu_with_button(include_button: bool) -> Menu {
            let nodes = if include_button {
                vec![SceneNode::Button {
                    id: "btn-test".to_string(),
                    label: "Play".to_string(),
                    x: 200.0,
                    y: 200.0,
                    width: 200.0,
                    height: 50.0,
                    highlight_mode: HighlightMode::Static,
                    highlight_keyframes: vec![],
                    video_asset_id: None,
                    button_style: Some(ButtonStyleMap {
                        normal: ButtonStateStyle {
                            bg_fill: "#ff0000".to_string(),
                            border_colour: "#ffffff".to_string(),
                            border_width: 2.0,
                            border_radius: 0.0,
                            ..ButtonStateStyle::default()
                        },
                        ..ButtonStyleMap::default()
                    }),
                    label_style: None,
                }]
            } else {
                vec![]
            };

            Menu {
                id: "btn-test-menu".to_string(),
                authored_document: Some(MenuDocument {
                    id: "btn-test-menu".to_string(),
                    name: "Button Test".to_string(),
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
                        nodes,
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
            }
        }

        let with_button = make_menu_with_button(true);
        let without_button = make_menu_with_button(false);

        let ref_with = AuthorableMenuRef {
            menu: &with_button,
            domain: MenuDomain::Vmgm,
        };
        let ref_without = AuthorableMenuRef {
            menu: &without_button,
            domain: MenuDomain::Vmgm,
        };

        let assets: HashMap<&str, &Asset> = HashMap::new();
        let target = dvd_ntsc_target();

        let tmp_with = std::env::temp_dir().join("spindle_test_btn_with.png");
        let tmp_without = std::env::temp_dir().join("spindle_test_btn_without.png");

        render_menu_scene_to_png(&ref_with, &assets, target, &tmp_with, false)
            .expect("render with button should succeed");
        render_menu_scene_to_png(&ref_without, &assets, target, &tmp_without, false)
            .expect("render without button should succeed");

        let bytes_with = std::fs::read(&tmp_with).unwrap();
        let bytes_without = std::fs::read(&tmp_without).unwrap();

        assert_ne!(
            bytes_with, bytes_without,
            "scene PNG with a styled button must differ from scene PNG without one"
        );

        let _ = std::fs::remove_file(&tmp_with);
        let _ = std::fs::remove_file(&tmp_without);
    }

    /// A button with an rgba() bg_fill should render without panicking and
    /// produce a valid PNG.
    #[test]
    fn render_button_with_rgba_fill_produces_valid_png() {
        let menu = Menu {
            id: "rgba-btn-menu".to_string(),
            authored_document: Some(MenuDocument {
                id: "rgba-btn-menu".to_string(),
                name: "RGBA Fill Test".to_string(),
                domain: crate::models::MenuDomain::Vmgm,
                scene: MenuScene {
                    design_size: MenuSize {
                        width: 720.0,
                        height: 480.0,
                        aspect: AspectMode::SixteenByNine,
                    },
                    background: SceneBackground {
                        asset_id: None,
                        colour: None,
                    },
                    nodes: vec![SceneNode::Button {
                        id: "rgba-btn".to_string(),
                        label: "OK".to_string(),
                        x: 100.0,
                        y: 100.0,
                        width: 200.0,
                        height: 50.0,
                        highlight_mode: HighlightMode::Static,
                        highlight_keyframes: vec![],
                        video_asset_id: None,
                        button_style: Some(ButtonStyleMap {
                            normal: ButtonStateStyle {
                                bg_fill: "rgba(255, 255, 255, 0.04)".to_string(),
                                border_colour: "rgba(255, 255, 255, 0.12)".to_string(),
                                border_width: 1.5,
                                border_radius: 4.0,
                                ..ButtonStateStyle::default()
                            },
                            ..ButtonStyleMap::default()
                        }),
                        label_style: None,
                    }],
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
        };

        let menu_ref = AuthorableMenuRef {
            menu: &menu,
            domain: MenuDomain::Vmgm,
        };
        let assets: HashMap<&str, &Asset> = HashMap::new();
        let target = dvd_ntsc_target();
        let tmp = std::env::temp_dir().join("spindle_test_rgba_btn.png");

        render_menu_scene_to_png(&menu_ref, &assets, target, &tmp, false)
            .expect("render with rgba fill should succeed without panic");

        let bytes = std::fs::read(&tmp).expect("output PNG should exist");
        assert!(is_valid_png(&bytes), "output should be a valid PNG");

        let _ = std::fs::remove_file(&tmp);
    }
}
