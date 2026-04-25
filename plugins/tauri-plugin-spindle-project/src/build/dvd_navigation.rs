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
            let global_title_number = resolve_global_title_number(disc, title_id)
                .ok_or_else(|| crate::Error::Build(format!("Unknown title target: {title_id}")))?;

            match current_context {
                DvdCommandContext::Menu {
                    domain: MenuDomain::Vmgm,
                    ..
                } => Ok(format!("jump title {global_title_number}")),
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
            let global_title_number = resolve_global_title_number(disc, title_id)
                .ok_or_else(|| crate::Error::Build(format!("Unknown title target: {title_id}")))?;

            match current_context {
                DvdCommandContext::Menu {
                    domain: MenuDomain::Vmgm,
                    ..
                } => Ok(format!(
                    "jump title {global_title_number} chapter {chapter_number}"
                )),
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
                        if target_menu_number == 1 {
                            Ok("call menu entry root".to_string())
                        } else {
                            Ok(format!(
                                "{{ g0 = {target_menu_number}; call menu entry root; }}"
                            ))
                        }
                    }
                    MenuDomain::Titleset(target_ts) => {
                        if target_menu_number == 1 {
                            Ok(format!("call titleset {} menu entry root", target_ts + 1))
                        } else {
                            Ok(format!(
                                "{{ g0 = {target_menu_number}; call titleset {} menu entry root; }}",
                                target_ts + 1
                            ))
                        }
                    }
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
                    // From VMGM, dvdauthor can only jump into a titleset via
                    // an entry menu target such as `menu entry root`.
                    // For menu 1 we jump directly to the titleset's root
                    // menu entry; for others we stash the target in `g0` and
                    // let that entry PGC dispatch.
                    (MenuDomain::Vmgm, MenuDomain::Titleset(target_ts))
                        if target_menu_number == 1 =>
                    {
                        Ok(format!("jump titleset {} menu entry root", target_ts + 1))
                    }
                    (MenuDomain::Vmgm, MenuDomain::Titleset(target_ts)) => Ok(format!(
                        "{{ g0 = {}; jump titleset {} menu entry root; }}",
                        target_menu_number,
                        target_ts + 1
                    )),
                    (_, MenuDomain::Titleset(target_ts)) => Ok(format!(
                        "jump titleset {} menu {}",
                        target_ts + 1,
                        target_menu_number
                    )),
                },
            }
        }
        PlaybackAction::SetAudioStream { stream_index } => Ok(format!("audio = {stream_index}")),
        PlaybackAction::SetSubtitleStream { stream_index } => {
            // SPRM 2 bit 6 (0x40) is the subtitle display flag; bits 0–5 are the stream
            // number. A value with bit 6 clear means "not displayed". None means the user
            // wants subtitles off, so we emit 0 (display=off, stream=0).
            let val = match stream_index {
                None => 0u32,          // Disable subtitle display
                Some(idx) => idx + 64, // Enable stream idx (0x40 | idx)
            };
            Ok(format!("subtitle = {val}"))
        }
        PlaybackAction::Sequence { actions } => {
            let mut commands = Vec::new();
            for action in actions {
                let cmd = playback_action_to_dvd_command_in_context(action, disc, current_context)?;
                commands.push(cmd);
            }
            // If it's a sequence, we wrap it in braces for dvdauthor if it's multiple commands
            if commands.len() > 1 {
                let joined = commands.join("; ");
                Ok(format!("{{ {joined}; }}"))
            } else if let Some(single) = commands.into_iter().next() {
                Ok(single)
            } else {
                Ok("nop".to_string())
            }
        }
        PlaybackAction::Stop => Ok("exit".to_string()),
        PlaybackAction::Return => Ok("resume".to_string()),
        // Virtual actions are expanded to concrete DVD VM commands at a higher
        // level (authoring.rs) before reaching this function. Reaching here
        // means the action was used without expansion context — treat as Stop.
        PlaybackAction::PlayNextInTitleset | PlaybackAction::PlayAllInTitleset => {
            Err(crate::Error::Build(
                "PlayNextInTitleset / PlayAllInTitleset must be expanded before DVD command \
                 resolution. Use expand_title_end_action for title end actions."
                    .to_string(),
            ))
        }
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

fn resolve_global_title_number(disc: &Disc, title_id: &str) -> Option<usize> {
    let mut global_title_number = 1;

    for titleset in &disc.titlesets {
        for title in &titleset.titles {
            if title.id == title_id {
                return Some(global_title_number);
            }
            global_title_number += 1;
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
    use crate::build::test_support::{add_second_titleset, test_menu_with_action, test_project};
    use crate::models::PlaybackAction;

    use super::{
        playback_action_to_dvd_command, playback_action_to_dvd_command_in_context,
        playback_action_to_dvd_command_in_domain, DvdCommandContext,
    };

    #[test]
    fn vmgm_play_title_uses_disc_global_title_numbering() {
        let mut project = test_project();
        add_second_titleset(&mut project);

        let command = playback_action_to_dvd_command(
            &PlaybackAction::PlayTitle {
                title_id: "title-2".to_string(),
            },
            &project.disc,
        );

        assert_eq!(command, "jump title 2");
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

    #[test]
    fn vmgm_play_chapter_uses_disc_global_title_numbering() {
        let mut project = test_project();
        add_second_titleset(&mut project);

        let command = playback_action_to_dvd_command(
            &PlaybackAction::PlayChapter {
                title_id: "title-2".to_string(),
                chapter_id: "ch-3".to_string(),
            },
            &project.disc,
        );

        assert_eq!(command, "jump title 2 chapter 1");
    }

    #[test]
    fn title_return_to_same_titleset_root_menu_uses_call_menu_entry_root() {
        let mut project = test_project();
        project.disc.titlesets[0].menus.push(test_menu_with_action(
            "menu-2",
            "Episode Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        ));

        let command = playback_action_to_dvd_command_in_context(
            &PlaybackAction::ShowMenu {
                menu_id: "menu-2".to_string(),
            },
            &project.disc,
            DvdCommandContext::Title { titleset_index: 0 },
        )
        .unwrap();

        assert_eq!(command, "call menu entry root");
    }

    #[test]
    fn title_return_to_same_titleset_non_root_menu_uses_g0_dispatch() {
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

        let command = playback_action_to_dvd_command_in_context(
            &PlaybackAction::ShowMenu {
                menu_id: "menu-2".to_string(),
            },
            &project.disc,
            DvdCommandContext::Title { titleset_index: 0 },
        )
        .unwrap();

        assert_eq!(command, "{ g0 = 2; call menu entry root; }");
    }

    #[test]
    fn title_return_to_other_titleset_root_menu_uses_call_titleset_entry_root() {
        let mut project = test_project();
        add_second_titleset(&mut project);
        project.disc.titlesets[1].menus.push(test_menu_with_action(
            "menu-2",
            "Bonus Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-2".to_string(),
            },
        ));

        let command = playback_action_to_dvd_command_in_context(
            &PlaybackAction::ShowMenu {
                menu_id: "menu-2".to_string(),
            },
            &project.disc,
            DvdCommandContext::Title { titleset_index: 0 },
        )
        .unwrap();

        assert_eq!(command, "call titleset 2 menu entry root");
    }

    #[test]
    fn title_return_to_other_titleset_non_root_menu_uses_g0_and_entry_root() {
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

        let command = playback_action_to_dvd_command_in_context(
            &PlaybackAction::ShowMenu {
                menu_id: "menu-2".to_string(),
            },
            &project.disc,
            DvdCommandContext::Title { titleset_index: 0 },
        )
        .unwrap();

        assert_eq!(command, "{ g0 = 2; call titleset 2 menu entry root; }");
    }

    #[test]
    fn set_audio_stream_emits_correct_dvdauthor_command() {
        let project = test_project();

        let command = playback_action_to_dvd_command(
            &PlaybackAction::SetAudioStream { stream_index: 0 },
            &project.disc,
        );
        assert_eq!(command, "audio = 0");

        let command = playback_action_to_dvd_command(
            &PlaybackAction::SetAudioStream { stream_index: 2 },
            &project.disc,
        );
        assert_eq!(command, "audio = 2");
    }

    #[test]
    fn set_subtitle_stream_enables_with_display_bit_set() {
        let project = test_project();

        // Stream 0: SPRM 2 = 0x40 | 0 = 64 (display on, stream 0)
        let command = playback_action_to_dvd_command(
            &PlaybackAction::SetSubtitleStream {
                stream_index: Some(0),
            },
            &project.disc,
        );
        assert_eq!(command, "subtitle = 64");

        // Stream 1: SPRM 2 = 0x40 | 1 = 65 (display on, stream 1)
        let command = playback_action_to_dvd_command(
            &PlaybackAction::SetSubtitleStream {
                stream_index: Some(1),
            },
            &project.disc,
        );
        assert_eq!(command, "subtitle = 65");
    }

    #[test]
    fn set_subtitle_stream_none_disables_display() {
        let project = test_project();

        // None → SPRM 2 bit 6 clear → display off. Value 0 = stream 0, not displayed.
        let command = playback_action_to_dvd_command(
            &PlaybackAction::SetSubtitleStream { stream_index: None },
            &project.disc,
        );
        assert_eq!(command, "subtitle = 0");
    }

    #[test]
    fn stop_action_emits_exit() {
        let project = test_project();
        let command = playback_action_to_dvd_command(&PlaybackAction::Stop, &project.disc);
        assert_eq!(command, "exit");
    }

    #[test]
    fn return_action_emits_resume() {
        let project = test_project();
        let command = playback_action_to_dvd_command(&PlaybackAction::Return, &project.disc);
        assert_eq!(command, "resume");
    }
}
