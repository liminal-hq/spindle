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

    let is_motion = matches!(spec.menu_ref.background_mode(), BackgroundMode::Motion);
    let base_name = sanitise_filename(&spec.menu_ref.menu.id);
    let loop_count = spec.menu_ref.motion_loop_count();
    let has_intro = spec.menu_ref.menu.doc().timing.intro_duration_secs > 0.0;
    let loop_cell = if has_intro { 2 } else { 1 };
    // Only the counting form of the <post> (K > 0 with a resolvable timeout
    // action) touches the counter — g0 is already taken by menu dispatch
    // (see `dvd_navigation.rs`), so this uses g1, verified unused elsewhere.
    let uses_counter = is_motion && loop_count > 0 && spec.menu_ref.timeout_action().is_some();

    if uses_counter || spec.pre_commands.is_some() {
        xml.push_str("        <pre>\n");
        if uses_counter {
            xml.push_str("          g1 = 0;\n");
        }
        if let Some(pre) = spec.pre_commands {
            xml.push_str(pre);
        }
        xml.push_str("        </pre>\n");
    }

    if is_motion {
        if has_intro {
            let intro_vob_path = spec.menus_dir.join(format!("{base_name}_intro.mpg"));
            xml.push_str(&format!(
                "        <vob file=\"{}\" />\n",
                xml_escape(&intro_vob_path.display().to_string())
            ));
        }
        let loop_vob_path = spec.menus_dir.join(format!("{base_name}.mpg"));
        xml.push_str(&format!(
            "        <vob file=\"{}\" />\n",
            xml_escape(&loop_vob_path.display().to_string())
        ));
    } else {
        let menu_vob_path = spec.menus_dir.join(format!("{base_name}.mpg"));
        xml.push_str(&format!(
            "        <vob file=\"{}\" pause=\"inf\" />\n",
            xml_escape(&menu_vob_path.display().to_string())
        ));
    }
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

    if is_motion {
        let post_body = motion_post_body(&spec, loop_count, loop_cell, uses_counter)?;
        xml.push_str("        <post>\n          ");
        xml.push_str(&post_body);
        xml.push_str("\n        </post>\n");
    }

    xml.push_str("      </pgc>\n");
    Ok(())
}

/// Derive a motion menu's `<post>` body — evaluated when the loop cell's VOB
/// finishes playing. See design decision D3:
///
/// - `K == 0` (infinite loop, no counting): `jump cell N;`.
/// - `K > 0` with a resolvable timeout action: increment a per-entry counter
///   (`g1`, reset to 0 in `<pre>` — see `append_menu_pgc`) and keep looping
///   until it reaches `K`, then run the timeout action.
/// - `K > 0` with no timeout action: there is nothing to fall through to, so
///   this degrades to the same infinite `jump cell N;` as `K == 0` — a
///   `<post>` must never fall off the end. `menu.motion-loop-count-without-timeout`
///   flags this authored mismatch separately (see `validation/menu.rs`).
fn motion_post_body(
    spec: &MenuPgcSpec<'_>,
    loop_count: u32,
    loop_cell: usize,
    uses_counter: bool,
) -> crate::Result<String> {
    if !uses_counter {
        return Ok(format!("jump cell {loop_cell};"));
    }

    let timeout_action = spec
        .menu_ref
        .timeout_action()
        .expect("uses_counter implies a resolvable timeout action");
    let timeout_cmd = playback_action_to_dvd_command_in_domain_result(
        timeout_action,
        spec.disc,
        spec.domain,
        Some(spec.menu_number),
    )?;
    let timeout_cmd = if timeout_cmd.starts_with('{') {
        timeout_cmd
    } else {
        format!("{timeout_cmd};")
    };

    Ok(format!(
        "g1 = g1 + 1; if (g1 lt {loop_count}) {{ jump cell {loop_cell}; }} g1 = 0; {timeout_cmd}"
    ))
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
