# Spindle Menu System Specification

This document is the canonical feature specification for Spindle's menu system.

It replaces the previous split between a Spindle-specific draft and an external inspiration report. The goal here is to define one complete menu-system direction for the product and the current codebase.

## Summary

Spindle already has the beginnings of a strong authored-menu architecture:

- a shared project model in TypeScript and Rust
- semantic playback actions instead of backend command strings
- explicit directional navigation with deterministic auto-generation
- a planner that already treats menu rendering and menu authoring as separate jobs

What Spindle does not yet have is a rich authored menu document.

Today, the codebase still models a menu as:

- one background asset
- a list of rectangular buttons
- one menu-level highlight palette
- a few motion placeholders without a complete timing model

That is enough for a first DVD-safe implementation, but it is not enough for a long-term menu system that can support richer still menus, generated layouts, motion, and later Blu-ray backends.

The product direction is therefore:

1. keep the shared project model, action model, and planner strengths
2. replace the flat menu shape with a scene-driven authored document
3. introduce components, themes, and generated layouts as first-class concepts
4. compile authored intent honestly into DVD-safe output
5. preserve room for future Blu-ray backends without another model reset

## Current Codebase Baseline

The current implementation is centred around these files:

Frontend and shared state:

- `apps/spindle/src/pages/MenusPage.tsx`
- `apps/spindle/src/store/project-store.ts`
- `apps/spindle/src/types/project.ts`

Rust schema and build pipeline:

- `plugins/tauri-plugin-spindle-project/src/models.rs`
- `plugins/tauri-plugin-spindle-project/src/build/navigation.rs`
- `plugins/tauri-plugin-spindle-project/src/build/menu.rs`
- `plugins/tauri-plugin-spindle-project/src/build/planner.rs`
- `plugins/tauri-plugin-spindle-project/src/build/types.rs`
- `plugins/tauri-plugin-spindle-project/src/build/authoring.rs`
- `plugins/tauri-plugin-spindle-project/src/build/dvd_navigation.rs`

Supporting architecture notes:

- `docs/menu-builder-and-authoring-pipeline.md`
- `SPEC.md`

### What the current implementation already does well

Shared model, not hidden editor state:

- the editor writes directly into the project model
- menus are first-class authored objects
- Rust tests can construct authored menus without UI automation

Semantic actions, not backend strings:

- buttons store `PlaybackAction`
- DVD command translation happens late in the authoring pipeline

Explicit navigation:

- menus already store directional neighbours
- navigation auto-generation is deterministic and testable

Planner-visible build work:

- menu rendering and highlight composition are already separate build jobs
- the build pipeline is structured enough to absorb richer menu passes later

### Where the current model stops

Flat authored structure:

- the current `Menu` shape has no scene graph, layers, grouping, non-button nodes, or reusable component instances

Crude rendering:

- the current build renderer draws boxes and labels over a background asset

Global highlight model:

- highlight state is modelled as one menu-level palette instead of richer authored state that compiles down to DVD constraints

Incomplete motion model:

- motion fields exist, but there is no unified timing, animation, or preview system

No distinction between authored and compiled representations:

- the model mixes user-authored structure with fields chosen for the current DVD compiler

## Product Stance

Spindle should author menus at a richer semantic level than the final DVD target.

The system should let users design menus as authored scenes, while the build backend compiles those scenes into:

- DVD-safe background video or stills
- DVD-safe highlight and select overlays
- DVD navigation commands
- later, richer backend-specific outputs for Blu-ray

The key principle is:

> Author once at the menu-system level, then compile honestly for the target format.

Spindle should not pretend that DVD is more capable than it is. Every compromise imposed by the medium should be surfaced to the user through preview, diagnostics, or compile reports.

## Goals

### Goal A. Spindle-native workflow

The menu system must feel like part of Spindle rather than a bolted-on authoring tool.

That means:

- authored menus live in the same project model as titles, chapters, and track mappings
- generated menus derive from project data instead of from ad hoc file scanning
- build planning stays deterministic and inspectable

### Goal B. Rich still menus without dishonest preview

The system should support richer visual design than the current button-overlay model while still making DVD limits visible.

### Goal C. Editable generation

Spindle should generate useful menu baselines for common cases:

- main menu
- title selection
- chapter menu
- audio picker
- subtitle picker
- extras menu

Generated menus must remain editable after generation.

### Goal D. Motion-aware architecture

Motion should extend the same authored menu document rather than becoming a separate subsystem.

### Goal E. Future-proof backend design

The menu system should scale from DVD to later Blu-ray authoring without forcing another authored-model rewrite.

## Design Principles

### 1. Separate authoring from compilation

The user edits an authored scene document. The backend compiles that scene into format-specific assets.

### 2. Keep interaction explicit

Focus targets, directional neighbours, default focus, timeout behaviour, and activation actions must stay modelled explicitly and testably.

### 3. Prefer reusable components over ad hoc button styling

Visual patterns such as chapter tiles, text buttons, back buttons, and title cards should be defined once and reused.

### 4. Make generated output editable

Generation should create authored scenes, not locked templates.

### 5. Show every downgrade

If authored intent exceeds DVD limits, Spindle should not hide that. It should preview the compromise and explain it.

## Target Architecture

The new menu system has five layers.

### Layer 1. Authored scene document

This is the canvas document that the user edits.

It contains:

- layers
- groups
- text nodes
- image nodes
- shape nodes
- video panels
- button visuals
- guides and annotations
- component instances
- generated layout nodes

### Layer 2. Interaction graph

This stores remote-driven behaviour.

It contains:

- focusable nodes
- directional neighbours
- default focus
- activation actions
- timeout action
- return behaviour

### Layer 3. Theme and component system

This stores reusable style and layout rules.

It contains:

- typography tokens
- spacing tokens
- colour systems
- focus treatments
- component definitions
- generation presets
- DVD fallback rules

### Layer 4. Compile variants

This stores target-specific adaptation choices without mutating authored intent.

Examples:

- DVD 16:9 variant
- DVD 4:3 safe-area variant
- overlay mask extraction policy
- reduced-palette highlight mapping

### Layer 5. Compiled assets

This is the real backend output.

For DVD, that means:

- background still or motion MPEG
- highlight and select overlays
- `spumux` XML
- `dvdauthor` XML
- backend command routing

For future Blu-ray, that will later include:

- higher-fidelity menu graphics
- page timing metadata
- backend routing metadata

## Authored Data Model

The current flat `Menu` model should evolve toward a structured authored document.

A representative direction is:

```ts
export interface MenuDocument {
  id: string;
  name: string;
  domain: 'vmgm' | 'titleset';
  scene: MenuScene;
  interaction: MenuInteractionGraph;
  timing: MenuTiming;
  themeRef: string | null;
  generationMeta: MenuGenerationMeta | null;
  compilePolicy: MenuCompilePolicy;
}

export interface MenuScene {
  designSize: { width: number; height: number };
  background: SceneBackground;
  nodes: SceneNode[];
  guides: SceneGuide[];
}

export type SceneNode =
  | GroupNode
  | TextNode
  | ImageNode
  | ShapeNode
  | VideoNode
  | ButtonNode
  | ComponentInstanceNode
  | GeneratedCollectionNode;

export interface MenuInteractionGraph {
  defaultFocusId: string | null;
  nodes: FocusNode[];
  timeoutAction: PlaybackAction | null;
}
```

The important change is separation of concerns:

- scene handles visual authoring
- interaction handles remote behaviour
- timing handles motion and timeout rules
- theme handles reusable style
- compile policy handles target-specific compromises

## Scene Graph And Node Types

The scene graph is the biggest functional upgrade from the current model.

### Non-interactive nodes

- text
- image
- shape
- video panel
- decorative effect layer
- group
- guide or annotation

### Interactive nodes

- button
- chapter tile
- menu link tile
- audio choice
- subtitle choice
- generated collection item

### Generated nodes

- repeaters
- chapter grids
- title shelves
- paginated collections

Generated nodes should resolve into editable scene content rather than staying opaque forever.

## Components And Themes

Spindle should not hardcode every button style directly into menus.

Instead, it should support reusable component definitions such as:

- `HeroTitleButton`
- `ChapterThumbnailTile`
- `TextPillButton`
- `BackChevronButton`
- `PosterShelfItem`

Each component should describe:

- internal node tree
- editable slots
- bindable fields
- default sizing behaviour
- authored visual states
- DVD fallback hints

Themes should be semantic rather than purely decorative.

They should define reusable decisions such as:

- title typography
- body typography
- spacing scales
- thumbnail framing
- focus and activate treatments
- safe layout defaults
- generation presets

## State Model

Authored buttons should support at least three semantic states:

- normal
- focus
- activate

The authored model may also support richer state metadata for motion or compile preview, but the core authored intent should remain format-independent.

DVD output then maps authored states down into:

- background visuals that must be baked into the menu video
- focus overlay mask
- activate overlay mask

Spindle should make the mapping strategy explicit so users know whether the DVD overlay comes from:

- focus state extraction
- activate state extraction
- automatic mask derivation
- an explicit authored mask source

## Layout And Generation

Generated menus should create authored scenes based on project data and theme rules.

Recommended first generated menu families:

- main menu
- title-selection menu
- chapter-selection menu
- audio-track menu
- subtitle-track menu

Generation must capture metadata about what was generated so the system can support safe regeneration, diffable updates, and selective relayout later.

The system should also support data binding for common authored content:

- title names
- chapter names
- chapter thumbnails
- track labels
- language labels
- return actions

## Motion Model

Motion belongs in the same document model as still menus.

The timing model should support:

- intro segment
- loop segment
- timeout
- loop count
- background audio
- per-node animation tracks for a limited supported property set

Motion support should be compile-policy aware from day one. If a menu effect is too costly or impossible for the target backend, the system must say so.

## Rendering Architecture

The product needs two related renderers.

### Editor preview renderer

Responsibilities:

- fast visual editing
- authored-state previews
- remote-focus simulation
- compile-variant preview

### Build renderer

Responsibilities:

- render authored still or motion menu passes
- generate focus and activate overlays
- emit format-specific assets

The long-term build renderer should move beyond the current `drawbox` and `drawtext` path in `build/menu.rs`.

Recommended render passes:

1. background pass
2. normal composed pass
3. focus-mask extraction pass
4. activate-mask extraction pass
5. target-specific composition pass

## Remote Navigation

The focus graph should remain explicit in the authored model.

Spindle should keep automatic navigation generation, but make it better and more inspectable.

Future heuristics should consider:

- geometric distance
- alignment
- component role
- row and column intent
- group boundaries
- focus-order presets

The remote simulator should become a full mode in the editor rather than a lightweight preview add-on.

## DVD Constraints The System Must Honour

DVD remains a constrained target. The specification must continue to respect that.

### Interactive area geometry

- interactive hit regions ultimately compile to DVD-safe button areas
- authored hit regions may be richer, but the compile step must expose any forced simplification

### Overlay palette limits

- highlight and select overlays remain palette-constrained
- the compile preview must show when authored colour treatments collapse or merge

### Button count budgets

- menu complexity should be validated before build

### Motion honesty

- motion menus must expose build cost and target limitations

### Typography safety

- the editor should surface action-safe and title-safe guidance
- compile preview should warn when authored text is likely to become unreadable

## Diagnostics And Trust

The menu system should report issues in authored terms, not only backend terms.

Required diagnostics include:

- broken action targets
- broken neighbour references
- unreachable focus nodes
- excessive button count
- unsafe text placement
- authored features dropped during DVD compile
- overlay palette reduction warnings
- compile-variant mismatch warnings

Preview and verification must remain separate concepts:

- authored preview shows design intent
- remote preview shows navigation behaviour
- compile preview shows target-safe output
- build verification confirms generated assets and authored structure align closely enough to trust

## UI And Workflow

The Menus page should evolve from a button list into a document editor with four main modes:

- Design
- Bind
- Remote
- Compile

The page should expose:

- document list
- canvas
- layers panel
- inspector
- remote simulator
- compile preview

Simple projects should still have a fast path:

- add menu
- add button
- assign action
- auto-wire navigation
- build

The advanced system should not punish the simple workflow.

## Delivery Phases

The recommended delivery order is:

1. schema expansion with compatibility projections
2. scene-backed still-menu editor
3. components, themes, and generated menu families
4. compile preview and downgrade reporting
5. motion-menu support
6. Blu-ray backend integration

Each phase should preserve working DVD builds.

## Non-Goals

The menu-system upgrade should not:

- expose raw DVD VM programming as a primary workflow
- hide target-specific compromises
- tie generated menus to one visual style
- make the canvas pretend authored preview equals final DVD output
- make DVD the only long-term mental model for the system

## Final Product Stance

Spindle should treat menus as authored documents with explicit interaction, reusable styling, and honest compilation.

That stance preserves the strengths already visible in the current codebase while fixing the main limitation of the current menu model: it is still too close to a debug-friendly DVD overlay representation and not yet rich enough to be the product's long-term menu authoring system.
