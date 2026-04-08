# Menu Workspace Backend Upgrades Plan

This document outlines the implementation plan for the backend compiler and multiplexing upgrades required by the Set 2b unified menu workspace. The work ensures that Spindle can safely handle Blu-ray scaling and DVD fallback while maintaining predictable output.

## 1. Multiplexer: Seamless Branching and I-Frame Alignment

The requirement for fluid UI states via Button Over Video (BOV) timecode jumps means the multiplexer cannot guess where transitions occur.

- **Current State:** The multiplexer assumes linear playback for standard titles and simple static menus.
- **Goal:** Flawless I-frame alignment at sector boundaries for seamless BOV transitions without mechanical laser-seek penalties.
- **Approach:**
  - Introduce strict GOP (Group of Pictures) boundary enforcement in the video encoding phase.
  - Plumb interactive transition points from the authored `MenuDocument` down to the encoding queue.
  - Instruct the multiplexer to force I-frames explicitly at these timecode boundaries.
  - Expose verification tooling in the build pipeline to validate sector alignment before compilation completes.

## 2. Compiler: SPRM Management and System Streams

The new UI exposes `setAudioStream` and `setSubtitleStream` actions. These must translate deterministically to virtual machine registers.

- **Current State:** The action model handles basic navigation (`playTitle`, `playChapter`, `showMenu`).
- **Goal:** Emit precise `SetSystemStream` instructions mapping to SPRM 1 (Audio) and SPRM 2 (Subtitle).
- **Approach:**
  - Expand the Rust `Action` schema in the `tauri-plugin-spindle-project` crate to include `SetAudioStream { id: u16 }` and `SetSubtitleStream { id: u16 }`.
  - Update the TypeScript bindings so the frontend can mirror this structure safely.
  - Update the compiler VM logic to generate the corresponding `SetSystemStream` opcodes for the target format (DVD/HDMV).
  - Ensure failure paths are legible: if a stream ID does not exist in the domain, the compiler must fail explicitly with a readable error rather than silently writing invalid VM instructions.

## 3. Verification Strategy

I will preserve working behaviour first.

- Extend existing unit tests in the Rust plugin layer for the updated `Action` schema.
- Add compiler output tests that assert the generated VM instructions match expected SPRM manipulation.
- Introduce a diagnostic dry-run for the multiplexer to prove I-frame alignment commands are correctly passed to the encoding shell.

This limits the risk of regression and gives the frontend team a stable, verifiable backend boundary.