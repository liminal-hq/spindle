# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Spindle is a desktop optical-disc authoring studio (DVD today, Blu-ray planned) built with Tauri v2, React, and Rust. See `AGENTS.md` for the authoritative contributor conventions — most importantly: **Canadian English** spelling everywhere; **Conventional Commits** for commit messages but **never in PR titles**; the licence/copyright header on new source files; and **no pushes unless explicitly asked**. `SPEC.md` and `README.md` describe product behaviour; `docs/` holds the design plans (menus: `rich-menu-editor-plan.md`, `motion-menus.md`).

## Layout

pnpm workspace monorepo + Cargo workspace:

- `apps/spindle` — the Tauri app: React frontend in `src/` (pages, `components/menus/` scene editor, zustand `store/`), Rust shell in `src-tauri/`
- `plugins/tauri-plugin-spindle-project` — project schema (`src/models/`), validation (`src/validation/`), and the DVD build pipeline (`src/build/`: Skia scene render → ffmpeg MPEG-2 → spumux subpictures → dvdauthor); TS API in `guest-js/index.ts` (the single source of TS types — `apps/spindle/src/types/project.ts` re-exports it)
- `tools/menu-debug` — CLI for inspecting menu documents

## Commands

```bash
pnpm validate        # the full CI gate: format:check, vitest, build (tsc), cargo fmt/clippy -D warnings, cargo nextest — must pass before opening/updating a PR
pnpm test:js         # vitest only
pnpm test:rust       # cargo nextest only
pnpm dev             # web app in dev mode
pnpm tauri dev       # desktop shell
```

If host Rust tooling is unavailable, run commands in the `ghcr.io/liminal-hq/tauri-dev-desktop:latest` container against the checked-out workspace (see `AGENTS.md` → Local Tooling).

## Architecture — the key things to understand

**`MenuDocument` is the single authored menu model.** Every menu's scene graph, interaction graph, timing, role, and compile policy live on `menu.authoredDocument`; a one-way migration on load lifts pre-document project files, and the legacy flat fields are deserialize-only. Rust accessors `Menu::doc()`/`doc_mut()` assume the invariant — IPC commands establish it via migrate-on-entry.

**Format law is data.** Per-family constraints (button limits, highlight model, min font sizes, supported roles) come from `FormatProfile` (`models/format_profile.rs`, `profile_for(DiscFamily)`), consumed by validation, diagnostics, and the editor chrome — never hardcode DVD constants.

**The build pipeline renders twice.** The editor previews scenes in DOM/CSS while the disc renders through Skia (`build/skia/`); keeping them in agreement is an explicit goal (renderer-parity work is tracked in the rich-menu-editor plan). Subpicture overlays are 4-colour and anti-aliasing stays off in `build/skia/overlay.rs` for spumux's palette limit.

## Conventions (from AGENTS.md)

- **PR titles**: human-readable, imperative, sentence case, ~70 chars, **no Conventional Commit prefix**. Descriptions use `## Summary` + `## Test plan` (checklists, concrete commands). Every PR gets a category label (`enhancement`, `bug`, `documentation`, …) plus scope labels (`menus`, `frontend`, `backend`, …). PRs open ready for review, not as drafts.
- **Commits**: Conventional Commits with markdown bodies (what/why, `test:` for test-only changes); write bodies to a file and `git commit -F` when they contain backticks.
- **Licence headers** on new/substantially rewritten `.rs`/`.ts`/`.tsx` files in `src/` (one-line summary + `(c) Copyright 2026 Liminal HQ, Scott Morris` + `SPDX-License-Identifier: MIT`).
- **Docs sync**: user-facing changes update `README.md` and `SPEC.md`.
- **Git**: never push (especially force-push) unless explicitly asked; prefer the `gh` CLI for GitHub work.

Keep this file and `AGENTS.md` in sync: when a convention changes there, update the summary here in the same PR.
