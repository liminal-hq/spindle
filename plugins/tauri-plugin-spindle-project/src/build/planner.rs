// Build plan generation for DVD authoring.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashMap;
use std::path::PathBuf;

use crate::models::*;

use super::authoring::generate_dvdauthor_xml;
use super::ffmpeg::{build_ffmpeg_text_subtitle_prepare_command, build_ffmpeg_transcode_command};
use super::menu::{
    authorable_menus, build_ffmpeg_menu_command, generate_spumux_xml, menu_scene_png_path,
};
use super::types::{BuildJob, BuildPlan, BuildSummary, MenuOverlayButton};
use super::util::{sanitise_filename, xml_escape};

struct BuildPaths {
    output_dir: PathBuf,
    work_dir: PathBuf,
    dvd_root_dir: PathBuf,
    titles_dir: PathBuf,
    subtitles_dir: PathBuf,
    menus_dir: PathBuf,
    video_ts_dir: PathBuf,
}

struct MenuPaths {
    base_video_path: PathBuf,
    authored_video_path: PathBuf,
    highlight_image_path: PathBuf,
    select_image_path: PathBuf,
}

struct TitlePaths {
    base_video_path: PathBuf,
    authored_video_path: PathBuf,
}

impl BuildPaths {
    fn new(output_dir: &str) -> Self {
        let output_dir = PathBuf::from(output_dir);
        let work_dir = output_dir.join("_spindle_work");
        let dvd_root_dir = output_dir.join("DVD_DISC");
        let titles_dir = work_dir.join("titles");
        let subtitles_dir = work_dir.join("subtitles");
        let menus_dir = work_dir.join("menus");
        let video_ts_dir = dvd_root_dir.join("VIDEO_TS");

        Self {
            output_dir,
            work_dir,
            dvd_root_dir,
            titles_dir,
            subtitles_dir,
            menus_dir,
            video_ts_dir,
        }
    }

    fn workspace_directories(&self) -> Vec<String> {
        vec![
            self.work_dir.display().to_string(),
            self.titles_dir.display().to_string(),
            self.subtitles_dir.display().to_string(),
            self.menus_dir.display().to_string(),
            self.dvd_root_dir.display().to_string(),
            self.video_ts_dir.display().to_string(),
        ]
    }

    fn reset_directories(&self) -> Vec<String> {
        vec![
            self.work_dir.display().to_string(),
            self.dvd_root_dir.display().to_string(),
        ]
    }

    fn title_paths(&self, title_id: &str) -> TitlePaths {
        let base_name = sanitise_filename(title_id);
        TitlePaths {
            base_video_path: self.titles_dir.join(format!("{base_name}_base.mpg")),
            authored_video_path: self.titles_dir.join(format!("{base_name}.mpg")),
        }
    }

    fn subtitle_text_path(&self, title_id: &str, source_stream_index: u32) -> PathBuf {
        self.subtitles_dir.join(format!(
            "{}_sub_{}.srt",
            sanitise_filename(title_id),
            source_stream_index
        ))
    }

    fn title_subtitle_xml_path(&self, title_id: &str, stream_index: usize) -> PathBuf {
        self.subtitles_dir.join(format!(
            "{}_sub_{}.xml",
            sanitise_filename(title_id),
            stream_index
        ))
    }

    fn title_subtitle_stage_path(&self, title_id: &str, stream_index: usize) -> PathBuf {
        self.titles_dir.join(format!(
            "{}_substage_{}.mpg",
            sanitise_filename(title_id),
            stream_index
        ))
    }

    fn menu_paths(&self, menu_id: &str) -> MenuPaths {
        let base_name = sanitise_filename(menu_id);
        MenuPaths {
            base_video_path: self.menus_dir.join(format!("{base_name}_base.mpg")),
            authored_video_path: self.menus_dir.join(format!("{base_name}.mpg")),
            highlight_image_path: self.menus_dir.join(format!("{base_name}_highlight.png")),
            select_image_path: self.menus_dir.join(format!("{base_name}_select.png")),
        }
    }

    fn dvdauthor_xml_path(&self) -> PathBuf {
        self.work_dir.join("dvdauthor.xml")
    }

    fn iso_image_path(&self, project_name: &str) -> PathBuf {
        self.output_dir
            .join(format!("{}.iso", sanitise_filename(project_name)))
    }
}

struct ResolvedToolchain {
    ffmpeg: String,
    spumux: String,
    dvdauthor: String,
    iso_authoring: String,
}

impl ResolvedToolchain {
    fn resolve(skip_sidecar: bool) -> Self {
        Self {
            ffmpeg: crate::toolchain::resolve_tool("ffmpeg", skip_sidecar)
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "ffmpeg".to_string()),
            spumux: crate::toolchain::resolve_tool("spumux", skip_sidecar)
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "spumux".to_string()),
            dvdauthor: crate::toolchain::resolve_tool("dvdauthor", skip_sidecar)
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "dvdauthor".to_string()),
            iso_authoring: crate::toolchain::resolve_tool("genisoimage", skip_sidecar)
                .or_else(|| crate::toolchain::resolve_tool("mkisofs", skip_sidecar))
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "genisoimage".to_string()),
        }
    }
}

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
        strip_unsupported_subtitle_mappings(&mut owned_project);
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

    let all_titles: Vec<(&Titleset, &Title)> = project
        .disc
        .titlesets
        .iter()
        .flat_map(|ts| ts.titles.iter().map(move |t| (ts, t)))
        .collect();

    // Track which asset+config combos have already been transcoded so we can
    // reuse the output file when multiple titles share the same source and
    // identical stream/output settings.
    let mut transcode_cache: HashMap<String, PathBuf> = HashMap::new();
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

            let mut command = build_ffmpeg_transcode_command(
                &asset.source_path,
                &output_path,
                title,
                asset,
                &project.disc,
                video_info,
            );
            command[0] = tools.ffmpeg.clone();

            if !has_text_subtitles {
                transcode_cache.insert(cache_key, output_path.clone());
            }
            transcode_count += 1;

            jobs.push(BuildJob::TranscodeTitle {
                title_id: title.id.clone(),
                title_name: title.name.clone(),
                source_path: asset.source_path.clone(),
                output_path: output_path.display().to_string(),
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
            if let Some(asset) = assets.get(asset_id.as_str()) {
                scene_assets_map.insert(asset_id.clone(), asset.source_path.clone());
            }
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

fn ensure_supported_menu_backend(project: &SpindleProjectFile) -> crate::Result<()> {
    let motion_menus: Vec<_> = project
        .disc
        .global_menus
        .iter()
        .chain(
            project
                .disc
                .titlesets
                .iter()
                .flat_map(|titleset| titleset.menus.iter()),
        )
        .filter(|menu| matches!(menu.resolved_background_mode(), BackgroundMode::Motion))
        .map(|menu| menu.name.clone())
        .collect();

    if motion_menus.is_empty() {
        return Ok(());
    }

    Err(crate::Error::Build(format!(
        "Motion menu build authoring is not implemented yet. Switch these menus back to still mode before building: {}",
        motion_menus
            .iter()
            .map(|name| format!("\"{name}\""))
            .collect::<Vec<_>>()
            .join(", ")
    )))
}

fn generate_text_subtitle_spumux_xml(
    subtitle_path: &std::path::Path,
    standard: VideoStandard,
    profile: VideoOutputProfile,
    font_family: &str,
) -> String {
    let format_str = match standard {
        VideoStandard::Ntsc => "NTSC",
        VideoStandard::Pal => "PAL",
    };
    let (width, height) = profile.raster.resolution(standard);
    let aspect = match profile.aspect {
        AspectMode::FourByThree => "4:3",
        AspectMode::SixteenByNine => "16:9",
    };
    let fontsize = ((height as f64) * 0.05).round().clamp(24.0, 36.0);

    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<subpictures format=\"{format_str}\">\n  <stream>\n    <textsub filename=\"{}\" characterset=\"UTF-8\" font=\"{}\" fontsize=\"{fontsize:.1}\" fill-color=\"#FFFFFF\" outline-color=\"#000000\" outline-thickness=\"2.0\" shadow-offset=\"0, 0\" horizontal-alignment=\"center\" vertical-alignment=\"bottom\" left-margin=\"60\" right-margin=\"60\" top-margin=\"20\" bottom-margin=\"30\" movie-width=\"{width}\" movie-height=\"{height}\" aspect=\"{aspect}\" />\n  </stream>\n</subpictures>\n",
        xml_escape(&subtitle_path.display().to_string()),
        xml_escape(font_family),
    )
}

/// Remove subtitle mappings that the escape hatch should skip during build.
fn strip_unsupported_subtitle_mappings(project: &mut SpindleProjectFile) {
    let assets: HashMap<&str, &Asset> = project.assets.iter().map(|a| (a.id.as_str(), a)).collect();

    for titleset in &mut project.disc.titlesets {
        for title in &mut titleset.titles {
            if let Some(asset) = title
                .source_asset_id
                .as_deref()
                .and_then(|id| assets.get(id))
            {
                title.subtitle_mappings.retain(|sm| {
                    asset.subtitle_streams.iter().any(|s| {
                        s.index == sm.source_stream_index && s.subtitle_type == SubtitleType::Bitmap
                    })
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::build::test_support::{test_menu, test_project};
    use crate::build::{generate_build_plan, generate_build_plan_with_options, BuildJob};
    use crate::models::*;

    #[test]
    fn build_plan_generates_correct_job_count() {
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert_eq!(plan.jobs.len(), 3);
        assert_eq!(plan.summary.transcode_jobs, 1);
        assert_eq!(plan.summary.titles_count, 1);
    }

    #[test]
    fn build_plan_includes_iso_when_enabled() {
        let mut project = test_project();
        project.build_settings.generate_iso = true;

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert_eq!(plan.jobs.len(), 4);
        assert!(plan.summary.generate_iso);
    }

    #[test]
    fn build_plan_includes_menu_jobs_when_menu_exists() {
        let mut project = test_project();
        project.disc.global_menus.push(test_menu());

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan
            .jobs
            .iter()
            .any(|job| matches!(job, BuildJob::RenderMenu { .. })));
        assert!(plan
            .jobs
            .iter()
            .any(|job| matches!(job, BuildJob::ComposeMenuHighlights { .. })));
        assert_eq!(plan.summary.menus_count, 1);
    }

    #[test]
    fn build_plan_muxes_bitmap_subtitles_during_title_transcode() {
        let mut project = test_project();
        project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
            index: 2,
            codec: "hdmv_pgs_subtitle".to_string(),
            language: Some("eng".to_string()),
            subtitle_type: SubtitleType::Bitmap,
            title: Some("English".to_string()),
        });
        project.disc.titlesets[0].titles[0]
            .subtitle_mappings
            .push(SubtitleTrackMapping {
                id: "sm-1".to_string(),
                source_stream_index: 2,
                label: "English".to_string(),
                language: "eng".to_string(),
                order_index: 0,
                is_default: false,
                is_forced: false,
            });

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();
        let transcode_job = plan
            .jobs
            .iter()
            .find_map(|job| match job {
                BuildJob::TranscodeTitle { command, .. } => Some(command),
                _ => None,
            })
            .expect("expected transcode job");

        assert!(transcode_job
            .windows(2)
            .any(|window| { window == [String::from("-map"), String::from("0:2")] }));
        assert!(transcode_job
            .windows(2)
            .any(|window| { window == [String::from("-c:s:0"), String::from("dvd_subtitle")] }));
        assert!(!plan
            .jobs
            .iter()
            .any(|job| matches!(job, BuildJob::ExtractSubtitles { .. })));
    }

    #[test]
    fn build_plan_renders_text_subtitles_after_base_transcode() {
        let mut project = test_project();
        project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
            index: 2,
            codec: "subrip".to_string(),
            language: Some("eng".to_string()),
            subtitle_type: SubtitleType::Text,
            title: Some("English".to_string()),
        });
        project.disc.titlesets[0].titles[0]
            .subtitle_mappings
            .push(SubtitleTrackMapping {
                id: "sm-text".to_string(),
                source_stream_index: 2,
                label: "English".to_string(),
                language: "eng".to_string(),
                order_index: 0,
                is_default: false,
                is_forced: false,
            });

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(
            plan.jobs
                .iter()
                .any(|job| matches!(job, BuildJob::RenderTextSubtitles { .. })),
            "expected explicit text subtitle render job"
        );

        let transcode_output = plan.jobs.iter().find_map(|job| match job {
            BuildJob::TranscodeTitle { output_path, .. } => Some(output_path),
            _ => None,
        });
        assert!(
            transcode_output.is_some_and(|path| path.contains("_base.mpg")),
            "text subtitle titles should transcode to a base MPEG before composition"
        );
    }

    #[test]
    fn build_plan_preserves_mixed_subtitle_stream_order() {
        let mut project = test_project();
        project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
            index: 2,
            codec: "subrip".to_string(),
            language: Some("eng".to_string()),
            subtitle_type: SubtitleType::Text,
            title: Some("English text".to_string()),
        });
        project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
            index: 3,
            codec: "dvd_subtitle".to_string(),
            language: Some("fra".to_string()),
            subtitle_type: SubtitleType::Bitmap,
            title: Some("French bitmap".to_string()),
        });
        project.disc.titlesets[0].titles[0].subtitle_mappings = vec![
            SubtitleTrackMapping {
                id: "sm-text".to_string(),
                source_stream_index: 2,
                label: "English".to_string(),
                language: "eng".to_string(),
                order_index: 0,
                is_default: false,
                is_forced: false,
            },
            SubtitleTrackMapping {
                id: "sm-bitmap".to_string(),
                source_stream_index: 3,
                label: "French".to_string(),
                language: "fra".to_string(),
                order_index: 1,
                is_default: false,
                is_forced: false,
            },
        ];

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        let transcode_job = plan
            .jobs
            .iter()
            .find_map(|job| match job {
                BuildJob::TranscodeTitle { command, .. } => Some(command),
                _ => None,
            })
            .expect("expected transcode job");
        assert!(
            transcode_job
                .windows(2)
                .any(|window| window == [String::from("-c:s:0"), String::from("dvd_subtitle")]),
            "bitmap subtitle should keep the first ffmpeg subtitle slot when it is the first bitmap mapping"
        );

        let render_job = plan
            .jobs
            .iter()
            .find_map(|job| match job {
                BuildJob::RenderTextSubtitles { command, .. } => Some(command),
                _ => None,
            })
            .expect("expected text subtitle render job");
        assert!(
            render_job
                .windows(2)
                .any(|window| { window == [String::from("-s"), String::from("0")] }),
            "text subtitle should render into stream slot 0 when it is the first subtitle mapping"
        );
    }

    #[test]
    fn build_plan_skip_unsupported_streams_removes_text_subtitles() {
        let mut project = test_project();
        project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
            index: 2,
            codec: "subrip".to_string(),
            language: Some("eng".to_string()),
            subtitle_type: SubtitleType::Text,
            title: Some("English text".to_string()),
        });
        project.disc.titlesets[0].titles[0]
            .subtitle_mappings
            .push(SubtitleTrackMapping {
                id: "sm-text".to_string(),
                source_stream_index: 2,
                label: "English".to_string(),
                language: "eng".to_string(),
                order_index: 0,
                is_default: false,
                is_forced: false,
            });

        let plan =
            generate_build_plan_with_options(&project, "/tmp/dvd_output", false, true, false)
                .unwrap();

        assert!(
            !plan
                .jobs
                .iter()
                .any(|job| matches!(job, BuildJob::RenderTextSubtitles { .. })),
            "skip unsupported streams should strip text subtitle render jobs"
        );
        assert!(
            plan.jobs
                .iter()
                .any(|job| matches!(job, BuildJob::TranscodeTitle {
                output_path, ..
            } if output_path.ends_with("title-1.mpg"))),
            "text subtitle stripping should fall back to the direct title output path"
        );
    }

    #[test]
    fn build_plan_deduplicates_identical_transcodes_with_different_mapping_ids() {
        let mut project = test_project();

        // Add a second titleset with a title that uses the same asset and
        // identical stream/output settings but different mapping UUIDs.
        let duplicate_title = Title {
            id: "title-dup".to_string(),
            name: "Same Feature Copy".to_string(),
            source_asset_id: Some("asset-1".to_string()),
            video_mapping: Some(VideoTrackMapping {
                source_stream_index: 0,
                copy_mode: CopyMode::ReEncode,
            }),
            video_output_profile: Some(VideoOutputProfile {
                raster: VideoRaster::FullD1,
                aspect: AspectMode::SixteenByNine,
            }),
            audio_mappings: vec![AudioTrackMapping {
                id: "am-different-uuid".to_string(), // different ID!
                source_stream_index: 1,
                output_target: AudioOutputTarget::Ac3,
                copy_mode: CopyMode::ReEncode,
                label: "English".to_string(),
                language: "eng".to_string(),
                order_index: 0,
                is_default: true,
            }],
            subtitle_mappings: vec![],
            chapters: vec![],
            end_action: Some(PlaybackAction::Stop),
            order_index: 0,
        };

        project.disc.titlesets.push(Titleset {
            id: "titleset-dup".to_string(),
            name: "Duplicate".to_string(),
            titles: vec![duplicate_title],
            menus: vec![],
        });

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        // Should have 1 transcode + 1 link, not 2 transcodes
        assert_eq!(
            plan.summary.transcode_jobs, 1,
            "identical config should reuse transcode"
        );
        assert!(
            plan.jobs
                .iter()
                .any(|j| matches!(j, BuildJob::LinkTitle { .. })),
            "duplicate title should be linked, not transcoded again"
        );
    }

    #[test]
    fn build_plan_rejects_motion_menus_until_backend_support_lands() {
        let mut project = test_project();
        let mut menu = test_menu();
        menu.background_mode = BackgroundMode::Motion;
        menu.motion_duration_secs = Some(12.0);
        project.disc.global_menus.push(menu);

        let err = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap_err();
        let msg = err.to_string();

        assert!(msg.contains("Motion menu build authoring is not implemented yet"));
        assert!(msg.contains("\"Main Menu\""));
    }
}
