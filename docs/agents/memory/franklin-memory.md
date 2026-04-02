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

## Open Questions

- Which Spindle docs should become canonical runbooks beyond `SPEC.md` and the existing planning documents.
- How release preparation should be documented once the packaging flow stabilises.
- Which recurring handoff patterns deserve their own reusable checklist.
