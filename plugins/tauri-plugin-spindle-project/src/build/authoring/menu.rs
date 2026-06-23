// Menu section (<menus>/<pgc>) authoring for the dvdauthor XML tree.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::Path;

use crate::models::*;

use super::super::dvd_navigation::playback_action_to_dvd_command_in_domain_result;
use super::super::menu::{inferred_menu_output_aspect, AuthorableMenuRef, MenuDomain};
use super::super::util::{sanitise_filename, xml_escape};
use super::{aspect_str, parse_aspect_str};

#[allow(clippy::too_many_arguments)]
pub(super) fn append_menu_section(
    xml: &mut String,
    format_str: &str,
    section_aspect_str: &str,
    menus: &[Menu],
    domain: MenuDomain,
    disc: &Disc,
    project: &SpindleProjectFile,
    menus_dir: &Path,
) -> crate::Result<()> {
    xml.push_str("    <menus>\n");
    xml.push_str(&format!(
        "      <video format=\"{format_str}\" aspect=\"{section_aspect_str}\" />\n"
    ));

    // For titleset menu sections with multiple PGCs, the entry PGC (first)
    // needs a g0-based dispatch so VMGM buttons can target specific menus.
    let needs_dispatch = matches!(domain, MenuDomain::Titleset(_)) && menus.len() > 1;

    for (menu_index, menu) in menus.iter().enumerate() {
        let menu_ref = AuthorableMenuRef { menu, domain };
        let menu_aspect = menu_ref.display_aspect(project);
        if menu_aspect != parse_aspect_str(section_aspect_str) {
            return Err(crate::Error::Build(format!(
                "Menu section mixes authored display aspects; menu \"{}\" resolves to {} while the section is {}.",
                menu_ref.name(),
                aspect_str(menu_aspect),
                section_aspect_str
            )));
        }
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
        if let Some(button_command) = initial_button_command(&menu_ref) {
            pre_commands.push_str(&button_command);
        }
        let pre_commands = if pre_commands.is_empty() {
            None
        } else {
            Some(pre_commands)
        };

        append_menu_pgc(
            xml,
            MenuPgcSpec {
                menu_ref: &menu_ref,
                disc,
                domain,
                menu_number,
                menus_dir,
                entry,
                pre_commands: pre_commands.as_deref(),
            },
        )?;
    }
    xml.push_str("    </menus>\n");
    Ok(())
}

pub(super) fn menu_section_aspect(
    project: &SpindleProjectFile,
    menus: &[Menu],
    domain: MenuDomain,
) -> crate::Result<AspectMode> {
    let mut resolved = menus.iter().map(|menu| {
        let menu_ref = AuthorableMenuRef { menu, domain };
        menu_ref.display_aspect(project)
    });
    let first = resolved
        .next()
        .unwrap_or_else(|| inferred_menu_output_aspect(project, domain));
    if resolved.any(|aspect| aspect != first) {
        return Err(crate::Error::Build(
            "Menus in the same DVD menu section must share one display aspect. Split mismatched menus into separate sections or align their authored display aspect."
                .to_string(),
        ));
    }
    Ok(first)
}

fn initial_button_command(menu_ref: &AuthorableMenuRef<'_>) -> Option<String> {
    let buttons = menu_ref.buttons();
    let button_index = menu_ref
        .default_button_id()
        .and_then(|default_id| buttons.iter().position(|button| button.id == default_id))
        .or_else(|| (!buttons.is_empty()).then_some(0))?;
    let button_value = (button_index + 1) * 1024;
    Some(format!("          button = {button_value};\n"))
}

struct MenuPgcSpec<'a> {
    menu_ref: &'a AuthorableMenuRef<'a>,
    disc: &'a Disc,
    domain: MenuDomain,
    menu_number: usize,
    menus_dir: &'a Path,
    entry: Option<&'a str>,
    pre_commands: Option<&'a str>,
}

fn append_menu_pgc(xml: &mut String, spec: MenuPgcSpec<'_>) -> crate::Result<()> {
    match spec.entry {
        Some(entry) => xml.push_str(&format!("      <pgc entry=\"{entry}\">\n")),
        None => xml.push_str("      <pgc>\n"),
    }
    if let Some(pre) = spec.pre_commands {
        xml.push_str("        <pre>\n");
        xml.push_str(pre);
        xml.push_str("        </pre>\n");
    }
    let menu_vob_path = spec
        .menus_dir
        .join(format!("{}.mpg", sanitise_filename(&spec.menu_ref.menu.id)));
    xml.push_str(&format!(
        "        <vob file=\"{}\" pause=\"inf\" />\n",
        xml_escape(&menu_vob_path.display().to_string())
    ));
    for button in spec.menu_ref.buttons() {
        match button.action {
            Some(action) => {
                // Expand PlayAllInTitleset to a concrete Sequence before passing to
                // the DVD command resolver. PlayNextInTitleset is not meaningful on a
                // menu button (it has no "current title" context here), so it is
                // treated as Stop.
                let expanded_for_button =
                    expand_playall_button_action(action, spec.disc, spec.domain);
                let resolved_action = expanded_for_button.as_ref().unwrap_or(action);
                let cmd = playback_action_to_dvd_command_in_domain_result(
                    resolved_action,
                    spec.disc,
                    spec.domain,
                    Some(spec.menu_number),
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
            None => {
                // Buttons with no action still occupy a subpicture button slot in the
                // spumux overlay. Omitting them here would create a count mismatch
                // between the subpicture stream and the PGC button list, causing
                // dvdauthor to abort with "Cannot find button N". Emit `resume` so
                // the player stays on the menu when the button is activated, rather
                // than stopping playback entirely (which an empty <button> causes).
                xml.push_str("        <button>resume;</button>\n");
            }
        }
    }
    xml.push_str("      </pgc>\n");
    Ok(())
}

/// Expand `PlayAllInTitleset` on a menu button to a concrete `Sequence` of
/// `PlayTitle` actions for the titleset in scope. Returns `None` for all other
/// action types. `PlayNextInTitleset` is not meaningful on a button and is
/// treated as `Stop`.
fn expand_playall_button_action(
    action: &PlaybackAction,
    disc: &Disc,
    domain: MenuDomain,
) -> Option<PlaybackAction> {
    match action {
        PlaybackAction::PlayAllInTitleset => {
            let titleset_index = match domain {
                MenuDomain::Titleset(i) => i,
                MenuDomain::Vmgm => return Some(PlaybackAction::Stop),
            };
            let titleset = disc.titlesets.get(titleset_index)?;
            let mut titles: Vec<&Title> = titleset.titles.iter().collect();
            titles.sort_by_key(|t| t.order_index);
            let actions: Vec<PlaybackAction> = titles
                .iter()
                .map(|t| PlaybackAction::PlayTitle {
                    title_id: t.id.clone(),
                })
                .collect();
            if actions.is_empty() {
                Some(PlaybackAction::Stop)
            } else {
                Some(PlaybackAction::Sequence { actions })
            }
        }
        PlaybackAction::PlayNextInTitleset => Some(PlaybackAction::Stop),
        _ => None,
    }
}
