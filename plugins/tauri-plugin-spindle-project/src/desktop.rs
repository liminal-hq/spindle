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

        // ── Disc-level checks ───────────────────────────────────────────

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
                suggested_fix: Some("Add titles in the Titles page to define the disc's playback structure.".to_string()),
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

        // ── Title checks ────────────────────────────────────────────────

        let asset_ids: std::collections::HashSet<&str> =
            project.assets.iter().map(|a| a.id.as_str()).collect();

        let asset_map: std::collections::HashMap<&str, &Asset> =
            project.assets.iter().map(|a| (a.id.as_str(), a)).collect();

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
                            entity_type: Some("title".to_string()),
                            entity_name: Some(title.name.clone()),
                            suggested_fix: Some("Open the title and assign a source asset from the Assets library.".to_string()),
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
                            entity_type: Some("title".to_string()),
                            entity_name: Some(title.name.clone()),
                            suggested_fix: Some("Re-import the missing asset or assign a different source.".to_string()),
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
                        entity_type: Some("title".to_string()),
                        entity_name: Some(title.name.clone()),
                        suggested_fix: Some("Select a video stream in the title's track mapping section.".to_string()),
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
                        entity_type: Some("title".to_string()),
                        entity_name: Some(title.name.clone()),
                        suggested_fix: Some("Choose a video output profile (resolution and aspect ratio) for this title.".to_string()),
                    });
                }

                // ── Chapter ordering checks ─────────────────────────────
                if title.chapters.len() >= 2 {
                    for window in title.chapters.windows(2) {
                        if window[1].timestamp_secs <= window[0].timestamp_secs {
                            issues.push(ValidationIssue {
                                severity: IssueSeverity::Error,
                                code: "chapter.non-increasing".to_string(),
                                message: format!(
                                    "Chapter \"{}\" in title \"{}\" has a timestamp that is not after the preceding chapter.",
                                    window[1].name, title.name
                                ),
                                context: Some(title.id.clone()),
                                entity_type: Some("title".to_string()),
                                entity_name: Some(title.name.clone()),
                                suggested_fix: Some("Reorder or adjust chapter timestamps so they are strictly increasing.".to_string()),
                            });
                        }
                    }
                }

                // Check chapters are within asset duration
                if let Some(ref asset_id) = title.source_asset_id {
                    if let Some(asset) = asset_map.get(asset_id.as_str()) {
                        if let Some(duration) = asset.duration_secs {
                            for ch in &title.chapters {
                                if ch.timestamp_secs > duration {
                                    issues.push(ValidationIssue {
                                        severity: IssueSeverity::Error,
                                        code: "chapter.beyond-duration".to_string(),
                                        message: format!(
                                            "Chapter \"{}\" in title \"{}\" is at {:.0}s but the asset is only {:.0}s long.",
                                            ch.name, title.name, ch.timestamp_secs, duration
                                        ),
                                        context: Some(title.id.clone()),
                                        entity_type: Some("title".to_string()),
                                        entity_name: Some(title.name.clone()),
                                        suggested_fix: Some("Move this chapter to a timestamp within the asset's duration or remove it.".to_string()),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // ── Menu checks ─────────────────────────────────────────────────

        let all_menus: Vec<&Menu> = project
            .disc
            .global_menus
            .iter()
            .chain(project.disc.titlesets.iter().flat_map(|ts| ts.menus.iter()))
            .collect();

        let all_menu_ids: std::collections::HashSet<&str> =
            all_menus.iter().map(|m| m.id.as_str()).collect();

        let all_title_ids: std::collections::HashSet<&str> = project
            .disc
            .titlesets
            .iter()
            .flat_map(|ts| ts.titles.iter().map(|t| t.id.as_str()))
            .collect();

        for menu in &all_menus {
            // Empty menus
            if menu.buttons.is_empty() {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.no-buttons".to_string(),
                    message: format!("Menu \"{}\" has no buttons.", menu.name),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some("Add at least one button to define user interaction.".to_string()),
                });
                continue;
            }

            // No default button
            if menu.default_button_id.is_none() {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.no-default-button".to_string(),
                    message: format!(
                        "Menu \"{}\" has no default button. The first button will be selected on entry.",
                        menu.name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some("Set a default button so the player knows which button to highlight on entry.".to_string()),
                });
            }

            let button_ids: std::collections::HashSet<&str> =
                menu.buttons.iter().map(|b| b.id.as_str()).collect();

            for button in &menu.buttons {
                // Dead-end detection: button with no action
                if button.action.is_none() {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Warning,
                        code: "menu.button-no-action".to_string(),
                        message: format!(
                            "Button \"{}\" in menu \"{}\" has no action assigned.",
                            button.label, menu.name
                        ),
                        context: Some(menu.id.clone()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu.name.clone()),
                        suggested_fix: Some("Assign an action (play title, show menu, etc.) to this button.".to_string()),
                    });
                }

                // Validate action targets exist
                match &button.action {
                    Some(PlaybackAction::PlayTitle { title_id }) => {
                        if !all_title_ids.contains(title_id.as_str()) {
                            issues.push(ValidationIssue {
                                severity: IssueSeverity::Error,
                                code: "menu.dangling-title-ref".to_string(),
                                message: format!(
                                    "Button \"{}\" in menu \"{}\" references a title that does not exist.",
                                    button.label, menu.name
                                ),
                                context: Some(menu.id.clone()),
                                entity_type: Some("menu".to_string()),
                                entity_name: Some(menu.name.clone()),
                                suggested_fix: Some("Update the button action to point to an existing title or remove it.".to_string()),
                            });
                        }
                    }
                    Some(PlaybackAction::ShowMenu { menu_id }) => {
                        if !all_menu_ids.contains(menu_id.as_str()) {
                            issues.push(ValidationIssue {
                                severity: IssueSeverity::Error,
                                code: "menu.dangling-menu-ref".to_string(),
                                message: format!(
                                    "Button \"{}\" in menu \"{}\" references a menu that does not exist.",
                                    button.label, menu.name
                                ),
                                context: Some(menu.id.clone()),
                                entity_type: Some("menu".to_string()),
                                entity_name: Some(menu.name.clone()),
                                suggested_fix: Some("Update the button action to point to an existing menu or remove it.".to_string()),
                            });
                        }
                    }
                    _ => {}
                }

                // Navigation link validation
                for (dir, nav_id) in [
                    ("up", &button.nav_up),
                    ("down", &button.nav_down),
                    ("left", &button.nav_left),
                    ("right", &button.nav_right),
                ] {
                    if let Some(id) = nav_id {
                        if !button_ids.contains(id.as_str()) {
                            issues.push(ValidationIssue {
                                severity: IssueSeverity::Error,
                                code: "menu.dangling-nav-ref".to_string(),
                                message: format!(
                                    "Button \"{}\" in menu \"{}\" has a {dir} nav link to a button that does not exist.",
                                    button.label, menu.name
                                ),
                                context: Some(menu.id.clone()),
                                entity_type: Some("menu".to_string()),
                                entity_name: Some(menu.name.clone()),
                                suggested_fix: Some("Remove the broken nav link or use auto-generate navigation to rebuild all links.".to_string()),
                            });
                        }
                    }
                }

                // Navigation completeness (buttons should ideally have all nav directions)
                let has_any_nav = button.nav_up.is_some()
                    || button.nav_down.is_some()
                    || button.nav_left.is_some()
                    || button.nav_right.is_some();

                if !has_any_nav && menu.buttons.len() > 1 {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Info,
                        code: "menu.button-no-navigation".to_string(),
                        message: format!(
                            "Button \"{}\" in menu \"{}\" has no directional navigation set. Use auto-generate navigation to fix this.",
                            button.label, menu.name
                        ),
                        context: Some(menu.id.clone()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu.name.clone()),
                        suggested_fix: Some("Use the auto-generate navigation feature to create directional links for all buttons.".to_string()),
                    });
                }
            }
        }

        // ── Titleset format mismatch checks ─────────────────────────────

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

        // ── Build settings checks ───────────────────────────────────────

        if project.build_settings.output_directory.is_none() && total_titles > 0 {
            issues.push(ValidationIssue {
                severity: IssueSeverity::Info,
                code: "build.no-output-dir".to_string(),
                message: "No output directory is set. You will be prompted when building."
                    .to_string(),
                context: None,
                entity_type: Some("build".to_string()),
                entity_name: None,
                suggested_fix: Some("Set an output directory in the build settings to avoid being prompted each time.".to_string()),
            });
        }

        Ok(issues)
    }
}
