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

                // Floor/ceiling are ignored by the allocator once a title is
                // pinned, so a stale floor>ceiling left over from before
                // pinning shouldn't block the build over fields that no
                // longer affect anything.
                if title.pinned_bitrate_bps.is_none() {
                    if let (Some(floor), Some(ceiling)) =
                        (title.bitrate_floor_bps, title.bitrate_ceiling_bps)
                    {
                        if floor > ceiling {
                            issues.push(ValidationIssue {
                            severity: IssueSeverity::Error,
                            code: "title.bitrate-floor-above-ceiling".to_string(),
                            message: format!(
                                "Title \"{}\" has a bitrate floor ({floor} bps) above its ceiling ({ceiling} bps).",
                                title.name
                            ),
                            context: Some(title.id.clone()),
                            entity_type: Some("title".to_string()),
                            entity_name: Some(title.name.clone()),
                            suggested_fix: Some(
                                "Lower the bitrate floor or raise the ceiling so the floor no longer exceeds it."
                                    .to_string(),
                            ),
                            });
                        }
                    }
                }

                // ── Audio channel-layout checks ─────────────────────────
                let source_asset = title
                    .source_asset_id
                    .as_deref()
                    .and_then(|id| asset_map.get(id));
                for mapping in &title.audio_mappings {
                    if mapping.copy_mode != CopyMode::ReEncode {
                        continue;
                    }
                    if mapping.channel_layout == Some(0) {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Error,
                            code: "title.audio-zero-channel-layout".to_string(),
                            message: format!(
                                "Title \"{}\" has an audio track re-encoded to 0 channels, which ffmpeg cannot produce.",
                                title.name
                            ),
                            context: Some(title.id.clone()),
                            entity_type: Some("title".to_string()),
                            entity_name: Some(title.name.clone()),
                            suggested_fix: Some(
                                "Choose a real channel layout (mono, stereo, 5.1, 7.1) or leave it set to auto."
                                    .to_string(),
                            ),
                        });
                    }
                    if mapping.output_target != AudioOutputTarget::Lpcm {
                        continue;
                    }
                    let source_channels = source_asset
                        .and_then(|a| {
                            a.audio_streams
                                .iter()
                                .find(|s| s.index == mapping.source_stream_index)
                        })
                        .map(|s| s.channels)
                        .unwrap_or(2);
                    let channels = mapping.channel_layout.unwrap_or(source_channels);
                    if channels >= 6 {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Warning,
                            code: "title.lpcm-high-channel-count".to_string(),
                            message: format!(
                                "Title \"{}\" has an LPCM audio track at {channels} channels, which is much more expensive than a compressed surround codec at the same channel count and can burn a large share of the disc's mux budget.",
                                title.name
                            ),
                            context: Some(title.id.clone()),
                            entity_type: Some("title".to_string()),
                            entity_name: Some(title.name.clone()),
                            suggested_fix: Some(
                                "Consider AC3 or DTS for this track, or select a lower channel layout."
                                    .to_string(),
                            ),
                        });
                    }
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
            .chain(
                project
                    .disc
                    .titlesets
                    .iter()
                    .flat_map(|ts| ts.menus.iter().map(move |m| (m, Some(ts)))),
            )
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
            let stream_counts = titleset_opt.map(titleset_stream_counts);
            let background_mode = menu.resolved_background_mode();
            let motion_duration_secs = menu.resolved_motion_duration_secs();
            let motion_loop_start_secs = menu.resolved_motion_loop_start_secs();
            let background_asset_id = menu.resolved_background_asset_id();
            let motion_audio_asset_id = menu.resolved_motion_audio_asset_id();

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

                // Validate action targets exist. Skipped when this menu has
                // an authored document: `buttons[]` is then just a best-effort
                // mirror of `authored_document.interaction.nodes[]` (kept in
                // sync by the frontend, not guaranteed authoritative), and
                // that authored-document action is validated below — checking
                // both would report the same dangling/invalid target twice.
                if menu.authored_document.is_none() {
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

            if matches!(background_mode, BackgroundMode::Motion) {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.motion-build-pending".to_string(),
                    message: format!(
                        "Menu \"{}\" is authored as a motion menu, but the backend still blocks motion-menu builds until video-loop authoring is implemented.",
                        menu.name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Keep authoring the motion timing and assets, but switch this menu back to still mode before building for now.".to_string(),
                    ),
                });

                if background_asset_id.is_none() {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.motion-missing-background".to_string(),
                        message: format!(
                            "Motion menu \"{}\" has no background video asset assigned.",
                            menu.name
                        ),
                        context: Some(menu.id.clone()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu.name.clone()),
                        suggested_fix: Some(
                            "Assign a video-backed background asset before enabling motion mode."
                                .to_string(),
                        ),
                    });
                } else if let Some(asset_id) = background_asset_id {
                    if let Some(asset) = asset_map.get(asset_id) {
                        if asset.video_streams.is_empty() {
                            issues.push(ValidationIssue {
                                severity: IssueSeverity::Error,
                                code: "menu.motion-background-no-video-stream".to_string(),
                                message: format!(
                                    "Motion menu \"{}\" uses a background asset that has no video stream.",
                                    menu.name
                                ),
                                context: Some(menu.id.clone()),
                                entity_type: Some("menu".to_string()),
                                entity_name: Some(menu.name.clone()),
                                suggested_fix: Some(
                                    "Choose a source asset with a video stream for the motion background."
                                        .to_string(),
                                ),
                            });
                        } else if motion_audio_asset_id.is_none() && asset.audio_streams.is_empty()
                        {
                            issues.push(ValidationIssue {
                                severity: IssueSeverity::Warning,
                                code: "menu.motion-no-audio-bed".to_string(),
                                message: format!(
                                    "Motion menu \"{}\" has no authored audio bed, and its background video asset does not carry audio either.",
                                    menu.name
                                ),
                                context: Some(menu.id.clone()),
                                entity_type: Some("menu".to_string()),
                                entity_name: Some(menu.name.clone()),
                                suggested_fix: Some(
                                    "Assign a separate motion audio asset or choose a background video with usable audio."
                                        .to_string(),
                                ),
                            });
                        }
                    }
                }

                if !motion_duration_secs.is_some_and(|secs| secs > 0.0) {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.motion-invalid-duration".to_string(),
                        message: format!(
                            "Motion menu \"{}\" needs a loop duration greater than 0 seconds.",
                            menu.name
                        ),
                        context: Some(menu.id.clone()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu.name.clone()),
                        suggested_fix: Some(
                            "Set an explicit motion loop duration in the menu inspector."
                                .to_string(),
                        ),
                    });
                }

                if motion_loop_start_secs.is_some_and(|secs| secs <= 0.0) {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Warning,
                        code: "menu.motion-loop-start-default".to_string(),
                        message: format!(
                            "Motion menu \"{}\" still uses a loop start time of 0.0 seconds, which causes a visible restart cut on each loop.",
                            menu.name
                        ),
                        context: Some(menu.id.clone()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu.name.clone()),
                        suggested_fix: Some(
                            "Set a loop start time after the intro segment so the loop can re-enter cleanly."
                                .to_string(),
                        ),
                    });
                }

                if let Some(audio_asset_id) = motion_audio_asset_id {
                    if !asset_ids.contains(audio_asset_id) {
                        issues.push(ValidationIssue {
                            severity: IssueSeverity::Error,
                            code: "menu.motion-audio-dangling".to_string(),
                            message: format!(
                                "Motion menu \"{}\" references an audio asset that no longer exists.",
                                menu.name
                            ),
                            context: Some(menu.id.clone()),
                            entity_type: Some("menu".to_string()),
                            entity_name: Some(menu.name.clone()),
                            suggested_fix: Some(
                                "Choose another audio asset or clear the motion audio assignment."
                                    .to_string(),
                            ),
                        });
                    } else if let Some(asset) = asset_map.get(audio_asset_id) {
                        if asset.audio_streams.is_empty() {
                            issues.push(ValidationIssue {
                                severity: IssueSeverity::Error,
                                code: "menu.motion-audio-no-stream".to_string(),
                                message: format!(
                                    "Motion menu \"{}\" uses an audio asset that has no audio stream.",
                                    menu.name
                                ),
                                context: Some(menu.id.clone()),
                                entity_type: Some("menu".to_string()),
                                entity_name: Some(menu.name.clone()),
                                suggested_fix: Some(
                                    "Pick an asset with at least one audio stream for the motion bed."
                                        .to_string(),
                                ),
                            });
                        }
                    }
                }
            }

            validate_button_video_usage(menu, background_mode, &asset_map, &mut issues);

            if let Some(doc) = &menu.authored_document {
                validate_motion_keyframes(doc, menu, motion_duration_secs, &mut issues);
            }
        }

        validate_menu_aspect_sections(project, &mut issues);

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

fn validate_button_video_usage(
    menu: &Menu,
    background_mode: BackgroundMode,
    asset_map: &std::collections::HashMap<&str, &Asset>,
    issues: &mut Vec<ValidationIssue>,
) {
    for button in &menu.buttons {
        if let Some(asset_id) = button.video_asset_id.as_deref() {
            if matches!(background_mode, BackgroundMode::Still) {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.button-video-ignored-on-still-menu".to_string(),
                    message: format!(
                        "Button \"{}\" in menu \"{}\" has a video asset, but button video is ignored while the menu is authored as still.",
                        button.label, menu.name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Switch the menu to motion mode or clear the button video assignment."
                            .to_string(),
                    ),
                });
            }

            if let Some(asset) = asset_map.get(asset_id) {
                if asset.video_streams.is_empty() {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.button-video-no-stream".to_string(),
                        message: format!(
                            "Button \"{}\" in menu \"{}\" uses a video asset that has no video stream.",
                            button.label, menu.name
                        ),
                        context: Some(menu.id.clone()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu.name.clone()),
                        suggested_fix: Some(
                            "Choose an asset with a video stream for the button video."
                                .to_string(),
                        ),
                    });
                }
            }
        }
    }
}

fn validate_motion_keyframes(
    doc: &MenuDocument,
    menu: &Menu,
    motion_duration_secs: Option<f64>,
    issues: &mut Vec<ValidationIssue>,
) {
    if !matches!(doc.background_mode, BackgroundMode::Motion) {
        return;
    }

    let Some(loop_duration_secs) = motion_duration_secs else {
        return;
    };

    for node in &doc.scene.nodes {
        validate_motion_keyframes_in_node(node, menu, loop_duration_secs, issues);
    }
}

fn validate_motion_keyframes_in_node(
    node: &SceneNode,
    menu: &Menu,
    loop_duration_secs: f64,
    issues: &mut Vec<ValidationIssue>,
) {
    match node {
        SceneNode::Button {
            id: _,
            label,
            highlight_mode: HighlightMode::Animated,
            highlight_keyframes,
            ..
        } => {
            let mut previous_timestamp = None;
            for keyframe in highlight_keyframes {
                if !(0.0..=loop_duration_secs).contains(&keyframe.timestamp_secs) {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.motion-keyframe-out-of-range".to_string(),
                        message: format!(
                            "Animated highlight keyframe for button \"{}\" in menu \"{}\" falls outside the motion loop ({} s).",
                            label, menu.name, loop_duration_secs
                        ),
                        context: Some(menu.id.clone()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu.name.clone()),
                        suggested_fix: Some(
                            "Move the keyframe inside the authored motion loop duration."
                                .to_string(),
                        ),
                    });
                }

                if previous_timestamp.is_some_and(|previous| keyframe.timestamp_secs < previous) {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "menu.motion-keyframes-out-of-order".to_string(),
                        message: format!(
                            "Animated highlight keyframes for button \"{}\" in menu \"{}\" are not in chronological order.",
                            label, menu.name
                        ),
                        context: Some(menu.id.clone()),
                        entity_type: Some("menu".to_string()),
                        entity_name: Some(menu.name.clone()),
                        suggested_fix: Some(
                            "Sort the keyframes by timestamp so the motion loop can be interpreted deterministically."
                                .to_string(),
                        ),
                    });
                    break;
                }

                previous_timestamp = Some(keyframe.timestamp_secs);
            }

            if highlight_keyframes.is_empty() {
                issues.push(ValidationIssue {
                    severity: IssueSeverity::Warning,
                    code: "menu.motion-animated-button-no-keyframes".to_string(),
                    message: format!(
                        "Button \"{}\" in menu \"{}\" is marked animated, but it has no highlight keyframes yet.",
                        label, menu.name
                    ),
                    context: Some(menu.id.clone()),
                    entity_type: Some("menu".to_string()),
                    entity_name: Some(menu.name.clone()),
                    suggested_fix: Some(
                        "Add at least one highlight keyframe or switch the button back to static highlights."
                            .to_string(),
                    ),
                });
            }
        }
        SceneNode::Group { children, .. } => {
            for child in children {
                validate_motion_keyframes_in_node(child, menu, loop_duration_secs, issues);
            }
        }
        _ => {}
    }
}

fn validate_menu_aspect_sections(project: &SpindleProjectFile, issues: &mut Vec<ValidationIssue>) {
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

fn validate_menu_aspect_section<'a>(
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
        // Virtual actions expanded at authoring time; no cross-reference validation needed.
        PlaybackAction::PlayNextInTitleset | PlaybackAction::PlayAllInTitleset => {}
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::models::{
        AspectMode, Asset, AudioOutputTarget, AudioTrackMapping, BackgroundMode, ButtonBounds,
        ChapterPoint, CompatibilityAssessment, CopyMode, Disc, HighlightKeyframe, HighlightMode,
        IssueSeverity, Menu, MenuButton, MenuCompilePolicy, MenuDocument, MenuDomain,
        MenuHighlightColours, MenuInteractionGraph, MenuScene, MenuSize, MenuTiming,
        PlaybackAction, SceneBackground, SceneNode, SubtitleTrackMapping, Title, Titleset,
        VideoStandard,
    };

    use super::{
        chapter_target_exists, dangling_play_chapter_issue, titleset_stream_counts,
        validate_action, validate_button_video_usage, validate_menu_aspect_section,
        validate_motion_keyframes,
    };

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
                    bitrate_weight: 1.0,
                    bitrate_floor_bps: None,
                    bitrate_ceiling_bps: None,
                    pinned_bitrate_bps: None,
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
            channel_layout: None,
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
                bitrate_weight: 1.0,
                bitrate_floor_bps: None,
                bitrate_ceiling_bps: None,
                pinned_bitrate_bps: None,
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
            bitrate_weight: 1.0,
            bitrate_floor_bps: None,
            bitrate_ceiling_bps: None,
            pinned_bitrate_bps: None,
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
        let issues =
            run_stream_action_validation(PlaybackAction::SetAudioStream { stream_index: 99 }, None);
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

    #[test]
    fn validate_menu_aspect_section_reports_mixed_authored_aspects() {
        let menu_a = Menu {
            id: "menu-a".to_string(),
            name: "Menu A".to_string(),
            authored_document: Some(MenuDocument {
                id: "menu-a".to_string(),
                name: "Menu A".to_string(),
                domain: MenuDomain::Vmgm,
                scene: MenuScene {
                    design_size: MenuSize {
                        width: 720.0,
                        height: 480.0,
                        aspect: AspectMode::FourByThree,
                    },
                    background: SceneBackground {
                        asset_id: None,
                        colour: None,
                    },
                    nodes: vec![],
                    guides: vec![],
                },
                interaction: MenuInteractionGraph {
                    default_focus_id: None,
                    nodes: vec![],
                    timeout_action: None,
                },
                timing: MenuTiming::default(),
                highlight_colours: MenuHighlightColours::default(),
                background_mode: BackgroundMode::Still,
                theme_ref: None,
                generation_meta: None,
                compile_policy: MenuCompilePolicy {
                    display_aspect: Some(AspectMode::FourByThree),
                    ..MenuCompilePolicy::default()
                },
            }),
            ..Menu::default()
        };
        let menu_b = Menu {
            id: "menu-b".to_string(),
            name: "Menu B".to_string(),
            authored_document: Some(MenuDocument {
                id: "menu-b".to_string(),
                name: "Menu B".to_string(),
                domain: MenuDomain::Vmgm,
                scene: MenuScene {
                    design_size: MenuSize {
                        width: 720.0,
                        height: 480.0,
                        aspect: AspectMode::SixteenByNine,
                    },
                    background: SceneBackground {
                        asset_id: None,
                        colour: None,
                    },
                    nodes: vec![],
                    guides: vec![],
                },
                interaction: MenuInteractionGraph {
                    default_focus_id: None,
                    nodes: vec![],
                    timeout_action: None,
                },
                timing: MenuTiming::default(),
                highlight_colours: MenuHighlightColours::default(),
                background_mode: BackgroundMode::Still,
                theme_ref: None,
                generation_meta: None,
                compile_policy: MenuCompilePolicy {
                    display_aspect: Some(AspectMode::SixteenByNine),
                    ..MenuCompilePolicy::default()
                },
            }),
            ..Menu::default()
        };

        let mut issues = Vec::new();
        validate_menu_aspect_section(
            [&menu_a, &menu_b].into_iter(),
            AspectMode::SixteenByNine,
            "disc-global menus",
            None,
            &mut issues,
        );

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "menu.section-aspect-mismatch");
    }

    #[test]
    fn validate_motion_keyframes_flags_out_of_range_entries() {
        let menu = Menu {
            id: "menu-1".to_string(),
            name: "Motion Menu".to_string(),
            authored_document: Some(MenuDocument {
                id: "menu-1".to_string(),
                name: "Motion Menu".to_string(),
                domain: MenuDomain::Vmgm,
                scene: MenuScene {
                    design_size: MenuSize {
                        width: 720.0,
                        height: 480.0,
                        aspect: AspectMode::SixteenByNine,
                    },
                    background: SceneBackground {
                        asset_id: Some("asset-1".to_string()),
                        colour: None,
                    },
                    nodes: vec![SceneNode::Button {
                        id: "btn-1".to_string(),
                        label: "Play".to_string(),
                        x: 0.0,
                        y: 0.0,
                        width: 100.0,
                        height: 40.0,
                        highlight_mode: HighlightMode::Animated,
                        highlight_keyframes: vec![HighlightKeyframe {
                            timestamp_secs: 9.0,
                            select_colour: None,
                            select_opacity: None,
                            activate_colour: None,
                            activate_opacity: None,
                        }],
                        video_asset_id: None,
                        button_style: None,
                        label_style: None,
                    }],
                    guides: vec![],
                },
                interaction: MenuInteractionGraph {
                    default_focus_id: None,
                    nodes: vec![],
                    timeout_action: None,
                },
                timing: MenuTiming {
                    intro_start_secs: 0.0,
                    intro_duration_secs: 0.0,
                    loop_start_secs: 2.0,
                    loop_duration_secs: 5.0,
                    loop_count: 0,
                },
                highlight_colours: MenuHighlightColours::default(),
                background_mode: BackgroundMode::Motion,
                theme_ref: None,
                generation_meta: None,
                compile_policy: MenuCompilePolicy::default(),
            }),
            ..Menu::default()
        };

        let mut issues = Vec::new();
        validate_motion_keyframes(
            menu.authored_document.as_ref().expect("authored doc"),
            &menu,
            Some(5.0),
            &mut issues,
        );

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].code, "menu.motion-keyframe-out-of-range");
    }

    #[test]
    fn validate_button_video_usage_warns_for_still_menus() {
        let menu = Menu {
            id: "menu-1".to_string(),
            name: "Still Menu".to_string(),
            buttons: vec![MenuButton {
                id: "btn-1".to_string(),
                label: "Play".to_string(),
                bounds: ButtonBounds {
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 40.0,
                },
                action: None,
                nav_up: None,
                nav_down: None,
                nav_left: None,
                nav_right: None,
                highlight_mode: HighlightMode::Static,
                highlight_keyframes: vec![],
                video_asset_id: Some("asset-1".to_string()),
            }],
            ..Menu::default()
        };
        let asset = Asset {
            id: "asset-1".to_string(),
            file_name: "clip.mp4".to_string(),
            source_path: "/tmp/clip.mp4".to_string(),
            file_size_bytes: None,
            duration_secs: None,
            container_format: None,
            video_streams: vec![],
            audio_streams: vec![],
            subtitle_streams: vec![],
            compatibility: Some(CompatibilityAssessment::ReEncodeRequired),
            compatibility_detail: None,
            fingerprint: None,
            warnings: vec![],
            thumbnail_path: None,
            thumbnail_error: None,
            source_chapters: vec![],
            format_title: None,
        };

        let asset_map: HashMap<&str, &Asset> = HashMap::from([("asset-1", &asset)]);
        let mut issues = Vec::new();
        validate_button_video_usage(&menu, BackgroundMode::Still, &asset_map, &mut issues);

        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].code, "menu.button-video-ignored-on-still-menu");
        assert_eq!(issues[1].code, "menu.button-video-no-stream");
    }
}
