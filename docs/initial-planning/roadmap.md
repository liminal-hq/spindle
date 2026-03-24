# Spindle — Implementation Roadmap

## Where to start, where to go

This document ties together all the planning docs into a single, ordered roadmap for building Spindle from zero to a full DVD + Blu-ray + UHD BD disc authoring workstation. It's the "what order do I actually build this in" companion to the detailed [implementation plan](implementation_plan.md) and [libhdmv implementation plan](libhdmv_implementation_plan.md).

### Repositories

| Repo                                | Purpose                                     | When to create                          |
| ----------------------------------- | ------------------------------------------- | --------------------------------------- |
| `liminal-hq/spindle`                | Tauri desktop app (React + Rust)            | **Now** (exists)                        |
| `liminal-hq/libhdmv`                | Rust HDMV navigation/menu engine            | Start of BD work (Stage 3)              |
| `liminal-hq/tauri-plugin-workspace` | Tauri plugins including `tauri-plugin-hdmv` | **Exists** — add hdmv plugin in Stage 3 |

### Notation

Each stage groups work that delivers a usable milestone. Within each stage, items are ordered by dependency. Cross-references to the detailed plans use `[impl §X]` for the implementation plan and `[hdmv §X]` for the libhdmv plan.

---

## Stage 1 — DVD Authoring (v1)

**Goal:** Ship a working DVD-Video authoring tool. This is the foundation everything else builds on.

All work in `liminal-hq/spindle`.

### 1.0 — Project foundation

_[impl §Phase 0]_

- Scaffold Tauri v2 app with React frontend and Rust backend
- App shell with sidebar navigation matching mockup 01
- Rust command bridge with structured error propagation
- Project create/open/save (JSON format)
- Logging framework
- Sidecar packaging strategy for external tools (ffmpeg, ffprobe, dvdauthor, spumux)
- Format-backend architecture: `disc.family` field, shared vs backend-specific module boundary
- Linting, formatting, test harnesses, fixture management

**Exit:** App boots, creates a project, saves JSON, reopens it. Error model works end-to-end.

### 1.1 — Project schema and persistence

_[impl §Phase 1]_

- Versioned project schema v1 with stable IDs
- Core entities: Project, Disc, DiscFamily, Title, AssetRef, track mappings, Menu, Button, BuildSettings
- Migration scaffolding
- Schema separates shared authored concepts from DVD-specific fields
- `DiscFamily::DvdVideo` as initial value, with room for `BlurayDisc` and `UhdBluray` later

**Exit:** Project with placeholder titles/menus round-trips without loss. Schema can represent `disc.family = dvd-video` without implying DVD is the only target.

### 1.2 — Asset import and media inspection

_[impl §Phase 2]_

- Asset import flow: select files → register in project → queue inspection
- Media inspection via ffprobe sidecar: streams, codecs, resolution, frame rate, duration, language
- Compatibility classifier: remux-compatible / transform-compatible / re-encode-required / unsupported
- Source fingerprinting for cache invalidation and missing-asset detection
- Thumbnail extraction
- Frontend: Assets Library (mockup 03), Asset Inspector (mockup 04)

**Exit:** Import real media, see structured stream info and compatibility flags.

### 1.3 — Titles, groupings, and track mapping

_[impl §Phase 3]_

- Title creation from imported assets
- DVD titleset assignment (default + advanced)
- Stream mapping editor: video, audio (copy/re-encode), subtitles
- Per-title video output profile selection
- Per-audio-stream output target selection (AC-3, LPCM)
- Title ordering, end-action scaffolding
- Frontend: Titles Overview (mockup 05), Title Detail (mockup 06), Stream Mapping (mockup 07), Output Profiles (mockup 08)

**Exit:** Users can build an authored disc structure with explicit stream mappings.

### 1.4 — Chapter system

_[impl §Phase 4]_

- Manual chapter creation with timestamp editing
- Chapter ordering validation (increasing, within duration)
- Optional chapter names
- Chapter import stub for later extension
- Frontend: Chapters (mockup 09)

**Exit:** Each title can be chaptered and validated.

### 1.5 — Disc planner

_[impl §Phase 5]_

- Disc target selection: DVD-5 (4.7 GB), DVD-9 (8.5 GB)
- Estimated capacity usage from title durations + output profiles
- Per-title bitrate allocation (equal share / duration-weighted / priority-weighted)
- Quality warnings for overflow and risky bitrates
- Frontend: Disc Planner (mockup 13)

**Exit:** Users understand whether the project fits and how choices affect quality.

### 1.6 — Menu model and navigation

_[impl §Phase 6]_

- Menu/page entities with button model (bounds, label, action target, directional nav references)
- Navigation graph as first-class data structure
- Simple preview panel with arrow-key navigation
- Dead-end detection and validation
- Frontend: Menus Overview (mockup 10), Navigation Preview (mockup 12)

**Exit:** Menus defined structurally and tested behaviourally, even before the visual editor.

### 1.7 — Visual menu editor

_[impl §Phase 7]_

- Fixed-resolution canvas (720×480 / 720×576)
- Background image assignment
- Button placement, resizing, snap/alignment
- Safe-area guides
- Highlight/select state preview
- Auto-generate navigation from geometry
- Frontend: Menu Editor (mockup 11)

**Exit:** Users can visually create a menu and simulate remote navigation.

### 1.8 — Build planner and command generation

_[impl §Phase 8]_

- Build plan object: discrete jobs (inspect, resolve backend, transcode, convert subs, compose menus, author, validate, image)
- Dry-run mode with command preview
- Working directory layout
- Backend-aware build plan (DVD-specific steps isolated)
- Frontend: Build Configuration (mockup 14)

**Exit:** Users can view intended build steps without executing them.

### 1.9 — DVD build execution

_[impl §Phase 9]_

- Sidecar execution (ffmpeg, dvdauthor, spumux, mkisofs/genisoimage)
- Progress events during build
- Cancellation support
- VIDEO_TS export
- Structured logs with stderr/stdout capture
- Build summary
- Frontend: Build Progress (mockup 15), Logs & Diagnostics (mockup 16)

**Exit:** A project with one menu and titles builds to VIDEO_TS successfully.

### 1.10 — Verification, ISO, and hardening

_[impl §Phase 10]_

- ISO export option
- Diagnostics bundle export
- Incremental rebuild for unchanged assets
- Menu-only rebuild path
- Basic verification/QA scorecard
- Frontend: Verification & QA (mockup 17), Missing Assets / Relink (mockup 18), Settings & Toolchain (mockup 19)

**Exit:** Users can build VIDEO_TS + ISO with usable logs and basic quality confidence.

### v1 milestone

At this point, Spindle is a **usable DVD-Video authoring tool** on Linux. The architecture is clean: shared authored-disc concepts are separate from DVD-specific backend logic.

---

## Stage 2 — DVD Polish and Advanced Features

**Goal:** Harden v1, add power-user features, and prepare the shared layers for BD.

All work in `liminal-hq/spindle`.

### 2.1 — Advanced DVD features

- Hidden buttons and easter-egg navigation paths
- Conditional navigation / state flags
- Advanced program/cell editing
- Smarter subtitle conversion workflows (SRT → VobSub)

### 2.2 — Menu generation

- Autogenerated title/chapter/audio/subtitle menus from templates
- Theme system: separate menu structure from visual design
- Motion menu groundwork (still-image first, then motion timeline)

### 2.3 — Compatibility and verification

- Compatibility profile system (strict/permissive modes)
- Stronger verification passes with player-simulation checks
- Build result comparison against known-good reference outputs

### 2.4 — Shared layer preparation for BD

- Audit all shared layers for DVD-specific assumptions
- Ensure the format-backend trait boundary is clean
- Extend `DiscFamily` enum with `BlurayDisc` and `UhdBluray`
- Add BD-aware capacity tiers to the planner model (BD-25, BD-50, BD-66, BD-100)
- Extend stream coding type and video format enums for BD codecs (H.264, HEVC, DTS-HD MA, TrueHD, PGS)

---

## Stage 3 — Blu-ray Disc Support

**Goal:** Add standard Blu-ray (1080p) authoring as a second format backend.

Work spans all three repositories.

### 3.1 — `libhdmv` foundation (in `liminal-hq/libhdmv`)

_[hdmv §Phases 0–4]_

This is the core BD engine work, done in a standalone repo:

#### 3.1.0 — Workspace scaffold (1 week)

- Cargo workspace with 9 crate stubs
- CI, linting, fuzz infrastructure
- Synthetic BDMV test fixtures

#### 3.1.1 — Binary parsers + CLI inspector (3–4 weeks)

- `bdmv-io`: filesystem abstraction (folder, ISO)
- `bdmv-parse`: index.bdmv, MovieObject.bdmv, MPLS, CLPI, sound.bdmv
  - Version-tolerant: accept 0100, 0200, 0300 signatures
  - UHD BD-aware types from day one: `StreamCodingType::Hevc`, `VideoFormat::V2160p`, `DynamicRangeType`, `ColorSpace`
- `hdmv-insn`: 12-byte command decoder, instruction enums, disassembler
- `hdmv-inspect` CLI tool

#### 3.1.2 — HDMV VM (2–3 weeks)

- `hdmv-vm`: register file (4096 GPR, 128 PSR), instruction execution, event emission
- Deterministic trace/replay harness

#### 3.1.3 — IGS/PGS decode (3–4 weeks, parallel with 3.1.2)

- `igs`: IGS segment parser → pages/BOGs/buttons/effects/timeouts
- `pgs`: PGS segment parser → palette/RLE/composition
- `hdmv-render`: CPU reference compositor, PNG export

#### 3.1.4 — Menu scene engine (2–3 weeks)

- `hdmv-scene`: focus navigation, button activation, page transitions, popup toggle, timers, hit testing

### 3.2 — Tauri plugin (in `liminal-hq/tauri-plugin-workspace`)

_[hdmv §Phase 5a–5b]_

- Add `tauri-plugin-hdmv` crate to the workspace
- Git dependency on `libhdmv` umbrella crate
- Tauri commands for disc open/inspect/navigate/render
- TypeScript bindings (`@liminal-hq/tauri-plugin-hdmv`)
- Permissions/capabilities for filesystem access

### 3.3 — Spindle BD backend (in `liminal-hq/spindle`)

_[hdmv §Phase 5c]_

- Add BD format backend alongside DVD backend
- Format selector at project creation (mockup 20)
- BD Project Overview with playlists, BDMV health (mockup 02-bd)
- BD Playlists Overview (mockup 05-bd) and Playlist Detail (mockup 06-bd)
- BD Stream Mapping with HD codecs, AC-3 fallback auto-generation (mockup 07-bd)
- BD Output Profiles: H.264 AVC, DTS-HD MA, TrueHD, PGS (mockup 21)
- BD Chapters with PlayList marks (mockup 09-bd)
- BD Menus: top menu + popup menu, IG streams (mockups 10-bd, 11-bd, 22)
- BD Navigation Preview with colour keys and popup nav (mockup 12-bd)
- BD Disc Planner: BD-25/BD-50 capacity (mockup 23)
- BD Toolchain: tsMuxeR, BD Menu Compiler, BDMV Author (mockup 25)

### 3.4 — BD build pipeline (in `liminal-hq/spindle`)

- BD build configuration: BDMV output, tsMuxeR backend, ISO creation (mockup 14-bd)
- BD build progress: 12-phase pipeline — AC-3 fallback gen, H.264 encode, M2TS mux, IG compile, BDMV author (mockup 15-bd)
- BD Verification: BDMV structure checks, AVC compliance, audio fallback validation (mockup 24)
- tsMuxeR sidecar integration for M2TS muxing

### 3.5 — BD menu authoring (in `liminal-hq/libhdmv`)

_[hdmv §Phase 6]_

- IG authoring model: editable pages/buttons/images/palettes
- IG compiler: project → IGS segment stream
- BDMV structure generator: index.bdmv, MovieObject.bdmv, MPLS, CLPI, sound.bdmv
- Muxing integration: IGS PID multiplexing with tsMuxeR

### BD milestone

At this point, Spindle can author both **DVD-Video and Blu-ray Disc (1080p)** projects. The libhdmv engine handles BD menu preview, navigation simulation, and IGS compilation. The build pipeline produces playable BDMV folders and ISOs.

---

## Stage 4 — UHD Blu-ray (4K)

**Goal:** Extend BD support to 4K UHD Blu-ray.

The HDMV engine is unchanged for UHD BD (same VM, same IGS, same menus at 1080p upscaled). The work is primarily in:

### 4.1 — `libhdmv` UHD parsing (in `liminal-hq/libhdmv`)

_[hdmv §Phase 7]_

- Complete MPLS extension 3.5 parser for HDR10 static metadata
- Complete StreamCodingInfo extended fields for HEVC 0x24
- Dolby Vision enhancement layer SubPath parsing
- HDR10+ flag detection
- Generate 0300-version control files for authoring

### 4.2 — Spindle UHD integration (in `liminal-hq/spindle`)

- BD-66 and BD-100 capacity tiers in disc planner
- Higher bitrate ranges (up to 128 Mbit/s)
- HEVC Main 10 output profile with HDR parameters
- HDR10 static metadata editor: display primaries, luminance, MaxCLL, MaxFALL
- HDR metadata preservation in toolchain adapter (ffmpeg x265 parameters)
- Integration with Rust HDR tools: `hdr10plus_tool`, `dovi_tool` crates

### 4.3 — Dolby Vision support (in `liminal-hq/spindle`, later)

- Dolby Vision Profile 7 dual-layer workflow (base layer + enhancement layer)
- RPU metadata handling via `dovi_tool`
- SubPath generation for DV enhancement layers in MPLS
- Backward compatibility validation (BL must be valid HDR10)

### 4.4 — UHD verification

- HEVC stream compliance checks (Main 10, Level 5.1)
- HDR10 static metadata presence and validity
- AC-3 fallback verification (same as standard BD)
- BD-66/BD-100 bitrate limit enforcement
- Dolby Vision backward compatibility checks

### UHD milestone

Spindle now supports **DVD, Blu-ray, and UHD Blu-ray** authoring, including HDR10 and optionally Dolby Vision content.

---

## Stage 5 — Future Directions

These are not planned for initial development but are natural extensions:

### 5.1 — BD-J support

- Java Xlet-based menus via libbluray delegation
- ARGB overlay model (separate from HDMV's compressed YUV)
- This is a large, separate effort — only pursue if there's demand

### 5.2 — Multi-platform

- macOS and Windows builds of Spindle
- Platform-specific sidecar packaging (Homebrew, winget, bundled binaries)

### 5.3 — Advanced menu features

- Animated menu effects (in/out transitions, timed sequences)
- Multi-page chapter selection with automatic layout
- Sound effects for button focus/activation
- Motion menu timeline editor

### 5.4 — Workflow automation

- Project templates for common disc layouts
- Batch encoding profiles
- Watch folder for automatic asset import
- CLI mode for headless/scripted builds

---

## Decision log

Key architectural decisions and why they were made:

| Decision                                      | Why                                                                                                                       | Reference                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| DVD first, BD second                          | DVD authoring is more constrained and better documented; validates the shared/backend split before tackling BD complexity | [impl §2]                         |
| `libhdmv` in separate repo                    | Reusable beyond Spindle; independent versioning; clean dependency direction; fuzz-friendly                                | [hdmv §2]                         |
| Plugin in `tauri-plugin-workspace`            | Sits alongside other Liminal plugins; thin integration layer over libhdmv                                                 | [hdmv §2, Phase 5]                |
| HDMV only, no BD-J                            | BD-J is a separate runtime (JVM, ARGB, threading); HDMV covers the vast majority of authored discs                        | [HDMV research §comparison table] |
| No DRM / AACS                                 | Spindle is an authoring tool; encryption is applied at replication, not during authoring                                  | [HDMV research §UHD BD]           |
| UHD BD types from day one                     | Costs nothing to add `Hevc`, `V2160p`, `DynamicRangeType` enums now; avoids refactoring later                             | [hdmv §3, guiding principle 7]    |
| Parse/inspect before author                   | Reading is bounded and testable; authoring is larger and less documented                                                  | [hdmv §3, guiding principle 1]    |
| Event-driven VM                               | VM emits navigation events, doesn't control playback; keeps library reusable across frontends                             | [HDMV research §runtime model]    |
| Sidecar packaging                             | Deterministic tool versions; prevents dependency on user's system install                                                 | [toolchain note §2]               |
| Shared authoring language, separate compilers | DVD and BD share project/menu/chapter concepts but diverge at compilation                                                 | [DVD/BD arch note]                |

---

## Quick reference: doc index

| Document                                                                                                                                          | What it covers                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [implementation_plan.md](implementation_plan.md)                                                                                                  | Detailed Spindle implementation plan (DVD-focused, Phases 0–10)     |
| [libhdmv_implementation_plan.md](libhdmv_implementation_plan.md)                                                                                  | Detailed libhdmv crate architecture and phases (Phases 0–7)         |
| [HDMV research](HDMV%20for%20Blu-ray%20Disc-%20implementable%20architecture%20research%20for%20a%20Rust%20libhdmv%20and%20Tauri%20v2%20plugin.md) | HDMV architecture research, UHD BD considerations, ecosystem survey |
| [dvd_bd_architecture_note.md](dvd_bd_architecture_note.md)                                                                                        | Where DVD and BD share vs diverge architecturally                   |
| [toolchain_packaging_note.md](toolchain_packaging_note.md)                                                                                        | Sidecar packaging strategy for external tools                       |
| [ui_and_cli_planning.md](ui_and_cli_planning.md)                                                                                                  | UI screen definitions and CLI planning                              |
| [mockups/README.md](../../mockups/README.md)                                                                                                      | Mockup index with DVD→BD mapping guide                              |
