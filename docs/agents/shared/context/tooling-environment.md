# Tooling Environment

## Host Constraint

The current laptop environment does not have local Rust tooling available for normal verification work.

## Verification Rule

When Rust or JavaScript verification is needed for Spindle work, use the `ghcr.io/liminal-hq/tauri-dev-desktop:latest` Docker image rather than assuming host-installed Rust tools are available.

This applies especially to:

- Rust tests
- Rust formatting or lint checks
- JavaScript or frontend verification tied to the Tauri workspace
- mixed Rust and JavaScript validation passes

## Why This Matters

This is shared operating context, not a one-off exception.

Agents should plan verification work around the container-first path so they do not waste time assuming unavailable host tooling.
