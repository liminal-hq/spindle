// DVD authoring XML and navigation command generation.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::Path;

use crate::models::*;

use super::menu::MenuDomain;
use super::util::xml_escape;

mod language;
mod menu;
#[cfg(test)]
mod tests;
mod title;

use menu::{append_menu_section, menu_section_aspect};
use title::append_titles_section;

pub(crate) fn generate_dvdauthor_xml(
    project: &SpindleProjectFile,
    titles_dir: &Path,
    menus_dir: &Path,
    output_dir: &Path,
) -> crate::Result<String> {
    let format_str = match project.disc.standard {
        VideoStandard::Ntsc => "ntsc",
        VideoStandard::Pal => "pal",
    };

    let mut xml = String::new();

    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str(&format!(
        "<dvdauthor dest=\"{}\">\n",
        xml_escape(&output_dir.display().to_string())
    ));

    let has_global_menus = !project.disc.global_menus.is_empty();
    let has_first_play = project.disc.first_play_action.is_some();

    if has_global_menus || has_first_play {
        xml.push_str("  <vmgm>\n");

        // dvdauthor requires a video format declaration for the VMGM domain even when
        // it has no authored menu content of its own (e.g. a disc whose only VMGM-level
        // need is a first-play jump, with all real menus living at the titleset level).
        // `append_menu_section` already handles an empty `menus` slice safely, writing
        // just `<menus><video .../></menus>` with no PGC content.
        let vmgm_aspect =
            menu_section_aspect(project, &project.disc.global_menus, MenuDomain::Vmgm)?;
        append_menu_section(
            &mut xml,
            format_str,
            aspect_str(vmgm_aspect),
            &project.disc.global_menus,
            MenuDomain::Vmgm,
            &project.disc,
            project,
            menus_dir,
        )?;

        if let Some(ref action) = project.disc.first_play_action {
            xml.push_str("    <fpc>\n");
            xml.push_str(&format!(
                "      {};\n",
                super::dvd_navigation::playback_action_to_dvd_command_result(
                    action,
                    &project.disc
                )?
            ));
            xml.push_str("    </fpc>\n");
        }

        xml.push_str("  </vmgm>\n");
    }

    for (titleset_index, titleset) in project.disc.titlesets.iter().enumerate() {
        xml.push_str("  <titleset>\n");

        let titleset_aspect = titleset
            .titles
            .iter()
            .find_map(|t| t.video_output_profile)
            .map(|p| aspect_str(p.aspect))
            .unwrap_or("16:9");

        if !titleset.menus.is_empty() {
            let menu_aspect = menu_section_aspect(
                project,
                &titleset.menus,
                MenuDomain::Titleset(titleset_index),
            )?;
            append_menu_section(
                &mut xml,
                format_str,
                aspect_str(menu_aspect),
                &titleset.menus,
                MenuDomain::Titleset(titleset_index),
                &project.disc,
                project,
                menus_dir,
            )?;
        }

        append_titles_section(
            &mut xml,
            format_str,
            titleset_aspect,
            titleset,
            titleset_index,
            &project.disc,
            titles_dir,
        )?;

        xml.push_str("  </titleset>\n");
    }

    xml.push_str("</dvdauthor>\n");

    Ok(xml)
}

fn aspect_str(aspect: AspectMode) -> &'static str {
    match aspect {
        AspectMode::FourByThree => "4:3",
        AspectMode::SixteenByNine => "16:9",
    }
}

fn parse_aspect_str(value: &str) -> AspectMode {
    match value {
        "4:3" => AspectMode::FourByThree,
        _ => AspectMode::SixteenByNine,
    }
}
