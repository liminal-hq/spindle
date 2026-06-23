// Build configuration and preferences: output settings, bitrate allocation strategy.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};

/// Build configuration and preferences.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSettings {
    pub output_directory: Option<String>,
    pub generate_iso: bool,
    pub safety_margin_bytes: u64,
    pub allocation_strategy: AllocationStrategy,
    #[serde(default)]
    pub subtitle_render_mode: SubtitleRenderMode,
}

impl Default for BuildSettings {
    fn default() -> Self {
        Self {
            output_directory: None,
            generate_iso: false,
            // 50 MB default safety margin
            safety_margin_bytes: 50_000_000,
            allocation_strategy: AllocationStrategy::DurationWeighted,
            subtitle_render_mode: SubtitleRenderMode::TwoPass,
        }
    }
}

/// How to distribute bitrate budget across titles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AllocationStrategy {
    EqualShare,
    DurationWeighted,
    PriorityWeighted,
}

/// High-level subtitle rendering mode for text subtitle authoring.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum SubtitleRenderMode {
    OnePass,
    #[default]
    TwoPass,
}
