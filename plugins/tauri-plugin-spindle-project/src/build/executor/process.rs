// Subprocess execution primitives: ffmpeg (with streaming progress and
// cancellation), generic command runner, and spumux's stdin/stdout redirect
// runner.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::io::BufRead;
use std::process::{Command, Stdio};
use std::time::Instant;

use super::super::ffmpeg_progress;
use super::super::types::{BuildJobStatus, BuildProgress};
use super::{is_cancelled, PROGRESS_THROTTLE_MS};

/// Run an FFmpeg command with streaming stderr, step-progress reporting,
/// and cancellation support.
///
/// Adds `-progress pipe:2` so FFmpeg emits structured key-value progress
/// lines on stderr alongside its normal log output. The stderr reader
/// loop parses `out_time=` lines, estimates a percentage from
/// `duration_secs`, and emits throttled step-progress events.
pub(super) fn run_ffmpeg_command<F>(
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
    let job_start = Instant::now();
    let mut last_emit = Instant::now();
    let mut last_speed: Option<f64> = None;
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

        // `speed=` lines arrive separately from `out_time=` lines within the
        // same `-progress` block; remember the latest value so it's available
        // when the next `out_time=` line triggers an emit below.
        if let Some(speed_val) = ffmpeg_progress::extract_progress_value(line, "speed") {
            last_speed = ffmpeg_progress::parse_speed(speed_val);
        }

        // Try to extract progress from `-progress pipe:2` output.
        if let Some(time_val) = ffmpeg_progress::extract_progress_value(line, "out_time") {
            if let Some(elapsed) = ffmpeg_progress::parse_out_time_secs(time_val) {
                let pct = ffmpeg_progress::step_percent(elapsed, duration_secs);
                let eta = last_speed
                    .and_then(|speed| ffmpeg_progress::eta_secs(elapsed, duration_secs, speed));

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
                        step_detail: None,
                        step_status: Some(BuildJobStatus::Running),
                        elapsed_secs: Some(job_start.elapsed().as_secs_f64()),
                        eta_secs: eta,
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

pub(super) fn run_command(args: &[String]) -> std::result::Result<String, String> {
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

pub(super) fn run_spumux_command(
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
