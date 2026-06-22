// Tauri plugin exposing display geometry for responsive, density-aware UIs.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

// The primary signal is logical geometry (physical pixels / scale factor),
// because the OS scale factor already encodes the user's chosen UI density.
// Physical millimetre size is reported best-effort (it is unavailable on some
// Wayland sessions, VMs, and panels with no EDID) and must be treated as
// optional by consumers — never as a basis for overriding the OS scale.

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
#[derive(Debug, Clone, PartialEq, Serialize)]
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

/// Pick the display a window at `window_pos` resides on: the display whose
/// bounds contain that point, falling back to the primary display, then to
/// the first enumerated display, in that order. Pure and runtime-independent
/// so it can be unit tested without a live `Window`.
fn choose_display(displays: &[DisplayGeometry], window_pos: (i32, i32)) -> Option<DisplayGeometry> {
    let matched = displays.iter().find(|d| {
        let within_x =
            window_pos.0 >= d.position_x && window_pos.0 < d.position_x + d.physical_width as i32;
        let within_y =
            window_pos.1 >= d.position_y && window_pos.1 < d.position_y + d.physical_height as i32;
        within_x && within_y
    });

    matched
        .or_else(|| displays.iter().find(|d| d.is_primary))
        .or_else(|| displays.first())
        .cloned()
}

/// Return the display the given window currently resides on, falling back to the
/// primary display. The reported `scale` prefers the window's live scale factor.
#[tauri::command]
fn get_active_display<R: Runtime>(window: Window<R>) -> Option<DisplayGeometry> {
    let displays = get_displays();

    let window_pos = window
        .outer_position()
        .ok()
        .map(|p| (p.x, p.y))
        .unwrap_or((0, 0));

    let mut chosen = choose_display(&displays, window_pos)?;

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
                    let _ =
                        emitter.emit(DISPLAY_CHANGED_EVENT, get_active_display(emitter.clone()));
                }
            });
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(name: &str, is_primary: bool, x: i32, y: i32, w: u32, h: u32) -> DisplayGeometry {
        DisplayGeometry {
            name: name.to_string(),
            is_primary,
            scale: 1.0,
            physical_width: w,
            physical_height: h,
            logical_width: w,
            logical_height: h,
            position_x: x,
            position_y: y,
            width_mm: None,
            height_mm: None,
        }
    }

    #[test]
    fn round_div_divides_and_rounds() {
        assert_eq!(round_div(1920, 2.0), 960);
        // 1000 / 3 = 333.33... rounds to 333.
        assert_eq!(round_div(1000, 3.0), 333);
        // 1000 / 1.5 = 666.67 rounds up to 667.
        assert_eq!(round_div(1000, 1.5), 667);
    }

    #[test]
    fn round_div_returns_value_unchanged_for_non_positive_scale() {
        assert_eq!(round_div(1920, 0.0), 1920);
        assert_eq!(round_div(1920, -1.0), 1920);
    }

    #[test]
    fn normalise_mm_treats_positive_values_as_present() {
        assert_eq!(normalise_mm(620), Some(620));
        assert_eq!(normalise_mm(1), Some(1));
    }

    #[test]
    fn normalise_mm_treats_zero_and_negative_as_absent() {
        // display-info reports 0 when EDID doesn't supply a physical size.
        assert_eq!(normalise_mm(0), None);
        assert_eq!(normalise_mm(-1), None);
    }

    #[test]
    fn choose_display_returns_none_for_empty_list() {
        assert_eq!(choose_display(&[], (0, 0)), None);
    }

    #[test]
    fn choose_display_matches_the_display_containing_the_window() {
        let primary = display("primary", true, 0, 0, 1920, 1080);
        let secondary = display("secondary", false, 1920, 0, 1280, 720);
        let displays = [primary.clone(), secondary.clone()];

        // A point inside the second display's bounds should match it, even
        // though the primary display is listed first.
        assert_eq!(choose_display(&displays, (2000, 100)), Some(secondary));
        assert_eq!(choose_display(&displays, (100, 100)), Some(primary));
    }

    #[test]
    fn choose_display_falls_back_to_primary_when_window_position_matches_none() {
        let primary = display("primary", true, 0, 0, 1920, 1080);
        let secondary = display("secondary", false, 1920, 0, 1280, 720);
        let displays = [secondary, primary.clone()];

        // (5000, 5000) is outside both displays' bounds.
        assert_eq!(choose_display(&displays, (5000, 5000)), Some(primary));
    }

    #[test]
    fn choose_display_falls_back_to_first_display_when_none_is_primary() {
        let first = display("first", false, 0, 0, 1920, 1080);
        let second = display("second", false, 1920, 0, 1280, 720);
        let displays = [first.clone(), second];

        assert_eq!(choose_display(&displays, (5000, 5000)), Some(first));
    }

    #[test]
    fn choose_display_bounds_are_exclusive_on_the_far_edge() {
        let only = display("only", true, 0, 0, 1920, 1080);
        let displays = [only.clone()];

        // The bottom-right corner (1920, 1080) is one pixel past the display's
        // bounds on both axes and should not match directly, but still falls
        // back to the (sole) primary display.
        assert_eq!(choose_display(&displays, (1919, 1079)), Some(only.clone()));
        assert_eq!(choose_display(&displays, (1920, 1080)), Some(only));
    }
}
