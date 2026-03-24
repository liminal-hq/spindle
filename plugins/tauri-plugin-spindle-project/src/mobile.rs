// Mobile stub — Spindle is desktop-only but this satisfies the compiler.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_spindle_project);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<SpindleProject<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("", "SpindleProjectPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_spindle_project)?;
    Ok(SpindleProject(handle))
}

/// Mobile-side project operations (stubs).
pub struct SpindleProject<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> SpindleProject<R> {
    pub fn create_project(
        &self,
        payload: CreateProjectRequest,
    ) -> crate::Result<SpindleProjectFile> {
        self.0
            .run_mobile_plugin("createProject", payload)
            .map_err(Into::into)
    }

    pub fn parse_project(&self, json: &str) -> crate::Result<SpindleProjectFile> {
        self.0
            .run_mobile_plugin("parseProject", json)
            .map_err(Into::into)
    }

    pub fn serialise_project(&self, project: &SpindleProjectFile) -> crate::Result<String> {
        self.0
            .run_mobile_plugin("serialiseProject", project)
            .map_err(Into::into)
    }

    pub fn validate_project(
        &self,
        project: &SpindleProjectFile,
    ) -> crate::Result<Vec<ValidationIssue>> {
        self.0
            .run_mobile_plugin("validateProject", project)
            .map_err(Into::into)
    }
}
