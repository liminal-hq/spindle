# IMPLEMENTATION_PLAN.md — Liminal Spindle Authoring Studio

## 1. Purpose

This document translates the product spec into a practical implementation plan for Liminal Spindle, a Tauri-based optical-disc authoring application.

Version 1 is focused on **DVD-Video authoring**, but the implementation plan assumes from the beginning that future versions may grow into **Blu-ray authoring** through additional format backends rather than through a separate unrelated application.

It focuses on:

- architecture and repo shape
- implementation phases
- data model rollout
- native tool integration
- UI and workflow sequencing
- validation, testing, verification, and release strategy

This plan assumes a **local-first desktop app** built with:

- **Tauri**
- **Rust**
- **React + TypeScript**
- sidecar/native tool execution for media inspection, encoding, authoring, and image generation

---

## 2. Delivery Strategy

The application should be built in vertical slices, not isolated layers.

That means each phase should aim to deliver a thin but usable end-to-end path rather than building the entire frontend first and the entire backend later.

### Guiding principles

- Build the project model early.
- Make the build pipeline inspectable from the start.
- Keep native tool execution behind a Rust orchestration boundary.
- Favour conservative defaults and explicit user control.
- Deliver useful internal previews early, even if visually plain.
- Keep shared authored-disc concepts separate from DVD-specific backend assumptions.
- Avoid turning Spindle into a generic media conversion utility.

---

## 3. Recommended Initial Stack

### 3.1 Desktop shell

- Tauri v2
- Rust command layer
- sidecar packaging for native binaries

### 3.2 Frontend

- React
- TypeScript
- TanStack Router or equivalent structured desktop routing
- Zustand or Redux Toolkit for app state
- React Hook Form for structured editing surfaces where useful
- a canvas/layout library only if needed; otherwise custom editor primitives

### 3.3 Data and validation

- JSON project format for v1
- Rust serde for schema serialisation
- JSON schema generation optionally later
- shared TypeScript types generated from Rust schema if practical
- clear separation between authored project data and machine-local cache state

### 3.4 Jobs and logging

- Rust async task orchestration
- event-based progress updates from Tauri backend to frontend
- structured logs stored per project/build
- build manifests and capability snapshots stored for diagnostics

---

## 4. Top-Level Architecture

```text
Frontend (React/TypeScript)
  ├─ Project shell
  ├─ Asset browser
  ├─ Titles / grouping editor
  ├─ Track mapper
  ├─ Output profile editor
  ├─ Chapter editor
  ├─ Menu canvas
  ├─ Planner UI
  ├─ Build runner UI
  ├─ Verification / QA views
  └─ Logs / diagnostics UI

Tauri/Rust Core
  ├─ Project schema + migrations
  ├─ Asset registry
  ├─ Media inspection service
  ├─ Compatibility analyser
  ├─ Planner engine
  ├─ Navigation/menu compiler
  ├─ Build planner
  ├─ Format backend selector
  ├─ Toolchain adapter layer
  ├─ Job orchestration
  └─ Diagnostics / export

External Toolchain
  ├─ Media probe
  ├─ Encoder / transcoder
  ├─ Subtitle conversion helpers
  ├─ Menu / subpicture compositor
  ├─ DVD authoring backend
  ├─ Disc image generation tool
  └─ Future BD backend tools
```

### 4.1 Architectural boundary

The system should be split into:

- **shared authored-disc concepts**: titles, chapters, streams, menus, themes, planner intent, diagnostics
- **format-specific backends**: DVD-Video in v1, future Blu-ray later

This allows DVD to be implemented honestly without hardcoding DVD assumptions into every shared layer.

### 4.2 DVD and BD crossover versus divergence

Spindle should treat DVD and future BD as sharing an **authoring language** but not necessarily the same **compiler/backend**.

#### Where they cross over

These concerns should live in shared architecture layers:

- project structure and persistence
- assets, source inspection, and relinking
- title, chapter, and stream authoring intent
- menu/page/button authoring concepts at a high level
- planner shell, diagnostics, and build orchestration
- themes and future menu-generation concepts where they remain format-agnostic

These are the parts that describe what the user is trying to author.

#### Where they diverge

These concerns should remain backend-specific:

- legal output targets and compatibility rules
- grouping semantics such as DVD titlesets and future BD-specific groupings
- format-specific menu compilation behaviour
- authoring-definition generation
- filesystem/output structure generation
- format-specific validation, compliance checks, and verification paths

These are the parts that describe how authored intent becomes a real disc for a specific format family.

#### Architecture plan

The intended layering is:

1. **Shared authored-disc layer**
   - project model
   - titles, chapters, tracks, menus, themes, planner intent
2. **Shared application services**
   - inspection, caching, relinking, diagnostics, planner shell, navigation preview, logging, orchestration
3. **Format backend layer**
   - DVD backend in v1
   - future BD backend later
4. **Tool adapter layer**
   - native tool wrappers, capability detection, command construction, output parsing

The design rule is:

- share the human authoring concepts
- isolate the format law
- route the build through the selected backend

This keeps Spindle from becoming either a DVD-only dead end or a vague universal media tool.

---

## 5. Repository Structure

Recommended monorepo shape:

```text
/apps
  /desktop
    /src                 # React/TS frontend
    /src-tauri           # Rust/Tauri backend
/packages
  /project-schema        # shared TS types or generated bindings if used
  /ui                    # reusable UI components if split out later
/docs
  SPEC.md
  IMPLEMENTATION_PLAN.md
  ARCHITECTURE.md
  TOOLCHAIN.md
  PROJECT_SCHEMA.md
/testdata
  /media
  /projects
  /golden
/scripts
  /dev
  /ci
```

If this starts as a single-app repo, keep the same conceptual boundaries within folders.

---

## 6. Workstreams

The project is easiest to manage as parallel workstreams with explicit sequencing.

### 6.1 Core schema and persistence

Owns:

- project model
- schema versioning
- migrations
- load/save
- path handling
- authored-data versus cache-data separation
- future format-family extension points

### 6.2 Media inspection and asset registry

Owns:

- asset import
- metadata inspection
- caching
- thumbnails
- compatibility summaries
- source fingerprinting
- relink support groundwork

### 6.3 Planner and validation

Owns:

- disc budgeting
- bitrate allocation
- output-profile-aware planning
- grouping analysis
- compatibility profiles
- validation engine
- future verification/reporting groundwork

### 6.4 Menu and navigation authoring

Owns:

- menu pages
- buttons
- navigation graph
- remote simulation preview
- generation-friendly menu structures
- theme/model separation groundwork

### 6.5 Build orchestration

Owns:

- command generation
- working directories
- backend selection
- tool invocation
- output validation
- logs and diagnostics
- future BD backend extension points

### 6.6 Frontend shell and UX

Owns:

- navigation
- editor surfaces
- state synchronisation
- progress UI
- error presentation
- future undo/redo friendliness

---

## 7. Implementation Phases

## Phase 0 — Project Foundation

### Goals

Establish the app shell, core developer workflow, and non-negotiable architecture boundaries.

### Deliverables

- Tauri desktop app boots successfully
- React shell with left-nav layout
- Rust command bridge working
- basic project creation/open/save
- logging framework in place
- sidecar strategy documented
- sample media/testdata structure committed
- format-backend-aware architecture notes written down early

### Tasks

#### Frontend

- create app shell
- establish navigation areas
- create placeholder screens
- add project lifecycle actions

#### Rust/Tauri

- establish command modules
- define base error model
- define app directories and project paths
- set up event emission to frontend
- define backend capability query command

#### Tooling

- set up linting/formatting
- set up test harnesses
- add fixture management for media samples

### Exit criteria

- App opens, creates a new project, saves JSON, and reopens it.
- Errors propagate in a structured way.
- There is a written boundary between shared authored concepts and DVD-only backend logic.

---

## Phase 1 — Project Schema and Persistence

### Goals

Build the internal data model that every future feature depends on.

### Deliverables

- versioned project schema v1
- stable IDs for assets, titles, tracks, menus, buttons
- migration scaffolding
- project load/save validation
- disc family field and backend extension points

### Implementation details

#### Core Rust structs

Implement serialisable entities for:

- Project
- Disc
- DiscFamily
- TitleGroupingUnit (DVD titleset now, format-specific grouping later)
- Title
- AssetRef
- VideoTrackMapping
- AudioTrackMapping
- SubtitleTrackMapping
- VideoOutputProfile
- AudioOutputConfiguration
- ChapterPoint
- Menu
- MenuPage
- Button
- BuildSettings
- CacheMetadata
- CapabilitySnapshot

#### Schema design rules

- IDs are stable and opaque
- source asset paths are stored separately from derived cache paths
- UI state does not pollute core authored data unless intentionally persisted
- references always point by ID, not array index
- shared concepts and DVD-specific fields are separated cleanly
- future BD support should be able to extend the schema without forcing a parallel project type

### Suggested output documents

- `PROJECT_SCHEMA.md`
- migration notes

### Exit criteria

- A project containing placeholder titles, menus, and mappings can be round-tripped without loss.
- The schema can represent `disc.family = dvd-video` without implying that DVD is the only future target.

### Implementation status

**Completed.** Implemented as `tauri-plugin-spindle-project` with:

- Full Rust data model in `plugins/tauri-plugin-spindle-project/src/models.rs` covering all core structs
- JSON serialisation with camelCase field naming for TypeScript interop
- Schema version checking in `desktop.rs` with forward-compatibility error
- Validation engine checking titlesets, titles, source assets, video mappings, and output profiles
- 14 Rust unit tests covering round-trips, serialisation format, and domain values
- Mirrored TypeScript types in `apps/spindle/src/types/project.ts`
- 14 frontend tests covering type helpers and project creation defaults
- Zustand store wrapping all plugin invocations with dirty tracking and validation

App shell also delivered alongside Phase 1:

- Cross-platform window controls (Topbar) ported from Threshold
- Sidebar navigation with all planned page sections
- Overview dashboard with stats, capacity bar, and project health
- Placeholder pages for remaining sections
- Context menu component ported from liminal-notes
- Design system CSS ported from mockups

---

## Phase 2 — Asset Import and Media Inspection

### Goals

Turn source files into trustworthy project assets with cached inspection results.

### Deliverables

- asset import flow
- inspection job execution
- stored media metadata
- compatibility summary per asset
- thumbnail extraction for video
- source fingerprinting
- missing-asset detection groundwork

### Implementation details

#### Asset import flow

1. User selects files.
2. App copies references into project asset registry.
3. Rust queues inspection.
4. Results are cached and surfaced in UI.

#### Asset metadata model

Store:

- absolute/source path
- canonicalised path if possible
- duration
- container format
- video stream list
- audio stream list
- subtitle stream list
- resolution
- frame rate
- scan type/interlace hint
- aspect ratio
- language metadata where present
- file hash or fingerprint for cache invalidation

#### Compatibility analyser v1

Classify each asset as:

- remux-compatible
- transform-compatible
- re-encode-required
- unsupported

Explain why.

#### Future-safe inspection concerns

Capture enough metadata for later:

- copy vs re-encode decisions
- display/aspect warnings
- subtitle rendering/conversion decisions
- timing and sync diagnostics

### Frontend screens

- Assets list
- Asset detail inspector
- Import status/progress panel
- missing/relink status indicators later

### Exit criteria

- User can import media and see structured stream information and compatibility flags.
- Cache invalidation and stale-source detection are grounded in fingerprints rather than only timestamps.

### Implementation status

**Completed.** Assets page with list/detail layout, import via file dialog, FFprobe-based inspection (`inspect.rs`), DVD compatibility assessment (remux/transform/re-encode/unsupported), stream metadata extraction. 6 Rust tests for inspection logic. Lightweight fingerprinting (file size + name hash).

---

## Phase 3 — Titles, Groupings, and Track Mapping

### Goals

Create the authored disc structure from imported assets.

### Deliverables

- title creation from assets
- default DVD titleset assignment
- advanced grouping view
- explicit stream mapping editor
- per-title video output profile selection
- per-audio-stream output configuration
- title ordering
- end-action selection scaffolding

### Implementation details

#### Default UX

- imported compatible titles enter a default grouping unit
- in DVD mode this maps to a default titleset
- users mostly work with ordered titles
- advanced mode reveals grouping structures explicitly

#### Track and output UI

For each title:

- exactly one video stream selected
- video output profile selected
- zero or more audio streams included and ordered
- per-audio-stream `copy` vs `re-encode` state
- constrained DVD-compatible audio target selection
- zero or more subtitle tracks included and ordered
- editable labels and language codes
- default-track flags where supported

#### Validation

- missing selected video is blocking
- missing video output profile is blocking
- incompatible selected tracks produce warnings or errors
- unsupported requested output target is blocking if the toolchain cannot satisfy it
- duplicate ordering resolved automatically or flagged

### Frontend screens

- Titles overview
- Title detail editor
- Track mapping panel
- Output profile section
- Grouping inspector

### Exit criteria

- User can turn imported assets into a structured authored project with explicit mappings and authoring choices.

### Implementation status

**Completed.** Titles page with add/remove/reorder, source asset selection with auto-mapping (first video stream, all audio/subtitle streams), video output profile editor (raster + aspect), audio track configuration (output target, copy mode, language), subtitle track editing (label, language, default/forced flags).

---

## Phase 4 — Chapter System and Timing Groundwork

### Goals

Enable chapter authoring and validation while laying groundwork for timing-aware diagnostics.

### Deliverables

- manual chapter creation
- timestamp editing
- chapter ordering validation
- optional thumbnail preview hooks
- chapter import stub for later extension
- frame-safe placement validation groundwork

### Implementation details

#### Chapter data rules

- timestamps must be increasing
- timestamps must be within title duration
- chapter zero/start handling must be defined consistently
- rename support is optional but recommended in v1

#### Timing-aware groundwork

Plan for later diagnostics around:

- frame-safe chapter placement
- subtitle timing alignment
- audio sync warnings
- source cadence/interlace quirks

#### UI design

- chapter list view
- per-title chapter timeline/list hybrid
- add at current timestamp input
- fast validation feedback

### Exit criteria

- Each title can be chaptered and validated cleanly.

### Implementation status

**Completed.** Chapters page with title selector sidebar, visual timeline bar, editable chapter list with auto-sort by timestamp, timestamp input with H:MM:SS parsing. 11 frontend tests for timestamp formatting and parsing.

---

## Phase 5 — Disc Planner, Bitrate Budgeting, and Compatibility Profiles

### Goals

Make disc fit/quality planning visible, conservative, and adjustable.

### Deliverables

- disc target selection
- estimated capacity usage
- per-title bitrate allocation
- output-profile-aware planning
- quality warning system
- user-priority weighting
- compatibility-profile groundwork

### Implementation details

#### Planner engine inputs

- disc target capacity
- selected disc family/backend
- title durations
- selected video output profiles
- selected audio tracks and audio output targets
- subtitle overhead assumptions
- menu overhead assumptions
- safety margin
- allocation strategy
- compatibility profile / safe-default policy later

#### Planner engine outputs

- total estimated used space
- remaining free space
- per-title target video bitrate
- warnings for overflow and risky quality
- suggestion engine outputs
- compatibility-risk summaries

#### Suggested initial allocation strategies

- equal share
- duration weighted
- priority weighted

#### UI

- planner summary card on overview page
- detailed planner page with per-title table
- warning callouts with suggested actions
- advanced assumptions panel later

### Exit criteria

- User can see whether the project is likely to fit and how chosen tracks and output profiles affect quality.

### Implementation status

**Completed.** Disc Planner page with capacity overview (bar chart, usage stats), bitrate budget calculation, per-title duration/size breakdown with proportional bars, overhead breakdown (safety margin + IFO/NAV estimate), over-capacity warning badges.

---

## Phase 6 — Menu Model, Navigation Graph, and Generation-Friendly Architecture

### Goals

Build the authored menu structure before implementing full visual polish.

### Deliverables

- menu/page entities
- button entities
- action targets
- directional navigation graph
- keyboard remote simulation
- clean separation between menu structure, authored content, and future theme/generation layers

### Implementation details

#### Model first, visuals second

Before a rich canvas exists, implement the underlying model and a simple preview panel.

Each button stores:

- bounds
- label
- target action
- up/down/left/right references
- highlight state refs or placeholders
- visibility metadata for future expansion

Each menu should leave room for:

- authored structure
- authored content
- theme references
- generated-layout provenance later

#### Preview simulator v1

- render focus state in simple HTML/canvas
- allow arrow-key navigation
- allow activation testing
- show dead-end warnings

### Exit criteria

- A menu can be defined structurally and tested behaviourally even if the canvas is still minimal.

---

## Phase 7 — Visual Menu Editor

### Goals

Add a user-friendly menu authoring surface on top of the menu model.

### Deliverables

- fixed-resolution menu workspace
- background image assignment
- button placement/resizing
- snap/alignment tools
- highlight/select preview states
- safe-area guides
- clear theme/model separation in the editor state

### Implementation details

#### v1 scope

- still-image menus only
- basic text and image buttons
- no motion menu timeline
- no autogenerated menus yet, but architecture should not block them

#### UI considerations

- selected element inspector
- layers for non-interactive art vs interactive buttons
- grid/list auto-layout helpers
- auto-generate navigation mapping from geometry when requested
- leave room for future theme-aware generation templates

### Exit criteria

- User can visually create a menu and simulate remote navigation.

---

## Phase 8 — Build Planner and Command Generation

### Goals

Turn project state into deterministic build steps before full execution.

### Deliverables

- build planning graph
- generated intermediate paths
- command preview/log UI
- working directory layout
- backend-aware build plan object

### Implementation details

#### Build plan object

Represent the build as a series of discrete jobs:

- inspect freshness
- resolve target backend
- transcode or copy title video/audio as required
- convert subtitles if needed
- compose menu graphics/subpictures
- emit format-specific authoring definitions
- author filesystem/output tree
- validate output
- generate image output when requested

#### Rust modules

- `build_planner`
- `backend_selector`
- `toolchain_adapter`
- `working_dir`
- `build_manifest`

#### Requirements

- no tool invocation directly from UI
- all commands emitted from validated project model
- dry-run mode available for debugging
- build plan must not assume DVD-specific steps everywhere in shared logic

### Exit criteria

- User can view the intended build steps and command summaries without executing them.

---

## Phase 9 — Native Tool Execution and DVD VIDEO_TS Export

### Goals

Achieve the first real authored disc output.

### Deliverables

- sidecar execution working
- progress events during build
- cancellation support where feasible
- VIDEO_TS export
- logs and stderr/stdout capture
- structured build summary

### Implementation details

#### Execution rules

- each build phase runs through Rust job orchestration
- outputs are written to deterministic working directories
- failures are classified by phase
- partial outputs are preserved for debugging unless user opts to clean them

#### Output validation

- expected directory structure exists
- required files are present
- build summary is written
- capability and policy decisions are recorded for later diagnostics

### Exit criteria

- A simple project with one menu and one or more titles can build to VIDEO_TS successfully.

---

## Phase 10 — Verification, ISO Generation, and Refinement

### Goals

Add optional disc image generation and improve trustworthiness and reliability.

### Deliverables

- ISO export option
- better diagnostics bundle
- incremental rebuild support for unchanged assets
- menu-only rebuild path
- preview vs verification distinction in the product
- compliance / QA reporting groundwork

### Exit criteria

- User can build either VIDEO_TS only or VIDEO_TS + ISO with usable logs.
- The product can present at least a basic authored-output confidence summary beyond raw structural success.

---

## 7.1 Future Advanced Phases

After v1 is stable:

- hidden buttons and easter-egg-style navigation paths
- conditional navigation/state flags
- smarter subtitle conversion workflows
- motion menus
- autogenerated title/chapter/audio/subtitle menus
- compatibility-profile UX
- advanced program/cell editing
- stronger verification passes
- Blu-ray authoring backend

---

## 8. Suggested Rust Module Layout

```text
src-tauri/src/
  app.rs
  errors.rs
  commands/
    projects.rs
    assets.rs
    titles.rs
    menus.rs
    planner.rs
    build.rs
    diagnostics.rs
    capabilities.rs
  project/
    mod.rs
    schema.rs
    migrate.rs
    validate.rs
  assets/
    mod.rs
    import.rs
    inspect.rs
    cache.rs
    thumbs.rs
    compatibility.rs
    relink.rs
  planner/
    mod.rs
    capacity.rs
    bitrate.rs
    grouping.rs
    profiles.rs
    warnings.rs
  menus/
    mod.rs
    model.rs
    nav.rs
    simulate.rs
    compile.rs
    themes.rs
  build/
    mod.rs
    planner.rs
    manifest.rs
    jobs.rs
    workspace.rs
    execute.rs
    validate.rs
    backend.rs
  toolchain/
    mod.rs
    probe.rs
    encode.rs
    subs.rs
    dvd.rs
    image.rs
    capabilities.rs
  diagnostics/
    mod.rs
    bundle.rs
    logs.rs
    qa.rs
```

---

## 9. Suggested Frontend Module Layout

```text
src/
  app/
  routes/
  components/
  features/
    projects/
    assets/
    titles/
    groupings/
    tracks/
    profiles/
    chapters/
    menus/
    planner/
    build/
    verification/
    logs/
  lib/
    api/
    state/
    validation/
    formatting/
  types/
```

---

## 10. Data Model Rollout Order

Do not try to model every advanced DVD concept immediately.

Recommended rollout:

### Wave 1

- Project
- Disc
- DiscFamily
- Asset
- Title
- basic mappings
- BuildSettings

### Wave 2

- Grouping unit / DVD titleset
- VideoOutputProfile
- AudioOutputConfiguration
- ChapterPoint
- Menu
- Button
- Planner settings

### Wave 3

- Navigation graph details
- advanced track metadata
- cache metadata
- capability snapshot
- build manifest

### Wave 4

- theme references
- autogenerated menu provenance
- conditional states
- hidden buttons
- advanced VM-inspired behaviours
- future BD extension fields

---

## 11. Native Toolchain Integration Strategy

### 11.1 Adapter boundary

Every external tool should have a Rust adapter that handles:

- version detection
- capability detection
- command construction
- stderr/stdout parsing where useful
- path handling
- failure classification

### 11.2 Why this matters

This prevents the rest of the app from knowing or caring about raw command-line details.

### 11.3 Backend-aware outputs

Each adapter should return structured results such as:

- success/failure
- output paths
- parsed metadata
- warnings
- raw command line for diagnostics
- backend capability information where relevant

### 11.4 Backend families

The orchestration layer should route work through format-aware backend adapters.

Examples:

- DVD backend in v1
- future BD backend later

Shared layers should depend on backend capabilities and backend requirements, not on ad hoc DVD-only assumptions.

---

## 12. Caching Strategy

### Cache categories

- asset inspection results
- thumbnail images
- derived compatibility assessments
- build intermediates
- authored temporary files
- capability snapshots

### Cache design rules

- cache invalidates when source fingerprint changes
- cache is separated from authored project data
- users can clean/rebuild cache safely
- moved or missing assets should not corrupt authored project intent

---

## 13. Validation and Verification Strategy

Validation should happen at multiple levels.

### 13.1 On edit

- missing required field
- invalid chapter order
- broken button target reference
- missing selected video stream
- missing video output profile
- unsupported requested output target

### 13.2 Pre-build

- project completeness
- capacity warnings
- required tool availability
- working directory readiness
- backend capability sufficiency

### 13.3 Post-build

- expected output structure exists
- build summary complete
- output paths accessible

### 13.4 Verification groundwork

Plan for later distinction between:

- structural validation
- preview confidence
- authored-output verification
- compatibility/QA reporting

---

## 14. Testing Strategy

## 14.1 Unit tests

Target:

- schema round-trips
- migration correctness
- planner calculations
- validation rules
- navigation graph behaviour
- backend-selection rules

## 14.2 Integration tests

Target:

- asset inspection pipeline
- command generation
- build-plan generation
- cache invalidation
- capability detection

## 14.3 Golden tests

Use stored sample projects and expected outputs for:

- planner summaries
- generated authoring definitions
- build manifests
- menu navigation graph exports
- capability summary rendering later

## 14.4 Manual QA matrix

Create test projects covering:

- single-title disc
- multi-title disc
- per-audio-stream copy vs re-encode
- subtitle inclusion
- mixed aspect-ratio edge cases
- half-D1 vs full-D1 planning
- menu with multiple buttons
- project overflow planning
- missing-asset/relink scenarios later

---

## 15. Developer Milestones

### Milestone A — Schema Backbone

Target outcome:

- project file can represent the authored DVD structure clearly while leaving room for future format backends

### Milestone B — Inspect and Organise

Target outcome:

- real media can be imported, inspected, and mapped into titles

### Milestone C — Plan the Disc

Target outcome:

- user can understand fit, bitrate, output-profile trade-offs, and warnings

### Milestone D — Author Menus

Target outcome:

- user can create a navigable menu and test it in-app

### Milestone E — First Successful Build

Target outcome:

- end-to-end VIDEO_TS build from a real project

### Milestone F — v1 Hardening

Target outcome:

- ISO export, diagnostics, incremental rebuilds, basic verification groundwork, and bug cleanup

---

## 16. Recommended MVP Cut

If scope tightens, keep the MVP to:

- NTSC and PAL modes
- `disc.family = dvd-video`
- one default DVD titleset plus optional advanced editing
- multi-title support
- explicit stream mapping
- per-title video output profiles
- per-audio-stream copy vs re-encode control
- chapter editor
- still-image menu editor
- planner with conservative fit estimation
- VIDEO_TS export
- structured logs

Cut first if needed:

- ISO generation
- chapter thumbnails
- complex menu layout helpers
- incremental rebuilds
- advanced grouping controls
- verification UI beyond core summaries

---

## 17. Risks and Mitigations

### Risk 1 — Schema drift

Mitigation:

- lock schema versioning early
- write migration tests from the start

### Risk 2 — Toolchain complexity leaks into UI

Mitigation:

- keep adapter layer in Rust
- expose interpreted errors, not raw command lines by default

### Risk 3 — Menu preview differs from authored behaviour

Mitigation:

- build explicit navigation graph first
- base preview on that graph, not purely geometry

### Risk 4 — Planner appears inaccurate

Mitigation:

- be conservative
- expose assumptions
- log estimation inputs

### Risk 5 — Build times frustrate iteration

Mitigation:

- add dry-run mode early
- support draft builds
- preserve intermediates

### Risk 6 — DVD assumptions spread too far into shared systems

Mitigation:

- define backend-aware architecture early
- keep DVD-specific compilation in backend modules
- review shared APIs for format leakage

---

## 18. Immediate Next Steps

1. Update `ARCHITECTURE.md` and create `PROJECT_SCHEMA.md` from the revised spec and this plan.
2. Scaffold Tauri app shell and Rust command modules.
3. Implement minimal project schema and persistence with `disc.family` and backend capability plumbing.
4. Add asset import + inspection pipeline.
5. Build titles / track-mapping / output-profile UI as the first real authoring workflow.

---

## 19. Summary

The right order for this application is:

- model the authored disc honestly
- separate shared authored concepts from DVD-only compilation logic
- inspect source assets early
- let users map streams and output targets explicitly
- add planning before building
- model menu behaviour before polishing menu visuals
- centralise all native toolchain logic in Rust
- deliver the first successful VIDEO_TS build as the major v1 turning point
- keep the architecture ready for future BD backends without overbuilding them today

If this sequence is followed, Spindle can grow in a disciplined way from a trustworthy DVD-first authoring environment into a broader optical-disc authoring platform.
