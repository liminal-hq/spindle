# HDMV for Blu-ray Disc: implementable architecture research for a Rust `libhdmv` and Tauri v2 plugin

## Executive summary

HDMV (“HD Movie mode”) is the _non-Java_ interactive application model in the Blu-ray Disc ecosystem: it combines disc-level control data (e.g., `index.bdmv`, `MovieObject.bdmv`, playlists) with time-synchronised graphics streams (Interactive Graphics for menus, Presentation Graphics for subtitles/overlays) to deliver button-driven navigation, pop-up menus, and limited logic. In practice, HDMV behaves like a small, deterministic, register-based control language (“movie object” command sequences) plus a page-based interactive graphics scene model (“pages”, “button overlap groups”, effects, timeouts), tightly coupled to the player’s playback timeline and state.

The most implementable public view of HDMV today is _de facto_ behavioural specification via reference implementations—especially libbluray—and adjacent decoder codebases for graphics payloads. libbluray exposes: (a) HDMV instruction grouping and opcodes; (b) a VM that emits playback/navigation events; (c) an Interactive Graphics decoder that yields pages/buttons/effects/timeouts; and (d) overlay output models that reveal the essential rendering contract.

BD-J (Java-based) is a different runtime model: it adds a general-purpose application environment (networking, storage, permissions, richer UI toolkits) at the cost of JVM integration, asynchronous threading, and larger behavioural surface area. Notably, libbluray’s public API explicitly distinguishes overlay output modalities: HDMV menus/subtitles can be emitted as compressed YUV overlays, while BD-J menus emit ARGB overlays and may invoke callbacks from Java VM threads. A mainstream player integration (VLC media player by VideoLAN) reflects this in user-facing behaviour: when BD-J is detected but Java is unavailable/unsupported, discs are played without BD-J menus.

**Feasibility judgement (Linux/Rust)**: a Rust-native HDMV stack is _realistically implementable_ on Linux **for decrypted disc folders / ISOs** and for many inspection/preview use cases, because the key complexities (binary parsing, deterministic VM, IGS/PGS decoding, overlay composition) are well bounded and publicly inferable via open implementations. Full disc playback of commercial titles is constrained mainly by DRM (AACS/BD+), not by HDMV itself; libbluray’s API surface even models “encrypted” error conditions distinctly (AACS/BD+).

**Recommended sequencing**: start as a **parser/inspector + menu preview engine** (HDMV VM + IGS/PGS decode + renderer abstraction) rather than authoring. Authoring requires _compiling_ IGS/HDMV assets and generating correct BDMV metadata structures, which is a much larger and less documented surface area than reading/playing. Evidence from tooling ecosystems supports this bias: open tools like tsMuxer focus on muxing and generating basic BDMV structures, and feature requests explicitly ask for Blu-ray menu creation as a missing capability.

To make the deliverable usable as an RFC foundation, this report uses provenance tags:

- **[FORMAL SPEC]**: behaviour defined in publicly accessible official specifications (limited here due to licensing access).
- **[AUTHORITATIVE DOC]**: official/industry docs and white papers; may not be the final “Blue Book” text.
- **[DE FACTO PRACTICE]**: observed industry usage patterns and player behaviour.
- **[REVERSE-ENGINEERED]**: derived from open-source implementation details and format archaeology.
- **[INFERENCE]**: reasoned design/architecture conclusions, clearly marked.

### Output map to the requested structure

| Requested item                             | Where it is addressed                                            |
| ------------------------------------------ | ---------------------------------------------------------------- |
| Executive summary                          | Executive summary (this section)                                 |
| Glossary                                   | Glossary of terms                                                |
| Deep technical explanation of HDMV         | Blu-ray architecture; HDMV runtime and graphics model            |
| Comparison table: HDMV vs BD-J             | Blu-ray architecture (comparison table)                          |
| Disc/file/runtime architecture walkthrough | Blu-ray architecture; HDMV runtime and graphics model (diagrams) |
| Graphics and menu model analysis           | HDMV runtime and graphics model                                  |
| Existing tools and ecosystem survey        | Authoring workflows and ecosystem survey                         |
| Rust library design proposal               | `libhdmv` Rust library design proposal                           |
| Tauri v2 plugin design proposal            | Tauri v2 plugin design proposal and phased roadmap               |
| Phased implementation roadmap              | Tauri v2 plugin design proposal and phased roadmap               |
| Risks, unknowns, and research gaps         | Risks, unknowns, and annotated bibliography                      |
| Recommended next steps                     | Risks, unknowns, and annotated bibliography                      |
| Annotated bibliography / source list       | Risks, unknowns, and annotated bibliography                      |

## Glossary of terms

**BDMV (Blu-ray Disc Movie)**: the disc application format directory tree that contains control files (`*.bdmv`), playlists (`*.mpls`), clip info (`*.clpi`), and streams (`*.m2ts`). AACS documentation for BD recordable media depicts the core structure and explicitly references `index.bdmv`, `MovieObject.bdmv`, and the `PLAYLIST/CLIPINF/STREAM` subtrees.

**HDMV**: the non-Java Blu-ray application mode that provides menu and navigation logic via “movie objects” and Interactive Graphics, with deterministic commands and registers rather than a general-purpose VM. The Blu-ray audio-visual application white paper treats HDMV as a first-class mode alongside BD-J.

**BD-J**: the Java-based Blu-ray application mode (Xlet model), supporting authenticated/signed applications, network access (with permissions), and local/system storage, among other platform features.

**`index.bdmv`**: a disc control file that enumerates titles and indicates which playback objects represent “First Play” and “Top Menu”. A widely used parser (libbluray) treats it as a signature/versioned binary and exposes title object types (HDMV vs BD-J) and access flags (permitted/prohibited/hidden).

**`MovieObject.bdmv`**: a disc control file containing “movie objects,” each a sequence of fixed-size commands with flags such as `resume_intention_flag` and masks affecting user operations (menu call/title search). libbluray’s parser shows the file signature/versioning and the 12-byte command layout.

**MPLS (playlist)**: `*.mpls` files in `BDMV/PLAYLIST/` define PlayItems (clip intervals) and playmarks (chapters). The white paper positions playlists as core playback structure and also introduces “sub-paths” for supplemental content.

**CLPI (clip info)**: `*.clpi` files in `BDMV/CLIPINF/` carry metadata needed to access corresponding `*.m2ts` clip streams (e.g., time stamps/access points), referenced as part of BDMV’s core format structure.

**M2TS**: MPEG-2 transport stream files used for Blu-ray clips in `BDMV/STREAM/`. Both Presentation Graphics (PGS) and Interactive Graphics (IGS) are carried as streams multiplexed with video/audio and can be timed by PTS/DTS.

**PGS (Presentation Graphics Stream)**: a subtitle/overlay stream format designed for frame-accurate graphic overlay; FFmpeg’s decoder models segment types such as palette/object/presentation/window/display and RLE bitmap payloads with up to 256 palette entries.

**IGS (Interactive Graphics Stream)**: a timed interactive graphics stream used for HDMV menus, including pages, buttons, effects sequences, timeouts, and navigation commands tied to button actions. libbluray’s IG decoder reveals a page/BOG-centric model with per-page defaults and effect sequences.

**GPR/PSR**: General Purpose Registers and Player Status Registers. A commercial-grade menu editor manual states the BD-ROM player has 4096 GPRs and 128 PSRs; libbluray defines matching counts and exposes PSR meanings such as interactive graphics stream number, primary audio, and menu page/button IDs.

## HDMV in the Blu-ray architecture

### What HDMV is and where it sits

[AUTHORITATIVE DOC] Blu-ray’s audio-visual application model is layered: transport streams carry audio/video and graphics streams; disc-level metadata selects titles and provides navigation entry points; and applications are realised in either HDMV mode (scripted commands + interactive graphics) or BD-J mode (Java Xlets + the BD-J platform). The Blu-ray white paper explicitly describes both HDMV and BD-J and positions Presentation Graphics as available in both modes, while Interactive Graphics is the HDMV mechanism enabling always-on and multi-page menus with frame-accurate timing when multiplexed with video.

[REVERSE-ENGINEERED] libbluray’s `index.bdmv` model directly encodes this split: titles in the index have `object_type` values for “hdmv” and “bdj”, and HDMV/BD-J each have “movie” vs “interactive” playback types. In addition, per-title access types include “permitted”, “prohibited”, and “hidden”, with explicit comments about whether a title “may be shown on UI”.

### Disc structures and files that participate in HDMV

[AUTHORITATIVE DOC] The canonical BDMV structure includes at least:

```
/BDMV
  index.bdmv
  MovieObject.bdmv
  /PLAYLIST  (*.mpls)
  /CLIPINF   (*.clpi)
  /STREAM    (*.m2ts)
  /AUXDATA   (e.g., sound.bdmv, fonts—tooling-dependent)
  /BACKUP    (backup copies of key metadata)
```

This is consistent across (a) BDMV diagrams used in AACS documentation for BD recordable media and (b) Blu-ray application documentation that treats playlists and clip info as distinct from AV streams.

[REVERSE-ENGINEERED] libbluray’s loaders explicitly attempt `BDMV/MovieObject.bdmv` and, on failure, fall back to `BDMV/BACKUP/MovieObject.bdmv`, which is an implementation-level confirmation of the “backup metadata” convention.

### Launch and control: “First Play”, “Top Menu”, titles, playlists, movie objects

[REVERSE-ENGINEERED] In libbluray’s `index.bdmv` parser, two “playback objects” appear before the title list: `first_play` and `top_menu`. After these objects are parsed, the index contains `num_titles` and an array of titles, each with `object_type` (HDMV vs BD-J) and `access_type` flags.

[AUTHORITATIVE DOC + REVERSE-ENGINEERED] At a runtime level, libbluray’s public navigation API makes this model concrete:

- `bd_play()` starts navigation “from ‘First Play’ title.”
- Special title numbers are defined: “Top Menu” is `0`, and “First Play” is `0xffff`.
- Applications can invoke a top menu call with `bd_menu_call(bd, pts)` and must provide current playback position for resuming.

This gives an implementer a highly actionable model: _disc insert → parse index → start First Play → transition to Top Menu on request_.

### Comparison table: HDMV vs BD-J

| Dimension                | HDMV                                                                                                                                                                     | BD-J                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Runtime model            | Deterministic command sequences (“movie objects”) with register state and limited opcodes (branch/compare/set/system-set).                                               | Java Xlet application model with JVM, security sandbox, signing/authentication, and richer APIs.                                 |
| State                    | GPR/PSR register file; tooling documentation states 4096 GPRs, 128 PSRs; implementations expose PSRs for menu page/button IDs, streams, etc.                             | Application-managed state, with access-controlled storage (system + optional local storage) and broader lifecycle state.         |
| Graphics/menu output     | Interactive Graphics (page/button/effects model) plus Presentation Graphics; libbluray exposes compressed YUV overlays for HDMV menus/subtitles.                         | Java graphics plane output; libbluray notes BD-J outputs only ARGB graphics; callbacks may occur from Java VM threads.           |
| Interactivity complexity | Button-driven navigation, page transitions, enable/disable buttons, pop-up menu toggling, timers, stream selection; no general-purpose computation beyond provided ops.  | General-purpose programming within BD-J platform constraints; can respond to diverse events, networked content, storage binding. |
| Authoring implications   | Authoring hinges on building IGS assets (pages, BOGs, state objects, nav commands) and movie object scripts; ecosystem for creation is narrower and more “format-close”. | Requires Java application authoring, signing, and platform-specific testing; more tools/skills but also more overhead.           |
| Deployment/runtime deps  | No JVM requirement; fits hardware players with predictable behaviour.                                                                                                    | JVM integration required; real-world players may warn/fallback when Java missing, as seen in VLC’s BD-J handling logic.          |

## HDMV runtime and programming model

This section is written as an implementer-facing “how it actually runs” model, anchored in publicly visible structures and reference implementation behaviour.

### Execution model: registers, instruction words, and event emission

[REVERSE-ENGINEERED] `MovieObject.bdmv` is parsed by libbluray as a signature/versioned binary. It expects:

- signature `MOBJ` and a version signature (`0200` or `0100` in the parser),
- an `extension_data_start` pointer field (non-zero triggers “unknown extension data” logging),
- a fixed command format: each command is **12 bytes** and is decoded as a packed instruction header plus 32-bit `dst` and 32-bit `src` operands.

The instruction header includes fields like operand count, instruction group/subgroup, “immediate operand” flags, and per-group option fields (branch/cmp/set). This is the core of the HDMV “bytecode” you would reimplement in Rust.

[REVERSE-ENGINEERED] Instruction groups and opcodes (as implemented) are small and strongly enumerable:

- Groups: `BRANCH`, `CMP`, `SET`.
- BRANCH subgroups include `GOTO` (NOP/GOTO/BREAK), `JUMP` (jump/call object/title, resume), and `PLAY` (play playlist, seek to playitem/playmark, terminate, link playitem/mark).
- SETSYSTEM includes operations that bridge HDMV logic into playback and menu runtime: `SET_STREAM`, `SET_NV_TIMER`, `SET_BUTTON_PAGE`, `ENABLE_BUTTON`, `DISABLE_BUTTON`, `SET_SEC_STREAM`, `POPUP_OFF`, `STILL_ON`, `STILL_OFF`, `SET_OUTPUT_MODE`, plus additional values.

[REVERSE-ENGINEERED] Rather than directly “doing playback,” a VM in libbluray surfaces HDMV execution as **events**. The VM emits events for:

- playback control (`TITLE`, `PLAY_PL`, `PLAY_PI`, `PLAY_PM`, `PLAY_STOP`, `STILL`), and
- graphics-controller directives (`SET_BUTTON_PAGE`, `ENABLE_BUTTON`, `DISABLE_BUTTON`, `POPUP_OFF`).

This event-driven split is a key architectural lesson for a Rust `libhdmv`: **HDMV logic should not be fused to the demux/decode pipeline**; it should emit an explicit “what to do next” contract.

### State model: GPR/PSR and user operation masks

[AUTHORITATIVE DOC + REVERSE-ENGINEERED] Tooling documentation for interactive menu authoring describes:

- GPR: 32-bit unsigned variables, **4096 total**.
- PSR: 32-bit unsigned status variables, **128 total**, with named meanings like Interactive Graphics stream number, Primary audio stream number, and composite PG/TextST stream selections.

This matches libbluray’s implementation constants (`BD_GPR_COUNT 4096`, `BD_PSR_COUNT 128`) and its PSR enum naming (e.g., `PSR_IG_STREAM_ID`, `PSR_PRIMARY_AUDIO_ID`, `PSR_MENU_PAGE_ID`, `PSR_SELECTED_BUTTON_ID`).

[REVERSE-ENGINEERED] Control over “allowed user actions” (UO masks) appears at multiple layers:

- The HDMV VM header defines UO mask flags such as `HDMV_MENU_CALL_MASK` and `HDMV_TITLE_SEARCH_MASK`.
- The public API defines UO mask flags (`BLURAY_UO_MENU_CALL`, `BLURAY_UO_TITLE_SEARCH`) and exposes them as event flags.
- Interactive pages include a per-page UO mask table; the IG decoder reads it as part of page parsing.

For Rust design, this points toward first-class, strongly typed “capability masks” that gate menu call/title search and other operations.

### Interactive Graphics: pages, buttons, effects, timeouts, and navigation commands

[AUTHORITATIVE DOC] Blu-ray’s Interactive Graphics stream is explicitly described as supporting always-on menus, multi-page menus, and dynamic button enable/disable. Timing can be frame accurate when multiplexed with video because PTS/DTS timestamps determine when the menu appears/disappears.

[REVERSE-ENGINEERED] libbluray’s IG decoder reveals a concrete object model you can reproduce:

- An “interactive composition” begins with a declared `data_len`, then reads `stream_model` and `ui_model`. For some stream models, it includes `composition_timeout_pts` and `selection_timeout_pts` (33-bit PTS-like fields), plus a `user_timeout_duration`.
- It contains `num_pages`, each parsed as:
  - `id` and `version`
  - a `uo_mask_table`
  - `in_effects` and `out_effects`, each an effect sequence that includes windows and multiple effects (composition objects)
  - `animation_frame_rate_code`
  - default selected and activated button references
  - a palette reference (`palette_id_ref`)
  - `num_bogs` (button overlap groups) and their contents.

This aligns with how the graphics controller consumes and maintains menu state: it reads `PSR_MENU_PAGE_ID` / `PSR_SELECTED_BUTTON_ID`, finds pages and buttons, applies defaults, resets animations, and uses “in/out effects” during page transitions.

[AUTHORITATIVE DOC + DE FACTO PRACTICE] An authoring-facing view in the IGEditor manual makes the menu model even more implementable:

- Menus are built from **pages** containing **Button Groups (BOGs)**, and each button has **three states** (normal, activated, selected), typically implemented as state-specific objects referencing images and palette entries.
- The tool explicitly supports editing “navigation commands” attached to buttons and editing `sound.bdmv` button sound effects.

From an engine perspective, this suggests HDMV interactivity is best modelled as:

- a **page-based state machine**,
- driven by **focus navigation** (directional keys / mouse selection),
- with **button activation** triggering navigation command sequences, and
- optionally decorated by **animated effects** and **timers**.

### Presentation Graphics: bitmap overlays, palettes, and timings

[AUTHORITATIVE DOC] Presentation Graphics streams provide non-interactive images for frame-accurate overlay on video and are envisaged primarily for subtitles and other animated graphics during playback, in both HDMV and BD-J modes.

[REVERSE-ENGINEERED] In FFmpeg’s reference decoder, PGS is modelled as a segment stream with:

- `PALETTE_SEGMENT = 0x14`
- `OBJECT_SEGMENT = 0x15` (RLE bitmap payload)
- `PRESENTATION_SEGMENT = 0x16` (composition/presentation state)
- `WINDOW_SEGMENT = 0x17`
- `DISPLAY_SEGMENT = 0x80` (display update boundary)

Palette segments allow up to **256 colours**, and RLE data is decoded into a paletted bitmap surface.

[AUTHORITATIVE DOC] The Blu-ray white paper describes graphics stream composition more generally in terms of composition segments and palette usage, including cropping transforms for effects and transitions realised by multiple composition segments.

### Rendering contract: compressed YUV overlays vs ARGB overlays

[REVERSE-ENGINEERED] libbluray’s public API formalises two overlay output routes:

- **Compressed YUV overlays** are used for “presentation graphics (subtitles) and HDMV mode menus,” and the callback is invoked from the application thread context while `bd_*()` functions are called.
- **ARGB overlays** are used for BD-J menus; the callback “can be called at any time by a thread created by Java VM.”

This is one of the clearest, most actionable interoperability boundaries you can adopt in a Rust redesign: **treat HDMV menus as an overlay-composition problem with deterministic call sites**, while treating BD-J as a separate integration domain.

### Runtime walkthrough diagram

```
Disc opened / folder mounted
        |
        v
Parse index.bdmv ------------------------------+
  - first_play object                          |
  - top_menu object                            |
  - titles[] (hdmv vs bd-j, access flags)      |
        |                                      |
        v                                      |
bd_play() -> start First Play title            |  (public API behaviour)
        |                                      |
        v                                      |
Load MovieObject.bdmv                          |
  - objects[] with commands (12-byte each)     |
        |                                      |
        v                                      |
HDMV VM executes -> emits events --------------+
  - PLAY_PL / SEEK PI / SEEK PM / STILL
  - SET_BUTTON_PAGE / ENABLE/DISABLE_BUTTON
  - POPUP_OFF
        |
        v
Playback engine acts (playlist selection, seeks, still)
        |
        v
Demux MPEG-TS:
  - video/audio
  - PG stream(s): subtitles
  - IG stream(s): menus (popup or menu title)
        |
        v
IG decode -> pages/BOGs/buttons/effects/timeouts
GC runs with:
  - user input (keys/mouse)
  - VM control messages
-> outputs nav command sequences + sound_id_ref
        |
        v
Overlay compositor renders:
  - PG overlays (subtitles)
  - IG overlays (HDMV menus)
```

This is the layered model your Rust crate can preserve almost directly, with the VM and graphics controller emitting explicit events instead of performing playback/rendering internally.

## Authoring workflows and ecosystem survey

### How HDMV menus were created commercially

[DE FACTO PRACTICE + AUTHORITATIVE DOC] Complex commercial Blu-ray authoring historically relied on high-end proprietary toolchains; the practical evidence available publicly tends to surface in the “ecosystem edges” (format-close editor manuals and integration notes) rather than open specs. The IGEditor manual demonstrates a professionalised workflow around:

- editing compiled/demuxed Interactive Graphics stream files (`*.ies`),
- importing/exporting projects compatible with Sonic Scenarist BD (including Scenarist “Designer” files),
- palette calculation/optimisation for button artwork,
- per-button navigation command editing,
- button sound authoring via editing `sound.bdmv`.

While IGEditor is not itself a Blu-ray spec, it is a _high-signal artefact_ showing what real-world HDMV authoring requires at the data-structure level (pages → BOGs → per-state objects + palette + commands).

### What exists today in open-source and Linux-compatible tooling

[DE FACTO PRACTICE] The open-source ecosystem strongly favours muxing/remuxing and basic structure generation over authored interactive menus:

- The tsMuxer project presents itself as a “transport stream muxer for remuxing/muxing elementary streams,” listing codec/container support and muxing features, but not HDMV menu authoring as a first-class capability.
- A direct feature request asks to “Add menu creation to Blu-ray discs,” reflecting that end users perceive menu creation as missing/non-trivial in tsMuxer-centric workflows.

This matches a long-standing pattern: open tools can build playable “BDMV folders” without interactive menus, but HDMV menu authoring is specialised, format-close work.

### Playback/navigation reference implementations and best codebases to study

[REVERSE-ENGINEERED] For a Rust implementer, libbluray is the single most valuable reference because it covers:

- disc index parsing and title modelling (HDMV vs BD-J)
- MovieObject parsing and instruction decoding
- HDMV VM event emission
- IG decode into pages/BOGs/buttons/effects/timeouts
- graphics controller message model (user input + VM control + TS decode)
- overlay output contracts (compressed YUV vs ARGB) and user input APIs.

[DE FACTO PRACTICE] VLC’s Blu-ray module shows how a mainstream desktop player integrates libbluray and where real-world constraints appear:

- It explicitly checks for BD-J capability and falls back to non-menu playback when BD-J can’t be handled, including a user-facing “Java required” dialog.
- It maintains overlay abstractions and distinguishes overlay planes, matching libbluray’s overlay model.

### Gaps where a new Rust library could add value

[INFERENCE] There is a credible niche for a Rust `libhdmv` precisely because:

- open-source already has “works-in-C” navigation/graphics logic (libbluray) but not a reusable Rust-native crate ecosystem,
- tsMuxer-like tools generate BDMV structures but not interactive menu logic authoring or preview,
- modern desktop tooling increasingly wants inspection/visualisation, robust parsing, and testable state machines rather than monolithic players.

A Rust library can add unique value by being: (a) strongly typed; (b) fuzzable; (c) modular; (d) designed for multiple front-ends (CLI inspector, GUI previewer, integration plugin); and (e) explicit about provenance/spec gaps rather than implicitly encoding them.

## `libhdmv` Rust library design proposal

This is a layered design proposal optimised for reuse and implementability. It treats HDMV as **navigation + graphics + state**, not as “video decoding.”

### Scope recommendation

[INFERENCE, grounded by reference contracts] A realistic v1 scope is **playback-oriented navigation/menu preview**, not authoring:

- Parsing: `index.bdmv`, `MovieObject.bdmv`, and enough MPLS/CLPI structure to resolve “what would play” and to identify IG/PG stream PIDs. (The white paper emphasises playlists/clips as core playback structure; libbluray’s APIs expose playlist/title selection and navigation-mode reads.)
- VM: evaluate MovieObject command sequences and produce explicit “next actions” (play title/playlist, seek playitem/mark, still mode, menu directives), matching the event model.
- Graphics decode: decode IGS into a menu scene model (pages/buttons/effects/timeouts) and decode PGS to overlay surfaces (for subtitles and some menu elements), matching known segment structures and time bases.
- Rendering: provide an abstraction and at least one reference renderer that composites paletted overlays into RGBA buffers.

Explicitly _out of scope_ for `libhdmv` v1:

- BD-J runtime implementation (but you may provide integration hooks). The overlay threading and JVM dependency are explicitly different.
- DRM/decryption (AACS/BD+). Even libbluray models these as error conditions rather than implementing them in the navigation API.
- Full A/V codec decoding (delegate to FFmpeg/GStreamer/mpv/etc).

### Proposed crate layout

```
libhdmv-workspace/
  crates/
    bdmv-io/              # FS abstraction (folder/ISO/UDF), path resolver
    bdmv-parse/           # index.bdmv, MovieObject.bdmv, (subset) mpls/clpi
    hdmv-insn/            # instruction enums/decoding (12-byte cmd words)
    hdmv-vm/              # VM executor + register file + event emission
    igs/                  # IGS bitstream decode -> pages/BOGs/buttons/effects
    pgs/                  # PGS decode -> overlay objects (palette + RLE)
    hdmv-scene/           # UI-agnostic scene model (pages/buttons/focus)
    hdmv-render/          # renderer traits + reference CPU compositor
    libhdmv/              # umbrella crate re-exporting stable API surface
  examples/
    hdmv-inspect-cli/
    hdmv-menu-preview/
```

This separation mirrors the boundary that libbluray exposes publicly: data parsing → VM → graphics decode → overlay output.

### Strongly typed modelling targets

[INFERENCE, motivated by real structures] The following types should be newtypes/enums in Rust rather than raw integers:

- `TitleId` (including reserved values for Top Menu and First Play)
- `PlaylistId`, `PlayItemId`, `PlayMarkId` (because VM events distinguish play playlist vs seek playitem vs seek playmark)
- `PageId`, `ButtonId`, `BogId` (because PSRs and IGS structures index by these)
- `Pts90k` wrapper (because user input APIs and effects timers are in 1/90000s time base)
- `UoMask` bitflags (menu call/title search and page UO mask tables)

### Public API shape for reuse

The “least regret” API is a **session-based state machine** that can be driven by tests, CLIs, GUIs, or a plugin wrapper.

A plausible high-level API contract:

- `Disc::open(source)` → parse index, locate metadata, expose title list and entry points.
- `NavSession::start_first_play()` → start VM + navigation.
- `NavSession::step(now_pts)` → advance VM, handle timeouts/effects, produce events.
- `NavSession::submit_input(input, now_pts)` → update focus/activation and produce effects.
- `NavSession::render(target)` → optional: produce RGBA overlay frames or drawing ops.

This mirrors how libbluray’s navigation mode works: `bd_read_ext` returns zero when an “event needs to be handled first,” and user input functions accept an explicit PTS in 90 kHz units.

### Error model and versioning

[REVERSE-ENGINEERED + INFERENCE] Use a layered error system:

- **Parse errors**: signature/version mismatch (e.g., index expects `INDX0100`/`INDX0200` in libbluray; mismatches are observed in the wild and logged by implementations) and length checks.
- **Unsupported feature errors**: unknown “extension data” offsets, unknown opcode values, unimplemented set-system variants.
- **Runtime errors**: VM invalid state, illegal page/button references, missing stream PIDs.
- **Environment errors**: encrypted content (AACS/BD+) or BD-J required paths/permissions, surfaced explicitly rather than “mysterious failures.”

Versioning recommendation: semantic versioning at the “umbrella crate” (`libhdmv`) with internal crates allowed to move faster, and a clearly documented stability policy for exposed structs that may need to evolve as more discs are tested.

### Authoring architecture proposal

Authoring is substantially larger than playback. The evidence from ecosystem tools is that even muxers that can generate BDMV structure do not generally implement menu authoring.

A realistic staged plan is:

**Stage one (v1): inspector + preview**

- parse and display what exists
- decode and render menu overlays
- trace VM events and button command sequences

**Stage two (v2+): constrained authoring**  
Target only a subset: static top menu + simple pop-up menu, no complex animated effects.

**Stage three (later): full authoring toolchain**  
Implement compilation of IGS display sets (pages/BOGs/effects) and generation of correct BDMV metadata, plus a muxing step.

A concrete authoring pipeline sketch (future-facing):

```
Design-time assets:
  - background image/video (optional)
  - button images (normal/selected/activated)
  - palette policy (auto-quantise vs fixed)
  - nav graph + action scripts
  - sound effects (button click/hover)
        |
        v
IG authoring model (pages/BOGs/buttons/effects)
        |
        v
IG compiler:
  - generate palettes + paletted objects
  - emit IGS segments (interactive composition + objects + palettes)
  - emit per-button nav command sequences
        |
        v
Muxing:
  - multiplex IGS PID(s) with video/audio in M2TS
  - multiplex PGS if needed
        |
        v
BDMV authoring:
  - generate MPLS/CLPI/index/movie objects
  - write AUXDATA (sound.bdmv)
  - produce BDMV/BACKUP mirrors
```

This is consistent with the artefacts surfaced by IG authoring tooling (per-state objects, palette recalculation, nav commands, `sound.bdmv`) and with the runtime contract that IGS can be multiplexed and timed via PTS/DTS.

## Tauri v2 plugin design proposal and phased roadmap

### Plugin framing and responsibility split

[AUTHORITATIVE DOC] Tauri v2 plugins are composed of a **Cargo crate** and an **optional NPM package** providing JS bindings for commands/events; they can additionally include mobile components. This makes it natural to keep nearly all HDMV logic in a reusable Rust crate and expose a thin, permissioned command/event surface via the plugin.

[AUTHORITATIVE DOC] Tauri’s v2 security model uses **capabilities and permissions** to constrain what is exposed to the WebView frontend; permissions can enable/deny commands and map scopes to commands. For a plugin that reads disc images and large media structures, you want this as a first-order design input, not an afterthought.

**Responsibility split (recommended)**

- `libhdmv` (core crate): parsing, VM, IGS/PGS decode, menu state machine, renderer abstraction.
- Plugin crate: session lifecycle, file access mediation, caching, streaming events to frontend, permission + scope enforcement.

### Plugin surface area proposal

A Tauri plugin should avoid per-frame raw video/overlay streaming unless the UI is specifically a preview tool, because moving full-resolution frames over the Rust/JS boundary is costly. A better default is to expose:

- **Structural inspection** APIs (titles, playlists, streams, menu pages/buttons, command traces).
- **Menu preview** at controlled cadence (e.g., render-on-demand or fixed low FPS), suitable for authoring/inspection tools.
- **Event trace** and **deterministic replay** primitives for debugging.

[AUTHORITATIVE DOC] On the Tauri side, commands are registered via a single `generate_handler!` call, and the command system is a core primitive for backend invocation.

#### Example plugin API sketch (conceptual)

```rust
// Rust (plugin): command signatures (conceptual; not complete)

#[tauri::command]
async fn hdmv_open_disc(path: String) -> Result<SessionId, PluginError>;

#[tauri::command]
async fn hdmv_get_disc_summary(session: SessionId) -> Result<DiscSummary, PluginError>;

#[tauri::command]
async fn hdmv_list_titles(session: SessionId) -> Result<Vec<TitleInfo>, PluginError>;

#[tauri::command]
async fn hdmv_start_first_play(session: SessionId) -> Result<(), PluginError>;

#[tauri::command]
async fn hdmv_step(session: SessionId, now_pts_90k: i64) -> Result<Vec<NavEvent>, PluginError>;

#[tauri::command]
async fn hdmv_send_key(session: SessionId, key: RemoteKey, now_pts_90k: i64) -> Result<(), PluginError>;

#[tauri::command]
async fn hdmv_mouse_select(session: SessionId, x: u16, y: u16, now_pts_90k: i64) -> Result<HitTest, PluginError>;

#[tauri::command]
async fn hdmv_render_overlay_png(session: SessionId, now_pts_90k: i64, max_w: u32) -> Result<Vec<u8>, PluginError>;
// returns a small PNG for preview tools; avoids huge per-frame RGBA transfers.

#[tauri::command]
async fn hdmv_get_last_trace(session: SessionId) -> Result<Vec<TraceEvent>, PluginError>;
```

This roughly matches the public libbluray interaction model: you drive navigation with explicit PTS (90 kHz), submit user input, consume queued events, and receive overlay outputs through a well-defined contract.

### Data movement across Rust/JS boundary

[INFERENCE, constrained by known overlay contracts] Choose among three transport modes, depending on application product goals:

- **Inspection mode**: send JSON-serialisable state snapshots and traces (pages/buttons/current focus) and only render thumbnails on demand.
- **Preview mode**: render overlay frames in Rust and send compressed images (PNG/WebP) at low rate, plus button hit-test rectangles for interactivity.
- **High-fidelity mode**: keep rendering native-side (wgpu/skia) and present via a native window surface; use Tauri primarily as “controller UI” rather than as the renderer.

If you do decide to stream pixels, note that overlays can be paletted + compressed; libbluray supports a compressed YUV overlay callback specifically because it can be optimised (colour conversion, drawing). That is a hint that pixel transport costs matter.

### Security and packaging concerns

[AUTHORITATIVE DOC] Capabilities and permissions should restrict which plugin commands are available to which windows/webviews and under what scopes. This is directly relevant when reading arbitrary filesystem paths for disc folders/ISOs.

[AUTHORITATIVE DOC] When additional non-frontend files must ship with the app (e.g., sample fixtures, font caches for TextST previews, small reference assets), Tauri treats these as “resources” and provides guidance on embedding additional files in the bundle.

### Phased implementation roadmap

This roadmap explicitly separates “must implement” from “nice to have,” and assumes the project goal is an open-source Rust ecosystem, not a monolithic player.

**v1: parser/inspector foundation (high confidence)**  
Must implement:

- `index.bdmv` parsing with title/object type modelling and access flags.
- `MovieObject.bdmv` parsing: signature/version, object flags, command decoding (12-byte records).
- Instruction enum model mirroring BRANCH/CMP/SET/SETSYSTEM groups.
- CLI that prints: titles, first play/top menu mapping, object command dumps, and basic consistency checks.

Nice to have:

- partial MPLS/CLPI parse sufficient to map playlists to stream names (for inspection).

**v1.1: HDMV VM + deterministic event model (medium confidence)**  
Must implement:

- register file (GPR/PSR), including key PSRs for menu page/button IDs.
- VM executor that emits events analogous to `HDMV_EVENT_*` (play title/playlist, seeks, still, menu directives).
- trace/replay harness for VM execution using golden fixtures.

Nice to have:

- user operation mask propagation.

**v1.2: IGS/PGS decode and render abstraction (medium-to-high confidence)**  
Must implement:

- IGS decode into pages/BOGs/buttons/effects/timeouts (minimum needed to show menus and respond to selection).
- PGS decode (or reuse a decoder) for subtitle plane overlays; at minimum support the segment types and paletted RLE decode path.
- CPU reference compositor producing RGBA output.

Nice to have:

- effect and animation fidelity (in/out effects, frame rate codes).

**v1.3: menu preview engine (product-grade for tooling)**  
Must implement:

- focus navigation, activation, page transitions, enable/disable button behaviour, pop-up toggling.
- button hit testing (`mouse_select` equivalent) and key input mapping.

**v2: authoring (only if demanded)**  
Must implement:

- minimal IG authoring model + compiler for trivial menus
- generation of `sound.bdmv` entries and consistent palette/object sets (as implied by authoring tooling)
- robust BDMV metadata generation (index/movie objects/playlists) with compatibility tests.

### Validation strategy

Because distributing commercial disc assets is legally fraught, validation should rely on a mix of synthetic fixtures and user-provided discs in local test runs.

**Fixture strategy (repo-safe)**

- Generate minimal BDMV folders using muxers that can output basic structure (without menus), then add your own small `MovieObject.bdmv` fixtures and synthetic IGS/PGS streams. The absence of menu creation in common muxers is precisely why synthetic fixtures are valuable.
- Include tiny, self-authored PGS display sets to test palette/object/presentation/window/display segment parsing (segment types and codes are well defined in decoder references).

**Behavioural comparison (local-only, not redistributed)**

- Compare VM event traces and overlay outputs against libbluray via controlled runs: libbluray exposes an event queue (`bd_get_event`) and a navigation read API that returns when events need handling.
- For menu interactions, record sequences of inputs (keys/mouse) and compare resulting focus/button states and rendered overlays (hashes or perceptual diffs). libbluray explicitly supports mouse selection and user input with PTS.

**Golden tests**

- “Golden JSON” for parsed structures (index, movie objects, decoded pages/buttons)
- “Golden trace” for VM execution (instruction-by-instruction, PSR/GPR changes)
- “Golden image” for composited overlays for deterministic IGS/PGS samples

## UHD Blu-ray (4K UHD BD) considerations

This section documents how UHD Blu-ray differs from standard BD and what those differences mean for `libhdmv` and Spindle. The goal is to ensure architectural decisions made now accommodate future 4K support without requiring structural refactoring.

### What stays the same

**HDMV is unchanged on UHD BD.** The VM, instruction set, registers, movie objects, and IGS format are identical between standard BD and UHD BD. A menu authored for a UHD BD disc uses the same HDMV opcodes, the same PSR/GPR register file, and the same IGS page/BOG/button model as standard BD.

**IGS resolution remains 1920×1080.** UHD BD menus are rendered at 1080p and upscaled by the player to 4K. There is no 4K-native IGS resolution defined in the specification.

**BDMV directory layout is identical.** The same `BDMV/` tree with `PLAYLIST/`, `CLIPINF/`, `STREAM/`, `BACKUP/`, `AUXDATA/`, `META/`, `JAR/` subdirectories.

**UDF 2.5 filesystem** — same as standard BD.

**Audio codec set is unchanged.** The same stream coding types (0x80–0x86, 0xA1–0xA2) apply. Dolby Atmos and DTS:X are carried as metadata extensions within existing TrueHD (0x83) and DTS-HD MA (0x86) bitstreams respectively — they do not introduce new stream coding types.

**AC-3 fallback requirement still applies.** TrueHD bitstreams contain an embedded AC-3 core that players fall back to automatically.

### What changes

#### Disc capacity tiers

| Disc type   | Capacity | Layers | Max data rate |
| ----------- | -------- | ------ | ------------- |
| BD-25       | 25 GB    | 1      | 54 Mbit/s     |
| BD-50       | 50 GB    | 2      | 54 Mbit/s     |
| BD-50 (UHD) | 50 GB    | 2      | 82 Mbit/s     |
| BD-66       | 66 GB    | 2      | 108 Mbit/s    |
| BD-100      | 100 GB   | 3      | 128 Mbit/s    |

BD-66 and BD-100 use 33.33 GB per layer (shorter pits/lands, same density as BDXL). Standard BD-R 50 GB dual-layer discs can be burned in UHD BD format and played on UHD BD players without encryption.

**Impact on Spindle:** The disc planner needs BD-66 and BD-100 capacity tiers with their higher maximum bitrates. The capacity model should treat disc type as an enum that expands, not a boolean.

#### BDMV metadata version bump to 0300

| File               | Standard BD | UHD BD     |
| ------------------ | ----------- | ---------- |
| `index.bdmv`       | `INDX0200`  | `INDX0300` |
| `MovieObject.bdmv` | `MOBJ0200`  | `MOBJ0300` |
| `*.mpls`           | `MPLS0200`  | `MPLS0300` |
| `*.clpi`           | `HDMV0200`  | `HDMV0300` |

The 0300 versions add extension data blocks for HDR metadata and HEVC stream descriptors. The core structure of each file remains the same — 0300 is additive, not a redesign.

**Impact on `bdmv-parse`:** Parsers must accept 0100, 0200, and 0300 signatures. Unknown versions should produce warnings, not hard failures. Extension data blocks should be parsed when understood and preserved (or skipped with logging) when not.

#### HEVC video (stream coding type 0x24)

HEVC is mandatory for UHD BD primary video at 4K. H.264 is not permitted at 3840×2160.

- **Profile:** Main 10 (mandatory)
- **Colour depth:** 10-bit (mandatory)
- **Chroma:** 4:2:0
- **Level:** 5.1 for 3840×2160 up to 60fps
- **Colour space:** BT.2020
- **Transfer function:** SMPTE ST 2084 (PQ) for HDR10, or HLG
- **Frame rates:** 23.976, 24, 25, 29.97, 50, 59.94 fps (progressive only at 4K)

When `stream_coding_type` is 0x24, the `StreamCodingInfo` structure in CLPI/MPLS has additional fields:

| Field            | Size (bits) | Values                                          |
| ---------------- | ----------- | ----------------------------------------------- |
| VideoFormat      | 4           | Value **8 = 2160p** (new; standard BD uses 1–7) |
| FrameRate        | 4           | Same as standard BD                             |
| DynamicRangeType | 4           | **0 = SDR, 1 = HDR10, 2 = Dolby Vision**        |
| ColorSpace       | 4           | **1 = BT.709, 2 = BT.2020**                     |
| HDRPlusFlag      | 1           | **1 = HDR10+ metadata present**                 |
| CRFlag           | 1           | Purpose not fully documented publicly           |

**Impact on `bdmv-parse`:** The CLPI/MPLS stream coding info parser needs a branch for 0x24 that reads the extended fields. The `VideoFormat` enum needs a `V2160p` variant. New enums needed for `DynamicRangeType`, `ColorSpace`, and `HDRPlusFlag`.

**Impact on Spindle:** The output profile editor needs HEVC options with HDR-aware parameters. The compatibility analyser needs to understand HEVC Main 10 requirements. The planner needs higher bitrate ranges (up to 128 Mbit/s for BD-100).

#### HDR metadata

**HDR10 (mandatory on UHD BD with HDR content):**

- Static metadata carried as SEI messages in the HEVC bitstream (SMPTE ST 2086 mastering display colour volume + CTA-861.3 content light levels)
- Parameters: display primaries (R/G/B xy coordinates), white point, min/max luminance, MaxCLL, MaxFALL
- In MPLS: extension data block 3.5 carries the static metadata descriptor

**HDR10+ (optional, BDA spec v3.2+):**

- Dynamic metadata (scene-by-scene or frame-by-frame tone mapping)
- Carried as SEI messages (SMPTE ST 2094-40) in the HEVC bitstream
- Detected via `HDRPlusFlag` in StreamCodingInfo when `stream_coding_type` is 0x24

**Dolby Vision (optional):**

- Uses **Profile 7** (dual-layer, dual-track) on UHD BD
- **Base Layer (BL):** 3840×2160 HEVC Main 10, 4:2:0, 10-bit — fully HDR10 compatible
- **Enhancement Layer (EL):** 1920×1080 HEVC Main 10, 4:2:0, 10-bit
- **RPU (Reference Processing Unit):** Interleaved metadata guiding reconstruction of the 12-bit Dolby Vision output
- BL and EL are separate HEVC elementary streams within the same M2TS container
- The EL is referenced via a **SubPath** in the MPLS
- Two EL variants: MEL (minimal, primarily RPU data) and FEL (full enhancement image data)
- Backward compatible: non-DV players ignore the EL and play HDR10 from the BL

**Impact on `bdmv-parse`:** MPLS extension 3.5 needs a parser for HDR10 static metadata. SubPath handling needs to accommodate DV enhancement layer references. These are additive — the core MPLS structure is the same.

**Impact on Spindle (future):** HDR metadata must be preserved or correctly generated through the encode/mux pipeline. This is primarily a toolchain-adapter concern (ffmpeg x265 parameters, tsMuxeR HDR flags) rather than a `libhdmv` concern. Dolby Vision dual-layer authoring is the most complex variant and should be a late-stage feature.

#### MPLS SubPath types

Standard BD defines SubPath types 2–7. UHD BD adds:

| Type     | Purpose                                                        |
| -------- | -------------------------------------------------------------- |
| 8        | Stereoscopic 3D (SS Video)                                     |
| (higher) | Dolby Vision EL sub-paths (type not fully documented publicly) |

**Impact on `bdmv-parse`:** SubPath type should be an enum with an `Unknown(u8)` fallback. DV EL sub-paths can be identified by the stream coding type of the referenced clip rather than by a single SubPath type value.

### Architecture implications for future-proofing

The following design decisions in `libhdmv` and Spindle ensure UHD BD support can be added without structural changes:

1. **Version-tolerant parsers.** All `bdmv-parse` file parsers should accept 0100/0200/0300 signatures and use version-aware field reading. This is already recommended practice for standard BD compatibility.

2. **Stream coding type as an extensible enum.** Add `Hevc = 0x24` to the video stream coding type enum now, even before implementing HEVC-specific parsing. Unknown stream types should be preserved, not rejected.

3. **Video format enum includes 2160p.** Add `V2160p = 8` to the `VideoFormat` enum alongside existing values (480i, 576i, 480p, 576p, 720p, 1080i, 1080p).

4. **Disc capacity model is tier-based.** The planner should model disc types as `Bd25 | Bd50 | Bd66 | Bd100` (and `Dvd5 | Dvd9` for DVD), not as a raw byte count.

5. **HDR metadata is a property of the stream, not the disc.** A single disc can contain both SDR and HDR content (e.g., HDR10 feature film + SDR bonus features). Metadata should attach to stream/playlist entries, not to a global disc setting.

6. **SubPath handling is generic.** The MPLS parser should not hardcode SubPath types. Parse the type field, dispatch on known types, and preserve unknown types.

7. **Output profiles are codec-parameterised.** The output profile model should carry codec-specific parameters (H.264 profile/level, HEVC profile/level/HDR metadata, etc.) rather than having a flat list of fields that only apply to one codec.

### UHD BD toolchain landscape

| Tool                   | Status | UHD BD support                                                                  |
| ---------------------- | ------ | ------------------------------------------------------------------------------- |
| tsMuxeR (jaminmc fork) | Active | HEVC muxing, HDR10, HDR10+, DV Profile 7                                        |
| ffmpeg + x265          | Active | HEVC encoding with HDR10 static metadata, HDR10+ with plugin                    |
| hdr10plus_tool (Rust)  | Active | HDR10+ metadata extraction/injection for HEVC                                   |
| dovi_tool (Rust)       | Active | Dolby Vision RPU metadata manipulation                                          |
| libbluray              | Active | Full UHD BD parsing (v1.4.0+), HEVC 0x24, HDR flags, DV sub-paths, MPLS ext 3.5 |

Notable: `hdr10plus_tool` and `dovi_tool` are both Rust crates by the same author (quietvoid). These could be dependencies for Spindle's HDR metadata pipeline rather than reimplementing that functionality.

---

## Risks, unknowns, and annotated bibliography

### Risks and hardest unknowns

**Spec access gap (high impact)**  
The complete Blu-ray Disc specifications that formally define HDMV/IGS behaviour are not generally publicly accessible. The Blu-ray white paper is authoritative but explicitly notes that specifications were not finalised at the time and may be modified; therefore, some semantics must be treated as best-effort, validated against reference implementations.

**Version drift in control files (medium-high impact)**  
Index parsing in libbluray expects particular signature versions (e.g., `INDX0100`/`INDX0200`), and real-world logs show signature mismatches exist. UHD BD introduces version `0300` across all control files (`INDX0300`, `MOBJ0300`, `MPLS0300`, `HDMV0300`), adding extension data for HEVC and HDR metadata. Your Rust parser should be defensive: accept multiple known versions (0100, 0200, 0300), and surface unknown ones as structured warnings rather than hard failures where possible.

**IGS behavioural fidelity (medium-high impact)**  
Even with a decoded page/button model, correct behaviour depends on subtle rules: default button selection resolution, enable/disable interaction, effect timing, and how PSRs drive state restoration. libbluray’s graphics controller code indicates non-trivial state management around `PSR_MENU_PAGE_ID` and `PSR_SELECTED_BUTTON_ID`.

**BD-J scope creep (high impact)**  
BD-J differs sharply: ARGB overlay output, Java VM threads, network/storage/security permissions. VLC’s behaviour demonstrates user-visible dependency on Java availability for BD-J menus, reinforcing that BD-J support should be a separate milestone (or delegated to libbluray/OpenJDK integration) rather than blended into initial HDMV goals.

**DRM/legality constraints (high impact for “disc playback”)**  
Commercial disc playback is dominated by AACS/BD+ constraints. libbluray models these as error categories (`BD_ERROR_AACS`, `BD_ERROR_BDPLUS`) and surfaces “encrypted” conditions in events. A Rust `libhdmv` should plan for decrypted inputs first and treat DRM as out of scope.

### Final judgement

**Is HDMV a good target for a new Rust library?**  
Yes—_if the project is framed as navigation/menu decoding and preview, not as a full commercial Blu-ray player_. The HDMV surface area is bounded and strongly evidenced by open implementations: instructions are enumerable, control files are structured binaries, and the graphics model is decodable into a concrete scene representation.

**Where can it provide unique value?**  
A Rust-native implementation can differentiate on: safety (no UB), fuzz-hardening for parsers, strongly typed state machines, and ergonomic integration surfaces for modern desktop tooling (inspectors, menu previewers, validation/lint tools). The open ecosystem currently has clear gaps around authored-menu tooling and reusable, testable HDMV engines.

**Should the Tauri plugin be the product surface or an integration layer?**  
Treat the plugin as a **thin integration layer**. Tauri v2’s plugin model (crate + optional NPM bindings) aligns well with keeping the substantive logic in `libhdmv` and exposing only the commands/events needed by the UI. The security/capabilities system further rewards a narrow plugin surface area for filesystem-heavy workloads.

### Recommended next steps

1. **Write a SPEC.md-style “behavioural contract”** for your Rust engine modelled on the event split:
   - parse → VM events → player actions → graphics decode → overlay output,
   - explicitly define the time base (90 kHz), input model, and expected event ordering.

2. **Implement `bdmv-parse` + `hdmv-insn` first**, with a JSON inspector CLI and golden fixtures:
   - focus on `index.bdmv` and `MovieObject.bdmv` signatures, versions, length checks, and complete command decoding.

3. **Add a minimal VM that emits events** (no graphics yet), and verify against synthetic MovieObject fixtures and local libbluray traces.

4. **Bring up IGS decode + rudimentary renderer**, initially targeting only:
   - pages, BOGs, default selected button, and static state images,
   - then expand into effects and timeouts.

5. **Design the Tauri plugin only after `libhdmv` has a stable session API**, and incorporate permissions/capabilities from the start.

### Annotated bibliography and source list

**Blu-ray Disc Association — “BD-ROM Audio Visual Application” white paper (March 2005).**  
Authoritative early documentation of HDMV/BD-J concepts, graphics stream roles, and menu capabilities (always-on menus, multi-page menus, dynamic button enable/disable) and BD-J platform features (security model, storage, networking). Also explicitly describes Presentation Graphics as a frame-accurate overlay stream available in both modes, and ties interactive graphics visibility to PTS/DTS when multiplexed.

**AACS LA — AACS “Blu-ray Disc Recordable Book” excerpts showing BDMV directory structure and encryption notes.**  
Useful for confirming canonical directory structure and clarifying that, at least for recordable media, BDMV application structure is defined with clear separation between metadata and AV streams.

**libbluray source code (HDMV VM, parsers, IG/PG decoders, public API).**  
Primary behavioural reference for implementers: enumerated instruction sets and system commands; file signatures/versions and command decoding layout; VM event model; IG decode structures (pages/BOGs/effects/timeouts); and overlay output contracts distinguishing HDMV (compressed YUV) from BD-J (ARGB + JVM threads).

**FFmpeg — PGS subtitle decoder documentation/source.**  
Concrete, implementable definition of PGS segment types and codes (palette/object/presentation/window/display), plus the RLE + 256-entry palette model that informs your overlay pipeline and fixture generation.

**DVDLogic Software — IGEditor manual (2009–2010).**  
Authoring-oriented evidence: menus as pages with button overlap groups; three-state button imagery; palette recalculation; navigation command editing; and direct mention of `sound.bdmv` editing plus integration with Sonic Scenarist BD, showing what practical HDMV authoring entails even when tools are proprietary. Also explicitly states register counts (4096 GPR, 128 PSR).

**tsMuxer repository and issue tracker.**  
Shows the open-source ecosystem’s emphasis on muxing/structure generation and the practical demand for (but absence of) Blu-ray menu creation in common workflows.

**VLC Blu-ray module (`modules/access/bluray.c`).**  
Demonstrates real-world integration and UX constraints: BD-J menu support depends on Java availability and may fall back to non-menu playback; also reflects overlay-plane abstractions consistent with libbluray’s output model.

**Tauri v2 documentation: plugin development + security (capabilities/permissions) + calling Rust.**  
Defines the correct wrapper architecture for a plugin surface (crate + optional NPM bindings), and the security primitives (permissions/capabilities) that should constrain disc/ISO access and command exposure for a filesystem-heavy plugin.

**lw/BluRay Wiki — StreamCodingInfo and CLPI format documentation.**
Community-maintained binary format documentation for CLPI and MPLS structures, including HEVC stream coding type 0x24 and associated fields (DynamicRangeType, ColorSpace, HDRPlusFlag). Essential reference for implementing UHD BD stream info parsing.

**quietvoid/hdr10plus_tool (Rust) — HDR10+ metadata CLI.**
Rust crate for extracting and injecting HDR10+ dynamic metadata (SMPTE ST 2094-40) in HEVC bitstreams. Potential dependency for Spindle's HDR metadata pipeline.

**quietvoid/dovi_tool (Rust) — Dolby Vision RPU metadata CLI.**
Rust crate for manipulating Dolby Vision Reference Processing Unit data. Covers Profile 7 dual-layer extraction, injection, and conversion. Potential dependency for DV-aware authoring.

**Dolby — "Dolby Vision UHD Blu-ray Authoring Workflow Guide" v1.1.**
Professional documentation of DV Profile 7 authoring on UHD BD: base layer + enhancement layer architecture, MEL vs FEL variants, MPLS sub-path referencing, and backward compatibility with HDR10 players.

**jaminmc/tsMuxer (C++) — actively maintained tsMuxeR fork.**
Continuation of the tsMuxeR project after the justdan96 repository was archived in April 2025. Supports HEVC muxing, HDR10, HDR10+, and Dolby Vision Profile 7 dual-layer for UHD BD-compatible BDMV structure generation.
