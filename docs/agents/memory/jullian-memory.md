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

## Open Questions

- Which Rust-side structures are the canonical source of truth for project-file and IPC contracts.
- What the most trustworthy verification loop is for generated build-plan and authoring output.
- Which backend seams should be documented first to reduce future re-orientation cost.
