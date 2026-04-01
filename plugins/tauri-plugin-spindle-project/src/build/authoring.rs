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

    // For titleset menu sections with multiple PGCs, the entry PGC (first)
    // needs a g0-based dispatch so VMGM buttons can target specific menus.
    let needs_dispatch = matches!(domain, MenuDomain::Titleset(_)) && menus.len() > 1;

    for (menu_index, menu) in menus.iter().enumerate() {
        let menu_number = menu_index + 1;
        let entry = match domain {
            MenuDomain::Titleset(_) if menu_index == 0 => Some("root"),
            _ => None,
        };
        let mut pre_commands = String::new();
        if needs_dispatch && menu_index == 0 {
            // Entry PGC: check g0 and jump to the targeted menu PGC, then clear g0.
            for target in 2..=menus.len() {
                pre_commands.push_str(&format!(
                    "          if (g0 eq {target}) {{ g0 = 0; jump menu {target}; }}\n"
                ));
            }
            pre_commands.push_str("          g0 = 0;\n");
        }
        if let Some(button_command) = initial_button_command(menu) {
            pre_commands.push_str(&button_command);
        }
        let pre_commands = if pre_commands.is_empty() {
            None
        } else {
            Some(pre_commands)
        };

        append_menu_pgc(
            xml,
            menu,
            disc,
            domain,
            menu_number,
            menus_dir,
            entry,
            pre_commands.as_deref(),
        )?;
    }
    xml.push_str("    </menus>\n");
    Ok(())
}

fn initial_button_command(menu: &Menu) -> Option<String> {
    let button_index = menu
        .default_button_id
        .as_deref()
        .and_then(|default_id| menu.buttons.iter().position(|button| button.id == default_id))
        .or_else(|| (!menu.buttons.is_empty()).then_some(0))?;
    let button_value = (button_index + 1) * 1024;
    Some(format!("          button = {button_value};\n"))
}

fn append_menu_pgc(
    xml: &mut String,
    menu: &Menu,
    disc: &Disc,
    domain: MenuDomain,
    menu_number: usize,
    menus_dir: &Path,
    entry: Option<&str>,
    pre_commands: Option<&str>,
) -> crate::Result<()> {
    match entry {
        Some(entry) => xml.push_str(&format!("      <pgc entry=\"{entry}\">\n")),
        None => xml.push_str("      <pgc>\n"),
    }
    if let Some(pre) = pre_commands {
        xml.push_str("        <pre>\n");
        xml.push_str(pre);
        xml.push_str("        </pre>\n");
    }
    let menu_vob_path = menus_dir.join(format!("{}.mpg", sanitise_filename(&menu.id)));
    xml.push_str(&format!(
        "        <vob file=\"{}\" pause=\"inf\" />\n",
        xml_escape(&menu_vob_path.display().to_string())
    ));
    for button in &menu.buttons {
        if let Some(ref action) = button.action {
            let cmd = playback_action_to_dvd_command_in_domain_result(
                action,
                disc,
                domain,
                Some(menu_number),
            )?;
            // Compound commands (wrapped in braces) are already terminated;
            // simple commands need a trailing semicolon.
            let formatted = if cmd.starts_with('{') {
                cmd
            } else {
                format!("{cmd};")
            };
            xml.push_str(&format!("        <button>{formatted}</button>\n"));
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

        assert!(
            plan.dvdauthor_xml
                .contains("<button>jump titleset 1 menu entry root;</button>"),
            "VMGM should jump to the titleset root menu entry"
        );
        assert!(
            plan.dvdauthor_xml.contains("<pgc entry=\"root\">"),
            "Titleset menu entry PGC should be marked as the root menu"
        );
    }

    #[test]
    fn vmgm_to_second_titleset_menu_uses_g0_dispatch() {
        let mut project = test_project();
        // Create a global menu that targets the second menu in titleset 1
        project.disc.global_menus.push(test_menu_with_action(
            "menu-global",
            "Main Menu",
            PlaybackAction::ShowMenu {
                menu_id: "ts-menu-2".to_string(),
            },
        ));
        // Add two menus to titleset 1
        project.disc.titlesets[0].menus.push(test_menu_with_action(
            "ts-menu-1",
            "Titleset Menu 1",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        ));
        project.disc.titlesets[0].menus.push(test_menu_with_action(
            "ts-menu-2",
            "Titleset Menu 2",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        ));

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        // VMGM button should set g0 then jump to the titleset root menu entry
        assert!(
            plan.dvdauthor_xml
                .contains("<button>{ g0 = 2; jump titleset 1 menu entry root; }</button>"),
            "VMGM targeting second menu should use g0 register dispatch"
        );
        // First titleset menu PGC should have <pre> dispatch logic
        assert!(
            plan.dvdauthor_xml.contains("if (g0 eq 2)"),
            "Entry PGC should dispatch based on g0"
        );
        assert!(
            plan.dvdauthor_xml.contains("button = 1024;"),
            "Entry PGC should explicitly select the default button on entry"
        );
    }

    #[test]
    fn menu_entry_pre_selects_first_button_when_no_default_is_set() {
        let mut project = test_project();
        let mut menu = test_menu_with_action(
            "menu-1",
            "Main Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        );
        menu.default_button_id = None;
        project.disc.global_menus.push(menu);

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(
            plan.dvdauthor_xml.contains("<pre>\n          button = 1024;\n        </pre>"),
            "Menus without an explicit default should still select button 1 on entry"
        );
    }

    #[test]
    fn menu_entry_pre_selects_second_button_when_it_is_default() {
        let mut project = test_project();
        let mut menu = test_menu_with_action(
            "menu-1",
            "Main Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        );
        menu.buttons.push(crate::models::MenuButton {
            id: "btn-2".to_string(),
            label: "Extras".to_string(),
            bounds: crate::models::ButtonBounds {
                x: 120.0,
                y: 380.0,
                width: 240.0,
                height: 48.0,
            },
            action: Some(PlaybackAction::Stop),
            nav_up: Some("btn-1".to_string()),
            nav_down: None,
            nav_left: None,
            nav_right: None,
            highlight_mode: crate::models::HighlightMode::Static,
            highlight_keyframes: vec![],
            video_asset_id: None,
        });
        menu.buttons[0].nav_down = Some("btn-2".to_string());
        menu.default_button_id = Some("btn-2".to_string());
        project.disc.global_menus.push(menu);

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(
            plan.dvdauthor_xml.contains("<pre>\n          button = 2048;\n        </pre>"),
            "Menus should initialise the authored default button, not always button 1"
        );
    }

    #[test]
    fn titleset_root_entry_pre_combines_dispatch_and_default_button_selection() {
        let mut project = test_project();
        let mut root_menu = test_menu_with_action(
            "ts-menu-1",
            "Titleset Menu 1",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        );
        root_menu.buttons.push(crate::models::MenuButton {
            id: "btn-2".to_string(),
            label: "Scenes".to_string(),
            bounds: crate::models::ButtonBounds {
                x: 120.0,
                y: 380.0,
                width: 240.0,
                height: 48.0,
            },
            action: Some(PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            }),
            nav_up: Some("btn-1".to_string()),
            nav_down: None,
            nav_left: None,
            nav_right: None,
            highlight_mode: crate::models::HighlightMode::Static,
            highlight_keyframes: vec![],
            video_asset_id: None,
        });
        root_menu.buttons[0].nav_down = Some("btn-2".to_string());
        root_menu.default_button_id = Some("btn-2".to_string());
        project.disc.titlesets[0].menus.push(root_menu);
        project.disc.titlesets[0].menus.push(test_menu_with_action(
            "ts-menu-2",
            "Titleset Menu 2",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        ));
        project.disc.global_menus.push(test_menu_with_action(
            "menu-global",
            "Main Menu",
            PlaybackAction::ShowMenu {
                menu_id: "ts-menu-2".to_string(),
            },
        ));

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan.dvdauthor_xml.contains(
            "<pre>\n          if (g0 eq 2) { g0 = 0; jump menu 2; }\n          g0 = 0;\n          button = 2048;\n        </pre>"
        ));
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
    fn title_post_to_same_titleset_root_menu_uses_call_menu_entry_root() {
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
            .contains("<post>\n          call menu entry root;\n        </post>"));
    }

    #[test]
    fn title_post_to_same_titleset_non_root_menu_uses_g0_and_call_menu_entry_root() {
        let mut project = test_project();
        project.disc.titlesets[0].menus.push(test_menu_with_action(
            "menu-1",
            "Root Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        ));
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

        assert!(plan.dvdauthor_xml.contains(
            "<post>\n          { g0 = 2; call menu entry root; };\n        </post>"
        ));
    }

    #[test]
    fn title_post_to_other_titleset_root_menu_uses_call_titleset_menu_entry_root() {
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
            .contains("<post>\n          call titleset 2 menu entry root;\n        </post>"));
    }

    #[test]
    fn title_post_to_other_titleset_non_root_menu_uses_g0_and_call_titleset_entry_root() {
        let mut project = test_project();
        add_second_titleset(&mut project);
        project.disc.titlesets[1].menus.push(test_menu_with_action(
            "menu-1",
            "Bonus Root Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-2".to_string(),
            },
        ));
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

        assert!(plan.dvdauthor_xml.contains(
            "<post>\n          { g0 = 2; call titleset 2 menu entry root; };\n        </post>"
        ));
    }
}
