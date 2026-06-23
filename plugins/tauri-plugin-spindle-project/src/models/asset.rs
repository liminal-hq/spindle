// Source media assets: stream metadata, DVD compatibility assessment, warnings.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A source media file registered in the project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub file_name: String,
    pub source_path: String,
    pub file_size_bytes: Option<u64>,
    pub duration_secs: Option<f64>,
    pub container_format: Option<String>,
    pub video_streams: Vec<VideoStreamInfo>,
    pub audio_streams: Vec<AudioStreamInfo>,
    pub subtitle_streams: Vec<SubtitleStreamInfo>,
    pub compatibility: Option<CompatibilityAssessment>,
    /// Detailed per-stream compatibility breakdown.
    #[serde(default)]
    pub compatibility_detail: Option<CompatibilityDetail>,
    pub fingerprint: Option<String>,
    #[serde(default)]
    pub warnings: Vec<AssetWarning>,
    #[serde(default)]
    pub thumbnail_path: Option<String>,
    #[serde(default)]
    pub thumbnail_error: Option<String>,
    /// Chapter markers detected in the source media file.
    #[serde(default)]
    pub source_chapters: Vec<SourceChapter>,
    /// Container-level title tag from source media metadata (e.g. MKV/MP4 title).
    #[serde(default)]
    pub format_title: Option<String>,
}

impl Asset {
    pub fn new(file_name: String, source_path: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            file_name,
            source_path,
            file_size_bytes: None,
            duration_secs: None,
            container_format: None,
            video_streams: Vec::new(),
            audio_streams: Vec::new(),
            subtitle_streams: Vec::new(),
            compatibility: None,
            compatibility_detail: None,
            fingerprint: None,
            warnings: Vec::new(),
            thumbnail_path: None,
            thumbnail_error: None,
            source_chapters: Vec::new(),
            format_title: None,
        }
    }

    pub fn is_still_image(&self) -> bool {
        let extension = std::path::Path::new(&self.file_name)
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase());

        if let Some(extension) = extension.as_deref() {
            if matches!(extension, "png" | "jpg" | "jpeg" | "bmp" | "tif" | "tiff") {
                return true;
            }
        }

        self.container_format
            .as_deref()
            .map(|format| matches!(format, "png_pipe" | "image2"))
            .unwrap_or(false)
    }
}

/// Detected video stream metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoStreamInfo {
    pub index: u32,
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub frame_rate: Option<f64>,
    pub aspect_ratio: Option<String>,
    pub scan_type: Option<String>,
    pub bitrate_bps: Option<u64>,
    #[serde(default)]
    pub title: Option<String>,
    /// OETF / transfer characteristics (e.g. "smpte2084" for HDR10, "arib-std-b67" for HLG).
    #[serde(default)]
    pub color_transfer: Option<String>,
    /// Color primaries (e.g. "bt2020" for wide-gamut HDR, "bt709" for SDR).
    #[serde(default)]
    pub color_primaries: Option<String>,
    /// Dolby Vision profile when ffprobe exposes DOVI side data.
    #[serde(default)]
    pub dolby_vision_profile: Option<u8>,
}

/// Detected audio stream metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStreamInfo {
    pub index: u32,
    pub codec: String,
    pub channels: u32,
    pub sample_rate: u32,
    pub language: Option<String>,
    pub bitrate_bps: Option<u64>,
    #[serde(default)]
    pub title: Option<String>,
}

/// Detected subtitle stream metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStreamInfo {
    pub index: u32,
    pub codec: String,
    pub language: Option<String>,
    pub subtitle_type: SubtitleType,
    #[serde(default)]
    pub title: Option<String>,
}

/// Whether a subtitle source is bitmap or text-based.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SubtitleType {
    Bitmap,
    Text,
    Unknown,
}

/// A chapter point detected in a source media file during inspection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceChapter {
    pub start_secs: f64,
    pub end_secs: f64,
    pub title: Option<String>,
}

/// Per-asset compatibility assessment relative to the disc target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CompatibilityAssessment {
    RemuxCompatible,
    TransformCompatible,
    ReEncodeRequired,
    Unsupported,
}

/// Per-stream compatibility breakdown explaining why the overall assessment was given.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityDetail {
    pub overall: CompatibilityAssessment,
    pub video: Option<VideoCompatibility>,
    pub audio_streams: Vec<AudioStreamCompatibility>,
    pub container: ContainerCompatibility,
}

/// Compatibility detail for a single video stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoCompatibility {
    pub codec: PropertyCheck,
    pub resolution: PropertyCheck,
    pub frame_rate: PropertyCheck,
}

/// Compatibility detail for a single audio stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStreamCompatibility {
    pub stream_index: u32,
    pub codec: PropertyCheck,
}

/// Compatibility detail for the container format.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerCompatibility {
    pub format: PropertyCheck,
}

/// A single property compatibility check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyCheck {
    /// The source value (e.g. "h264", "1920x1080").
    pub value: String,
    /// What DVD requires (e.g. "mpeg2video", "720x480 or 720x576").
    pub dvd_requires: String,
    /// What action the build will take: "none", "remux", "re-encode", "scale".
    pub action: String,
    /// Whether this property is DVD-compatible as-is.
    pub compatible: bool,
}

/// Non-fatal asset warnings surfaced in the UI and diagnostics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetWarning {
    pub code: String,
    pub message: String,
}
