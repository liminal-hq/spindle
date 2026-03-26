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

pub fn generate_build_plan(
    project: &SpindleProjectFile,
    output_dir: &str,
    skip_sidecar: bool,
) -> crate::Result<BuildPlan> {
    let output_dir = PathBuf::from(output_dir);
    let work_dir = output_dir.join("_spindle_work");
    let titles_dir = work_dir.join("titles");
    let menus_dir = work_dir.join("menus");
    let video_ts_dir = output_dir.join("VIDEO_TS");

    let mut jobs = Vec::new();

    jobs.push(BuildJob::PrepareWorkspace {
        directories: vec![
            work_dir.display().to_string(),
            titles_dir.display().to_string(),
            menus_dir.display().to_string(),
            video_ts_dir.display().to_string(),
        ],
    });

    let assets: HashMap<&str, &Asset> = project.assets.iter().map(|a| (a.id.as_str(), a)).collect();

    let ffmpeg_bin = crate::toolchain::resolve_tool("ffmpeg", skip_sidecar)
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "ffmpeg".to_string());
    let spumux_bin = crate::toolchain::resolve_tool("spumux", skip_sidecar)
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "spumux".to_string());

    let all_titles: Vec<(&Titleset, &Title)> = project
        .disc
        .titlesets
        .iter()
        .flat_map(|ts| ts.titles.iter().map(move |t| (ts, t)))
        .collect();

    for (_, title) in &all_titles {
        let source_asset_id = title.source_asset_id.as_deref().ok_or_else(|| {
            crate::Error::Build(format!("Title \"{}\" has no source asset", title.name))
        })?;

        let asset = assets.get(source_asset_id).ok_or_else(|| {
            crate::Error::Build(format!("Asset not found for title \"{}\"", title.name))
        })?;

        let output_path = titles_dir.join(format!("{}.mpg", sanitise_filename(&title.id)));

        let video_info = title
            .video_mapping
            .as_ref()
            .and_then(|vm| asset.video_streams.get(vm.source_stream_index as usize));

        let mut command = build_ffmpeg_transcode_command(
            &asset.source_path,
            &output_path,
            title,
            &project.disc,
            video_info,
        );
        command[0] = ffmpeg_bin.clone();

        jobs.push(BuildJob::TranscodeTitle {
            title_id: title.id.clone(),
            title_name: title.name.clone(),
            source_path: asset.source_path.clone(),
            output_path: output_path.display().to_string(),
            command,
            label: format!("Transcode \"{}\"", title.name),
        });
    }

    for menu_ref in authorable_menus(project) {
        let base_output_path =
            menus_dir.join(format!("{}_base.mpg", sanitise_filename(&menu_ref.menu.id)));
        let final_output_path =
            menus_dir.join(format!("{}.mpg", sanitise_filename(&menu_ref.menu.id)));
        let highlight_image_path = menus_dir.join(format!(
            "{}_highlight.png",
            sanitise_filename(&menu_ref.menu.id)
        ));
        let select_image_path = menus_dir.join(format!(
            "{}_select.png",
            sanitise_filename(&menu_ref.menu.id)
        ));
        let render_command = build_ffmpeg_menu_command(
            &ffmpeg_bin,
            &menu_ref,
            &assets,
            project,
            project.disc.standard,
            &base_output_path,
        )?;

        jobs.push(BuildJob::RenderMenu {
            menu_id: menu_ref.menu.id.clone(),
            menu_name: menu_ref.menu.name.clone(),
            output_path: base_output_path.display().to_string(),
            command: render_command,
            label: format!("Render menu \"{}\"", menu_ref.menu.name),
            standard: project.disc.standard,
            highlight_image_path: highlight_image_path.display().to_string(),
            select_image_path: select_image_path.display().to_string(),
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

        let spumux_xml = generate_spumux_xml(&menu_ref, project.disc.standard, &menus_dir);
        jobs.push(BuildJob::ComposeMenuHighlights {
            menu_id: menu_ref.menu.id.clone(),
            menu_name: menu_ref.menu.name.clone(),
            input_path: base_output_path.display().to_string(),
            output_path: final_output_path.display().to_string(),
            spumux_xml,
            command: vec![
                spumux_bin.clone(),
                "-m".to_string(),
                "dvd".to_string(),
                format!("{}.xml", final_output_path.with_extension("").display()),
            ],
            label: format!("Compose menu highlights \"{}\"", menu_ref.menu.name),
        });
    }

    let dvdauthor_xml = generate_dvdauthor_xml(project, &titles_dir, &menus_dir, &video_ts_dir)?;
    let xml_path = work_dir.join("dvdauthor.xml");

    let dvdauthor_bin = crate::toolchain::resolve_tool("dvdauthor", skip_sidecar)
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "dvdauthor".to_string());

    jobs.push(BuildJob::AuthorDvd {
        xml_path: xml_path.display().to_string(),
        output_path: video_ts_dir.display().to_string(),
        command: vec![
            dvdauthor_bin,
            "-x".to_string(),
            xml_path.display().to_string(),
        ],
        label: "Author DVD (dvdauthor)".to_string(),
    });

    if project.build_settings.generate_iso {
        let iso_path = output_dir.join(format!("{}.iso", sanitise_filename(&project.project.name)));
        let volume_id = project
            .project
            .name
            .chars()
            .take(32)
            .collect::<String>()
            .to_uppercase();

        let iso_tool = crate::toolchain::resolve_tool("genisoimage", skip_sidecar)
            .or_else(|| crate::toolchain::resolve_tool("mkisofs", skip_sidecar))
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "genisoimage".to_string());

        jobs.push(BuildJob::CreateIso {
            source_path: output_dir.display().to_string(),
            output_path: iso_path.display().to_string(),
            command: vec![
                iso_tool,
                "-dvd-video".to_string(),
                "-V".to_string(),
                volume_id,
                "-o".to_string(),
                iso_path.display().to_string(),
                output_dir.display().to_string(),
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
        transcode_jobs: all_titles.len(),
        titles_count: all_titles.len(),
        menus_count: all_menus.len(),
        generate_iso: project.build_settings.generate_iso,
        estimated_commands,
    };

    Ok(BuildPlan {
        jobs,
        output_directory: output_dir.display().to_string(),
        working_directory: work_dir.display().to_string(),
        dvdauthor_xml,
        summary,
    })
}

#[cfg(test)]
mod tests {
    use crate::build::test_support::{test_menu, test_project};
    use crate::build::{BuildJob, generate_build_plan};

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
}
