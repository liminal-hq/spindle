# Menu Workspace Backend Upgrades Plan

This document outlines the implementation plan for the backend compiler and multiplexing upgrades required by the Set 2b unified menu workspace. The work ensures that Spindle can safely handle Blu-ray scaling and DVD fallback while maintaining predictable output.

## 1. Multiplexer: Seamless Branching and I-Frame Alignment

The requirement for fluid UI states via Button Over Video (BOV) timecode jumps means the multiplexer cannot guess where transitions occur.

- **Current State:** The multiplexer assumes linear playback for standard titles and simple static menus.
- **Goal:** Flawless I-frame alignment at sector boundaries for seamless BOV transitions without mechanical laser-seek penalties.
- **Approach:**
  - Introduce strict GOP (Group of Pictures) boundary enforcement in the video encoding phase.
  - The `MenuDocument` and `MenuTiming` schemas have been updated to explicitly store exact, asset-aligned `intro_start_secs` and `loop_start_secs` timecodes, providing the multiplexer with exact boundaries for I-frame forcing.
  - Expose verification tooling in the build pipeline to validate sector alignment before compilation completes.

## 2. Compiler: SPRM Management and System Streams

The new UI exposes `setAudioStream` and `setSubtitleStream` actions. These must translate deterministically to virtual machine registers.

- **Current State:** The action model handles basic navigation (`playTitle`, `playChapter`, `showMenu`).
- **Goal:** Emit precise `SetSystemStream` instructions mapping to SPRM 1 (Audio) and SPRM 2 (Subtitle) and correctly disable subtitles where requested.
- **Approach:**
  - The Rust `Action` schema and TypeScript bindings currently correctly store `streamIndex` (u32) and `Option<u32>` for `SetSubtitleStream` to allow disabling subtitles. We will preserve this correct type alignment.
  - Shift validation to the **pre-build diagnostic phase**: before the VM opcode emission phase, we will validate the authored `streamIndex` against the target `Titleset`'s actual streams to fail early and safely.
  - The compiler VM logic will emit `SetSystemStream` opcodes for the target format based on these verified stream assignments.
  - The compiler will also be prepared to emit conditional highlight state updates based on SPRM checks to visually reflect the SPRM register state where appropriate.

## 3. Verification Strategy

I will preserve working behaviour first.

- Extend existing unit tests in the Rust plugin layer for the updated `Action` schema.
- Add compiler output tests that assert the generated VM instructions match expected SPRM manipulation.
- Introduce a diagnostic dry-run for the multiplexer to prove I-frame alignment commands are correctly passed to the encoding shell.

This limits the risk of regression and gives the frontend team a stable, verifiable backend boundary.
