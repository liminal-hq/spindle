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
- **Unified Workstation Shell**: COMPLETED. Tristan has refactored `MenusPage.tsx` into the Set 2b full-height workstation grid (commit ef56faa). Mini-map is correctly nested in the sidebar rail.
- **Visual Polish & Premium Composition**: COMPLETED. Nicholas has ported the workstation-level CSS, premium sidebar cards, and refined the integrated toolbar aesthetics (commit b7d6297, bea442a).
- **Project File Compatibility Hardening**: COMPLETED. Franklin patched the Rust project loader to accept legacy authored menu document fields and missing timing start offsets so pre-upgrade `.spindle` files can open again (commit 773e4b0).
- **Menu Schema Alignment**: COMPLETED. Franklin extended the Rust `SceneNode` model to preserve the upgraded editor's optional text and button styling fields across open/save cycles (commit ad2a08c).
- **Workspace Shell Reshape**: COMPLETED. Franklin rebuilt the menus workstation around the staged canvas, embedded tool rail, unified inspector rail, generated-menu helpers, and hardened Navigation Map node selection (commit c1c96a6).
- **Authored Preview Controls**: COMPLETED. Franklin moved background controls into the inspector, added motion-control placeholders, action chips, authored button-state preview, zoom, and 4:3 vs anamorphic 16:9 display simulation in the canvas (commits 324fc6a, 187c2fb).
- **Final Sign-off**: IN PROGRESS. Yuli is performing the final spatial and journey verification against the unified workspace with legacy-project reopening now covered.

### Verification Snapshot
- **Rust plugin verification**: confirmed through `ghcr.io/liminal-hq/tauri-dev-desktop:latest` with `cargo test -p tauri-plugin-spindle-project -- --nocapture`.
- **Frontend store verification**: confirmed with `pnpm --filter @liminal-hq/spindle test -- src/store/project-store.test.ts`.
- **Workspace UI verification**: confirmed with `pnpm --filter @liminal-hq/spindle test -- src/components/menus/MenuMap.test.tsx src/components/menus/SceneEditor.test.tsx src/store/project-store.test.ts`.
- **Frontend build verification**: confirmed with `pnpm --filter @liminal-hq/spindle build` on the current Node 22.0.0 host despite the Vite warning that 22.12+ is preferred.
- **Regression coverage**: Rust tests now explicitly cover legacy authored menu document deserialisation and styled scene-node round-tripping, while frontend tests cover central Navigation Map selection, authored button-state preview, and action-chip rendering.

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
