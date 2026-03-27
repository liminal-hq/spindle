// DVD navigation command resolution helpers.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use crate::models::{Disc, PlaybackAction};

use super::menu::MenuDomain;

#[derive(Clone, Copy)]
pub(crate) enum DvdCommandContext {
    Menu {
        domain: MenuDomain,
        menu_number: Option<usize>,
    },
    Title {
        titleset_index: usize,
    },
}

#[cfg(test)]
pub(crate) fn playback_action_to_dvd_command(action: &PlaybackAction, disc: &Disc) -> String {
    playback_action_to_dvd_command_result(action, disc)
        .unwrap_or_else(|_| "jump title 1".to_string())
}

pub(crate) fn playback_action_to_dvd_command_result(
    action: &PlaybackAction,
    disc: &Disc,
) -> crate::Result<String> {
    playback_action_to_dvd_command_in_context(
        action,
        disc,
        DvdCommandContext::Menu {
            domain: MenuDomain::Vmgm,
            menu_number: None,
        },
    )
}

#[cfg(test)]
pub(crate) fn playback_action_to_dvd_command_in_domain(
    action: &PlaybackAction,
    disc: &Disc,
    current_domain: MenuDomain,
    current_menu_number: Option<usize>,
) -> String {
    playback_action_to_dvd_command_in_domain_result(
        action,
        disc,
        current_domain,
        current_menu_number,
    )
    .unwrap_or_else(|_| "jump title 1".to_string())
}

pub(crate) fn playback_action_to_dvd_command_in_domain_result(
    action: &PlaybackAction,
    disc: &Disc,
    current_domain: MenuDomain,
    current_menu_number: Option<usize>,
) -> crate::Result<String> {
    playback_action_to_dvd_command_in_context(
        action,
        disc,
        DvdCommandContext::Menu {
            domain: current_domain,
            menu_number: current_menu_number,
        },
    )
}

pub(crate) fn playback_action_to_dvd_command_in_context(
    action: &PlaybackAction,
    disc: &Disc,
    current_context: DvdCommandContext,
) -> crate::Result<String> {
    match action {
        PlaybackAction::PlayTitle { title_id } => {
            let (target_titleset_index, title_number) = resolve_title_target(disc, title_id)
                .ok_or_else(|| crate::Error::Build(format!("Unknown title target: {title_id}")))?;

            match current_context {
                DvdCommandContext::Menu {
                    domain: MenuDomain::Titleset(current_titleset_index),
                    ..
                }
                | DvdCommandContext::Title {
                    titleset_index: current_titleset_index,
                } if current_titleset_index == target_titleset_index => {
                    Ok(format!("jump title {title_number}"))
                }
                _ => Ok(format!(
                    "jump titleset {} title {}",
                    target_titleset_index + 1,
                    title_number
                )),
            }
        }
        PlaybackAction::PlayChapter {
            title_id,
            chapter_id,
        } => {
            let (target_titleset_index, title_number, chapter_number) =
                resolve_chapter_target(disc, title_id, chapter_id).ok_or_else(|| {
                    crate::Error::Build(format!(
                        "Unknown chapter target: title={title_id}, chapter={chapter_id}"
                    ))
                })?;

            match current_context {
                DvdCommandContext::Menu {
                    domain: MenuDomain::Titleset(current_titleset_index),
                    ..
                }
                | DvdCommandContext::Title {
                    titleset_index: current_titleset_index,
                } if current_titleset_index == target_titleset_index => Ok(format!(
                    "jump title {title_number} chapter {chapter_number}"
                )),
                _ => Ok(format!(
                    "jump titleset {} title {} chapter {}",
                    target_titleset_index + 1,
                    title_number,
                    chapter_number
                )),
            }
        }
        PlaybackAction::ShowMenu { menu_id } => {
            let Some((target_domain, target_menu_number)) = resolve_menu_target(disc, menu_id)
            else {
                return Err(crate::Error::Build(format!(
                    "Unknown menu target: {menu_id}"
                )));
            };

            match current_context {
                DvdCommandContext::Title { titleset_index } => match target_domain {
                    MenuDomain::Vmgm => Ok(format!("call vmgm menu {target_menu_number}")),
                    MenuDomain::Titleset(target_ts) if target_ts == titleset_index => {
                        Ok(format!("call menu {target_menu_number}"))
                    }
                    MenuDomain::Titleset(target_ts) => Ok(format!(
                        "call titleset {} menu {}",
                        target_ts + 1,
                        target_menu_number
                    )),
                },
                DvdCommandContext::Menu {
                    domain: current_domain,
                    menu_number: current_menu_number,
                } => match (current_domain, target_domain) {
                    (MenuDomain::Vmgm, MenuDomain::Vmgm)
                        if current_menu_number == Some(target_menu_number) =>
                    {
                        Ok("jump menu".to_string())
                    }
                    (MenuDomain::Vmgm, MenuDomain::Vmgm) => {
                        Ok(format!("jump menu {target_menu_number}"))
                    }
                    (MenuDomain::Titleset(current_ts), MenuDomain::Titleset(target_ts))
                        if current_ts == target_ts =>
                    {
                        Ok(format!("jump menu {target_menu_number}"))
                    }
                    (_, MenuDomain::Vmgm) => Ok(format!("jump vmgm menu {target_menu_number}")),
                    (_, MenuDomain::Titleset(target_ts)) => Ok(format!(
                        "jump titleset {} menu {}",
                        target_ts + 1,
                        target_menu_number
                    )),
                },
            }
        }
        PlaybackAction::Stop => Ok("exit".to_string()),
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
    use crate::build::menu::MenuDomain;
    use crate::build::test_support::{add_second_titleset, test_project};
    use crate::models::PlaybackAction;

    use super::{playback_action_to_dvd_command, playback_action_to_dvd_command_in_domain};

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
