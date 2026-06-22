# tauri-plugin-display-awareness

Cross-platform monitor geometry for density-aware, responsive UIs.

## Purpose

Exposes per-monitor logical geometry (physical pixels divided by the OS
scale factor), scale factor, position, and best-effort physical size in
millimetres, plus an event fired when the active window's scale factor
changes (e.g. dragged to a different monitor).

This plugin is Spindle-agnostic — it has no dependency on
`tauri-plugin-spindle-project` or any Spindle-specific types, and could be
reused by any Tauri app that needs density-aware layout.

Logical geometry is the primary signal: the OS scale factor already encodes
the user's chosen UI density, so a responsive layout should key its
breakpoints off logical width, not physical pixels. Physical millimetre size
is reported best-effort via [`display-info`](https://crates.io/crates/display-info)
(`null` when the OS/EDID does not report it) and is not used to override the
OS scale.

## Commands

- `get_displays` — enumerate all connected displays.
- `get_active_display` — the display the current window resides on (falls
  back to the primary display, then the first enumerated one).

## Events

- `display://changed` — emitted on the window's `ScaleFactorChanged` event.

## JavaScript bindings

```ts
import {
	getDisplays,
	getActiveDisplay,
	onDisplayChanged,
} from 'tauri-plugin-display-awareness-api';
```

## Platform support

Linux (xcb/xrandr), Windows, and macOS via `display-info`. Physical
millimetre size may be unavailable on some Wayland sessions, VMs, and
panels with no EDID — treat `widthMm`/`heightMm` as optional.
