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

Typical release sequence:

1. Run `pnpm release:version:prepare --version <x.y.z>`.
2. Review the diff and open a pull request.
3. Merge the release bump into `main`.
4. Create and push tag `vX.Y.Z`.
5. Monitor the GitHub Actions release run, or rerun it manually if needed.
