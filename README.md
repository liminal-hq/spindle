# Spindle

Spindle is a desktop optical-disc authoring studio built with Tauri, React, and Rust.

This repository is organised as a `pnpm` workspace monorepo with a matching Cargo workspace for native code. The desktop app lives in `apps/spindle`, and shared native project logic lives in `plugins/tauri-plugin-spindle-project`.

Current DVD authoring capabilities include:

- titleset-aware project editing with drag-and-drop title organisation
- chapter seeding from source media plus chapter-targeted menu and end actions
- menu editing with auto-generated directional navigation
- authored menu routing for VMGM, titleset, and title-return paths, including keyboard-safe entry selection
- asset inspection with embedded metadata title surfacing, compatibility explanations, and fix-oriented validation
- DVD build planning and execution with diagnostics export and toolchain checks
- bitmap subtitle muxing, plus a developer option to skip unsupported text subtitle mappings during builds

## Workspace layout

- `apps/spindle` contains the Tauri desktop application and React UI
- `plugins/tauri-plugin-spindle-project` contains project schema, validation, inspection, and build logic
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

If Rust tooling is not installed locally, run Rust and Tauri commands through `ghcr.io/liminal-hq/tauri-dev-desktop:latest`.

Current app behaviour also includes:

- a persistent thumbnail cache stored in the app cache directory, with Settings controls to inspect and clear cached previews
- developer toggles to prefer host `PATH` tools over bundled sidecars and to skip unsupported subtitle mappings during builds
- diagnostics bundle export including toolchain status, build logs, validation issues, project summary, and active developer options

Build the frontend bundle:

```bash
pnpm build
```

Run the Rust plugin tests:

```bash
cargo test -p tauri-plugin-spindle-project
```

For an opt-in end-to-end DVD authoring smoke test that exercises `ffmpeg`, `spumux`, and `dvdauthor`, run:

```bash
cargo test -p tauri-plugin-spindle-project execute_build_plan_smoke_authors_titleset_menu_return_path -- --ignored --nocapture
```

## Release preparation

Spindle now uses a repo-local release preparation flow aligned with the current Liminal HQ desktop release pattern.

Check that all release-facing versions are synchronised:

```bash
pnpm release:version:check
```

Prepare a coordinated version bump on a dedicated release branch:

```bash
pnpm release:version:prepare --version 0.1.1
```

That updates the release-facing version set together:

- `package.json`
- `apps/spindle/package.json`
- `apps/spindle/src-tauri/tauri.conf.json`
- `apps/spindle/src-tauri/Cargo.toml`
- `plugins/tauri-plugin-spindle-project/Cargo.toml`

The helper script expects a clean working tree and creates `chore/release-vX.Y.Z` by default unless you pass `--no-branch` or an explicit `--branch`.

## Release publishing

The release workflow lives in [`.github/workflows/release.yml`](.github/workflows/release.yml).

Current release scope:

- Linux desktop bundles only
- `x64` and `arm64`
- `AppImage`, `.deb`, and `.rpm` outputs
- one rolled-up `SHA256SUMS` file per published release

Linux package dependency behaviour today:

- `.deb` packages declare a hard dependency on `ffmpeg`
- `.rpm` packages declare a recommendation for `ffmpeg` or `ffmpeg-free`, since RPM package naming differs across distributions
- `AppImage` builds still rely on the host system to provide `ffmpeg` and `ffprobe`

Typical release sequence:

1. Run `pnpm release:version:prepare --version <x.y.z>`.
2. Review the diff and open a pull request.
3. Merge the release bump into `main`.
4. Create and push tag `vX.Y.Z`.
5. Monitor the GitHub Actions release run, or rerun it manually if needed.
