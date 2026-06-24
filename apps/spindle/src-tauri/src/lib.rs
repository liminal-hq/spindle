// Configures the native Tauri runtime for the Spindle desktop shell.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::command;
use tauri::Manager;

#[command]
fn read_text_file(path: PathBuf) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read {}: {err}", path.display()))
}

#[command]
fn write_text_file(path: PathBuf, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents)
        .map_err(|err| format!("Failed to write {}: {err}", path.display()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailCacheStatus {
    path: String,
    size_bytes: u64,
    file_count: usize,
}

#[command]
fn get_thumbnail_cache_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<ThumbnailCacheStatus, String> {
    let cache_dir = thumbnail_cache_dir(&app)?;
    let (size_bytes, file_count) = cache_dir_size_and_count(&cache_dir)
        .map_err(|err| format!("Failed to inspect {}: {err}", cache_dir.display()))?;

    Ok(ThumbnailCacheStatus {
        path: cache_dir.display().to_string(),
        size_bytes,
        file_count,
    })
}

#[command]
fn clear_thumbnail_cache<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let cache_dir = thumbnail_cache_dir(&app)?;

    if cache_dir.exists() {
        std::fs::remove_dir_all(&cache_dir)
            .map_err(|err| format!("Failed to clear {}: {err}", cache_dir.display()))?;
    }

    std::fs::create_dir_all(&cache_dir)
        .map_err(|err| format!("Failed to recreate {}: {err}", cache_dir.display()))?;

    Ok(())
}

fn thumbnail_cache_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| format!("Failed to get cache directory: {err}"))?;

    Ok(cache_dir.join("thumbnails"))
}

fn cache_dir_size_and_count(path: &Path) -> std::io::Result<(u64, usize)> {
    if !path.exists() {
        return Ok((0, 0));
    }

    let mut total_size = 0;
    let mut total_files = 0;
    let mut stack = vec![path.to_path_buf()];

    while let Some(current) = stack.pop() {
        for entry in std::fs::read_dir(&current)? {
            let entry = entry?;
            let entry_path = entry.path();
            let metadata = entry.metadata()?;

            if metadata.is_dir() {
                stack.push(entry_path);
            } else if metadata.is_file() {
                total_size += metadata.len();
                total_files += 1;
            }
        }
    }

    Ok((total_size, total_files))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            get_thumbnail_cache_status,
            clear_thumbnail_cache
        ])
        // Official Tauri v2 plugins
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        // Spindle plugins
        .plugin(tauri_plugin_display_awareness::init())
        .plugin(tauri_plugin_spindle_project::init());

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
