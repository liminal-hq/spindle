# Current Sprint

## Focus

Executing the holistic menu-system overhaul.

The immediate thread is to replace the legacy flat menu model with the new scene-driven `MenuDocument` architecture. This is a deliberate "break-the-pipeline" phase where we prioritize structural integrity and long-term scalability (including motion and Blu-ray) over maintaining a playable DVD build on the feature branch.

Key workstreams:

- **Milestone 1**: COMPLETED & VERIFIED. Schema expansion and standard-aware migration (NTSC/PAL) are locked in `models.rs`.
- **Milestone 2**: IN PROGRESS. Tristan has completed the State & Sync foundations. Nicholas is now building the Scene Editor, Layers, and Inspector UI.
- **Milestone 3**: COMPLETED. Jullian has finalized the backend seams and decoupled the compiler via `AuthorableMenuRef`.

## Product Stance: Rich Design, Honest Compilation

The primary menu design space must remain high-fidelity and unrestricted. The "Honest Preview" (showing DVD palette/resolution downgrades) is an optional mode or overlay, not a forced canvas constraint. Users should design in a rich environment and opt-in to see target-specific compromises.

This work is isolated on the `feature/menu-system-overhaul` branch. Main remains stable for v0.2.x maintenance.

## Channel

This file is part of the shared broadcast context.

All agents should treat it as current global orientation material.

Only Franklin and Edward should update broadcast context files.

## Environment Note

Rust and mixed workspace verification should assume a container-first path on the current laptop environment.

Use `ghcr.io/liminal-hq/tauri-dev-desktop:latest` for Rust and JavaScript verification work when local host tooling is not available.
