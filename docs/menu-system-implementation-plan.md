# Menu System Implementation Plan

This plan turns the menu-system specification into an implementation sequence that fits the current Spindle codebase.

It assumes we preserve working DVD menu builds while we introduce a richer authored menu model, a more capable editor, and a format-aware compile pipeline that can later scale to Blu-ray.

## Purpose

The immediate goal is not to replace everything at once. The goal is to move Spindle from a flat button-overlay menu model to a scene-driven menu system through staged, shippable milestones.

The implementation plan therefore favours:

- compatibility-preserving schema evolution
- incremental frontend replacement
- planner and renderer changes behind explicit build stages
- diagnostics that show every downgrade from authored intent to DVD-safe output
- test coverage at each seam so the richer model does not destabilise DVD authoring

## Current Baseline

The current implementation is strong in a few important ways:

- `apps/spindle/src/types/project.ts` and `plugins/tauri-plugin-spindle-project/src/models.rs` already share a stable menu schema
- `apps/spindle/src/pages/MenusPage.tsx` edits the shared project model directly rather than keeping hidden editor state
- `plugins/tauri-plugin-spindle-project/src/build/navigation.rs` already gives us deterministic auto-navigation
- `plugins/tauri-plugin-spindle-project/src/build/planner.rs` already splits menu work into explicit jobs
- `plugins/tauri-plugin-spindle-project/src/build/menu.rs` and `plugins/tauri-plugin-spindle-project/src/build/authoring.rs` already separate video rendering, highlight composition, and DVD command generation

The current implementation also defines the main constraints we need to break apart:

- a menu is still `backgroundAssetId + buttons[] + highlightColours`
- visual authoring is limited to rectangles, labels, and one menu-level highlight palette
- motion fields exist, but there is no coherent timing or animation model
- the frontend still treats the editor as a button list plus drag canvas, not as a scene document
- the build plan cannot yet represent compile variants, downgrade reports, or richer authored state passes

## Delivery Strategy

The work should ship in six phases. Each phase should leave the codebase in a releasable state.

### Phase 0. Document and alignment foundation

Deliverables:

- finalise the canonical menu-system feature spec
- create this implementation plan
- align naming for authored scene, interaction graph, theme system, compile variants, and compiled assets

Files:

- `docs/Spindle_Menu_System_Spec.md`
- `docs/menu-system-implementation-plan.md`

Exit criteria:

- one canonical spec exists
- engineering terms are stable enough to use in schema and UI

### Phase 1. Compatibility-preserving schema expansion

Deliverables:

- add a new authored menu document model alongside the legacy flat fields
- keep legacy fields readable and writable while new fields are introduced
- define migration helpers between legacy `Menu` data and the new scene-backed structure
- add serialisation tests and round-trip fixtures

Primary files:

- `plugins/tauri-plugin-spindle-project/src/models.rs`
- `apps/spindle/src/types/project.ts`
- `plugins/tauri-plugin-spindle-project/src/lib.rs`
- `plugins/tauri-plugin-spindle-project/src/commands.rs`
- `apps/spindle/src/types/project.test.ts`

Key tasks:

1. Introduce a `MenuDocument` style structure inside `Menu`, or replace `Menu` with a richer compatible shape if the migration cost stays acceptable.
2. Separate authored layers:
   - scene
   - interaction
   - timing
   - theme reference
   - compile policy
3. Keep old fields available as a transitional projection:
   - `backgroundAssetId`
   - `buttons`
   - `defaultButtonId`
   - `highlightColours`
4. Add migration helpers that can:
   - lift legacy menus into a default scene
   - flatten a simple scene back into legacy button overlays where needed

Exit criteria:

- existing projects still open
- menu serialisation remains deterministic
- the frontend can read the new schema without breaking build planning

### Phase 2. Scene-backed still-menu foundation

Deliverables:

- introduce a first-class scene graph for still menus
- replace the current button-row mental model with layers plus inspector data structures
- keep a simple-mode workflow for basic projects

Primary files:

- `apps/spindle/src/pages/MenusPage.tsx`
- `apps/spindle/src/pages/MenusPage.css`
- `apps/spindle/src/store/project-store.ts`
- new editor components under `apps/spindle/src/components/`

Key tasks:

1. Split the Menus page into composable editor areas:
   - document sidebar
   - canvas
   - layer list
   - inspector
   - remote preview
2. Represent authored scene nodes explicitly:
   - text
   - image
   - shape
   - group
   - button
   - generated collection placeholder
3. Keep a "quick edit" path that maps simple authored buttons onto the new inspector without exposing the entire scene model up front.
4. Preserve current features during the transition:
   - add menu
   - add button
   - resize and move interactive regions
   - assign action
   - auto-generate navigation

Exit criteria:

- users can author a still menu through the new scene-backed editor
- simple menus remain easy to create
- project-store updates stay serialisable and deterministic

### Phase 3. Component, theme, and generated-layout system

Deliverables:

- reusable menu components with slots and defaults
- theme tokens and style recipes
- generated menu families that output editable scenes rather than locked templates

Primary files:

- `apps/spindle/src/pages/MenusPage.tsx`
- `apps/spindle/src/store/project-store.ts`
- `apps/spindle/src/types/project.ts`
- new shared menu-component definitions
- `SPEC.md` menu section only if product-level scope needs refreshing after implementation lands

Key tasks:

1. Define a component schema with:
   - internal node tree
   - bindable fields
   - state variants
   - DVD fallback hints
2. Add theme tokens for:
   - typography
   - spacing
   - colour ramps
   - focus treatments
   - thumbnail framing
3. Implement generation presets for:
   - main menu
   - title selection
   - chapter grid
   - audio and subtitle pickers
4. Track generation metadata so regeneration is explicit rather than destructive.

Exit criteria:

- at least one generated menu family creates editable authored scenes
- component reuse replaces duplicated button styling logic
- theme changes can affect multiple menus without mutating authored content directly

### Phase 4. Compiler and preview rebuild

Deliverables:

- authored-scene render passes for preview and build
- state-pass extraction for DVD overlays
- compile variants and downgrade reporting

Primary files:

- `plugins/tauri-plugin-spindle-project/src/build/menu.rs`
- `plugins/tauri-plugin-spindle-project/src/build/planner.rs`
- `plugins/tauri-plugin-spindle-project/src/build/types.rs`
- `plugins/tauri-plugin-spindle-project/src/build/authoring.rs`
- `plugins/tauri-plugin-spindle-project/src/build/dvd_navigation.rs`
- `apps/spindle/src/pages/MenusPage.tsx`

Key tasks:

1. Replace the long-term `drawbox` and `drawtext` renderer with a render pipeline that can consume authored scene nodes.
2. Add distinct render passes for:
   - static background
   - normal visual state
   - focus mask extraction
   - activate mask extraction
3. Extend build jobs so the plan can surface:
   - compile variant selection
   - downgrade warnings
   - overlay extraction outputs
   - authored vs compiled previews
4. Add a compile preview in the frontend that compares:
   - authored view
   - DVD-safe output
   - constraint warnings

Exit criteria:

- still menus build through the new renderer
- overlay generation comes from authored state passes instead of raw button bounds alone
- the user can see compile compromises before a full build

### Phase 5. Navigation, diagnostics, and verification hardening

Deliverables:

- richer focus-graph tooling
- stronger diagnostics
- verification coverage for authored vs compiled behaviour

Primary files:

- `plugins/tauri-plugin-spindle-project/src/build/navigation.rs`
- `plugins/tauri-plugin-spindle-project/src/commands.rs`
- `apps/spindle/src/store/project-store.ts`
- `apps/spindle/src/pages/MenusPage.tsx`
- validation and test files in both frontend and Rust

Key tasks:

1. Upgrade navigation heuristics to consider:
   - component role
   - group structure
   - row and column intent
   - focus-order presets
2. Add diagnostics for:
   - unreachable buttons
   - conflicting neighbours
   - unsafe typography
   - overlay palette pressure
   - excessive button count
   - authored features dropped in DVD compile
3. Expand remote simulation so it is a full view mode rather than a small preview helper.

Exit criteria:

- remote behaviour is testable and inspectable before build
- validation covers both authored structure and DVD compile limits

### Phase 6. Motion-menu foundation

Deliverables:

- authored timing model
- loop and timeout semantics
- animation tracks for supported node properties
- motion-aware compile preview

Primary files:

- `plugins/tauri-plugin-spindle-project/src/models.rs`
- `apps/spindle/src/types/project.ts`
- `plugins/tauri-plugin-spindle-project/src/build/menu.rs`
- `plugins/tauri-plugin-spindle-project/src/build/planner.rs`
- `apps/spindle/src/pages/MenusPage.tsx`

Key tasks:

1. Convert existing motion placeholders into a real timing structure.
2. Support intro, loop, and timeout semantics in the authored model.
3. Restrict motion features to what the active backend can compile honestly.
4. Surface build-cost diagnostics for motion menus.

Exit criteria:

- motion is modelled as an extension of the same menu document
- still and motion menus share the same editor and compile pipeline concepts

## Workstreams

The phases above map to four practical workstreams.

### 1. Schema and migration

Focus:

- `plugins/tauri-plugin-spindle-project/src/models.rs`
- `apps/spindle/src/types/project.ts`

Responsibilities:

- new authored menu types
- migration helpers
- serialisation compatibility
- validation type updates

### 2. Frontend authoring experience

Focus:

- `apps/spindle/src/pages/MenusPage.tsx`
- `apps/spindle/src/store/project-store.ts`
- new editor components

Responsibilities:

- scene editing
- inspector and layer list
- remote preview
- generated-menu flows

### 3. Build and compile pipeline

Focus:

- `plugins/tauri-plugin-spindle-project/src/build/*.rs`

Responsibilities:

- render passes
- compile variants
- overlay extraction
- authored-to-DVD mapping

### 4. Diagnostics and trust

Focus:

- frontend validation views
- Rust validation logic
- build plan reporting
- compile preview

Responsibilities:

- downgrade visibility
- navigation verification
- authored-vs-compiled comparison
- regression protection

## Recommended Sequencing

Work should be sequenced to keep the repo stable:

1. merge schema scaffolding before major UI rewrites
2. land the editor shell before component libraries
3. keep the legacy menu compiler working until the new render path is proven
4. only remove legacy fields after the new pipeline can open, edit, preview, and build real projects

## Testing Plan

Each phase should add or update tests in the same PR.

Required coverage:

- TypeScript schema tests for new menu types and migration helpers
- Rust serialisation tests for forward and backward compatibility
- Rust unit tests for navigation heuristics and compile-policy mapping
- planner tests for new build-job types and output shapes
- frontend tests for editor state transitions and quick-edit workflows

Manual verification checkpoints:

- open an older project and confirm menus still load
- create a new simple menu and build a DVD project
- generate a menu from title and chapter data, then edit it manually
- compare authored preview against DVD compile preview
- confirm downgrade warnings appear when authored features exceed DVD limits

## Risks And Mitigations

### Risk: schema churn breaks project compatibility

Mitigation:

- keep legacy projections during migration
- add round-trip fixtures before removing old fields

### Risk: editor rewrite stalls before build support catches up

Mitigation:

- gate the new editor on scene data that can still project into the existing build model early on

### Risk: richer visuals create misleading previews

Mitigation:

- make compile preview and downgrade reporting mandatory before expanding motion and advanced effects

### Risk: build-job growth makes planning noisy

Mitigation:

- group jobs by authored menu and expose sub-steps rather than flattening every tiny render pass into user-facing noise

## Definition Of Done

The menu-system upgrade is complete when all of the following are true:

- menus are authored as scene documents rather than flat button lists
- interaction is modelled explicitly and tested independently of rendering
- themes and generated components are reusable across menus
- DVD output is compiled from authored state passes with visible downgrade reporting
- the same architecture can support a future Blu-ray backend without another model rewrite
