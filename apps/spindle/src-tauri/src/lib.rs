// Configures the native Tauri runtime for the Spindle desktop shell.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::path::PathBuf;

use tauri::command;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_text_file, write_text_file])
        // Official Tauri v2 plugins
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        // Spindle plugins
        .plugin(tauri_plugin_spindle_project::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
