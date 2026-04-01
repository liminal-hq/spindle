# Spindle Blu-ray & UHD Blu-ray Integration Plan

## Status of existing infrastructure

### What already exists

**libhdmv** (`liminal-hq/libhdmv`) — 9 crates, 98 tests, production-ready:

- Full BDMV binary parsing & writing (index.bdmv, MovieObject.bdmv, MPLS, CLPI, sound.bdmv)
- HDMV instruction decode/encode/disassemble
- VM execution with event emission (4096 GPRs, 128 PSRs, 100K step limit)
- IGS/PGS decode, encode, RLE compression
- Menu scene navigation (focus, activation, page transitions, popups)
- CPU renderer producing RGBA overlay frames
- `DiscBuilder` high-level authoring API (creates full BDMV directory structure with BACKUP mirroring)
- UHD BD types from day one (HEVC 0x24, V2160p, HDR10, Dolby Vision in data models)
- 1 minor TODO: `PlayPlPi` doesn't extract play_item_id from second operand

**tauri-plugin-hdmv** (`liminal-hq/tauri-plugin-workspace/plugins/hdmv`) — 14 Tauri commands:

- Session lifecycle (open/close disc)
- Disc inspection (info, titles, playlists, playlist detail)
- Navigation (start, load scene, send key, mouse move/click)
- Rendering (preview as base64 PNG, menu state snapshot)
- Authoring (build disc from config)
- TypeScript bindings (`@liminal-hq/plugin-hdmv`)

**Spindle** (`liminal-hq/spindle`) — DVD-Video authoring complete:

- Shared project model with `disc.family` field (currently `DvdVideo` only)
- Full DVD pipeline: inspect → plan → transcode → render menus → author → ISO
- Architecture already designed for pluggable format backends (per `dvd_bd_architecture_note.md`)
- HDR detection in asset inspection (color_transfer, color_primaries, dolby_vision_profile)

### What does NOT exist yet

These are the gaps between "DVD works" and "Blu-ray works":

1. **No BD format backend in Spindle** — no `DiscFamily::BlurayDisc` or `UhdBluray` variants
2. **No BD capacity targets** — missing BD-25, BD-50, BD-66, BD-100
3. **No BD video output profiles** — missing H.264/HEVC rasters, HD/UHD frame rates
4. **No BD audio targets** — missing DTS-HD MA, TrueHD, LPCM (BD), AC-3 (BD)
5. **No BD planner** — no BD bitrate limits, no mandatory AC-3 fallback logic
6. **No BD build pipeline** — no M2TS muxing, no BDMV structure generation, no BD ISO
7. **No BD menu compilation** — can't compile Spindle menu model → IGS segment stream
8. **No PGS subtitle pipeline** — can't convert text/bitmap subs → PGS streams
9. **No BD validation rules** — no stream compliance, mandatory track, or structure checks
10. **No tsMuxeR integration** — needed for M2TS transport stream muxing
11. **No tauri-plugin-hdmv integration in Spindle** — plugin exists but isn't consumed

---

## Implementation plan

### Phase 1 — Shared model extensions (Spindle)

**Goal:** Extend the project schema so users can create BD/UHD projects without any build capability yet.

#### 1.1 — DiscFamily and capacity targets

Extend `models.rs`:

```
DiscFamily::BlurayDisc
DiscFamily::UhdBluray

CapacityTarget::Bd25   // 25 GB
CapacityTarget::Bd50   // 50 GB
CapacityTarget::Bd66   // 66 GB (UHD)
CapacityTarget::Bd100  // 100 GB (UHD)
```

Add `CapacityTarget::is_bd()`, `is_uhd()` helpers. Update `capacity_bytes()` and `label()`.

#### 1.2 — Video standard for BD

BD doesn't use NTSC/PAL in the same way. Add frame rate model:

```
VideoFrameRate::Fps23_976
VideoFrameRate::Fps24
VideoFrameRate::Fps25
VideoFrameRate::Fps29_97
VideoFrameRate::Fps50     // BD only
VideoFrameRate::Fps59_94  // BD only
```

For BD projects, `VideoStandard` becomes less relevant — replace with `VideoFrameRate` selection at the title level or keep `VideoStandard` for DVD and add BD-specific frame rate handling.

#### 1.3 — BD video output profiles

Add BD-legal video profiles:

```
BdVideoProfile {
    codec: BdVideoCodec,     // H264, Hevc
    resolution: BdResolution, // 1080p, 1080i, 720p, 2160p (UHD)
    frame_rate: VideoFrameRate,
    hdr: Option<HdrMetadata>,
}

BdVideoCodec::H264   // BD mandatory
BdVideoCodec::Hevc   // UHD BD
BdVideoCodec::Vc1    // BD optional (legacy, low priority)

BdResolution::R1080p
BdResolution::R1080i
BdResolution::R720p
BdResolution::R2160p  // UHD only

HdrMetadata {
    transfer: HdrTransfer,  // Sdr, Hdr10, Hlg, DolbyVision
    primaries: ColourPrimaries, // Bt709, Bt2020
    // HDR10 static metadata
    max_cll: Option<u32>,
    max_fall: Option<u32>,
    display_primaries: Option<DisplayPrimaries>,
    // Dolby Vision
    dv_profile: Option<u8>,
    dv_level: Option<u8>,
}
```

#### 1.4 — BD audio output targets

```
BdAudioTarget::Ac3          // Mandatory fallback (always required)
BdAudioTarget::DtsHdMa      // Lossless, optional
BdAudioTarget::TrueHd       // Lossless, optional
BdAudioTarget::Lpcm          // Uncompressed, optional
BdAudioTarget::EAc3          // BD optional
BdAudioTarget::Dts            // Legacy
```

Add mandatory AC-3 fallback rule: if primary audio is lossless, an AC-3 core/fallback track must also exist.

#### 1.5 — BD subtitle model

PGS replaces DVD's VobSub. Extend `SubtitleType`:

```
SubtitleType::Pgs       // BD native bitmap subtitles
SubtitleType::TextSt    // BD text subtitles (rare, low priority)
```

#### 1.6 — Grouping unit abstraction

DVD uses titlesets; BD doesn't. Abstract the grouping:

- DVD: `Titleset` (titles sharing format assumptions)
- BD: Flat title list with per-title playlists

Either add `GroupingUnit` enum or make titlesets DVD-only in the schema, with BD projects using a flat `disc.titles` Vec. The simpler approach: BD projects have a single implicit "titleset" (or none) — the Disc struct gains an optional `titles: Vec<Title>` for BD alongside `titlesets` for DVD.

#### 1.7 — BD menu model extensions

The shared `Menu` model works for both formats at the intent level. Add BD-specific fields:

```
Menu {
    // ... existing fields ...
    // BD-specific (ignored for DVD)
    menu_type: Option<BdMenuType>,  // TopMenu, PopupMenu
    ig_resolution: Option<(u32, u32)>,  // 1920×1080 for BD (vs 720×480 for DVD)
}

BdMenuType::TopMenu   // Full-screen, replaces video
BdMenuType::PopupMenu // Overlay on top of video playback
```

#### 1.8 — Schema version bump

Bump `SCHEMA_VERSION` to 2. Add migration from v1 (all v1 projects are DVD, map directly).

#### 1.9 — Frontend: format selector

Update `CreateProjectRequest` to accept `DiscFamily`. Show format selector at project creation. Conditionally show DVD vs BD options throughout the UI:

- DVD: NTSC/PAL, DVD-5/9, titlesets, VobSub
- BD: Frame rate, BD-25/50, flat titles, H.264/HEVC profiles, PGS
- UHD: BD-66/100, HEVC, HDR metadata editor

---

### Phase 2 — BD compatibility assessment (Spindle)

**Goal:** Imported assets get BD-aware compatibility analysis.

#### 2.1 — BD compatibility classifier

Extend `inspect.rs` to assess assets against BD-legal requirements:

| Property    | BD-legal                           | UHD BD-legal  |
| ----------- | ---------------------------------- | ------------- |
| Video codec | H.264, VC-1, MPEG-2                | HEVC Main 10  |
| Resolution  | 1920×1080, 1280×720                | 3840×2160     |
| Frame rate  | 23.976, 24, 25, 29.97, 50i, 59.94i | + 50p, 59.94p |
| Audio codec | AC-3, DTS, DTS-HD MA, TrueHD, LPCM | Same          |
| Subtitles   | PGS                                | PGS           |

#### 2.2 — BD-aware PropertyCheck

Change `PropertyCheck.dvd_requires` → `format_requires` (generic field name). Populate with BD requirements when `disc.family` is BD.

#### 2.3 — HDR compatibility

For UHD BD projects:

- Flag HDR10 sources as compatible (HEVC Main 10 + BT.2020 + SMPTE ST 2084)
- Flag SDR sources as requiring tone-mapping or passthrough
- Detect Dolby Vision RPU metadata presence
- Warn on HLG (not universally supported on UHD BD players)

---

### Phase 3 — BD build planner (Spindle)

**Goal:** Generate a BD build plan (dry-run capable) without executing it.

#### 3.1 — BD capacity planner

Add to `PlannerPage.tsx` and planner backend:

- BD-25: 25,025,314,816 bytes
- BD-50: 50,050,629,632 bytes
- BD-66: 66,000,000,000 bytes (triple layer)
- BD-100: 100,000,000,000 bytes (quad layer, UHD)
- Max video bitrate: 40 Mbps (BD), 108 Mbps (UHD BD primary), 128 Mbps total
- Mandatory AC-3 fallback overhead calculation

#### 3.2 — BD build plan structure

New `BuildJob` variants:

```
BuildJob::TranscodeTitleBd {
    // H.264 or HEVC encode via FFmpeg
    source_path, output_path, profile, hdr_metadata
}
BuildJob::GenerateAc3Fallback {
    // Downmix lossless primary audio → AC-3 640 kbps
    source_path, output_path
}
BuildJob::MuxM2ts {
    // tsMuxeR: combine video + audio + subs → .m2ts
    video_path, audio_paths, subtitle_paths, output_path
}
BuildJob::CompileIgStream {
    // Menu model → IGS segment bitstream
    menu_definitions, output_path
}
BuildJob::RenderPgsSubtitles {
    // Text/bitmap subs → PGS stream
    source_path, output_path
}
BuildJob::AuthorBdmv {
    // Generate index.bdmv, MovieObject.bdmv, MPLS, CLPI via libhdmv DiscBuilder
    config, output_path
}
BuildJob::GenerateBdIso {
    // UDF 2.50 (BD) or UDF 2.60 (UHD BD) ISO image
    bdmv_path, output_path
}
```

#### 3.3 — BD working directory layout

```
<output>/
├── _spindle_work/
│   ├── elementary/     # Raw encoded video/audio streams
│   ├── m2ts/           # Muxed transport streams
│   ├── subtitles/      # PGS subtitle streams
│   ├── menus/          # IGS compiled streams
│   └── bdmv_author.json  # Serialised DiscBuilder config
├── BDMV/
│   ├── index.bdmv
│   ├── MovieObject.bdmv
│   ├── PLAYLIST/       # *.mpls
│   ├── CLIPINF/        # *.clpi
│   ├── STREAM/         # *.m2ts
│   ├── AUXDATA/        # sound.bdmv
│   └── BACKUP/         # Mirrors of index, mobj, playlist, clipinf
├── CERTIFICATE/        # BD-ROM certificates (if applicable)
└── [project-name].iso
```

---

### Phase 4 — BD build execution (Spindle)

**Goal:** Execute the BD build plan end-to-end.

#### 4.1 — tsMuxeR integration

Add tsMuxeR as a sidecar tool alongside FFmpeg. tsMuxeR handles:

- Muxing elementary streams → M2TS transport stream containers
- Setting correct PID assignments
- Injecting SEI messages for HDR10

Tool adapter: `build/tsmuxer.rs`

- Command construction from `MuxM2ts` job parameters
- Meta file generation (tsMuxeR's native config format)
- Progress parsing from stdout
- Error classification

#### 4.2 — BD video transcoding

Extend `build/ffmpeg.rs` with BD profiles:

**H.264 (standard BD):**

- `libx264` encoder, High Profile @ L4.1
- Max 40 Mbps video bitrate
- 1920×1080 or 1280×720 output
- Bluray-compat flags: `bluray-compat=1`, `nal-hrd=vbr`, `slices=4`

**HEVC (UHD BD):**

- `libx265` encoder, Main 10 Profile @ L5.1
- Max 108 Mbps video bitrate (82 Mbps practical target)
- 3840×2160 output
- HDR10 metadata passthrough: `--master-display`, `--max-cll`, `--colorprim bt2020`, `--transfer smpte2084`

#### 4.3 — BD audio pipeline

Extend `build/ffmpeg.rs`:

- **AC-3 fallback generation:** Downmix from lossless source, 640 kbps, 5.1 channel layout
- **DTS-HD MA passthrough:** Copy if source is DTS-HD MA; extract core DTS for fallback
- **TrueHD passthrough:** Copy if source is TrueHD; generate AC-3 fallback
- **LPCM:** Copy or generate from any source (48/96 kHz, 16/24-bit, up to 8 channels)

#### 4.4 — BDMV structure generation

Use `libhdmv::DiscBuilder` (via `tauri-plugin-hdmv` or direct crate dependency) to:

1. Create `DiscBuilder::new(output_path)`
2. For each title: `.add_title(TitleSpec { clip_id, codec_id, duration, streams, chapters })`
3. Set first play and top menu commands
4. `.build()` → writes full BDMV directory structure with BACKUP

**Integration approach:** Add `libhdmv` as a direct Cargo dependency to `tauri-plugin-spindle-project` (not going through the Tauri plugin IPC — that's for the frontend menu preview). The build executor calls libhdmv directly in Rust for BDMV authoring.

#### 4.5 — BD ISO generation

BD ISOs use UDF filesystem:

- Standard BD: UDF 2.50
- UHD BD: UDF 2.60

Tool options:

- `mkudffs` + `genisoimage` with UDF support
- `mkisofs` with `-udf` flag
- Dedicated UDF tool (may need new library — see "Missing libraries" section)

Add `BuildJob::GenerateBdIso` executor using the best available tool.

---

### Phase 5 — BD menu compilation (Spindle + libhdmv)

**Goal:** Compile Spindle's shared menu model into BD-native IGS streams.

This is the most complex phase and requires new authoring capabilities in libhdmv.

#### 5.1 — IGS authoring model (libhdmv)

libhdmv already has IGS decode and basic encode (palette/object segments). Extend with:

- **Menu-to-IGS compiler:** Convert Spindle `Menu` + `MenuButton` → `InteractiveComposition` with pages, BOGs, buttons
- **Button image renderer:** Render button labels/graphics → RLE-compressed bitmap objects
- **Palette generator:** Derive optimal 256-entry palette from button artwork
- **Navigation compiler:** Convert Spindle directional nav → IGS button navigation commands
- **Action compiler:** Convert `PlaybackAction` → HDMV instruction sequences (12-byte commands)

New module in libhdmv: `crates/igs-author/` or extend existing `igs` crate with `author` module.

#### 5.2 — IGS muxing

Compiled IGS segment stream needs to be muxed into the M2TS container on a dedicated PID (typically 0x1200+). tsMuxeR handles this as an additional input stream.

#### 5.3 — BD navigation model

BD navigation differs from DVD:

- No explicit `dvdauthor.xml` equivalent — navigation is compiled into HDMV movie objects
- Movie objects contain bytecode programs (not XML commands)
- First Play → Top Menu → title selection is standard flow
- Popup menus use separate IGS stream multiplexed with video

Extend libhdmv's `DiscBuilder` to accept richer movie object command sequences generated from Spindle's navigation model.

#### 5.4 — Frontend: BD menu editor

Adapt `MenusPage.tsx`:

- Canvas resolution: 1920×1080 (BD) instead of 720×480 (DVD)
- Support popup menu overlay mode (semi-transparent background)
- Button artwork import (PNG/BMP → IGS objects)
- Preview using `tauri-plugin-hdmv` render commands
- Sound effect assignment (sound.bdmv)

---

### Phase 6 — PGS subtitle pipeline

**Goal:** Convert subtitle sources to BD-native PGS format.

#### 6.1 — Text → PGS rendering

Convert SRT/ASS/SSA text subtitles to PGS bitmap streams:

- Render text to bitmap at 1920×1080 (or 3840×2160 for UHD)
- RLE compress each subtitle image
- Generate PGS composition/window/palette/object/end segments with correct PTS timing
- Output as PGS elementary stream (.sup file)

This is a significant piece of work. Options:

1. **Use FFmpeg's PGS encoder** (`-c:s hdmv_pgs_subtitle`) — limited but functional for basic subs
2. **Build in libhdmv** — use existing `pgs` crate's RLE encoder + new composition builder
3. **Use BDSup2Sub** — Java tool, not ideal for sidecar integration

Recommended: FFmpeg first (quick), then libhdmv native renderer for quality control.

#### 6.2 — Bitmap sub → PGS conversion

Convert DVD VobSub or other bitmap subs to PGS:

- Re-palette (DVD 4-colour → PGS 256-colour)
- Re-time to 90 kHz PTS
- Scale to BD resolution if needed
- Generate PGS segment stream

#### 6.3 — PGS muxing

PGS streams muxed into M2TS via tsMuxeR on dedicated PIDs (0x1200+ range).

---

### Phase 7 — BD validation (Spindle)

**Goal:** Comprehensive BD compliance checking.

#### 7.1 — Structure validation

- BDMV directory structure completeness (index, mobj, at least one playlist/clipinf)
- BACKUP directory consistency
- File naming conventions (5-digit numeric IDs)

#### 7.2 — Stream validation

- Video: H.264 High Profile ≤ L4.1 (BD), HEVC Main 10 ≤ L5.1 (UHD)
- Audio: Mandatory AC-3 fallback present when primary is lossless
- Audio: Channel layout legal (mono, stereo, 5.1, 7.1)
- Subtitles: PGS streams have valid composition segments
- Total bitrate ≤ 48 Mbps (BD) or 128 Mbps (UHD BD)

#### 7.3 — Navigation validation

- First Play object exists and is reachable
- Top Menu object exists
- All title objects reference valid playlists
- No unreachable movie objects
- Popup menu (if defined) has valid button targets

#### 7.4 — UHD-specific validation

- HEVC stream has correct VUI parameters (BT.2020, SMPTE ST 2084 for HDR10)
- MaxCLL/MaxFALL present in SEI for HDR10
- Dolby Vision: BL is valid HDR10 (backward compatibility)
- UDF 2.60 filesystem (not 2.50)

---

### Phase 8 — UHD BD extensions (Spindle)

**Goal:** Full 4K UHD Blu-ray support.

#### 8.1 — HDR10 metadata editor

Frontend editor for HDR10 static metadata:

- Display primaries (mastering display colour volume)
- Max/min luminance
- MaxCLL (maximum content light level)
- MaxFALL (maximum frame-average light level)
- Auto-detect from source when available

#### 8.2 — Dolby Vision workflow

- Detect DV RPU in source (profile 5, 7, 8)
- Profile 7 dual-layer: base layer (HDR10) + enhancement layer (RPU)
- Integration with `dovi_tool` crate for RPU extraction/injection
- SubPath generation in MPLS for DV enhancement layers
- Backward compatibility validation (BL playable as HDR10)

#### 8.3 — HDR10+ support (future)

- Dynamic metadata per frame
- Integration with `hdr10plus_tool` crate
- Lower priority than HDR10/DV

---

## Missing libraries assessment

### Libraries that need to be created

#### 1. `libpgs-author` — PGS subtitle authoring library

**Why it's needed:** libhdmv has PGS _decode_ and RLE encode, but no high-level authoring API for creating PGS streams from scratch. FFmpeg's PGS encoder exists but has limitations (no fine-grained composition control, no optimal palette generation, limited animation).

**What it would do:**

- Accept timed subtitle events (text rendered to bitmap, or source bitmaps)
- Generate properly timed PGS segment sequences (palette → object → composition → window → end)
- Optimal palette quantisation (reduce full-colour renders to 256-entry YCbCrA palette)
- RLE compression (already in libhdmv's `pgs` crate — can depend on it)
- Resolution-aware composition (1080p for BD, 2160p for UHD)
- Output `.sup` elementary stream files

**Scope:** Medium (~2-3 weeks). Could live as a new crate in the libhdmv workspace or as a standalone `liminal-hq/libpgs-author` repo.

**Alternative:** Extend the existing `pgs` crate in libhdmv with an `author` module. This is probably the better approach since the decode/encode primitives are already there.

**Recommendation:** Extend `libhdmv/crates/pgs/` with a `pgs::author` module rather than a new repo.

#### 2. `igs-author` — IGS interactive graphics authoring library

**Why it's needed:** libhdmv can decode IGS and encode individual palette/object segments, but there's no facility to _compose_ a complete interactive menu from scratch — i.e., take button definitions, render artwork to bitmaps, generate palettes, compile navigation commands, and produce a complete IGS segment stream ready for muxing.

**What it would do:**

- Accept a high-level menu definition (pages, buttons, artwork, navigation, actions)
- Render button state images (normal, selected, activated) to bitmaps
- Quantise to 256-colour palette per page
- RLE compress button artwork
- Generate BOG (Button Overlap Group) definitions
- Compile HDMV navigation commands for button actions
- Produce complete IGS segment sequence (palette + objects + composition)
- Support popup menu mode (alpha-blended overlay)
- Support animated effects (in/out transitions, timed sequences)

**Scope:** Large (~4-6 weeks). This is the most significant missing piece.

**Recommendation:** New crate `libhdmv/crates/igs-author/` in the libhdmv workspace, depending on `igs`, `hdmv-insn`, and `pgs` (for shared RLE).

#### 3. `libudf` — UDF filesystem image creation

**Why it's needed:** BD ISOs require UDF 2.50 (standard BD) or UDF 2.60 (UHD BD). The current ISO pipeline uses `genisoimage`/`mkisofs` which primarily target ISO 9660 + Joliet (DVD). While `mkisofs -udf` exists, its UDF support is basic and may not produce fully compliant BD images.

**What it would do:**

- Create UDF 2.50 and 2.60 filesystem images from a directory tree
- Proper BD-ROM UDF compliance (correct partition descriptors, file set descriptors)
- Handle large files (>4 GB for UHD BD streams)
- Produce `.iso` image file

**Scope:** Large (~4-6 weeks for a from-scratch implementation).

**Alternative:** Use existing tools:

- `mkudffs` (part of udftools on Linux) — creates UDF filesystems
- `genisoimage -udf` — basic UDF support
- tsMuxeR has some BD image creation capability in newer versions

**Recommendation:** Start with external tools (`genisoimage -udf` or `mkudffs`). Only build `libudf` if the external tools prove insufficient for BD compliance. This is a "build only if needed" item — flag it but don't commit upfront.

#### 4. `libhdmv` extensions needed (not new libraries, but significant new modules)

These are extensions to the existing libhdmv codebase:

**a) Movie object compiler** — Convert Spindle navigation model → HDMV bytecode programs

- Currently: `DiscBuilder` generates simple "play playlist N; terminate" objects
- Needed: Conditional logic, register operations, menu call/resume, stream selection, timer setup
- Lives in: `libhdmv/crates/hdmv-insn/` (extend encoder) + `libhdmv/crates/libhdmv/src/builder.rs` (extend DiscBuilder)

**b) Sound data compiler** — Create `sound.bdmv` from WAV/PCM button sound effects

- Currently: `bdmv-parse` can read/write `SoundData` structure
- Needed: Accept WAV files → convert to BD sound format (48 kHz PCM, mono/stereo) → write sound.bdmv
- Lives in: `libhdmv/crates/bdmv-parse/` (extend with WAV import utility)

---

## Libraries that are NOT needed (use existing tools instead)

| Capability                 | Use instead of building                                        |
| -------------------------- | -------------------------------------------------------------- |
| M2TS muxing                | tsMuxeR (sidecar) — battle-tested, handles all BD stream types |
| H.264/HEVC encoding        | FFmpeg with libx264/libx265 (already a sidecar)                |
| Audio encoding (AC-3, DTS) | FFmpeg (already a sidecar)                                     |
| HDR metadata tools         | `dovi_tool`, `hdr10plus_tool` Rust crates (direct dependency)  |
| BD playback verification   | VLC / mpv (manual QA tool, not part of build pipeline)         |

---

## Dependency graph

```
Spindle (tauri-plugin-spindle-project)
├── libhdmv (direct Cargo dependency for BDMV authoring)
│   ├── bdmv-io        (directory creation, file writing)
│   ├── bdmv-parse     (binary format read/write)
│   ├── hdmv-insn      (instruction encode/decode)
│   ├── igs            (IGS encode — extend with igs-author)
│   ├── pgs            (PGS encode — extend with pgs::author)
│   └── libhdmv        (DiscBuilder, re-exports)
├── tauri-plugin-hdmv (Tauri IPC for frontend menu preview/navigation)
├── FFmpeg (sidecar — video/audio encode, sub conversion)
├── tsMuxeR (sidecar — M2TS muxing)
├── dovi_tool (Cargo dep — Dolby Vision RPU handling, UHD phase)
└── genisoimage/mkisofs (sidecar — ISO creation, UDF mode)
```

---

## Implementation order and milestones

| Phase       | Work                         | Where             | Depends on    | Est. effort |
| ----------- | ---------------------------- | ----------------- | ------------- | ----------- |
| **1**       | Shared model extensions      | Spindle           | —             | 2-3 weeks   |
| **2**       | BD compatibility assessment  | Spindle           | Phase 1       | 1-2 weeks   |
| **3**       | BD build planner             | Spindle           | Phase 1       | 2-3 weeks   |
| **4.1**     | tsMuxeR integration          | Spindle           | —             | 1-2 weeks   |
| **4.2-4.3** | BD video/audio transcode     | Spindle           | Phase 1, 4.1  | 2-3 weeks   |
| **4.4**     | BDMV structure generation    | Spindle + libhdmv | Phase 3       | 1-2 weeks   |
| **4.5**     | BD ISO generation            | Spindle           | Phase 4.4     | 1 week      |
| **5.1-5.2** | IGS authoring (igs-author)   | libhdmv           | —             | 4-6 weeks   |
| **5.3-5.4** | BD menu compilation + editor | Spindle + libhdmv | Phase 5.1     | 3-4 weeks   |
| **6**       | PGS subtitle pipeline        | libhdmv + Spindle | —             | 2-3 weeks   |
| **7**       | BD validation                | Spindle           | Phase 4, 5, 6 | 2-3 weeks   |
| **8**       | UHD BD extensions (HDR/DV)   | Spindle + libhdmv | Phase 7       | 3-4 weeks   |

**Total estimated effort:** ~25-35 weeks (6-9 months)

**First playable BD output (no menus):** After Phase 4 (~8-10 weeks)
**Full BD with menus:** After Phase 5 (~18-22 weeks)
**UHD BD with HDR:** After Phase 8 (~25-35 weeks)
