# Spindle Release Workflow Plan

_Reviewed on 2026-03-27 against current `liminal-hq` workflows._

## Goal

Bring the standard Liminal HQ release workflow to Spindle, using Emoji Nook as the primary template and adjusting it for Spindle's sidecar and packaging constraints.

## Org Workflow Review

| Repo                      | Workflow / tooling                                                                                         | Trigger model                                  | Release shape                                                                | What to carry into Spindle                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `emoji-nook`              | `.github/workflows/release.yml`, `scripts/check-release-versions.sh`, `scripts/prepare-release-version.sh` | Tag push `v*` and `workflow_dispatch`          | Three jobs: prepare, build, publish, plus a release-prep helper script       | Best base for Spindle. It validates the tag, checks the release commit is on `main`, derives manual tags from the synchronised version, creates or reuses the GitHub release, builds inside `ghcr.io/liminal-hq/tauri-ci-desktop:latest`, stages artefacts, generates `SHA256SUMS`, and adds a practical script for bumping every release-facing version file on a dedicated release branch. |
| `threshold`               | `.github/workflows/release-build.yml`, `tools/release-tui`                                                 | `main` push, tag push, and `workflow_dispatch` | Large multi-platform desktop + Android pipeline with a dedicated release TUI | Useful for ideas, but too broad for a first Spindle release workflow. The good bits are asset curation, rerun-safe release reuse, release summaries, and a stronger interactive release-prep tool. The automatic `main` release trigger and TUI scope are probably too aggressive for Spindle v1.                                                                                            |
| `smdu`                    | `.github/workflows/release.yml`                                                                            | Tag push and `workflow_dispatch`               | CLI binary/package matrix with a final publish job                           | Good reference for simple tag/manual release behaviour and cross-runner artefact staging. Its per-file `.sha256` assets are useful as a contrast, but Spindle should prefer the cleaner single-file checksum rollup used by Emoji Nook.                                                                                                                                                      |
| `flow`                    | `.github/workflows/release.yml`                                                                            | Tag push and `workflow_dispatch`               | Linux-only Rust release with direct per-job upload                           | Good reminder that Linux-first is a valid Liminal HQ release shape when platform support is narrower.                                                                                                                                                                                                                                                                                        |
| `coherence-chat-exporter` | `.github/workflows/release.yml`                                                                            | Tag push and `workflow_dispatch`               | Bun/Node binary builds plus package artefacts                                | Useful for the create-or-reuse-release pattern and a separate package build job.                                                                                                                                                                                                                                                                                                             |
| `liminal-hq/.github`      | `.github/workflows/shared-tauri-ci-images.yml`                                                             | Push, schedule, and manual                     | Publishes shared CI/dev containers                                           | Confirms that `ghcr.io/liminal-hq/tauri-ci-desktop:latest` is the standard shared base image and is already smoke-tested centrally.                                                                                                                                                                                                                                                          |

## What Spindle Needs

Spindle is closest to Emoji Nook technically, but it has a few repo-specific constraints:

- Spindle already uses `ghcr.io/liminal-hq/tauri-ci-desktop:latest` in CI, so the shared release container is a natural fit.
- Spindle has multiple release-facing version files today:
  - `package.json`
  - `apps/spindle/package.json`
  - `apps/spindle/src-tauri/tauri.conf.json`
  - `apps/spindle/src-tauri/Cargo.toml`
  - `plugins/tauri-plugin-spindle-project/Cargo.toml`
- Spindle does not yet have a release-preparation helper script, so version bumps are still easier to miss or do inconsistently than in Emoji Nook.
- Spindle bundles external sidecars through `bundle.externalBin`, so release builds need real binaries collected before `tauri build`.
- The existing sidecar tooling supports Linux and macOS, but explicitly does not support Windows. That makes `bundle.targets = "all"` broader than the current packaging reality.
- Current CI uses sidecar stubs for lint and test jobs only. Release builds must not use those stubs.

## Recommended Standard For Spindle

Adopt the Emoji Nook release structure with these choices:

- Add a release-preparation helper alongside the workflow, not just the workflow on its own.
- Use a dedicated `.github/workflows/release.yml`.
- Trigger on tag push `v*` and `workflow_dispatch`.
- Do not auto-release from `main` pushes in the first version.
- Keep the first release workflow Linux-only:
  - `ubuntu-24.04` for `x64`
  - `ubuntu-24.04-arm` for `arm64`
- Build inside `ghcr.io/liminal-hq/tauri-ci-desktop:latest`.
- Publish `AppImage`, `.deb`, `.rpm`, and one rolled-up `SHA256SUMS` file.
- Create or reuse the GitHub release so reruns remain idempotent.
- Add explicit release summaries to every job.

This gives Spindle the same release ergonomics as Emoji Nook without pretending Windows support exists yet, and it makes version preparation part of the standard process rather than an undocumented manual step.

## Proposed Implementation Plan

### 1. Add release version preparation helpers

Add two scripts modelled on Emoji Nook:

- `scripts/check-release-versions.sh`
- `scripts/prepare-release-version.sh`

Add matching workspace scripts in `package.json`:

- `release:version:check`
- `release:version:prepare`

The Spindle release-prep script should:

- accept `--current-version`
- accept `--version <version>` with optional leading `v`
- support `--branch <name>`, `--no-branch`, and `--dry-run`
- require a clean working tree before making changes
- create a default release branch like `chore/release-vX.Y.Z`
- update every release-facing version file in one pass
- refresh `Cargo.lock` after Rust manifest changes
- verify the new state by calling `check-release-versions.sh --current-version`
- print clear next steps for review, validation, and PR creation

This is the current Liminal HQ sweet spot for release prep: simple, scriptable, and easy to run locally or in a dev container. Threshold's `release-tui` is a strong future reference, but it is more complex than Spindle needs right now.

### 2. Add release metadata and guardrails

Create `.github/workflows/release.yml` with these jobs:

1. `prepare-release`
2. `build-linux`
3. `publish-release`

The `prepare-release` job should:

- check out with full history and tags
- accept optional `release_tag` and `release_draft` inputs
- validate tags against `vX.Y.Z` and optional prerelease suffixes
- verify the target commit is on `origin/main`
- derive the manual tag from the synchronised Spindle version when `release_tag` is omitted
- create or reuse the GitHub Release via `gh api`
- expose `tag_name`, `release_version`, `checkout_ref`, `release_target`, `release_name`, `prerelease`, `release_id`, and `release_url`

### 3. Define the release-facing version set

`scripts/check-release-versions.sh` should verify that these files stay aligned:

- `package.json`
- `apps/spindle/package.json`
- `apps/spindle/src-tauri/tauri.conf.json`
- `apps/spindle/src-tauri/Cargo.toml`
- `plugins/tauri-plugin-spindle-project/Cargo.toml`

The release-prep script should update the same set.

For Spindle, we are explicitly choosing the stricter Emoji Nook model:

- the plugin crate version should match the desktop app version
- the workspace root `package.json` version should be treated as release-facing

### 4. Build Linux release bundles with real sidecars

The `build-linux` job should:

- run in the shared Tauri desktop container
- check out the tagged ref chosen in `prepare-release`
- install Node and pnpm
- install the Rust toolchain and restore Rust cache
- install workspace dependencies
- run the version synchronisation check
- run `scripts/collect-sidecars.sh <target-triple>` instead of `scripts/create-sidecar-stubs.sh`
- build the app with `pnpm --filter @liminal-hq/spindle tauri build --bundles appimage,deb,rpm`
- collect releasable files from `target/release/bundle`
- generate one `SHA256SUMS` file covering every staged asset for that runner, then merge the staged assets so the final publish step ships a single combined checksum manifest
- upload staged artefacts with `actions/upload-artifact`

Target triples should match the runner:

- `x86_64-unknown-linux-gnu`
- `aarch64-unknown-linux-gnu`

### 5. Publish curated assets to the GitHub release

The `publish-release` job should:

- download all Linux artefacts
- merge them into a single publish directory
- regenerate one final top-level `SHA256SUMS` file after the merged publish directory is assembled, so the checksums always match the exact uploaded asset set
- upload them with `gh release upload "${TAG_NAME}" ... --clobber`
- keep asset names exactly as generated by Tauri and the checksum step

### 6. Tighten Spindle's release metadata

Before implementation is finished, update Spindle's Tauri bundle metadata so release artefacts look complete and intentional. Emoji Nook already carries a fuller set of fields than Spindle.

Add or confirm:

- `category`
- `publisher`
- `shortDescription`
- `longDescription`
- `copyright`

Leave `bundle.targets` unchanged for now. We should not narrow it to an explicit Linux-only target set yet, because broader packaging targets are expected to be added later even if the first release workflow only publishes Linux assets.

### 7. Document the release path

Once the workflow is implemented, update:

- `README.md`
- `SPEC.md`

Document:

- how version bumps are prepared
- how to cut a release tag
- when to use manual dispatch
- what assets are expected from a successful run
- current platform support limits
- the intended local sequence:
  - `pnpm release:version:prepare --version <x.y.z>`
  - review and open a PR
  - merge to `main`
  - create and push `vX.Y.Z`
  - monitor the release workflow or rerun it manually if needed

## Suggested Scope For V1

Ship the first Spindle release workflow with this intentionally narrow scope:

- a script-based release bump flow, not a full release TUI
- Linux desktop release artefacts only
- `x64` and `arm64`
- tag-driven releases plus manual reruns
- no updater JSON
- no automatic release on merge to `main`
- no Windows release path
- no macOS release path yet
- one consolidated `SHA256SUMS` release asset instead of per-file checksum assets
- redistribution of bundled sidecars in the published Linux release assets is explicitly in scope

That is the closest match to Spindle's actual packaging state today.

## Follow-up Work After V1

These should stay out of the first implementation unless they are already solved during development:

- a Threshold-style interactive release TUI
- macOS release builds and package signing
- Windows release support
- automatic release creation from version bumps on `main`
- release notes customisation beyond GitHub's generated notes
- extra provenance or signing for sidecar binaries

## Decisions Confirmed

These points are now settled for the plan:

- The plugin crate version should match the desktop app version.
- The workspace root `package.json` version should be treated as release-facing, following Emoji Nook.
- Redistributing bundled sidecars in published release assets is acceptable for the targets we ship.
- Spindle should stay Linux-first for now.
- `apps/spindle/src-tauri/tauri.conf.json` should keep its broader `bundle.targets` setting for now rather than being narrowed immediately.

## Remaining Watchpoints

These are still worth keeping in view during implementation, even though they do not block the first pass:

- whether future macOS packaging needs different sidecar handling or packaging metadata
- whether Windows support should use the same release-prep flow once sidecar support exists
- whether a richer Threshold-style release TUI becomes worthwhile after the basic script flow is in place

## Recommendation

Implement Spindle's release tooling as an Emoji Nook-style pair:

- a repo-local release version helper script
- a Linux-first release workflow

Then expand only after sidecar distribution and platform support are explicit rather than implied.
