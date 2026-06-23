// Disc-level structural checks: titlesets present, titles present, first-play action set
// and pointing at a target that still exists.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashSet;

use crate::models::*;

use super::menu_action::{validate_action, ActionSubject};

/// Runs disc-level checks and returns the total title count across all titlesets,
/// which the build-settings checks also need.
pub(super) fn validate_disc(
    project: &SpindleProjectFile,
    all_title_ids: &HashSet<&str>,
    all_menu_ids: &HashSet<&str>,
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

    match &project.disc.first_play_action {
        None if total_titles > 0 => {
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
        Some(action) => {
            validate_action(
                action,
                all_title_ids,
                all_menu_ids,
                &project.disc,
                &ActionSubject {
                    subject: "Disc first-play action".to_string(),
                    entity_type: "disc",
                    entity_name: None,
                    context_id: None,
                },
                None,
                issues,
            );
        }
        None => {}
    }

    total_titles
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project_with_one_title() -> SpindleProjectFile {
        let mut project = SpindleProjectFile::default();
        project.disc.titlesets.push(Titleset {
            id: "titleset-1".to_string(),
            name: "Main".to_string(),
            titles: vec![Title {
                id: "title-1".to_string(),
                name: "Feature".to_string(),
                source_asset_id: None,
                video_mapping: None,
                video_output_profile: None,
                audio_mappings: vec![],
                subtitle_mappings: vec![],
                chapters: vec![],
                end_action: None,
                order_index: 0,
                bitrate_weight: 1.0,
                bitrate_floor_bps: None,
                bitrate_ceiling_bps: None,
                pinned_bitrate_bps: None,
            }],
            menus: vec![],
        });
        project
    }

    #[test]
    fn validate_disc_flags_first_play_action_targeting_a_deleted_title() {
        let mut project = project_with_one_title();
        project.disc.first_play_action = Some(PlaybackAction::PlayTitle {
            title_id: "stale-title-id".to_string(),
        });
        let all_title_ids: HashSet<&str> = ["title-1"].into_iter().collect();
        let all_menu_ids: HashSet<&str> = HashSet::new();
        let mut issues = Vec::new();

        validate_disc(&project, &all_title_ids, &all_menu_ids, &mut issues);

        assert!(
            issues
                .iter()
                .any(|i| i.code == "menu.dangling-title-ref"
                    && i.entity_type.as_deref() == Some("disc")),
            "expected a dangling-title-ref issue scoped to the disc, got {issues:?}"
        );
    }

    #[test]
    fn validate_disc_flags_first_play_action_targeting_a_deleted_menu() {
        let mut project = project_with_one_title();
        project.disc.first_play_action = Some(PlaybackAction::ShowMenu {
            menu_id: "stale-menu-id".to_string(),
        });
        let all_title_ids: HashSet<&str> = ["title-1"].into_iter().collect();
        let all_menu_ids: HashSet<&str> = HashSet::new();
        let mut issues = Vec::new();

        validate_disc(&project, &all_title_ids, &all_menu_ids, &mut issues);

        assert!(
            issues
                .iter()
                .any(|i| i.code == "menu.dangling-menu-ref"
                    && i.entity_type.as_deref() == Some("disc")),
            "expected a dangling-menu-ref issue scoped to the disc, got {issues:?}"
        );
    }

    #[test]
    fn validate_disc_accepts_first_play_action_targeting_an_existing_title() {
        let mut project = project_with_one_title();
        project.disc.first_play_action = Some(PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        });
        let all_title_ids: HashSet<&str> = ["title-1"].into_iter().collect();
        let all_menu_ids: HashSet<&str> = HashSet::new();
        let mut issues = Vec::new();

        validate_disc(&project, &all_title_ids, &all_menu_ids, &mut issues);

        assert!(
            !issues.iter().any(|i| i.code.starts_with("menu.dangling")),
            "valid first-play target should not raise a dangling-reference issue, got {issues:?}"
        );
    }
}
