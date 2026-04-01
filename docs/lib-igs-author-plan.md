# igs-author — IGS Interactive Graphics Authoring Library

## Purpose

Compile high-level menu definitions into BD-native IGS (Interactive Graphics Stream) segment bitstreams. This is the Blu-ray equivalent of DVD's spumux menu overlay pipeline — it takes authored menu intent (pages, buttons, artwork, navigation, actions) and produces the binary IGS stream that gets muxed into M2TS containers.

## Why it's needed

libhdmv can **decode** IGS streams and **encode** individual segments (palette, object), but cannot:

- Compose a complete interactive composition from scratch
- Render button state artwork to RLE-compressed bitmaps
- Generate optimal palettes from full-colour source artwork
- Compile navigation commands for button actions
- Produce a muxable IGS elementary stream with correct PTS timing

Without this, Spindle can author BD discs with titles and chapters but **cannot have menus**.

## Proposed location

`libhdmv/crates/igs-author/` — new crate in the libhdmv workspace.

**Dependencies within workspace:**

- `igs` — IGS type definitions, segment encode functions
- `hdmv-insn` — HDMV instruction encoder (for button navigation commands)
- `pgs` — Shared RLE encode/decode (IGS uses the same RLE format as PGS)
- `bdmv-parse` — Stream coding types, format version

## Public API (proposed)

```rust
/// High-level menu page definition for authoring.
pub struct AuthorPage {
    pub page_id: u16,
    pub default_selected_button_id: u16,
    pub default_activated_button_id: u16,
    pub buttons: Vec<AuthorButton>,
    pub palette: AuthorPalette,
    pub in_effect: Option<PageEffect>,
    pub out_effect: Option<PageEffect>,
    pub uo_mask: u64,
    pub animation_frame_rate: Option<u8>,
}

/// A button definition for authoring.
pub struct AuthorButton {
    pub button_id: u16,
    pub overlap_group: u16,
    pub normal_image: ButtonImage,
    pub selected_image: ButtonImage,
    pub activated_image: ButtonImage,
    pub nav_up: u16,
    pub nav_down: u16,
    pub nav_left: u16,
    pub nav_right: u16,
    pub navigation_commands: Vec<[u8; 12]>,
}

/// Button artwork — either pre-rendered or to be rendered.
pub enum ButtonImage {
    /// Pre-rendered RGBA bitmap (will be quantised and RLE-compressed).
    Rgba { data: Vec<u8>, width: u16, height: u16 },
    /// Reference to an already-encoded IGS object by ID.
    ObjectRef(u16),
}

/// Palette specification.
pub enum AuthorPalette {
    /// Auto-generate from button artwork (median-cut quantisation).
    Auto,
    /// Explicit 256-entry YCbCrA palette.
    Explicit(Vec<[u8; 4]>),
}

/// Compile pages into a complete IGS elementary stream.
pub fn compile_igs(
    pages: &[AuthorPage],
    resolution: (u16, u16),  // 1920×1080 for BD
    popup: bool,              // true for popup menus
) -> Result<Vec<u8>, IgsAuthorError>;
```

## Implementation phases

### Phase A — Palette quantisation and object compilation (~1.5 weeks)

- Median-cut colour quantisation: RGBA → 256-entry YCbCrA palette
- RLE compression of paletted bitmaps (use existing `pgs::rle::encode_rle`)
- Object segment generation (use existing `igs::write_object_segment`)
- Palette segment generation (use existing `igs::write_palette_segment`)
- Round-trip test: author objects → decode → verify pixel match

### Phase B — Composition assembly (~2 weeks)

- Build `InteractiveComposition` from `AuthorPage` definitions
- BOG (Button Overlap Group) assignment
- Button state mapping (normal/selected/activated → object ID references)
- Navigation command embedding
- Composition segment serialisation with correct timing
- Page effect sequences (in/out transitions)

### Phase C — Elementary stream packaging (~1 week)

- PTS timing for display sets (epoch-based)
- Segment sequencing: palette → objects → composition → end
- Multi-page stream generation (sequential display sets)
- Popup mode flag handling
- Output as `.igs` elementary stream file (raw PES payload)

### Phase D — Integration with Spindle menu model (~1.5 weeks)

- Converter: Spindle `Menu` + `MenuButton` → `AuthorPage` + `AuthorButton`
- Button label text rendering to RGBA bitmaps (using a font rasteriser)
- Highlight colour mapping (Spindle's CSS hex → YCbCrA)
- PlaybackAction → HDMV navigation command compilation
- Integration test: Spindle menu → IGS → decode → verify structure

## Research questions

1. **Font rasterisation:** What library to use for rendering button label text to bitmaps? Options: `fontdue` (pure Rust, fast, simple), `rusttype` (mature), `cosmic-text` (complex text layout). For button labels, `fontdue` is likely sufficient.

2. **Palette quantisation algorithm:** Median-cut is standard. Consider `color_quant` or `imagequant` crates, or implement a simple median-cut (since we only need 256 colours and button artwork is typically low-complexity).

3. **Animated effects:** BD IGS supports in/out effects with window-based animation. How complex should the initial authoring support be? Recommend: start with instant transitions (no effects), add fade/wipe effects in a second pass.

4. **Multi-page chapter selection:** Common BD pattern — auto-generate chapter selection pages with thumbnail grid. Should the authoring library support this as a template, or leave it to Spindle? Recommend: Spindle generates the page definitions, igs-author just compiles them.

5. **Button artwork vs text rendering:** Should the library accept pre-rendered RGBA bitmaps (Spindle renders text) or should it render text internally? Recommend: accept RGBA bitmaps — keeps the library focused on IGS compilation, not font rendering.

## Test strategy

- Unit tests for palette quantisation (known inputs → expected palette)
- Round-trip tests: author → compile → decode with existing IGS decoder → verify
- Integration tests against real BD player expectations (compile, mux with tsMuxeR, verify in mpv/VLC)
- Property tests: random button layouts → compile → decode → structure matches
