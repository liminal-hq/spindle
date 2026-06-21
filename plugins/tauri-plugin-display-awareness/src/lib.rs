// Tauri plugin exposing display geometry for responsive, density-aware UIs.
//
// The primary signal is *logical* geometry (physical pixels ÷ scale factor),
// because the OS scale factor already encodes the user's chosen UI density.
// Physical millimetre size is reported best-effort (it is unavailable on some
// Wayland sessions, VMs, and panels with no EDID) and must be treated as
// optional by consumers — never as a basis for overriding the OS scale.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::Serialize;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Emitter, Runtime, Window, WindowEvent,
};

/// Event emitted when the active window's scale factor changes (e.g. the window
/// is dragged to a monitor with a different scale). Frontends should re-query
/// [`get_active_display`] in response.
pub const DISPLAY_CHANGED_EVENT: &str = "display://changed";

/// Geometry for a single monitor.
///
/// `logical_*` fields are the OS-scale-corrected values a responsive layout
/// should key its breakpoints off. `physical_*` are raw pixels; `*_mm` are
/// best-effort physical dimensions (`None` when the OS could not report them).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayGeometry {
    pub name: String,
    pub is_primary: bool,
    pub scale: f64,
    pub physical_width: u32,
    pub physical_height: u32,
    /// `physical_width / scale`, rounded.
    pub logical_width: u32,
    /// `physical_height / scale`, rounded.
    pub logical_height: u32,
    pub position_x: i32,
    pub position_y: i32,
    /// Best-effort physical size in millimetres; `None`/`0` when unavailable.
    pub width_mm: Option<u32>,
    pub height_mm: Option<u32>,
}

fn round_div(value: u32, scale: f64) -> u32 {
    if scale <= 0.0 {
        return value;
    }
    (value as f64 / scale).round() as u32
}

fn normalise_mm(value: i32) -> Option<u32> {
    // display-info reports 0 when EDID is unavailable; surface that as None.
    if value > 0 {
        Some(value as u32)
    } else {
        None
    }
}

/// Enumerate all connected displays with logical + best-effort physical geometry.
#[tauri::command]
fn get_displays() -> Vec<DisplayGeometry> {
    let infos = display_info::DisplayInfo::all().unwrap_or_default();
    infos
        .into_iter()
        .map(|d| {
            let scale = d.scale_factor as f64;
            DisplayGeometry {
                name: d.name.clone(),
                is_primary: d.is_primary,
                scale,
                physical_width: d.width,
                physical_height: d.height,
                logical_width: round_div(d.width, scale),
                logical_height: round_div(d.height, scale),
                position_x: d.x,
                position_y: d.y,
                width_mm: normalise_mm(d.width_mm),
                height_mm: normalise_mm(d.height_mm),
            }
        })
        .collect()
}

/// Return the display the given window currently resides on, falling back to the
/// primary display. The reported `scale` prefers the window's live scale factor.
#[tauri::command]
fn get_active_display<R: Runtime>(window: Window<R>) -> Option<DisplayGeometry> {
    let displays = get_displays();
    if displays.is_empty() {
        return None;
    }

    // Match by the window's outer position against each display's bounds.
    let window_pos = window
        .outer_position()
        .ok()
        .map(|p| (p.x, p.y))
        .unwrap_or((0, 0));

    let matched = displays.iter().find(|d| {
        let within_x =
            window_pos.0 >= d.position_x && window_pos.0 < d.position_x + d.physical_width as i32;
        let within_y =
            window_pos.1 >= d.position_y && window_pos.1 < d.position_y + d.physical_height as i32;
        within_x && within_y
    });

    let mut chosen = matched
        .or_else(|| displays.iter().find(|d| d.is_primary))
        .or_else(|| displays.first())
        .cloned()?;

    // Prefer the window's live scale factor — it is authoritative for layout and
    // can differ from the enumerated value mid-transition between monitors.
    if let Ok(scale) = window.scale_factor() {
        chosen.scale = scale;
        chosen.logical_width = round_div(chosen.physical_width, scale);
        chosen.logical_height = round_div(chosen.physical_height, scale);
    }

    Some(chosen)
}

/// Initialise the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("display-awareness")
        .invoke_handler(tauri::generate_handler![get_displays, get_active_display])
        .on_window_ready(|window| {
            let emitter = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::ScaleFactorChanged { .. } = event {
                    let _ = emitter.emit(DISPLAY_CHANGED_EVENT, get_active_display(emitter.clone()));
                }
            });
        })
        .build()
}
