// Build plan generation and DVD-Video authoring pipeline.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};

use crate::models::*;

/// Global cancellation flag for the current build.
/// Set to `true` to request cancellation; reset before each build.
static BUILD_CANCELLED: AtomicBool = AtomicBool::new(false);

/// Request cancellation of the running build.
pub fn cancel_build() {
    BUILD_CANCELLED.store(true, Ordering::SeqCst);
}

/// Check whether a cancellation has been requested.
fn is_cancelled() -> bool {
    BUILD_CANCELLED.load(Ordering::SeqCst)
}

// ── Build Plan ──────────────────────────────────────────────────────────────

/// A complete build plan for authoring a DVD-Video disc.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildPlan {
    pub jobs: Vec<BuildJob>,
    pub output_directory: String,
    pub working_directory: String,
    pub dvdauthor_xml: String,
    pub summary: BuildSummary,
}

/// Summary statistics for the build plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSummary {
    pub total_jobs: usize,
    pub transcode_jobs: usize,
    pub titles_count: usize,
    pub menus_count: usize,
    pub generate_iso: bool,
    pub estimated_commands: Vec<String>,
}

/// A single step in the build pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum BuildJob {
    /// Create the working directory structure.
    PrepareWorkspace { directories: Vec<String> },
    /// Transcode a title's video and audio to DVD-compliant MPEG-2 PS.
    TranscodeTitle {
        title_id: String,
        title_name: String,
        source_path: String,
        output_path: String,
        command: Vec<String>,
        label: String,
    },
    /// Render a menu background to MPEG-2 still frame.
    RenderMenu {
        menu_id: String,
        menu_name: String,
        output_path: String,
        command: Vec<String>,
        label: String,
    },
    /// Generate spumux XML and overlay subtitles/highlights on a menu.
    ComposeMenuHighlights {
        menu_id: String,
        menu_name: String,
        input_path: String,
        output_path: String,
        spumux_xml: String,
        command: Vec<String>,
        label: String,
    },
    /// Run dvdauthor to create the VIDEO_TS structure.
    AuthorDvd {
        xml_path: String,
        output_path: String,
        command: Vec<String>,
        label: String,
    },
    /// Generate an ISO image from VIDEO_TS.
    CreateIso {
        source_path: String,
        output_path: String,
        command: Vec<String>,
        label: String,
    },
}

impl BuildJob {
    pub fn label(&self) -> &str {
        match self {
            BuildJob::PrepareWorkspace { .. } => "Prepare workspace",
            BuildJob::TranscodeTitle { label, .. }
            | BuildJob::RenderMenu { label, .. }
            | BuildJob::ComposeMenuHighlights { label, .. }
            | BuildJob::AuthorDvd { label, .. }
            | BuildJob::CreateIso { label, .. } => label,
        }
    }

    pub fn command(&self) -> Option<&[String]> {
        match self {
            BuildJob::PrepareWorkspace { .. } => None,
            BuildJob::TranscodeTitle { command, .. }
            | BuildJob::RenderMenu { command, .. }
            | BuildJob::ComposeMenuHighlights { command, .. }
            | BuildJob::AuthorDvd { command, .. }
            | BuildJob::CreateIso { command, .. } => Some(command),
        }
    }
}

// ── Build Progress ──────────────────────────────────────────────────────────

/// Progress event emitted during build execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildProgress {
    pub job_index: usize,
    pub total_jobs: usize,
    pub current_label: String,
    pub status: BuildJobStatus,
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BuildJobStatus {
    Starting,
    Running,
    Complete,
    Failed,
}

// ── Build Result ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub success: bool,
    pub output_directory: String,
    pub iso_path: Option<String>,
    pub log_lines: Vec<String>,
    pub failed_job_index: Option<usize>,
    pub error_message: Option<String>,
}

// ── Plan Generation ─────────────────────────────────────────────────────────

/// Generate a build plan from a project. Does not execute anything.
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

    // 1. Prepare workspace directories
    jobs.push(BuildJob::PrepareWorkspace {
        directories: vec![
            work_dir.display().to_string(),
            titles_dir.display().to_string(),
            menus_dir.display().to_string(),
            video_ts_dir.display().to_string(),
        ],
    });

    // Build asset lookup
    let assets: HashMap<&str, &Asset> = project.assets.iter().map(|a| (a.id.as_str(), a)).collect();

    // 2. Transcode each title
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

        let command = build_ffmpeg_transcode_command(
            &asset.source_path,
            &output_path,
            title,
            &project.disc,
            video_info,
        );

        jobs.push(BuildJob::TranscodeTitle {
            title_id: title.id.clone(),
            title_name: title.name.clone(),
            source_path: asset.source_path.clone(),
            output_path: output_path.display().to_string(),
            command,
            label: format!("Transcode \"{}\"", title.name),
        });
    }

    // 3. Generate dvdauthor XML
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

    // 4. Optionally create ISO
    if project.build_settings.generate_iso {
        let iso_path = output_dir.join(format!("{}.iso", sanitise_filename(&project.project.name)));
        let volume_id = project
            .project
            .name
            .chars()
            .take(32)
            .collect::<String>()
            .to_uppercase();

        // Prefer genisoimage sidecar, fall back to mkisofs, then bare name.
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

    // Build summary
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

// ── FFmpeg Command Generation ───────────────────────────────────────────────

fn build_ffmpeg_transcode_command(
    source_path: &str,
    output_path: &Path,
    title: &Title,
    disc: &Disc,
    video_info: Option<&VideoStreamInfo>,
) -> Vec<String> {
    let mut cmd = vec!["ffmpeg".to_string(), "-y".to_string()];

    // Input
    cmd.extend(["-i".to_string(), source_path.to_string()]);

    // Video stream mapping
    if let Some(ref vm) = title.video_mapping {
        cmd.extend(["-map".to_string(), format!("0:{}", vm.source_stream_index)]);
    }

    let profile = title.video_output_profile.unwrap_or(VideoOutputProfile {
        raster: VideoRaster::FullD1,
        aspect: AspectMode::SixteenByNine,
    });
    let (width, height) = profile.raster.resolution(disc.standard);

    // Determine output frame rate (preserve 23.976 for NTSC; otherwise use disc standard)
    let source_fps = video_info.and_then(|v| v.frame_rate);
    let output_fps = choose_output_fps(source_fps, disc.standard);

    // Build video filter chain
    let mut vf_parts: Vec<String> = Vec::new();

    // HDR → SDR tonemapping when source uses PQ (HDR10) or HLG transfer
    if video_info.map_or(false, is_hdr_source) {
        vf_parts.push(
            "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,\
             tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
                .to_string(),
        );
    }

    // Scale preserving aspect ratio, pad to exact DVD raster, reset SAR
    vf_parts.push(format!(
        "scale={width}:{height}:force_original_aspect_ratio=decrease,\
         pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1"
    ));

    // FPS conversion only when source differs from target by more than 0.1 fps
    if source_fps.map_or(false, |fps| (fps - output_fps).abs() > 0.1) {
        vf_parts.push(format!("fps={}", fps_rational_str(output_fps)));
    }

    cmd.extend(["-vf".to_string(), vf_parts.join(",")]);

    // Video codec: always MPEG-2 for DVD
    cmd.extend([
        "-c:v".to_string(),
        "mpeg2video".to_string(),
        "-r".to_string(),
        fps_rational_str(output_fps).to_string(),
        "-b:v".to_string(),
        "6000k".to_string(),
        "-maxrate".to_string(),
        "9000k".to_string(),
        "-bufsize".to_string(),
        "1835k".to_string(),
        "-g".to_string(),
        if disc.standard == VideoStandard::Pal {
            "12"
        } else {
            "18"
        }
        .to_string(),
    ]);

    // Aspect ratio signalling flag (tells player how to display the anamorphic raster)
    match profile.aspect {
        AspectMode::FourByThree => cmd.extend(["-aspect".to_string(), "4:3".to_string()]),
        AspectMode::SixteenByNine => cmd.extend(["-aspect".to_string(), "16:9".to_string()]),
    }

    // Audio mapping and encoding
    for (i, am) in title.audio_mappings.iter().enumerate() {
        cmd.extend(["-map".to_string(), format!("0:{}", am.source_stream_index)]);

        match am.copy_mode {
            CopyMode::Copy => {
                cmd.extend([format!("-c:a:{i}"), "copy".to_string()]);
            }
            CopyMode::ReEncode => match am.output_target {
                AudioOutputTarget::Ac3 => {
                    cmd.extend([
                        format!("-c:a:{i}"),
                        "ac3".to_string(),
                        format!("-b:a:{i}"),
                        "448k".to_string(),
                        format!("-ar:a:{i}"),
                        "48000".to_string(),
                    ]);
                }
                AudioOutputTarget::Mp2 => {
                    cmd.extend([
                        format!("-c:a:{i}"),
                        "mp2".to_string(),
                        format!("-b:a:{i}"),
                        "384k".to_string(),
                        format!("-ar:a:{i}"),
                        "48000".to_string(),
                    ]);
                }
                AudioOutputTarget::Lpcm => {
                    cmd.extend([
                        format!("-c:a:{i}"),
                        "pcm_s16be".to_string(),
                        format!("-ar:a:{i}"),
                        "48000".to_string(),
                    ]);
                }
                AudioOutputTarget::Dts => {
                    cmd.extend([
                        format!("-c:a:{i}"),
                        "dts".to_string(),
                        format!("-b:a:{i}"),
                        "768k".to_string(),
                        format!("-ar:a:{i}"),
                        "48000".to_string(),
                    ]);
                }
            },
        }
    }

    // If no audio mappings, add silent audio (dvdauthor requires audio)
    if title.audio_mappings.is_empty() {
        cmd.extend([
            "-f".to_string(),
            "lavfi".to_string(),
            "-i".to_string(),
            "anullsrc=r=48000:cl=stereo".to_string(),
            "-map".to_string(),
            "1:a".to_string(),
            "-shortest".to_string(),
            "-c:a".to_string(),
            "ac3".to_string(),
            "-b:a".to_string(),
            "192k".to_string(),
        ]);
    }

    // Output format
    cmd.extend([
        "-f".to_string(),
        "dvd".to_string(),
        "-muxrate".to_string(),
        "10080000".to_string(),
        output_path.display().to_string(),
    ]);

    cmd
}

// ── FFmpeg helpers ───────────────────────────────────────────────────────────

/// Choose the output frame rate for DVD encoding.
///
/// For NTSC, 23.976 fps source is preserved as-is (legal on DVD and avoids
/// 3:2 pulldown artefacts). All other NTSC sources target 29.97. PAL is always 25.
fn choose_output_fps(source_fps: Option<f64>, standard: VideoStandard) -> f64 {
    match standard {
        VideoStandard::Pal => 25.0,
        VideoStandard::Ntsc => {
            if source_fps.map_or(false, |fps| (fps - 24_000.0 / 1_001.0).abs() < 0.1) {
                24_000.0 / 1_001.0 // ≈23.976 — keep film cadence
            } else {
                30_000.0 / 1_001.0 // ≈29.97 — NTSC standard
            }
        }
    }
}

/// Return an ffmpeg-compatible rational string for a frame rate value.
fn fps_rational_str(fps: f64) -> &'static str {
    if (fps - 24_000.0 / 1_001.0).abs() < 0.001 {
        "24000/1001"
    } else if (fps - 30_000.0 / 1_001.0).abs() < 0.001 {
        "30000/1001"
    } else if (fps - 25.0).abs() < 0.001 {
        "25"
    } else {
        "30000/1001"
    }
}

/// Return true when the video stream uses an HDR transfer characteristic.
fn is_hdr_source(info: &VideoStreamInfo) -> bool {
    matches!(
        info.color_transfer.as_deref(),
        Some("smpte2084" | "arib-std-b67" | "smpte428")
    )
}

// ── dvdauthor XML Generation ────────────────────────────────────────────────

fn generate_dvdauthor_xml(
    project: &SpindleProjectFile,
    titles_dir: &Path,
    _menus_dir: &Path,
    video_ts_dir: &Path,
) -> crate::Result<String> {
    let format_str = match project.disc.standard {
        VideoStandard::Ntsc => "ntsc",
        VideoStandard::Pal => "pal",
    };

    let mut xml = String::new();

    xml.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    xml.push_str(&format!(
        "<dvdauthor dest=\"{}\">\n",
        xml_escape(&video_ts_dir.display().to_string())
    ));

    // VMGM (Video Manager) — global menus
    let has_global_menus = !project.disc.global_menus.is_empty();
    let has_first_play = project.disc.first_play_action.is_some();

    if has_global_menus || has_first_play {
        xml.push_str("  <vmgm>\n");

        if has_global_menus {
            xml.push_str("    <menus>\n");
            xml.push_str(&format!(
                "      <video format=\"{format_str}\" aspect=\"4:3\" />\n"
            ));
            for _menu in &project.disc.global_menus {
                xml.push_str("      <pgc>\n");
                // Menu VOB would go here once menu rendering is implemented
                xml.push_str("      </pgc>\n");
            }
            xml.push_str("    </menus>\n");
        }

        // First play PGC
        if let Some(ref action) = project.disc.first_play_action {
            xml.push_str("    <fpc>\n");
            xml.push_str(&format!(
                "      {};\n",
                playback_action_to_dvd_command(action, &project.disc)
            ));
            xml.push_str("    </fpc>\n");
        }

        xml.push_str("  </vmgm>\n");
    }

    // Titlesets
    for titleset in &project.disc.titlesets {
        xml.push_str("  <titleset>\n");

        // Determine aspect ratio from first title with an output profile
        let aspect_str = titleset
            .titles
            .iter()
            .find_map(|t| t.video_output_profile)
            .map(|p| match p.aspect {
                AspectMode::FourByThree => "4:3",
                AspectMode::SixteenByNine => "16:9",
            })
            .unwrap_or("16:9");

        // Titleset menus
        if !titleset.menus.is_empty() {
            xml.push_str("    <menus>\n");
            xml.push_str(&format!(
                "      <video format=\"{format_str}\" aspect=\"{aspect_str}\" />\n"
            ));
            for _menu in &titleset.menus {
                xml.push_str("      <pgc>\n");
                // Menu VOB would go here once menu rendering is implemented
                xml.push_str("      </pgc>\n");
            }
            xml.push_str("    </menus>\n");
        }

        // Titles
        xml.push_str("    <titles>\n");
        xml.push_str(&format!(
            "      <video format=\"{format_str}\" aspect=\"{aspect_str}\" />\n"
        ));
        for title in &titleset.titles {
            xml.push_str("      <pgc>\n");

            let vob_path = titles_dir.join(format!("{}.mpg", sanitise_filename(&title.id)));
            let mut vob_attrs = format!(
                "        <vob file=\"{}\"",
                xml_escape(&vob_path.display().to_string())
            );

            // Add chapter points
            if !title.chapters.is_empty() {
                let chapter_str: String = title
                    .chapters
                    .iter()
                    .map(|ch| format_dvd_timestamp(ch.timestamp_secs))
                    .collect::<Vec<_>>()
                    .join(",");
                vob_attrs.push_str(&format!(" chapters=\"{chapter_str}\""));
            }

            vob_attrs.push_str(" />\n");
            xml.push_str(&vob_attrs);

            // Post command (end action)
            if let Some(ref action) = title.end_action {
                xml.push_str("        <post>\n");
                xml.push_str(&format!(
                    "          {};\n",
                    playback_action_to_dvd_command(action, &project.disc)
                ));
                xml.push_str("        </post>\n");
            }

            xml.push_str("      </pgc>\n");
        }
        xml.push_str("    </titles>\n");

        xml.push_str("  </titleset>\n");
    }

    xml.push_str("</dvdauthor>\n");

    Ok(xml)
}

fn playback_action_to_dvd_command(action: &PlaybackAction, disc: &Disc) -> String {
    match action {
        PlaybackAction::PlayTitle { title_id } => {
            // Resolve title ID to 1-based dvdauthor index across all titlesets
            let title_index = disc
                .titlesets
                .iter()
                .flat_map(|ts| ts.titles.iter())
                .position(|t| t.id == *title_id)
                .map(|i| i + 1)
                .unwrap_or(1);
            format!("jump title {title_index}")
        }
        PlaybackAction::PlayChapter {
            title_id,
            chapter_id,
        } => {
            let title_index = disc
                .titlesets
                .iter()
                .flat_map(|ts| ts.titles.iter())
                .position(|t| t.id == *title_id)
                .map(|i| i + 1)
                .unwrap_or(1);
            // Resolve chapter ID to 1-based index within the title
            let chapter_index = disc
                .titlesets
                .iter()
                .flat_map(|ts| ts.titles.iter())
                .find(|t| t.id == *title_id)
                .and_then(|t| t.chapters.iter().position(|c| c.id == *chapter_id))
                .map(|i| i + 1)
                .unwrap_or(1);
            format!("jump title {title_index} chapter {chapter_index}")
        }
        PlaybackAction::ShowMenu { menu_id: _ } => "call vmgm menu".to_string(),
        PlaybackAction::Stop => "exit".to_string(),
    }
}

fn format_dvd_timestamp(seconds: f64) -> String {
    let total_secs = seconds as u64;
    let h = total_secs / 3600;
    let m = (total_secs % 3600) / 60;
    let s = total_secs % 60;
    let f = ((seconds - seconds.floor()) * 30.0) as u64; // approximate frame
    format!("{h}:{m:02}:{s:02}.{f}")
}

// ── Build Execution ─────────────────────────────────────────────────────────

/// Execute a build plan, emitting progress events via the callback.
pub fn execute_build_plan<F>(plan: &BuildPlan, mut on_progress: F) -> BuildResult
where
    F: FnMut(BuildProgress),
{
    // Reset cancellation flag at the start of each build
    BUILD_CANCELLED.store(false, Ordering::SeqCst);

    let total = plan.jobs.len();
    let mut log_lines = Vec::new();

    for (i, job) in plan.jobs.iter().enumerate() {
        // Check for cancellation before each job
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
                        return BuildResult {
                            success: false,
                            output_directory: plan.output_directory.clone(),
                            iso_path: None,
                            log_lines,
                            failed_job_index: Some(i),
                            error_message: Some(msg),
                        };
                    }
                }
                log_lines.push("  Workspace directories created.".to_string());
            }
            BuildJob::AuthorDvd {
                xml_path, command, ..
            } => {
                // Write the dvdauthor XML file first
                if let Err(e) = std::fs::write(xml_path, &plan.dvdauthor_xml) {
                    let msg = format!("Failed to write dvdauthor XML: {e}");
                    log_lines.push(msg.clone());
                    return BuildResult {
                        success: false,
                        output_directory: plan.output_directory.clone(),
                        iso_path: None,
                        log_lines,
                        failed_job_index: Some(i),
                        error_message: Some(msg),
                    };
                }
                log_lines.push(format!("  Wrote {xml_path}"));

                match run_command(command) {
                    Ok(output) => {
                        log_lines.push(output);
                    }
                    Err(msg) => {
                        log_lines.push(msg.clone());
                        return BuildResult {
                            success: false,
                            output_directory: plan.output_directory.clone(),
                            iso_path: None,
                            log_lines,
                            failed_job_index: Some(i),
                            error_message: Some(msg),
                        };
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
                            return BuildResult {
                                success: false,
                                output_directory: plan.output_directory.clone(),
                                iso_path: None,
                                log_lines,
                                failed_job_index: Some(i),
                                error_message: Some(msg),
                            };
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

    // Determine ISO path if generated
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

fn run_command(args: &[String]) -> std::result::Result<String, String> {
    if args.is_empty() {
        return Err("Empty command".to_string());
    }

    let output = std::process::Command::new(&args[0])
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

// ── Helpers ─────────────────────────────────────────────────────────────────

fn sanitise_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

// ── Menu Navigation Auto-Generation ─────────────────────────────────────────

/// Auto-generate directional navigation links for menu buttons based on geometry.
///
/// For each button, finds the nearest neighbour in each direction (up, down, left, right)
/// using centre-point distance, filtered by angle.
pub fn auto_generate_navigation(menu: &mut Menu) {
    let centres: Vec<(f64, f64)> = menu
        .buttons
        .iter()
        .map(|b| {
            (
                b.bounds.x + b.bounds.width / 2.0,
                b.bounds.y + b.bounds.height / 2.0,
            )
        })
        .collect();

    let n = menu.buttons.len();
    if n < 2 {
        return;
    }

    // For each button, find nearest neighbour in each cardinal direction
    for i in 0..n {
        let (cx, cy) = centres[i];
        let mut best_up: Option<(usize, f64)> = None;
        let mut best_down: Option<(usize, f64)> = None;
        let mut best_left: Option<(usize, f64)> = None;
        let mut best_right: Option<(usize, f64)> = None;

        for (j, &(ox, oy)) in centres.iter().enumerate() {
            if i == j {
                continue;
            }
            let dx = ox - cx;
            let dy = oy - cy;
            let dist = (dx * dx + dy * dy).sqrt();

            // Up: other button is above (dy < 0) and primarily vertical
            if dy < 0.0
                && dy.abs() >= dx.abs() * 0.5
                && (best_up.is_none() || dist < best_up.unwrap().1)
            {
                best_up = Some((j, dist));
            }
            // Down: other button is below (dy > 0)
            if dy > 0.0
                && dy.abs() >= dx.abs() * 0.5
                && (best_down.is_none() || dist < best_down.unwrap().1)
            {
                best_down = Some((j, dist));
            }
            // Left: other button is to the left (dx < 0)
            if dx < 0.0
                && dx.abs() >= dy.abs() * 0.5
                && (best_left.is_none() || dist < best_left.unwrap().1)
            {
                best_left = Some((j, dist));
            }
            // Right: other button is to the right (dx > 0)
            if dx > 0.0
                && dx.abs() >= dy.abs() * 0.5
                && (best_right.is_none() || dist < best_right.unwrap().1)
            {
                best_right = Some((j, dist));
            }
        }

        // Collect IDs before mutating
        let up_id = best_up.map(|(j, _)| menu.buttons[j].id.clone());
        let down_id = best_down.map(|(j, _)| menu.buttons[j].id.clone());
        let left_id = best_left.map(|(j, _)| menu.buttons[j].id.clone());
        let right_id = best_right.map(|(j, _)| menu.buttons[j].id.clone());

        menu.buttons[i].nav_up = up_id;
        menu.buttons[i].nav_down = down_id;
        menu.buttons[i].nav_left = left_id;
        menu.buttons[i].nav_right = right_id;
    }

    // Set default button if not already set
    if menu.default_button_id.is_none() && !menu.buttons.is_empty() {
        menu.default_button_id = Some(menu.buttons[0].id.clone());
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn test_project() -> SpindleProjectFile {
        let mut project = SpindleProjectFile::default();
        project.project.name = "Test DVD".to_string();

        let asset = Asset {
            id: "asset-1".to_string(),
            file_name: "test.mp4".to_string(),
            source_path: "/tmp/test.mp4".to_string(),
            file_size_bytes: Some(1_000_000_000),
            duration_secs: Some(3600.0),
            container_format: Some("mp4".to_string()),
            video_streams: vec![VideoStreamInfo {
                index: 0,
                codec: "h264".to_string(),
                width: 1920,
                height: 1080,
                frame_rate: Some(29.97),
                aspect_ratio: Some("16:9".to_string()),
                scan_type: None,
                bitrate_bps: None,
                color_transfer: None,
                color_primaries: None,
            }],
            audio_streams: vec![AudioStreamInfo {
                index: 1,
                codec: "aac".to_string(),
                channels: 2,
                sample_rate: 48000,
                language: Some("eng".to_string()),
                bitrate_bps: None,
            }],
            subtitle_streams: vec![],
            compatibility: Some(CompatibilityAssessment::ReEncodeRequired),
            fingerprint: None,
            thumbnail_path: None,
        };

        let title = Title {
            id: "title-1".to_string(),
            name: "Main Feature".to_string(),
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
                id: "am-1".to_string(),
                source_stream_index: 1,
                output_target: AudioOutputTarget::Ac3,
                copy_mode: CopyMode::ReEncode,
                label: "English".to_string(),
                language: "eng".to_string(),
                order_index: 0,
                is_default: true,
            }],
            subtitle_mappings: vec![],
            chapters: vec![
                ChapterPoint {
                    id: "ch-1".to_string(),
                    name: "Chapter 1".to_string(),
                    timestamp_secs: 0.0,
                    order_index: 0,
                },
                ChapterPoint {
                    id: "ch-2".to_string(),
                    name: "Chapter 2".to_string(),
                    timestamp_secs: 300.0,
                    order_index: 1,
                },
            ],
            end_action: Some(PlaybackAction::Stop),
            order_index: 0,
        };

        project.disc.titlesets[0].titles.push(title);
        project.assets.push(asset);
        project.build_settings.output_directory = Some("/tmp/dvd_output".to_string());

        project
    }

    #[test]
    fn build_plan_generates_correct_job_count() {
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        // PrepareWorkspace + TranscodeTitle + AuthorDvd = 3
        assert_eq!(plan.jobs.len(), 3);
        assert_eq!(plan.summary.transcode_jobs, 1);
        assert_eq!(plan.summary.titles_count, 1);
    }

    #[test]
    fn build_plan_includes_iso_when_enabled() {
        let mut project = test_project();
        project.build_settings.generate_iso = true;

        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        // PrepareWorkspace + TranscodeTitle + AuthorDvd + CreateIso = 4
        assert_eq!(plan.jobs.len(), 4);
        assert!(plan.summary.generate_iso);
    }

    #[test]
    fn dvdauthor_xml_contains_chapters() {
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan.dvdauthor_xml.contains("chapters="));
        assert!(plan.dvdauthor_xml.contains("0:00:00.0"));
        assert!(plan.dvdauthor_xml.contains("0:05:00.0"));
    }

    #[test]
    fn dvdauthor_xml_contains_end_action() {
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        assert!(plan.dvdauthor_xml.contains("exit"));
    }

    #[test]
    fn dvdauthor_xml_contains_video_format() {
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        // dvdauthor 0.7.x requires an explicit <video format="ntsc/pal"/> in <titles>
        assert!(
            plan.dvdauthor_xml.contains("format=\"ntsc\""),
            "dvdauthor XML must declare video format\n{}",
            plan.dvdauthor_xml
        );
        assert!(
            plan.dvdauthor_xml.contains("aspect=\"16:9\""),
            "dvdauthor XML must declare aspect ratio\n{}",
            plan.dvdauthor_xml
        );
    }

    #[test]
    fn ffmpeg_vf_has_scale_and_pad() {
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        let transcode = plan
            .jobs
            .iter()
            .find(|j| matches!(j, BuildJob::TranscodeTitle { .. }))
            .unwrap();
        let cmd = transcode.command().unwrap();

        // -vf flag present
        assert!(cmd.contains(&"-vf".to_string()), "expected -vf flag");
        // scale+pad in the filter
        let vf_val = cmd
            .iter()
            .skip_while(|a| *a != "-vf")
            .nth(1)
            .expect("-vf value");
        assert!(vf_val.contains("scale="), "expected scale= in vf filter");
        assert!(vf_val.contains("pad="), "expected pad= in vf filter");
        assert!(vf_val.contains("setsar=1"), "expected setsar=1 in vf filter");
    }

    #[test]
    fn ffmpeg_preserves_23976_fps_for_ntsc() {
        let mut project = test_project();
        // Set source frame rate to 23.976
        project.assets[0].video_streams[0].frame_rate = Some(24_000.0 / 1_001.0);
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        let transcode = plan
            .jobs
            .iter()
            .find(|j| matches!(j, BuildJob::TranscodeTitle { .. }))
            .unwrap();
        let cmd = transcode.command().unwrap();

        let r_arg = cmd
            .iter()
            .skip_while(|a| *a != "-r")
            .nth(1)
            .expect("-r value");
        assert_eq!(r_arg, "24000/1001", "23.976 fps source should be preserved");
    }

    #[test]
    fn ffmpeg_command_has_mpeg2_codec() {
        let project = test_project();
        let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

        let transcode = plan
            .jobs
            .iter()
            .find(|j| matches!(j, BuildJob::TranscodeTitle { .. }));
        assert!(transcode.is_some());

        let cmd = transcode.unwrap().command().unwrap();
        assert!(cmd.contains(&"mpeg2video".to_string()));
        // Resolution is now in the vf filter rather than a bare -s flag
        let vf_arg = cmd.iter().find(|a| a.starts_with("scale=720:480:"));
        assert!(vf_arg.is_some(), "expected scale=720:480 in -vf filter");
    }

    #[test]
    fn auto_navigation_vertical_buttons() {
        let mut menu = Menu {
            id: "m1".to_string(),
            name: "Test".to_string(),
            background_asset_id: None,
            buttons: vec![
                MenuButton {
                    id: "b1".to_string(),
                    label: "Top".to_string(),
                    bounds: ButtonBounds {
                        x: 260.0,
                        y: 100.0,
                        width: 200.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
                MenuButton {
                    id: "b2".to_string(),
                    label: "Bottom".to_string(),
                    bounds: ButtonBounds {
                        x: 260.0,
                        y: 200.0,
                        width: 200.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
            ],
            default_button_id: None,
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::default(),
            motion_duration_secs: None,
            motion_audio_asset_id: None,
            motion_loop_count: 0,
            timeout_action: None,
        };

        auto_generate_navigation(&mut menu);

        assert_eq!(menu.buttons[0].nav_down.as_deref(), Some("b2"));
        assert_eq!(menu.buttons[1].nav_up.as_deref(), Some("b1"));
        assert_eq!(menu.default_button_id.as_deref(), Some("b1"));
    }

    #[test]
    fn auto_navigation_grid_buttons() {
        let mut menu = Menu {
            id: "m1".to_string(),
            name: "Grid".to_string(),
            background_asset_id: None,
            buttons: vec![
                MenuButton {
                    id: "tl".to_string(),
                    label: "Top Left".to_string(),
                    bounds: ButtonBounds {
                        x: 100.0,
                        y: 100.0,
                        width: 150.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
                MenuButton {
                    id: "tr".to_string(),
                    label: "Top Right".to_string(),
                    bounds: ButtonBounds {
                        x: 400.0,
                        y: 100.0,
                        width: 150.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
                MenuButton {
                    id: "bl".to_string(),
                    label: "Bottom Left".to_string(),
                    bounds: ButtonBounds {
                        x: 100.0,
                        y: 300.0,
                        width: 150.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
                MenuButton {
                    id: "br".to_string(),
                    label: "Bottom Right".to_string(),
                    bounds: ButtonBounds {
                        x: 400.0,
                        y: 300.0,
                        width: 150.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
            ],
            default_button_id: None,
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::default(),
            motion_duration_secs: None,
            motion_audio_asset_id: None,
            motion_loop_count: 0,
            timeout_action: None,
        };

        auto_generate_navigation(&mut menu);

        // Top-left should have right=tr, down=bl
        assert_eq!(menu.buttons[0].nav_right.as_deref(), Some("tr"));
        assert_eq!(menu.buttons[0].nav_down.as_deref(), Some("bl"));
        // Bottom-right should have left=bl, up=tr
        assert_eq!(menu.buttons[3].nav_left.as_deref(), Some("bl"));
        assert_eq!(menu.buttons[3].nav_up.as_deref(), Some("tr"));
    }

    #[test]
    fn sanitise_filename_strips_special_chars() {
        assert_eq!(sanitise_filename("hello world!"), "hello_world_");
        assert_eq!(sanitise_filename("test-file_1"), "test-file_1");
    }

    #[test]
    fn xml_escape_handles_special_chars() {
        assert_eq!(
            xml_escape("a&b<c>d\"e'f"),
            "a&amp;b&lt;c&gt;d&quot;e&apos;f"
        );
    }

    #[test]
    fn format_dvd_timestamp_correct() {
        assert_eq!(format_dvd_timestamp(0.0), "0:00:00.0");
        assert_eq!(format_dvd_timestamp(300.0), "0:05:00.0");
        assert_eq!(format_dvd_timestamp(3661.5), "1:01:01.15");
    }
}
