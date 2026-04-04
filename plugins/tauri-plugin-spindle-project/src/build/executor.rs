// Build plan execution and subprocess orchestration.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use super::ffmpeg_progress;
use super::menu::{generate_menu_overlay_images, MenuOverlayImages, MenuOverlayRender};
use super::types::{BuildJob, BuildJobStatus, BuildPlan, BuildProgress, BuildResult};

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
            BuildJob::TranscodeTitle {
                command,
                duration_secs,
                ..
            } => {
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
                    "FFmpeg transcode",
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

fn reset_workspace_directory(path: &str) -> std::io::Result<()> {
    let path = Path::new(path);
    if path.exists() {
        std::fs::remove_dir_all(path)?;
    }
    Ok(())
}

fn subtitle_file_has_cues(path: &str) -> Result<bool, String> {
    let bytes =
        std::fs::read(path).map_err(|e| format!("Failed to read prepared subtitle file: {e}"))?;
    Ok(bytes.iter().any(|byte| !byte.is_ascii_whitespace()))
}

fn carry_title_stage_forward(input_path: &str, output_path: &str) -> Result<(), String> {
    if input_path == output_path {
        return Ok(());
    }

    let src = Path::new(input_path);
    let dst = Path::new(output_path);
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to prepare title stage directory: {e}"))?;
    }
    if dst.exists() {
        std::fs::remove_file(dst)
            .map_err(|e| format!("Failed to replace carried title stage output: {e}"))?;
    }

    std::fs::hard_link(src, dst)
        .or_else(|_| std::fs::copy(src, dst).map(|_| ()))
        .map_err(|e| format!("Failed to carry title stage forward after empty subtitles: {e}"))
}

/// Run an FFmpeg command with streaming stderr, step-progress reporting,
/// and cancellation support.
///
/// Adds `-progress pipe:2` so FFmpeg emits structured key-value progress
/// lines on stderr alongside its normal log output. The stderr reader
/// loop parses `out_time=` lines, estimates a percentage from
/// `duration_secs`, and emits throttled step-progress events.
fn run_ffmpeg_command<F>(
    args: &[String],
    duration_secs: Option<f64>,
    job_index: usize,
    total_jobs: usize,
    label: &str,
    step_label: &str,
    on_progress: &mut F,
) -> std::result::Result<String, String>
where
    F: FnMut(BuildProgress),
{
    if args.is_empty() {
        return Err("Empty command".to_string());
    }

    // Build the argument list, injecting `-progress pipe:2` before the
    // output path (last argument) so FFmpeg emits structured progress on
    // stderr.
    let mut cmd_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let insert_pos = if cmd_args.len() > 1 {
        cmd_args.len() - 1
    } else {
        cmd_args.len()
    };
    cmd_args.insert(insert_pos, "pipe:2");
    cmd_args.insert(insert_pos, "-progress");

    let mut child = Command::new(cmd_args[0])
        .args(&cmd_args[1..])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to run {}: {}. Ensure it is installed and on the PATH.",
                args[0], e
            )
        })?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture FFmpeg stderr".to_string())?;

    let mut reader = std::io::BufReader::new(stderr);
    let mut stderr_buf = String::new();
    let mut last_emit = Instant::now();
    let mut raw_line = Vec::new();

    // Read stderr as raw bytes and decode lossily so non-UTF-8 metadata
    // in FFmpeg output never causes an error that leaks the child process.
    loop {
        raw_line.clear();
        let bytes_read = reader.read_until(b'\n', &mut raw_line).unwrap_or(0);
        if bytes_read == 0 {
            break; // EOF
        }

        if is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Build cancelled by user.".to_string());
        }

        let line = String::from_utf8_lossy(&raw_line);
        let line = line.trim_end_matches('\n').trim_end_matches('\r');

        // Try to extract progress from `-progress pipe:2` output.
        if let Some(time_val) = ffmpeg_progress::extract_progress_value(line, "out_time") {
            if let Some(elapsed) = ffmpeg_progress::parse_out_time_secs(time_val) {
                let pct = ffmpeg_progress::step_percent(elapsed, duration_secs);
                let detail = ffmpeg_progress::format_timestamp(elapsed);

                // Throttle emissions to avoid flooding the frontend.
                if last_emit.elapsed().as_millis() >= PROGRESS_THROTTLE_MS {
                    on_progress(BuildProgress {
                        job_index,
                        total_jobs,
                        current_label: label.to_string(),
                        status: BuildJobStatus::Running,
                        output: None,
                        step_label: Some(step_label.to_string()),
                        step_percent: pct,
                        step_detail: Some(detail),
                        step_status: Some(BuildJobStatus::Running),
                    });
                    last_emit = Instant::now();
                }
            }
        }

        // Accumulate all stderr lines for the log.
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            if !stderr_buf.is_empty() {
                stderr_buf.push('\n');
            }
            stderr_buf.push_str(trimmed);
        }
    }

    let output = child
        .wait()
        .map_err(|e| format!("Failed waiting for {}: {e}", args[0]))?;

    let stdout = child
        .stdout
        .map(|mut s| {
            let mut buf = String::new();
            use std::io::Read;
            let _ = s.read_to_string(&mut buf);
            buf
        })
        .unwrap_or_default();

    if output.success() {
        let mut combined = String::new();
        if !stdout.trim().is_empty() {
            combined.push_str(&stdout);
        }
        if !stderr_buf.trim().is_empty() {
            if !combined.is_empty() {
                combined.push('\n');
            }
            combined.push_str(&stderr_buf);
        }
        Ok(combined)
    } else {
        let mut msg = format!("{} exited with status {}", args[0], output);
        if !stderr_buf.trim().is_empty() {
            msg.push_str(&format!("\n{stderr_buf}"));
        }
        Err(msg)
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

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::build::test_support::{test_menu_with_action, test_project};
    use crate::build::{
        execute_build_plan, generate_build_plan, BuildJob, BuildPlan, BuildProgress, BuildSummary,
    };
    use crate::models::{PlaybackAction, SubtitleRenderMode, SubtitleStreamInfo, SubtitleType};

    use super::{reset_workspace_directory, subtitle_file_has_cues};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("spindle-{name}-{}-{nanos}", std::process::id()))
    }

    fn find_tool_on_path(name: &str) -> Option<OsString> {
        let path = std::env::var_os("PATH")?;
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate.into_os_string());
            }
        }
        None
    }

    #[test]
    fn reset_workspace_directory_removes_stale_contents() {
        let output_dir = unique_temp_dir("build-reset");
        let workspace_dir = output_dir.join("_spindle_work");
        let nested_dir = workspace_dir.join("menus");
        let stale_file = nested_dir.join("stale.txt");

        fs::create_dir_all(&nested_dir).unwrap();
        fs::write(&stale_file, "stale").unwrap();

        reset_workspace_directory(workspace_dir.to_str().unwrap()).unwrap();

        assert!(
            !workspace_dir.exists(),
            "expected workspace directory to be removed"
        );
        assert!(
            output_dir.exists(),
            "expected parent output directory to remain"
        );

        fs::remove_dir_all(&output_dir).unwrap();
    }

    #[test]
    fn subtitle_file_has_cues_rejects_empty_and_whitespace_only_files() {
        let output_dir = unique_temp_dir("subtitle-cues");
        fs::create_dir_all(&output_dir).unwrap();
        let empty_path = output_dir.join("empty.srt");
        let whitespace_path = output_dir.join("whitespace.srt");
        let populated_path = output_dir.join("populated.srt");

        fs::write(&empty_path, "").unwrap();
        fs::write(&whitespace_path, "\n  \t\n").unwrap();
        fs::write(
            &populated_path,
            "1\n00:00:00,000 --> 00:00:01,000\nHello.\n",
        )
        .unwrap();

        assert!(!subtitle_file_has_cues(empty_path.to_str().unwrap()).unwrap());
        assert!(!subtitle_file_has_cues(whitespace_path.to_str().unwrap()).unwrap());
        assert!(subtitle_file_has_cues(populated_path.to_str().unwrap()).unwrap());

        fs::remove_dir_all(&output_dir).unwrap();
    }

    #[test]
    fn execute_build_plan_skips_empty_text_subtitle_passes() {
        let output_dir = unique_temp_dir("empty-text-subtitle-pass");
        let working_dir = output_dir.join("_spindle_work");
        let input_path = working_dir.join("titles").join("title-1-base.mpg");
        let output_path = working_dir.join("titles").join("title-1.mpg");
        let subtitle_path = working_dir.join("subtitles").join("title-1_sub_2.srt");
        let xml_path = working_dir.join("subtitles").join("title-1_sub_2.xml");

        fs::create_dir_all(input_path.parent().unwrap()).unwrap();
        fs::create_dir_all(subtitle_path.parent().unwrap()).unwrap();
        fs::write(&input_path, b"stub-mpeg-data").unwrap();

        let plan = BuildPlan {
            jobs: vec![BuildJob::RenderTextSubtitles {
                title_id: "title-1".to_string(),
                title_name: "Title 1".to_string(),
                source_path: "/tmp/source.mkv".to_string(),
                source_stream_index: 2,
                input_path: input_path.display().to_string(),
                output_path: output_path.display().to_string(),
                subtitle_path: subtitle_path.display().to_string(),
                prepare_command: vec![
                    "python3".to_string(),
                    "-c".to_string(),
                    "from pathlib import Path; import sys; Path(sys.argv[-1]).write_text('')"
                        .to_string(),
                    subtitle_path.display().to_string(),
                ],
                spumux_xml: "<subpictures/>".to_string(),
                command: vec![
                    "/bin/sh".to_string(),
                    "-c".to_string(),
                    "exit 99".to_string(),
                    xml_path.display().to_string(),
                ],
                label: "Render subtitle \"English (forced)\" for \"Title 1\"".to_string(),
                render_mode: SubtitleRenderMode::TwoPass,
                font_family: "Noto Sans".to_string(),
            }],
            output_directory: output_dir.display().to_string(),
            working_directory: working_dir.display().to_string(),
            dvdauthor_xml: String::new(),
            summary: BuildSummary {
                total_jobs: 1,
                transcode_jobs: 0,
                titles_count: 1,
                menus_count: 0,
                generate_iso: false,
                estimated_commands: vec![],
            },
        };

        let mut progress_updates: Vec<BuildProgress> = Vec::new();
        let result = execute_build_plan(&plan, |progress| progress_updates.push(progress));

        assert!(result.success, "expected build to succeed: {result:?}");
        assert_eq!(
            fs::read(&output_path).unwrap(),
            fs::read(&input_path).unwrap(),
            "expected the prior title stage to carry forward unchanged"
        );
        assert!(
            !xml_path.exists(),
            "expected spumux XML not to be written when subtitle extraction is empty"
        );
        assert!(
            result
                .log_lines
                .iter()
                .any(|line| line.contains("had no cues")),
            "expected build log to explain the skipped subtitle pass"
        );
        assert!(
            progress_updates.iter().any(|progress| progress
                .output
                .as_ref()
                .is_some_and(|line| line.contains("had no cues"))),
            "expected progress updates to mention the skipped subtitle pass"
        );

        fs::remove_dir_all(&output_dir).unwrap();
    }

    #[test]
    #[ignore = "requires ffmpeg, spumux, and dvdauthor on PATH"]
    fn execute_build_plan_smoke_authors_titleset_menu_return_path() {
        let Some(ffmpeg_bin) = find_tool_on_path("ffmpeg") else {
            eprintln!("Skipping smoke test because `ffmpeg` is not available on PATH.");
            return;
        };
        if find_tool_on_path("spumux").is_none() || find_tool_on_path("dvdauthor").is_none() {
            eprintln!(
                "Skipping smoke test because `spumux` and/or `dvdauthor` are not available on PATH."
            );
            return;
        }

        let output_dir = unique_temp_dir("build-smoke");
        let source_path = output_dir.join("source.mp4");
        fs::create_dir_all(&output_dir).unwrap();

        let ffmpeg_status = Command::new(ffmpeg_bin)
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=640x360:d=1.5",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=48000:cl=stereo",
                "-shortest",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
            ])
            .arg(&source_path)
            .status()
            .expect("ffmpeg should launch for smoke test fixture generation");
        assert!(
            ffmpeg_status.success(),
            "ffmpeg fixture generation failed with status {ffmpeg_status}"
        );

        let mut project = test_project();
        project.assets[0].source_path = source_path.display().to_string();
        project.assets[0].file_name = "source.mp4".to_string();
        project.assets[0].duration_secs = Some(1.5);
        project.disc.first_play_action = Some(PlaybackAction::ShowMenu {
            menu_id: "menu-global".to_string(),
        });
        project.disc.global_menus.push(test_menu_with_action(
            "menu-global",
            "Main Menu",
            PlaybackAction::ShowMenu {
                menu_id: "menu-2".to_string(),
            },
        ));
        project.disc.titlesets[0].menus.push(test_menu_with_action(
            "menu-1",
            "Titleset Root",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        ));
        project.disc.titlesets[0].menus.push(test_menu_with_action(
            "menu-2",
            "Episode Menu",
            PlaybackAction::PlayTitle {
                title_id: "title-1".to_string(),
            },
        ));
        project.disc.titlesets[0].titles[0].chapters =
            vec![project.disc.titlesets[0].titles[0].chapters[0].clone()];
        project.disc.titlesets[0].titles[0].end_action = Some(PlaybackAction::ShowMenu {
            menu_id: "menu-2".to_string(),
        });

        let plan = generate_build_plan(&project, output_dir.to_str().unwrap(), true).unwrap();
        let result = execute_build_plan(&plan, |_| {});

        if !result.success {
            panic!(
                "expected smoke build to succeed\n{}",
                result.log_lines.join("\n")
            );
        }

        assert!(
            output_dir.join("VIDEO_TS/VIDEO_TS.IFO").exists(),
            "expected VIDEO_TS.IFO in authored output"
        );
        assert!(
            output_dir.join("VIDEO_TS/VTS_01_0.IFO").exists(),
            "expected first titleset IFO in authored output"
        );

        fs::remove_dir_all(&output_dir).unwrap();
    }

    #[test]
    #[ignore = "requires ffmpeg, ffprobe, spumux, and dvdauthor on PATH"]
    fn execute_build_plan_smoke_authors_text_subtitle_stream() {
        let Some(ffmpeg_bin) = find_tool_on_path("ffmpeg") else {
            eprintln!("Skipping smoke test because `ffmpeg` is not available on PATH.");
            return;
        };
        let Some(ffprobe_bin) = find_tool_on_path("ffprobe") else {
            eprintln!("Skipping smoke test because `ffprobe` is not available on PATH.");
            return;
        };
        if find_tool_on_path("spumux").is_none() || find_tool_on_path("dvdauthor").is_none() {
            eprintln!(
                "Skipping smoke test because `spumux` and/or `dvdauthor` are not available on PATH."
            );
            return;
        }

        let output_dir = unique_temp_dir("build-text-subtitle-smoke");
        let source_path = output_dir.join("source.mkv");
        let subtitle_path = output_dir.join("subtitle.srt");
        fs::create_dir_all(&output_dir).unwrap();
        fs::write(
            &subtitle_path,
            "1\n00:00:00,000 --> 00:00:01,000\nHello from text subtitles.\n",
        )
        .unwrap();

        let ffmpeg_status = Command::new(ffmpeg_bin)
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=640x360:d=1.5",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=48000:cl=stereo",
                "-i",
            ])
            .arg(&subtitle_path)
            .args([
                "-shortest",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-c:s",
                "srt",
            ])
            .arg(&source_path)
            .status()
            .expect("ffmpeg should launch for text subtitle smoke test fixture generation");
        assert!(
            ffmpeg_status.success(),
            "ffmpeg fixture generation failed with status {ffmpeg_status}"
        );

        let mut project = test_project();
        project.assets[0].source_path = source_path.display().to_string();
        project.assets[0].file_name = "source.mkv".to_string();
        project.assets[0].duration_secs = Some(1.5);
        project.assets[0].subtitle_streams = vec![SubtitleStreamInfo {
            index: 2,
            codec: "subrip".to_string(),
            language: Some("eng".to_string()),
            subtitle_type: SubtitleType::Text,
            title: Some("English".to_string()),
        }];
        project.disc.titlesets[0].titles[0].subtitle_mappings.push(
            crate::models::SubtitleTrackMapping {
                id: "sm-text".to_string(),
                source_stream_index: 2,
                label: "English".to_string(),
                language: "eng".to_string(),
                order_index: 0,
                is_default: false,
                is_forced: false,
            },
        );

        let plan = generate_build_plan(&project, output_dir.to_str().unwrap(), true).unwrap();
        let result = execute_build_plan(&plan, |_| {});

        if !result.success {
            panic!(
                "expected text subtitle smoke build to succeed\n{}",
                result.log_lines.join("\n")
            );
        }

        let authored_title_path = PathBuf::from(&plan.working_directory)
            .join("titles")
            .join("title-1.mpg");
        assert!(
            authored_title_path.exists(),
            "expected authored title MPEG at {}",
            authored_title_path.display()
        );

        let ffprobe_output = Command::new(ffprobe_bin)
            .args([
                "-v",
                "error",
                "-select_streams",
                "s",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "csv=p=0",
            ])
            .arg(&authored_title_path)
            .output()
            .expect("ffprobe should inspect authored title MPEG");
        assert!(
            ffprobe_output.status.success(),
            "ffprobe failed with status {}",
            ffprobe_output.status
        );
        let subtitle_codecs = String::from_utf8_lossy(&ffprobe_output.stdout);
        assert!(
            subtitle_codecs.lines().any(|line| line.trim() == "dvd_subtitle"),
            "expected authored title MPEG to include a dvd_subtitle stream, got:\n{subtitle_codecs}"
        );

        fs::remove_dir_all(&output_dir).unwrap();
    }
}
