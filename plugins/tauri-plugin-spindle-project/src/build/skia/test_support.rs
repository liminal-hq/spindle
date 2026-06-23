// Shared test fixtures for the skia rendering submodules.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use crate::models::*;

pub(super) fn dvd_ntsc_target() -> RenderTarget {
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
pub(super) fn is_valid_png(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}

/// Read a big-endian u32 from `bytes` at `offset`.
pub(super) fn read_u32_be(bytes: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

pub(super) fn menu_with_text_node(
    weight: FontWeight,
    italic: bool,
    letter_spacing: Option<f64>,
    font_size: f64,
) -> Menu {
    Menu {
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
                nodes: vec![SceneNode::Text {
                    id: "t1".to_string(),
                    content: "Typography".to_string(),
                    x: 100.0,
                    y: 200.0,
                    width: 400.0,
                    height: 80.0,
                    font_size: Some(font_size),
                    font_family: None,
                    font_weight: Some(weight),
                    font_italic: Some(italic),
                    text_decoration: None,
                    text_align: None,
                    colour: Some("white".to_string()),
                    line_height: None,
                    letter_spacing,
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
    }
}
