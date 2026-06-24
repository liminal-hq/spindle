// Titlesets, titles, track mappings, and output profiles.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{AspectMode, Menu, PlaybackAction, VideoStandard};

/// DVD titleset — a compatibility grouping of titles that share format assumptions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Titleset {
    pub id: String,
    pub name: String,
    pub titles: Vec<Title>,
    pub menus: Vec<Menu>,
}

impl Default for Titleset {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: "Default".to_string(),
            titles: Vec::new(),
            menus: Vec::new(),
        }
    }
}

/// A single playable title on the disc.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Title {
    pub id: String,
    pub name: String,
    pub source_asset_id: Option<String>,
    pub video_mapping: Option<VideoTrackMapping>,
    pub video_output_profile: Option<VideoOutputProfile>,
    pub audio_mappings: Vec<AudioTrackMapping>,
    pub subtitle_mappings: Vec<SubtitleTrackMapping>,
    pub chapters: Vec<ChapterPoint>,
    pub end_action: Option<PlaybackAction>,
    pub order_index: u32,
    /// Scales this title's share of the disc-wide bitrate budget above/below
    /// the duration-proportional baseline under `priority-weighted` allocation.
    /// Ignored by other allocation strategies and when `pinned_bitrate_bps`
    /// is set.
    #[serde(default = "default_bitrate_weight")]
    pub bitrate_weight: f64,
    /// Minimum per-title average video bitrate the allocator must honour,
    /// even if doing so requires shrinking other titles' shares below their
    /// own unconstrained allocation. Ignored when `pinned_bitrate_bps` is set.
    #[serde(default)]
    pub bitrate_floor_bps: Option<u64>,
    /// Maximum per-title average video bitrate the allocator may hand to
    /// this title, so it can't absorb disc-wide slack pointlessly. Ignored
    /// when `pinned_bitrate_bps` is set.
    #[serde(default)]
    pub bitrate_ceiling_bps: Option<u64>,
    /// When set, this title opts out of the allocator entirely and is
    /// encoded at exactly this average video bitrate (still subject to the
    /// encoder's ceiling and this title's own mux-rate headroom). The
    /// remaining disc budget is then distributed only across unpinned titles.
    #[serde(default)]
    pub pinned_bitrate_bps: Option<u64>,
}

fn default_bitrate_weight() -> f64 {
    1.0
}

impl Title {
    pub fn new(name: String, order_index: u32) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            source_asset_id: None,
            video_mapping: None,
            video_output_profile: None,
            audio_mappings: Vec::new(),
            subtitle_mappings: Vec::new(),
            chapters: Vec::new(),
            end_action: None,
            order_index,
            bitrate_weight: default_bitrate_weight(),
            bitrate_floor_bps: None,
            bitrate_ceiling_bps: None,
            pinned_bitrate_bps: None,
        }
    }
}

/// Maps a source video stream to the authored output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoTrackMapping {
    pub source_stream_index: u32,
    pub copy_mode: CopyMode,
}

/// Maps a source audio stream to the authored output with explicit output config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackMapping {
    pub id: String,
    pub source_stream_index: u32,
    pub output_target: AudioOutputTarget,
    pub copy_mode: CopyMode,
    pub label: String,
    pub language: String,
    pub order_index: u32,
    pub is_default: bool,
    /// Target output channel count for a re-encoded track (e.g. downmixing a
    /// 5.1 source to stereo). `None` preserves the source's channel count.
    /// Ignored when `copy_mode` is `Copy`, since stream-copied audio can't
    /// have its channel layout changed.
    #[serde(default)]
    pub channel_layout: Option<u32>,
    /// Target output bitrate in bits per second for a re-encoded track.
    /// `None` falls back to the codec's hardcoded default bitrate (AC3
    /// 448 kbps, MP2 384 kbps, DTS 768 kbps — see the per-codec defaults
    /// in `build::capacity` and `build::ffmpeg`). Ignored when `copy_mode`
    /// is `Copy`, since stream-copied audio can't have its bitrate
    /// changed, and for `AudioOutputTarget::Lpcm`, whose rate is derived
    /// from channel count/sample depth rather than independently set.
    #[serde(default)]
    pub bitrate_bps: Option<u32>,
}

/// Maps a source subtitle stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrackMapping {
    pub id: String,
    pub source_stream_index: u32,
    pub label: String,
    pub language: String,
    pub order_index: u32,
    pub is_default: bool,
    pub is_forced: bool,
}

/// Whether a stream can be copied as-is or must be re-encoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CopyMode {
    Copy,
    ReEncode,
}

/// Legal DVD video output raster and format profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoOutputProfile {
    pub raster: VideoRaster,
    pub aspect: AspectMode,
}

/// DVD-legal video rasters.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VideoRaster {
    /// Full D1 — 720×480 (NTSC) or 720×576 (PAL)
    #[serde(rename = "full-d1")]
    FullD1,
    /// 704-wide — 704×480 (NTSC) or 704×576 (PAL)
    #[serde(rename = "704-wide")]
    Wide704,
    /// Half D1 — 352×480 (NTSC) or 352×576 (PAL)
    #[serde(rename = "half-d1")]
    HalfD1,
    /// Quarter D1 — 352×240 (NTSC) or 352×288 (PAL)
    #[serde(rename = "quarter-d1")]
    QuarterD1,
}

impl VideoRaster {
    pub fn resolution(&self, standard: VideoStandard) -> (u32, u32) {
        match (self, standard) {
            (VideoRaster::FullD1, VideoStandard::Ntsc) => (720, 480),
            (VideoRaster::FullD1, VideoStandard::Pal) => (720, 576),
            (VideoRaster::Wide704, VideoStandard::Ntsc) => (704, 480),
            (VideoRaster::Wide704, VideoStandard::Pal) => (704, 576),
            (VideoRaster::HalfD1, VideoStandard::Ntsc) => (352, 480),
            (VideoRaster::HalfD1, VideoStandard::Pal) => (352, 576),
            (VideoRaster::QuarterD1, VideoStandard::Ntsc) => (352, 240),
            (VideoRaster::QuarterD1, VideoStandard::Pal) => (352, 288),
        }
    }
}

/// DVD-legal audio output targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AudioOutputTarget {
    Ac3,
    Lpcm,
    Mp2,
    Dts,
}

/// A chapter marker within a title.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterPoint {
    pub id: String,
    pub name: String,
    /// Timestamp in seconds from title start.
    pub timestamp_secs: f64,
    pub order_index: u32,
}
