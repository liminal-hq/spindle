// Render-preview export: DAR-corrected PNG for authoring inspection.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashMap;
use std::path::Path;

use skia_safe::{
    self as skia, surfaces, AlphaType, ColorType, EncodedImageFormat, ISize, ImageInfo,
};

use crate::models::{AspectMode, RenderTarget, SpindleProjectFile};

use super::menu::{AuthorableMenuRef, MenuDomain as BuildMenuDomain};
use super::skia::render_menu_scene_to_png;

/// Export a DAR-corrected render preview PNG for the given menu.
///
/// The preview renders the menu scene at native raster dimensions and then
/// scales the output to display-aspect dimensions (correcting for non-square
/// SAR). For formats with square pixels (Blu-ray, SAR 1:1) no scaling is
/// applied.
///
/// Returns an error if the menu cannot be found, has no authored document,
/// or the PNG cannot be written.
pub fn export_menu_render_preview(
    project: &SpindleProjectFile,
    menu_id: &str,
    output_path: &Path,
) -> crate::Result<()> {
    // 1. Find the menu in the project.
    let menu = find_menu(project, menu_id)
        .ok_or_else(|| crate::Error::Build(format!("Menu '{menu_id}' not found in project")))?;

    if menu.authored_document.is_none() {
        return Err(crate::Error::Build(format!(
            "Menu '{menu_id}' has no authored document — nothing to preview"
        )));
    }

    // 2. Determine display aspect from the authored compile policy, falling back
    //    to the project's default.
    let display_aspect = menu
        .authored_document
        .as_ref()
        .and_then(|doc| doc.compile_policy.display_aspect)
        .unwrap_or(AspectMode::SixteenByNine);

    // 3. Derive the render target.
    let target = RenderTarget::from_disc(&project.disc, display_aspect);

    // 4. Build the asset map.
    let asset_map: HashMap<&str, &crate::models::Asset> =
        project.assets.iter().map(|a| (a.id.as_str(), a)).collect();

    // 5. Render the scene at raster resolution into a temp path, then load,
    //    DAR-correct, and write the final output.
    let tmp = output_path.with_extension("_raw.tmp.png");

    let menu_ref = AuthorableMenuRef {
        menu,
        domain: BuildMenuDomain::Vmgm,
    };
    render_menu_scene_to_png(&menu_ref, &asset_map, target, &tmp, false)?;

    // 6. DAR-correct: if SAR != 1:1, scale the PNG to display-aspect dimensions.
    if target.sar_num == target.sar_den {
        // Square pixels — no correction needed; just rename.
        std::fs::rename(&tmp, output_path)
            .map_err(|e| crate::Error::Build(format!("Failed to write preview PNG: {e}")))?;
    } else {
        let result = dar_correct_png(&tmp, target, output_path);
        let _ = std::fs::remove_file(&tmp);
        result?;
    }

    Ok(())
}

/// Scale `input_png` to display-aspect dimensions and write to `output_path`.
///
/// Display width = raster_width × (sar_num / sar_den), rounded to nearest
/// integer.  Height is unchanged.
fn dar_correct_png(
    input_path: &Path,
    target: RenderTarget,
    output_path: &Path,
) -> crate::Result<()> {
    let bytes = std::fs::read(input_path)
        .map_err(|e| crate::Error::Build(format!("Failed to read raster PNG: {e}")))?;

    let data = skia::Data::new_copy(&bytes);
    let src_image = skia::Image::from_encoded(data).ok_or_else(|| {
        crate::Error::Build("Failed to decode raster PNG for DAR correction".into())
    })?;

    // display_width = raster_width * sar_num / sar_den
    let display_width = ((target.raster_width as f64) * (target.sar_num as f64)
        / (target.sar_den as f64))
        .round() as i32;
    let display_height = target.raster_height as i32;

    let info = ImageInfo::new(
        ISize::new(display_width, display_height),
        ColorType::RGBA8888,
        AlphaType::Opaque,
        None,
    );

    let mut surface = surfaces::raster(&info, None, None).ok_or_else(|| {
        crate::Error::Build("Failed to create DAR-correction Skia surface".into())
    })?;

    let dst = skia::Rect::from_xywh(0.0, 0.0, display_width as f32, display_height as f32);
    let mut paint = skia::Paint::default();
    paint.set_anti_alias(true);

    surface
        .canvas()
        .draw_image_rect(&src_image, None, dst, &paint);

    let image = surface.image_snapshot();
    let encoded = image
        .encode(None, EncodedImageFormat::PNG, None)
        .ok_or_else(|| crate::Error::Build("Failed to encode DAR-corrected PNG".into()))?;

    std::fs::write(output_path, encoded.as_bytes()).map_err(|e| {
        crate::Error::Build(format!(
            "Failed to write preview PNG to {}: {e}",
            output_path.display()
        ))
    })
}

/// Find a menu anywhere in the project (global menus + all titleset menus).
fn find_menu<'a>(
    project: &'a SpindleProjectFile,
    menu_id: &str,
) -> Option<&'a crate::models::Menu> {
    project
        .disc
        .global_menus
        .iter()
        .find(|m| m.id == menu_id)
        .or_else(|| {
            project
                .disc
                .titlesets
                .iter()
                .flat_map(|ts| ts.menus.iter())
                .find(|m| m.id == menu_id)
        })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use crate::models::{self, *};

    use super::*;

    fn dvd_project_with_menu(menu_id: &str) -> SpindleProjectFile {
        let menu = Menu {
            id: menu_id.to_string(),
            name: "Preview Test".to_string(),
            authored_document: Some(MenuDocument {
                id: menu_id.to_string(),
                name: "Preview Test Menu".to_string(),
                domain: models::MenuDomain::Vmgm,
                scene: MenuScene {
                    design_size: MenuSize {
                        width: 1024.0,
                        height: 576.0,
                        aspect: AspectMode::SixteenByNine,
                    },
                    background: SceneBackground {
                        asset_id: None,
                        colour: Some("#0a0a14".to_string()),
                    },
                    nodes: vec![SceneNode::Shape {
                        id: "rect1".to_string(),
                        x: 50.0,
                        y: 50.0,
                        width: 200.0,
                        height: 100.0,
                        fill: Some("#336699".to_string()),
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

        let mut project = SpindleProjectFile::default();
        project.disc.global_menus.push(menu);
        project
    }

    /// PNG magic bytes: 0x89 P N G \r \n \x1a \n
    fn is_valid_png(bytes: &[u8]) -> bool {
        bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    }

    fn read_u32_be(bytes: &[u8], offset: usize) -> u32 {
        u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap())
    }

    #[test]
    fn export_preview_returns_ok_and_writes_png() {
        let project = dvd_project_with_menu("preview-menu");
        let tmp = std::env::temp_dir().join("spindle_preview_test.png");

        export_menu_render_preview(&project, "preview-menu", &tmp)
            .expect("export_menu_render_preview should succeed");

        let bytes = std::fs::read(&tmp).expect("preview PNG should be written");
        assert!(is_valid_png(&bytes), "output should be a valid PNG");

        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn export_preview_output_dimensions_are_dar_corrected() {
        let project = dvd_project_with_menu("dar-menu");
        let tmp = std::env::temp_dir().join("spindle_dar_test.png");

        export_menu_render_preview(&project, "dar-menu", &tmp)
            .expect("export_menu_render_preview should succeed");

        let bytes = std::fs::read(&tmp).expect("preview PNG should be written");

        // DVD NTSC 16:9: raster 720×480, SAR 32/27.
        // Display width = 720 × 32/27 ≈ 853px; height = 480.
        let expected_w = ((720.0_f64) * (32.0 / 27.0)).round() as u32;
        let png_w = read_u32_be(&bytes, 16);
        let png_h = read_u32_be(&bytes, 20);

        assert_eq!(png_w, expected_w, "preview width should be DAR-corrected");
        assert_eq!(png_h, 480, "preview height should match raster height");

        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn export_preview_errors_for_unknown_menu_id() {
        let project = dvd_project_with_menu("real-menu");
        let tmp = std::env::temp_dir().join("spindle_no_menu.png");

        let result = export_menu_render_preview(&project, "does-not-exist", &tmp);
        assert!(
            result.is_err(),
            "should return an error for unknown menu ID"
        );
    }

    #[test]
    fn export_preview_errors_for_menu_without_authored_document() {
        let mut project = SpindleProjectFile::default();
        project.disc.global_menus.push(Menu {
            id: "bare-menu".to_string(),
            name: "Bare".to_string(),
            authored_document: None,
            ..Menu::default()
        });

        let tmp = std::env::temp_dir().join("spindle_no_doc.png");
        let result = export_menu_render_preview(&project, "bare-menu", &tmp);
        assert!(
            result.is_err(),
            "should return an error for menu without authored document"
        );
    }
}
