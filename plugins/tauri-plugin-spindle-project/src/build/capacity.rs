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

    // Audio is muxed alongside video at the same rates `build_ffmpeg_transcode_command`
    // requests, so it must be reserved out of the budget before any of it is
    // handed to video — otherwise the disc can be reported as fitting while the
    // build encodes the full video budget *plus* audio and overflows the target.
    let total_audio_bytes: f64 = titles_with_duration
        .iter()
        .filter(|(_, duration)| *duration > 0.0)
        .map(|(title, duration)| {
            let asset = title
                .source_asset_id
                .as_deref()
                .and_then(|id| project.assets.iter().find(|a| a.id == id));
            (estimate_title_audio_bitrate_bps(title, asset) * duration) / 8.0
        })
        .sum();

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

    // `available_bits_per_second` is the video-only budget: audio is reserved
    // out of `usable_bytes` first, since the build muxes it in on top of
    // whatever rate `title_bitrates` hands to `-b:v`.
    let usable_video_bytes = (usable_bytes - total_audio_bytes).max(0.0);
    let raw_bits_per_second = if total_duration_secs > 0.0 {
        (usable_video_bytes * 8.0) / total_duration_secs
    } else {
        0.0
    };
    let available_bits_per_second = raw_bits_per_second.min(DVD_MAX_VIDEO_RATE_BPS);
    let is_capacity_constrained = raw_bits_per_second < DVD_MAX_VIDEO_RATE_BPS;

    let estimated_output_bytes = if total_duration_secs > 0.0 {
        let video_bps = raw_bits_per_second.min(DVD_MAX_MUX_RATE_BPS);
        ((video_bps * total_duration_secs) / 8.0) + total_audio_bytes
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

/// Estimate the total audio bitrate `build_ffmpeg_transcode_command` will
/// actually request for this title, mirroring its re-encode targets and its
/// silent-fallback track so the capacity budget can reserve real bytes for it
/// instead of treating the whole disc as video.
fn estimate_title_audio_bitrate_bps(title: &Title, asset: Option<&Asset>) -> f64 {
    if title.audio_mappings.is_empty() {
        return 192_000.0; // matches the anullsrc fallback track's `-b:a 192k`.
    }

    title
        .audio_mappings
        .iter()
        .map(|mapping| match mapping.copy_mode {
            CopyMode::ReEncode => match mapping.output_target {
                AudioOutputTarget::Ac3 => 448_000.0,
                AudioOutputTarget::Mp2 => 384_000.0,
                AudioOutputTarget::Dts => 768_000.0,
                // LPCM is uncompressed and has no fixed rate of its own —
                // `build_ffmpeg_transcode_command` never forces `-ac`, so the
                // encode keeps the source channel count. Derive the real rate
                // from it instead of assuming stereo (16-bit/48kHz).
                AudioOutputTarget::Lpcm => {
                    let channels = asset
                        .and_then(|a| {
                            a.audio_streams
                                .iter()
                                .find(|s| s.index == mapping.source_stream_index)
                        })
                        .map(|stream| stream.channels)
                        .unwrap_or(2);
                    16.0 * 48_000.0 * channels as f64
                }
            },
            // Copied as-is: use the source stream's known bitrate, or fall
            // back to the heaviest re-encode target (AC3) if unknown.
            CopyMode::Copy => asset
                .and_then(|a| {
                    a.audio_streams
                        .iter()
                        .find(|s| s.index == mapping.source_stream_index)
                })
                .and_then(|stream| stream.bitrate_bps)
                .map(|bps| bps as f64)
                .unwrap_or(448_000.0),
        })
        .sum()
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

    // Clamp to the encoder's actual ceiling (not just the looser DVD spec
    // limit), so the exported rate matches what `build_ffmpeg_transcode_command`
    // will really request — otherwise Planner/the command can report a rate
    // (e.g. the DVD spec's 9.8 Mbps) above what the generated `-b:v` ends up
    // being (clamped to the encoder's 9.0 Mbps ceiling).
    let capped_rate = available_bits_per_second.min(super::ffmpeg::MAX_VIDEO_RATE_BPS);

    titles_with_duration
        .iter()
        .map(|(title, duration)| {
            // Unknown-duration titles aren't counted in `total_duration_secs`
            // or the disc-level byte estimate at all, so handing them a
            // capacity-derived rate would let the build encode real,
            // unaccounted-for bytes while the estimate still claims the
            // project fits. Leave them at 0 so the encoder falls back to its
            // own safe default instead of silently riding on the budget.
            let bits_per_second = if *duration <= 0.0 {
                0.0
            } else {
                match strategy {
                    // Every title gets the same average rate; bytes naturally
                    // scale with each title's own duration.
                    AllocationStrategy::DurationWeighted | AllocationStrategy::PriorityWeighted => {
                        capped_rate
                    }
                    // Every title gets the same total byte budget regardless
                    // of duration, so short titles get a higher per-second rate.
                    AllocationStrategy::EqualShare => {
                        let total_budget_bits = available_bits_per_second * total_duration_secs;
                        let share_bits = total_budget_bits / titles_with_duration.len() as f64;
                        (share_bits / duration).min(capped_rate)
                    }
                }
            };
            TitleBitrateAllocation {
                title_id: title.id.clone(),
                bits_per_second,
            }
        })
        .collect()
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
            estimate
                .available_bits_per_second
                .min(super::super::ffmpeg::MAX_VIDEO_RATE_BPS)
        );
    }

    #[test]
    fn title_bitrates_are_clamped_to_the_encoder_ceiling_not_just_the_dvd_spec_limit() {
        // Regression test: the DVD spec ceiling (9.8 Mbps) is looser than the
        // encoder's actual `-maxrate` ceiling (9.0 Mbps), so a rate exported
        // here must not exceed what `build_ffmpeg_transcode_command` will
        // really request, or Planner/the command report a number the build
        // doesn't honour.
        let mut project = test_project();
        project.assets[0].duration_secs = Some(3600.0);

        let estimate = estimate_disc_capacity(&project);

        assert!(estimate.available_bits_per_second > super::super::ffmpeg::MAX_VIDEO_RATE_BPS);
        for alloc in &estimate.title_bitrates {
            assert!(
                alloc.bits_per_second <= super::super::ffmpeg::MAX_VIDEO_RATE_BPS,
                "title {} got {} bps, above the encoder ceiling of {}",
                alloc.title_id,
                alloc.bits_per_second,
                super::super::ffmpeg::MAX_VIDEO_RATE_BPS
            );
        }
    }

    #[test]
    fn unknown_duration_titles_do_not_get_a_capacity_derived_bitrate() {
        // Regression test: a title whose asset has no known duration isn't
        // counted in total_duration_secs or the disc-level byte estimate, so
        // handing it a positive budgeted rate would let the build encode
        // real, unaccounted-for bytes while the estimate still claims the
        // disc fits.
        let mut project = test_project();
        project.assets[0].duration_secs = Some(3600.0);

        let mut second_title = project.disc.titlesets[0].titles[0].clone();
        second_title.id = "title-unknown-duration".to_string();
        project.disc.titlesets[0].titles.push(second_title);

        let mut unknown_asset = project.assets[0].clone();
        unknown_asset.id = "asset-unknown".to_string();
        unknown_asset.duration_secs = None;
        project.assets.push(unknown_asset);
        project.disc.titlesets[0].titles[1].source_asset_id = Some("asset-unknown".to_string());

        let estimate = estimate_disc_capacity(&project);

        let unknown_rate = estimate
            .title_bitrates
            .iter()
            .find(|a| a.title_id == "title-unknown-duration")
            .expect("expected an allocation entry for the unknown-duration title")
            .bits_per_second;
        assert_eq!(
            unknown_rate, 0.0,
            "unknown-duration titles must not receive a capacity-derived bitrate"
        );
    }

    #[test]
    fn video_budget_reserves_bytes_for_audio_instead_of_assuming_video_takes_the_whole_disc() {
        // Regression test: the default test title has an AC3 (448 kbps)
        // audio mapping. If the video budget didn't reserve for it,
        // available_bits_per_second would equal the full usable-byte rate;
        // it must instead be lower by roughly the audio share.
        let mut project = test_project();
        project.assets[0].duration_secs = Some(3600.0);

        let estimate = estimate_disc_capacity(&project);
        let usable_video_bytes_implied =
            (estimate.available_bits_per_second * estimate.total_duration_secs) / 8.0;

        assert!(
            usable_video_bytes_implied < estimate.usable_bytes,
            "expected audio to be reserved out of the usable budget before deriving the video rate"
        );
    }

    #[test]
    fn lpcm_audio_reservation_scales_with_source_channel_count() {
        // Regression test: a 5.1 source re-encoded to LPCM keeps all 6
        // channels (build_ffmpeg_transcode_command never forces `-ac`), so
        // assuming stereo would reserve roughly a third of the real bytes.
        let mut stereo_project = test_project();
        stereo_project.assets[0].duration_secs = Some(3600.0);
        stereo_project.assets[0].audio_streams[0].channels = 2;
        stereo_project.disc.titlesets[0].titles[0].audio_mappings[0].output_target =
            AudioOutputTarget::Lpcm;

        let mut surround_project = test_project();
        surround_project.assets[0].duration_secs = Some(3600.0);
        surround_project.assets[0].audio_streams[0].channels = 6;
        surround_project.disc.titlesets[0].titles[0].audio_mappings[0].output_target =
            AudioOutputTarget::Lpcm;

        let stereo_estimate = estimate_disc_capacity(&stereo_project);
        let surround_estimate = estimate_disc_capacity(&surround_project);

        assert!(
            surround_estimate.available_bits_per_second < stereo_estimate.available_bits_per_second,
            "expected a 5.1 LPCM source to reserve more audio bytes (leaving a smaller video budget) \
             than a stereo one, got surround={} stereo={}",
            surround_estimate.available_bits_per_second,
            stereo_estimate.available_bits_per_second
        );
    }

    #[test]
    fn estimated_output_bytes_includes_audio_not_just_video() {
        let mut project = test_project();
        project.assets[0].duration_secs = Some(3600.0);

        let estimate = estimate_disc_capacity(&project);
        let video_only_bytes =
            (estimate.available_bits_per_second * estimate.total_duration_secs) / 8.0;

        assert!(
            estimate.estimated_output_bytes > video_only_bytes,
            "estimated_output_bytes ({}) should account for muxed audio on top of video ({})",
            estimate.estimated_output_bytes,
            video_only_bytes
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
