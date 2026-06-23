// Disc-level structure: format family, video standard, capacity target.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};

use super::{Menu, PlaybackAction, Titleset};

/// Represents the authored disc structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Disc {
    pub family: DiscFamily,
    pub standard: VideoStandard,
    pub capacity_target: CapacityTarget,
    pub first_play_action: Option<PlaybackAction>,
    pub titlesets: Vec<Titleset>,
    pub global_menus: Vec<Menu>,
}

impl Default for Disc {
    fn default() -> Self {
        Self {
            family: DiscFamily::DvdVideo,
            standard: VideoStandard::Ntsc,
            capacity_target: CapacityTarget::Dvd5,
            first_play_action: None,
            titlesets: vec![Titleset::default()],
            global_menus: Vec::new(),
        }
    }
}

/// Disc format family. Controls raster dimensions, SAR, overlay mechanism, and minimum font size.
///
/// `DvdVideo` is fully supported end-to-end. `BluRay`, `Svcd`, and `Vcd` are wired in the model
/// and Skia render pipeline but are not exposed in the UI format picker — use
/// `is_ui_supported()` to gate UI controls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiscFamily {
    /// DVD-Video: MPEG-2 encode, spumux subpicture overlays. Fully supported.
    DvdVideo,
    /// Blu-ray Disc: square-pixel 1920×1080, full-colour PNG IG streams. Model and render only.
    BluRay,
    /// Super Video CD: limited overlay support. Model and render only.
    Svcd,
    /// Video CD: no standardised overlay. Model and render only.
    Vcd,
}

impl DiscFamily {
    /// Returns `true` only for formats that are fully supported in the UI.
    /// New variants are model-only until their authoring and render pipelines are complete.
    pub fn is_ui_supported(&self) -> bool {
        matches!(self, DiscFamily::DvdVideo)
    }
}

/// Video standard (affects resolution profiles, frame rates, timing).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum VideoStandard {
    Ntsc,
    Pal,
}

impl VideoStandard {
    pub fn frame_rate(&self) -> f64 {
        match self {
            VideoStandard::Ntsc => 29.97,
            VideoStandard::Pal => 25.0,
        }
    }

    pub fn default_resolution(&self) -> (f64, f64) {
        match self {
            VideoStandard::Ntsc => (720.0, 480.0),
            VideoStandard::Pal => (720.0, 576.0),
        }
    }
}

/// Disc capacity targets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum CapacityTarget {
    Dvd5,
    Dvd9,
}

impl CapacityTarget {
    /// Nominal capacity in bytes.
    pub fn capacity_bytes(&self) -> u64 {
        match self {
            CapacityTarget::Dvd5 => 4_700_000_000,
            CapacityTarget::Dvd9 => 8_500_000_000,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            CapacityTarget::Dvd5 => "DVD-5 (4.7 GB)",
            CapacityTarget::Dvd9 => "DVD-9 (8.5 GB)",
        }
    }
}
