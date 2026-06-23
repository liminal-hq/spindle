// Tests for build plan execution and subprocess orchestration.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

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
        output_dir.join("DVD_DISC/VIDEO_TS/VIDEO_TS.IFO").exists(),
        "expected VIDEO_TS.IFO in authored output"
    );
    assert!(
        output_dir.join("DVD_DISC/VIDEO_TS/VTS_01_0.IFO").exists(),
        "expected first titleset IFO in authored output"
    );

    fs::remove_dir_all(&output_dir).unwrap();
}

#[test]
#[ignore = "requires ffmpeg, spumux, and dvdauthor on PATH"]
fn execute_build_plan_smoke_authors_disc_with_first_play_but_no_global_menus() {
    // Regression test for a disc whose VMGM has a first-play action but no
    // global menus of its own (all real menus, if any, live at the titleset
    // level) — the exact shape that previously made the real `dvdauthor`
    // binary fail at the final table-of-contents step with
    // "no video format specified for VMGM", even though the generated XML
    // looked fine to the fast in-process unit tests.
    let Some(ffmpeg_bin) = find_tool_on_path("ffmpeg") else {
        eprintln!("Skipping smoke test because `ffmpeg` is not available on PATH.");
        return;
    };
    if find_tool_on_path("dvdauthor").is_none() {
        eprintln!("Skipping smoke test because `dvdauthor` is not available on PATH.");
        return;
    }

    let output_dir = unique_temp_dir("build-smoke-vmgm-no-menus");
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
    // Trim the fixture's default chapter list to fit the 1.5s source — the
    // default second chapter sits at 300s, well past this short fixture.
    project.disc.titlesets[0].titles[0].chapters =
        vec![project.disc.titlesets[0].titles[0].chapters[0].clone()];
    // First-play action set, but `global_menus` is left empty — no VMGM-level
    // menus at all, only the titleset's title.
    project.disc.first_play_action = Some(PlaybackAction::PlayTitle {
        title_id: "title-1".to_string(),
    });
    assert!(project.disc.global_menus.is_empty());

    let plan = generate_build_plan(&project, output_dir.to_str().unwrap(), true).unwrap();
    let result = execute_build_plan(&plan, |_| {});

    if !result.success {
        panic!(
            "expected smoke build to succeed\n{}",
            result.log_lines.join("\n")
        );
    }

    assert!(
        output_dir.join("DVD_DISC/VIDEO_TS/VIDEO_TS.IFO").exists(),
        "expected VIDEO_TS.IFO in authored output for a disc with a first-play \
         action but no global menus"
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
        subtitle_codecs
            .lines()
            .any(|line| line.trim() == "dvd_subtitle"),
        "expected authored title MPEG to include a dvd_subtitle stream, got:\n{subtitle_codecs}"
    );

    fs::remove_dir_all(&output_dir).unwrap();
}
