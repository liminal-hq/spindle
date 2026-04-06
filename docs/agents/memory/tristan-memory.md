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

## Open Questions

- Which state boundaries should be treated as canonical for project edits, validation, and build progress.
- The `ProjectState` now includes `selectedMenuId` and `menuEditorMode` to synchronize the multi-pane menu editor across canvas, layers, and inspector panes.
- All `MenuDocument` updates should go through `updateMenuDocument` to maintain the **Sync Layer** that reflects scene changes back to legacy DVD fields (`buttons`, `backgroundAssetId`). This is critical while the current compiler is still in use.
- Menu design size must be strictly enforced relative to the project's `VideoStandard` (NTSC: 720x480, PAL: 720x576) to ensure layout honesty.
- DVD subpictures have very limited palette and alpha capabilities; CSS-rich designs in the 'Design' mode must eventually be validated in a 'Compile' mode overlay.
- Keyboard-navigation contracts for the menu system should be derived from the `InteractionGraph` (`interaction.nodes`) rather than flat button arrays.
