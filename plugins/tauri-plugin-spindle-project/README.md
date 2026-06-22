# `tauri-plugin-spindle-project`

`tauri-plugin-spindle-project` is the Spindle workspace plugin that owns project-file schema handling, validation, and media inspection for Tauri apps.

It currently provides:

- project creation with sensible defaults
- JSON parsing and pretty-printed serialisation
- project validation for common authoring mistakes
- asset inspection via `ffprobe`
- source chapter extraction and compatibility detail reporting
- thumbnail extraction for asset previews
- build-plan generation and DVD build execution
- menu-navigation assistance, toolchain checks, diagnostics export, titleset-aware DVD navigation, and entry-menu-safe return routing

The plugin is used by the desktop app in this repository, but it is structured as a standalone Tauri plugin so the project domain logic can stay in one place.

## What it manages

The plugin works with the `SpindleProjectFile` schema, which includes:

- project metadata
- disc settings for DVD-Video authoring
- titlesets, titles, menus, and playback actions
- imported media assets and detected stream metadata
- build settings and validation issues

Schema JSON uses camelCase keys such as `schemaVersion`, `capacityTarget`, and `firstPlayAction`.

## Available commands

The plugin registers these invoke commands:

- `plugin:spindle-project|create_project`
- `plugin:spindle-project|parse_project`
- `plugin:spindle-project|serialise_project`
- `plugin:spindle-project|validate_project`
- `plugin:spindle-project|inspect_asset`
- `plugin:spindle-project|extract_thumbnail`
- `plugin:spindle-project|get_cache_dir`
- `plugin:spindle-project|generate_build_plan`
- `plugin:spindle-project|execute_build`
- `plugin:spindle-project|cancel_build`
- `plugin:spindle-project|auto_generate_menu_nav`
- `plugin:spindle-project|check_toolchain`
- `plugin:spindle-project|export_diagnostics`

### `create_project`

Creates a default project file from a small request payload.

```json
{
	"name": "Wedding DVD",
	"standard": "NTSC",
	"capacityTarget": "DVD5"
}
```

Returns a populated `SpindleProjectFile` with generated IDs, timestamps, one default titleset, and default build settings.

### `parse_project`

Parses a JSON string into a `SpindleProjectFile`.

- rejects malformed JSON
- rejects schema versions newer than the plugin supports
- leaves room for future migrations from older schema versions

### `serialise_project`

Serialises a `SpindleProjectFile` to pretty-printed JSON so the host app can write it to disk.

### `validate_project`

Validates a project and returns a list of `ValidationIssue` values. Current checks include:

- missing titlesets
- discs with no titles
- menus without buttons, actions, default buttons, or directional navigation
- titles without a source asset
- titles pointing at missing assets
- titles without a selected video stream
- titles without a selected video output profile
- titlesets with mismatched title output formats
- dangling subtitle mappings and unsupported text-only subtitle authoring
- discs with titles but no first-play action

### `inspect_asset`

Runs `ffprobe` against a media file and returns an `Asset` populated with:

- file name and source path
- file size and duration when available
- container format
- detected video, audio, and subtitle streams
- a coarse DVD compatibility assessment
- a lightweight fingerprint

`inspect_asset` requires `ffprobe` to be installed and available on `PATH`.

### `extract_thumbnail`

Extracts a thumbnail image for a video asset at a chosen timestamp.

### `get_cache_dir`

Returns the app cache directory used for thumbnail and other transient artefacts, creating the thumbnail cache directory if needed.

### `generate_build_plan`

Generates a dry-run `BuildPlan` for the current project and output directory.

### `execute_build`

Runs the generated build pipeline and emits progress updates while authoring the disc output.

The current DVD pipeline includes:

- VMGM-to-titleset menu routing through titleset `root` entry menus
- title end actions that return through legal menu-entry targets instead of direct titleset menu PGC calls
- explicit menu-entry button initialisation so authored menus open with deterministic keyboard focus

### `cancel_build`

Requests cancellation of the active build.

### `auto_generate_menu_nav`

Computes directional menu navigation based on button geometry.

### `check_toolchain`

Reports availability and detected versions for the external authoring tools.

### `export_diagnostics`

Builds a JSON diagnostics bundle containing toolchain information, validation issues, build logs, a project summary, and the active developer option flags used for export.

## Installation

Add the crate to your Tauri app:

```toml
[dependencies]
tauri-plugin-spindle-project = { path = "../../plugins/tauri-plugin-spindle-project" }
```

Register it in your Tauri builder:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_spindle_project::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

If you are using Tauri capabilities, include the default permission set:

```json
{
	"permissions": ["spindle-project:default"]
}
```

The default permission set enables the full command set registered by the plugin.

## Test coverage notes

The plugin's Rust tests now cover:

- domain-aware DVD command generation for VMGM, titleset menus, and title post actions
- titleset root-menu `g0` dispatch for non-root menu targets
- explicit default-button selection in authored menu `<pre>` blocks
- title returns to same-titleset and cross-titleset menus through menu-entry targets

There is also an ignored smoke test for the full external-tool path:

```bash
cargo test -p tauri-plugin-spindle-project execute_build_plan_smoke_authors_titleset_menu_return_path -- --ignored --nocapture
```

That smoke test requires `ffmpeg`, `spumux`, and `dvdauthor` to be available on `PATH`.

## JavaScript bindings

The plugin ships typed bindings in `tauri-plugin-spindle-project-api`, following the
same `guest-js` convention as `tauri-plugin-display-awareness`. App code should
import from the package rather than calling `invoke` with raw command strings:

```ts
import { createProject, parseProject, serialiseProject } from 'tauri-plugin-spindle-project-api';

const project = await createProject({
	name: 'Wedding DVD',
	standard: 'NTSC',
	capacityTarget: 'DVD5',
});
```

Parsing and saving typically look like this:

```ts
const parsed = await parseProject(json);
const serialised = await serialiseProject(parsed);
```

Validation and asset inspection use the same pattern:

```ts
const issues = await validateProject(project);
const asset = await inspectAsset('/media/clip.mpg');
```

Build planning and execution share a `BuildOptions` argument:

```ts
const options = {
	skipSidecar: false,
	skipUnsupportedStreams: false,
	quantizeOverlayPalette: false,
};

const plan = await generateBuildPlan(project, '/tmp/spindle-output', options);
const result = await executeBuild(project, '/tmp/spindle-output', options);
```

Subscribe to build progress instead of listening for the raw event name directly:

```ts
import { onBuildProgress } from 'tauri-plugin-spindle-project-api';

const unlisten = await onBuildProgress((progress) => {
	console.log(progress.currentLabel, progress.status);
});
```

Diagnostics export records the same developer-option context:

```ts
const diagnostics = await exportDiagnostics(project, buildLog, validationIssues, options);
```

## Types and schema notes

Important enum values currently include:

- `VideoStandard`: `NTSC`, `PAL`
- `CapacityTarget`: `DVD5`, `DVD9`
- `DiscFamily`: `dvd-video`
- `CopyMode`: `copy`, `re-encode`
- `CompatibilityAssessment`: `remux-compatible`, `transform-compatible`, `re-encode-required`, `unsupported`

The current schema version is `1`.

This plugin is presently focused on DVD-Video project authoring. Blu-ray and deeper migration support are planned work rather than current behaviour.

## Development notes

- desktop implementations live in `src/desktop.rs`
- media inspection and thumbnail extraction logic live in `src/inspect.rs`
- the build pipeline now lives under `src/build/` with a small `mod.rs` facade
- generated permission docs live in `permissions/autogenerated/`
- the mobile implementation is only a stub so the crate compiles across Tauri targets
