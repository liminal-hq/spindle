// Per-section authored display-aspect consistency checks, and titleset stream counts
// used by menu-action stream-index validation.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use crate::models::*;

pub(super) fn validate_menu_aspect_sections(
    project: &SpindleProjectFile,
    issues: &mut Vec<ValidationIssue>,
) {
    validate_menu_aspect_section(
        project.disc.global_menus.iter(),
        project.inferred_vmgm_menu_aspect(),
        "disc-global menus",
        None,
        issues,
    );

    for (titleset_index, titleset) in project.disc.titlesets.iter().enumerate() {
        let titleset_profile_aspect = titleset
            .titles
            .iter()
            .find_map(|title| title.video_output_profile.map(|profile| profile.aspect));
        validate_menu_aspect_section(
            titleset.menus.iter(),
            project.inferred_titleset_menu_aspect(titleset_index),
            &format!("titleset \"{}\" menus", titleset.name),
            titleset_profile_aspect.map(|aspect| (&titleset.id[..], &titleset.name[..], aspect)),
            issues,
        );
    }
}

pub(super) fn validate_menu_aspect_section<'a>(
    menus: impl Iterator<Item = &'a Menu>,
    fallback_aspect: AspectMode,
    scope_name: &str,
    titleset_context: Option<(&str, &str, AspectMode)>,
    issues: &mut Vec<ValidationIssue>,
) {
    let mut authored_aspect = None;
    for menu in menus {
        let resolved_aspect = menu.resolved_display_aspect(fallback_aspect);
        if let Some(section_aspect) = authored_aspect {
            if resolved_aspect != section_aspect {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    code: "menu.section-aspect-mismatch".to_string(),
                    message: format!(
                        "Menus in {} do not agree on one authored display aspect. DVD authoring currently needs one menu aspect per section.",
                        scope_name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Align the authored menu aspects inside this section, or move the mismatched menu into a different DVD section."
                            .to_string(),
                    ),
                });
                break;
            }
        } else {
            authored_aspect = Some(resolved_aspect);
        }

        if let Some((titleset_id, titleset_name, profile_aspect)) = titleset_context {
            if resolved_aspect != profile_aspect {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.titleset-aspect-mismatch".to_string(),
                    message: format!(
                        "Menu \"{}\" is authored for {}, but titleset \"{}\" currently resolves to {} from its title profiles.",
                        menu.name,
                        aspect_label(resolved_aspect),
                        titleset_name,
                        aspect_label(profile_aspect),
                    ),
                    context: Some(titleset_id.to_string()),
                    entity_type: Some("titleset".to_string()),
                    entity_name: Some(titleset_name.to_string()),
                    suggested_fix: Some(
                        "Keep the authored menu aspect only if the titleset genuinely needs a different display shape; otherwise align it with the titleset titles."
                            .to_string(),
                    ),
                });
            }
        }
    }
}

fn aspect_label(aspect: AspectMode) -> &'static str {
    match aspect {
        AspectMode::FourByThree => "4:3",
        AspectMode::SixteenByNine => "16:9 anamorphic",
    }
}

/// Returns `(audio_track_count, subtitle_track_count)` for a titleset.
///
/// Counts are derived from the authored output track mappings on each title.
/// The maximum across all titles is used so that actions targeting the broadest
/// track layout are caught rather than only the first title's layout.
pub(super) fn titleset_stream_counts(titleset: &Titleset) -> (usize, usize) {
    let max_audio = titleset
        .titles
        .iter()
        .map(|t| t.audio_mappings.len())
        .max()
        .unwrap_or(0);
    let max_subtitle = titleset
        .titles
        .iter()
        .map(|t| t.subtitle_mappings.len())
        .max()
        .unwrap_or(0);
    (max_audio, max_subtitle)
}
