# Spindle CLI Plan

## Context

Spindle is a Tauri 2 desktop app for DVD (and eventually Blu-ray) authoring. All domain logic — project parsing, validation, build planning, build execution, asset inspection, and toolchain management — lives in the `tauri-plugin-spindle-project` crate. The Tauri command layer in `commands.rs` is a thin adapter that delegates to these functions.

A CLI would let us:

- Build `.spindle` project files without the UI
- Run validation and inspection from scripts or CI
- Test the authoring pipeline end-to-end without launching a webview
- Diagnose toolchain issues quickly

---

## Approach: Two-pronged — Tauri CLI plugin + standalone binary

Tauri 2 has a [built-in CLI plugin](https://v2.tauri.app/plugin/cli/) backed by clap. It lets the Tauri app itself accept subcommands — when the user runs `spindle build project.spindle`, the app can detect CLI args at startup, do the work, and exit without creating a window. This is useful for the **distributed/bundled** app since it already ships sidecar binaries (dvdauthor, spumux, genisoimage) and knows where they are.

Separately, a **standalone `spindle-cli` binary** (no Tauri runtime, no webview) gives us a lightweight dev/CI tool that depends only on the plugin's domain logic and system-installed tools.

Both share the same underlying code paths; the difference is packaging and sidecar resolution.

### Why both?

| | Tauri CLI mode | Standalone `spindle-cli` |
|---|---|---|
| **Sidecar access** | Yes — bundled tools resolved automatically | No — uses system PATH only |
| **Ships with app** | Yes — same binary | Separate build artifact |
| **Startup weight** | Heavier (Tauri runtime initialises) | Light (~2 MB, no webview) |
| **Use case** | End-user automation, post-install scripting | Dev workflow, CI, testing |
| **Window** | Hidden (no window created) | N/A |

---

## Part A — Tauri CLI plugin integration

### A.1 — Add `tauri-plugin-cli` dependency

**`apps/spindle/src-tauri/Cargo.toml`:**

```toml
[dependencies]
tauri-plugin-cli = "2"
```

**`apps/spindle/package.json`:**

```json
"dependencies": {
  "@tauri-apps/plugin-cli": "^2"
}
```

### A.2 — Define CLI schema in `tauri.conf.json`

Add a `plugins.cli` section:

```json
{
  "plugins": {
    "cli": {
      "description": "Spindle — optical disc authoring workstation",
      "subcommands": {
        "build": {
          "description": "Build a project to DVD structure and/or ISO",
          "args": [
            {
              "name": "project",
              "index": 1,
              "description": "Path to .spindle project file",
              "required": true,
              "takesValue": true
            },
            {
              "name": "output",
              "short": "o",
              "description": "Output directory (overrides project buildSettings)",
              "takesValue": true
            },
            {
              "name": "iso",
              "long": "iso",
              "description": "Generate ISO image after authoring"
            },
            {
              "name": "skip-unsupported",
              "long": "skip-unsupported",
              "description": "Skip subtitle streams that can't be authored"
            },
            {
              "name": "dry-run",
              "long": "dry-run",
              "description": "Generate build plan without executing"
            }
          ]
        },
        "validate": {
          "description": "Validate a project file and report issues",
          "args": [
            {
              "name": "project",
              "index": 1,
              "description": "Path to .spindle project file",
              "required": true,
              "takesValue": true
            },
            {
              "name": "format",
              "short": "f",
              "description": "Output format: text (default), json",
              "takesValue": true
            }
          ]
        },
        "inspect": {
          "description": "Inspect a media file and print stream information",
          "args": [
            {
              "name": "path",
              "index": 1,
              "description": "Path to media file",
              "required": true,
              "takesValue": true
            },
            {
              "name": "format",
              "short": "f",
              "description": "Output format: text (default), json",
              "takesValue": true
            }
          ]
        },
        "toolchain": {
          "description": "Check availability of external tools (ffmpeg, dvdauthor, etc.)",
          "args": []
        },
        "diagnostics": {
          "description": "Export a diagnostics bundle for troubleshooting",
          "args": [
            {
              "name": "project",
              "index": 1,
              "description": "Path to .spindle project file (optional)",
              "takesValue": true
            },
            {
              "name": "output",
              "short": "o",
              "description": "Output file path (default: stdout)",
              "takesValue": true
            }
          ]
        }
      }
    }
  }
}
```

### A.3 — Handle CLI args in `lib.rs` startup

Modify `apps/spindle/src-tauri/src/lib.rs` to intercept CLI subcommands before creating the window:

```rust
use tauri_plugin_cli::CliExt;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_spindle_project::init())
        // ... other plugins ...
        .setup(|app| {
            // Check if we were invoked with a CLI subcommand
            if let Ok(matches) = app.cli().matches() {
                if let Some((subcommand, sub_matches)) = matches.subcommand {
                    // Run CLI handler — this blocks, prints output, then exits
                    let code = cli::handle_subcommand(&subcommand, &sub_matches, app);
                    std::process::exit(code);
                }
            }
            // No subcommand — proceed with normal GUI startup
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Spindle");
}
```

### A.4 — CLI handler module

Create `apps/spindle/src-tauri/src/cli.rs`:

```rust
use tauri::App;
use tauri_plugin_cli::Matches;
use tauri_plugin_spindle_project::{self as spindle, build, SpindleProjectExt};

pub fn handle_subcommand(name: &str, matches: &Matches, app: &App) -> i32 {
    match name {
        "build"       => cmd_build(matches, app),
        "validate"    => cmd_validate(matches, app),
        "inspect"     => cmd_inspect(matches),
        "toolchain"   => cmd_toolchain(),
        "diagnostics" => cmd_diagnostics(matches),
        _ => {
            eprintln!("Unknown subcommand: {name}");
            1
        }
    }
}
```

Each `cmd_*` function:
1. Extracts arguments from `Matches`
2. Calls the plugin's domain functions directly
3. Prints output to stdout/stderr
4. Returns an exit code (0 = success)

### A.5 — Window suppression

When a CLI subcommand is detected, the app calls `std::process::exit()` in `setup()` before the window is created. Tauri's window configuration in `tauri.conf.json` stays as-is — the window simply never opens.

Alternative: if `setup()` exit timing is tricky, set the window's `visible: false` in config and only show it programmatically when no CLI subcommand is present.

---

## Part B — Standalone `spindle-cli` binary

### B.1 — Extract domain logic from Tauri coupling

Currently, some functions are unnecessarily behind the `SpindleProject<R>` Tauri wrapper. These need to be made callable without an `AppHandle`:

| Function | Current location | Tauri coupling |
|---|---|---|
| `create_project(req)` | `desktop.rs` → `SpindleProject<R>` | None (doesn't use `self`) |
| `parse_project(json)` | `desktop.rs` → `SpindleProject<R>` | None |
| `serialise_project(project)` | `desktop.rs` → `SpindleProject<R>` | None |
| `validate_project(project)` | `desktop.rs` → `SpindleProject<R>` | None |
| `inspect(path)` | `inspect.rs` (private module) | None |
| `extract_thumbnail(...)` | `inspect.rs` (private module) | None |
| `generate_build_plan(...)` | `build/planner.rs` (pub) | None |
| `execute_build_plan(plan, cb)` | `build/executor.rs` (pub) | None |
| `cancel_build()` | `build/executor.rs` (pub) | None |
| `auto_generate_navigation(menu)` | `build/navigation.rs` (pub) | None |
| `resolve_tool(name, skip)` | `toolchain.rs` (pub) | None |

**Key observation:** None of these functions actually use the Tauri runtime. They're behind the `SpindleProject<R>` wrapper only because that's how Tauri plugins are structured.

**Refactoring plan:**

1. **Make `inspect` module public** — change `mod inspect` to `pub mod inspect` in `lib.rs`

2. **Add free functions** that mirror the `SpindleProject` methods but without requiring `self`:

   ```rust
   // In a new `core.rs` or directly in existing modules:
   pub fn create_project(req: CreateProjectRequest) -> Result<SpindleProjectFile> { ... }
   pub fn parse_project(json: &str) -> Result<SpindleProjectFile> { ... }
   pub fn serialise_project(project: &SpindleProjectFile) -> Result<String> { ... }
   pub fn validate_project(project: &SpindleProjectFile) -> Result<Vec<ValidationIssue>> { ... }
   ```

   The `SpindleProject<R>` methods then delegate to these free functions, keeping backward compatibility.

3. **Re-export from `lib.rs`**:

   ```rust
   pub mod build;
   pub mod inspect;
   pub mod toolchain;
   pub use models::*;
   pub use error::{Error, Result};

   // Free functions for CLI / non-Tauri use:
   pub use core::{create_project, parse_project, serialise_project, validate_project};
   ```

### B.2 — Feature-gate Tauri dependency

The plugin crate currently unconditionally depends on `tauri`. For the standalone CLI, we need the domain logic without pulling in the Tauri runtime.

**`plugins/tauri-plugin-spindle-project/Cargo.toml`:**

```toml
[features]
default = ["tauri-plugin"]
tauri-plugin = ["dep:tauri", "dep:tauri-plugin"]

[dependencies]
tauri = { version = "2", optional = true }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }

[build-dependencies]
tauri-plugin = { version = "2", features = ["build"], optional = true }
```

Then gate Tauri-specific code with `#[cfg(feature = "tauri-plugin")]`:

```rust
// lib.rs
#[cfg(feature = "tauri-plugin")]
mod commands;
#[cfg(feature = "tauri-plugin")]
#[cfg(desktop)]
mod desktop;
#[cfg(feature = "tauri-plugin")]
#[cfg(mobile)]
mod mobile;

// Always available:
pub mod build;
pub mod inspect;
pub mod models;
pub mod toolchain;
pub mod error;
```

This is a moderate refactor but cleanly separates concerns. The `build.rs` build script also needs gating since `tauri-plugin` won't be present.

### B.3 — New workspace member: `spindle-cli`

**`Cargo.toml` (workspace root):**

```toml
[workspace]
members = [
    "apps/spindle/src-tauri",
    "plugins/tauri-plugin-spindle-project",
    "spindle-cli",
]
```

**`spindle-cli/Cargo.toml`:**

```toml
[package]
name = "spindle-cli"
version = "0.1.0"
edition = "2021"
description = "Command-line interface for Spindle disc authoring"

[[bin]]
name = "spindle"
path = "src/main.rs"

[dependencies]
tauri-plugin-spindle-project = { path = "../plugins/tauri-plugin-spindle-project", default-features = false }
clap = { version = "4", features = ["derive"] }
serde_json = "1"
colored = "2"        # Terminal colours for validation output
indicatif = "0.17"   # Progress bars for builds
```

### B.4 — CLI structure

**`spindle-cli/src/main.rs`:**

```rust
use clap::{Parser, Subcommand};

mod commands;

#[derive(Parser)]
#[command(name = "spindle", version, about = "Spindle disc authoring CLI")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Build a .spindle project to DVD structure and/or ISO
    Build {
        /// Path to .spindle project file
        project: String,
        /// Output directory (overrides project settings)
        #[arg(short, long)]
        output: Option<String>,
        /// Generate ISO image after authoring
        #[arg(long)]
        iso: bool,
        /// Skip subtitle streams that can't yet be authored
        #[arg(long)]
        skip_unsupported: bool,
        /// Show the build plan without executing
        #[arg(long)]
        dry_run: bool,
        /// Print verbose build output
        #[arg(short, long)]
        verbose: bool,
    },
    /// Validate a project file and report issues
    Validate {
        /// Path to .spindle project file
        project: String,
        /// Output format
        #[arg(short, long, default_value = "text")]
        format: OutputFormat,
    },
    /// Inspect a media file and print stream information
    Inspect {
        /// Path to media file
        path: String,
        /// Output format
        #[arg(short, long, default_value = "text")]
        format: OutputFormat,
    },
    /// Check availability of external tools
    Toolchain,
    /// Export a diagnostics bundle
    Diagnostics {
        /// Path to .spindle project file
        project: Option<String>,
        /// Write to file instead of stdout
        #[arg(short, long)]
        output: Option<String>,
    },
    /// Auto-generate button navigation for a project's menus
    AutoNav {
        /// Path to .spindle project file (modified in-place)
        project: String,
    },
}

#[derive(Clone, clap::ValueEnum)]
enum OutputFormat {
    Text,
    Json,
}

fn main() {
    let cli = Cli::parse();
    let code = match cli.command {
        Commands::Build { .. }       => commands::build::run(/* args */),
        Commands::Validate { .. }    => commands::validate::run(/* args */),
        Commands::Inspect { .. }     => commands::inspect::run(/* args */),
        Commands::Toolchain          => commands::toolchain::run(),
        Commands::Diagnostics { .. } => commands::diagnostics::run(/* args */),
        Commands::AutoNav { .. }     => commands::autonav::run(/* args */),
    };
    std::process::exit(code);
}
```

### B.5 — Command implementations

Each command module follows the same pattern:

1. Read input (project file from disk, media path)
2. Call the plugin's domain function
3. Format output (text or JSON)
4. Print to stdout, errors to stderr
5. Return exit code

**Example — `commands/build.rs`:**

```rust
use tauri_plugin_spindle_project::{self as spindle, build};

pub fn run(project_path: &str, output: Option<&str>, dry_run: bool, ...) -> i32 {
    // 1. Load project
    let json = match std::fs::read_to_string(project_path) {
        Ok(j) => j,
        Err(e) => { eprintln!("Failed to read project: {e}"); return 1; }
    };
    let project: spindle::SpindleProjectFile = match serde_json::from_str(&json) {
        Ok(p) => p,
        Err(e) => { eprintln!("Failed to parse project: {e}"); return 1; }
    };

    // 2. Determine output directory
    let output_dir = output
        .map(String::from)
        .unwrap_or_else(|| project.build_settings.output_directory.clone());

    // 3. Generate plan
    let plan = match build::generate_build_plan_with_options(
        &project, &output_dir, /*skip_sidecar=*/true, skip_unsupported
    ) {
        Ok(p) => p,
        Err(e) => { eprintln!("Plan generation failed: {e}"); return 1; }
    };

    if dry_run {
        // Print plan summary and dvdauthor XML
        println!("{} jobs planned:", plan.jobs.len());
        for (i, job) in plan.jobs.iter().enumerate() {
            println!("  [{}/{}] {}", i + 1, plan.jobs.len(), job.label());
        }
        return 0;
    }

    // 4. Execute with progress bar
    let pb = indicatif::ProgressBar::new(plan.jobs.len() as u64);
    let result = build::execute_build_plan(&plan, |progress| {
        pb.set_position(progress.job_index as u64);
        pb.set_message(progress.current_label.clone());
    });
    pb.finish();

    // 5. Report result
    if result.success {
        println!("Build complete: {}", result.output_directory);
        if let Some(iso) = &result.iso_path {
            println!("ISO: {iso}");
        }
        0
    } else {
        eprintln!("Build failed: {}", result.error_message.unwrap_or_default());
        1
    }
}
```

**Example — `commands/validate.rs`:**

```rust
pub fn run(project_path: &str, format: OutputFormat) -> i32 {
    let project = load_project(project_path)?;
    let issues = spindle::validate_project(&project);

    match format {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&issues).unwrap()),
        OutputFormat::Text => {
            if issues.is_empty() {
                println!("No issues found.");
            } else {
                for issue in &issues {
                    let icon = match issue.severity {
                        IssueSeverity::Error   => "ERROR",
                        IssueSeverity::Warning => "WARN ",
                        IssueSeverity::Info    => "INFO ",
                    };
                    println!("[{icon}] {}: {}", issue.code, issue.message);
                }
            }
        }
    }

    // Exit 1 if there are errors (not just warnings)
    if issues.iter().any(|i| matches!(i.severity, IssueSeverity::Error)) { 1 } else { 0 }
}
```

---

## Part C — Refactoring steps (ordered)

This is the implementation sequence. Each step is independently committable.

### Step 1: Extract free functions from `SpindleProject<R>` methods

Move the logic out of `desktop.rs`'s `impl SpindleProject<R>` into free functions. The `SpindleProject` methods become one-line wrappers.

**New file:** `plugins/tauri-plugin-spindle-project/src/core.rs`

```rust
use crate::models::*;
use crate::Result;

pub fn create_project(req: CreateProjectRequest) -> Result<SpindleProjectFile> {
    let mut project = SpindleProjectFile::default();
    project.project.name = req.name;
    project.disc.standard = req.standard;
    project.disc.capacity_target = req.capacity_target;
    Ok(project)
}

pub fn parse_project(json: &str) -> Result<SpindleProjectFile> {
    let raw: serde_json::Value = serde_json::from_str(json)?;
    if let Some(version) = raw.get("schemaVersion").and_then(|v| v.as_u64()) {
        let version = version as u32;
        if version > SCHEMA_VERSION {
            return Err(crate::Error::SchemaVersionTooNew {
                found: version,
                supported: SCHEMA_VERSION,
            });
        }
    }
    let project: SpindleProjectFile = serde_json::from_value(raw)?;
    Ok(project)
}

pub fn serialise_project(project: &SpindleProjectFile) -> Result<String> {
    Ok(serde_json::to_string_pretty(project)?)
}

pub fn validate_project(project: &SpindleProjectFile) -> Result<Vec<ValidationIssue>> {
    // Move validation logic here from desktop.rs
    ...
}
```

**Updated `desktop.rs`:**

```rust
impl<R: Runtime> SpindleProject<R> {
    pub fn create_project(&self, req: CreateProjectRequest) -> crate::Result<SpindleProjectFile> {
        crate::core::create_project(req)
    }
    pub fn parse_project(&self, json: &str) -> crate::Result<SpindleProjectFile> {
        crate::core::parse_project(json)
    }
    // ...
}
```

**Files changed:** `core.rs` (new), `desktop.rs` (simplified), `lib.rs` (add `pub mod core`)

### Step 2: Make `inspect` module public

Change `mod inspect` → `pub mod inspect` in `lib.rs`. No other changes needed — the functions are already `pub`.

### Step 3: Feature-gate Tauri-specific code

Add the `tauri-plugin` feature to `Cargo.toml`. Gate `desktop.rs`, `mobile.rs`, `commands.rs`, the `SpindleProjectExt` trait, and the `init()` function behind `#[cfg(feature = "tauri-plugin")]`. Gate the `build.rs` build script similarly.

This is the most invasive step but is mechanically straightforward — every Tauri-touching item gets a `cfg` gate.

### Step 4: Add `spindle-cli` workspace member

Create `spindle-cli/` with `Cargo.toml`, `src/main.rs`, and command modules. Wire up clap, implement the subcommands. Add to workspace `members`.

### Step 5: Add `tauri-plugin-cli` to the Tauri app

Add the plugin dependency, define the CLI schema in `tauri.conf.json`, add the startup intercept in `lib.rs`, create the `cli.rs` handler module. This runs in parallel with step 4 since it's the other prong.

### Step 6: Add `--format json` output to all commands

Machine-readable output for scripting. JSON output mode uses the same serde types the frontend already consumes.

---

## CLI command reference (target)

```
spindle build <project.spindle> [--output <dir>] [--iso] [--skip-unsupported] [--dry-run] [-v]
spindle validate <project.spindle> [--format text|json]
spindle inspect <media-file> [--format text|json]
spindle toolchain
spindle diagnostics [<project.spindle>] [--output <file>]
spindle autonav <project.spindle>
```

### `spindle build`

Loads the project, generates a build plan, executes it. With `--dry-run`, prints the plan and exits. Progress is shown as a terminal progress bar.

Exit codes: 0 = success, 1 = build error, 2 = validation errors prevent build.

### `spindle validate`

Runs the full validation suite and prints issues. Exit 0 if no errors (warnings OK), exit 1 if errors found.

### `spindle inspect`

Runs ffprobe on a media file and prints stream info. Text mode shows a human-readable table; JSON mode outputs the full `Asset` struct.

### `spindle toolchain`

Prints a table of all external tools with their availability and version. Exit 1 if any required tool is missing.

### `spindle diagnostics`

Generates the same diagnostics JSON bundle that the UI exports, optionally including project data. Useful for filing bug reports.

### `spindle autonav`

Loads a project, runs `auto_generate_navigation()` on every menu, writes the updated project back. Useful for batch-fixing navigation.

---

## Effort estimate

| Step | Work | Scope |
|------|------|-------|
| 1 — Extract free functions | Move ~500 LOC of validation from `desktop.rs` into `core.rs` | Small-medium |
| 2 — Public inspect module | One-line change | Trivial |
| 3 — Feature-gate Tauri | `cfg` annotations across 4 files, conditional `build.rs` | Medium |
| 4 — `spindle-cli` crate | New crate, clap setup, 6 command modules | Medium |
| 5 — Tauri CLI plugin | Plugin setup, config, startup intercept, handler module | Small-medium |
| 6 — JSON output formatting | Text formatters for validate, inspect, toolchain | Small |

Steps 1–3 are prerequisites. Steps 4 and 5 can be done in parallel. Step 6 is polish.

Total: roughly 3–4 days of focused work. Step 3 (feature gating) is the riskiest since it touches the plugin's build system, but the domain logic is already cleanly separated so it's mostly mechanical.

---

## Open questions

1. **Binary name:** Should the standalone CLI be called `spindle` (conflicting with the GUI app) or `spindle-cli`? The Tauri app's binary is already named `spindle`. Options:
   - CLI is `spindle-cli`, GUI is `spindle` (clearest)
   - CLI is `spindle`, GUI is `spindle-desktop` (unusual for Tauri apps)
   - Both are `spindle`, installed to different paths (confusing)

2. **Feature gate vs separate crate:** An alternative to feature-gating `tauri` in the plugin is to extract domain logic into a third crate (`spindle-core`) that both the plugin and CLI depend on. This avoids the `cfg` complexity but adds another workspace member. Trade-off: more crates vs simpler conditional compilation.

3. **Sidecar resolution in CLI:** The standalone CLI always uses `skip_sidecar = true` (system PATH only). Should we add a `--sidecar-dir <path>` flag for cases where someone has the bundled tools extracted somewhere?

4. **Should `autonav` write back to the project file?** This modifies the `.spindle` file in-place. Alternatively, it could print to stdout and let the user redirect. In-place is more useful but destructive — maybe require `--in-place` flag.
