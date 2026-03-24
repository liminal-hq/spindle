# libhdmv Implementation Plan

## 1. Purpose

This document is the concrete implementation plan for `libhdmv`, a Rust-native HDMV navigation and menu engine, and its integration into Spindle as a Tauri v2 plugin. It translates the architecture research in [HDMV for Blu-ray Disc](HDMV%20for%20Blu-ray%20Disc-%20implementable%20architecture%20research%20for%20a%20Rust%20libhdmv%20and%20Tauri%20v2%20plugin.md) into phased, actionable work.

This plan complements the main [implementation plan](implementation_plan.md) and the [DVD/BD architecture note](dvd_bd_architecture_note.md). Where the main plan focuses on Spindle's DVD-first vertical slices, this plan covers the Blu-ray backend engine that will eventually plug into Spindle's format-backend layer.

---

## 2. Relationship to Spindle

Spindle's architecture separates **shared authored-disc concepts** from **format-specific backends**. `libhdmv` is the core of the BD backend — it owns:

- parsing and understanding existing BDMV disc structures
- HDMV VM execution and navigation logic
- Interactive Graphics (IGS) and Presentation Graphics (PGS) decoding
- menu preview rendering
- (later) BD menu authoring and BDMV structure generation

`libhdmv` is designed as a **standalone Rust workspace** in its own repository that Spindle consumes via a thin Tauri plugin. This means it can also be used by CLI tools, other applications, or for fuzzing/testing independently of Spindle.

### Repository structure

The work spans three repositories with a clean dependency direction:

```
github.com/liminal-hq/libhdmv              ← standalone Rust workspace (this plan)
    ↑
github.com/liminal-hq/tauri-plugin-workspace
    └─ tauri-plugin-hdmv                    ← thin Tauri command/event surface
    ↑
github.com/liminal-hq/spindle              ← Tauri app (consumes the plugin)
```

**`liminal-hq/libhdmv`** — Pure Rust library. No Tauri dependency. Owns all HDMV parsing, VM execution, IGS/PGS decoding, scene management, and rendering. Can be tested, fuzzed, and consumed from CLI tools independently.

**`liminal-hq/tauri-plugin-workspace` → `tauri-plugin-hdmv`** — Thin integration crate that sits alongside other Liminal Tauri plugins. Depends on `libhdmv`. Owns session lifecycle, JSON serialisation, Tauri permission/capability scoping, and preview image transport. Minimal logic.

**`liminal-hq/spindle`** — The authoring application. Depends on `tauri-plugin-hdmv`. Does not know or care about HDMV bytecodes, IGS segments, or register files — it calls plugin commands and renders results.

### Dependency management during development

Before `libhdmv` is published to crates.io, `tauri-plugin-hdmv` uses a git dependency:

```toml
# tauri-plugin-workspace/tauri-plugin-hdmv/Cargo.toml
[dependencies]
libhdmv = { git = "https://github.com/liminal-hq/libhdmv", branch = "main" }
```

For local development with sibling checkouts, a `[patch]` override in the plugin workspace root keeps iteration fast:

```toml
# tauri-plugin-workspace/Cargo.toml
[patch."https://github.com/liminal-hq/libhdmv"]
libhdmv = { path = "../libhdmv/crates/libhdmv" }
```

Similarly, Spindle uses a git dependency on the plugin workspace, with an optional path patch for local development.

### Logical architecture

```
Spindle (Tauri app)
  ├─ Shared authoring layer (titles, chapters, menus, planner)
  ├─ DVD backend (dvdauthor, spumux)
  └─ BD backend
       └─ tauri-plugin-hdmv ← calls into ──→ libhdmv workspace
                                                ├─ bdmv-io
                                                ├─ bdmv-parse
                                                ├─ hdmv-insn
                                                ├─ hdmv-vm
                                                ├─ igs
                                                ├─ pgs
                                                ├─ hdmv-scene
                                                ├─ hdmv-render
                                                └─ libhdmv (umbrella)
```

---

## 3. Guiding Principles

1. **Parse and inspect first, author later.** Reading existing disc structures is bounded and testable. Authoring (compiling IGS, generating BDMV metadata) is a much larger surface area with less public documentation.

2. **Event-driven VM, not fused playback.** The HDMV VM emits events (`PLAY_PL`, `SEEK_PM`, `SET_BUTTON_PAGE`, etc.) rather than directly controlling a playback pipeline. This keeps the library reusable across different frontends.

3. **Strongly typed, fuzz-hardened parsers.** Every binary format boundary (index.bdmv, MovieObject.bdmv, MPLS, CLPI, IGS segments, PGS segments) gets its own parser with newtype wrappers, length checks, and fuzz targets.

4. **No DRM.** AACS/BD+ decryption is explicitly out of scope. `libhdmv` operates on decrypted disc folders/ISOs. Encrypted content surfaces as a structured error, not a silent failure.

5. **No BD-J.** The Java-based BD application model (Xlets, JVM, ARGB overlays) is a separate runtime with fundamentally different threading and security characteristics. It may be integrated later via libbluray delegation, but is not part of `libhdmv`.

6. **No A/V codec decoding.** Video and audio decoding is delegated to ffmpeg/GStreamer/mpv. `libhdmv` only handles the navigation, control, and graphics overlay layers.

7. **UHD BD from the start in data models.** HDMV itself is identical on standard BD and UHD BD, but the metadata file versions (0300), stream coding types (HEVC 0x24), and extension data (HDR10, Dolby Vision sub-paths) differ. Parsers and enums should accommodate UHD BD structures from day one to avoid refactoring later, even if UHD-specific features are not the initial focus.

---

## 4. Crate Architecture

### 4.1 `bdmv-io` — Filesystem abstraction

**Purpose:** Abstract over BDMV source locations (folder on disk, mounted ISO, UDF image).

**Scope:**

- Path resolver for BDMV directory structure (`BDMV/`, `BDMV/BACKUP/`, `CERTIFICATE/`)
- Enumerate available playlists, clips, streams
- Fallback to `BDMV/BACKUP/` when primary files are missing or corrupt (matching libbluray behaviour)
- UDF read support (via `udf` crate or similar) for ISO images

**Key types:**

- `BdmvSource` — trait for filesystem access
- `FolderSource`, `IsoSource` — concrete implementations
- `BdmvLayout` — validated directory structure with known file paths

### 4.2 `bdmv-parse` — Binary metadata parsers

**Purpose:** Parse all BDMV control files into strongly typed Rust structures.

**Files parsed:**

- `index.bdmv` — disc index with First Play, Top Menu, and title entries (HDMV vs BD-J, access flags)
- `MovieObject.bdmv` — movie objects containing HDMV command sequences
- `*.mpls` — playlists (PlayItems, sub-paths, playmarks/chapters, stream entries)
- `*.clpi` — clip info (stream PIDs, access points, timing)
- `sound.bdmv` — button sound effects (AUXDATA)

**Design rules:**

- Signature and version validation (`INDX0100`/`INDX0200`/`INDX0300`, `MOBJ0100`/`MOBJ0200`/`MOBJ0300`, etc.)
- Accept multiple known versions (0100, 0200, 0300); surface unknown versions as warnings, not hard failures
- Version-aware field reading: 0300 files contain extension data blocks for HEVC/HDR that 0200 files do not
- Length-checked reads throughout — never trust file-declared sizes without bounds checking
- All parsers return `Result<T, ParseError>` with byte-offset context
- Extension data blocks: parse known extensions, preserve unknown extensions as raw bytes with logging

**Key types:**

- `DiscIndex` — titles, first play object, top menu object, optional HDR flags (0300)
- `TitleEntry` — object type (HDMV/BD-J), playback type, access flags
- `MovieObjectFile` — collection of `MovieObject`s, each a sequence of `HdmvCommand`s
- `Playlist` — PlayItems, playmarks, sub-paths, stream number tables, optional extension data (MPLS ext 3.5 for HDR10 static metadata)
- `ClipInfo` — stream PIDs, codec info, access unit timestamps
- `StreamCodingInfo` — codec-specific stream metadata, with extended fields for HEVC 0x24 (DynamicRangeType, ColorSpace, HDRPlusFlag)
- `VideoFormat` — enum including `V2160p` (value 8) for UHD BD alongside standard BD values
- `StreamCodingType` — enum including `Hevc = 0x24` alongside H.264 (0x1B), MPEG-2 (0x02), VC-1 (0xEA)
- `DynamicRangeType` — enum: `Sdr`, `Hdr10`, `DolbyVision`
- `ColorSpace` — enum: `Bt709`, `Bt2020`
- `SubPathType` — enum with known types (2–8) and `Unknown(u8)` fallback for future/DV-specific values

### 4.3 `hdmv-insn` — Instruction model

**Purpose:** Decode and represent the HDMV bytecode instruction set.

**Scope:**

- Decode 12-byte command words into structured instruction types
- Strongly typed instruction groups: `Branch`, `Compare`, `Set`
- Strongly typed subgroups and opcodes (e.g., `Branch::Goto`, `Branch::Jump`, `Branch::Play`, `Set::SetSystem`)
- `SetSystem` variants: `SetStream`, `SetNvTimer`, `SetButtonPage`, `EnableButton`, `DisableButton`, `PopupOff`, `StillOn`, `StillOff`, `SetOutputMode`, etc.
- Operand decoding with immediate-value flag handling
- Disassembler that produces human-readable instruction traces

**Key types:**

- `HdmvCommand` — raw 12-byte record
- `Instruction` — decoded instruction enum
- `Operand` — register reference or immediate value
- `InstructionGroup`, `BranchOp`, `CompareOp`, `SetOp`, `SetSystemOp` — strongly typed enums

### 4.4 `hdmv-vm` — Virtual machine

**Purpose:** Execute HDMV movie object command sequences and emit navigation events.

**Scope:**

- Register file: 4096 GPRs (32-bit unsigned), 128 PSRs (32-bit unsigned)
- Named PSR semantics: `IG_STREAM_ID`, `PRIMARY_AUDIO_ID`, `MENU_PAGE_ID`, `SELECTED_BUTTON_ID`, etc.
- Instruction execution: branch/compare/set with condition flags
- Event emission model — the VM does not perform playback; it emits:
  - `PlayTitle(TitleId)`
  - `PlayPlaylist(PlaylistId)`
  - `SeekPlayItem(PlayItemId)`
  - `SeekPlayMark(PlayMarkId)`
  - `PlayStop`
  - `Still(on/off)`
  - `SetButtonPage(PageId)`
  - `EnableButton(ButtonId)` / `DisableButton(ButtonId)`
  - `PopupOff`
- User Operation (UO) mask enforcement — gate permitted actions per movie object and per IG page
- Call stack for `CALL_OBJECT` / `RESUME` sequences
- Deterministic execution: given the same register state and commands, always produces the same event sequence

**Key types:**

- `RegisterFile` — GPR + PSR state
- `VmSession` — execution context (current object, program counter, call stack)
- `NavEvent` — enum of all events the VM can emit
- `UoMask` — bitflags for permitted user operations

### 4.5 `igs` — Interactive Graphics decoder

**Purpose:** Decode IGS bitstream segments into a concrete menu scene model.

**Scope:**

- Parse Interactive Composition segments from transport stream PES packets
- Decode into pages, each containing:
  - Page ID and version
  - UO mask table
  - In/out effect sequences (window definitions, composition objects)
  - Animation frame rate code
  - Default selected and activated button IDs
  - Palette reference
  - Button Overlap Groups (BOGs), each containing buttons
- Button model: three states (Normal, Selected, Activated), each referencing an object ID and position
- Navigation commands attached to button activation
- Composition and selection timeout PTS values
- Palette segment decoding (up to 256 entries, YCbCrA)
- Object segment decoding (RLE-compressed bitmap payloads)

**Key types:**

- `InteractiveComposition` — top-level decoded structure
- `IgPage` — single menu page
- `ButtonOverlapGroup` — group of mutually exclusive buttons
- `IgButton` — button with three state definitions and nav commands
- `ButtonState` — object reference + position for one visual state
- `IgPalette` — 256-entry colour table
- `IgObject` — decoded RLE bitmap

### 4.6 `pgs` — Presentation Graphics decoder

**Purpose:** Decode PGS subtitle streams into overlay surfaces.

**Scope:**

- Parse PGS segment types: Palette (0x14), Object (0x15), Presentation Composition (0x16), Window (0x17), Display (0x80)
- RLE bitmap decode into paletted surfaces
- Palette application (256-entry, YCbCrA → RGBA conversion)
- Composition state tracking (epoch start, acquisition point, normal)
- Window positioning and cropping

**Key types:**

- `PgsSegment` — parsed segment enum
- `PgsDisplaySet` — complete set of segments for one display update
- `PgsObject` — decoded bitmap
- `PgsPalette` — colour table
- `PgsComposition` — presentation state with object placements

### 4.7 `hdmv-scene` — UI-agnostic scene model

**Purpose:** Maintain the runtime state of HDMV menu navigation, independent of rendering.

**Scope:**

- Current page tracking (driven by `PSR_MENU_PAGE_ID`)
- Focus state (driven by `PSR_SELECTED_BUTTON_ID`)
- Button enable/disable state
- Focus navigation: directional key input → focus movement within BOGs
- Button activation → trigger navigation command sequence
- Page transitions with in/out effect state
- Popup menu toggle state
- Timer management (composition timeout, selection timeout, user timeout)
- Mouse/pointer hit testing against button bounds

**Key types:**

- `MenuScene` — current page, focus, button states, timers
- `SceneInput` — enum of user inputs (Up/Down/Left/Right, Select, TopMenu, PopupMenu, ColourKeys)
- `SceneUpdate` — description of what changed (focus moved, page changed, button activated, commands emitted)
- `HitTestResult` — which button (if any) is under a given coordinate

### 4.8 `hdmv-render` — Renderer abstraction

**Purpose:** Compose IGS/PGS overlays into renderable output.

**Scope:**

- Renderer trait: `trait HdmvRenderer` with methods for overlay composition
- Reference CPU compositor: palette lookup → RGBA buffer composition
- Support for rendering individual button states, full pages, and PGS overlays
- Thumbnail/preview generation at reduced resolution
- PNG/WebP export for Tauri plugin preview transport

**Key types:**

- `HdmvRenderer` — trait
- `CpuRenderer` — reference implementation
- `OverlayFrame` — RGBA buffer with dimensions and position
- `RenderRequest` — what to render (page, specific button state, PGS overlay)

### 4.9 `libhdmv` — Umbrella crate

**Purpose:** Re-export the stable public API surface. This is the crate that Spindle's Tauri plugin depends on.

**Public API surface:**

```rust
// Disc access
Disc::open(source: impl Into<BdmvSource>) -> Result<Disc, HdmvError>
Disc::index(&self) -> &DiscIndex
Disc::titles(&self) -> &[TitleEntry]
Disc::playlists(&self) -> Vec<PlaylistId>
Disc::playlist(&self, id: PlaylistId) -> Result<&Playlist, HdmvError>

// Navigation session
NavSession::new(disc: &Disc) -> NavSession
NavSession::start_first_play(&mut self) -> Vec<NavEvent>
NavSession::start_top_menu(&mut self) -> Vec<NavEvent>
NavSession::step(&mut self, now_pts: Pts90k) -> Vec<NavEvent>
NavSession::submit_key(&mut self, key: RemoteKey, now_pts: Pts90k) -> Vec<NavEvent>
NavSession::mouse_move(&mut self, x: u16, y: u16, now_pts: Pts90k) -> HitTestResult
NavSession::mouse_click(&mut self, x: u16, y: u16, now_pts: Pts90k) -> Vec<NavEvent>
NavSession::registers(&self) -> &RegisterFile
NavSession::current_page(&self) -> Option<&IgPage>
NavSession::menu_scene(&self) -> &MenuScene

// Rendering
NavSession::render_overlay(&self, renderer: &impl HdmvRenderer) -> OverlayFrame
NavSession::render_preview_png(&self, max_width: u32) -> Vec<u8>
```

---

## 5. Implementation Phases

### Phase 0 — Workspace scaffold and CI (1 week)

**Goal:** Working Rust workspace with CI, linting, and fuzz infrastructure in `liminal-hq/libhdmv`.

**Deliverables:**

- New `liminal-hq/libhdmv` repository with Cargo workspace containing all 9 crate stubs
- CI pipeline: `cargo check`, `cargo test`, `cargo clippy`, `cargo fmt`
- `cargo-fuzz` targets for `bdmv-parse`, `igs`, `pgs`
- Fixture directory structure: `testdata/bdmv/`, `testdata/igs/`, `testdata/pgs/`
- Minimal synthetic BDMV folder fixture (no menus, just valid structure)
- `README.md` with architecture overview

**Exit criteria:**

- `cargo test` passes across all crates
- Fuzz targets compile and run (even if no bugs found yet)

---

### Phase 1 — Binary parsers and CLI inspector (3–4 weeks)

**Goal:** Parse all BDMV control files and dump them as structured JSON.

**Deliverables:**

#### 1a: `bdmv-io` + `bdmv-parse` core

- `index.bdmv` parser with signature/version validation
- `MovieObject.bdmv` parser with command extraction
- MPLS parser (PlayItems, playmarks, stream entries)
- CLPI parser (stream PIDs, access points)
- `sound.bdmv` parser (button sound index)
- Fallback to `BDMV/BACKUP/` paths

#### 1b: `hdmv-insn`

- 12-byte command word decoder
- Complete instruction enum coverage (BRANCH/CMP/SET/SETSYSTEM)
- Text disassembler producing human-readable traces

#### 1c: `hdmv-inspect` CLI example

- `hdmv-inspect <bdmv-folder>` dumps:
  - Disc index (titles, first play, top menu)
  - Movie objects with disassembled commands
  - Playlist summaries (clips, chapters, streams)
  - Stream PID mappings
- JSON output mode for golden-test generation

**Testing:**

- Golden JSON tests for synthetic fixtures
- Fuzz all parsers with `cargo-fuzz`
- Version-tolerance tests (0100 and 0200 signatures)

**Exit criteria:**

- Can parse a real decrypted BDMV folder and produce correct structured output
- All parsers survive fuzz runs without panics

---

### Phase 2 — HDMV VM with event emission (2–3 weeks)

**Goal:** Execute movie object command sequences and produce navigation events.

**Deliverables:**

#### 2a: Register file and PSR model

- 4096 GPRs, 128 PSRs with named constants
- PSR read/write with value-range validation
- Register snapshot/restore for testing

#### 2b: VM executor

- Instruction dispatch for all BRANCH/CMP/SET groups
- Conditional execution (branch on compare result)
- Call stack for `CALL_OBJECT` / `RESUME`
- Event emission for all navigation actions
- UO mask enforcement
- Execution step limit (prevent infinite loops in malformed objects)

#### 2c: VM trace harness

- Instruction-by-instruction trace output (PC, instruction, register changes, events)
- Trace replay from JSON for regression testing
- Comparison harness for validating against libbluray traces (local only, not redistributed)

**Testing:**

- Synthetic movie objects exercising every instruction group
- Golden trace tests (instruction sequence → expected events)
- Edge cases: empty objects, max call depth, unknown opcodes (graceful skip)

**Exit criteria:**

- VM can execute First Play and Top Menu objects from a real disc and emit correct navigation events
- Trace output matches expected behaviour for all synthetic fixtures

---

### Phase 3 — IGS/PGS decode (3–4 weeks)

**Goal:** Decode Interactive Graphics and Presentation Graphics streams into usable scene models.

**Deliverables:**

#### 3a: PGS decoder (`pgs` crate)

- Segment parser for all 5 segment types
- RLE bitmap decompression
- Palette application (YCbCrA → RGBA)
- Display set assembly from segment sequences
- PTS-based timing

#### 3b: IGS decoder (`igs` crate)

- Interactive Composition segment parser
- Page/BOG/button extraction with all fields
- Button state object references (Normal/Selected/Activated)
- Navigation command extraction per button
- Effect sequence parsing (in/out effects, windows, composition objects)
- Timeout PTS values (composition, selection, user)
- Palette and object segment decoding (shared RLE with PGS)

#### 3c: Reference renderer (`hdmv-render` crate)

- CPU compositor: palette lookup + alpha blending onto RGBA buffer
- Render individual button states
- Render full page (all buttons in their current states)
- PGS subtitle overlay rendering
- PNG export for preview/testing

**Testing:**

- Synthetic IGS/PGS fixtures with known pixel output
- Golden image tests (rendered PNG hash comparison)
- Fuzz IGS and PGS segment parsers
- Round-trip: decode → render → compare against expected images

**Exit criteria:**

- Can decode IGS from a real disc and render all menu pages as correct PNG images
- PGS subtitle overlays render correctly

---

### Phase 4 — Menu scene engine (2–3 weeks)

**Goal:** Full interactive menu navigation with focus management, activation, and page transitions.

**Deliverables:**

#### 4a: Scene state machine (`hdmv-scene` crate)

- Page state tracking driven by PSR values
- Focus navigation: directional input → BOG traversal → focus movement
- Default button selection on page entry
- Button enable/disable management
- Button activation → extract and return navigation commands
- Popup menu toggle (show/hide)
- Timer management (composition/selection/user timeouts)

#### 4b: Input handling

- Remote key mapping: Up/Down/Left/Right, Select/OK, TopMenu, PopupMenu, Return, ColourKeys (R/G/Y/B)
- Mouse/pointer hit testing against button bounds
- Mouse select (hover) and mouse activate (click)

#### 4c: Integration with VM

- Wire VM `SET_BUTTON_PAGE` / `ENABLE_BUTTON` / `DISABLE_BUTTON` / `POPUP_OFF` events into scene engine
- Scene changes produce navigation commands that feed back into VM

**Testing:**

- Synthetic menu fixtures with known navigation graphs
- Automated navigation sequences: "press Down, Down, Right, Select" → verify final state
- Dead-end detection: verify all buttons are reachable
- Timer expiry tests

**Exit criteria:**

- Can load a real BD top menu, navigate with keyboard/mouse, activate buttons, and receive correct navigation events
- Popup menu toggle works correctly

---

### Phase 5 — Tauri plugin integration (2–3 weeks)

**Goal:** Expose `libhdmv` to Spindle's React frontend via a Tauri v2 plugin.

This phase spans all three repositories:

- `liminal-hq/libhdmv` — ensure the umbrella crate's public API is stable and well-documented
- `liminal-hq/tauri-plugin-workspace` — add `tauri-plugin-hdmv` as a new crate in the existing plugin workspace
- `liminal-hq/spindle` — consume the plugin and wire it into the BD backend

**Deliverables:**

#### 5a: `tauri-plugin-hdmv` crate (in `liminal-hq/tauri-plugin-workspace`)

- Add `tauri-plugin-hdmv` crate to the existing Tauri plugin workspace alongside other Liminal plugins
- Git dependency on `libhdmv` umbrella crate (with `[patch]` override for local development)
- Session lifecycle: open disc → create session → close session
- Commands:
  - `hdmv_open_disc(path) → SessionId`
  - `hdmv_close_disc(session)`
  - `hdmv_get_disc_info(session) → DiscSummary`
  - `hdmv_list_titles(session) → Vec<TitleInfo>`
  - `hdmv_list_playlists(session) → Vec<PlaylistInfo>`
  - `hdmv_get_playlist(session, id) → PlaylistDetail`
  - `hdmv_start_navigation(session) → Vec<NavEvent>`
  - `hdmv_send_key(session, key) → Vec<NavEvent>`
  - `hdmv_mouse_move(session, x, y) → HitTestResult`
  - `hdmv_mouse_click(session, x, y) → Vec<NavEvent>`
  - `hdmv_render_preview(session, max_width) → base64 PNG`
  - `hdmv_get_menu_state(session) → MenuSceneSnapshot`
  - `hdmv_get_vm_trace(session, limit) → Vec<TraceEntry>`
- Tauri permissions/capabilities for filesystem access scope
- Session management with cleanup on window close

#### 5b: NPM package (`@liminal-hq/tauri-plugin-hdmv`, in `liminal-hq/tauri-plugin-workspace`)

- TypeScript bindings generated from Rust command signatures
- Type-safe wrappers for all commands
- Event listener setup for async notifications
- Published alongside or as part of the plugin workspace's NPM packages

#### 5c: Integration with Spindle (in `liminal-hq/spindle`)

- Add `tauri-plugin-hdmv` dependency to Spindle's `src-tauri/Cargo.toml` (git dependency on `tauri-plugin-workspace`)
- Add `@liminal-hq/tauri-plugin-hdmv` to Spindle's frontend dependencies
- Wire plugin into Spindle's BD backend slot
- Connect to Navigation Preview screen (mockup 12-bd)
- Connect to disc inspection views

**Cross-repo coordination:**

- `libhdmv` must tag a stable release (or pin a commit) before the plugin depends on it in CI
- The plugin workspace's CI should test against `libhdmv` main to catch breaking changes early
- Spindle's CI should test against the plugin workspace's main for the same reason

**Testing:**

- End-to-end: open disc folder → inspect → navigate menu → render preview
- Permission boundary tests: ensure filesystem access is scoped
- Session lifecycle tests: multiple open/close cycles, concurrent sessions

**Exit criteria:**

- Spindle can open a decrypted BDMV folder, display disc info, and interactively navigate menus in the UI

---

### Phase 6 — Authoring foundation (4–6 weeks, future)

**Goal:** Enable creation of simple BD menus from authored content.

This phase is explicitly deferred until Phases 0–5 are stable. It is documented here for planning purposes.

**Deliverables:**

#### 6a: IG authoring model

- `IgProject` — editable menu project structure (pages, buttons, images, palette policies)
- Image import: button artwork for Normal/Selected/Activated states
- Palette quantisation: auto-reduce to 256-entry palette per page
- Navigation graph editor output → button nav commands

#### 6b: IG compiler

- Compile `IgProject` → IGS segment stream
- Generate palette segments, object segments (RLE compress), interactive composition segments
- Produce correctly timed PES packets for muxing

#### 6c: BDMV structure generator

- Generate `index.bdmv` with title entries
- Generate `MovieObject.bdmv` with navigation commands (First Play → Top Menu → Play Playlist)
- Generate MPLS files from playlist definitions
- Generate CLPI files from clip/stream metadata
- Generate `sound.bdmv` from imported sound effects
- Write `BDMV/BACKUP/` mirrors
- Validate output structure

#### 6d: Muxing integration

- Interface with tsMuxeR (or future Rust muxer) for M2TS generation
- Multiplex IGS PID(s) with video/audio streams
- Generate correct PCR/PTS/DTS timing

**Exit criteria:**

- Can author a simple top menu + popup menu with button navigation and compile to a valid, playable BDMV folder

---

### Phase 7 — UHD BD support (3–4 weeks, future)

**Goal:** Extend parsing, authoring, and Spindle integration to support 4K UHD Blu-ray.

This phase builds on the UHD BD-aware data models established in earlier phases. Since parsers already accept 0300 versions and HEVC stream types, this phase focuses on completing the UHD-specific features and integrating them into Spindle's authoring pipeline.

**Deliverables:**

#### 7a: Complete UHD BD parsing

- MPLS extension 3.5 parser for HDR10 static metadata (mastering display colour volume, content light levels)
- `StreamCodingInfo` extended field parsing for HEVC 0x24 (DynamicRangeType, ColorSpace, HDRPlusFlag)
- Dolby Vision enhancement layer SubPath parsing and validation
- HDR10+ flag detection in stream info
- UHD BD disc index HDR flags parsing

#### 7b: UHD BD authoring extensions

- Generate 0300-version control files (`INDX0300`, `MOBJ0300`, `MPLS0300`, `HDMV0300`)
- Write MPLS extension 3.5 blocks with HDR10 static metadata
- Generate CLPI entries with HEVC stream coding type 0x24 and extended fields
- SubPath generation for Dolby Vision enhancement layers

#### 7c: Spindle UHD BD integration

- BD-66 and BD-100 capacity tiers in the disc planner
- Higher bitrate ranges (up to 128 Mbit/s for BD-100)
- HEVC Main 10 output profile with HDR parameters (display primaries, luminance, MaxCLL, MaxFALL)
- HDR metadata preservation/generation in the toolchain adapter (ffmpeg x265 parameters)
- Dolby Vision dual-layer workflow (BL + EL + RPU)
- Integration with Rust ecosystem tools: `hdr10plus_tool` and `dovi_tool` crates for HDR metadata handling

#### 7d: UHD BD validation

- Verify HEVC stream compliance (Main 10, Level 5.1)
- Verify HDR10 static metadata presence and validity
- Verify AC-3 fallback presence (same requirement as standard BD)
- Verify Dolby Vision backward compatibility (BL must be valid HDR10)
- BD-66/BD-100 capacity and bitrate limit validation

**Exit criteria:**

- Can parse and inspect a real UHD BD folder with HDR10/DV content
- Can author a UHD BD with HEVC video and HDR10 metadata that plays on a UHD BD player

---

## 6. Validation Strategy

### Synthetic fixtures (repo-safe)

- Minimal BDMV folders generated with known-good tools (tsMuxeR for structure, hand-crafted binary files for edge cases)
- Tiny self-authored IGS/PGS display sets for parser testing
- Movie objects covering every instruction group and edge case
- All fixtures committed to `testdata/` with documentation

### Behavioural comparison (local-only)

- Compare VM event traces against libbluray using controlled test runs
- Compare rendered menu overlays against libbluray overlay output (perceptual diff or hash)
- Record input sequences and compare resulting focus/button states
- These tests require user-provided disc content and are not redistributed

### Golden tests

- **Golden JSON**: parsed structures (index, movie objects, playlists, decoded pages/buttons)
- **Golden traces**: VM execution (instruction-by-instruction with PSR/GPR changes)
- **Golden images**: composited overlay PNGs for deterministic IGS/PGS samples
- All golden files stored in `testdata/golden/` and checked by CI

### Fuzz testing

- `cargo-fuzz` targets for every binary parser
- Continuous fuzzing in CI (short runs per PR, longer runs nightly)
- Structured fuzzing with `arbitrary` crate for higher-level structures

---

## 7. Risk Assessment

### Risk 1 — Spec access gap

**Impact:** High. The BD-ROM "Blue Book" is not publicly available.

**Mitigation:** Use libbluray as the behavioural reference. Document every assumption with `[REVERSE-ENGINEERED]` provenance tags. Build a comprehensive test suite against real discs to catch spec-interpretation errors.

### Risk 2 — IGS behavioural fidelity

**Impact:** Medium-high. Correct menu behaviour depends on subtle rules around default button selection, enable/disable interaction, effect timing, and PSR-driven state restoration.

**Mitigation:** Implement incrementally. Start with static pages and basic navigation. Add effects and timers later. Validate against real discs with known menu behaviour. Maintain a compatibility matrix.

### Risk 3 — Version proliferation in control files

**Impact:** Medium. Real-world discs may use unexpected file versions or extension data.

**Mitigation:** Accept known versions (0100, 0200, 0300), surface unknown versions as warnings. Log and skip unknown extension data rather than failing. Collect version samples from user reports.

### Risk 4 — Authoring complexity

**Impact:** High for Phase 6. Compiling IGS display sets and generating correct BDMV metadata is substantially less documented than reading them.

**Mitigation:** Defer authoring until reading/preview is stable. Start with constrained authoring (simple static menus, no animated effects). Validate authored output by round-tripping through the parser/renderer.

### Risk 5 — Performance of overlay rendering

**Impact:** Medium. Full 1920×1080 RGBA overlay composition at interactive rates.

**Mitigation:** The reference CPU renderer targets preview/inspection, not real-time playback. For high-fidelity rendering, delegate to a GPU compositor (wgpu/skia) or to the video player's overlay pipeline. The renderer trait abstraction supports this.

---

## 8. Dependency Map

```
┌─────────────────────────────────────────────────────────┐
│  liminal-hq/libhdmv                                     │
│                                                         │
│  Phase 0: Workspace scaffold                            │
│      │                                                  │
│      v                                                  │
│  Phase 1: Parsers + CLI inspector                       │
│      │         (bdmv-io, bdmv-parse, hdmv-insn)         │
│      │                                                  │
│      ├────────────────┐                                 │
│      v                v                                 │
│  Phase 2: VM        Phase 3: IGS/PGS decode             │
│      (hdmv-vm)          (igs, pgs, hdmv-render)         │
│      │                │                                 │
│      └───────┬────────┘                                 │
│              v                                          │
│  Phase 4: Menu scene engine                             │
│      (hdmv-scene, integrates VM + IGS)                  │
│              │                                          │
│  Phase 6: Authoring (future, also in libhdmv)           │
│      (IG compiler, BDMV generator, mux integration)     │
│              │                                          │
│  Phase 7: UHD BD (future, also in libhdmv)              │
│      (0300 parsing, HEVC/HDR, DV sub-paths, BD-100)     │
└──────────────┼──────────────────────────────────────────┘
               │
┌──────────────v──────────────────────────────────────────┐
│  liminal-hq/tauri-plugin-workspace                      │
│                                                         │
│  Phase 5a: tauri-plugin-hdmv crate                      │
│  Phase 5b: @liminal-hq/tauri-plugin-hdmv NPM package   │
└──────────────┼──────────────────────────────────────────┘
               │
┌──────────────v──────────────────────────────────────────┐
│  liminal-hq/spindle                                     │
│                                                         │
│  Phase 5c: BD backend integration                       │
│      (wire plugin into Spindle UI)                      │
└─────────────────────────────────────────────────────────┘
```

Phases 2 and 3 can proceed in parallel once Phase 1 is complete. Phase 5 spans all three repos.

---

## 9. Timeline Estimate

| Phase              | Duration  | Dependencies              | Confidence  |
| ------------------ | --------- | ------------------------- | ----------- |
| 0 — Scaffold       | 1 week    | None                      | High        |
| 1 — Parsers + CLI  | 3–4 weeks | Phase 0                   | High        |
| 2 — VM             | 2–3 weeks | Phase 1                   | Medium-high |
| 3 — IGS/PGS decode | 3–4 weeks | Phase 1 (parallel with 2) | Medium-high |
| 4 — Menu scene     | 2–3 weeks | Phases 2 + 3              | Medium      |
| 5 — Tauri plugin   | 2–3 weeks | Phase 4                   | Medium-high |
| 6 — Authoring      | 4–6 weeks | Phase 5 stable            | Medium-low  |
| 7 — UHD BD         | 3–4 weeks | Phase 6 stable            | Medium      |

**Total to interactive menu preview (Phases 0–5):** ~13–18 weeks
**Total including standard BD authoring (Phase 6):** ~17–24 weeks
**Total including UHD BD (Phase 7):** ~20–28 weeks

These estimates assume a single developer working primarily on `libhdmv`. Phases 2 and 3 can be parallelised across two developers. Note that UHD BD parsing support in Phase 1 is minimal incremental effort since the data models are designed for it from the start — Phase 7 is primarily about the authoring/generation side and Spindle integration (HEVC encoding profiles, HDR metadata pipeline, BD-66/BD-100 planner).

---

## 10. Integration Points with Spindle

### Inspection views

- Disc info from `hdmv_get_disc_info` populates the BD Project Overview (mockup 02-bd)
- Playlist listing from `hdmv_list_playlists` drives the Playlists Overview (mockup 05-bd)
- Stream info from playlist/clip parsing feeds the Stream Mapping view (mockup 07-bd)

### Menu preview

- `hdmv_render_preview` provides the menu canvas image for the Menu Editor (mockup 11-bd)
- `hdmv_get_menu_state` drives the Navigation Preview (mockup 12-bd) — button focus state, navigation graph, validation checks
- `hdmv_send_key` / `hdmv_mouse_click` enable interactive menu testing with the BD remote simulator

### Build pipeline

- Phase 6 authoring output feeds into Spindle's BD build pipeline (mockup 14-bd, 15-bd)
- Compiled IGS streams are passed to tsMuxeR for M2TS muxing
- Generated BDMV metadata is written directly by `libhdmv`

### Verification

- Post-build, `libhdmv` can re-parse the authored BDMV output and verify:
  - All playlists resolve to valid clips
  - IGS pages/buttons have valid navigation
  - Movie object commands reference valid targets
  - This powers the BD Verification view (mockup 24-bd)

---

## 11. Immediate Next Steps

1. **Create `liminal-hq/libhdmv` repository** with Cargo workspace, crate stubs, CI, and fuzz infrastructure (Phase 0).
2. **Implement `index.bdmv` and `MovieObject.bdmv` parsers** with the CLI inspector as the first usable output (Phase 1a–1b).
3. **Acquire test content** — locate 2–3 decrypted BDMV folders with known menu behaviour for validation.
4. **Write the SPEC.md behavioural contract** defining the event model, time base (90 kHz), input model, and expected event ordering.
5. **Confirm `tauri-plugin-workspace` structure** — review the existing workspace layout and plan where `tauri-plugin-hdmv` will sit alongside existing plugins.
6. **Set up cross-repo CI** — ensure the plugin workspace can test against `libhdmv` main, and Spindle can test against the plugin workspace's main.
