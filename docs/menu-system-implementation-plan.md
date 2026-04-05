# Menu System Implementation Plan

This plan turns the menu-system specification into an implementation sequence that completely replaces the legacy menu model.

## Purpose

The goal is to move Spindle from a flat button-overlay menu model to a fully scene-driven menu system. Because the team has chosen to "implement it all" in one holistic push, we are taking a direct replacement approach. We accept that the DVD authoring pipeline will temporarily break during this transition, provided the final system is robust, format-aware, and scalable to both DVD and future Blu-ray targets.

The implementation plan therefore favours:

- **Direct Schema Replacement**: No legacy field projections. The `Menu` schema is replaced by `MenuDocument`.
- **Holistic Frontend Rewrite**: The Menus page becomes a full scene editor immediately.
- **New Compiler Pipeline**: The old `drawbox` renderer is discarded in favour of a state-pass extraction renderer.
- **Motion from Day One**: Motion timing is integrated into the core schema and compiler rather than bolted on later.

## Current Baseline

The current implementation is strong in a few important ways:

- `apps/spindle/src/types/project.ts` and `plugins/tauri-plugin-spindle-project/src/models.rs` already share a stable menu schema
- `apps/spindle/src/pages/MenusPage.tsx` edits the shared project model directly
- `plugins/tauri-plugin-spindle-project/src/build/planner.rs` already splits menu work into explicit jobs

The current implementation also defines the main constraints we are breaking apart:

- a menu is currently `backgroundAssetId + buttons[] + highlightColours`
- visual authoring is limited to rectangles, labels, and one menu-level highlight palette
- the frontend still treats the editor as a button list plus drag canvas, not as a scene document
- the build plan cannot yet represent compile variants, downgrade reports, or richer authored state passes

## Delivery Strategy

Instead of compatibility-preserving micro-phases, we will execute in three major, interdependent milestones. The codebase will not produce playable DVDs until Milestone 3 is complete.

### Milestone 1: The Unified Schema and Model

Deliverables:

- Replace the legacy `Menu` struct with `MenuDocument` containing Scene, Interaction, Timing, Theme, and Compile Policy.
- Remove old `backgroundAssetId`, `buttons`, and `highlightColours` from the root schema entirely.
- Write a one-way migration to lift existing projects into the new scene format upon load.
- Update TypeScript types to match.

Primary files:

- `plugins/tauri-plugin-spindle-project/src/models.rs`
- `apps/spindle/src/types/project.ts`
- `plugins/tauri-plugin-spindle-project/src/lib.rs`
- `plugins/tauri-plugin-spindle-project/src/commands.rs`

Exit criteria:

- Rust and TypeScript share the new scene-based schema.
- Legacy projects migrate successfully in-memory upon load.

### Milestone 2: The Scene Editor and Interactive Canvas

Deliverables:

- Replace `MenusPage.tsx` with a multi-pane document editor (canvas, layers, inspector, preview).
- Implement interactive nodes (Text, Image, Shape, Video, Button).
- Implement the Interaction graph (focus routing, activation actions).
- Implement the Timing model (intro, loop, timeout).
- Introduce components and themes for reusable button/menu styling.
- Add generation presets for common layouts (main menu, chapter grid).

Primary files:

- `apps/spindle/src/pages/MenusPage.tsx`
- `apps/spindle/src/store/project-store.ts`
- new editor components under `apps/spindle/src/components/`

Exit criteria:

- Users can author complex still and motion scenes.
- The interaction graph correctly simulates remote navigation.

### Milestone 3: The Target-Aware Compiler and Diagnostics

Deliverables:

- Delete the legacy `drawbox` and `drawtext` renderer in `build/menu.rs`.
- Build a new render pipeline that reads `MenuScene` and `MenuTiming`.
- Implement state-pass extraction: generate DVD highlight/select overlays by rendering the scene's focus and activate states using FFmpeg complex filtergraphs.
- Implement downgrade diagnostics (e.g., warning if a scene uses too many palette colours for DVD limits).
- Re-wire `build/planner.rs` and `build/navigation.rs` to consume the new `MenuDocument`.

Primary files:

- `plugins/tauri-plugin-spindle-project/src/build/menu.rs`
- `plugins/tauri-plugin-spindle-project/src/build/planner.rs`
- `plugins/tauri-plugin-spindle-project/src/build/authoring.rs`
- `plugins/tauri-plugin-spindle-project/src/build/dvd_navigation.rs`

Exit criteria:

- The new build pipeline successfully compiles scene-based menus into DVD-compliant MPEG and `spumux` outputs.
- Diagnostics correctly warn users of target-specific downgrades.

### Milestone 4: Automated Generation & Presets

Deliverables:

- Implement the **Generation Engine**: logic to create authored scenes based on project data (Titles, Chapters, Audio/Subtitle tracks).
- Add **Generation Presets**: pre-defined layouts for common menu types (Main Menu, Chapter Grid, Title Shelf).
- Implement **Data Binding**: authored nodes (text, image, button) can bind to project metadata (e.g., `chapter.name`, `title.thumbnail`).
- Support **Safe Regeneration**: allow users to refresh a generated menu without losing manual design tweaks.

Primary files:

- `apps/spindle/src/store/project-store.ts` (Generation logic)
- new generator components under `apps/spindle/src/components/menus/generators/`
- `plugins/tauri-plugin-spindle-project/src/models.rs` (Generation metadata persistence)

Exit criteria:

- Users can generate a functional Chapter Menu with working thumbnails and navigation in one click.
- Generated menus are fully editable authored documents.

## Workstreams

The milestones above map to three practical workstreams that can run concurrently after Milestone 1 is defined:

### 1. Schema and Migration

Responsibilities: new authored menu types, migration helpers, serialisation compatibility.

### 2. Frontend Authoring Experience

Responsibilities: scene editing, inspector, remote preview, component libraries, motion preview.

### 3. Build, Compile, and Diagnostics

Responsibilities: render passes, compile variants, state overlay extraction, authored-to-DVD mapping, downgrade visibility.

## Recommended Sequencing

1. Merge schema replacement (`models.rs` and `project.ts`). This deliberately breaks the build and the UI.
2. Rebuild the frontend editor (`MenusPage.tsx`) on top of the new schema.
3. Concurrently rebuild the backend compiler (`build/menu.rs`) to consume the new schema.
4. Integrate compile previews and diagnostics into the editor.
5. Restore end-to-end DVD building.

## Testing Plan

Required coverage:

- TypeScript and Rust serialisation tests for the new scene types.
- Rust unit tests for the one-way legacy migration logic.
- Rust unit tests for the new navigation heuristics across the scene graph.
- Frontend tests for scene node manipulations and selection.

Manual verification checkpoints:

- Open a legacy project and verify its buttons are lifted into scene nodes.
- Author a new complex menu with motion and verify the canvas preview matches intent.
- Build a DVD and verify the final `spumux` XML and overlays exactly match the authored interaction states.

## Risks And Mitigations

### Risk: Prolonged broken state

Because we are breaking DVD compatibility to "implement it all" at once, the `main` branch will be broken for an extended period.
**Mitigation:** Use a feature branch for the overarching menu system overhaul, merging back to `main` only when end-to-end authoring is restored.

### Risk: The "Infinite Canvas"

The new scene graph might inspire users to create layouts impossible to compile for DVD.
**Mitigation:** The compiler _must_ implement rigid downgrade reports and target-aware diagnostics to enforce DVD reality, even if the canvas is flexible.

## Definition Of Done

The holistic menu-system implementation is complete when all of the following are true:

- The legacy flat menu schema and `drawbox` renderer have been deleted.
- Menus are authored as scene documents with explicit interaction, themes, and motion timing.
- DVD output is compiled correctly from authored state passes.
- Downgrades and target constraints are explicitly reported to the user prior to building.
