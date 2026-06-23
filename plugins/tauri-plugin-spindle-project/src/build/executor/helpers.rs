// Small filesystem/text helpers used by execute_build_plan's job dispatch.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::Path;

pub(super) fn reset_workspace_directory(path: &str) -> std::io::Result<()> {
    let path = Path::new(path);
    if path.exists() {
        std::fs::remove_dir_all(path)?;
    }
    Ok(())
}

pub(super) fn subtitle_file_has_cues(path: &str) -> Result<bool, String> {
    let bytes =
        std::fs::read(path).map_err(|e| format!("Failed to read prepared subtitle file: {e}"))?;
    Ok(bytes.iter().any(|byte| !byte.is_ascii_whitespace()))
}

pub(super) fn carry_title_stage_forward(input_path: &str, output_path: &str) -> Result<(), String> {
    if input_path == output_path {
        return Ok(());
    }

    let src = Path::new(input_path);
    let dst = Path::new(output_path);
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to prepare title stage directory: {e}"))?;
    }
    if dst.exists() {
        std::fs::remove_file(dst)
            .map_err(|e| format!("Failed to replace carried title stage output: {e}"))?;
    }

    std::fs::hard_link(src, dst)
        .or_else(|_| std::fs::copy(src, dst).map(|_| ()))
        .map_err(|e| format!("Failed to carry title stage forward after empty subtitles: {e}"))
}
