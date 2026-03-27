// Build plan execution and subprocess orchestration.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

use super::menu::{generate_menu_overlay_images, MenuOverlayImages, MenuOverlayRender};
use super::types::{BuildJob, BuildJobStatus, BuildPlan, BuildProgress, BuildResult};

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

        on_progress(BuildProgress {
            job_index: i,
            total_jobs: total,
            current_label: label.clone(),
            status: BuildJobStatus::Starting,
            output: None,
        });

        log_lines.push(format!("[{}/{}] {}", i + 1, total, label));

        match job {
            BuildJob::PrepareWorkspace { directories } => {
                for dir in directories {
                    if let Err(e) = std::fs::create_dir_all(dir) {
                        let msg = format!("Failed to create directory {dir}: {e}");
                        log_lines.push(msg.clone());
                        return failure(plan, log_lines, i, msg);
                    }
                }
                log_lines.push("  Workspace directories created.".to_string());
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
                ..
            } => {
                let render = MenuOverlayRender {
                    ffmpeg_bin: &command[0],
                    standard: *standard,
                    menu_id,
                    button_bounds,
                };
                let images = MenuOverlayImages {
                    highlight_image_path,
                    select_image_path,
                    highlight_colour,
                    select_colour,
                };
                if let Err(msg) = generate_menu_overlay_images(&render, &images, run_command) {
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

                    on_progress(BuildProgress {
                        job_index: i,
                        total_jobs: total,
                        current_label: label.clone(),
                        status: BuildJobStatus::Running,
                        output: None,
                    });

                    match run_command(command) {
                        Ok(output) => {
                            if !output.is_empty() {
                                log_lines.push(output);
                            }
                        }
                        Err(msg) => {
                            log_lines.push(msg.clone());
                            on_progress(BuildProgress {
                                job_index: i,
                                total_jobs: total,
                                current_label: label,
                                status: BuildJobStatus::Failed,
                                output: Some(msg.clone()),
                            });
                            return failure(plan, log_lines, i, msg);
                        }
                    }
                }
            }
        }

        on_progress(BuildProgress {
            job_index: i,
            total_jobs: total,
            current_label: label,
            status: BuildJobStatus::Complete,
            output: None,
        });
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

fn run_command(args: &[String]) -> std::result::Result<String, String> {
    if args.is_empty() {
        return Err("Empty command".to_string());
    }

    let output = Command::new(&args[0])
        .args(&args[1..])
        .output()
        .map_err(|e| {
            format!(
                "Failed to run {}: {}. Ensure it is installed and on the PATH.",
                args[0], e
            )
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        let mut combined = String::new();
        if !stdout.trim().is_empty() {
            combined.push_str(&stdout);
        }
        if !stderr.trim().is_empty() {
            if !combined.is_empty() {
                combined.push('\n');
            }
            combined.push_str(&stderr);
        }
        Ok(combined)
    } else {
        let mut msg = format!("{} exited with status {}", args[0], output.status);
        if !stderr.trim().is_empty() {
            msg.push_str(&format!("\n{stderr}"));
        }
        Err(msg)
    }
}

fn run_spumux_command(
    args: &[String],
    input_path: &str,
    output_path: &str,
) -> std::result::Result<String, String> {
    if args.is_empty() {
        return Err("Empty spumux command".to_string());
    }

    let input = std::fs::File::open(input_path)
        .map_err(|e| format!("Failed to open spumux input {input_path}: {e}"))?;
    let output = std::fs::File::create(output_path)
        .map_err(|e| format!("Failed to create spumux output {output_path}: {e}"))?;

    let child = Command::new(&args[0])
        .args(&args[1..])
        .stdin(Stdio::from(input))
        .stdout(Stdio::from(output))
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run {}: {}", args[0], e))?;

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed waiting for {}: {}", args[0], e))?;
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(stderr)
    } else {
        Err(format!(
            "{} exited with status {}\n{}",
            args[0], output.status, stderr
        ))
    }
}
