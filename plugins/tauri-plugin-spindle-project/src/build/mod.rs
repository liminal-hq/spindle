// Build plan generation and DVD-Video authoring pipeline.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

mod authoring;
mod dvd_navigation;
mod executor;
mod ffmpeg;
mod menu;
mod navigation;
mod planner;
#[cfg(test)]
mod test_support;
mod types;
mod util;

pub use executor::{cancel_build, execute_build_plan};
pub use navigation::auto_generate_navigation;
pub use planner::generate_build_plan;
pub use types::{
    BuildJob, BuildJobStatus, BuildPlan, BuildProgress, BuildResult, BuildSummary,
    MenuOverlayButton,
};
