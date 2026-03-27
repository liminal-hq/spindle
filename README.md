# Spindle

Spindle is a desktop optical-disc authoring studio built with Tauri, React, and Rust.

This repository is organised as a `pnpm` workspace monorepo with a matching Cargo workspace for native code. The initial application shell lives in `apps/spindle`, and `plugins/` is reserved for future shared workspace packages and Tauri plugin work.

## Workspace layout

- `apps/spindle` contains the base desktop app skeleton
- `plugins` is reserved for workspace packages and plugin experiments
- `tsconfig.base.json` provides shared TypeScript compiler defaults for workspace packages
- `docs/initial-planning` contains product and implementation planning notes

## Development

The shared development container currently provides `Node 24.14.0` and `pnpm 10.32.1` through Corepack, and the workspace is aligned to that toolchain.

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

Current app behaviour also includes a persistent thumbnail cache stored in the app cache directory, with Settings controls to inspect and clear cached previews when needed.

Build the frontend bundle:

```bash
pnpm build
```
