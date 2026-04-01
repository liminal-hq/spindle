// Build plan generation for DVD authoring.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashMap;
use std::path::PathBuf;

use crate::models::*;

use super::authoring::generate_dvdauthor_xml;
use super::ffmpeg::build_ffmpeg_transcode_command;
use super::menu::{authorable_menus, build_ffmpeg_menu_command, generate_spumux_xml};
use super::types::{BuildJob, BuildPlan, BuildSummary, MenuOverlayButton};
use super::util::sanitise_filename;

struct BuildPaths {
    output_dir: PathBuf,
    work_dir: PathBuf,
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

impl BuildPaths {
    fn new(output_dir: &str) -> Self {
        let output_dir = PathBuf::from(output_dir);
        let work_dir = output_dir.join("_spindle_work");
        let titles_dir = work_dir.join("titles");
        let subtitles_dir = work_dir.join("subtitles");
        let menus_dir = work_dir.join("menus");
        let video_ts_dir = output_dir.join("VIDEO_TS");

        Self {
            output_dir,
            work_dir,
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
            self.video_ts_dir.display().to_string(),
        ]
    }

    fn reset_directories(&self) -> Vec<String> {
        vec![
            self.work_dir.display().to_string(),
            self.video_ts_dir.display().to_string(),
        ]
    }

    fn title_video_path(&self, title_id: &str) -> PathBuf {
        self.titles_dir
            .join(format!("{}.mpg", sanitise_filename(title_id)))
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
    let paths = BuildPaths::new(output_dir);
    let tools = ResolvedToolchain::resolve(skip_sidecar);

    let mut jobs = Vec::new();

    jobs.push(BuildJob::PrepareWorkspace {
        reset_directories: paths.reset_directories(),
        directories: paths.workspace_directories(),
    });

    let assets: HashMap<&str, &Asset> = project.assets.iter().map(|a| (a.id.as_str(), a)).collect();

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

        if let Some(existing_output) = transcode_cache.get(&cache_key) {
            // Reuse by symlinking to the existing transcode output
            let link_path = paths.title_video_path(&title.id);
            jobs.push(BuildJob::LinkTitle {
                title_id: title.id.clone(),
                title_name: title.name.clone(),
                source_path: existing_output.display().to_string(),
                link_path: link_path.display().to_string(),
                label: format!("Link \"{}\" (shared transcode)", title.name),
            });
        } else {
            let output_path = paths.title_video_path(&title.id);

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

            transcode_cache.insert(cache_key, output_path.clone());
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
        }
    }

    for menu_ref in authorable_menus(project) {
        let menu_paths = paths.menu_paths(&menu_ref.menu.id);
        let render_command = build_ffmpeg_menu_command(
            &tools.ffmpeg,
            &menu_ref,
            &assets,
            project,
            project.disc.standard,
            &menu_paths.base_video_path,
        )?;

        jobs.push(BuildJob::RenderMenu {
            menu_id: menu_ref.menu.id.clone(),
            menu_name: menu_ref.menu.name.clone(),
            output_path: menu_paths.base_video_path.display().to_string(),
            command: render_command,
            label: format!("Render menu \"{}\"", menu_ref.menu.name),
            standard: project.disc.standard,
            highlight_image_path: menu_paths.highlight_image_path.display().to_string(),
            select_image_path: menu_paths.select_image_path.display().to_string(),
            highlight_colour: menu_ref.menu.highlight_colours.select_colour.clone(),
            select_colour: menu_ref.menu.highlight_colours.activate_colour.clone(),
            button_bounds: menu_ref
                .menu
                .buttons
                .iter()
                .map(|button| MenuOverlayButton {
                    x0: button.bounds.x.round() as i32,
                    y0: button.bounds.y.round() as i32,
                    x1: (button.bounds.x + button.bounds.width).round() as i32,
                    y1: (button.bounds.y + button.bounds.height).round() as i32,
                })
                .collect(),
        });

        let spumux_xml = generate_spumux_xml(&menu_ref, project.disc.standard, &paths.menus_dir);
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
        &paths.video_ts_dir,
    )?;
    let xml_path = paths.dvdauthor_xml_path();

    jobs.push(BuildJob::AuthorDvd {
        xml_path: xml_path.display().to_string(),
        output_path: paths.video_ts_dir.display().to_string(),
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
            source_path: paths.output_dir.display().to_string(),
            output_path: iso_path.display().to_string(),
            command: vec![
                tools.iso_authoring,
                "-dvd-video".to_string(),
                "-V".to_string(),
                volume_id,
                "-o".to_string(),
                iso_path.display().to_string(),
                paths.output_dir.display().to_string(),
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

#[cfg(test)]
mod tests {
    use crate::build::test_support::{test_menu, test_project};
    use crate::build::{generate_build_plan, BuildJob};
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
        assert_eq!(plan.summary.transcode_jobs, 1, "identical config should reuse transcode");
        assert!(
            plan.jobs.iter().any(|j| matches!(j, BuildJob::LinkTitle { .. })),
            "duplicate title should be linked, not transcoded again"
        );
    }
}
