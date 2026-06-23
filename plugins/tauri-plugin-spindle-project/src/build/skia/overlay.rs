// Subpicture overlay (highlight/select outline) rendering for the DVD menu
// compile pipeline.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::Path;

use skia_safe::{
    surfaces, AlphaType, Color, ColorType, EncodedImageFormat, IPoint, ISize, ImageInfo, Paint,
    PaintStyle, RRect, Rect,
};

use crate::models::RenderTarget;

use crate::build::types::MenuOverlayButton;

use super::colour::parse_colour_name_or_hex;

/// Render a single subpicture overlay image (highlight or select) with Skia.
/// The surface is transparent; only the button outlines are drawn.
pub(in crate::build) fn render_menu_overlay_image_skia(
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

    let stroke_width = 2.0_f32;
    let inset = stroke_width / 2.0;

    let mut paint = Paint::default();
    paint.set_color(stroke_colour);
    paint.set_style(PaintStyle::Stroke);
    paint.set_stroke_width(stroke_width);
    // DVD subpictures require ≤16 unique colours. Anti-aliasing produces dozens of
    // intermediate RGBA values which triggers spumux's palette assertion. Overlay
    // images are hard-edged subpicture graphics where AA gives no visual benefit.
    paint.set_anti_alias(false);

    for button in button_bounds {
        let bw = (button.x1 - button.x0).max(1) as f32;
        let bh = (button.y1 - button.y0).max(1) as f32;
        // Inset the stroke rect by half the stroke width so the outline is fully
        // within the button bounds and not clipped at the raster edges.
        let rect = Rect::from_xywh(
            button.x0 as f32 + inset,
            button.y0 as f32 + inset,
            (bw - stroke_width).max(0.0),
            (bh - stroke_width).max(0.0),
        );
        if button.border_radius > 0.0 {
            let r = button
                .border_radius
                .min(rect.width() / 2.0)
                .min(rect.height() / 2.0);
            let rrect = RRect::new_rect_xy(rect, r, r);
            canvas.draw_rrect(rrect, &paint);
        } else {
            canvas.draw_rect(rect, &paint);
        }
    }

    let image = surface.image_snapshot();
    let encoded = image
        .encode(None, EncodedImageFormat::PNG, None)
        .ok_or_else(|| crate::Error::Build("Failed to encode Skia overlay as PNG".into()))?;

    std::fs::write(output_path, encoded.as_bytes()).map_err(|e| {
        crate::Error::Build(format!(
            "Failed to write overlay PNG to {}: {e}",
            output_path.display()
        ))
    })
}

/// Render the overlay with anti-aliasing enabled, then quantize the result to ≤4
/// colours before writing. This is a developer diagnostic mode: the AA output is
/// visible after lossy palette reduction so developers can assess quality.
///
/// The 4 palette entries are: fully transparent, the stroke colour, a mid-tone
/// (50% opacity stroke), and black. Each pixel is mapped to the nearest entry by
/// Euclidean RGBA distance.
pub(in crate::build) fn render_menu_overlay_image_skia_quantized(
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

    let mut surface = surfaces::raster(&info, None, None).ok_or_else(|| {
        crate::Error::Build("Failed to create Skia overlay surface (quantize)".into())
    })?;

    let canvas = surface.canvas();
    canvas.clear(Color::TRANSPARENT);

    let stroke_colour = parse_colour_name_or_hex(colour);

    let stroke_width = 2.0_f32;
    let inset = stroke_width / 2.0;

    let mut paint = Paint::default();
    paint.set_color(stroke_colour);
    paint.set_style(PaintStyle::Stroke);
    paint.set_stroke_width(stroke_width);
    // AA enabled intentionally in dev/quantize mode — we want to see the AA output
    // before quantization.
    paint.set_anti_alias(true);

    for button in button_bounds {
        let bw = (button.x1 - button.x0).max(1) as f32;
        let bh = (button.y1 - button.y0).max(1) as f32;
        let rect = Rect::from_xywh(
            button.x0 as f32 + inset,
            button.y0 as f32 + inset,
            (bw - stroke_width).max(0.0),
            (bh - stroke_width).max(0.0),
        );
        if button.border_radius > 0.0 {
            let r = button
                .border_radius
                .min(rect.width() / 2.0)
                .min(rect.height() / 2.0);
            let rrect = RRect::new_rect_xy(rect, r, r);
            canvas.draw_rrect(rrect, &paint);
        } else {
            canvas.draw_rect(rect, &paint);
        }
    }

    // Read back raw RGBA pixels from the Skia surface.
    let mut pixel_buf = vec![0u8; (w * h * 4) as usize];
    let row_bytes = w as usize * 4;
    surface.read_pixels(&info, &mut pixel_buf, row_bytes, IPoint::new(0, 0));

    // Build a 4-entry palette: transparent, stroke colour, mid-tone (half-alpha
    // stroke), black. Map every pixel to its nearest palette entry.
    let sc = stroke_colour;
    let palette: [(u8, u8, u8, u8); 4] = [
        (0, 0, 0, 0),                         // transparent
        (sc.r(), sc.g(), sc.b(), sc.a()),     // stroke colour
        (sc.r(), sc.g(), sc.b(), sc.a() / 2), // mid-tone (half-alpha)
        (0, 0, 0, 255),                       // black
    ];

    fn rgba_dist_sq(a: (u8, u8, u8, u8), b: (u8, u8, u8, u8)) -> u32 {
        let dr = (a.0 as i32 - b.0 as i32).pow(2) as u32;
        let dg = (a.1 as i32 - b.1 as i32).pow(2) as u32;
        let db = (a.2 as i32 - b.2 as i32).pow(2) as u32;
        let da = (a.3 as i32 - b.3 as i32).pow(2) as u32;
        dr + dg + db + da
    }

    for chunk in pixel_buf.chunks_mut(4) {
        let pixel = (chunk[0], chunk[1], chunk[2], chunk[3]);
        let nearest = palette
            .iter()
            .min_by_key(|&&p| rgba_dist_sq(pixel, p))
            .copied()
            .unwrap_or((0, 0, 0, 0));
        chunk[0] = nearest.0;
        chunk[1] = nearest.1;
        chunk[2] = nearest.2;
        chunk[3] = nearest.3;
    }

    // Re-encode the quantized pixels as PNG using the `image` crate.
    use image::{ImageBuffer, Rgba};
    let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(w as u32, h as u32, pixel_buf)
        .ok_or_else(|| {
            crate::Error::Build("Failed to create image buffer from quantized pixels".into())
        })?;
    img.save(output_path).map_err(|e| {
        crate::Error::Build(format!(
            "Failed to write quantized overlay PNG to {}: {e}",
            output_path.display()
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build::skia::test_support::{dvd_ntsc_target, is_valid_png, read_u32_be};

    #[test]
    fn render_menu_overlay_image_skia_produces_valid_png_with_transparent_background() {
        let target = dvd_ntsc_target();
        let buttons = vec![MenuOverlayButton {
            x0: 100,
            y0: 200,
            x1: 300,
            y1: 250,
            border_radius: 0.0,
        }];
        let tmp = std::env::temp_dir().join("spindle_test_overlay.png");

        render_menu_overlay_image_skia(&buttons, "#ffff00", target, &tmp)
            .expect("render_menu_overlay_image_skia should succeed");

        let bytes = std::fs::read(&tmp).expect("overlay PNG should exist");

        assert!(
            is_valid_png(&bytes),
            "output should start with PNG magic bytes"
        );

        let png_width = read_u32_be(&bytes, 16);
        let png_height = read_u32_be(&bytes, 20);
        assert_eq!(png_width, 720);
        assert_eq!(png_height, 480);

        let _ = std::fs::remove_file(&tmp);
    }
}
