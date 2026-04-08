# Jullian Memory

## Purpose

This file is a working memory note for Jullian.

Use it to capture durable implementation context that should survive across multiple coding passes.

## How To Use This File

Update this file when you learn something structural about the codebase, especially:

- real ownership and lifecycle facts
- Rust, Tauri, or plugin contract boundaries
- deterministic-output assumptions
- IPC or serialisation seams
- verification commands or fixtures worth repeating

Prefer concrete technical facts over speculation.

## Current Notes

- Spindle's native layer is split between the Tauri app in `apps/spindle/src-tauri/` and shared project logic in `plugins/tauri-plugin-spindle-project/`.
- Rust and TypeScript contract drift is a primary risk area; backend changes should be recorded in a way the frontend can mirror precisely.
- Jullian's durable instincts from the earlier extraction work still apply: inspect first, trace the real control flow, preserve working behaviour, and care about determinism.
- Sidecar orchestration, filesystem effects, and output generation should be treated as proof-sensitive seams, not casual helper code.
- Hidden crash paths and overconfident error handling are recurring traps; prefer explicit failure flow that the UI can represent cleanly.
- Jullian and Edward work especially well when legacy format constraints need to be mapped to precise implementation boundaries.
- **Set 2b Upgrades:** `MenuTiming` schema updated to include `intro_start_secs` and `loop_start_secs` for BOV I-frame alignment. `PlaybackAction` schema confirmed to use `streamIndex` (u32) and `Option<u32>` for subtitles, matching existing TS contracts. Verification build (cargo check/test and pnpm build) confirmed successful on 2026-04-07.
- **Stream Index Validation (2026-04-08):** `validate_action` in `desktop.rs` now fully handles `SetAudioStream` and `SetSubtitleStream`. Stream counts are derived from the authored `audio_mappings` and `subtitle_mappings` on each title (`titleset_stream_counts` helper, max across all titles). Menus in a titleset carry that titleset as context; global menus carry `None` and skip stream validation. Out-of-range or zero-track errors surface before VM opcode emission. 12 unit tests added; 111 total passing.
- **Authored Menu Aspect (2026-04-08):** Per-menu DVD display shape now lives in `MenuDocument.compilePolicy.displayAspect` on the Rust/shared model. `SpindleProjectFile::migrate_all_menus()` backfills missing values from legacy inference (`inferred_vmgm_menu_aspect()` / `inferred_titleset_menu_aspect()`), so old `.spindle` files keep loading with the same effective 4:3 vs anamorphic 16:9 behaviour. The menu render and dvdauthor paths now resolve menu aspect from authored state first, then fall back to the inferred legacy aspect.
- **Menu Section Constraint (2026-04-08):** The backend now treats mixed authored menu aspects inside one DVD menu section as invalid. Validation emits `menu.section-aspect-mismatch`, and dvdauthor generation refuses to author mixed-aspect menus in the same VMGM or titleset menu section. Titleset menus that intentionally differ from nearby title profiles are surfaced as `menu.titleset-aspect-mismatch` warnings rather than being silently normalised away.
- **Motion Menu Backend Boundary (2026-04-08):** Motion-menu authoring data is now validated more honestly, but the render path is still intentionally blocked. Validation surfaces missing motion background video, invalid loop duration, default loop-start cuts, missing/invalid motion audio, still-mode button-video usage, and animated highlight keyframe issues. `generate_build_plan()` now refuses to build motion menus with an explicit error instead of silently rendering them as still menus. The next safe runtime slice is motion background loop extraction plus audio-bed mux and loop-aware menu post-command authoring.
- **Communication Protocol (2026-04-08):** Review `docs/agents/shared/communication-protocol.md` before substantial coordination work when the shared handoff layer is relevant. Read the inbound handoff from the receiver inbox, and after completing bounded work, write a response payload back into the original sender's inbox. Never force-add or commit inbox files under `docs/agents/shared/handoffs/`; they are local coordination state only.

## Open Questions

- Which Rust-side structures are the canonical source of truth for project-file and IPC contracts.
- What the most trustworthy verification loop is for generated build-plan and authoring output.
- Which backend seams should be documented first to reduce future re-orientation cost.
