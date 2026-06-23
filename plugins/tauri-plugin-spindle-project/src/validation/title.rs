// Per-title checks: source asset, video mapping/output profile, bitrate floor/ceiling,
// audio channel layout, chapter ordering/duration, end-action targets, and subtitles.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::{HashMap, HashSet};

use crate::models::*;

use super::chapter::{chapter_target_exists, dangling_play_chapter_issue};

pub(super) fn validate_titles(
    project: &SpindleProjectFile,
    asset_ids: &HashSet<&str>,
    asset_map: &HashMap<&str, &Asset>,
    issues: &mut Vec<ValidationIssue>,
) {
    for titleset in &project.disc.titlesets {
        for title in &titleset.titles {
            match &title.source_asset_id {
                None => {
                    issues.push(ValidationIssue {
                        severity: IssueSeverity::Error,
                        code: "title.no-source".to_string(),
                        message: format!("Title \"{}\" has no source asset assigned.", title.name),
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
                            "Re-import the missing asset or assign a different source.".to_string(),
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
                        "Select a video stream in the title's track mapping section.".to_string(),
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
}
