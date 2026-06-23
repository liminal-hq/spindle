// Workspace/output path layout for a build plan.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::PathBuf;

use super::super::util::sanitise_filename;

pub(super) struct BuildPaths {
    pub(super) output_dir: PathBuf,
    pub(super) work_dir: PathBuf,
    pub(super) dvd_root_dir: PathBuf,
    pub(super) titles_dir: PathBuf,
    pub(super) subtitles_dir: PathBuf,
    pub(super) menus_dir: PathBuf,
    pub(super) video_ts_dir: PathBuf,
}

pub(super) struct MenuPaths {
    pub(super) base_video_path: PathBuf,
    pub(super) authored_video_path: PathBuf,
    pub(super) highlight_image_path: PathBuf,
    pub(super) select_image_path: PathBuf,
}

pub(super) struct TitlePaths {
    pub(super) base_video_path: PathBuf,
    pub(super) authored_video_path: PathBuf,
}

impl BuildPaths {
    pub(super) fn new(output_dir: &str) -> Self {
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

    pub(super) fn workspace_directories(&self) -> Vec<String> {
        vec![
            self.work_dir.display().to_string(),
            self.titles_dir.display().to_string(),
            self.subtitles_dir.display().to_string(),
            self.menus_dir.display().to_string(),
            self.dvd_root_dir.display().to_string(),
            self.video_ts_dir.display().to_string(),
        ]
    }

    pub(super) fn reset_directories(&self) -> Vec<String> {
        vec![
            self.work_dir.display().to_string(),
            self.dvd_root_dir.display().to_string(),
        ]
    }

    pub(super) fn title_paths(&self, title_id: &str) -> TitlePaths {
        let base_name = sanitise_filename(title_id);
        TitlePaths {
            base_video_path: self.titles_dir.join(format!("{base_name}_base.mpg")),
            authored_video_path: self.titles_dir.join(format!("{base_name}.mpg")),
        }
    }

    pub(super) fn subtitle_text_path(&self, title_id: &str, source_stream_index: u32) -> PathBuf {
        self.subtitles_dir.join(format!(
            "{}_sub_{}.srt",
            sanitise_filename(title_id),
            source_stream_index
        ))
    }

    pub(super) fn title_subtitle_xml_path(&self, title_id: &str, stream_index: usize) -> PathBuf {
        self.subtitles_dir.join(format!(
            "{}_sub_{}.xml",
            sanitise_filename(title_id),
            stream_index
        ))
    }

    pub(super) fn title_subtitle_stage_path(&self, title_id: &str, stream_index: usize) -> PathBuf {
        self.titles_dir.join(format!(
            "{}_substage_{}.mpg",
            sanitise_filename(title_id),
            stream_index
        ))
    }

    pub(super) fn menu_paths(&self, menu_id: &str) -> MenuPaths {
        let base_name = sanitise_filename(menu_id);
        MenuPaths {
            base_video_path: self.menus_dir.join(format!("{base_name}_base.mpg")),
            authored_video_path: self.menus_dir.join(format!("{base_name}.mpg")),
            highlight_image_path: self.menus_dir.join(format!("{base_name}_highlight.png")),
            select_image_path: self.menus_dir.join(format!("{base_name}_select.png")),
        }
    }

    pub(super) fn dvdauthor_xml_path(&self) -> PathBuf {
        self.work_dir.join("dvdauthor.xml")
    }

    pub(super) fn iso_image_path(&self, project_name: &str) -> PathBuf {
        self.output_dir
            .join(format!("{}.iso", sanitise_filename(project_name)))
    }
}
