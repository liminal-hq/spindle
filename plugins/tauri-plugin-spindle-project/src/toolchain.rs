// External tool path resolution — sidecar-first, PATH fallback.
//
// Provides a single entry point, `resolve_tool`, used by both the build
// pipeline and the toolchain checker. Checks the Tauri sidecar location
// (alongside the running executable) before falling back to the system PATH.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::PathBuf;
use std::process::Command;

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

/// Resolve a host font family for first-pass text subtitle rendering.
///
/// Returns the first family that Fontconfig can match from a conservative
/// shortlist of sans-serif fonts commonly available on Linux desktops.
pub fn resolve_text_subtitle_font() -> Option<String> {
    let fontconfig = path_lookup("fc-match")?;
    for family in [
        "Noto Sans",
        "Liberation Sans",
        "DejaVu Sans",
        "Arial",
        "Helvetica",
        "Sans",
    ] {
        let output = Command::new(&fontconfig)
            .args(["-f", "%{family[0]}", family])
            .output()
            .ok()?;
        if !output.status.success() {
            continue;
        }
        let matched = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !matched.is_empty() {
            return Some(matched);
        }
    }
    None
}

/// Default font-family hint used when Fontconfig is unavailable.
///
/// `spumux` can still attempt to resolve generic family names or font paths
/// without Fontconfig, so planning should not fail solely because `fc-match`
/// is missing on the host.
pub fn default_text_subtitle_font_family() -> &'static str {
    "sans-serif"
}

/// Return the expected sidecar path: same directory as the running executable.
fn sidecar_path(name: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    Some(dir.join(sidecar_name(name)))
}

fn sidecar_name(name: &str) -> &str {
    match name {
        "dvdauthor" => "spindle-dvdauthor",
        "spumux" => "spindle-spumux",
        "genisoimage" => "spindle-genisoimage",
        "mkisofs" => "spindle-mkisofs",
        other => other,
    }
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
