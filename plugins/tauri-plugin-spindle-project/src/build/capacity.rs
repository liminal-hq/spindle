// Disc-capacity budget estimation — the single source of truth for "does this
// project fit", shared between the build pipeline (which uses the per-title
// bitrate to drive ffmpeg) and the frontend (Overview/Planner, via the
// `estimate_disc_capacity` command).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};

use crate::models::*;

/// DVD-Video spec limits (ISO/IEC 13818-1).
const DVD_MAX_MUX_RATE_BPS: f64 = 10_080_000.0; // 10.08 Mbps total mux rate
pub(crate) const DVD_MAX_VIDEO_RATE_BPS: f64 = 9_800_000.0; // 9.8 Mbps max video ES

/// Still menus are ~1-2 MB (MPEG-2 still + highlights); motion menus use
/// their duration at a moderate bitrate.
const STILL_MENU_BYTES: f64 = 1_500_000.0;
const MOTION_MENU_BITRATE_BPS: f64 = 5_000_000.0;

/// This disc's overall capacity budget, plus the per-title average video
/// bitrate the build pipeline should actually encode at to respect it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapacityEstimate {
    pub capacity_bytes: f64,
    pub total_duration_secs: f64,
    pub estimated_menu_bytes: f64,
    pub safety_margin_bytes: f64,
    pub estimated_overhead_bytes: f64,
    pub usable_bytes: f64,
    /// Disc-wide average video bitrate available within budget, capped to
    /// DVD spec limits. This is what `duration-weighted` allocation gives
    /// every title; other strategies redistribute the same total budget.
    pub available_bits_per_second: f64,
    /// True when the disc's capacity (not the DVD spec) is the binding constraint.
    pub is_capacity_constrained: bool,
    /// Estimated encoded size at the budgeted rate — not source file size,
    /// since source files are re-encoded to DVD-compliant MPEG-2 before authoring.
    pub estimated_output_bytes: f64,
    pub usage_pct: f64,
    pub is_over_capacity: bool,
    /// Per-title average video bitrate, after distributing the disc-wide
    /// budget according to `BuildSettings.allocation_strategy`.
    pub title_bitrates: Vec<TitleBitrateAllocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleBitrateAllocation {
    pub title_id: String,
    pub bits_per_second: f64,
}

/// Estimate encoded disc size and bitrate budget from total title duration,
/// the disc's capacity target, and authored menus — shared by the build
/// pipeline and the frontend so they never disagree about whether a project
/// fits on its target disc, and so the build actually respects the estimate.
pub fn estimate_disc_capacity(project: &SpindleProjectFile) -> CapacityEstimate {
    let disc = &project.disc;
    let capacity_bytes = disc.capacity_target.capacity_bytes() as f64;

    let titles_with_duration: Vec<(&Title, f64)> = disc
        .titlesets
        .iter()
        .flat_map(|ts| ts.titles.iter())
        .map(|title| {
            let duration = title
                .source_asset_id
                .as_deref()
                .and_then(|id| project.assets.iter().find(|a| a.id == id))
                .and_then(|asset| asset.duration_secs)
                .unwrap_or(0.0);
            (title, duration)
        })
        .collect();

    let total_duration_secs: f64 = titles_with_duration.iter().map(|(_, d)| d).sum();

    let all_menus: Vec<&Menu> = disc
        .global_menus
        .iter()
        .chain(disc.titlesets.iter().flat_map(|ts| ts.menus.iter()))
        .collect();
    let estimated_menu_bytes: f64 = all_menus
        .iter()
        .map(|menu| {
            if menu.background_mode == BackgroundMode::Motion {
                if let Some(secs) = menu.motion_duration_secs {
                    return (MOTION_MENU_BITRATE_BPS * secs) / 8.0;
                }
            }
            STILL_MENU_BYTES
        })
        .sum();

    let safety_margin_bytes = project.build_settings.safety_margin_bytes as f64;
    let estimated_overhead_bytes = 50_000_000.0 + estimated_menu_bytes;
    let usable_bytes = capacity_bytes - safety_margin_bytes - estimated_overhead_bytes;

    // NOTE: this budgeted rate is advisory only until it's fed into the build —
    // see liminal-hq/spindle#43.
    let raw_bits_per_second = if total_duration_secs > 0.0 {
        (usable_bytes * 8.0) / total_duration_secs
    } else {
        0.0
    };
    let available_bits_per_second = raw_bits_per_second.min(DVD_MAX_VIDEO_RATE_BPS);
    let is_capacity_constrained = raw_bits_per_second < DVD_MAX_VIDEO_RATE_BPS;

    let estimated_output_bytes = if total_duration_secs > 0.0 {
        (raw_bits_per_second.min(DVD_MAX_MUX_RATE_BPS) * total_duration_secs) / 8.0
    } else {
        0.0
    };
    let usage_pct = if estimated_output_bytes > 0.0 {
        (estimated_output_bytes / capacity_bytes) * 100.0
    } else {
        0.0
    };
    let is_over_capacity = estimated_output_bytes > usable_bytes;

    let title_bitrates = allocate_title_bitrates(
        &titles_with_duration,
        total_duration_secs,
        available_bits_per_second,
        project.build_settings.allocation_strategy,
    );

    CapacityEstimate {
        capacity_bytes,
        total_duration_secs,
        estimated_menu_bytes,
        safety_margin_bytes,
        estimated_overhead_bytes,
        usable_bytes,
        available_bits_per_second,
        is_capacity_constrained,
        estimated_output_bytes,
        usage_pct,
        is_over_capacity,
        title_bitrates,
    }
}

/// Distribute the disc-wide average bitrate budget across titles.
///
/// `priority-weighted` has no per-title weight data yet (tracked in
/// liminal-hq/spindle#44), so it falls back to `duration-weighted` until that
/// lands.
fn allocate_title_bitrates(
    titles_with_duration: &[(&Title, f64)],
    total_duration_secs: f64,
    available_bits_per_second: f64,
    strategy: AllocationStrategy,
) -> Vec<TitleBitrateAllocation> {
    if titles_with_duration.is_empty() || available_bits_per_second <= 0.0 {
        return titles_with_duration
            .iter()
            .map(|(title, _)| TitleBitrateAllocation {
                title_id: title.id.clone(),
                bits_per_second: available_bits_per_second.max(0.0),
            })
            .collect();
    }

    match strategy {
        AllocationStrategy::DurationWeighted | AllocationStrategy::PriorityWeighted => {
            // Every title gets the same average rate; bytes naturally scale
            // with each title's own duration.
            titles_with_duration
                .iter()
                .map(|(title, _)| TitleBitrateAllocation {
                    title_id: title.id.clone(),
                    bits_per_second: available_bits_per_second,
                })
                .collect()
        }
        AllocationStrategy::EqualShare => {
            // Every title gets the same total byte budget regardless of
            // duration, so short titles get a higher per-second rate.
            let total_budget_bits = available_bits_per_second * total_duration_secs;
            let share_bits = total_budget_bits / titles_with_duration.len() as f64;
            titles_with_duration
                .iter()
                .map(|(title, duration)| {
                    let bits_per_second = if *duration > 0.0 {
                        (share_bits / duration).min(DVD_MAX_VIDEO_RATE_BPS)
                    } else {
                        available_bits_per_second
                    };
                    TitleBitrateAllocation {
                        title_id: title.id.clone(),
                        bits_per_second,
                    }
                })
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build::test_support::test_project;

    #[test]
    fn duration_weighted_gives_every_title_the_same_rate() {
        let mut project = test_project();
        project.assets[0].duration_secs = Some(3600.0);
        project.build_settings.allocation_strategy = AllocationStrategy::DurationWeighted;

        let estimate = estimate_disc_capacity(&project);

        assert_eq!(estimate.title_bitrates.len(), 1);
        assert_eq!(
            estimate.title_bitrates[0].bits_per_second,
            estimate.available_bits_per_second
        );
    }

    #[test]
    fn equal_share_gives_short_titles_a_higher_rate_than_long_titles() {
        let mut project = test_project();
        project.assets[0].duration_secs = Some(3600.0);
        project.build_settings.allocation_strategy = AllocationStrategy::EqualShare;

        let mut second_title = project.disc.titlesets[0].titles[0].clone();
        second_title.id = "title-2".to_string();
        project.disc.titlesets[0].titles.push(second_title);

        let mut short_asset = project.assets[0].clone();
        short_asset.id = "asset-2".to_string();
        short_asset.duration_secs = Some(60.0);
        project.assets.push(short_asset);
        project.disc.titlesets[0].titles[1].source_asset_id = Some("asset-2".to_string());

        let estimate = estimate_disc_capacity(&project);

        let long_rate = estimate.title_bitrates[0].bits_per_second;
        let short_rate = estimate.title_bitrates[1].bits_per_second;
        assert!(
            short_rate > long_rate,
            "expected the 60s title to get a higher rate than the 3600s title under equal-share, \
             got short={short_rate} long={long_rate}"
        );
    }

    #[test]
    fn no_titles_does_not_panic() {
        let mut project = test_project();
        project.disc.titlesets[0].titles.clear();

        let estimate = estimate_disc_capacity(&project);

        assert_eq!(estimate.total_duration_secs, 0.0);
        assert!(estimate.title_bitrates.is_empty());
    }
}
