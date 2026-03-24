// Desktop implementation of the Spindle project plugin.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<SpindleProject<R>> {
    Ok(SpindleProject(app.clone()))
}

/// Desktop-side project operations.
pub struct SpindleProject<R: Runtime>(AppHandle<R>);

impl<R: Runtime> SpindleProject<R> {
    /// Create a new project with the given settings.
    pub fn create_project(&self, req: CreateProjectRequest) -> crate::Result<SpindleProjectFile> {
        let mut project = SpindleProjectFile::default();
        project.project.name = req.name;
        project.disc.standard = req.standard;
        project.disc.capacity_target = req.capacity_target;
        Ok(project)
    }

    /// Parse a project file from JSON, handling schema migration if needed.
    pub fn parse_project(&self, json: &str) -> crate::Result<SpindleProjectFile> {
        // First check the schema version before full deserialisation
        let raw: serde_json::Value = serde_json::from_str(json)?;
        if let Some(version) = raw.get("schemaVersion").and_then(|v| v.as_u64()) {
            let version = version as u32;
            if version > SCHEMA_VERSION {
                return Err(crate::Error::SchemaVersionTooNew {
                    found: version,
                    supported: SCHEMA_VERSION,
                });
            }
            // Future: run migrations for older versions here
        }

        let project: SpindleProjectFile = serde_json::from_value(raw)?;
        Ok(project)
    }

    /// Serialise a project to pretty-printed JSON.
    pub fn serialise_project(&self, project: &SpindleProjectFile) -> crate::Result<String> {
        let json = serde_json::to_string_pretty(project)?;
        Ok(json)
    }

    /// Validate a project and return all issues found.
    pub fn validate_project(
        &self,
        project: &SpindleProjectFile,
    ) -> crate::Result<Vec<ValidationIssue>> {
        let mut issues = Vec::new();

        // Check for at least one titleset
        if project.disc.titlesets.is_empty() {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Error,
                code: "disc.no-titlesets".to_string(),
                message: "Disc must contain at least one titleset.".to_string(),
                context: None,
            });
        }

        // Check for titles
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
            });
        }

        // Collect asset IDs for reference checking
        let asset_ids: std::collections::HashSet<&str> =
            project.assets.iter().map(|a| a.id.as_str()).collect();

        // Check each title has a valid source asset
        for titleset in &project.disc.titlesets {
            for title in &titleset.titles {
                match &title.source_asset_id {
                    None => {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Error,
                            code: "title.no-source".to_string(),
                            message: format!(
                                "Title \"{}\" has no source asset assigned.",
                                title.name
                            ),
                            context: Some(title.id.clone()),
                        });
                    }
                    Some(asset_id) if !asset_ids.contains(asset_id.as_str()) => {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Error,
                            code: "title.dangling-source".to_string(),
                            message: format!(
                                "Title \"{}\" references a source asset that no longer exists.",
                                title.name
                            ),
                            context: Some(title.id.clone()),
                        });
                    }
                    _ => {}
                }

                if title.video_mapping.is_none() {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "title.no-video-mapping".to_string(),
                        message: format!("Title \"{}\" has no video stream selected.", title.name),
                        context: Some(title.id.clone()),
                    });
                }

                if title.video_output_profile.is_none() {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "title.no-output-profile".to_string(),
                        message: format!(
                            "Title \"{}\" has no video output profile selected.",
                            title.name
                        ),
                        context: Some(title.id.clone()),
                    });
                }
            }
        }

        // Check for first-play action
        if project.disc.first_play_action.is_none() && total_titles > 0 {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Info,
                code: "disc.no-first-play".to_string(),
                message: "No first-play action is set. Consider setting a menu or title as the entry point.".to_string(),
                context: None,
            });
        }

        Ok(issues)
    }
}
