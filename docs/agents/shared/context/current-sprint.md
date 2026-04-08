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
- **Backend Infrastructure**: COMPLETED & SEALED. Kyle has verified Jullian's schema synchronization and stream index validation (commit e80ccc2).
- **Unified Editor Shell & Map**: COMPLETED. Tristan has implemented the unified workspace foundation.
- **Visual Integration & Polish**: COMPLETED. Nicholas has delivered the Compile Preview overlay, navigation map aesthetics, and style panel scaffolding.
- **Style Data Wiring**: COMPLETED. Tristan has wired the Button and Text style panels to the `MenuDocument` state.
- **Full-Stack Audit**: COMPLETED. Kyle has verified the integration and fixed critical style write and legacy sync bugs (commits a50f9ba, 12fdd92, d24c0fc, 28c76e5).
- **Final UX Review**: CONDITIONAL SIGN-OFF. Yuli has reviewed the implementation and identified two clarity gaps (navigation map first-play and Honest Preview context) plus a stale test.
- **UX Polish Pass**: IN PROGRESS. Tristan is restoring the first-play doorway and fixing tests; Nicholas is enhancing the Honest Preview overlay.

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