// Disc-level structural checks: titlesets present, titles present, first-play action set.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use crate::models::*;

/// Runs disc-level checks and returns the total title count across all titlesets,
/// which the build-settings checks also need.
pub(super) fn validate_disc(
    project: &SpindleProjectFile,
    issues: &mut Vec<ValidationIssue>,
) -> usize {
    if project.disc.titlesets.is_empty() {
        issues.push(ValidationIssue {
            severity: IssueSeverity::Error,
            code: "disc.no-titlesets".to_string(),
            message: "Disc must contain at least one titleset.".to_string(),
            context: None,
            entity_type: Some("disc".to_string()),
            entity_name: None,
            suggested_fix: Some("Add at least one titleset to the disc.".to_string()),
        });
    }

    let total_titles: usize = project
        .disc
        .titlesets
        .iter()
        .map(|ts| ts.titles.len())
        .sum();

    if total_titles == 0 {
        issues.push(ValidationIssue {
            severity: IssueSeverity::Warning,
            code: "disc.no-titles".to_string(),
            message: "No titles have been added to the disc.".to_string(),
            context: None,
            entity_type: Some("disc".to_string()),
            entity_name: None,
            suggested_fix: Some(
                "Add titles in the Titles page to define the disc's playback structure."
                    .to_string(),
            ),
        });
    }

    if project.disc.first_play_action.is_none() && total_titles > 0 {
        issues.push(ValidationIssue {
            severity: IssueSeverity::Info,
            code: "disc.no-first-play".to_string(),
            message: "No first-play action is set. Consider setting a menu or title as the entry point.".to_string(),
            context: None,
            entity_type: Some("disc".to_string()),
            entity_name: None,
            suggested_fix: Some("Set a first-play action on the overview page so the disc has a defined startup behaviour.".to_string()),
        });
    }

    total_titles
}
