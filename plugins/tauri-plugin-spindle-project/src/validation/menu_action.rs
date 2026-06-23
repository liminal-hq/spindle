// Validates a single PlaybackAction's targets (title/menu/chapter refs, stream indices).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashSet;

use crate::models::*;

use super::chapter::{chapter_target_exists, dangling_play_chapter_issue};

/// Describes where an action lives, for issue messages and routing.
///
/// `subject` is a human-readable phrase naming the action and its owner
/// (e.g. `"Action \"Play Title 1\" in menu \"Main Menu\""` or `"Disc
/// first-play action"`), used as the lead-in for every generated message.
/// `entity_type`/`entity_name`/`context_id` populate `ValidationIssue` so the
/// frontend can route a click to the right page (see `entityType` handling
/// in `BuildPage.tsx`/`OverviewPage.tsx`).
pub(super) struct ActionSubject<'a> {
    pub(super) subject: String,
    pub(super) entity_type: &'a str,
    pub(super) entity_name: Option<&'a str>,
    pub(super) context_id: Option<&'a str>,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn validate_action(
    action: &PlaybackAction,
    all_title_ids: &HashSet<&str>,
    all_menu_ids: &HashSet<&str>,
    disc: &Disc,
    subject: &ActionSubject<'_>,
    stream_counts: Option<(usize, usize)>,
    issues: &mut Vec<ValidationIssue>,
) {
    let issue = |code: &str, message: String, suggested_fix: String| ValidationIssue {
        severity: IssueSeverity::Error,
        code: code.to_string(),
        message,
        context: subject.context_id.map(|id| id.to_string()),
        entity_type: Some(subject.entity_type.to_string()),
        entity_name: subject.entity_name.map(|name| name.to_string()),
        suggested_fix: Some(suggested_fix),
    };

    match action {
        PlaybackAction::PlayTitle { title_id } => {
            if !all_title_ids.contains(title_id.as_str()) {
                issues.push(issue(
                    "menu.dangling-title-ref",
                    format!(
                        "{} references a title that does not exist.",
                        subject.subject
                    ),
                    "Update the action to point to an existing title or remove it.".to_string(),
                ));
            }
        }
        PlaybackAction::ShowMenu {
            menu_id: target_id, ..
        } => {
            if !all_menu_ids.contains(target_id.as_str()) {
                issues.push(issue(
                    "menu.dangling-menu-ref",
                    format!("{} references a menu that does not exist.", subject.subject),
                    "Update the action to point to an existing menu or remove it.".to_string(),
                ));
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
                        "{} references a chapter target that does not exist.",
                        subject.subject
                    ),
                    subject.context_id.map(|id| id.to_string()),
                    subject.entity_type,
                    subject.entity_name.map(|name| name.to_string()),
                    "Update the action to point to an existing chapter or remove it.",
                ));
            }
        }
        PlaybackAction::SetAudioStream { stream_index } => {
            if let Some((audio_count, _)) = stream_counts {
                if audio_count == 0 {
                    issues.push(issue(
                        "menu.action.audio-stream-no-tracks",
                        format!(
                            "{} sets audio stream {}, but this titleset has no audio tracks.",
                            subject.subject, stream_index
                        ),
                        "Add audio track mappings to the titles in this titleset, or remove this action.".to_string(),
                    ));
                } else if *stream_index as usize >= audio_count {
                    issues.push(issue(
                        "menu.action.audio-stream-out-of-range",
                        format!(
                            "{} sets audio stream {}, but this titleset only has {} audio track(s) (valid indices: 0–{}).",
                            subject.subject, stream_index, audio_count, audio_count - 1
                        ),
                        format!(
                            "Use a stream index between 0 and {} inclusive, or add more audio track mappings.",
                            audio_count - 1
                        ),
                    ));
                }
            }
        }
        PlaybackAction::SetSubtitleStream { stream_index } => {
            // stream_index of None means "disable subtitles" — always valid.
            if let (Some(idx), Some((_, subtitle_count))) = (stream_index, stream_counts) {
                if subtitle_count == 0 {
                    issues.push(issue(
                        "menu.action.subtitle-stream-no-tracks",
                        format!(
                            "{} sets subtitle stream {}, but this titleset has no subtitle tracks.",
                            subject.subject, idx
                        ),
                        "Add subtitle track mappings to the titles in this titleset, or use disable-subtitles instead.".to_string(),
                    ));
                } else if *idx as usize >= subtitle_count {
                    issues.push(issue(
                        "menu.action.subtitle-stream-out-of-range",
                        format!(
                            "{} sets subtitle stream {}, but this titleset only has {} subtitle track(s) (valid indices: 0–{}).",
                            subject.subject, idx, subtitle_count, subtitle_count - 1
                        ),
                        format!(
                            "Use a stream index between 0 and {} inclusive, or add more subtitle track mappings.",
                            subtitle_count - 1
                        ),
                    ));
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
                    subject,
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
