# Kyle Memory

## Purpose

This file is a working memory note for Kyle.

Use it to capture durable review patterns, recurring risks, and cross-stack facts that should survive across multiple passes.

## How To Use This File

Update this file when you learn something likely to matter later, especially:

- contract drift patterns
- safety or performance traps
- recurring review checks
- async and rendering risks

Prefer structural review guidance over narration.

## Current Notes

- Kyle's primary territory is the seam between `apps/spindle/src/`, `apps/spindle/src-tauri/`, and `plugins/tauri-plugin-spindle-project/`.
- Cross-stack correctness matters as much as layer-local correctness; Rust payloads, TypeScript types, and actual runtime behaviour must stay synchronised.
- Long-running authoring and build work must not block the Tauri main thread or make the React UI feel frozen.
- Review should prioritise the highest-risk behavioural issues first: unsafe command construction, optimistic error handling, contract mismatch, and unnecessary render churn.
- Kyle's critique is strongest when it remains specific, fair, and oriented around protecting trust in the system.
- The Jullian and Tristan handoffs are especially valuable because they expose backend safety and frontend structure from both sides of the same seam.
- **Menu Overhaul Risks (2026-04-05)**:
  - Fixed NTSC bias in migration logic; ensured `VideoStandard` is respected.
  - Added missing fields to `MenuDocument` and `SceneNode` (highlights, background mode, button video) to prevent feature loss during migration.
  - **CRITICAL**: The DVD compiler (`planner.rs` and `menu.rs`) still uses the legacy flat menu model. Edits in the new scene editor will NOT be reflected in the DVD build until the compiler is updated to use `MenuDocument`.
  - **IPC Drift**: TypeScript types must stay aligned with `models.rs` as `SceneNode` evolves.
  - **Full-Stack Integrity Review (2026-04-05)**:
    - **Sync Layer Verified**: `project-store.ts` correctly handles initialization and sync-back from `authoredDocument` to legacy fields, verified by Tristan's TS unit tests.
    - **Compiler Bridge Verified**: `AuthorableMenuRef` in `menu.rs` now properly prioritises `authoredDocument` data. Added a targeted Rust unit test to confirm this contract.
    - **Air Gap Closed**: Refactored `menu_button_overlay_filter` to use user-authored `highlight_colours` instead of hardcoded hex values.
  - **Set 2b Workspace Upgrades (2026-04-07)**:
    - **Contract Drift**: Jullian's proposed `SetAudioStream`/`SetSubtitleStream` expansion with `id: u16` conflicts with the already existing `streamIndex: u32` (and `Option<u32>` for subtitles) in `models.rs` and `project.ts`.
    - **Timecode Accuracy**: BOV multiplexing cannot rely on precise sector-aligned I-frames until `MenuDocument` stores explicit `intro_start_secs` and `loop_start_secs` instead of just durations.
    - **SPRM Validation**: Stream ID validation must happen against the `Titleset` streams during a pre-build diagnostic phase, not just silently failing at VM opcode emission.
    - **UI State Binding**: The `MenuDocument` schema needs a way to map SPRM register values back to button "Active/Selected" visual states so setup menus reflect actual player state.

## Open Questions

- Which cross-stack review checklist items should become standard for all IPC-affecting changes.
- Where render-performance hotspots are most likely to emerge as the planner and preview UI grow.
- Which safety checks around sidecar invocation deserve explicit documentation.
