# HDMV for Blu-ray Disc: implementable architecture research for a Rust `libhdmv` and Tauri v2 plugin

## Executive summary

HDMV (“HD Movie mode”) is the *non-Java* interactive application model in the Blu-ray Disc ecosystem: it combines disc-level control data (e.g., `index.bdmv`, `MovieObject.bdmv`, playlists) with time-synchronised graphics streams (Interactive Graphics for menus, Presentation Graphics for subtitles/overlays) to deliver button-driven navigation, pop-up menus, and limited logic. In practice, HDMV behaves like a small, deterministic, register-based control language (“movie object” command sequences) plus a page-based interactive graphics scene model (“pages”, “button overlap groups”, effects, timeouts), tightly coupled to the player’s playback timeline and state. citeturn26view6turn26view7turn21view1turn11view2turn12view1

The most implementable public view of HDMV today is *de facto* behavioural specification via reference implementations—especially entity["organization","libbluray","blu-ray navigation library"]—and adjacent decoder codebases for graphics payloads. libbluray exposes: (a) HDMV instruction grouping and opcodes; (b) a VM that emits playback/navigation events; (c) an Interactive Graphics decoder that yields pages/buttons/effects/timeouts; and (d) overlay output models that reveal the essential rendering contract. citeturn11view0turn19view1turn12view1turn18view1turn39view2

BD-J (Java-based) is a different runtime model: it adds a general-purpose application environment (networking, storage, permissions, richer UI toolkits) at the cost of JVM integration, asynchronous threading, and larger behavioural surface area. Notably, libbluray’s public API explicitly distinguishes overlay output modalities: HDMV menus/subtitles can be emitted as compressed YUV overlays, while BD-J menus emit ARGB overlays and may invoke callbacks from Java VM threads. A mainstream player integration (entity["organization","VLC media player","open-source media player"] by entity["organization","VideoLAN","nonprofit software org"]) reflects this in user-facing behaviour: when BD-J is detected but Java is unavailable/unsupported, discs are played without BD-J menus. citeturn39view2turn37view8

**Feasibility judgement (Linux/Rust)**: a Rust-native HDMV stack is *realistically implementable* on Linux **for decrypted disc folders / ISOs** and for many inspection/preview use cases, because the key complexities (binary parsing, deterministic VM, IGS/PGS decoding, overlay composition) are well bounded and publicly inferable via open implementations. Full disc playback of commercial titles is constrained mainly by DRM (AACS/BD+), not by HDMV itself; libbluray’s API surface even models “encrypted” error conditions distinctly (AACS/BD+). citeturn38view5turn39view2

**Recommended sequencing**: start as a **parser/inspector + menu preview engine** (HDMV VM + IGS/PGS decode + renderer abstraction) rather than authoring. Authoring requires *compiling* IGS/HDMV assets and generating correct BDMV metadata structures, which is a much larger and less documented surface area than reading/playing. Evidence from tooling ecosystems supports this bias: open tools like entity["organization","tsMuxer","transport stream muxer"] focus on muxing and generating basic BDMV structures, and feature requests explicitly ask for Blu-ray menu creation as a missing capability. citeturn34search26turn34search1

To make the deliverable usable as an RFC foundation, this report uses provenance tags:

- **[FORMAL SPEC]**: behaviour defined in publicly accessible official specifications (limited here due to licensing access).
- **[AUTHORITATIVE DOC]**: official/industry docs and white papers; may not be the final “Blue Book” text.
- **[DE FACTO PRACTICE]**: observed industry usage patterns and player behaviour.
- **[REVERSE-ENGINEERED]**: derived from open-source implementation details and format archaeology.
- **[INFERENCE]**: reasoned design/architecture conclusions, clearly marked.

### Output map to the requested structure

| Requested item | Where it is addressed |
|---|---|
| Executive summary | Executive summary (this section) |
| Glossary | Glossary of terms |
| Deep technical explanation of HDMV | Blu-ray architecture; HDMV runtime and graphics model |
| Comparison table: HDMV vs BD-J | Blu-ray architecture (comparison table) |
| Disc/file/runtime architecture walkthrough | Blu-ray architecture; HDMV runtime and graphics model (diagrams) |
| Graphics and menu model analysis | HDMV runtime and graphics model |
| Existing tools and ecosystem survey | Authoring workflows and ecosystem survey |
| Rust library design proposal | `libhdmv` Rust library design proposal |
| Tauri v2 plugin design proposal | Tauri v2 plugin design proposal and phased roadmap |
| Phased implementation roadmap | Tauri v2 plugin design proposal and phased roadmap |
| Risks, unknowns, and research gaps | Risks, unknowns, and annotated bibliography |
| Recommended next steps | Risks, unknowns, and annotated bibliography |
| Annotated bibliography / source list | Risks, unknowns, and annotated bibliography |

## Glossary of terms

**BDMV (Blu-ray Disc Movie)**: the disc application format directory tree that contains control files (`*.bdmv`), playlists (`*.mpls`), clip info (`*.clpi`), and streams (`*.m2ts`). AACS documentation for BD recordable media depicts the core structure and explicitly references `index.bdmv`, `MovieObject.bdmv`, and the `PLAYLIST/CLIPINF/STREAM` subtrees. citeturn22search12turn26view9

**HDMV**: the non-Java Blu-ray application mode that provides menu and navigation logic via “movie objects” and Interactive Graphics, with deterministic commands and registers rather than a general-purpose VM. The Blu-ray audio-visual application white paper treats HDMV as a first-class mode alongside BD-J. citeturn26view6turn26view7turn26view0

**BD-J**: the Java-based Blu-ray application mode (Xlet model), supporting authenticated/signed applications, network access (with permissions), and local/system storage, among other platform features. citeturn26view0

**`index.bdmv`**: a disc control file that enumerates titles and indicates which playback objects represent “First Play” and “Top Menu”. A widely used parser (libbluray) treats it as a signature/versioned binary and exposes title object types (HDMV vs BD-J) and access flags (permitted/prohibited/hidden). citeturn24view1turn25view0turn25view2

**`MovieObject.bdmv`**: a disc control file containing “movie objects,” each a sequence of fixed-size commands with flags such as `resume_intention_flag` and masks affecting user operations (menu call/title search). libbluray’s parser shows the file signature/versioning and the 12-byte command layout. citeturn21view1turn20view3

**MPLS (playlist)**: `*.mpls` files in `BDMV/PLAYLIST/` define PlayItems (clip intervals) and playmarks (chapters). The white paper positions playlists as core playback structure and also introduces “sub-paths” for supplemental content. citeturn2view2turn2view1

**CLPI (clip info)**: `*.clpi` files in `BDMV/CLIPINF/` carry metadata needed to access corresponding `*.m2ts` clip streams (e.g., time stamps/access points), referenced as part of BDMV’s core format structure. citeturn22search12turn26view9

**M2TS**: MPEG-2 transport stream files used for Blu-ray clips in `BDMV/STREAM/`. Both Presentation Graphics (PGS) and Interactive Graphics (IGS) are carried as streams multiplexed with video/audio and can be timed by PTS/DTS. citeturn26view6turn18view1

**PGS (Presentation Graphics Stream)**: a subtitle/overlay stream format designed for frame-accurate graphic overlay; FFmpeg’s decoder models segment types such as palette/object/presentation/window/display and RLE bitmap payloads with up to 256 palette entries. citeturn31view0turn30view6turn30view9

**IGS (Interactive Graphics Stream)**: a timed interactive graphics stream used for HDMV menus, including pages, buttons, effects sequences, timeouts, and navigation commands tied to button actions. libbluray’s IG decoder reveals a page/BOG-centric model with per-page defaults and effect sequences. citeturn12view1turn18view1turn26view6

**GPR/PSR**: General Purpose Registers and Player Status Registers. A commercial-grade menu editor manual states the BD-ROM player has 4096 GPRs and 128 PSRs; libbluray defines matching counts and exposes PSR meanings such as interactive graphics stream number, primary audio, and menu page/button IDs. citeturn33view2turn33view3turn8view7turn8view3

## HDMV in the Blu-ray architecture

### What HDMV is and where it sits

[AUTHORITATIVE DOC] Blu-ray’s audio-visual application model is layered: transport streams carry audio/video and graphics streams; disc-level metadata selects titles and provides navigation entry points; and applications are realised in either HDMV mode (scripted commands + interactive graphics) or BD-J mode (Java Xlets + the BD-J platform). The Blu-ray white paper explicitly describes both HDMV and BD-J and positions Presentation Graphics as available in both modes, while Interactive Graphics is the HDMV mechanism enabling always-on and multi-page menus with frame-accurate timing when multiplexed with video. citeturn26view7turn26view6turn26view0

[REVERSE-ENGINEERED] libbluray’s `index.bdmv` model directly encodes this split: titles in the index have `object_type` values for “hdmv” and “bdj”, and HDMV/BD-J each have “movie” vs “interactive” playback types. In addition, per-title access types include “permitted”, “prohibited”, and “hidden”, with explicit comments about whether a title “may be shown on UI”. citeturn25view0turn24view3

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

This is consistent across (a) BDMV diagrams used in AACS documentation for BD recordable media and (b) Blu-ray application documentation that treats playlists and clip info as distinct from AV streams. citeturn22search12turn2view2turn26view9turn20view1

[REVERSE-ENGINEERED] libbluray’s loaders explicitly attempt `BDMV/MovieObject.bdmv` and, on failure, fall back to `BDMV/BACKUP/MovieObject.bdmv`, which is an implementation-level confirmation of the “backup metadata” convention. citeturn20view1

### Launch and control: “First Play”, “Top Menu”, titles, playlists, movie objects

[REVERSE-ENGINEERED] In libbluray’s `index.bdmv` parser, two “playback objects” appear before the title list: `first_play` and `top_menu`. After these objects are parsed, the index contains `num_titles` and an array of titles, each with `object_type` (HDMV vs BD-J) and `access_type` flags. citeturn24view3turn24view6turn24view7turn25view0

[AUTHORITATIVE DOC + REVERSE-ENGINEERED] At a runtime level, libbluray’s public navigation API makes this model concrete:

- `bd_play()` starts navigation “from ‘First Play’ title.” citeturn38view7turn39view2  
- Special title numbers are defined: “Top Menu” is `0`, and “First Play” is `0xffff`. citeturn38view5turn39view2  
- Applications can invoke a top menu call with `bd_menu_call(bd, pts)` and must provide current playback position for resuming. citeturn39view2

This gives an implementer a highly actionable model: *disc insert → parse index → start First Play → transition to Top Menu on request*.

### Comparison table: HDMV vs BD-J

| Dimension | HDMV | BD-J |
|---|---|---|
| Runtime model | Deterministic command sequences (“movie objects”) with register state and limited opcodes (branch/compare/set/system-set). citeturn11view0turn11view2turn21view1 | Java Xlet application model with JVM, security sandbox, signing/authentication, and richer APIs. citeturn26view0turn26view4 |
| State | GPR/PSR register file; tooling documentation states 4096 GPRs, 128 PSRs; implementations expose PSRs for menu page/button IDs, streams, etc. citeturn33view2turn33view3turn8view7turn8view3 | Application-managed state, with access-controlled storage (system + optional local storage) and broader lifecycle state. citeturn26view0 |
| Graphics/menu output | Interactive Graphics (page/button/effects model) plus Presentation Graphics; libbluray exposes compressed YUV overlays for HDMV menus/subtitles. citeturn12view1turn39view2turn26view7 | Java graphics plane output; libbluray notes BD-J outputs only ARGB graphics; callbacks may occur from Java VM threads. citeturn39view2turn26view0 |
| Interactivity complexity | Button-driven navigation, page transitions, enable/disable buttons, pop-up menu toggling, timers, stream selection; no general-purpose computation beyond provided ops. citeturn11view2turn18view1turn12view1 | General-purpose programming within BD-J platform constraints; can respond to diverse events, networked content, storage binding. citeturn26view0 |
| Authoring implications | Authoring hinges on building IGS assets (pages, BOGs, state objects, nav commands) and movie object scripts; ecosystem for creation is narrower and more “format-close”. citeturn32view0turn33view5turn21view1 | Requires Java application authoring, signing, and platform-specific testing; more tools/skills but also more overhead. citeturn26view0turn37view8 |
| Deployment/runtime deps | No JVM requirement; fits hardware players with predictable behaviour. citeturn11view0turn39view2 | JVM integration required; real-world players may warn/fallback when Java missing, as seen in VLC’s BD-J handling logic. citeturn37view8turn37view2 |

## HDMV runtime and programming model

This section is written as an implementer-facing “how it actually runs” model, anchored in publicly visible structures and reference implementation behaviour.

### Execution model: registers, instruction words, and event emission

[REVERSE-ENGINEERED] `MovieObject.bdmv` is parsed by libbluray as a signature/versioned binary. It expects:

- signature `MOBJ` and a version signature (`0200` or `0100` in the parser),  
- an `extension_data_start` pointer field (non-zero triggers “unknown extension data” logging),  
- a fixed command format: each command is **12 bytes** and is decoded as a packed instruction header plus 32-bit `dst` and 32-bit `src` operands. citeturn21view1turn21view2turn20view1

The instruction header includes fields like operand count, instruction group/subgroup, “immediate operand” flags, and per-group option fields (branch/cmp/set). This is the core of the HDMV “bytecode” you would reimplement in Rust. citeturn21view1

[REVERSE-ENGINEERED] Instruction groups and opcodes (as implemented) are small and strongly enumerable:

- Groups: `BRANCH`, `CMP`, `SET`. citeturn11view0  
- BRANCH subgroups include `GOTO` (NOP/GOTO/BREAK), `JUMP` (jump/call object/title, resume), and `PLAY` (play playlist, seek to playitem/playmark, terminate, link playitem/mark). citeturn11view0  
- SETSYSTEM includes operations that bridge HDMV logic into playback and menu runtime: `SET_STREAM`, `SET_NV_TIMER`, `SET_BUTTON_PAGE`, `ENABLE_BUTTON`, `DISABLE_BUTTON`, `SET_SEC_STREAM`, `POPUP_OFF`, `STILL_ON`, `STILL_OFF`, `SET_OUTPUT_MODE`, plus additional values. citeturn11view2

[REVERSE-ENGINEERED] Rather than directly “doing playback,” a VM in libbluray surfaces HDMV execution as **events**. The VM emits events for:

- playback control (`TITLE`, `PLAY_PL`, `PLAY_PI`, `PLAY_PM`, `PLAY_STOP`, `STILL`), and  
- graphics-controller directives (`SET_BUTTON_PAGE`, `ENABLE_BUTTON`, `DISABLE_BUTTON`, `POPUP_OFF`). citeturn19view1

This event-driven split is a key architectural lesson for a Rust `libhdmv`: **HDMV logic should not be fused to the demux/decode pipeline**; it should emit an explicit “what to do next” contract.

### State model: GPR/PSR and user operation masks

[AUTHORITATIVE DOC + REVERSE-ENGINEERED] Tooling documentation for interactive menu authoring describes:

- GPR: 32-bit unsigned variables, **4096 total**. citeturn33view2  
- PSR: 32-bit unsigned status variables, **128 total**, with named meanings like Interactive Graphics stream number, Primary audio stream number, and composite PG/TextST stream selections. citeturn33view3  

This matches libbluray’s implementation constants (`BD_GPR_COUNT 4096`, `BD_PSR_COUNT 128`) and its PSR enum naming (e.g., `PSR_IG_STREAM_ID`, `PSR_PRIMARY_AUDIO_ID`, `PSR_MENU_PAGE_ID`, `PSR_SELECTED_BUTTON_ID`). citeturn8view7turn8view3turn15view4turn15view5

[REVERSE-ENGINEERED] Control over “allowed user actions” (UO masks) appears at multiple layers:

- The HDMV VM header defines UO mask flags such as `HDMV_MENU_CALL_MASK` and `HDMV_TITLE_SEARCH_MASK`. citeturn19view3  
- The public API defines UO mask flags (`BLURAY_UO_MENU_CALL`, `BLURAY_UO_TITLE_SEARCH`) and exposes them as event flags. citeturn38view5turn38view3  
- Interactive pages include a per-page UO mask table; the IG decoder reads it as part of page parsing. citeturn12view1  

For Rust design, this points toward first-class, strongly typed “capability masks” that gate menu call/title search and other operations.

### Interactive Graphics: pages, buttons, effects, timeouts, and navigation commands

[AUTHORITATIVE DOC] Blu-ray’s Interactive Graphics stream is explicitly described as supporting always-on menus, multi-page menus, and dynamic button enable/disable. Timing can be frame accurate when multiplexed with video because PTS/DTS timestamps determine when the menu appears/disappears. citeturn26view6turn26view5

[REVERSE-ENGINEERED] libbluray’s IG decoder reveals a concrete object model you can reproduce:

- An “interactive composition” begins with a declared `data_len`, then reads `stream_model` and `ui_model`. For some stream models, it includes `composition_timeout_pts` and `selection_timeout_pts` (33-bit PTS-like fields), plus a `user_timeout_duration`. citeturn12view1  
- It contains `num_pages`, each parsed as:
  - `id` and `version`
  - a `uo_mask_table`
  - `in_effects` and `out_effects`, each an effect sequence that includes windows and multiple effects (composition objects)
  - `animation_frame_rate_code`
  - default selected and activated button references
  - a palette reference (`palette_id_ref`)
  - `num_bogs` (button overlap groups) and their contents. citeturn12view1

This aligns with how the graphics controller consumes and maintains menu state: it reads `PSR_MENU_PAGE_ID` / `PSR_SELECTED_BUTTON_ID`, finds pages and buttons, applies defaults, resets animations, and uses “in/out effects” during page transitions. citeturn14view3turn15view4turn15view5

[AUTHORITATIVE DOC + DE FACTO PRACTICE] An authoring-facing view in the IGEditor manual makes the menu model even more implementable:

- Menus are built from **pages** containing **Button Groups (BOGs)**, and each button has **three states** (normal, activated, selected), typically implemented as state-specific objects referencing images and palette entries. citeturn33view4turn33view5turn32view0  
- The tool explicitly supports editing “navigation commands” attached to buttons and editing `sound.bdmv` button sound effects. citeturn32view0turn39view2  

From an engine perspective, this suggests HDMV interactivity is best modelled as:

- a **page-based state machine**,  
- driven by **focus navigation** (directional keys / mouse selection),  
- with **button activation** triggering navigation command sequences, and  
- optionally decorated by **animated effects** and **timers**.

### Presentation Graphics: bitmap overlays, palettes, and timings

[AUTHORITATIVE DOC] Presentation Graphics streams provide non-interactive images for frame-accurate overlay on video and are envisaged primarily for subtitles and other animated graphics during playback, in both HDMV and BD-J modes. citeturn26view7

[REVERSE-ENGINEERED] In FFmpeg’s reference decoder, PGS is modelled as a segment stream with:

- `PALETTE_SEGMENT = 0x14`  
- `OBJECT_SEGMENT = 0x15` (RLE bitmap payload)  
- `PRESENTATION_SEGMENT = 0x16` (composition/presentation state)  
- `WINDOW_SEGMENT = 0x17`  
- `DISPLAY_SEGMENT = 0x80` (display update boundary) citeturn31view0turn30view5

Palette segments allow up to **256 colours**, and RLE data is decoded into a paletted bitmap surface. citeturn30view9turn30view6

[AUTHORITATIVE DOC] The Blu-ray white paper describes graphics stream composition more generally in terms of composition segments and palette usage, including cropping transforms for effects and transitions realised by multiple composition segments. citeturn26view8turn2view2

### Rendering contract: compressed YUV overlays vs ARGB overlays

[REVERSE-ENGINEERED] libbluray’s public API formalises two overlay output routes:

- **Compressed YUV overlays** are used for “presentation graphics (subtitles) and HDMV mode menus,” and the callback is invoked from the application thread context while `bd_*()` functions are called. citeturn39view2  
- **ARGB overlays** are used for BD-J menus; the callback “can be called at any time by a thread created by Java VM.” citeturn39view2  

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
        |                                      |  citeturn39view2
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

This is the layered model your Rust crate can preserve almost directly, with the VM and graphics controller emitting explicit events instead of performing playback/rendering internally. citeturn19view1turn18view1turn12view1turn39view2

## Authoring workflows and ecosystem survey

### How HDMV menus were created commercially

[DE FACTO PRACTICE + AUTHORITATIVE DOC] Complex commercial Blu-ray authoring historically relied on high-end proprietary toolchains; the practical evidence available publicly tends to surface in the “ecosystem edges” (format-close editor manuals and integration notes) rather than open specs. The IGEditor manual demonstrates a professionalised workflow around:

- editing compiled/demuxed Interactive Graphics stream files (`*.ies`),
- importing/exporting projects compatible with entity["organization","Sonic Scenarist BD","blu-ray authoring software"] (including Scenarist “Designer” files),
- palette calculation/optimisation for button artwork,
- per-button navigation command editing,
- button sound authoring via editing `sound.bdmv`. citeturn32view0turn33view5  

While IGEditor is not itself a Blu-ray spec, it is a *high-signal artefact* showing what real-world HDMV authoring requires at the data-structure level (pages → BOGs → per-state objects + palette + commands). citeturn32view0turn33view5

### What exists today in open-source and Linux-compatible tooling

[DE FACTO PRACTICE] The open-source ecosystem strongly favours muxing/remuxing and basic structure generation over authored interactive menus:

- The tsMuxer project presents itself as a “transport stream muxer for remuxing/muxing elementary streams,” listing codec/container support and muxing features, but not HDMV menu authoring as a first-class capability. citeturn34search26  
- A direct feature request asks to “Add menu creation to Blu-ray discs,” reflecting that end users perceive menu creation as missing/non-trivial in tsMuxer-centric workflows. citeturn34search1  

This matches a long-standing pattern: open tools can build playable “BDMV folders” without interactive menus, but HDMV menu authoring is specialised, format-close work.

### Playback/navigation reference implementations and best codebases to study

[REVERSE-ENGINEERED] For a Rust implementer, libbluray is the single most valuable reference because it covers:

- disc index parsing and title modelling (HDMV vs BD-J) citeturn25view0turn24view6  
- MovieObject parsing and instruction decoding citeturn21view1turn11view0  
- HDMV VM event emission citeturn19view1  
- IG decode into pages/BOGs/buttons/effects/timeouts citeturn12view1  
- graphics controller message model (user input + VM control + TS decode) citeturn18view1  
- overlay output contracts (compressed YUV vs ARGB) and user input APIs. citeturn39view2turn38view4  

[DE FACTO PRACTICE] VLC’s Blu-ray module shows how a mainstream desktop player integrates libbluray and where real-world constraints appear:

- It explicitly checks for BD-J capability and falls back to non-menu playback when BD-J can’t be handled, including a user-facing “Java required” dialog. citeturn37view8turn37view2  
- It maintains overlay abstractions and distinguishes overlay planes, matching libbluray’s overlay model. citeturn37view6turn39view2  

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

- Parsing: `index.bdmv`, `MovieObject.bdmv`, and enough MPLS/CLPI structure to resolve “what would play” and to identify IG/PG stream PIDs. (The white paper emphasises playlists/clips as core playback structure; libbluray’s APIs expose playlist/title selection and navigation-mode reads.) citeturn26view9turn39view2turn38view6  
- VM: evaluate MovieObject command sequences and produce explicit “next actions” (play title/playlist, seek playitem/mark, still mode, menu directives), matching the event model. citeturn19view1turn11view0  
- Graphics decode: decode IGS into a menu scene model (pages/buttons/effects/timeouts) and decode PGS to overlay surfaces (for subtitles and some menu elements), matching known segment structures and time bases. citeturn12view1turn31view0turn26view7  
- Rendering: provide an abstraction and at least one reference renderer that composites paletted overlays into RGBA buffers.

Explicitly *out of scope* for `libhdmv` v1:

- BD-J runtime implementation (but you may provide integration hooks). The overlay threading and JVM dependency are explicitly different. citeturn39view2turn37view8  
- DRM/decryption (AACS/BD+). Even libbluray models these as error conditions rather than implementing them in the navigation API. citeturn38view5turn39view2  
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

This separation mirrors the boundary that libbluray exposes publicly: data parsing → VM → graphics decode → overlay output. citeturn21view1turn19view1turn12view1turn39view2

### Strongly typed modelling targets

[INFERENCE, motivated by real structures] The following types should be newtypes/enums in Rust rather than raw integers:

- `TitleId` (including reserved values for Top Menu and First Play) citeturn38view5turn39view2  
- `PlaylistId`, `PlayItemId`, `PlayMarkId` (because VM events distinguish play playlist vs seek playitem vs seek playmark) citeturn19view1  
- `PageId`, `ButtonId`, `BogId` (because PSRs and IGS structures index by these) citeturn12view1turn33view5turn15view4  
- `Pts90k` wrapper (because user input APIs and effects timers are in 1/90000s time base) citeturn38view4turn12view1  
- `UoMask` bitflags (menu call/title search and page UO mask tables) citeturn19view3turn38view5turn12view1  

### Public API shape for reuse

The “least regret” API is a **session-based state machine** that can be driven by tests, CLIs, GUIs, or a plugin wrapper.

A plausible high-level API contract:

- `Disc::open(source)` → parse index, locate metadata, expose title list and entry points.
- `NavSession::start_first_play()` → start VM + navigation.
- `NavSession::step(now_pts)` → advance VM, handle timeouts/effects, produce events.
- `NavSession::submit_input(input, now_pts)` → update focus/activation and produce effects.
- `NavSession::render(target)` → optional: produce RGBA overlay frames or drawing ops.

This mirrors how libbluray’s navigation mode works: `bd_read_ext` returns zero when an “event needs to be handled first,” and user input functions accept an explicit PTS in 90 kHz units. citeturn39view2turn38view4

### Error model and versioning

[REVERSE-ENGINEERED + INFERENCE] Use a layered error system:

- **Parse errors**: signature/version mismatch (e.g., index expects `INDX0100`/`INDX0200` in libbluray; mismatches are observed in the wild and logged by implementations) and length checks. citeturn24view1turn24view6  
- **Unsupported feature errors**: unknown “extension data” offsets, unknown opcode values, unimplemented set-system variants. citeturn21view1turn11view2  
- **Runtime errors**: VM invalid state, illegal page/button references, missing stream PIDs.
- **Environment errors**: encrypted content (AACS/BD+) or BD-J required paths/permissions, surfaced explicitly rather than “mysterious failures.” citeturn38view5turn39view2  

Versioning recommendation: semantic versioning at the “umbrella crate” (`libhdmv`) with internal crates allowed to move faster, and a clearly documented stability policy for exposed structs that may need to evolve as more discs are tested.

### Authoring architecture proposal

Authoring is substantially larger than playback. The evidence from ecosystem tools is that even muxers that can generate BDMV structure do not generally implement menu authoring. citeturn34search26turn34search1

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

This is consistent with the artefacts surfaced by IG authoring tooling (per-state objects, palette recalculation, nav commands, `sound.bdmv`) and with the runtime contract that IGS can be multiplexed and timed via PTS/DTS. citeturn32view0turn26view6turn39view2

## Tauri v2 plugin design proposal and phased roadmap

### Plugin framing and responsibility split

[AUTHORITATIVE DOC] Tauri v2 plugins are composed of a **Cargo crate** and an **optional NPM package** providing JS bindings for commands/events; they can additionally include mobile components. This makes it natural to keep nearly all HDMV logic in a reusable Rust crate and expose a thin, permissioned command/event surface via the plugin. citeturn36search1

[AUTHORITATIVE DOC] Tauri’s v2 security model uses **capabilities and permissions** to constrain what is exposed to the WebView frontend; permissions can enable/deny commands and map scopes to commands. For a plugin that reads disc images and large media structures, you want this as a first-order design input, not an afterthought. citeturn36search31turn36search6turn36search2

**Responsibility split (recommended)**

- `libhdmv` (core crate): parsing, VM, IGS/PGS decode, menu state machine, renderer abstraction.
- Plugin crate: session lifecycle, file access mediation, caching, streaming events to frontend, permission + scope enforcement.

### Plugin surface area proposal

A Tauri plugin should avoid per-frame raw video/overlay streaming unless the UI is specifically a preview tool, because moving full-resolution frames over the Rust/JS boundary is costly. A better default is to expose:

- **Structural inspection** APIs (titles, playlists, streams, menu pages/buttons, command traces).
- **Menu preview** at controlled cadence (e.g., render-on-demand or fixed low FPS), suitable for authoring/inspection tools.
- **Event trace** and **deterministic replay** primitives for debugging.

[AUTHORITATIVE DOC] On the Tauri side, commands are registered via a single `generate_handler!` call, and the command system is a core primitive for backend invocation. citeturn36search4turn36search0

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

This roughly matches the public libbluray interaction model: you drive navigation with explicit PTS (90 kHz), submit user input, consume queued events, and receive overlay outputs through a well-defined contract. citeturn38view4turn38view3turn39view2

### Data movement across Rust/JS boundary

[INFERENCE, constrained by known overlay contracts] Choose among three transport modes, depending on application product goals:

- **Inspection mode**: send JSON-serialisable state snapshots and traces (pages/buttons/current focus) and only render thumbnails on demand.
- **Preview mode**: render overlay frames in Rust and send compressed images (PNG/WebP) at low rate, plus button hit-test rectangles for interactivity.
- **High-fidelity mode**: keep rendering native-side (wgpu/skia) and present via a native window surface; use Tauri primarily as “controller UI” rather than as the renderer.

If you do decide to stream pixels, note that overlays can be paletted + compressed; libbluray supports a compressed YUV overlay callback specifically because it can be optimised (colour conversion, drawing). That is a hint that pixel transport costs matter. citeturn39view2turn14view9

### Security and packaging concerns

[AUTHORITATIVE DOC] Capabilities and permissions should restrict which plugin commands are available to which windows/webviews and under what scopes. This is directly relevant when reading arbitrary filesystem paths for disc folders/ISOs. citeturn36search31turn36search6

[AUTHORITATIVE DOC] When additional non-frontend files must ship with the app (e.g., sample fixtures, font caches for TextST previews, small reference assets), Tauri treats these as “resources” and provides guidance on embedding additional files in the bundle. citeturn36search16

### Phased implementation roadmap

This roadmap explicitly separates “must implement” from “nice to have,” and assumes the project goal is an open-source Rust ecosystem, not a monolithic player.

**v1: parser/inspector foundation (high confidence)**  
Must implement:
- `index.bdmv` parsing with title/object type modelling and access flags. citeturn25view0turn24view3  
- `MovieObject.bdmv` parsing: signature/version, object flags, command decoding (12-byte records). citeturn21view1turn20view3  
- Instruction enum model mirroring BRANCH/CMP/SET/SETSYSTEM groups. citeturn11view0turn11view2  
- CLI that prints: titles, first play/top menu mapping, object command dumps, and basic consistency checks.

Nice to have:
- partial MPLS/CLPI parse sufficient to map playlists to stream names (for inspection).

**v1.1: HDMV VM + deterministic event model (medium confidence)**  
Must implement:
- register file (GPR/PSR), including key PSRs for menu page/button IDs. citeturn8view7turn15view4  
- VM executor that emits events analogous to `HDMV_EVENT_*` (play title/playlist, seeks, still, menu directives). citeturn19view1  
- trace/replay harness for VM execution using golden fixtures.

Nice to have:
- user operation mask propagation.

**v1.2: IGS/PGS decode and render abstraction (medium-to-high confidence)**  
Must implement:
- IGS decode into pages/BOGs/buttons/effects/timeouts (minimum needed to show menus and respond to selection). citeturn12view1turn32view0  
- PGS decode (or reuse a decoder) for subtitle plane overlays; at minimum support the segment types and paletted RLE decode path. citeturn31view0turn30view6  
- CPU reference compositor producing RGBA output.

Nice to have:
- effect and animation fidelity (in/out effects, frame rate codes).

**v1.3: menu preview engine (product-grade for tooling)**  
Must implement:
- focus navigation, activation, page transitions, enable/disable button behaviour, pop-up toggling. citeturn11view2turn18view1turn26view5  
- button hit testing (`mouse_select` equivalent) and key input mapping. citeturn38view4turn18view1  

**v2: authoring (only if demanded)**  
Must implement:
- minimal IG authoring model + compiler for trivial menus
- generation of `sound.bdmv` entries and consistent palette/object sets (as implied by authoring tooling) citeturn32view0turn39view2  
- robust BDMV metadata generation (index/movie objects/playlists) with compatibility tests.

### Validation strategy

Because distributing commercial disc assets is legally fraught, validation should rely on a mix of synthetic fixtures and user-provided discs in local test runs.

**Fixture strategy (repo-safe)**  
- Generate minimal BDMV folders using muxers that can output basic structure (without menus), then add your own small `MovieObject.bdmv` fixtures and synthetic IGS/PGS streams. The absence of menu creation in common muxers is precisely why synthetic fixtures are valuable. citeturn34search26turn34search1  
- Include tiny, self-authored PGS display sets to test palette/object/presentation/window/display segment parsing (segment types and codes are well defined in decoder references). citeturn31view0turn30view5  

**Behavioural comparison (local-only, not redistributed)**  
- Compare VM event traces and overlay outputs against libbluray via controlled runs: libbluray exposes an event queue (`bd_get_event`) and a navigation read API that returns when events need handling. citeturn38view3turn39view2  
- For menu interactions, record sequences of inputs (keys/mouse) and compare resulting focus/button states and rendered overlays (hashes or perceptual diffs). libbluray explicitly supports mouse selection and user input with PTS. citeturn38view4turn39view2  

**Golden tests**  
- “Golden JSON” for parsed structures (index, movie objects, decoded pages/buttons)  
- “Golden trace” for VM execution (instruction-by-instruction, PSR/GPR changes)  
- “Golden image” for composited overlays for deterministic IGS/PGS samples

## Risks, unknowns, and annotated bibliography

### Risks and hardest unknowns

**Spec access gap (high impact)**  
The complete Blu-ray Disc specifications that formally define HDMV/IGS behaviour are not generally publicly accessible. The Blu-ray white paper is authoritative but explicitly notes that specifications were not finalised at the time and may be modified; therefore, some semantics must be treated as best-effort, validated against reference implementations. citeturn26view0

**Version drift in control files (medium-high impact)**  
Index parsing in libbluray expects particular signature versions (e.g., `INDX0100`/`INDX0200`), and real-world logs show signature mismatches exist. Your Rust parser should be defensive: accept multiple known versions, and surface unknown ones as structured warnings rather than hard failures where possible. citeturn24view1turn25view0

**IGS behavioural fidelity (medium-high impact)**  
Even with a decoded page/button model, correct behaviour depends on subtle rules: default button selection resolution, enable/disable interaction, effect timing, and how PSRs drive state restoration. libbluray’s graphics controller code indicates non-trivial state management around `PSR_MENU_PAGE_ID` and `PSR_SELECTED_BUTTON_ID`. citeturn14view3turn15view5turn12view1

**BD-J scope creep (high impact)**  
BD-J differs sharply: ARGB overlay output, Java VM threads, network/storage/security permissions. VLC’s behaviour demonstrates user-visible dependency on Java availability for BD-J menus, reinforcing that BD-J support should be a separate milestone (or delegated to libbluray/OpenJDK integration) rather than blended into initial HDMV goals. citeturn37view8turn39view2turn26view0

**DRM/legality constraints (high impact for “disc playback”)**  
Commercial disc playback is dominated by AACS/BD+ constraints. libbluray models these as error categories (`BD_ERROR_AACS`, `BD_ERROR_BDPLUS`) and surfaces “encrypted” conditions in events. A Rust `libhdmv` should plan for decrypted inputs first and treat DRM as out of scope. citeturn38view5turn39view2

### Final judgement

**Is HDMV a good target for a new Rust library?**  
Yes—*if the project is framed as navigation/menu decoding and preview, not as a full commercial Blu-ray player*. The HDMV surface area is bounded and strongly evidenced by open implementations: instructions are enumerable, control files are structured binaries, and the graphics model is decodable into a concrete scene representation. citeturn11view0turn21view1turn12view1turn39view2

**Where can it provide unique value?**  
A Rust-native implementation can differentiate on: safety (no UB), fuzz-hardening for parsers, strongly typed state machines, and ergonomic integration surfaces for modern desktop tooling (inspectors, menu previewers, validation/lint tools). The open ecosystem currently has clear gaps around authored-menu tooling and reusable, testable HDMV engines. citeturn34search1turn34search26

**Should the Tauri plugin be the product surface or an integration layer?**  
Treat the plugin as a **thin integration layer**. Tauri v2’s plugin model (crate + optional NPM bindings) aligns well with keeping the substantive logic in `libhdmv` and exposing only the commands/events needed by the UI. The security/capabilities system further rewards a narrow plugin surface area for filesystem-heavy workloads. citeturn36search1turn36search31turn36search6

### Recommended next steps

1. **Write a SPEC.md-style “behavioural contract”** for your Rust engine modelled on the event split:
   - parse → VM events → player actions → graphics decode → overlay output,
   - explicitly define the time base (90 kHz), input model, and expected event ordering. citeturn19view1turn38view4turn39view2  

2. **Implement `bdmv-parse` + `hdmv-insn` first**, with a JSON inspector CLI and golden fixtures:
   - focus on `index.bdmv` and `MovieObject.bdmv` signatures, versions, length checks, and complete command decoding. citeturn24view1turn21view1turn11view0  

3. **Add a minimal VM that emits events** (no graphics yet), and verify against synthetic MovieObject fixtures and local libbluray traces. citeturn19view1turn38view3  

4. **Bring up IGS decode + rudimentary renderer**, initially targeting only:
   - pages, BOGs, default selected button, and static state images,
   - then expand into effects and timeouts. citeturn12view1turn32view0turn26view5  

5. **Design the Tauri plugin only after `libhdmv` has a stable session API**, and incorporate permissions/capabilities from the start. citeturn36search1turn36search6turn36search31  

### Annotated bibliography and source list

**entity["organization","Blu-ray Disc Association","optical disc industry org"] — “BD-ROM Audio Visual Application” white paper (March 2005).**  
Authoritative early documentation of HDMV/BD-J concepts, graphics stream roles, and menu capabilities (always-on menus, multi-page menus, dynamic button enable/disable) and BD-J platform features (security model, storage, networking). Also explicitly describes Presentation Graphics as a frame-accurate overlay stream available in both modes, and ties interactive graphics visibility to PTS/DTS when multiplexed. citeturn26view6turn26view7turn26view0turn26view5turn26view8

**entity["organization","AACS LA","digital rights management consortium"] — AACS “Blu-ray Disc Recordable Book” excerpts showing BDMV directory structure and encryption notes.**  
Useful for confirming canonical directory structure and clarifying that, at least for recordable media, BDMV application structure is defined with clear separation between metadata and AV streams. citeturn22search12

**libbluray source code (HDMV VM, parsers, IG/PG decoders, public API).**  
Primary behavioural reference for implementers: enumerated instruction sets and system commands; file signatures/versions and command decoding layout; VM event model; IG decode structures (pages/BOGs/effects/timeouts); and overlay output contracts distinguishing HDMV (compressed YUV) from BD-J (ARGB + JVM threads). citeturn11view0turn11view2turn21view1turn19view1turn12view1turn39view2turn38view4turn25view0turn24view1

**entity["organization","FFmpeg","multimedia framework"] — PGS subtitle decoder documentation/source.**  
Concrete, implementable definition of PGS segment types and codes (palette/object/presentation/window/display), plus the RLE + 256-entry palette model that informs your overlay pipeline and fixture generation. citeturn31view0turn30view6turn30view9

**entity["company","DVDLogic Software","software vendor"] — IGEditor manual (2009–2010).**  
Authoring-oriented evidence: menus as pages with button overlap groups; three-state button imagery; palette recalculation; navigation command editing; and direct mention of `sound.bdmv` editing plus integration with Sonic Scenarist BD, showing what practical HDMV authoring entails even when tools are proprietary. Also explicitly states register counts (4096 GPR, 128 PSR). citeturn32view0turn33view2turn33view3turn33view5

**tsMuxer repository and issue tracker.**  
Shows the open-source ecosystem’s emphasis on muxing/structure generation and the practical demand for (but absence of) Blu-ray menu creation in common workflows. citeturn34search26turn34search1

**VLC Blu-ray module (`modules/access/bluray.c`).**  
Demonstrates real-world integration and UX constraints: BD-J menu support depends on Java availability and may fall back to non-menu playback; also reflects overlay-plane abstractions consistent with libbluray’s output model. citeturn37view8turn37view6turn37view2

**entity["organization","Tauri","app framework"] v2 documentation: plugin development + security (capabilities/permissions) + calling Rust.**  
Defines the correct wrapper architecture for a plugin surface (crate + optional NPM bindings), and the security primitives (permissions/capabilities) that should constrain disc/ISO access and command exposure for a filesystem-heavy plugin. citeturn36search1turn36search31turn36search6turn36search4turn36search16