# Spindle

Spindle is a desktop optical-disc authoring studio built with Tauri, React, and Rust.

This repository is organised as a `pnpm` workspace monorepo with a matching Cargo workspace for native code. The initial application shell lives in `apps/spindle`, and `plugins/` is reserved for future shared workspace packages and Tauri plugin work.

## Workspace layout

- `apps/spindle` contains the base desktop app skeleton
- `plugins` is reserved for workspace packages and plugin experiments
- `docs/initial-planning` contains product and implementation planning notes

## Development

Install dependencies from the repository root:

```bash
pnpm install
```

Run the web app in development mode:

```bash
pnpm dev
```

Run the Tauri desktop shell:

```bash
pnpm tauri dev
```

Build the frontend bundle:

```bash
pnpm build
```
