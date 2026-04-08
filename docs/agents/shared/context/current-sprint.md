# Current Sprint

## Focus

Executing the Set 2b Menu Workspace Upgrade.

The immediate thread is to build the unified menu authoring interface designed by Yuli, replacing the legacy multi-mode (Bind/Route/Compile) editor with a single cohesive workspace.

Key constraints & requirements:
- **Blu-ray (HDMV/IG) Ceiling:** The UI supports rich styling (8-bit alpha, drop shadows, Focus/Activate states).
- **DVD/VCD Degradation Floor:** The new `Compile Preview` overlay must honestly and elegantly communicate downsampling constraints to the user.
- **Seamless Branching (BOV):** Jullian's multiplexing engine must achieve flawless I-frame sector alignment to support fluid UI state transitions without mechanical clunks.
- **SPRM Management:** The compiler must reliably manipulate SPRM 1 and SPRM 2 to support the new `setAudioStream` and `setSubtitleStream` actions in the generated setup menus.

This work is isolated on the `feat/menu-workspace-upgrade` branch. 

### Progress Status
- **Backend Schema Sync**: COMPLETED. Jullian has updated `MenuTiming` and aligned `Action` types.
- **Backend Risk Audit**: COMPLETED. Kyle verified schema alignment, fixed the subtitle-off SPRM 2 encoding bug, and added tests.
- **Unified Editor Shell**: IN PROGRESS. Tristan is scaffolding the React state and unified workspace.
- **Backend Gaps**: COMPLETED. Jullian closed the stream index validation gap in `validate_action` (commit e80ccc2). `SetAudioStream` and `SetSubtitleStream` are now checked against the titleset's authored track counts at the pre-build diagnostic boundary.

## Roster & Handoff Order
1. **Jullian:** Backend multiplexing (BOV) and SPRM compiler updates.
2. **Kyle:** Auditing backend boundaries, type-safety, and failure states.
3. **Tristan:** Building the React state, `MenuDocument` structure, and the unified editor shell.
4. **Nicholas:** Styling the unified editor, visual hierarchies, and the Compile Preview overlay.
5. **Yuli:** Final UX review to ensure the calm user journey survives implementation.

## Channel

This file is part of the shared broadcast context.

All agents should treat it as current global orientation material.

Only Franklin and Edward should update broadcast context files.

## Environment Note

Rust and mixed workspace verification should assume a container-first path on the current laptop environment.

Use `ghcr.io/liminal-hq/tauri-dev-desktop:latest` for Rust and JavaScript verification work when local host tooling is not available.