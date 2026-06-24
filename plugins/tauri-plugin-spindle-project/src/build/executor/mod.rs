// Build plan execution and subprocess orchestration.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use super::menu::{generate_menu_overlay_images, MenuOverlayImages, MenuOverlayRender};
use super::skia::render_menu_scene_to_png;
use super::types::{BuildJob, BuildJobStatus, BuildPlan, BuildProgress, BuildResult};
use crate::models::{Asset, DiscFamily, MenuDocument, RenderTarget};

mod helpers;
mod process;
#[cfg(test)]
mod tests;

use helpers::{carry_title_stage_forward, reset_workspace_directory, subtitle_file_has_cues};
use process::{run_command, run_ffmpeg_command, run_spumux_command};

/// Minimum interval between step-progress event emissions.
const PROGRESS_THROTTLE_MS: u128 = 500;

/// Global cancellation flag for the current build.
/// Set to `true` to request cancellation; reset before each build.
static BUILD_CANCELLED: AtomicBool = AtomicBool::new(false);

pub fn cancel_build() {
    BUILD_CANCELLED.store(true, Ordering::SeqCst);
}

fn is_cancelled() -> bool {
    BUILD_CANCELLED.load(Ordering::SeqCst)
}

pub fn execute_build_plan<F>(plan: &BuildPlan, mut on_progress: F) -> BuildResult
where
    F: FnMut(BuildProgress),
{
    BUILD_CANCELLED.store(false, Ordering::SeqCst);

    let total = plan.jobs.len();
    let mut log_lines = Vec::new();

    for (i, job) in plan.jobs.iter().enumerate() {
        if is_cancelled() {
            log_lines.push("Build cancelled by user.".to_string());
            return BuildResult {
                success: false,
                output_directory: plan.output_directory.clone(),
                iso_path: None,
                log_lines,
                failed_job_index: Some(i),
                error_message: Some("Build cancelled by user.".to_string()),
            };
        }

        let label = job.label().to_string();

        on_progress(BuildProgress::job(
            i,
            total,
            label.clone(),
            BuildJobStatus::Starting,
            None,
        ));

        log_lines.push(format!("[{}/{}] {}", i + 1, total, label));

        match job {
            BuildJob::PrepareWorkspace {
                reset_directories,
                directories,
            } => {
                for dir in reset_directories {
                    if let Err(e) = reset_workspace_directory(dir) {
                        let msg = format!("Failed to reset directory {dir}: {e}");
                        log_lines.push(msg.clone());
                        return failure(plan, log_lines, i, msg);
                    }
                }
                for dir in directories {
                    if let Err(e) = std::fs::create_dir_all(dir) {
                        let msg = format!("Failed to create directory {dir}: {e}");
                        log_lines.push(msg.clone());
                        return failure(plan, log_lines, i, msg);
                    }
                }
                log_lines.push("  Workspace directories reset and created.".to_string());
            }
            BuildJob::LinkTitle {
                source_path,
                link_path,
                ..
            } => {
                // Hard-link (or copy as fallback) the shared transcode output
                let src = Path::new(source_path);
                let dst = Path::new(link_path);
                let result =
                    std::fs::hard_link(src, dst).or_else(|_| std::fs::copy(src, dst).map(|_| ()));
                match result {
                    Ok(()) => {
                        log_lines.push(format!("  Linked {}", dst.display()));
                    }
                    Err(e) => {
                        let msg = format!("Failed to link title output: {e}");
                        log_lines.push(msg.clone());
                        return failure(plan, log_lines, i, msg);
                    }
                }
            }
            BuildJob::RenderMenu {
                menu_id,
                command,
                output_path: _,
                standard,
                highlight_image_path,
                select_image_path,
                highlight_colour,
                select_colour,
                button_bounds,
                raster_width,
                raster_height,
                scene_png_path,
                menu_document_json,
                scene_assets_json,
                quantize_overlay_palette,
                ..
            } => {
                let overlay_target = RenderTarget {
                    family: DiscFamily::DvdVideo,
                    standard: Some(*standard),
                    raster_width: *raster_width,
                    raster_height: *raster_height,
                    sar_num: 1,
                    sar_den: 1,
                };

                // Reconstruct the menu scene data and render the Skia PNG.
                // A missing or unparseable authored document is a hard failure:
                // build_ffmpeg_menu_command always adds a -i <scene_png_path>
                // input, so skipping the render would cause ffmpeg to fail on
                // the missing file with a confusing error instead of a clear one.
                // A missing or unparseable authored document is a hard failure:
                // build_ffmpeg_menu_command always adds a -i <scene_png_path>
                // input, so skipping the render would cause ffmpeg to fail on
                // the missing file with an opaque error instead of a clear one.
                let menu_doc = match serde_json::from_str::<MenuDocument>(menu_document_json) {
                    Ok(doc) => doc,
                    Err(e) => {
                        let msg = format!(
                            "Cannot render menu \"{menu_id}\": authored document is missing or \
                             invalid ({e}). The menu must have an authored scene before it can be built."
                        );
                        log_lines.push(msg.clone());
                        return failure(plan, log_lines, i, msg);
                    }
                };

                // Build a minimal asset map from the serialised source-path index
                // (asset_id → source_path). We set the asset id explicitly so that
                // the HashMap key matches what SceneNode::Image stores.
                let asset_paths: std::collections::HashMap<String, String> =
                    serde_json::from_str(scene_assets_json).unwrap_or_default();
                let owned_assets: Vec<Asset> = asset_paths
                    .into_iter()
                    .map(|(id, source_path)| {
                        let file_name = std::path::Path::new(&source_path)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or(&source_path)
                            .to_string();
                        let mut a = Asset::new(file_name, source_path);
                        a.id = id;
                        a
                    })
                    .collect();
                let assets_map: std::collections::HashMap<&str, &Asset> =
                    owned_assets.iter().map(|a| (a.id.as_str(), a)).collect();

                use super::menu::{AuthorableMenuRef, MenuDomain};
                use crate::models::Menu;
                let menu = Menu {
                    id: menu_id.clone(),
                    authored_document: Some(menu_doc),
                    ..Menu::default()
                };
                let menu_ref = AuthorableMenuRef {
                    menu: &menu,
                    domain: MenuDomain::Vmgm,
                };

                if let Err(e) = render_menu_scene_to_png(
                    &menu_ref,
                    &assets_map,
                    overlay_target,
                    std::path::Path::new(scene_png_path),
                    true, // transparent — composited over background by ffmpeg
                ) {
                    let msg =
                        format!("Failed to render Skia scene PNG for menu \"{menu_id}\": {e}");
                    log_lines.push(msg.clone());
                    return failure(plan, log_lines, i, msg);
                }
                log_lines.push(format!("  Rendered Skia scene PNG: {scene_png_path}"));

                if *quantize_overlay_palette {
                    log_lines.push(
                        "  [dev] quantize_overlay_palette is active: rendering AA overlay and quantizing to ≤4 colours".to_string(),
                    );
                }

                let render = MenuOverlayRender {
                    menu_id,
                    button_bounds,
                    target: overlay_target,
                };
                let images = MenuOverlayImages {
                    highlight_image_path,
                    select_image_path,
                    highlight_colour,
                    select_colour,
                    quantize_palette: *quantize_overlay_palette,
                };
                if let Err(msg) = generate_menu_overlay_images(&render, &images) {
                    log_lines.push(msg.clone());
                    return failure(plan, log_lines, i, msg);
                }

                log_lines.push(format!("  $ {}", command.join(" ")));
                match run_command(command) {
                    Ok(output) => {
                        if !output.is_empty() {
                            log_lines.push(output);
                        }
                    }
                    Err(msg) => {
                        log_lines.push(msg.clone());
                        return failure(plan, log_lines, i, msg);
                    }
                }
            }
            BuildJob::ComposeMenuHighlights {
                output_path,
                input_path,
                spumux_xml,
                command,
                ..
            } => {
                let xml_path = PathBuf::from(output_path).with_extension("xml");
                if let Err(e) = std::fs::write(&xml_path, spumux_xml) {
                    let msg = format!("Failed to write spumux XML: {e}");
                    log_lines.push(msg.clone());
                    return failure(plan, log_lines, i, msg);
                }
                log_lines.push(format!("  Wrote {}", xml_path.display()));

                match run_spumux_command(command, input_path, output_path) {
                    Ok(output) => {
                        if !output.is_empty() {
                            log_lines.push(output);
                        }
                    }
                    Err(msg) => {
                        log_lines.push(msg.clone());
                        return failure(plan, log_lines, i, msg);
                    }
                }
            }
            BuildJob::TranscodeTitle {
                pass1_command,
                command,
                duration_secs,
                ..
            } => {
                if let Some(pass1_command) = pass1_command {
                    log_lines.push(format!("  $ {}", pass1_command.join(" ")));

                    on_progress(BuildProgress::job(
                        i,
                        total,
                        label.clone(),
                        BuildJobStatus::Running,
                        None,
                    ));

                    match run_ffmpeg_command(
                        pass1_command,
                        *duration_secs,
                        i,
                        total,
                        &label,
                        "Two-pass analysis (pass 1/2)",
                        &mut on_progress,
                    ) {
                        Ok(output) => {
                            if !output.is_empty() {
                                log_lines.push(output);
                            }
                        }
                        Err(msg) => {
                            log_lines.push(msg.clone());
                            on_progress(BuildProgress::job(
                                i,
                                total,
                                label,
                                BuildJobStatus::Failed,
                                Some(msg.clone()),
                            ));
                            return failure(plan, log_lines, i, msg);
                        }
                    }
                }

                log_lines.push(format!("  $ {}", command.join(" ")));

                on_progress(BuildProgress::job(
                    i,
                    total,
                    label.clone(),
                    BuildJobStatus::Running,
                    None,
                ));

                match run_ffmpeg_command(
                    command,
                    *duration_secs,
                    i,
                    total,
                    &label,
                    if pass1_command.is_some() {
                        "Two-pass encode (pass 2/2)"
                    } else {
                        "FFmpeg transcode"
                    },
                    &mut on_progress,
                ) {
                    Ok(output) => {
                        if !output.is_empty() {
                            log_lines.push(output);
                        }
                    }
                    Err(msg) => {
                        log_lines.push(msg.clone());
                        on_progress(BuildProgress::job(
                            i,
                            total,
                            label,
                            BuildJobStatus::Failed,
                            Some(msg.clone()),
                        ));
                        return failure(plan, log_lines, i, msg);
                    }
                }
            }
            BuildJob::RenderTextSubtitles {
                prepare_command,
                spumux_xml,
                command,
                input_path,
                output_path,
                subtitle_path,
                font_family,
                ..
            } => {
                log_lines.push(format!("  $ {}", prepare_command.join(" ")));
                on_progress(BuildProgress {
                    job_index: i,
                    total_jobs: total,
                    current_label: label.clone(),
                    status: BuildJobStatus::Running,
                    output: None,
                    step_label: Some("Prepare subtitle text".to_string()),
                    step_percent: None,
                    step_detail: Some(subtitle_path.clone()),
                    step_status: Some(BuildJobStatus::Running),
                    elapsed_secs: None,
                    eta_secs: None,
                });

                match run_ffmpeg_command(
                    prepare_command,
                    None,
                    i,
                    total,
                    &label,
                    "Prepare subtitle text",
                    &mut on_progress,
                ) {
                    Ok(output) => {
                        if !output.is_empty() {
                            log_lines.push(output);
                        }
                    }
                    Err(msg) => {
                        log_lines.push(msg.clone());
                        on_progress(BuildProgress::job(
                            i,
                            total,
                            label,
                            BuildJobStatus::Failed,
                            Some(msg.clone()),
                        ));
                        return failure(plan, log_lines, i, msg);
                    }
                }

                match subtitle_file_has_cues(subtitle_path) {
                    Ok(true) => {}
                    Ok(false) => {
                        if let Err(msg) = carry_title_stage_forward(input_path, output_path) {
                            log_lines.push(msg.clone());
                            on_progress(BuildProgress::job(
                                i,
                                total,
                                label,
                                BuildJobStatus::Failed,
                                Some(msg.clone()),
                            ));
                            return failure(plan, log_lines, i, msg);
                        }

                        let msg = format!(
                            "Skipped text subtitle render for {subtitle_path} because the extracted subtitle file had no cues in this authored range."
                        );
                        log_lines.push(msg.clone());
                        on_progress(BuildProgress {
                            job_index: i,
                            total_jobs: total,
                            current_label: label.clone(),
                            status: BuildJobStatus::Running,
                            output: Some(msg),
                            step_label: Some("Prepare subtitle text".to_string()),
                            step_percent: Some(100.0),
                            step_detail: Some(subtitle_path.clone()),
                            step_status: Some(BuildJobStatus::Complete),
                            elapsed_secs: None,
                            eta_secs: None,
                        });
                        on_progress(BuildProgress::job(
                            i,
                            total,
                            label,
                            BuildJobStatus::Complete,
                            None,
                        ));
                        continue;
                    }
                    Err(msg) => {
                        log_lines.push(msg.clone());
                        on_progress(BuildProgress::job(
                            i,
                            total,
                            label,
                            BuildJobStatus::Failed,
                            Some(msg.clone()),
                        ));
                        return failure(plan, log_lines, i, msg);
                    }
                }

                let xml_path = command
                    .last()
                    .cloned()
                    .unwrap_or_else(|| format!("{output_path}.xml"));
                if let Err(e) = std::fs::write(&xml_path, spumux_xml) {
                    let msg = format!("Failed to write subtitle render XML: {e}");
                    log_lines.push(msg.clone());
                    return failure(plan, log_lines, i, msg);
                }
                log_lines.push(format!("  Wrote {xml_path}"));

                on_progress(BuildProgress {
                    job_index: i,
                    total_jobs: total,
                    current_label: label.clone(),
                    status: BuildJobStatus::Running,
                    output: None,
                    step_label: Some("Compose DVD subtitle stream".to_string()),
                    step_percent: None,
                    step_detail: Some(output_path.clone()),
                    step_status: Some(BuildJobStatus::Running),
                    elapsed_secs: None,
                    eta_secs: None,
                });

                match run_spumux_command(command, input_path, output_path) {
                    Ok(output) => {
                        if !output.is_empty() {
                            log_lines.push(output);
                        }
                    }
                    Err(msg) => {
                        let msg = format!(
                            "{msg}\nText subtitle rendering uses the host font \"{font_family}\". Confirm that Fontconfig can resolve it on this machine."
                        );
                        log_lines.push(msg.clone());
                        on_progress(BuildProgress::job(
                            i,
                            total,
                            label,
                            BuildJobStatus::Failed,
                            Some(msg.clone()),
                        ));
                        return failure(plan, log_lines, i, msg);
                    }
                }
            }
            BuildJob::AuthorDvd {
                xml_path, command, ..
            } => {
                if let Err(e) = std::fs::write(xml_path, &plan.dvdauthor_xml) {
                    let msg = format!("Failed to write dvdauthor XML: {e}");
                    log_lines.push(msg.clone());
                    return failure(plan, log_lines, i, msg);
                }
                log_lines.push(format!("  Wrote {xml_path}"));

                match run_command(command) {
                    Ok(output) => {
                        log_lines.push(output);
                    }
                    Err(msg) => {
                        log_lines.push(msg.clone());
                        return failure(plan, log_lines, i, msg);
                    }
                }
            }
            _ => {
                if let Some(command) = job.command() {
                    log_lines.push(format!("  $ {}", command.join(" ")));

                    on_progress(BuildProgress::job(
                        i,
                        total,
                        label.clone(),
                        BuildJobStatus::Running,
                        None,
                    ));

                    match run_command(command) {
                        Ok(output) => {
                            if !output.is_empty() {
                                log_lines.push(output);
                            }
                        }
                        Err(msg) => {
                            log_lines.push(msg.clone());
                            on_progress(BuildProgress::job(
                                i,
                                total,
                                label,
                                BuildJobStatus::Failed,
                                Some(msg.clone()),
                            ));
                            return failure(plan, log_lines, i, msg);
                        }
                    }
                }
            }
        }

        on_progress(BuildProgress::job(
            i,
            total,
            label,
            BuildJobStatus::Complete,
            None,
        ));
    }

    let iso_path = plan.jobs.iter().find_map(|j| {
        if let BuildJob::CreateIso { output_path, .. } = j {
            Some(output_path.clone())
        } else {
            None
        }
    });

    BuildResult {
        success: true,
        output_directory: plan.output_directory.clone(),
        iso_path,
        log_lines,
        failed_job_index: None,
        error_message: None,
    }
}

fn failure(
    plan: &BuildPlan,
    log_lines: Vec<String>,
    failed_job_index: usize,
    error_message: String,
) -> BuildResult {
    BuildResult {
        success: false,
        output_directory: plan.output_directory.clone(),
        iso_path: None,
        log_lines,
        failed_job_index: Some(failed_job_index),
        error_message: Some(error_message),
    }
}
