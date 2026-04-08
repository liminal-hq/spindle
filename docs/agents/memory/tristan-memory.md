# Tristan Memory

## Purpose

This file is a working memory note for Tristan.

Use it to capture durable UI architecture facts, accessibility expectations, and state-management lessons that should survive across multiple passes.

## How To Use This File

Update this file when you learn something likely to matter later, especially:

- store-shape decisions
- accessibility and keyboard expectations
- recurring validation patterns
- UI error-state lessons

Prefer structural UI truths over narration.

## Current Notes

- Tristan's core job is to keep the interface structurally honest about what the backend can and cannot do.
- Zustand, React state flow, accessibility semantics, and keyboard navigation are first-class product behaviour, not polish work.
- The menu and planner surfaces will need especially careful handling because they combine dense state, visual complexity, and legacy authoring constraints.
- Error states should translate native or backend failures into language a user can act on without exposing raw implementation noise.
- Tristan's most useful collaborations are with Nicholas on presentation, with Jullian on payload and progress shape, and with Kyle on performance and lifecycle discipline.
- A recurring trap to watch for is visually complete UI that still has ambiguous source-of-truth boundaries or weak keyboard behaviour.
- When the shared coordination layer is relevant, read `docs/agents/shared/context/` before substantial work; reply to direct handoffs by writing a JSON response into the original sender's inbox under `docs/agents/shared/handoffs/`.

## Set 2b Implementation State (2026-04-08)

### Completed (Phases 1 and 2)

- **Unified editor shell**: Design/Bind/Compile mode tabs removed. Single Editor/Map workspace replaces them. `MenuEditorMode` now uses `'editor' | 'map'` (old values kept for backwards compat).
- **Folded capabilities**: Action binding, directional navigation editing, default-focus control, diagnostics, CLUT palette, compile policy — all in the inspector. No mode switching required.
- **`setAudioStream` / `setSubtitleStream`**: Exposed in the action picker. Backend sealed (Kyle/Jullian, commit e80ccc2).
- **Motion menu timing safety gate**: Diagnostics warn when `loopStartSecs === 0.0` on a motion menu (per Franklin's handoff requirement).
- **`P` key**: Toggles DVD Preview (honestPreview) on the canvas — per format-scaling doc §2.
- **Navigation map**: Phase 2 complete. `MenuMap.tsx` provides `MiniMenuMap` (left rail) and `FullMenuMap` (Map view). SVG-based, data-driven from authored `PlaybackAction` values. Handles `sequence` actions recursively. Deduplicates edges; filters orphan references.
- **Map inspector**: Shows outgoing/incoming connections with click-to-jump for the selected menu in Map view.
- **All Buttons audit table**: Preserved in menu-level inspector (no selection state). Batch action-binding + default-focus review without mode switching.

### Architecture anchors

- All `MenuDocument` updates should go through `updateMenuDocument` (store) to maintain the Sync Layer back to legacy fields. The `MenuEditor` uses direct `onUpdate` (Menu updater) handlers; both paths eventually call `updateProject`.
- `ProjectState.selectedMenuId` and `menuEditorMode` remain the canonical cross-pane synchronisation points.
- The interaction graph (`interaction.nodes`) is the source of truth for navigation contracts — not the flat `buttons` array.
- The navigation map must render a visible first-play source node when `disc.firstPlayAction` exists; otherwise a real authored entry path disappears from the graph.
- Menu design size is enforced relative to project `VideoStandard` (NTSC: 720×480, PAL: 720×576).
- DVD subpicture palette: 4 colours max. `honestPreview` communicates this visually on the canvas.

### Open gaps (for Nicholas and beyond)

- `return` action type: not in `PlaybackAction` schema. Flagged for Franklin to delegate to Jullian.
- Format-aware interface: fold 8-bit alpha controls away for DVD-only targeting. Requires a `formatTarget` concept in the schema.
- Force-directed layout for the navigation map: current grid layout is structurally correct. Phase 3 enhancement.
- Button Style / Text Style panels: **complete** (commit e3cd2c0). `ButtonStyleMap` and `TextStyle` types added to `project.ts`. Both panels fully controlled; changes flow through `onUpdateSceneNode` → `updateMenuDocument` → `updateProject`. `DEFAULT_BUTTON_STYLE_MAP` and `DEFAULT_TEXT_STYLE` guard against absent data on existing nodes.
- Generation affordances backed by real project data: Phase 4.
