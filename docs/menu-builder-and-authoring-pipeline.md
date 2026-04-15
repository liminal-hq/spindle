# Menu Builder And Authoring Pipeline

This document explains how Spindle's menu builder works today, how menu data flows from the editor into the project model, and how that model is converted into authored DVD menu MPEG assets.

It focuses on the current still-menu implementation in the modularised `build/` pipeline.

## Scope

This note covers:

- the menu editor architecture in the frontend
- the shared project model used between TypeScript and Rust
- build-plan generation for menu jobs
- the menu-to-MPG and highlight-overlay pipeline
- `dvdauthor` XML generation for menu video and button commands

This note does not attempt to define a future motion-menu architecture in detail. Motion-menu fields already exist in the model, and the current workspace now exposes reserved inspector controls for motion audio and loop settings, but the compiled authored pipeline is still centred on still backgrounds plus highlight overlays.

## Quick View

![Animated overview of menu data moving from the editor into the build pipeline](./assets/menu-builder-state-flow.svg)

## High-Level Architecture

```mermaid
flowchart LR
    subgraph Frontend
        MP[MenusPage.tsx]
        MC[MenuCanvas]
        NP[NavigationPreview]
        PS[project-store.ts]
    end

    subgraph SharedModel
        PJ[SpindleProjectFile]
        MN[Menu]
        MB[MenuButton]
    end

    subgraph Plugin
        GP[generate_build_plan]
        RM[RenderMenu job]
        CH[ComposeMenuHighlights job]
        DX[generate_dvdauthor_xml]
    end

    subgraph ExternalTools
        FF[ffmpeg]
        SP[spumux]
        DV[dvdauthor]
    end

    MP --> MC
    MP --> NP
    MC --> PS
    NP --> PS
    PS --> PJ
    PJ --> MN
    MN --> MB
    PJ --> GP
    GP --> RM
    GP --> CH
    GP --> DX
    RM --> FF
    CH --> FF
    CH --> SP
    DX --> DV
```

## File Map

| Area              | Responsibility                                             | Primary files                                                                                                                     |
| ----------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Frontend editor   | Menu editing, button placement, action assignment, preview | `apps/spindle/src/pages/MenusPage.tsx`                                                                                            |
| Frontend state    | Project updates and persistence                            | `apps/spindle/src/store/project-store.ts`                                                                                         |
| Shared TS model   | Menu, button, and playback-action types                    | `apps/spindle/src/types/project.ts`                                                                                               |
| Shared Rust model | Rust-side schema used by the Tauri plugin                  | `plugins/tauri-plugin-spindle-project/src/models.rs`                                                                              |
| Build facade      | Public build API and module wiring                         | `plugins/tauri-plugin-spindle-project/src/build/mod.rs`                                                                           |
| Build planner     | Job discovery and plan assembly                            | `plugins/tauri-plugin-spindle-project/src/build/planner.rs`                                                                       |
| Menu authoring    | Menu rendering, overlays, and spumux XML                   | `plugins/tauri-plugin-spindle-project/src/build/menu.rs`                                                                          |
| DVD authoring     | `dvdauthor` XML and navigation command generation          | `plugins/tauri-plugin-spindle-project/src/build/authoring.rs`, `plugins/tauri-plugin-spindle-project/src/build/dvd_navigation.rs` |
| Build execution   | Subprocess execution and build orchestration               | `plugins/tauri-plugin-spindle-project/src/build/executor.rs`                                                                      |
| Plugin commands   | Tauri command surface                                      | `plugins/tauri-plugin-spindle-project/src/commands.rs`                                                                            |

## Menu Builder Architecture

### 1. The editor is a project-model editor, not a separate menu document system

The menu UI edits `Menu` values directly inside `SpindleProjectFile.disc`.

That means:

- global menus live under `disc.globalMenus`
- titleset menus live under `disc.titlesets[*].menus`
- buttons, navigation, and actions are stored immediately in the shared project model

There is no separate render document, scene graph, or template language yet. The authored menu pipeline consumes the same menu model that the editor mutates.

### 2. The Menus page is made of three conceptual layers

```mermaid
flowchart TD
    A[Menu list and selection] --> B[Menu editor container]
    B --> C[Visual canvas or navigation preview]
    B --> D[Button property rows]
    B --> E[Highlight colour controls]
    C --> F[Update menu bounds]
    D --> G[Update labels, actions, default button]
    E --> H[Update highlight palette]
    F --> I[updateProject]
    G --> I
    H --> I
```

Those layers behave differently:

- the visual canvas edits geometry
- the inspector edits labels, actions, background selection, display-aspect preview, and authored style states
- the preview reuses the same data but changes interaction mode and now surfaces authored button-state styling plus action chips

### 3. Menu actions are stored as playback actions

Each button has an optional `PlaybackAction`. The full set of variants is:

- `playTitle` — jump to a title by ID
- `playChapter` — jump to a specific chapter within a title
- `showMenu` — navigate to another menu by ID
- `setAudioStream` — switch the active audio stream
- `setSubtitleStream` — switch the active subtitle stream (or disable)
- `sequence` — compose multiple actions in order
- `stop` — stop playback
- `return` — return to the calling context

This is important architecturally because the menu editor is not hard-coded to DVD command strings. It stays at the level of authoring intent, and the Rust build pipeline translates that intent into DVD VM commands later. Note that not all variants have a direct DVD VM equivalent — `setAudioStream`, `setSubtitleStream`, and `sequence` are richer than what DVD menus natively support, and translation rules continue to evolve.

### 4. Navigation is geometric plus editable

Directional navigation can come from:

- manual per-button `navUp` / `navDown` / `navLeft` / `navRight`
- auto-generated geometry analysis from the plugin

That means the menu editor owns button layout, but the plugin can still assist with deterministic navigation assignment.

## Data Model

### Core menu entities

```mermaid
classDiagram
    class SpindleProjectFile {
        Disc disc
        Asset[] assets
        BuildSettings buildSettings
    }

    class Disc {
        Menu[] globalMenus
        Titleset[] titlesets
        PlaybackAction firstPlayAction
    }

    class Titleset {
        Title[] titles
        Menu[] menus
    }

    class Menu {
        string id
        string name
        string backgroundAssetId
        MenuButton[] buttons
        string defaultButtonId
        MenuHighlightColours highlightColours
        string backgroundMode
    }

    class MenuButton {
        string id
        string label
        ButtonBounds bounds
        PlaybackAction action
        string navUp
        string navDown
        string navLeft
        string navRight
    }

    SpindleProjectFile --> Disc
    Disc --> Titleset
    Disc --> Menu
    Titleset --> Menu
    Menu --> MenuButton
```

### Architectural implication

Because menu data is already normalised into the project model:

- build planning can be deterministic
- diagnostics can reason about menus without scraping UI state
- tests can construct menu scenarios directly in Rust without driving the UI

## Build-Plan Architecture

## Animated menu-to-MPG view

![Animated view of menu rendering, overlays, and authoring handoff](./assets/menu-to-mpg-pipeline.svg)

### 1. Build planning discovers authorable menus

The planner walks:

- global menus in the VMGM domain
- titleset menus in each VTS domain

Each discovered menu is wrapped in a small domain-aware structure so later steps know:

- which menu is being rendered
- whether it belongs to VMGM or a titleset
- which aspect profile should be used

### 2. Menu jobs are split into two authored stages

For each menu, the build plan emits:

1. `RenderMenu`
2. `ComposeMenuHighlights`

That split is intentional:

- the base menu video is rendered first as MPEG-2
- subpicture highlight/select overlays are generated separately
- `spumux` then combines the overlays with the menu video into the authored menu MPG

### 3. The planner remains declarative

The build plan is just data:

- job labels
- output paths
- commands
- generated XML blobs

That lets the UI preview the plan before execution and keeps runtime execution logic simpler.

## Menu-To-MPG Pipeline

```mermaid
sequenceDiagram
    participant UI as Menu editor
    participant Store as project store
    participant Planner as generate_build_plan
    participant FF as ffmpeg
    participant SP as spumux
    participant DA as dvdauthor

    UI->>Store: update menu, buttons, labels, actions
    Store->>Planner: submit SpindleProjectFile
    Planner->>Planner: discover authorable menus
    Planner->>Planner: create RenderMenu job
    Planner->>Planner: create ComposeMenuHighlights job
    Planner->>FF: render base menu MPG
    Planner->>FF: render highlight/select PNG overlays
    Planner->>SP: mux subpicture overlays into menu MPG
    Planner->>DA: reference final menu MPG in dvdauthor XML
```

### Stage A. Base menu render

The current still-menu render path does the following:

- choose the menu raster from DVD full-D1 dimensions
- derive the display aspect and sample aspect ratio from the menu domain
- render a background
  - from an assigned background asset if present
  - or from a generated solid-colour source if no asset is assigned
- draw visible button rectangles
- draw button labels with `drawtext`
- encode a short MPEG-2 DVD-compatible menu clip

This produces a `_base.mpg` file.

### Stage B. Overlay image generation

Before `spumux` runs, the pipeline generates:

- highlight PNG
- select PNG

These images are not full visual menu renders. They are subpicture overlays used by DVD players for button highlight states.

### Stage C. `spumux` composition

The planner generates a `spumux` XML document that contains:

- highlight image path
- select image path
- button rectangles
- directional navigation references

`spumux` reads the base menu MPG, adds the subpicture streams, and writes the final menu MPG used by `dvdauthor`.

## DVD Authoring Architecture

### Menu video and commands are authored separately

The final DVD menu needs two distinct things:

- a menu MPG asset
- valid DVD VM commands for buttons and post actions

Spindle handles these in different phases:

- ffmpeg and spumux create the menu video asset
- `generate_dvdauthor_xml` emits the `<pgc>`, `<vob>`, and `<button>` command structure

### Domain-aware command generation

Menu routing is sensitive to DVD VM context, so the command generator distinguishes:

- VMGM menu context
- titleset menu context
- title post-action context

That is why `PlaybackAction` is translated late. The legal DVD command depends on where the action executes, not just on the target.

### Current command rules in the implementation

- menu -> menu uses `jump`
- title -> menu uses `call`
- VMGM -> title uses disc-global `jump title N`
- titleset-local title/chapter targets use local title numbering
- non-root titleset menu targets are reached through a titleset `root` entry plus `g0` dispatch when needed
- title returns into titleset menus are authored as `call ... menu entry root` instead of illegal direct titleset menu PGC calls
- menu entry PGCs explicitly set the DVD `button` register so keyboard focus is deterministic on entry
- invalid cross-titleset title/chapter routes are rejected during planning

## Current Visual Behaviour

The current authored still-menu renderer now includes:

- button boxes
- default-button emphasis
- button label text
- highlight and select overlays

It does not yet try to recreate every visual nuance of the canvas editor. In particular:

- there is not yet a rich text layout engine
- motion-menu playback is not fully authored
- advanced typography and custom font selection are not part of the model
- background composition is still deliberately simple

## Failure Boundaries And Diagnostics

### Frontend layer

The frontend can produce:

- invalid or incomplete menu data
- dangling menu targets
- awkward geometry or overlapping button states

These are mostly caught by validation and by build-time command generation.

### Current automated coverage

The Rust test suite covers the tricky menu-navigation cases that were most likely to regress:

- VMGM to titleset root-entry jumps
- `g0`-dispatched jumps to later titleset menus
- title post returns to same-titleset and cross-titleset menus
- menu entry initialisation for explicit defaults and first-button fallback

There is also an ignored smoke test in `build/executor.rs` that runs a tiny `ffmpeg -> spumux -> dvdauthor` build and verifies that `VIDEO_TS` output is authored successfully. It is intended for container or CI environments that already provide the external DVD toolchain.

### Planner layer

The planner can fail when:

- a referenced background asset cannot be found
- a playback target cannot be resolved
- a routing pattern would produce an illegal DVD VM command

This is the right place to fail for authoring-rule violations, because it keeps those problems visible before `dvdauthor` starts.

### Tool-execution layer

The external tools can fail when:

- ffmpeg cannot render the menu video
- ffmpeg cannot render overlay images
- spumux rejects the overlay XML or button geometry
- dvdauthor rejects the final command structure

The recent audit work added more routing tests specifically to reduce the last category.

## Architecture Strengths

- one shared project model drives both editor and authoring pipeline
- menu jobs are visible in the build plan instead of being hidden backend work
- routing logic is now covered by a denser Rust test matrix
- menu rendering is decomposed into stages that are easier to debug

## Architecture Constraints

- the still-menu renderer is intentionally not a pixel-perfect reproduction of the canvas
- text rendering currently depends on ffmpeg `drawtext`, so typography is constrained
- motion-menu fields exist ahead of full motion-menu authoring
- DVD VM routing remains domain-sensitive and must stay heavily tested

## Suggested Next Improvements

1. Add a menu render preview artifact to diagnostics exports.
2. Store explicit menu typography settings in the shared model.
3. Add tests for fallback behaviour when menu targets are missing.
4. Add a visual regression fixture for menu command generation and render-command output.
5. Decide how motion-menu timing, looping, and timeout behaviour should map into authored jobs.
