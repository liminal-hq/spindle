# Spindle App

This package contains the Spindle Tauri desktop application and React authoring interface.

## Scripts

- `pnpm dev` starts the Vite development server
- `pnpm build` builds the frontend bundle
- `pnpm tauri dev` runs the desktop app in development mode

## Current shell features

- titleset-aware title management, including drag-and-drop between titlesets
- chapter editing with source-chapter seeding
- menu editing with chapter-targeted actions and auto-generated navigation
- build planning and DVD build execution
- toolchain inspection for required DVD authoring binaries
- diagnostics bundle export for support and troubleshooting
- developer toggles for sidecar resolution and unsupported subtitle handling
- thumbnail cache inspection and clearing from Settings

## Recommended IDE setup

- [VS Code](https://code.visualstudio.com/)
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
