// Skia-based menu scene and subpicture overlay renderer.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

mod colour;
mod fonts;
mod overlay;
mod scene;
#[cfg(test)]
mod test_support;

pub use fonts::{enumerate_fonts, FontEntry, FontSource};
pub(in crate::build) use overlay::{
    render_menu_overlay_image_skia, render_menu_overlay_image_skia_quantized,
};
pub use scene::render_menu_scene_to_png;
