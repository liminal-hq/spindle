// Build plan generation and DVD-Video authoring pipeline.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

mod authoring;
mod dvd_navigation;
mod executor;
mod ffmpeg;
mod ffmpeg_progress;
mod menu;
mod navigation;
mod planner;
mod skia;

pub use menu::{authorable_menus, AuthorableMenuRef, MenuDomain};
pub use skia::{enumerate_fonts, render_menu_scene_to_png, FontEntry, FontSource};
#[cfg(test)]
mod test_support;
mod types;
mod util;

pub use executor::{cancel_build, execute_build_plan};
pub use navigation::auto_generate_navigation;
pub use planner::{generate_build_plan, generate_build_plan_with_options};
pub use preview::export_menu_render_preview;
pub use types::{
    BuildJob, BuildJobStatus, BuildPlan, BuildProgress, BuildResult, BuildSummary,
    MenuOverlayButton,
};

mod preview;
