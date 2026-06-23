// Titleset-level checks: all titles in a titleset must share one output format.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use crate::models::*;

pub(super) fn validate_titleset_formats(
    project: &SpindleProjectFile,
    issues: &mut Vec<ValidationIssue>,
) {
    for titleset in &project.disc.titlesets {
        let profiles: Vec<_> = titleset
            .titles
            .iter()
            .filter_map(|t| t.video_output_profile)
            .collect();
        if profiles.len() >= 2 {
            let first = &profiles[0];
            for profile in &profiles[1..] {
                if profile.raster != first.raster || profile.aspect != first.aspect {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Warning,
                        code: "titleset.format-mismatch".to_string(),
                        message: format!(
                            "Titleset \"{}\" contains titles with different video output profiles. DVD requires all titles in a titleset to share the same resolution and aspect ratio.",
                            titleset.name
                        ),
                        context: Some(titleset.id.clone()),
                        entity_type: Some("titleset".to_string()),
                        entity_name: Some(titleset.name.clone()),
                        suggested_fix: Some("Ensure all titles in this titleset use the same resolution and aspect ratio, or move mismatched titles to a separate titleset.".to_string()),
                    });
                    break;
                }
            }
        }
    }
}
