// DVD authoring XML and navigation command generation.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::Path;

use isolang::Language;

use crate::models::*;

use super::dvd_navigation::{
    playback_action_to_dvd_command_in_context, playback_action_to_dvd_command_in_domain_result,
    playback_action_to_dvd_command_result, DvdCommandContext,
};
use super::menu::{inferred_menu_output_aspect, AuthorableMenuRef, MenuDomain};
use super::util::{format_dvd_timestamp, sanitise_filename, xml_escape};

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

        if has_global_menus {
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

#[allow(clippy::too_many_arguments)]
fn append_menu_section(
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

fn menu_section_aspect(
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

fn parse_aspect_str(value: &str) -> AspectMode {
    match value {
        "4:3" => AspectMode::FourByThree,
        _ => AspectMode::SixteenByNine,
    }
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
                .and_then(dvdauthor_subpicture_language);
            match lang {
                Some(lang) => xml.push_str(&format!(
                    "      <subpicture lang=\"{}\" />\n",
                    xml_escape(&lang)
                )),
                None => xml.push_str("      <subpicture />\n"),
            }
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
        // Expand virtual actions that require titleset context before passing
        // to the navigation command resolver.
        let concrete = expand_title_end_action(action, title, disc, titleset_index)?;
        if let Some(ref concrete_action) = concrete {
            xml.push_str("        <post>\n");
            xml.push_str(&format!(
                "          {};\n",
                playback_action_to_dvd_command_in_context(
                    concrete_action,
                    disc,
                    DvdCommandContext::Title { titleset_index },
                )?
            ));
            xml.push_str("        </post>\n");
        } else if !matches!(action, PlaybackAction::PlayNextInTitleset) {
            // PlayNextInTitleset with no next title → no post block (player stops)
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
    }

    xml.push_str("      </pgc>\n");
    Ok(())
}

/// Expand virtual `PlaybackAction` variants that require full title + titleset context
/// into concrete actions. Used from `append_title_pgc` for title `end_action`.
///
/// Returns:
/// - `Ok(Some(action))` — a concrete action to emit
/// - `Ok(None)` — for `PlayNextInTitleset` when this is the last title (no post block)
/// - `Ok(None)` — for non-virtual actions (caller emits directly)
/// - `Err` — unresolvable context
/// Expand `PlayAllInTitleset` on a menu button to a concrete `Sequence` of
/// `PlayTitle` actions for the titleset in scope. Returns `None` for all other
/// action types. `PlayNextInTitleset` is not meaningful on a button; treated as
/// `Stop`.
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

fn expand_title_end_action(
    action: &PlaybackAction,
    current_title: &Title,
    disc: &Disc,
    titleset_index: usize,
) -> crate::Result<Option<PlaybackAction>> {
    let titleset = disc.titlesets.get(titleset_index).ok_or_else(|| {
        crate::Error::Build(format!(
            "Titleset index {titleset_index} out of range during virtual action expansion"
        ))
    })?;

    match action {
        PlaybackAction::PlayNextInTitleset => {
            // Find the title with the lowest order_index strictly greater than
            // the current title's order_index.
            let next = titleset
                .titles
                .iter()
                .filter(|t| t.order_index > current_title.order_index)
                .min_by_key(|t| t.order_index);
            match next {
                Some(next_title) => Ok(Some(PlaybackAction::PlayTitle {
                    title_id: next_title.id.clone(),
                })),
                // Last title: no post block → player stops.
                None => Ok(None),
            }
        }
        PlaybackAction::PlayAllInTitleset => {
            // Expand to a sequence of PlayTitle for every title in the titleset
            // ordered by order_index. Meaningful as a menu button action but can
            // also appear as a title end_action.
            let mut titles: Vec<&Title> = titleset.titles.iter().collect();
            titles.sort_by_key(|t| t.order_index);
            let actions: Vec<PlaybackAction> = titles
                .iter()
                .map(|t| PlaybackAction::PlayTitle {
                    title_id: t.id.clone(),
                })
                .collect();
            if actions.is_empty() {
                Ok(Some(PlaybackAction::Stop))
            } else {
                Ok(Some(PlaybackAction::Sequence { actions }))
            }
        }
        _ => Ok(None),
    }
}

fn dvdauthor_subpicture_language(language: &str) -> Option<String> {
    let normalised = language
        .trim()
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();

    if matches!(normalised.as_str(), "" | "und" | "nolang") {
        return None;
    }

    // FFprobe often surfaces ISO 639-2/B bibliographic codes from container metadata
    // such as `fre`, while `isolang` resolves the canonical 639-3 form `fra`.
    // Canonicalise the common bibliographic aliases here, then let `isolang`
    // handle the real 639-1/639-3 conversion work.
    let canonical = match normalised.as_str() {
        "alb" => "sqi",
        "arm" => "hye",
        "baq" => "eus",
        "bur" => "mya",
        "chi" => "zho",
        "cze" => "ces",
        "dut" => "nld",
        "fre" => "fra",
        "geo" => "kat",
        "ger" => "deu",
        "gre" => "ell",
        "ice" => "isl",
        "mac" => "mkd",
        "mao" => "mri",
        "may" => "msa",
        "per" => "fas",
        "rum" => "ron",
        "slo" => "slk",
        "tib" => "bod",
        "wel" => "cym",
        _ => normalised.as_str(),
    };

    Language::from_639_1(canonical)
        .and_then(|lang| lang.to_639_1())
        .or_else(|| Language::from_639_3(canonical).and_then(|lang| lang.to_639_1()))
        .map(str::to_string)
}
#[cfg(test)]
mod tests {
    use crate::build::generate_build_plan;
    use crate::build::test_support::{
        add_second_titleset, test_menu, test_menu_with_action, test_project,
    };
    use crate::models::{
        AspectMode, AudioOutputTarget, AudioTrackMapping, ChapterPoint, CopyMode, MenuDomain,
        PlaybackAction, SubtitleStreamInfo, SubtitleTrackMapping, SubtitleType, Title,
        VideoOutputProfile, VideoRaster, VideoStandard, VideoTrackMapping,
    };

    fn make_title(id: &str, name: &str, order_index: u32) -> Title {
        Title {
            id: id.to_string(),
            name: name.to_string(),
            source_asset_id: Some("asset-1".to_string()),
            video_mapping: Some(VideoTrackMapping {
                source_stream_index: 0,
                copy_mode: CopyMode::ReEncode,
            }),
            video_output_profile: Some(VideoOutputProfile {
                raster: VideoRaster::FullD1,
                aspect: crate::models::AspectMode::SixteenByNine,
            }),
            audio_mappings: vec![AudioTrackMapping {
                id: "am-x".to_string(),
                source_stream_index: 1,
                output_target: AudioOutputTarget::Ac3,
                copy_mode: CopyMode::ReEncode,
                label: "English".to_string(),
                language: "eng".to_string(),
                order_index: 0,
                is_default: true,
            }],
            subtitle_mappings: vec![],
            chapters: vec![ChapterPoint {
                id: "ch-x".to_string(),
                name: "Chapter 1".to_string(),
                timestamp_secs: 0.0,
                order_index: 0,
            }],
            end_action: None,
            order_index,
        }
    }

    #[test]
    fn play_next_in_titleset_expands_to_next_title_by_order_index() {
        let mut project = test_project();
        // Add a second title to the titleset with a higher order_index.
        project.disc.titlesets[0]
            .titles
            .push(make_title("title-2", "Episode 2", 1));
        project.disc.titlesets[0].titles[0].order_index = 0;
        project.disc.titlesets[0].titles[0].end_action = Some(PlaybackAction::PlayNextInTitleset);

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        // The first title's <post> should jump to title 2 (local titleset numbering).
        assert!(
            plan.dvdauthor_xml
                .contains("<post>\n          jump title 2;\n        </post>"),
            "PlayNextInTitleset should expand to a jump to the next title\n{}",
            plan.dvdauthor_xml
        );
    }

    #[test]
    fn play_next_in_titleset_last_title_emits_no_post_block() {
        let mut project = test_project();
        // Only one title — it is already the last in the titleset.
        project.disc.titlesets[0].titles[0].order_index = 0;
        project.disc.titlesets[0].titles[0].end_action = Some(PlaybackAction::PlayNextInTitleset);

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        // No <post> block should be emitted when this is the last title.
        assert!(
            !plan.dvdauthor_xml.contains("<post>"),
            "PlayNextInTitleset on the last title should emit no <post> block\n{}",
            plan.dvdauthor_xml
        );
    }

    #[test]
    fn play_all_in_titleset_on_button_expands_to_sequence_of_play_title() {
        let mut project = test_project();
        project.disc.titlesets[0]
            .titles
            .push(make_title("title-2", "Episode 2", 1));
        project.disc.titlesets[0].titles[0].order_index = 0;

        // Create a titleset menu with a "Play All" button.
        let menu = test_menu_with_action(
            "ts-menu-1",
            "Titleset Menu",
            PlaybackAction::PlayAllInTitleset,
        );
        project.disc.titlesets[0].menus.push(menu);

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        // The button command should expand to a sequence jumping both titles.
        assert!(
            plan.dvdauthor_xml.contains("jump title 1")
                && plan.dvdauthor_xml.contains("jump title 2"),
            "PlayAllInTitleset button should expand to a sequence jumping all titles\n{}",
            plan.dvdauthor_xml
        );
    }

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
    fn dvdauthor_xml_targets_named_disc_output_directory() {
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(
            plan.dvdauthor_xml
                .contains("<dvdauthor dest=\"/tmp/dvd_output/DVD_DISC\">"),
            "dvdauthor XML should target the named authored disc directory, not the raw output root or a nested VIDEO_TS directory\n{}",
            plan.dvdauthor_xml
        );
    }

    #[test]
    fn dvdauthor_xml_uses_authored_menu_display_aspect() {
        let mut project = test_project();
        let mut menu = test_menu();
        menu.migrate_to_document(
            MenuDomain::Vmgm,
            VideoStandard::Ntsc,
            AspectMode::FourByThree,
        );
        project.disc.global_menus.push(menu);

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan
            .dvdauthor_xml
            .contains("<video format=\"ntsc\" aspect=\"4:3\" />"));
    }

    #[test]
    fn dvdauthor_xml_rejects_mixed_menu_aspects_within_one_section() {
        let mut project = test_project();
        let mut menu_a = test_menu_with_action(
            "menu-1",
            "Menu A",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        );
        menu_a.migrate_to_document(
            MenuDomain::Vmgm,
            VideoStandard::Ntsc,
            AspectMode::FourByThree,
        );

        let mut menu_b = test_menu_with_action(
            "menu-2",
            "Menu B",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        );
        menu_b.migrate_to_document(
            MenuDomain::Vmgm,
            VideoStandard::Ntsc,
            AspectMode::SixteenByNine,
        );

        project.disc.global_menus.extend([menu_a, menu_b]);

        let err = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap_err();
        assert!(err
            .to_string()
            .contains("Menus in the same DVD menu section must share one display aspect"));
    }

    #[test]
    fn dvdauthor_xml_normalises_subpicture_languages_for_dvdauthor() {
        let mut project = test_project();
        project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
            index: 2,
            codec: "dvd_subtitle".to_string(),
            language: Some("eng".to_string()),
            subtitle_type: SubtitleType::Bitmap,
            title: None,
        });
        project.disc.titlesets[0].titles[0]
            .subtitle_mappings
            .push(SubtitleTrackMapping {
                id: "sm-1".to_string(),
                source_stream_index: 2,
                label: "English".to_string(),
                language: "eng".to_string(),
                order_index: 0,
                is_default: false,
                is_forced: false,
            });

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan.dvdauthor_xml.contains("<subpicture lang=\"en\" />"));
    }

    #[test]
    fn dvdauthor_xml_omits_invalid_subpicture_language_values() {
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

        assert!(plan.dvdauthor_xml.contains("<subpicture />"));
    }

    #[test]
    fn dvdauthor_xml_normalises_bibliographic_french_language_code() {
        let mut project = test_project();
        project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
            index: 2,
            codec: "dvd_subtitle".to_string(),
            language: Some("fre".to_string()),
            subtitle_type: SubtitleType::Bitmap,
            title: None,
        });
        project.disc.titlesets[0].titles[0]
            .subtitle_mappings
            .push(SubtitleTrackMapping {
                id: "sm-1".to_string(),
                source_stream_index: 2,
                label: "French".to_string(),
                language: "fre".to_string(),
                order_index: 0,
                is_default: false,
                is_forced: false,
            });

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(
            plan.dvdauthor_xml.contains("<subpicture lang=\"fr\" />"),
            "expected bibliographic French code to normalise to fr\n{}",
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
            plan.dvdauthor_xml
                .contains("<pre>\n          button = 1024;\n        </pre>"),
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
            plan.dvdauthor_xml
                .contains("<pre>\n          button = 2048;\n        </pre>"),
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

        assert!(plan
            .dvdauthor_xml
            .contains("<post>\n          { g0 = 2; call menu entry root; };\n        </post>"));
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

    /// A menu button with no action must still produce a `<button>` element so that
    /// dvdauthor's button numbering matches the spumux subpicture overlay. Omitting
    /// the element shifts all subsequent button numbers and triggers dvdauthor's
    /// "Cannot find button N" assertion.
    #[test]
    fn menu_button_with_no_action_emits_empty_button_element() {
        let mut project = test_project();
        let mut menu = test_menu_with_action(
            "menu-1",
            "Main Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        );
        // Add a second button with no action (e.g. a "not yet implemented" placeholder).
        menu.buttons.push(crate::models::MenuButton {
            id: "btn-noop".to_string(),
            label: "Coming Soon".to_string(),
            bounds: crate::models::ButtonBounds {
                x: 120.0,
                y: 380.0,
                width: 240.0,
                height: 48.0,
            },
            action: None,
            nav_up: Some("btn-1".to_string()),
            nav_down: None,
            nav_left: None,
            nav_right: None,
            highlight_mode: crate::models::HighlightMode::Static,
            highlight_keyframes: vec![],
            video_asset_id: None,
        });
        project.disc.global_menus.push(menu);

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        // Both buttons must be present — one with a command, one empty.
        assert!(
            plan.dvdauthor_xml
                .contains("<button>jump title 1;</button>"),
            "First button (with action) should emit its DVD command\n{}",
            plan.dvdauthor_xml
        );
        assert!(
            plan.dvdauthor_xml.contains("<button>resume;</button>"),
            "No-action button must emit resume; to stay on the menu rather than stopping playback\n{}",
            plan.dvdauthor_xml
        );
    }

    /// When a no-action button appears between two buttons that do have actions, the
    /// relative order of all three `<button>` elements must be preserved so that
    /// spumux button slots align correctly.
    #[test]
    fn menu_button_order_preserved_with_mixed_action_and_no_action_buttons() {
        let mut project = test_project();
        let mut menu = test_menu_with_action(
            "menu-1",
            "Main Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        );
        // btn-1 already set by test_menu_with_action (has action: jump title 1)
        // Insert no-action btn in slot 2
        menu.buttons.push(crate::models::MenuButton {
            id: "btn-noop".to_string(),
            label: "Placeholder".to_string(),
            bounds: crate::models::ButtonBounds {
                x: 120.0,
                y: 380.0,
                width: 240.0,
                height: 48.0,
            },
            action: None,
            nav_up: None,
            nav_down: None,
            nav_left: None,
            nav_right: None,
            highlight_mode: crate::models::HighlightMode::Static,
            highlight_keyframes: vec![],
            video_asset_id: None,
        });
        // btn-3 has action: Stop (slot 3)
        menu.buttons.push(crate::models::MenuButton {
            id: "btn-stop".to_string(),
            label: "Exit".to_string(),
            bounds: crate::models::ButtonBounds {
                x: 120.0,
                y: 440.0,
                width: 240.0,
                height: 48.0,
            },
            action: Some(PlaybackAction::Stop),
            nav_up: None,
            nav_down: None,
            nav_left: None,
            nav_right: None,
            highlight_mode: crate::models::HighlightMode::Static,
            highlight_keyframes: vec![],
            video_asset_id: None,
        });
        project.disc.global_menus.push(menu);

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        // Extract the button elements in document order.
        let buttons: Vec<&str> = plan
            .dvdauthor_xml
            .lines()
            .filter(|l| l.trim().starts_with("<button>"))
            .collect();
        assert_eq!(
            buttons.len(),
            3,
            "Three buttons should be emitted (including the no-action one)\n{}",
            plan.dvdauthor_xml
        );
        assert!(
            buttons[0].contains("jump title 1"),
            "Slot 1 should be the play-title button"
        );
        assert!(
            buttons[1] == "        <button>resume;</button>",
            "Slot 2 should be the no-action button, emitting resume; to stay on the menu"
        );
        assert!(
            buttons[2].contains("exit"),
            "Slot 3 should be the stop/exit button"
        );
    }
}
