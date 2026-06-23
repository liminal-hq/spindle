// Chapter-target lookup helpers shared by title end-action and menu-action validation.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use crate::models::*;

pub(super) fn chapter_target_exists(disc: &Disc, title_id: &str, chapter_id: &str) -> bool {
    disc.titlesets
        .iter()
        .flat_map(|titleset| titleset.titles.iter())
        .find(|title| title.id == title_id)
        .is_some_and(|title| {
            title
                .chapters
                .iter()
                .any(|chapter| chapter.id == chapter_id)
        })
}

pub(super) fn dangling_play_chapter_issue(
    code: &str,
    message: String,
    context: Option<String>,
    entity_type: &str,
    entity_name: Option<String>,
    suggested_fix: &str,
) -> ValidationIssue {
    ValidationIssue {
        severity: IssueSeverity::Error,
        code: code.to_string(),
        message,
        context,
        entity_type: Some(entity_type.to_string()),
        entity_name,
        suggested_fix: Some(suggested_fix.to_string()),
    }
}
