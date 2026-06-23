// Build-settings checks: output directory presence.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use crate::models::*;

pub(super) fn validate_build_settings(
    project: &SpindleProjectFile,
    total_titles: usize,
    issues: &mut Vec<ValidationIssue>,
) {
    if project.build_settings.output_directory.is_none() && total_titles > 0 {
        issues.push(ValidationIssue {
            severity: IssueSeverity::Info,
            code: "build.no-output-dir".to_string(),
            message: "No output directory is set. You will be prompted when building.".to_string(),
            context: None,
            entity_type: Some("build".to_string()),
            entity_name: None,
            suggested_fix: Some(
                "Set an output directory in the build settings to avoid being prompted each time."
                    .to_string(),
            ),
        });
    }
}
