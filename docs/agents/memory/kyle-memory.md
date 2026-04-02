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

## Open Questions

- Which cross-stack review checklist items should become standard for all IPC-affecting changes.
- Where render-performance hotspots are most likely to emerge as the planner and preview UI grow.
- Which safety checks around sidecar invocation deserve explicit documentation.
