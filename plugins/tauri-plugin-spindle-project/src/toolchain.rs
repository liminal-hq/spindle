// External tool path resolution — sidecar-first, PATH fallback.
//
// Provides a single entry point, `resolve_tool`, used by both the build
// pipeline and the toolchain checker. Checks the Tauri sidecar location
// (alongside the running executable) before falling back to the system PATH.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::PathBuf;

/// Resolve the path to an external tool.
///
/// When `skip_sidecar` is false, checks for a bundled sidecar binary next to
/// the running executable before falling back to the system PATH. When true,
/// skips straight to PATH — useful for local development where stubs may be
/// present next to the binary but real tools are installed system-wide.
///
/// Returns `None` if the tool cannot be located by either method.
pub fn resolve_tool(name: &str, skip_sidecar: bool) -> Option<PathBuf> {
    if !skip_sidecar {
        if let Some(path) = sidecar_path(name) {
            if path.is_file() {
                return Some(path);
            }
        }
    }
    path_lookup(name)
}

/// Return the expected sidecar path: same directory as the running executable.
fn sidecar_path(name: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    Some(dir.join(name))
}

/// Walk PATH directories looking for the named binary.
fn path_lookup(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}
