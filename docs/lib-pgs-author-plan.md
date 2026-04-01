# pgs::author — PGS Subtitle Authoring Module

## Purpose

Generate BD-native PGS (Presentation Graphics Stream) subtitle elementary streams from text or bitmap subtitle sources. This is the Blu-ray equivalent of DVD's VobSub subtitle pipeline — it produces the `.sup` files that get muxed into M2TS containers.

## Why it's needed

libhdmv's `pgs` crate can **decode** PGS streams and **encode** RLE bitmaps, but cannot:

- Accept timed subtitle events and produce a complete PGS elementary stream
- Render text subtitles to bitmap images at BD/UHD resolution
- Generate properly sequenced display sets (palette → window → object → composition → end)
- Optimise palette allocation across subtitle frames
- Handle the epoch/acquisition model that BD players expect

Without this, BD projects in Spindle cannot include subtitles (a hard requirement for most real-world discs).

## Proposed location

`libhdmv/crates/pgs/src/author.rs` — new module in the existing `pgs` crate.

This is preferred over a new crate because:

- The decode types and RLE encoder are already in `pgs`
- No additional workspace member needed
- Natural pairing: `pgs::decode` ↔ `pgs::author`

## Public API (proposed)

```rust
/// A single subtitle event to be compiled into PGS.
pub struct SubtitleEvent {
    /// Start time in 90 kHz PTS ticks.
    pub start_pts: u64,
    /// End time in 90 kHz PTS ticks.
    pub end_pts: u64,
    /// The subtitle image content.
    pub content: SubtitleContent,
    /// Position on screen (default: centred bottom).
    pub position: Option<SubtitlePosition>,
    /// Force display (shown regardless of subtitle track selection).
    pub forced: bool,
}

/// Subtitle content — either pre-rendered bitmap or text to render.
pub enum SubtitleContent {
    /// RGBA bitmap (will be quantised to 256-colour palette and RLE-compressed).
    Bitmap { data: Vec<u8>, width: u16, height: u16 },
    /// Already paletted and RLE-compressed (passthrough from VobSub conversion).
    PreEncoded { rle_data: Vec<u8>, width: u16, height: u16, palette: Vec<[u8; 4]> },
}

/// Screen position for subtitle placement.
pub struct SubtitlePosition {
    pub x: u16,
    pub y: u16,
}

/// Compile subtitle events into a PGS elementary stream (.sup format).
pub fn compile_pgs(
    events: &[SubtitleEvent],
    video_width: u16,    // 1920 for BD, 3840 for UHD
    video_height: u16,   // 1080 for BD, 2160 for UHD
) -> Result<Vec<u8>, PgsAuthorError>;
```

## Implementation phases

### Phase A — Display set generation (~1 week)

- Build complete display sets from subtitle events
- Segment sequencing: PCS (presentation composition) → WDS (window) → PDS (palette) → ODS (object) → END
- Composition state machine: epoch start → acquisition point → normal
- Window allocation (BD supports up to 2 windows; subtitles typically use 1)
- PTS/DTS timing for each segment

### Phase B — Palette and object compilation (~1 week)

- RGBA → 256-entry YCbCrA palette quantisation (reuse from igs-author or shared utility)
- RLE compression (already in `pgs::rle::encode_rle`)
- Object segment construction with correct data length headers
- Object splitting for large subtitles (>64KB RLE data per segment, BD limit)

### Phase C — Epoch management and optimisation (~0.5 weeks)

- Epoch boundaries: new epoch when palette or window definition changes
- Acquisition point insertion: allow random-access seeking within stream
- Palette reuse: consecutive subs with similar colours share palette (update flag)
- Composition number sequencing (incrementing, wrapping)

### Phase D — VobSub → PGS converter (~0.5 weeks)

- Accept pre-paletted bitmap data from DVD VobSub extraction
- Re-palette from 4-colour DVD CLUT to 256-entry PGS palette
- Scale bitmaps from DVD resolution (720×480/576) to BD resolution (1920×1080)
- Re-time from DVD PTS to BD PTS (both 90 kHz, but DVD PTS may have offset)

## Research questions

1. **Text rendering:** Should this module handle text → bitmap rendering, or should that be done externally (by Spindle or a separate utility)? Recommend: external — keep `pgs::author` focused on PGS stream compilation. Spindle can use `fontdue` or FFmpeg's `drawtext` to render subtitle text, then pass RGBA bitmaps to `pgs::author`.

2. **Object size limits:** PGS objects larger than 64KB of RLE data must be split across multiple ODS (Object Definition Segments). Need to verify the exact split semantics and whether first/last flags are needed.

3. **Palette update vs full replace:** The PGS spec supports palette updates (modify specific entries) vs full palette replacement. For subtitle authoring, full replacement per epoch is simpler. Optimisation can come later.

4. **Forced subtitle flag:** BD players show forced subtitles even when subtitles are "off". This is used for foreign-language dialogue translation. The PCS forced_on flag controls this — need to expose it per event.

5. **SUP file format:** The `.sup` format is just concatenated PGS segments with 2-byte header (`PG` magic, 4-byte PTS, 4-byte DTS, then segment). Verify header format against BDSup2Sub and real disc samples.

## Test strategy

- Unit tests: known subtitle event → verify segment sequence and timing
- Round-trip: compile → decode with existing `pgs::PgsDecoder` → verify events match
- VobSub conversion: take real DVD subtitle extraction → convert → decode → verify
- Player test: compile, mux with tsMuxeR, play in mpv/VLC → subtitles display correctly
- Edge cases: overlapping subtitles, very long subtitle text, empty events, sub near stream boundary
