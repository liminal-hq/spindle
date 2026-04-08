# Franklin Memory

## Purpose

This file is a working memory note for Franklin.

Use it to capture durable context that should survive across multiple conversations or implementation passes.

## How To Use This File

Update this file when you learn something likely to matter later, especially:

- runbook shifts
- release and packaging expectations
- important architectural decisions
- unresolved cross-team risks
- useful handoff patterns between personae

Do not turn this into a diary.

Prefer durable, reusable context over narration.

## Current Notes

- Spindle is a full-stack desktop application spanning React, Tauri, and Rust rather than a single-language extraction branch.
- The key repository surfaces for coordination are `README.md`, `SPEC.md`, `docs/`, `.github/workflows/`, `apps/spindle/`, and `plugins/tauri-plugin-spindle-project/`.
- The agent infrastructure should stay lightweight: markdown docs, shared runbooks, and structural memory rather than process-heavy orchestration.
- Release stewardship likely spans `package.json`, `Cargo.toml`, `apps/spindle/src-tauri/tauri.conf.json`, and workflow files, so versioning and packaging work should be checked together.
- Franklin's main value is synthesis: turn Edward's product cautions, Jullian's implementation facts, Kyle's review findings, and the frontend pair's design work into the next maintainable move.
- When a thread crosses multiple layers, an MVH is more useful than a broad narrative summary.
- The current implemented end-to-end DVD authoring flow works in practice based on direct user testing, so future reviews should treat baseline pipeline viability as known for the shipped scope unless new evidence contradicts it.
- As of `v0.2.0`, Spindle's strongest coherent project story is working DVD authoring plus Linux-first release discipline, while Blu-ray, motion menus, and text subtitle rendering remain planned or partial rather than shipped.
- GitHub PR hygiene and labels are in good shape, but the repository currently has no open issue backlog, so important future work is concentrated in docs and memory rather than visible execution tracking.
- Trust and support surfaces should be checked alongside release surfaces; for example, diagnostics export can drift from runtime versioning even when the main app UI is current.
- The shared filesystem-based agent communication layer now lives under `docs/agents/shared/`, with `context/` for Franklin/Edward broadcast state and `handoffs/<agent>/` inboxes for point-to-point JSON requests and responses.
- The current laptop environment should be treated as container-first for verification work: when Rust tooling or mixed workspace validation is needed, prefer `ghcr.io/liminal-hq/tauri-dev-desktop:latest` rather than assuming host-installed Rust tools are available.
- We have adopted Yuli's Set 2b unified menu editor design, establishing Blu-ray (HDMV/IG) as the primary authoring ceiling and DVD/VCD as a graceful degradation floor managed via the Compile Preview overlay.
- Seamless branching (multiplexed BOV) for UI states and SPRM manipulation (`setAudioStream`, `setSubtitleStream`) are now confirmed backend requirements that the compiler and multiplexer must support reliably.

## Open Questions

- Which Spindle docs should become canonical runbooks beyond `SPEC.md` and the existing planning documents.
- How release preparation should be documented once the packaging flow stabilises.
- Which recurring handoff patterns deserve their own reusable checklist.
