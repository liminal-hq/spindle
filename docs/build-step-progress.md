# Build Step Progress

## Overview

The build page shows a secondary progress bar for long-running build jobs that can report sub-operation progress. The primary target is FFmpeg title transcodes, where the bar shows estimated completion and elapsed media time.

Jobs that cannot report step-level progress show only the existing overall build bar. The step-progress interface is generic — any future job type can use the same fields.

## Step-Progress Protocol

The `BuildProgress` event payload includes four optional step-level fields alongside the existing job-level fields:

| Field         | Type                                                        | Description                                                                                                                                |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `stepLabel`   | `string \| null`                                            | Short name for the active sub-operation (e.g. "FFmpeg transcode"). Displayed as the secondary bar's label.                                 |
| `stepPercent` | `number \| null`                                            | Estimated completion of the sub-operation, clamped to 0–100. Drives the secondary bar width. Null when the job cannot report sub-progress. |
| `stepDetail`  | `string \| null`                                            | Freeform context such as the current media timestamp (`00:42:15`). Shown as muted text beside the secondary bar.                           |
| `stepStatus`  | `'starting' \| 'running' \| 'complete' \| 'failed' \| null` | Lifecycle state of the sub-operation. Lets the UI distinguish an active bar from one that has finished or errored.                         |

When all four are null, the UI renders only the overall build bar — identical to the behaviour before this feature.

### Rust type

`BuildProgress` in `plugins/tauri-plugin-spindle-project/src/build/types.rs` carries the optional fields with `#[serde(skip_serializing_if = "Option::is_none")]` so they are omitted from the JSON payload when unused. A `BuildProgress::job()` constructor creates events with all step fields set to `None`.

### TypeScript type

`BuildProgress` in `apps/spindle/src/types/project.ts` mirrors the Rust type with `?` optional properties.

## Duration Baseline

Step-progress percentages require a known total duration for the operation.

- **Title transcodes:** `BuildJob::TranscodeTitle` carries `duration_secs: Option<f64>`, threaded from `Asset.duration_secs` (populated by ffprobe at import time) through the build planner.
- **Menu renders:** `motion_duration_secs` on the menu model stores the configured motion loop length. This could serve as a duration baseline for `RenderMenu` step progress in a future pass.

## FFmpeg Progress Parsing

### Approach

FFmpeg commands are run with `-progress pipe:2`, which causes FFmpeg to emit structured key-value progress lines on stderr alongside its normal log output. The parser selectively extracts `out_time=` lines and ignores everything else.

### Parser module

`plugins/tauri-plugin-spindle-project/src/build/ffmpeg_progress.rs` provides:

- `extract_progress_value(line, key)` — matches a key-value line and returns the value portion.
- `parse_out_time_secs(value)` — parses an FFmpeg `HH:MM:SS.microseconds` timestamp into seconds. Rejects negative sentinel values (`-0:00:00.000000`).
- `step_percent(elapsed_secs, duration_secs)` — computes percentage clamped to 0–100. Returns `None` when duration is missing or zero.
- `format_timestamp(secs)` — formats seconds as `HH:MM:SS` for the step detail string.

### Streaming execution

`run_ffmpeg_command` in `executor.rs` replaces the blocking `run_command` path for `TranscodeTitle` jobs:

1. Injects `-progress pipe:2` into the FFmpeg argument list before the output path.
2. Spawns the process with `.spawn()` (not `.output()`), piping stderr.
3. Reads stderr line-by-line via `BufReader`.
4. Parses `out_time=` lines, computes percentage, and emits step-progress events.
5. Accumulates all stderr lines into the log buffer so build log output is preserved.
6. Checks the cancellation flag on each line and kills the child immediately if set.

Non-FFmpeg jobs (dvdauthor, mkisofs, spumux, etc.) continue using the existing `run_command` which blocks on `.output()`.

## Event Throttling

Step-progress events are emitted at most once per 500 ms (wall-clock, using `std::time::Instant`). This prevents flooding the Tauri event bridge and the frontend store with hundreds of updates per second during fast encodes while still producing visually smooth bar movement.

## Cancellation

The stderr reader loop checks `BUILD_CANCELLED` on every line. When cancellation is requested, it calls `.kill()` on the spawned `Child` handle and returns an error immediately. This makes cancellation responsive during long FFmpeg runs, whereas previously it could only take effect between jobs.

## Build Page UI

### Secondary progress bar

`BuildPage.tsx` renders a thinner secondary bar (6 px vs 8 px for the main bar) under the overall progress bar when `stepPercent` is present. The bar uses a distinct colour (`--colour-info`) to visually separate it from the main build progress.

Below the bar, a row shows:

- The step label on the left (e.g. "FFmpeg transcode")
- The step detail on the right in monospace (e.g. "00:42:15")

### Layout stability

The secondary bar section is conditionally rendered only when `stepPercent != null`. When it appears or disappears between jobs, the card grows or shrinks vertically but does not shift horizontally.

## Key Files

| File                                                                | Role                                          |
| ------------------------------------------------------------------- | --------------------------------------------- |
| `plugins/tauri-plugin-spindle-project/src/build/types.rs`           | `BuildProgress` and `BuildJob` types          |
| `plugins/tauri-plugin-spindle-project/src/build/ffmpeg_progress.rs` | FFmpeg stderr progress parser                 |
| `plugins/tauri-plugin-spindle-project/src/build/executor.rs`        | `run_ffmpeg_command`, `execute_build_plan`    |
| `plugins/tauri-plugin-spindle-project/src/build/planner.rs`         | Threads `duration_secs` into `TranscodeTitle` |
| `apps/spindle/src/types/project.ts`                                 | TypeScript `BuildProgress` interface          |
| `apps/spindle/src/pages/BuildPage.tsx`                              | Secondary progress bar rendering              |
| `apps/spindle/src/pages/BuildPage.css`                              | Step bar styles                               |

## Future Work

- **Menu render progress:** Add step progress for `RenderMenu` jobs using `motion_duration_secs` as the duration baseline.
- **Other long jobs:** Any job type can use the step-progress fields — dvdauthor or ISO generation could report progress if they emit parseable output.
- **Global cancellation handle:** The current approach checks cancellation in the read loop. A global `Arc<Mutex<Option<Child>>>` would allow `cancel_build()` to kill the child without waiting for the next line read, but the current per-line check is responsive enough for FFmpeg's output rate.
