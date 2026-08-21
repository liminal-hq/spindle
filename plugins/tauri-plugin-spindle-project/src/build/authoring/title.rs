// Title section (<titles>/<pgc>) authoring for the dvdauthor XML tree.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::Path;

use crate::models::*;

use super::super::dvd_navigation::{playback_action_to_dvd_command_in_context, DvdCommandContext};
use super::super::util::{format_dvd_timestamp, sanitise_filename, xml_escape};
use super::language::dvdauthor_language_code;

pub(super) fn append_titles_section(
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

    // Declare audio streams in our own authored order if any title in this
    // titleset has audio mappings. Without this, dvdauthor auto-detects
    // streams from the vob itself, and its inferred physical-track order
    // does not reliably match the order the streams actually appear in —
    // confirmed by a mixed AC3+MP2 title where dvdauthor placed the second
    // (MP2) stream at physical audio 0, silently ignoring which track was
    // marked default. Explicit declarations pin the order dvdauthor uses.
    let max_audio = titleset
        .titles
        .iter()
        .map(|t| t.audio_mappings.len())
        .max()
        .unwrap_or(0);
    if max_audio > 0 {
        for i in 0..max_audio {
            let mapping = titleset.titles.iter().find_map(|t| t.audio_mappings.get(i));
            if let Some(am) = mapping {
                let format = dvdauthor_audio_format(am.output_target);
                let lang = dvdauthor_language_code(&am.language);
                let mut attrs = format!(" format=\"{format}\"");
                if let Some(lang) = lang {
                    attrs.push_str(&format!(" lang=\"{}\"", xml_escape(&lang)));
                }
                xml.push_str(&format!("      <audio{attrs} />\n"));
            } else {
                xml.push_str("      <audio />\n");
            }
        }
    }

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
                .and_then(dvdauthor_language_code);
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

fn dvdauthor_audio_format(target: AudioOutputTarget) -> &'static str {
    match target {
        AudioOutputTarget::Ac3 => "ac3",
        AudioOutputTarget::Mp2 => "mp2",
        AudioOutputTarget::Lpcm => "pcm",
        AudioOutputTarget::Dts => "dts",
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
