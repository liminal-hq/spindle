// Validates a single PlaybackAction's targets (title/menu/chapter refs, stream indices).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashSet;

use crate::models::*;

use super::chapter::{chapter_target_exists, dangling_play_chapter_issue};

#[allow(clippy::too_many_arguments)]
pub(super) fn validate_action(
    action: &PlaybackAction,
    all_title_ids: &HashSet<&str>,
    all_menu_ids: &HashSet<&str>,
    disc: &Disc,
    menu_name: &str,
    menu_id: &str,
    button_label: &str,
    stream_counts: Option<(usize, usize)>,
    issues: &mut Vec<ValidationIssue>,
) {
    match action {
        PlaybackAction::PlayTitle { title_id } => {
            if !all_title_ids.contains(title_id.as_str()) {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    code: "menu.dangling-title-ref".to_string(),
                    message: format!(
                        "Action \"{}\" in menu \"{}\" references a title that does not exist.",
                        button_label, menu_name
                    ),
                    context: Some(menu_id.to_string()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu_name.to_string()),
                    suggested_fix: Some(
                        "Update the action to point to an existing title or remove it.".to_string(),
                    ),
                });
            }
        }
        PlaybackAction::ShowMenu {
            menu_id: target_id, ..
        } => {
            if !all_menu_ids.contains(target_id.as_str()) {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    code: "menu.dangling-menu-ref".to_string(),
                    message: format!(
                        "Action \"{}\" in menu \"{}\" references a menu that does not exist.",
                        button_label, menu_name
                    ),
                    context: Some(menu_id.to_string()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu_name.to_string()),
                    suggested_fix: Some(
                        "Update the action to point to an existing menu or remove it.".to_string(),
                    ),
                });
            }
        }
        PlaybackAction::PlayChapter {
            title_id,
            chapter_id,
        } => {
            if !chapter_target_exists(disc, title_id, chapter_id) {
                issues.push(dangling_play_chapter_issue(
                    "menu.dangling-chapter-ref",
                    format!(
                        "Action \"{}\" in menu \"{}\" references a chapter target that does not exist.",
                        button_label, menu_name
                    ),
                    Some(menu_id.to_string()),
                    "menu",
                    Some(menu_name.to_string()),
                    "Update the action to point to an existing chapter or remove it.",
                ));
            }
        }
        PlaybackAction::SetAudioStream { stream_index } => {
            if let Some((audio_count, _)) = stream_counts {
                if audio_count == 0 {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.action.audio-stream-no-tracks".to_string(),
                        message: format!(
                            "Action \"{}\" in menu \"{}\" sets audio stream {}, but this titleset has no audio tracks.",
                            button_label, menu_name, stream_index
                        ),
                        context: Some(menu_id.to_string()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu_name.to_string()),
                        suggested_fix: Some("Add audio track mappings to the titles in this titleset, or remove this action.".to_string()),
                    });
                } else if *stream_index as usize >= audio_count {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.action.audio-stream-out-of-range".to_string(),
                        message: format!(
                            "Action \"{}\" in menu \"{}\" sets audio stream {}, but this titleset only has {} audio track(s) (valid indices: 0–{}).",
                            button_label, menu_name, stream_index, audio_count, audio_count - 1
                        ),
                        context: Some(menu_id.to_string()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu_name.to_string()),
                        suggested_fix: Some(format!(
                            "Use a stream index between 0 and {} inclusive, or add more audio track mappings.",
                            audio_count - 1
                        )),
                    });
                }
            }
        }
        PlaybackAction::SetSubtitleStream { stream_index } => {
            // stream_index of None means "disable subtitles" — always valid.
            if let (Some(idx), Some((_, subtitle_count))) = (stream_index, stream_counts) {
                if subtitle_count == 0 {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.action.subtitle-stream-no-tracks".to_string(),
                        message: format!(
                            "Action \"{}\" in menu \"{}\" sets subtitle stream {}, but this titleset has no subtitle tracks.",
                            button_label, menu_name, idx
                        ),
                        context: Some(menu_id.to_string()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu_name.to_string()),
                        suggested_fix: Some("Add subtitle track mappings to the titles in this titleset, or use disable-subtitles instead.".to_string()),
                    });
                } else if *idx as usize >= subtitle_count {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.action.subtitle-stream-out-of-range".to_string(),
                        message: format!(
                            "Action \"{}\" in menu \"{}\" sets subtitle stream {}, but this titleset only has {} subtitle track(s) (valid indices: 0–{}).",
                            button_label, menu_name, idx, subtitle_count, subtitle_count - 1
                        ),
                        context: Some(menu_id.to_string()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu_name.to_string()),
                        suggested_fix: Some(format!(
                            "Use a stream index between 0 and {} inclusive, or add more subtitle track mappings.",
                            subtitle_count - 1
                        )),
                    });
                }
            }
        }
        PlaybackAction::Sequence { actions } => {
            for nested in actions {
                validate_action(
                    nested,
                    all_title_ids,
                    all_menu_ids,
                    disc,
                    menu_name,
                    menu_id,
                    button_label,
                    stream_counts,
                    issues,
                );
            }
        }
        PlaybackAction::Stop | PlaybackAction::Return => {}
        // Virtual actions expanded at authoring time; no cross-reference validation needed.
        PlaybackAction::PlayNextInTitleset | PlaybackAction::PlayAllInTitleset => {}
    }
}
