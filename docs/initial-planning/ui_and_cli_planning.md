# UI_AND_CLI_PLANNING.md — Liminal Spindle

## 1. Purpose

This note captures two related planning areas for Liminal Spindle:

1. the screens and workflows that should be considered for the desktop application UI
2. a future CLI or headless render mode for scripted or automated builds

The goal is to keep the desktop app as the primary authoring environment while recognising that a CLI path could become valuable for automation, repeatable rendering, CI usage, and advanced-user workflows.

---

## 2. Product framing

Spindle should remain primarily an **interactive optical-disc authoring application**.

The desktop app is where users:

- inspect assets
- author titles and tracks
- configure output choices
- design menus
- review warnings
- validate projects
- build final authored output

A CLI path, if added, should be framed as a **headless build/render interface** for already-authored projects, not as the primary way ordinary users create disc projects from scratch.

---

## 2.1 UX flow model

Spindle should be designed as a **workspace-first application with guided entry points**, not as a pure wizard.

### Why workspace-first fits Spindle

Spindle is not a short, one-way setup task. Users will often:

- import assets
- inspect them
- adjust stream mappings
- change output profiles
- revise chapters
- move into menus
- check planner warnings
- go back and refine earlier decisions
- build, review, and rebuild

That is a non-linear authoring workflow, which fits a persistent workspace much better than a sequential wizard.

### Recommended product stance

The primary experience should be:

- **workspace mode as the default product shape**
- **guided flows as overlays or assisted entry points**
- **progressive disclosure instead of a separate easy-mode shell**

This keeps the app efficient for power users while still helping newer users get started.

### The three main flow modes

#### 1. Setup flow

This is the lightweight guided flow for a brand-new project.

It may help the user:

- choose disc family or target format
- choose DVD standard in v1
- choose disc capacity target
- import initial assets
- create initial titles or groupings
- establish a first authored baseline

This should feel like a guided panel or setup path **inside** the workspace, not a completely separate application mode.

#### 2. Authoring flow

This is the normal day-to-day workflow.

The user moves freely between:

- overview
- assets
- titles
- stream/output configuration
- chapters
- menus
- navigation preview
- planner

This is the core of the product and should remain non-linear.

#### 3. Build and review flow

This is where the user shifts from editing to output confidence.

The user moves through:

- planner review
- build setup
- build execution
- logs
- diagnostics
- verification or QA summaries

This flow should feel connected to the workspace rather than like a separate final wizard.

### How guidance should work

Instead of separate “easy mode” and “power mode” products, Spindle should use the same workspace with different levels of assistance.

That can include:

- recommended defaults
- collapsed advanced sections
- inline explanations
- warnings with suggested fixes
- generated baselines for menus or structure later
- quick actions to resolve common issues

Power users can move directly and efficiently through the workspace.
Beginners can still be guided without learning a different UI model.

### Navigation implication

A persistent left navigation and project shell should remain visible throughout most of the product.

This makes it easy to:

- keep orientation
- jump directly to problem areas
- understand the authored project as a whole
- avoid feeling trapped in a step-by-step process

### Design principle

A good shorthand for the UX direction is:

**workspace-first, guide-assisted authoring**

## 3. Screen map at a high level

The desktop app should probably be thought of in terms of these major areas:

- project shell and navigation
- project overview and health
- asset import and inspection
- title and grouping authoring
- stream mapping and output configuration
- chapter editing
- menu and navigation authoring
- planning and warnings
- build, verification, and logs
- diagnostics and relinking

These are the main screen families worth mocking up.

---

## 4. Core screens to think about and mock up

## 4.1 App shell / project shell

### Purpose

Provides the primary frame for the application.

### Likely responsibilities

- recent projects
- current project title
- dirty/saved state
- disc family or target format indicator
- main navigation
- global warnings/build status
- quick access to build and logs

### Why mock it

This determines how heavy the app feels, how much technical state is visible at all times, and how users move between authoring steps.

---

## 4.2 Project overview / dashboard

### Purpose

Gives the user a health summary of the authored project.

### Likely content

- project name
- disc family / backend target
- disc standard
- capacity target
- title count
- total runtime
- estimated size / remaining capacity
- warning summary
- missing asset summary
- quick links to problem areas
- recent build result or last successful build

### Why mock it

This screen becomes the project’s “status centre” and strongly affects user trust.

---

## 4.3 Assets screen

### Purpose

Import, inspect, and organise source media.

### Likely content

- asset list/table/grid
- import action
- file state (present, missing, stale, relink needed)
- duration, format, resolution, stream count
- compatibility badge
- thumbnail preview
- search/filter/sort

### Why mock it

This is where projects enter the system. A good asset screen makes the whole tool feel grounded.

---

## 4.4 Asset detail / inspector screen

### Purpose

Deep inspection of a selected source file.

### Likely content

- full path / fingerprint summary
- video stream details
- audio stream details
- subtitle stream details
- aspect and timing warnings
- copy vs re-encode eligibility hints
- compatibility explanation
- relink controls later

### Why mock it

This is the best place to expose technical transparency without cluttering every other screen.

---

## 4.4.1 Media preview architecture

Media preview should be treated as a bounded **authoring aid**, not as a full general-purpose playback subsystem.

The preview model should be split into distinct categories so the product does not collapse very different ideas into one vague “player”.

### Source playback preview

This is the ordinary in-app media preview experience for source files.

Likely capabilities:

- play / pause
- scrub
- audio audition
- basic time display
- stream-aware preview context later where feasible

This is useful for:

- checking source content
- deciding chapter placement
- verifying the right asset or track was chosen
- hearing audio tracks before mapping/output decisions

### Deterministic still preview

This is a more authoring-oriented preview path based on extracted frames or thumbnails.

Likely uses:

- chapter thumbnails
- frame grabs for chapter placement
- menu thumbnail generation
- still inspection for titles and extras

This should be thought of as more deterministic than ordinary playback preview and should be tied closely to the media-inspection / sidecar-toolchain flow.

### Menu and navigation preview

This is not the same as source playback.

It should remain part of Spindle’s authored menu model and focus on:

- button focus movement
- activation flow
- return behaviour
- state preview

### Verification-oriented preview

This is also distinct from normal playback.

It represents confidence-building checks around authored output rather than just source playback convenience.

Examples:

- display/aspect assumptions
- copied vs re-encoded choices
- subtitle conversion assumptions
- authored-output confidence summaries later

### Product rule

Preview should help the user author confidently, but it should not be allowed to imply that the final disc is verified simply because the source media played successfully in-app.

### Architecture implication

The product should leave room for a hybrid model where:

- convenient source playback uses the desktop/webview media layer where appropriate
- deterministic still extraction and metadata-aware preview are tied to the sidecar/toolchain path
- menu simulation stays in Spindle’s authored UI model
- verification remains a separate concept

### Reference point

A relevant Tauri example is the project `66HEX/frame`, which demonstrates media preview alongside FFmpeg/FFprobe sidecar usage. It is a useful reference for what a Tauri-based media-preview workflow can look like, while still reminding us that media playback and authoring verification are not the same concern.

---

## 4.4.2 Media preview surface decisions

This is worth thinking about as a set of surfaces rather than one player widget.

Likely preview surfaces include:

- inline preview in the asset inspector
- optional title-level preview in the title detail screen
- chapter-frame preview in the chapters screen
- thumbnail-oriented preview in menus
- dedicated navigation simulation for authored menus

These surfaces do not all need to be implemented in v1, but the UI planning should recognise that “preview” appears in multiple different authoring contexts.

---

## 4.5 Titles / authored content overview

### Purpose

Shows the authored disc structure in terms of titles and their order.

### Likely content

- ordered titles list
- grouping/titleset assignment summary
- per-title source reference
- per-title output profile summary
- chapter count
- audio/subtitle counts
- end action summary
- drag to reorder

### Why mock it

This is one of the core “disc authoring” surfaces and helps separate Spindle from a simple converter.

---

## 4.6 Title detail editor

### Purpose

Configure a single title in detail.

### Likely content

- title name/label
- source asset
- selected video stream
- video output profile
- aspect/display settings summary
- quality priority / planner weighting
- end action
- chapter summary
- linked menu targets later

### Why mock it

This is where authored intent becomes concrete.

---

## 4.7 Stream mapping screen

### Purpose

Choose exactly which streams are included for each title.

### Likely content

- selected video stream
- included audio streams
- included subtitle streams
- ordering controls
- language labels
- default flags
- inclusion toggles
- copy vs re-encode status hints

### Why mock it

This is one of the product’s most important technical differentiators.

---

## 4.8 Output profile / track configuration screen

### Purpose

Configure how included streams are authored, not just whether they are included.

### Likely content

- per-title video output profile
- full-D1 / half-D1 / related profile choice
- per-audio-stream output target
- per-audio-stream `copy` vs `re-encode`
- bitrate/profile controls where applicable
- toolchain capability warnings
- compatibility-risk hints

### Why mock it

This screen defines how much authoring control the user really has.

---

## 4.9 Chapters screen

### Purpose

Create and edit chapter points per title.

### Likely content

- chapter list
- chapter timestamps
- optional names/labels
- add/remove/reorder
- validation status
- timeline/list hybrid view
- thumbnail or frame references later

### Why mock it

Chapters are a core authored-disc feature and should feel first-class.

---

## 4.10 Menus overview screen

### Purpose

Manage the set of menus in the project.

### Likely content

- menu list
- menu type (main, title, chapter, audio, subtitle, extras)
- linkage summary
- theme/template summary later
- generated vs manual origin indicator later
- add/duplicate/delete menu

### Why mock it

This screen helps users think in terms of authored menu structures rather than just a single canvas.

---

## 4.11 Menu editor / canvas

### Purpose

Visually design menus.

### Likely content

- fixed-resolution canvas
- background image/video slot later
- button objects
- text/image layers
- safe-area guides
- state preview
- inspector panel
- align/distribute controls
- theme reference summary later

### Why mock it

This is the most visible “authoring studio” part of the product.

---

## 4.12 Navigation preview / remote simulator

### Purpose

Test focus flow and activation logic separately from layout editing.

### Likely content

- focused button state
- arrow-key simulation
- activation simulation
- dead-end warnings
- flow visualisation
- optional return-path view

### Why mock it

Preview and verification should not be collapsed into one screen. This screen makes that separation concrete.

---

## 4.13 Planner screen

### Purpose

Show whether the project fits and what the quality/capacity trade-offs look like.

### Likely content

- estimated used/free space
- per-title bitrate targets
- selected disc target
- audio cost breakdown
- video profile impact
- quality-risk warnings
- suggested actions
- compatibility profile summary later

### Why mock it

This screen turns the app from a layout toy into a serious authoring/planning tool.

---

## 4.14 Build screen

### Purpose

Review the build plan and start builds.

### Likely content

- target backend
- build mode
- destination/output paths
- dry-run option
- build phases preview
- start/cancel controls
- clean intermediates toggle

### Why mock it

This screen is where authored intent turns into a real disc output.

---

## 4.15 Build progress / job monitor

### Purpose

Observe running builds.

### Likely content

- current phase
- completed phases
- tool currently running
- stdout/stderr snippets
- progress indicator
- warning summaries
- cancel/retry actions where safe

### Why mock it

Build transparency is one of the product’s trust features.

---

## 4.16 Logs / diagnostics screen

### Purpose

Inspect generated commands, failures, and detailed build results.

### Likely content

- command list
- raw output logs
- interpreted warnings/errors
- capability snapshot
- tool versions
- export diagnostics bundle

### Why mock it

This is essential for advanced users and debugging.

---

## 4.17 Verification / QA screen

### Purpose

Show confidence-oriented results beyond basic build success.

### Likely content

- structural validation status
- compatibility-risk summary
- copied vs re-encoded stream summary
- display/aspect warnings
- subtitle conversion assumptions
- output integrity checklist

### Why mock it

This is where Spindle can distinguish preview from genuine authored-output confidence.

---

## 4.18 Missing assets / relink screen

### Purpose

Recover projects when files move or disappear.

### Likely content

- missing asset list
- old path vs detected candidate path
- relink action
- fingerprint match hints
- per-asset status

### Why mock it

Long-lived media projects need this sooner than people think.

---

## 4.19 Settings / toolchain screen

### Purpose

Show bundled tools, versions, capabilities, and later expert overrides.

### Likely content

- bundled sidecars list
- tool versions
- capability detection results
- backend availability
- optional system tool override path later
- cache location / cleanup tools

### Why mock it

This screen makes the toolchain feel explicit and trustworthy instead of magical.

---

## 5. Screens that may be deferred but should still be thought about

- richer media-preview panel with frame stepping or waveform aids
- theme browser / theme editor
- autogenerated-menu review screen
- compatibility-profile chooser
- advanced verification report viewer
- backend selection / future disc-family switcher
- motion-menu timeline editor
- subtitle rendering/style preview

These may not be part of v1, but the information architecture should leave room for them.

---

## 6. Suggested mock-up priority order

If design time is limited, mock these first:

1. app shell
2. project overview
3. assets screen + asset inspector
4. titles overview + title detail
5. stream mapping / output configuration
6. chapters screen
7. menu editor
8. navigation preview
9. planner screen
10. build screen + progress
11. logs/diagnostics
12. relink screen

This order follows the real authoring workflow and gives the strongest signal about whether the product architecture makes sense.

---

## 7. CLI / headless render version

## 7.1 Why a CLI path might exist

A CLI or headless path is valuable for:

- repeatable local builds
- automation and scripting
- CI pipelines
- advanced-user workflows
- deterministic render/export jobs
- future batch processing of already-authored projects

It is less appropriate as the primary authoring interface for ordinary users.

---

## 7.2 Recommended product stance

Spindle should not start life as “desktop app + equal CLI app”.

Instead:

- the desktop application is the primary authoring environment
- the CLI is a **headless build/render interface** for project files that already exist
- the CLI should reuse the same Rust core, validation engine, planner, backend selector, and tool adapters

That means the CLI is not a separate product. It is another entry point into the same backend systems.

---

## 7.3 What the CLI should do in an early version

A sensible early CLI could support:

- inspect a project file
- validate a project
- print capability summary
- print planner summary
- render/build the project
- export logs / diagnostics bundle
- run dry-run build planning

Examples of conceptual commands:

```text
spindle-cli validate project.spindle.json
spindle-cli plan project.spindle.json
spindle-cli build project.spindle.json --output ./dist
spindle-cli build project.spindle.json --dry-run
spindle-cli diagnostics project.spindle.json --export ./diag.zip
spindle-cli capabilities
```

These are examples of capability shape, not final command design.

---

## 7.4 What the CLI should probably not do at first

Avoid making the early CLI responsible for:

- full project creation from scratch
- visual menu design
- complex chapter editing UX
- rich interactive asset browsing
- theme authoring
- full replacement of the desktop workflow

A CLI that tries to recreate the full GUI authoring surface usually becomes awkward and dilutes the product.

---

## 7.5 Architecture implication of a CLI path

A CLI-friendly architecture strongly suggests:

- Rust-first domain logic
- no essential business logic trapped in React components
- structured commands over ad hoc UI-only flows
- build planning and validation as reusable backend services
- deterministic config and manifest outputs

This is good architecture even if the CLI ships later.

---

## 7.6 CLI relationship to format backends

A future CLI should not know “DVD logic” directly.

Instead, it should:

- load the project
- detect the selected disc family/backend
- route validation/planning/build through the backend selector
- emit backend-aware summaries and results

This mirrors the same architecture planned for the desktop app.

---

## 7.7 CLI outputs worth planning for

Useful CLI outputs include:

- human-readable console summaries
- machine-readable JSON summaries
- build manifests
- diagnostics bundles
- explicit exit codes for CI use

This becomes especially useful for:

- automated nightly verification
- scripted rebuilds
- future BD backend testing
- regression tests for authored projects

---

## 7.8 Suggested CLI phases

### CLI Phase 1

- `capabilities`
- `validate`
- `plan`
- `build --dry-run`

### CLI Phase 2

- real `build`
- diagnostics export
- manifest export
- JSON output modes

### CLI Phase 3

- batch builds
- verification reports
- backend-specific advanced flags

---

## 7.9 Should the CLI be a separate binary?

Probably yes.

Recommended shape:

- shared Rust core crate(s)
- desktop Tauri app as one frontend entry point
- `spindle-cli` as a second frontend entry point

This avoids trying to bolt shell-like behaviour awkwardly into the GUI app itself.

---

## 8. Key design decisions to carry forward

1. The desktop app is the main authoring surface.
2. The CLI, if built, is primarily a headless project renderer/validator.
3. Shared domain logic should live in Rust, not in the GUI layer.
4. Menu preview and authored-output verification should remain distinct surfaces.
5. Toolchain visibility deserves its own UI, not just hidden backend plumbing.
6. Screen planning should leave room for themes, autogenerated menus, verification, and future BD backends.

---

## 9. Summary

The UI side of Spindle should be mocked as a sequence of authoring, planning, build, and trust surfaces rather than just a collection of isolated screens.

Its UX model should be:

- workspace-first as the primary product shape
- guided setup and guidance overlays where helpful
- progressive disclosure instead of a separate easy-mode shell

The CLI side should be thought of as a **headless companion path** for authored projects, not as the primary product interface.

The healthiest architecture is therefore:

- rich desktop authoring UI
- shared Rust core for logic and orchestration
- optional future CLI for validation, planning, and builds

That shape keeps Spindle disciplined while still leaving room for automation and advanced workflows.

