// DVD authoring XML and navigation command generation.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::Path;

use crate::models::*;

use super::dvd_navigation::{
    playback_action_to_dvd_command_in_context, playback_action_to_dvd_command_in_domain_result,
    playback_action_to_dvd_command_result, DvdCommandContext,
};
use super::menu::{menu_output_aspect, MenuDomain};
use super::util::{format_dvd_timestamp, sanitise_filename, xml_escape};

pub(crate) fn generate_dvdauthor_xml(
    project: &SpindleProjectFile,
    titles_dir: &Path,
    menus_dir: &Path,
    video_ts_dir: &Path,
) -> crate::Result<String> {
    let format_str = match project.disc.standard {
        VideoStandard::Ntsc => "ntsc",
        VideoStandard::Pal => "pal",
    };

    let mut xml = String::new();

    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str(&format!(
        "<dvdauthor dest=\"{}\">\n",
        xml_escape(&video_ts_dir.display().to_string())
    ));

    let has_global_menus = !project.disc.global_menus.is_empty();
    let has_first_play = project.disc.first_play_action.is_some();

    if has_global_menus || has_first_play {
        xml.push_str("  <vmgm>\n");

        if has_global_menus {
            append_menu_section(
                &mut xml,
                format_str,
                aspect_str(menu_output_aspect(project, MenuDomain::Vmgm)),
                &project.disc.global_menus,
                MenuDomain::Vmgm,
                &project.disc,
                menus_dir,
            )?;
        }

        if let Some(ref action) = project.disc.first_play_action {
            xml.push_str("    <fpc>\n");
            xml.push_str(&format!(
                "      {};\n",
                playback_action_to_dvd_command_result(action, &project.disc)?
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
            append_menu_section(
                &mut xml,
                format_str,
                titleset_aspect,
                &titleset.menus,
                MenuDomain::Titleset(titleset_index),
                &project.disc,
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

fn append_menu_section(
    xml: &mut String,
    format_str: &str,
    aspect_str: &str,
    menus: &[Menu],
    domain: MenuDomain,
    disc: &Disc,
    menus_dir: &Path,
) -> crate::Result<()> {
    xml.push_str("    <menus>\n");
    xml.push_str(&format!(
        "      <video format=\"{format_str}\" aspect=\"{aspect_str}\" />\n"
    ));
    for (menu_index, menu) in menus.iter().enumerate() {
        append_menu_pgc(xml, menu, disc, domain, menu_index + 1, menus_dir)?;
    }
    xml.push_str("    </menus>\n");
    Ok(())
}

fn append_menu_pgc(
    xml: &mut String,
    menu: &Menu,
    disc: &Disc,
    domain: MenuDomain,
    menu_number: usize,
    menus_dir: &Path,
) -> crate::Result<()> {
    xml.push_str("      <pgc>\n");
    let menu_vob_path = menus_dir.join(format!("{}.mpg", sanitise_filename(&menu.id)));
    xml.push_str(&format!(
        "        <vob file=\"{}\" pause=\"inf\" />\n",
        xml_escape(&menu_vob_path.display().to_string())
    ));
    for button in &menu.buttons {
        if let Some(ref action) = button.action {
            xml.push_str(&format!(
                "        <button>{};</button>\n",
                playback_action_to_dvd_command_in_domain_result(
                    action,
                    disc,
                    domain,
                    Some(menu_number),
                )?
            ));
        }
    }
    xml.push_str("      </pgc>\n");
    Ok(())
}

fn append_titles_section(
    xml: &mut String,
    format_str: &str,
    aspect_str: &str,
    titleset: &Titleset,
    titleset_index: usize,
    disc: &Disc,
    titles_dir: &Path,
) -> crate::Result<()> {
    xml.push_str("    <titles>\n");
    xml.push_str(&format!(
        "      <video format=\"{format_str}\" aspect=\"{aspect_str}\" />\n"
    ));

    // Declare subtitle streams if any title in this titleset has subtitle mappings.
    let max_subs = titleset
        .titles
        .iter()
        .map(|t| t.subtitle_mappings.len())
        .max()
        .unwrap_or(0);
    if max_subs > 0 {
        // Collect unique languages across all titles for stream declarations.
        // dvdauthor needs subpicture stream declarations at the titleset level.
        for i in 0..max_subs {
            let lang = titleset
                .titles
                .iter()
                .find_map(|t| t.subtitle_mappings.get(i).map(|sm| sm.language.as_str()))
                .unwrap_or("und");
            xml.push_str(&format!(
                "      <subpicture lang=\"{}\" />\n",
                xml_escape(lang)
            ));
        }
    }

    for title in &titleset.titles {
        append_title_pgc(xml, title, titleset_index, disc, titles_dir)?;
    }
    xml.push_str("    </titles>\n");
    Ok(())
}

fn append_title_pgc(
    xml: &mut String,
    title: &Title,
    titleset_index: usize,
    disc: &Disc,
    titles_dir: &Path,
) -> crate::Result<()> {
    xml.push_str("      <pgc>\n");

    let vob_path = titles_dir.join(format!("{}.mpg", sanitise_filename(&title.id)));
    let mut vob_attrs = format!(
        "        <vob file=\"{}\"",
        xml_escape(&vob_path.display().to_string())
    );

    if !title.chapters.is_empty() {
        let chapter_str = title
            .chapters
            .iter()
            .map(|ch| format_dvd_timestamp(ch.timestamp_secs))
            .collect::<Vec<_>>()
            .join(",");
        vob_attrs.push_str(&format!(" chapters=\"{chapter_str}\""));
    }

    vob_attrs.push_str(" />\n");
    xml.push_str(&vob_attrs);

    if let Some(ref action) = title.end_action {
        xml.push_str("        <post>\n");
        xml.push_str(&format!(
            "          {};\n",
            playback_action_to_dvd_command_in_context(
                action,
                disc,
                DvdCommandContext::Title { titleset_index },
            )?
        ));
        xml.push_str("        </post>\n");
    }

    xml.push_str("      </pgc>\n");
    Ok(())
}
#[cfg(test)]
mod tests {
    use crate::build::generate_build_plan;
    use crate::build::test_support::{
        add_second_titleset, test_menu, test_menu_with_action, test_project,
    };
    use crate::models::{PlaybackAction, SubtitleStreamInfo, SubtitleTrackMapping, SubtitleType};

    #[test]
    fn dvdauthor_xml_contains_authored_menu_vob_and_button() {
        let mut project = test_project();
        project.disc.global_menus.push(test_menu());

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan.dvdauthor_xml.contains("menu-1.mpg"));
        assert!(plan
            .dvdauthor_xml
            .contains("<button>jump title 1;</button>"));
    }

    #[test]
    fn dvdauthor_xml_contains_chapters() {
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan.dvdauthor_xml.contains("chapters="));
        assert!(plan.dvdauthor_xml.contains("0:00:00.0"));
        assert!(plan.dvdauthor_xml.contains("0:05:00.0"));
    }

    #[test]
    fn dvdauthor_xml_contains_end_action() {
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan.dvdauthor_xml.contains("exit"));
    }

    #[test]
    fn title_post_uses_call_for_menu_actions() {
        let mut project = test_project();
        project.disc.global_menus.push(test_menu());
        project.disc.titlesets[0].titles[0].end_action = Some(PlaybackAction::ShowMenu {
            menu_id: "menu-1".to_string(),
        });

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan
            .dvdauthor_xml
            .contains("<post>\n          call vmgm menu 1;\n        </post>"));
    }

    #[test]
    fn dvdauthor_xml_contains_video_format() {
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(
            plan.dvdauthor_xml.contains("format=\"ntsc\""),
            "dvdauthor XML must declare video format\n{}",
            plan.dvdauthor_xml
        );
        assert!(
            plan.dvdauthor_xml.contains("aspect=\"16:9\""),
            "dvdauthor XML must declare aspect ratio\n{}",
            plan.dvdauthor_xml
        );
    }

    #[test]
    fn dvdauthor_xml_escapes_subpicture_language_values() {
        let mut project = test_project();
        project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
            index: 2,
            codec: "dvd_subtitle".to_string(),
            language: Some("en&\"g".to_string()),
            subtitle_type: SubtitleType::Bitmap,
            title: None,
        });
        project.disc.titlesets[0].titles[0]
            .subtitle_mappings
            .push(SubtitleTrackMapping {
                id: "sm-1".to_string(),
                source_stream_index: 2,
                label: "English".to_string(),
                language: "en&\"g".to_string(),
                order_index: 0,
                is_default: false,
                is_forced: false,
            });

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan
            .dvdauthor_xml
            .contains("<subpicture lang=\"en&amp;&quot;g\" />"));
    }

    #[test]
    fn vmgm_menu_button_to_same_domain_menu_uses_jump_menu() {
        let mut project = test_project();
        project.disc.global_menus.push(test_menu_with_action(
            "menu-1",
            "Main Menu",
            PlaybackAction::ShowMenu {
                menu_id: "menu-2".to_string(),
            },
        ));
        project.disc.global_menus.push(test_menu_with_action(
            "menu-2",
            "Scene Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        ));

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan.dvdauthor_xml.contains("<button>jump menu 2;</button>"));
    }

    #[test]
    fn vmgm_menu_button_to_titleset_menu_uses_jump_titleset_menu() {
        let mut project = test_project();
        project.disc.global_menus.push(test_menu_with_action(
            "menu-1",
            "Main Menu",
            PlaybackAction::ShowMenu {
                menu_id: "menu-2".to_string(),
            },
        ));
        project.disc.titlesets[0].menus.push(test_menu_with_action(
            "menu-2",
            "Titleset Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        ));

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan
            .dvdauthor_xml
            .contains("<button>jump titleset 1 menu 1;</button>"));
    }

    #[test]
    fn vmgm_menu_button_to_second_titleset_title_uses_disc_global_title_numbering() {
        let mut project = test_project();
        add_second_titleset(&mut project);
        project.disc.global_menus.push(test_menu_with_action(
            "menu-1",
            "Main Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-2".to_string(),
            },
        ));

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan
            .dvdauthor_xml
            .contains("<button>jump title 2;</button>"));
    }

    #[test]
    fn titleset_menu_button_to_vmgm_menu_uses_jump_vmgm_menu() {
        let mut project = test_project();
        project.disc.global_menus.push(test_menu_with_action(
            "menu-1",
            "Main Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        ));
        project.disc.titlesets[0].menus.push(test_menu_with_action(
            "menu-2",
            "Episode Menu",
            PlaybackAction::ShowMenu {
                menu_id: "menu-1".to_string(),
            },
        ));

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan
            .dvdauthor_xml
            .contains("<button>jump vmgm menu 1;</button>"));
    }

    #[test]
    fn title_post_to_same_titleset_menu_uses_call_menu() {
        let mut project = test_project();
        project.disc.titlesets[0].menus.push(test_menu_with_action(
            "menu-2",
            "Episode Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        ));
        project.disc.titlesets[0].titles[0].end_action = Some(PlaybackAction::ShowMenu {
            menu_id: "menu-2".to_string(),
        });

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan
            .dvdauthor_xml
            .contains("<post>\n          call menu 1;\n        </post>"));
    }

    #[test]
    fn title_post_to_other_titleset_menu_uses_call_titleset_menu() {
        let mut project = test_project();
        add_second_titleset(&mut project);
        project.disc.titlesets[1].menus.push(test_menu_with_action(
            "menu-2",
            "Bonus Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-2".to_string(),
            },
        ));
        project.disc.titlesets[0].titles[0].end_action = Some(PlaybackAction::ShowMenu {
            menu_id: "menu-2".to_string(),
        });

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan
            .dvdauthor_xml
            .contains("<post>\n          call titleset 2 menu 1;\n        </post>"));
    }
}
