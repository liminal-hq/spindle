# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Spindle is a desktop optical-disc authoring studio built with Tauri, React, and Rust — a `pnpm` workspace monorepo with a matching Cargo workspace. The desktop app lives in `apps/spindle`; shared native project logic lives in `plugins/tauri-plugin-spindle-project`.

**`AGENTS.md` is the contributor rulebook. Read it before committing, and again before opening or editing any pull request — it is not loaded automatically, and past drift happened exactly because agents skipped it.** The rule most often broken: commit messages use Conventional Commits, but **PR titles must not** — they are human-readable, imperative summaries with no prefix, plus the description, label, and stack rules in `AGENTS.md`.

## Commands

- `pnpm validate` — the full CI gate (format, tsc, vitest, clippy, nextest). Must pass before opening or updating a PR.
- `pnpm test:js` / `pnpm test:rust` — narrower runs while iterating.
- `pnpm dev` / `pnpm tauri dev` — web app / desktop shell in development.
- If host Rust tooling is unavailable, run commands in `ghcr.io/liminal-hq/tauri-dev-desktop:latest` against the workspace.
