// Desktop implementation of the Spindle project plugin.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<SpindleProject<R>> {
    Ok(SpindleProject(app.clone()))
}

/// Desktop-side project operations.
pub struct SpindleProject<R: Runtime>(AppHandle<R>);

impl<R: Runtime> SpindleProject<R> {
    /// Create a new project with the given settings.
    pub fn create_project(&self, req: CreateProjectRequest) -> crate::Result<SpindleProjectFile> {
        let mut project = SpindleProjectFile::default();
        project.project.name = req.name;
        project.disc.standard = req.standard;
        project.disc.capacity_target = req.capacity_target;
        Ok(project)
    }

    /// Parse a project file from JSON, handling schema migration if needed.
    pub fn parse_project(&self, json: &str) -> crate::Result<SpindleProjectFile> {
        parse_project_json(json)
    }

    /// Serialise a project to pretty-printed JSON.
    pub fn serialise_project(&self, project: &SpindleProjectFile) -> crate::Result<String> {
        let json = serde_json::to_string_pretty(project)?;
        Ok(json)
    }

    /// Validate a project and return all issues found.
    pub fn validate_project(
        &self,
        project: &SpindleProjectFile,
    ) -> crate::Result<Vec<ValidationIssue>> {
        Ok(crate::validation::run(project))
    }
}

/// Parse a project file from JSON, enforcing the schema-version guard and
/// running menu migration. Free function (rather than a `SpindleProject`
/// method body) so it's unit-testable without an `AppHandle` — nothing here
/// touches plugin/app state.
fn parse_project_json(json: &str) -> crate::Result<SpindleProjectFile> {
    // First check the schema version before full deserialisation
    let raw: serde_json::Value = serde_json::from_str(json)?;
    if let Some(version) = raw.get("schemaVersion").and_then(|v| v.as_u64()) {
        let version = version as u32;
        if version > SCHEMA_VERSION {
            return Err(crate::Error::SchemaVersionTooNew {
                found: version,
                supported: SCHEMA_VERSION,
            });
        }
        // Future: run migrations for older versions here
    }

    let mut project: SpindleProjectFile = serde_json::from_value(raw)?;
    project.migrate_all_menus();
    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A schema-version-1 file (no `schemaVersion` guard rejection) must
    /// still load and migrate cleanly under the current (v2) binary — the
    /// version guard only rejects versions *newer* than [`SCHEMA_VERSION`].
    #[test]
    fn parse_project_accepts_schema_version_one() {
        let mut project = SpindleProjectFile::default();
        project.schema_version = 1;
        let json = serde_json::to_string(&project).unwrap();

        let parsed = parse_project_json(&json).expect("v1 file should still load under v2");
        assert_eq!(parsed.project.name, project.project.name);
    }

    /// A file stamped with the current schema version round-trips.
    #[test]
    fn parse_project_accepts_current_schema_version() {
        let project = SpindleProjectFile::default();
        assert_eq!(project.schema_version, SCHEMA_VERSION);
        let json = serde_json::to_string(&project).unwrap();

        let parsed =
            parse_project_json(&json).expect("current-version file should load under itself");
        assert_eq!(parsed.schema_version, SCHEMA_VERSION);
    }

    /// A file from a newer, unsupported schema version must be rejected
    /// cleanly rather than falling through to a deserialisation error — this
    /// is the guard a v1-only binary relies on when it opens a v2+ file.
    #[test]
    fn parse_project_rejects_schema_version_newer_than_supported() {
        let mut project = SpindleProjectFile::default();
        project.schema_version = SCHEMA_VERSION + 1;
        let json = serde_json::to_string(&project).unwrap();

        let err = parse_project_json(&json).expect_err("newer schema version must be rejected");
        match err {
            crate::Error::SchemaVersionTooNew { found, supported } => {
                assert_eq!(found, SCHEMA_VERSION + 1);
                assert_eq!(supported, SCHEMA_VERSION);
            }
            other => panic!("expected SchemaVersionTooNew, got {other:?}"),
        }
    }
}
