# Spindle tools

Standalone CLI utilities for development and debugging. Each tool lives in its
own crate under `tools/` and is part of the workspace.

## Building

Use the dev container image, which has the full Rust and Skia toolchain:

```sh
docker run --rm \
  -v $(pwd):/workspace \
  -w /workspace \
  ghcr.io/liminal-hq/tauri-dev-desktop:latest \
  cargo build -p spindle-menu-debug
```

Binaries land in `target/debug/`.

---

## `menu-debug`

**Crate:** [`tools/menu-debug`](menu-debug/)

Loads a `.spindle` project file and runs the full Skia rendering pipeline for
every menu, writing intermediate images to an output directory and printing font
and node diagnostics to stdout.

### What it produces

For each menu with an authored document:

| File                              | Description                                                      |
| --------------------------------- | ---------------------------------------------------------------- |
| `<menu-id>_scene.png`             | Raster scene PNG at render target dimensions (opaque background) |
| `<menu-id>_scene_transparent.png` | Transparent scene PNG used in the build pipeline                 |
| `<menu-id>_preview.png`           | DAR-corrected preview PNG at display-aspect dimensions           |

Stdout shows:

- Font resolution diagnostics — project-asset fonts vs system fonts
- Per-node font/style info — immediately reveals `null` `fontFamily` or `labelStyle`
- Render target (raster dimensions and SAR)

### Usage

```sh
./target/debug/menu-debug <project.spindle> [output-dir]
```

If `output-dir` is omitted, a `<project-stem>_menu_debug/` directory is created
next to the project file.

```sh
# Example — render Test Project to a debug directory
./target/debug/menu-debug \
  "/home/scott/Documents/Liminal HQ/Spindle/Projects/Test Project.spindle" \
  /tmp/debug_out
```

To also list system fonts (can be long):

```sh
MENU_DEBUG_SHOW_SYSTEM_FONTS=1 ./target/debug/menu-debug project.spindle
```

### Diagnosing font issues

The tool prints per-node font info. When a button or text node shows
`font: default (no label_style)` or `font: default 24px`, the corresponding
scene node has a null style in the project file — the Skia renderer falls back
to `TextStyle::default()` (Inter 14px).

To fix:

1. Select the node in the Spindle menu editor.
2. Change the font family in the inspector — this writes `labelStyle` (for
   buttons) or `fontFamily` (for text nodes) into the scene node.
3. Save the project. The style is now persisted and the build pipeline will
   use it.

For project-asset fonts (fonts you add to the project's asset list), the tool
reports them as `[project-asset]` in the font resolution section. System fonts
available in the build environment are listed when
`MENU_DEBUG_SHOW_SYSTEM_FONTS=1` is set.
