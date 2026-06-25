// Build plan generation for DVD authoring.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashMap;

use crate::models::*;

use super::authoring::generate_dvdauthor_xml;
use super::ffmpeg::{
    build_ffmpeg_text_subtitle_prepare_command, build_ffmpeg_transcode_command,
    build_ffmpeg_transcode_pass1_command,
};
use super::menu::{
    authorable_menus, build_ffmpeg_menu_command, generate_spumux_xml, menu_scene_png_path,
};
use super::types::{BuildJob, BuildPlan, BuildSummary, MenuOverlayButton};

mod helpers;
mod paths;
#[cfg(test)]
mod tests;
mod toolchain;

use helpers::{
    ensure_supported_menu_backend, generate_text_subtitle_spumux_xml,
    strip_unknown_codec_subtitle_mappings,
};
use paths::BuildPaths;
use toolchain::ResolvedToolchain;

pub fn generate_build_plan(
    project: &SpindleProjectFile,
    output_dir: &str,
    skip_sidecar: bool,
) -> crate::Result<BuildPlan> {
    generate_build_plan_with_options(project, output_dir, skip_sidecar, false, false)
}

pub fn generate_build_plan_with_options(
    project: &SpindleProjectFile,
    output_dir: &str,
    skip_sidecar: bool,
    skip_unsupported_streams: bool,
    quantize_overlay_palette: bool,
) -> crate::Result<BuildPlan> {
    let mut owned_project = project.clone();
    if skip_unsupported_streams {
        strip_unknown_codec_subtitle_mappings(&mut owned_project);
    }
    let project = &owned_project;

    let subtitle_font_family = crate::toolchain::resolve_text_subtitle_font();

    let paths = BuildPaths::new(output_dir);
    let tools = ResolvedToolchain::resolve(skip_sidecar);

    let mut jobs = Vec::new();

    jobs.push(BuildJob::PrepareWorkspace {
        reset_directories: paths.reset_directories(),
        directories: paths.workspace_directories(),
    });

    let assets: HashMap<&str, &Asset> = project.assets.iter().map(|a| (a.id.as_str(), a)).collect();
    ensure_supported_menu_backend(project)?;

    // Per-title average video bitrate, computed from the disc-wide capacity
    // budget so the transcode actually respects what the Planner/Overview
    // estimate promised (see liminal-hq/spindle#43).
    let title_bitrates: HashMap<String, f64> = super::estimate_disc_capacity(project)
        .title_bitrates
        .into_iter()
        .map(|alloc| (alloc.title_id, alloc.bits_per_second))
        .collect();

    let all_titles: Vec<(&Titleset, &Title)> = project
        .disc
        .titlesets
        .iter()
        .flat_map(|ts| ts.titles.iter().map(move |t| (ts, t)))
        .collect();

    // Track which asset+config combos have already been transcoded so we can
    // reuse the output file when multiple titles share the same source and
    // identical stream/output settings.
    let mut transcode_cache: HashMap<String, std::path::PathBuf> = HashMap::new();
    let mut transcode_count = 0;

    for (_, title) in &all_titles {
        let source_asset_id = title.source_asset_id.as_deref().ok_or_else(|| {
            crate::Error::Build(format!("Title \"{}\" has no source asset", title.name))
        })?;

        let asset = assets.get(source_asset_id).ok_or_else(|| {
            crate::Error::Build(format!("Asset not found for title \"{}\"", title.name))
        })?;

        // Build a cache key from asset ID + settings that affect the output file.
        // Only include fields that change the ffmpeg output — exclude per-mapping
        // UUIDs, labels, ordering, and default/forced flags which are metadata only.
        let audio_key: Vec<_> = title
            .audio_mappings
            .iter()
            .map(|am| {
                format!(
                    "{}:{:?}:{:?}",
                    am.source_stream_index, am.copy_mode, am.output_target
                )
            })
            .collect();
        let subtitle_key: Vec<_> = title
            .subtitle_mappings
            .iter()
            .map(|sm| format!("{}:{}", sm.source_stream_index, sm.language))
            .collect();
        let cache_key = format!(
            "{}|{:?}|{:?}|{}|{}",
            source_asset_id,
            title.video_mapping,
            title.video_output_profile,
            audio_key.join(","),
            subtitle_key.join(","),
        );

        let text_subtitle_mappings: Vec<_> = title
            .subtitle_mappings
            .iter()
            .enumerate()
            .filter_map(|(stream_index, sm)| {
                asset
                    .subtitle_streams
                    .iter()
                    .any(|stream| {
                        stream.index == sm.source_stream_index
                            && stream.subtitle_type == SubtitleType::Text
                    })
                    .then_some((stream_index, sm))
            })
            .collect();
        let has_text_subtitles = !text_subtitle_mappings.is_empty();
        let title_paths = paths.title_paths(&title.id);

        if !has_text_subtitles {
            if let Some(existing_output) = transcode_cache.get(&cache_key) {
                // Reuse by symlinking to the existing transcode output
                jobs.push(BuildJob::LinkTitle {
                    title_id: title.id.clone(),
                    title_name: title.name.clone(),
                    source_path: existing_output.display().to_string(),
                    link_path: title_paths.authored_video_path.display().to_string(),
                    label: format!("Link \"{}\" (shared transcode)", title.name),
                });
                continue;
            }
        }

        {
            let output_path = if has_text_subtitles {
                title_paths.base_video_path.clone()
            } else {
                title_paths.authored_video_path.clone()
            };

            let video_info = title
                .video_mapping
                .as_ref()
                .and_then(|vm| asset.video_streams.get(vm.source_stream_index as usize));

            let video_bitrate_bps = title_bitrates
                .get(title.id.as_str())
                .copied()
                .unwrap_or(0.0);
            let two_pass = project.build_settings.two_pass_video_encoding;
            let mut command = build_ffmpeg_transcode_command(
                &asset.source_path,
                &output_path,
                title,
                asset,
                &project.disc,
                video_info,
                video_bitrate_bps,
                two_pass,
            );
            command[0] = tools.ffmpeg.clone();

            let pass1_command = if two_pass {
                let mut cmd = build_ffmpeg_transcode_pass1_command(
                    &asset.source_path,
                    &output_path,
                    title,
                    &project.disc,
                    video_info,
                    video_bitrate_bps,
                );
                cmd[0] = tools.ffmpeg.clone();
                Some(cmd)
            } else {
                None
            };

            if !has_text_subtitles {
                transcode_cache.insert(cache_key, output_path.clone());
            }
            transcode_count += 1;

            jobs.push(BuildJob::TranscodeTitle {
                title_id: title.id.clone(),
                title_name: title.name.clone(),
                source_path: asset.source_path.clone(),
                output_path: output_path.display().to_string(),
                pass1_command,
                command,
                label: format!("Transcode \"{}\"", title.name),
                duration_secs: asset.duration_secs,
            });

            if has_text_subtitles {
                let profile = title.video_output_profile.unwrap_or(VideoOutputProfile {
                    raster: VideoRaster::FullD1,
                    aspect: AspectMode::SixteenByNine,
                });
                let mut current_input = output_path;
                let font_family = subtitle_font_family.clone().unwrap_or_else(|| {
                    crate::toolchain::default_text_subtitle_font_family().to_string()
                });

                for (text_job_index, (stream_index, sm)) in
                    text_subtitle_mappings.iter().enumerate()
                {
                    let subtitle_path = paths.subtitle_text_path(&title.id, sm.source_stream_index);
                    let mut prepare_command = build_ffmpeg_text_subtitle_prepare_command(
                        &asset.source_path,
                        &subtitle_path,
                        sm.source_stream_index,
                    );
                    prepare_command[0] = tools.ffmpeg.clone();

                    let output_path = if text_job_index + 1 == text_subtitle_mappings.len() {
                        title_paths.authored_video_path.clone()
                    } else {
                        paths.title_subtitle_stage_path(&title.id, *stream_index)
                    };
                    let xml_path = paths.title_subtitle_xml_path(&title.id, *stream_index);
                    let spumux_xml = generate_text_subtitle_spumux_xml(
                        &subtitle_path,
                        project.disc.standard,
                        profile,
                        &font_family,
                    );

                    jobs.push(BuildJob::RenderTextSubtitles {
                        title_id: title.id.clone(),
                        title_name: title.name.clone(),
                        source_path: asset.source_path.clone(),
                        source_stream_index: sm.source_stream_index,
                        input_path: current_input.display().to_string(),
                        output_path: output_path.display().to_string(),
                        subtitle_path: subtitle_path.display().to_string(),
                        prepare_command,
                        spumux_xml,
                        command: vec![
                            tools.spumux.clone(),
                            "-m".to_string(),
                            "dvd".to_string(),
                            "-s".to_string(),
                            stream_index.to_string(),
                            xml_path.display().to_string(),
                        ],
                        label: format!("Render subtitle \"{}\" for \"{}\"", sm.label, title.name),
                        render_mode: project.build_settings.subtitle_render_mode,
                        font_family: font_family.clone(),
                    });

                    current_input = output_path;
                }
            }
        }
    }

    for menu_ref in authorable_menus(project) {
        let menu_paths = paths.menu_paths(&menu_ref.menu.id);
        let scene_png_path = menu_scene_png_path(&menu_paths.base_video_path);
        let render_command = build_ffmpeg_menu_command(
            &tools.ffmpeg,
            &menu_ref,
            &assets,
            project,
            project.disc.standard,
            &menu_paths.base_video_path,
            &scene_png_path,
        )?;

        let menu_aspect = menu_ref.display_aspect(project);
        let target = RenderTarget::from_disc(&project.disc, menu_aspect);
        let design_size = menu_ref
            .menu
            .authored_document
            .as_ref()
            .map(|doc| &doc.scene.design_size);
        let (scale_x, scale_y) = if let Some(ds) = design_size {
            (
                target.raster_width as f64 / ds.width,
                target.raster_height as f64 / ds.height,
            )
        } else {
            (1.0, 1.0)
        };

        // Serialise the MenuDocument and the image assets it references so the
        // executor can reconstruct them when calling render_menu_scene_to_png.
        let menu_document_json = menu_ref
            .menu
            .authored_document
            .as_ref()
            .and_then(|doc| serde_json::to_string(doc).ok())
            .unwrap_or_default();

        // Collect only the assets referenced by SceneNode::Image nodes.
        let scene_image_asset_ids: Vec<String> = menu_ref
            .scene_nodes()
            .iter()
            .filter_map(|node| {
                if let SceneNode::Image { asset_id, .. } = node {
                    Some(asset_id.clone())
                } else {
                    None
                }
            })
            .collect();
        let mut scene_assets_map: HashMap<String, String> = HashMap::new();
        for asset_id in &scene_image_asset_ids {
            let asset = assets.get(asset_id.as_str()).ok_or_else(|| {
                crate::Error::Build(format!(
                    "Menu \"{}\" references image asset \"{asset_id}\" which no longer exists. \
                     Remove or replace the image node before building.",
                    menu_ref.name()
                ))
            })?;
            scene_assets_map.insert(asset_id.clone(), asset.source_path.clone());
        }
        let scene_assets_json = serde_json::to_string(&scene_assets_map).unwrap_or_default();

        jobs.push(BuildJob::RenderMenu {
            menu_id: menu_ref.menu.id.clone(),
            menu_name: menu_ref.name().to_string(),
            output_path: menu_paths.base_video_path.display().to_string(),
            command: render_command,
            label: format!("Render menu \"{}\"", menu_ref.name()),
            standard: project.disc.standard,
            highlight_image_path: menu_paths.highlight_image_path.display().to_string(),
            select_image_path: menu_paths.select_image_path.display().to_string(),
            highlight_colour: menu_ref.highlight_colours().select_colour.clone(),
            select_colour: menu_ref.highlight_colours().activate_colour.clone(),
            button_bounds: menu_ref
                .scene_nodes()
                .iter()
                .filter_map(|node| {
                    if let SceneNode::Button {
                        x,
                        y,
                        width,
                        height,
                        button_style,
                        ..
                    } = node
                    {
                        let raw_radius = button_style
                            .as_ref()
                            .map(|bs| bs.normal.border_radius as f32)
                            .unwrap_or(0.0);
                        let radius = (raw_radius * scale_x.min(scale_y) as f32).max(0.0);
                        Some(MenuOverlayButton {
                            x0: (x * scale_x).round() as i32,
                            y0: (y * scale_y).round() as i32,
                            x1: ((x + width) * scale_x).round() as i32,
                            y1: ((y + height) * scale_y).round() as i32,
                            border_radius: radius,
                        })
                    } else {
                        None
                    }
                })
                .collect(),
            raster_width: target.raster_width,
            raster_height: target.raster_height,
            scene_png_path: scene_png_path.display().to_string(),
            menu_document_json,
            scene_assets_json,
            quantize_overlay_palette,
        });

        let spumux_xml = generate_spumux_xml(
            &menu_ref,
            project.disc.standard,
            &paths.menus_dir,
            scale_x,
            scale_y,
        );
        jobs.push(BuildJob::ComposeMenuHighlights {
            menu_id: menu_ref.menu.id.clone(),
            menu_name: menu_ref.menu.name.clone(),
            input_path: menu_paths.base_video_path.display().to_string(),
            output_path: menu_paths.authored_video_path.display().to_string(),
            spumux_xml,
            command: vec![
                tools.spumux.clone(),
                "-m".to_string(),
                "dvd".to_string(),
                format!(
                    "{}.xml",
                    menu_paths.authored_video_path.with_extension("").display()
                ),
            ],
            label: format!("Compose menu highlights \"{}\"", menu_ref.menu.name),
        });
    }

    let dvdauthor_xml = generate_dvdauthor_xml(
        project,
        &paths.titles_dir,
        &paths.menus_dir,
        &paths.dvd_root_dir,
    )?;
    let xml_path = paths.dvdauthor_xml_path();

    jobs.push(BuildJob::AuthorDvd {
        xml_path: xml_path.display().to_string(),
        output_path: paths.dvd_root_dir.display().to_string(),
        command: vec![
            tools.dvdauthor,
            "-x".to_string(),
            xml_path.display().to_string(),
        ],
        label: "Author DVD (dvdauthor)".to_string(),
    });

    if project.build_settings.generate_iso {
        let iso_path = paths.iso_image_path(&project.project.name);
        let volume_id = project
            .project
            .name
            .chars()
            .take(32)
            .collect::<String>()
            .to_uppercase();

        jobs.push(BuildJob::CreateIso {
            source_path: paths.dvd_root_dir.display().to_string(),
            output_path: iso_path.display().to_string(),
            command: vec![
                tools.iso_authoring,
                "-dvd-video".to_string(),
                "-V".to_string(),
                volume_id,
                "-o".to_string(),
                iso_path.display().to_string(),
                paths.dvd_root_dir.display().to_string(),
            ],
            label: "Create ISO image".to_string(),
        });
    }

    let estimated_commands: Vec<String> = jobs
        .iter()
        .filter_map(|j| j.command().map(|c| c.join(" ")))
        .collect();

    let all_menus: Vec<&Menu> = project
        .disc
        .global_menus
        .iter()
        .chain(project.disc.titlesets.iter().flat_map(|ts| ts.menus.iter()))
        .collect();

    let summary = BuildSummary {
        total_jobs: jobs.len(),
        transcode_jobs: transcode_count,
        titles_count: all_titles.len(),
        menus_count: all_menus.len(),
        generate_iso: project.build_settings.generate_iso,
        estimated_commands,
    };

    Ok(BuildPlan {
        jobs,
        output_directory: paths.output_dir.display().to_string(),
        working_directory: paths.work_dir.display().to_string(),
        dvdauthor_xml,
        summary,
    })
}
