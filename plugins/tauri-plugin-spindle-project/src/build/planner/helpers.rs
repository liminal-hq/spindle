// Pre-flight validation, subtitle XML generation, and escape-hatch mutation
// helpers used once each by generate_build_plan_with_options.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashMap;

use crate::models::*;

use super::super::util::xml_escape;

pub(super) fn ensure_supported_menu_backend(project: &SpindleProjectFile) -> crate::Result<()> {
    let motion_menus: Vec<_> = project
        .disc
        .global_menus
        .iter()
        .chain(
            project
                .disc
                .titlesets
                .iter()
                .flat_map(|titleset| titleset.menus.iter()),
        )
        .filter(|menu| matches!(menu.resolved_background_mode(), BackgroundMode::Motion))
        .map(|menu| menu.name.clone())
        .collect();

    if motion_menus.is_empty() {
        return Ok(());
    }

    Err(crate::Error::Build(format!(
        "Motion menu build authoring is not implemented yet. Switch these menus back to still mode before building: {}",
        motion_menus
            .iter()
            .map(|name| format!("\"{name}\""))
            .collect::<Vec<_>>()
            .join(", ")
    )))
}

pub(super) fn generate_text_subtitle_spumux_xml(
    subtitle_path: &std::path::Path,
    standard: VideoStandard,
    profile: VideoOutputProfile,
    font_family: &str,
) -> String {
    let format_str = match standard {
        VideoStandard::Ntsc => "NTSC",
        VideoStandard::Pal => "PAL",
    };
    let (width, height) = profile.raster.resolution(standard);
    let aspect = match profile.aspect {
        AspectMode::FourByThree => "4:3",
        AspectMode::SixteenByNine => "16:9",
    };
    let fontsize = ((height as f64) * 0.05).round().clamp(24.0, 36.0);

    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<subpictures format=\"{format_str}\">\n  <stream>\n    <textsub filename=\"{}\" characterset=\"UTF-8\" font=\"{}\" fontsize=\"{fontsize:.1}\" fill-color=\"#FFFFFF\" outline-color=\"#000000\" outline-thickness=\"2.0\" shadow-offset=\"0, 0\" horizontal-alignment=\"center\" vertical-alignment=\"bottom\" left-margin=\"60\" right-margin=\"60\" top-margin=\"20\" bottom-margin=\"30\" movie-width=\"{width}\" movie-height=\"{height}\" aspect=\"{aspect}\" />\n  </stream>\n</subpictures>\n",
        xml_escape(&subtitle_path.display().to_string()),
        xml_escape(font_family),
    )
}

/// Remove subtitle mappings that the escape hatch should skip during build.
pub(super) fn strip_unsupported_subtitle_mappings(project: &mut SpindleProjectFile) {
    let assets: HashMap<&str, &Asset> = project.assets.iter().map(|a| (a.id.as_str(), a)).collect();

    for titleset in &mut project.disc.titlesets {
        for title in &mut titleset.titles {
            if let Some(asset) = title
                .source_asset_id
                .as_deref()
                .and_then(|id| assets.get(id))
            {
                title.subtitle_mappings.retain(|sm| {
                    asset.subtitle_streams.iter().any(|s| {
                        s.index == sm.source_stream_index && s.subtitle_type == SubtitleType::Bitmap
                    })
                });
            }
        }
    }
}
