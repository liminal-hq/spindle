// Tauri plugin for Spindle project schema, validation, and domain logic.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::SpindleProject;
#[cfg(mobile)]
use mobile::SpindleProject;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the spindle-project APIs.
pub trait SpindleProjectExt<R: Runtime> {
    fn spindle_project(&self) -> &SpindleProject<R>;
}

impl<R: Runtime, T: Manager<R>> crate::SpindleProjectExt<R> for T {
    fn spindle_project(&self) -> &SpindleProject<R> {
        self.state::<SpindleProject<R>>().inner()
    }
}

/// Initialises the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("spindle-project")
        .invoke_handler(tauri::generate_handler![
            commands::create_project,
            commands::parse_project,
            commands::serialise_project,
            commands::validate_project,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let spindle_project = mobile::init(app, api)?;
            #[cfg(desktop)]
            let spindle_project = desktop::init(app, api)?;
            app.manage(spindle_project);
            Ok(())
        })
        .build()
}
