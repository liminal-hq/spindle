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

        let mut project: SpindleProjectFile = serde_json::from_value(raw)?;
        project.migrate_all_menus();
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
                            suggested_fix: Some(
                                "Open the title and assign a source asset from the Assets library."
                                    .to_string(),
                            ),
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
                            suggested_fix: Some(
                                "Re-import the missing asset or assign a different source."
                                    .to_string(),
                            ),
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
                        suggested_fix: Some(
                            "Select a video stream in the title's track mapping section."
                                .to_string(),
                        ),
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

                if let Some(PlaybackAction::PlayChapter {
                    title_id,
                    chapter_id,
                }) = &title.end_action
                {
                    if !chapter_target_exists(&project.disc, title_id, chapter_id) {
                        issues.push(dangling_play_chapter_issue(
                            "title.dangling-end-chapter-ref",
                            format!(
                                "End action for title \"{}\" references a chapter target that does not exist.",
                                title.name
                            ),
                            Some(title.id.clone()),
                            "title",
                            Some(title.name.clone()),
                            "Update the end action to point to an existing chapter or choose a different action.",
                        ));
                    }
                }

                // ── Subtitle checks ────────────────────────────────────
                if let Some(ref asset_id) = title.source_asset_id {
                    if let Some(asset) = asset_map.get(asset_id.as_str()) {
                        for sm in &title.subtitle_mappings {
                            // Dangling subtitle stream reference
                            if !asset
                                .subtitle_streams
                                .iter()
                                .any(|s| s.index == sm.source_stream_index)
                            {
                                issues.push(ValidationIssue {
                                    severity: IssueSeverity::Error,
                                    code: "subtitle.dangling-stream".to_string(),
                                    message: format!(
                                        "Subtitle mapping \"{}\" in title \"{}\" references stream index {} which no longer exists on the source asset.",
                                        sm.label, title.name, sm.source_stream_index
                                    ),
                                    context: Some(title.id.clone()),
                                    entity_type: Some("title".to_string()),
                                    entity_name: Some(title.name.clone()),
                                    suggested_fix: Some("The source file may have changed. Remove this subtitle mapping or relink the asset.".to_string()),
                                });
                            }
                        }

                        let mut has_text_subs = false;
                        for sm in &title.subtitle_mappings {
                            if let Some(stream) = asset
                                .subtitle_streams
                                .iter()
                                .find(|s| s.index == sm.source_stream_index)
                            {
                                match stream.subtitle_type {
                                    SubtitleType::Text => has_text_subs = true,
                                    SubtitleType::Bitmap => {}
                                    SubtitleType::Unknown => {}
                                }
                            }
                        }

                        if has_text_subs {
                            issues.push(ValidationIssue {
                                severity: IssueSeverity::Info,
                                code: "subtitle.text-rendering-simplified".to_string(),
                                message: format!(
                                    "Title \"{}\" has text subtitle mappings that will be rendered with first-pass DVD-safe styling.",
                                    title.name
                                ),
                                context: Some(title.id.clone()),
                                entity_type: Some("title".to_string()),
                                entity_name: Some(title.name.clone()),
                                suggested_fix: Some("First-pass subtitle rendering uses a host font and simplified DVD-safe styling. Review the authored disc output if subtitle appearance matters.".to_string()),
                            });

                            if crate::toolchain::resolve_text_subtitle_font().is_none() {
                                issues.push(ValidationIssue {
                                    severity: IssueSeverity::Warning,
                                    code: "subtitle.host-font-unavailable".to_string(),
                                    message: format!(
                                        "Title \"{}\" has text subtitle mappings, but no compatible host sans-serif font could be resolved.",
                                        title.name
                                    ),
                                    context: Some(title.id.clone()),
                                    entity_type: Some("title".to_string()),
                                    entity_name: Some(title.name.clone()),
                                    suggested_fix: Some("Spindle will fall back to a generic sans-serif font hint, but installing a Fontconfig-visible font such as Noto Sans or Liberation Sans gives more predictable subtitle rendering.".to_string()),
                                });
                            }
                        }
                    }
                }
            }
        }

        // ── Menu checks ─────────────────────────────────────────────────

        // Pair each menu with its owning titleset so stream index validation has context.
        // Global menus carry None — we cannot know which titleset they will target.
        let all_menus: Vec<(&Menu, Option<&Titleset>)> = project
            .disc
            .global_menus
            .iter()
            .map(|m| (m, None))
            .chain(project.disc.titlesets.iter().flat_map(|ts| {
                ts.menus.iter().map(move |m| (m, Some(ts)))
            }))
            .collect();

        let all_menu_ids: std::collections::HashSet<&str> =
            all_menus.iter().map(|(m, _)| m.id.as_str()).collect();

        let all_title_ids: std::collections::HashSet<&str> = project
            .disc
            .titlesets
            .iter()
            .flat_map(|ts| ts.titles.iter().map(|t| t.id.as_str()))
            .collect();

        for (menu, titleset_opt) in &all_menus {
            let stream_counts = titleset_opt.map(|ts| titleset_stream_counts(ts));

            // Hard limit: 36 buttons per menu (DVD spec limit for most players/configurations)
            if menu.buttons.len() > 36 {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Error,
                    code: "menu.too-many-buttons".to_string(),
                    message: format!(
                        "Menu \"{}\" has {} buttons, which exceeds the DVD-Video limit of 36.",
                        menu.name,
                        menu.buttons.len()
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Remove some buttons or split the menu into multiple pages.".to_string(),
                    ),
                });
            } else if menu.buttons.len() > 18 {
                // Safe Zone warning (12-18 buttons is the recommended target)
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.button-density-high".to_string(),
                    message: format!(
                        "Menu \"{}\" has {} buttons. High button density may exceed the safe zone for some TV displays.",
                        menu.name,
                        menu.buttons.len()
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Aim for 12-18 buttons per menu for better readability and compatibility.".to_string(),
                    ),
                });
            }

            // Empty menus
            if menu.buttons.is_empty() {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.no-buttons".to_string(),
                    message: format!("Menu \"{}\" has no buttons.", menu.name),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Add at least one button to define user interaction.".to_string(),
                    ),
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
                        suggested_fix: Some(
                            "Assign an action (play title, show menu, etc.) to this button."
                                .to_string(),
                        ),
                    });
                }

                // Validate action targets exist
                if let Some(action) = &button.action {
                    validate_action(
                        action,
                        &all_title_ids,
                        &all_menu_ids,
                        &project.disc,
                        &menu.name,
                        &menu.id,
                        &button.label,
                        stream_counts,
                        &mut issues,
                    );
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

            // ── Authored Document (Scene) Checks ───────────────────────────
            if let Some(doc) = &menu.authored_document {
                // Count buttons in scene nodes (including groups)
                let scene_button_count = count_scene_buttons(&doc.scene.nodes);
                if scene_button_count > 36 {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.scene-too-many-buttons".to_string(),
                        message: format!(
                            "Authored scene for menu \"{}\" has {} buttons, which exceeds the DVD-Video limit of 36.",
                            menu.name, scene_button_count
                        ),
                        context: Some(menu.id.clone()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu.name.clone()),
                        suggested_fix: Some(
                            "Remove some buttons or split the scene into multiple pages.".to_string(),
                        ),
                    });
                }

                // Check background asset
                if let Some(asset_id) = &doc.scene.background.asset_id {
                    if !asset_ids.contains(asset_id.as_str()) {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Error,
                            code: "menu.scene-dangling-background".to_string(),
                            message: format!(
                                "Authored scene for menu \"{}\" references a background asset that no longer exists.",
                                menu.name
                            ),
                            context: Some(menu.id.clone()),
                            entity_type: Some("menu".to_string()),
                            entity_name: Some(menu.name.clone()),
                            suggested_fix: Some(
                                "Re-assign a background asset in the menu editor.".to_string(),
                            ),
                        });
                    }
                }

                // Validate all scene nodes recursively
                validate_scene_nodes(
                    &doc.scene.nodes,
                    &asset_ids,
                    &menu.name,
                    &menu.id,
                    &mut issues,
                );

                // Validate interaction graph actions
                for focus_node in &doc.interaction.nodes {
                    if let Some(action) = &focus_node.action {
                        validate_action(
                            action,
                            &all_title_ids,
                            &all_menu_ids,
                            &project.disc,
                            &menu.name,
                            &menu.id,
                            &format!("Interaction: {}", focus_node.node_id),
                            stream_counts,
                            &mut issues,
                        );
                    }
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

fn chapter_target_exists(disc: &Disc, title_id: &str, chapter_id: &str) -> bool {
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

fn dangling_play_chapter_issue(
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

fn count_scene_buttons(nodes: &[SceneNode]) -> usize {
    let mut count = 0;
    for node in nodes {
        match node {
            SceneNode::Button { .. } => count += 1,
            SceneNode::Group { children, .. } => count += count_scene_buttons(children),
            _ => {}
        }
    }
    count
}

fn validate_scene_nodes(
    nodes: &[SceneNode],
    asset_ids: &std::collections::HashSet<&str>,
    menu_name: &str,
    menu_id: &str,
    issues: &mut Vec<ValidationIssue>,
) {
    for node in nodes {
        match node {
            SceneNode::Image { asset_id, id, .. } => {
                if !asset_ids.contains(asset_id.as_str()) {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.scene-dangling-image".to_string(),
                        message: format!(
                            "Scene node \"{}\" in menu \"{}\" references an image asset that no longer exists.",
                            id, menu_name
                        ),
                        context: Some(menu_id.to_string()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu_name.to_string()),
                        suggested_fix: Some("Update or remove the broken image node.".to_string()),
                    });
                }
            }
            SceneNode::Video { asset_id, id, .. } => {
                if !asset_ids.contains(asset_id.as_str()) {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.scene-dangling-video".to_string(),
                        message: format!(
                            "Scene node \"{}\" in menu \"{}\" references a video asset that no longer exists.",
                            id, menu_name
                        ),
                        context: Some(menu_id.to_string()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu_name.to_string()),
                        suggested_fix: Some("Update or remove the broken video node.".to_string()),
                    });
                }
            }
            SceneNode::Button {
                video_asset_id: Some(asset_id),
                id,
                ..
            } => {
                if !asset_ids.contains(asset_id.as_str()) {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.scene-dangling-button-video".to_string(),
                        message: format!(
                            "Button \"{}\" in menu \"{}\" references a video background asset that no longer exists.",
                            id, menu_name
                        ),
                        context: Some(menu_id.to_string()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu_name.to_string()),
                        suggested_fix: Some(
                            "Update or remove the broken button video asset.".to_string(),
                        ),
                    });
                }
            }
            SceneNode::Group { children, .. } => {
                validate_scene_nodes(children, asset_ids, menu_name, menu_id, issues);
            }
            _ => {}
        }
    }
}

/// Returns `(audio_track_count, subtitle_track_count)` for a titleset.
///
/// Counts are derived from the authored output track mappings on each title.
/// The maximum across all titles is used so that actions targeting the broadest
/// track layout are caught rather than only the first title's layout.
fn titleset_stream_counts(titleset: &Titleset) -> (usize, usize) {
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

#[allow(clippy::too_many_arguments)]
fn validate_action(
    action: &PlaybackAction,
    all_title_ids: &std::collections::HashSet<&str>,
    all_menu_ids: &std::collections::HashSet<&str>,
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
    }
}

#[cfg(test)]
mod tests {
    use crate::models::{
        AudioOutputTarget, AudioTrackMapping, ChapterPoint, CopyMode, Disc, IssueSeverity,
        PlaybackAction, SubtitleTrackMapping, Title, Titleset, VideoStandard,
    };

    use super::{chapter_target_exists, dangling_play_chapter_issue, titleset_stream_counts, validate_action};

    #[test]
    fn chapter_target_exists_requires_matching_title_and_chapter() {
        let disc = Disc {
            standard: VideoStandard::Ntsc,
            titlesets: vec![Titleset {
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
                    chapters: vec![ChapterPoint {
                        id: "ch-2".to_string(),
                        name: "Chapter 2".to_string(),
                        timestamp_secs: 0.0,
                        order_index: 0,
                    }],
                    end_action: None,
                    order_index: 0,
                }],
                menus: vec![],
            }],
            ..Disc::default()
        };

        assert!(chapter_target_exists(&disc, "title-1", "ch-2"));
        assert!(!chapter_target_exists(&disc, "title-1", "missing-chapter"));
        assert!(!chapter_target_exists(&disc, "missing-title", "ch-2"));
    }

    #[test]
    fn dangling_play_chapter_issue_marks_missing_targets_as_errors() {
        let issue = dangling_play_chapter_issue(
            "menu.dangling-chapter-ref",
            "Button \"Play\" in menu \"Main Menu\" references a chapter target that does not exist."
                .to_string(),
            Some("menu-1".to_string()),
            "menu",
            Some("Main Menu".to_string()),
            "Update the button action to point to an existing chapter or remove it.",
        );

        assert!(matches!(issue.severity, IssueSeverity::Error));
        assert_eq!(issue.code, "menu.dangling-chapter-ref");
        assert_eq!(issue.context.as_deref(), Some("menu-1"));
    }

    fn make_audio_mapping(order_index: u32) -> AudioTrackMapping {
        AudioTrackMapping {
            id: format!("audio-{order_index}"),
            source_stream_index: order_index,
            output_target: AudioOutputTarget::Ac3,
            copy_mode: CopyMode::Copy,
            label: format!("Audio {order_index}"),
            language: "eng".to_string(),
            order_index,
            is_default: order_index == 0,
        }
    }

    fn make_subtitle_mapping(order_index: u32) -> SubtitleTrackMapping {
        SubtitleTrackMapping {
            id: format!("sub-{order_index}"),
            source_stream_index: order_index,
            label: format!("Subtitle {order_index}"),
            language: "eng".to_string(),
            order_index,
            is_default: order_index == 0,
            is_forced: false,
        }
    }

    fn make_titleset_with_streams(audio_count: usize, subtitle_count: usize) -> Titleset {
        Titleset {
            id: "ts-1".to_string(),
            name: "Main".to_string(),
            titles: vec![Title {
                id: "title-1".to_string(),
                name: "Feature".to_string(),
                source_asset_id: None,
                video_mapping: None,
                video_output_profile: None,
                audio_mappings: (0..audio_count as u32).map(make_audio_mapping).collect(),
                subtitle_mappings: (0..subtitle_count as u32)
                    .map(make_subtitle_mapping)
                    .collect(),
                chapters: vec![],
                end_action: None,
                order_index: 0,
            }],
            menus: vec![],
        }
    }

    #[test]
    fn titleset_stream_counts_reflects_title_mappings() {
        let ts = make_titleset_with_streams(2, 3);
        assert_eq!(titleset_stream_counts(&ts), (2, 3));
    }

    #[test]
    fn titleset_stream_counts_uses_max_across_titles() {
        let mut ts = make_titleset_with_streams(2, 1);
        // Second title has more subtitle tracks than the first.
        ts.titles.push(Title {
            id: "title-2".to_string(),
            name: "Bonus".to_string(),
            source_asset_id: None,
            video_mapping: None,
            video_output_profile: None,
            audio_mappings: vec![make_audio_mapping(0)],
            subtitle_mappings: vec![make_subtitle_mapping(0), make_subtitle_mapping(1)],
            chapters: vec![],
            end_action: None,
            order_index: 1,
        });
        let (audio, subtitle) = titleset_stream_counts(&ts);
        assert_eq!(audio, 2);
        assert_eq!(subtitle, 2);
    }

    #[test]
    fn titleset_stream_counts_empty_titleset_returns_zero() {
        let ts = Titleset {
            id: "ts-empty".to_string(),
            name: "Empty".to_string(),
            titles: vec![],
            menus: vec![],
        };
        assert_eq!(titleset_stream_counts(&ts), (0, 0));
    }

    fn run_stream_action_validation(
        action: PlaybackAction,
        stream_counts: Option<(usize, usize)>,
    ) -> Vec<crate::models::ValidationIssue> {
        let disc = Disc::default();
        let all_title_ids = std::collections::HashSet::new();
        let all_menu_ids = std::collections::HashSet::new();
        let mut issues = Vec::new();
        validate_action(
            &action,
            &all_title_ids,
            &all_menu_ids,
            &disc,
            "Setup Menu",
            "menu-1",
            "Audio English",
            stream_counts,
            &mut issues,
        );
        issues
    }

    #[test]
    fn set_audio_stream_valid_index_produces_no_issues() {
        let issues = run_stream_action_validation(
            PlaybackAction::SetAudioStream { stream_index: 1 },
            Some((2, 0)),
        );
        assert!(issues.is_empty());
    }

    #[test]
    fn set_audio_stream_out_of_range_is_an_error() {
        let issues = run_stream_action_validation(
            PlaybackAction::SetAudioStream { stream_index: 2 },
            Some((2, 0)),
        );
        assert_eq!(issues.len(), 1);
        assert!(matches!(issues[0].severity, IssueSeverity::Error));
        assert_eq!(issues[0].code, "menu.action.audio-stream-out-of-range");
    }

    #[test]
    fn set_audio_stream_no_tracks_is_an_error() {
        let issues = run_stream_action_validation(
            PlaybackAction::SetAudioStream { stream_index: 0 },
            Some((0, 0)),
        );
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "menu.action.audio-stream-no-tracks");
    }

    #[test]
    fn set_audio_stream_without_titleset_context_skips_validation() {
        // Global menu — no stream_counts available, validation must not fire.
        let issues = run_stream_action_validation(
            PlaybackAction::SetAudioStream { stream_index: 99 },
            None,
        );
        assert!(issues.is_empty());
    }

    #[test]
    fn set_subtitle_stream_valid_index_produces_no_issues() {
        let issues = run_stream_action_validation(
            PlaybackAction::SetSubtitleStream {
                stream_index: Some(0),
            },
            Some((0, 2)),
        );
        assert!(issues.is_empty());
    }

    #[test]
    fn set_subtitle_stream_out_of_range_is_an_error() {
        let issues = run_stream_action_validation(
            PlaybackAction::SetSubtitleStream {
                stream_index: Some(3),
            },
            Some((0, 2)),
        );
        assert_eq!(issues.len(), 1);
        assert!(matches!(issues[0].severity, IssueSeverity::Error));
        assert_eq!(issues[0].code, "menu.action.subtitle-stream-out-of-range");
    }

    #[test]
    fn set_subtitle_stream_no_tracks_is_an_error() {
        let issues = run_stream_action_validation(
            PlaybackAction::SetSubtitleStream {
                stream_index: Some(0),
            },
            Some((0, 0)),
        );
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "menu.action.subtitle-stream-no-tracks");
    }

    #[test]
    fn set_subtitle_stream_disable_is_always_valid() {
        // stream_index: None means "disable subtitles" — valid even with zero subtitle tracks.
        let issues = run_stream_action_validation(
            PlaybackAction::SetSubtitleStream { stream_index: None },
            Some((0, 0)),
        );
        assert!(issues.is_empty());
    }

    #[test]
    fn set_subtitle_stream_without_titleset_context_skips_validation() {
        let issues = run_stream_action_validation(
            PlaybackAction::SetSubtitleStream {
                stream_index: Some(99),
            },
            None,
        );
        assert!(issues.is_empty());
    }
}
