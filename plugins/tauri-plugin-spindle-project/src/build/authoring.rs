// DVD authoring XML and navigation command generation.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::Path;

use crate::models::*;

use super::menu::{menu_output_aspect, MenuDomain};
use super::util::{format_dvd_timestamp, sanitise_filename, xml_escape};

#[derive(Clone, Copy)]
enum DvdCommandContext {
    Menu {
        domain: MenuDomain,
        menu_number: Option<usize>,
    },
    Title {
        titleset_index: usize,
    },
}

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
            let global_menu_aspect = match menu_output_aspect(project, MenuDomain::Vmgm) {
                AspectMode::FourByThree => "4:3",
                AspectMode::SixteenByNine => "16:9",
            };
            xml.push_str("    <menus>\n");
            xml.push_str(&format!(
                "      <video format=\"{format_str}\" aspect=\"{global_menu_aspect}\" />\n"
            ));
            for (menu_index, menu) in project.disc.global_menus.iter().enumerate() {
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
                            playback_action_to_dvd_command_in_domain(
                                action,
                                &project.disc,
                                MenuDomain::Vmgm,
                                Some(menu_index + 1),
                            )
                        ));
                    }
                }
                xml.push_str("      </pgc>\n");
            }
            xml.push_str("    </menus>\n");
        }

        if let Some(ref action) = project.disc.first_play_action {
            xml.push_str("    <fpc>\n");
            xml.push_str(&format!(
                "      {};\n",
                playback_action_to_dvd_command(action, &project.disc)
            ));
            xml.push_str("    </fpc>\n");
        }

        xml.push_str("  </vmgm>\n");
    }

    for (titleset_index, titleset) in project.disc.titlesets.iter().enumerate() {
        xml.push_str("  <titleset>\n");

        let aspect_str = titleset
            .titles
            .iter()
            .find_map(|t| t.video_output_profile)
            .map(|p| match p.aspect {
                AspectMode::FourByThree => "4:3",
                AspectMode::SixteenByNine => "16:9",
            })
            .unwrap_or("16:9");

        if !titleset.menus.is_empty() {
            xml.push_str("    <menus>\n");
            xml.push_str(&format!(
                "      <video format=\"{format_str}\" aspect=\"{aspect_str}\" />\n"
            ));
            for (menu_index, menu) in titleset.menus.iter().enumerate() {
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
                            playback_action_to_dvd_command_in_domain(
                                action,
                                &project.disc,
                                MenuDomain::Titleset(titleset_index),
                                Some(menu_index + 1),
                            )
                        ));
                    }
                }
                xml.push_str("      </pgc>\n");
            }
            xml.push_str("    </menus>\n");
        }

        xml.push_str("    <titles>\n");
        xml.push_str(&format!(
            "      <video format=\"{format_str}\" aspect=\"{aspect_str}\" />\n"
        ));
        for title in &titleset.titles {
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
                        &project.disc,
                        DvdCommandContext::Title { titleset_index },
                    )
                ));
                xml.push_str("        </post>\n");
            }

            xml.push_str("      </pgc>\n");
        }
        xml.push_str("    </titles>\n");

        xml.push_str("  </titleset>\n");
    }

    xml.push_str("</dvdauthor>\n");

    Ok(xml)
}

fn playback_action_to_dvd_command(action: &PlaybackAction, disc: &Disc) -> String {
    playback_action_to_dvd_command_in_context(
        action,
        disc,
        DvdCommandContext::Menu {
            domain: MenuDomain::Vmgm,
            menu_number: None,
        },
    )
}

fn playback_action_to_dvd_command_in_domain(
    action: &PlaybackAction,
    disc: &Disc,
    current_domain: MenuDomain,
    current_menu_number: Option<usize>,
) -> String {
    playback_action_to_dvd_command_in_context(
        action,
        disc,
        DvdCommandContext::Menu {
            domain: current_domain,
            menu_number: current_menu_number,
        },
    )
}

fn playback_action_to_dvd_command_in_context(
    action: &PlaybackAction,
    disc: &Disc,
    current_context: DvdCommandContext,
) -> String {
    match action {
        PlaybackAction::PlayTitle { title_id } => {
            let Some((target_titleset_index, title_number)) = resolve_title_target(disc, title_id)
            else {
                return "jump title 1".to_string();
            };

            match current_context {
                DvdCommandContext::Menu {
                    domain: MenuDomain::Titleset(current_titleset_index),
                    ..
                }
                | DvdCommandContext::Title {
                    titleset_index: current_titleset_index,
                } if current_titleset_index == target_titleset_index => {
                    format!("jump title {title_number}")
                }
                _ => format!(
                    "jump titleset {} title {}",
                    target_titleset_index + 1,
                    title_number
                ),
            }
        }
        PlaybackAction::PlayChapter {
            title_id,
            chapter_id,
        } => {
            let Some((target_titleset_index, title_number, chapter_number)) =
                resolve_chapter_target(disc, title_id, chapter_id)
            else {
                return "jump chapter 1".to_string();
            };

            match current_context {
                DvdCommandContext::Menu {
                    domain: MenuDomain::Titleset(current_titleset_index),
                    ..
                }
                | DvdCommandContext::Title {
                    titleset_index: current_titleset_index,
                } if current_titleset_index == target_titleset_index => {
                    format!("jump title {title_number} chapter {chapter_number}")
                }
                _ => format!(
                    "jump titleset {} title {} chapter {}",
                    target_titleset_index + 1,
                    title_number,
                    chapter_number
                ),
            }
        }
        PlaybackAction::ShowMenu { menu_id } => {
            let Some((target_domain, target_menu_number)) = resolve_menu_target(disc, menu_id)
            else {
                return match current_context {
                    DvdCommandContext::Title { .. } => "call vmgm menu".to_string(),
                    DvdCommandContext::Menu { .. } => "jump vmgm menu".to_string(),
                };
            };

            match current_context {
                DvdCommandContext::Title { titleset_index } => match target_domain {
                    MenuDomain::Vmgm => format!("call vmgm menu {target_menu_number}"),
                    MenuDomain::Titleset(target_ts) if target_ts == titleset_index => {
                        format!("call menu {target_menu_number}")
                    }
                    MenuDomain::Titleset(target_ts) => {
                        format!("call titleset {} menu {}", target_ts + 1, target_menu_number)
                    }
                },
                DvdCommandContext::Menu {
                    domain: current_domain,
                    menu_number: current_menu_number,
                } => match (current_domain, target_domain) {
                    (MenuDomain::Vmgm, MenuDomain::Vmgm)
                        if current_menu_number == Some(target_menu_number) =>
                    {
                        "jump menu".to_string()
                    }
                    (MenuDomain::Vmgm, MenuDomain::Vmgm) => {
                        format!("jump menu {target_menu_number}")
                    }
                    (MenuDomain::Titleset(current_ts), MenuDomain::Titleset(target_ts))
                        if current_ts == target_ts =>
                    {
                        format!("jump menu {target_menu_number}")
                    }
                    (_, MenuDomain::Vmgm) => format!("jump vmgm menu {target_menu_number}"),
                    (_, MenuDomain::Titleset(target_ts)) => {
                        format!("jump titleset {} menu {}", target_ts + 1, target_menu_number)
                    }
                },
            }
        }
        PlaybackAction::Stop => "exit".to_string(),
    }
}

fn resolve_menu_target(disc: &Disc, menu_id: &str) -> Option<(MenuDomain, usize)> {
    if let Some(index) = disc.global_menus.iter().position(|menu| menu.id == menu_id) {
        return Some((MenuDomain::Vmgm, index + 1));
    }

    for (titleset_index, titleset) in disc.titlesets.iter().enumerate() {
        if let Some(index) = titleset.menus.iter().position(|menu| menu.id == menu_id) {
            return Some((MenuDomain::Titleset(titleset_index), index + 1));
        }
    }

    None
}

fn resolve_title_target(disc: &Disc, title_id: &str) -> Option<(usize, usize)> {
    for (titleset_index, titleset) in disc.titlesets.iter().enumerate() {
        if let Some(title_index) = titleset
            .titles
            .iter()
            .position(|title| title.id == title_id)
        {
            return Some((titleset_index, title_index + 1));
        }
    }

    None
}

fn resolve_chapter_target(
    disc: &Disc,
    title_id: &str,
    chapter_id: &str,
) -> Option<(usize, usize, usize)> {
    for (titleset_index, titleset) in disc.titlesets.iter().enumerate() {
        if let Some((title_index, title)) = titleset
            .titles
            .iter()
            .enumerate()
            .find(|(_, title)| title.id == title_id)
        {
            if let Some(chapter_index) = title
                .chapters
                .iter()
                .position(|chapter| chapter.id == chapter_id)
            {
                return Some((titleset_index, title_index + 1, chapter_index + 1));
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use crate::build::generate_build_plan;
    use crate::build::menu::MenuDomain;
    use crate::build::test_support::{add_second_titleset, test_menu, test_menu_with_action, test_project};
    use crate::models::PlaybackAction;

    use super::{playback_action_to_dvd_command, playback_action_to_dvd_command_in_domain};

    #[test]
    fn dvdauthor_xml_contains_authored_menu_vob_and_button() {
        let mut project = test_project();
        project.disc.global_menus.push(test_menu());

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan.dvdauthor_xml.contains("menu-1.mpg"));
        assert!(plan
            .dvdauthor_xml
            .contains("<button>jump titleset 1 title 1;</button>"));
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

    #[test]
    fn vmgm_play_title_uses_titleset_qualified_target() {
        let mut project = test_project();
        add_second_titleset(&mut project);

        let command = playback_action_to_dvd_command(
            &PlaybackAction::PlayTitle {
                title_id: "title-2".to_string(),
            },
            &project.disc,
        );

        assert_eq!(command, "jump titleset 2 title 1");
    }

    #[test]
    fn titleset_menu_play_chapter_in_same_titleset_uses_local_title_numbering() {
        let project = test_project();

        let command = playback_action_to_dvd_command_in_domain(
            &PlaybackAction::PlayChapter {
                title_id: "title-1".to_string(),
                chapter_id: "ch-2".to_string(),
            },
            &project.disc,
            MenuDomain::Titleset(0),
            Some(1),
        );

        assert_eq!(command, "jump title 1 chapter 2");
    }

    #[test]
    fn titleset_menu_play_chapter_in_other_titleset_uses_qualified_target() {
        let mut project = test_project();
        add_second_titleset(&mut project);

        let command = playback_action_to_dvd_command_in_domain(
            &PlaybackAction::PlayChapter {
                title_id: "title-2".to_string(),
                chapter_id: "ch-3".to_string(),
            },
            &project.disc,
            MenuDomain::Titleset(0),
            Some(1),
        );

        assert_eq!(command, "jump titleset 2 title 1 chapter 1");
    }
}
