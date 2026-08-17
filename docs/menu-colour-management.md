# Menu Colour Management — sRGB Authoring, BT.601/BT.709 Output

Closes #112. Flagged but deferred in
[`rich-menu-editor-plan.md`](rich-menu-editor-plan.md) §2 decision 8: "colour
management (author in sRGB, convert per-target: BT.601 for DVD, BT.709 for
BD)." This spike answers where conversion currently does (and doesn't) happen
in the still-menu pipeline, and what the motion-menu backend (Slice C) and a
future BD backend should do differently.

**Authored colours are CSS sRGB.** The editor's colour pickers, `#rrggbb`
hex values in `MenuHighlightColours` and `ButtonStyleMap`, and the DOM/CSS
canvas render all live in sRGB — that's what a browser/webview does with a
hex colour, no exceptions. **DVD-Video output is BT.601**; **BD/BDMV output
is BT.709** (`rich-menu-editor-plan.md` §2). Nothing about that pairing is in
question. What's in question is whether, and where, the pipeline converts
between the two — and the answer today is: nowhere, for the video stream,
and correctly-but-incidentally, for the subpicture stream.

---

## Decisions

These are the concrete rules later PRs implement. Everything below this
section is the evidence for them.

1. **Tag every DVD-targeted `mpeg2video` encode with explicit BT.601
   metadata** instead of relying on ffmpeg's defaults: add
   `-color_primaries <p> -color_trc <p> -colorspace <p>` where `<p>` is
   `smpte170m` for NTSC discs and `bt470bg` for PAL discs (`VideoStandard`),
   and add `scale=out_color_matrix=bt601` to whichever `-vf`/`-filter_complex`
   chain already performs a `scale`/format conversion. This applies to the
   still-menu overlay composite (`build_ffmpeg_menu_command`,
   `plugins/tauri-plugin-spindle-project/src/build/menu.rs`), the title
   transcode (`build_ffmpeg_transcode_command`,
   `plugins/tauri-plugin-spindle-project/src/build/ffmpeg.rs`), and the
   motion-menu background compose step Slice C adds.
2. **Land these flags as one shared helper**, not four copy-pasted flag
   lists — e.g. `dvd_colour_flags(standard: VideoStandard) -> Vec<String>` in
   `build/ffmpeg.rs`, consumed by every DVD `mpeg2video` command builder. The
   `is_hdr_source` / `zscale=...:m=bt709:...` branch already in
   `build_title_video_filter` (`ffmpeg.rs`) is the existing precedent for
   "name the target matrix explicitly in the filter graph" — follow its
   shape.
3. **Subpicture/highlight overlay PNGs need no colour pre-conversion.**
   `spumux` already converts the RGB pixels Skia hands it into the IFO's
   YCrCb CLUT using BT.601-family coefficients (below). Do not add a
   Rust-side hex-to-YCrCb step.
4. **When BD lands**, add the BT.709 analogue behind the same seam:
   `-color_primaries bt709 -color_trc bt709 -colorspace bt709` and
   `scale=out_color_matrix=bt709` in the BD backend's `compose_background`
   (`MenuCompiler` trait, `rich-menu-editor-plan.md` §4 Slice C), selected by
   `FormatProfile`/`DiscFamily` rather than `VideoStandard`. No BD encode
   path exists yet — this is a placeholder for whoever writes it, not new
   work now.
5. **The editor preview does not simulate anything new.** See
   [§ Editor preview](#what-the-editor-preview-should-simulate) — sRGB
   authoring round-trips through a correctly-tagged BT.601 encode with no
   visible shift, so there's nothing to preview differently. A "TV-safe
   gamut" toggle is a plausible future usability feature, not a correctness
   requirement.

---

## Where colour lives today

### Skia render: untagged sRGB RGBA

`render_menu_scene_to_png` (`build/skia/scene.rs`) builds the surface as:

```rust
let info = ImageInfo::new(ISize::new(w, h), ColorType::RGBA8888, alpha_type, None);
```

The final `None` is Skia's colour-space parameter — no explicit colour space
is attached to the surface. Skia's own default treatment of an untagged
surface is sRGB, which is also what every hex colour authored in the editor
already means, so this is _correct by construction_, not a gap: the render
target's numbers are sRGB values. The PNG that
`image.encode(None, EncodedImageFormat::PNG, None)` writes carries no
embedded colour profile chunk (no `sRGB`/`iCCP`), so downstream tools must
assume sRGB by convention — a safe assumption here because nothing else in
the pipeline claims otherwise.

### ffmpeg composite: no explicit matrix, no stream tagging

`build_ffmpeg_menu_command` composites that PNG onto the menu background via
`overlay=0:0,setsar={sar}[menuout]` and encodes with `-c:v mpeg2video`. There
is no `-color_primaries`, `-color_trc`, `-colorspace`, or
`scale=...color_matrix=...` anywhere in that command, and the same is true of
`build_ffmpeg_transcode_command`'s SD-target path in `ffmpeg.rs` (the HDR
tonemap branch is the one exception — it explicitly targets `bt709` in its
`zscale` chain, because tonemapping requires naming a matrix to convert
through).

Two independent things happen with no explicit flags, and they diverge:

- **Pixel values**: converting an RGB source to `yuv420p` for the encoder
  goes through libswscale, whose documented default is BT.601
  (`SWS_CS_DEFAULT` is defined as `SWS_CS_ITU601` in
  [`libswscale/swscale.h`](https://github.com/FFmpeg/FFmpeg/blob/master/libswscale/swscale.h)).
  Community references consistently describe the same behaviour from the
  other direction: ffmpeg/swscale tooling infers BT.601 vs BT.709 by output
  resolution, with the crossover around 576 lines — SD (480i/576i and below)
  gets treated as BT.601/`smpte170m`, HD as BT.709 ([How to Change Color
  Matrix in FFmpeg for SD
  Video](https://salivity.github.io/ffmpeg/article/how-to-change-color-matrix-in-ffmpeg-for-sd-video),
  [ffmpeg yuv colorspace is BT.601 or BT.709? —
  VideoHelp](https://forum.videohelp.com/threads/395345-ffmpeg-yuv-colorspace-is-BT-601-or-BT-709)).
  DVD's raster (720×480/576) sits inside that SD bucket, so **the actual
  pixel maths ffmpeg performs today is very likely already the right
  matrix** — but that's a fallback landing in the right place by virtue of
  DVD being SD, not a guarantee, and it stops being true the moment BD
  (BT.709, 1920×1080) shares any of this code.
- **Stream metadata**: `-color_primaries`, `-color_trc`, and `-colorspace`
  each default to "unspecified" and ffmpeg does not fill them in unless
  explicitly requested (confirmed against ffmpeg's own option
  documentation — see [Set Color Primaries Transfer and Matrix in
  FFmpeg](https://salivity.github.io/ffmpeg/article/set-color-primaries-transfer-and-matrix-in-ffmpeg)
  and the [FFmpeg Bitstream Filters
  docs](https://ffmpeg.org/ffmpeg-bitstream-filters.html)). The MPEG-2
  sequence display extension we mux today therefore carries
  `matrix_coefficients = unspecified` (value 2), not `bt601`. A decoder
  facing "unspecified" on an SD stream will assume BT.601 by convention —
  DVD-Video is BT.601-only by spec, so no real player is likely to guess
  wrong today — but the bitstream is not self-describing, which is exactly
  the property that stops mattering benignly once a second target format
  with a different matrix exists in the same codebase.

**Net assessment**: today's still-menu pipeline is _probably_ pixel-correct
for DVD by accident (SD raster → swscale's SD default → BT.601), and
_definitely_ under-tagged (no explicit metadata in the muxed stream). Neither
half of that is something to leave alone once BD is on the table: an accident
that happens to be right isn't a rule the next backend can follow, and a
correctly-encoded-but-untagged stream is needless ambiguity for zero cost to
fix.

---

## Recommended conversion point per target

### DVD stills (this PR's immediate scope)

Add to `build_ffmpeg_menu_command`'s `-filter_complex` chain — specifically
where the background and Skia overlay are composited before `setsar` — an
explicit `format=yuv420p` conversion step, and to the top-level command:

```
-color_primaries smpte170m -color_trc smpte170m -colorspace smpte170m   # NTSC
-color_primaries bt470bg   -color_trc bt470bg   -colorspace bt470bg    # PAL
```

`smpte170m` and `bt470bg` share identical YCbCr _matrix coefficients_
(`Kb=0.114`, `Kr=0.299` — both are "BT.601" colloquially); they differ in
primaries/whitepoint, which is why DVD's NTSC/PAL split needs both names
rather than one generic `bt601` tag on the metadata side. Where an explicit
`scale` already exists in a filter chain (`build_dvd_scale_filter` in
`ffmpeg.rs`, used by title transcoding), add `out_color_matrix=bt601` to
that `scale=` invocation directly rather than a separate filter stage — this
mirrors the existing `,setsar=...` suffix pattern in the same function.

### Motion menu composites (feeds the motion-backend PR)

`motion-menus.md`'s build step 2 composites button videos into the
background via an `ffmpeg overlay` filter graph
(`[1:v]scale=...[btn];[0:v][btn]overlay=...`) before muxing. The same flags
apply: the background video, button videos, and Skia scene PNG all end up
composited into one `mpeg2video` stream, so it gets the identical
`dvd_colour_flags(standard)` treatment as the still-menu path. This is worth
stating explicitly now because Slice C's `MenuCompiler::compose_background`
is exactly the seam where this either gets done once, correctly, or
forgotten and redone per-format later — do it in the shared helper from
[Decision 2](#decisions), not inline in the motion command builder.

### BD / BT.709 (future work, not implemented now)

When a BD backend's `compose_background` exists (`igs-author` + tsMuxeR
per §5 of `rich-menu-editor-plan.md`), it needs the BT.709 equivalents:
`-color_primaries bt709 -color_trc bt709 -colorspace bt709` and
`scale=out_color_matrix=bt709`. BD's raster (1920×1080) already sits on the
"HD" side of ffmpeg's own resolution heuristic, so — mirroring the DVD
situation — an _untagged_ BD encode would likely also land on the right
pixel values by accident. The same rule applies: tag it explicitly rather
than depend on that. This is the one piece of this document that's pure
forward-declaration; no BD encode path exists to change yet.

---

## Subpicture palettes: does spumux convert RGB→YCrCb, and with which matrix?

DVD subpicture CLUTs are stored in the IFO as YCrCb, per spec. Spindle's
build never authors that CLUT directly — no `<palette>` element appears
anywhere in the generated `dvdauthor.xml` (checked against
`plugins/tauri-plugin-spindle-project/src/build/`); `spumux` is handed
RGBA PNGs (`render_menu_overlay_image_skia` /
`render_menu_overlay_image_skia_quantized`, `build/skia/scene.rs`) via the
`<spu image=... highlight=... select=...>` attributes in
`generate_spumux_xml` (`build/menu.rs`) and computes the master palette
itself.

`spumux` is built from dvdauthor's `subgen*.c` sources (confirmed against
the project's own
[`Makefile.am`](https://raw.githubusercontent.com/ldo/dvdauthor/master/src/Makefile.am) —
the `spumux` binary target compiles `subgen.c`, `subgen-parse-xml.c`,
`subgen-encode.c`, `subgen-image.c`, `subrender.c`, `subreader.c`,
`subfont.c`). Its RGB→YCrCb conversion lives in the shared
[`rgb.h`](https://raw.githubusercontent.com/ldo/dvdauthor/master/src/rgb.h)
header used throughout dvdauthor's colour-handling code:

```
Y  = (257*r + 504*g +  98*b + 16500) / 1000
Cr = (439*r - 368*g -  71*b + 128500) / 1000
Cb = (-148*r - 291*g + 439*b + 128500) / 1000
```

Those coefficients (`0.257/0.504/0.098` for `r/g/b` into `Y`, offset `+16`)
are exactly the ITU-R BT.601 **studio-range** (16–235) RGB→YCbCr matrix —
the textbook SD broadcast matrix, not the full-range JFIF variant
(`0.299/0.587/0.114`, no offset). `subgen-encode.c`'s non-DVD encode paths
(`svcd_encode`/`cvd_encode`) call this directly as `calcY`/`calcCr`/`calcCb`;
the DVD path builds its master palette from the same colour-handling layer
before final encode.

**Conclusion**: spumux already does the RGB→YCrCb conversion, and the matrix
it uses is the one DVD wants. Our hex palette values
(`MenuHighlightColours`, and the Skia-rendered highlight/select overlay
PNGs) do not need pre-conversion — Decision 3 above. This is one of the few
places in the current pipeline that's already correct without any explicit
flag; the fix here is "leave it alone," documented so nobody adds redundant
conversion code later under the (reasonable-looking) assumption that nobody
has handled it yet.

One adjacent fact worth flagging for anyone touching `dvdauthor.xml`
directly in future: dvdauthor's separate `-p`/`<palette>` mechanism (a
raw 16-entry PGC-level palette file, distinct from what spumux derives)
disambiguates RGB vs YUV hex input by filename suffix — `.rgb` means RGB,
anything else means YUV
([`dvdauthor` manpage](https://manpages.debian.org/testing/dvdauthor/dvdauthor.1.en.html)).
Spindle doesn't use that mechanism today (spumux derives the palette), so
this ambiguity doesn't currently apply — but it's a landmine for anyone who
later authors a `<palette>` block by hand without checking which
convention they're feeding it.

---

## What the editor preview should simulate

**Recommendation: nothing, for now.** The reasoning:

- BT.601 is a lossless-modulo-rounding round-trip for RGB values that begin
  as 8-bit sRGB. What you author is, subject to normal 8-bit rounding and
  DVD's 4:2:0 chroma subsampling (already visually represented by the
  existing 4-colour subpicture quantisation in `CompileMode`'s DVD preview),
  what comes back out of a compliant decoder once the flags above are in
  place. There's no separate "DVD colour look" to simulate beyond what the
  4-colour palette quantisation preview already shows.
- ffmpeg's default `color_range` handling for `mpeg2video` already targets
  broadcast-legal (`tv`, 16–235) range appropriately for DVD; there's no
  full/limited-range mismatch introduced by this pipeline to warn about.
- Adding a colour-managed preview path to the DOM/CSS canvas (Section 3.3's
  "honest target preview") would be real, ongoing engineering cost — canvas
  colour management, a second render pass, or CSS `color-profile`
  machinery — for a correction that, once the flags above land, has no
  visible effect to preview.

**A future, low-priority idea**: a "TV-safe gamut" toggle that clips preview
colours to broadcast-legal range and/or simulates CRT-era black level
lift, as a design-review aid for footage that mixes with the menu (e.g. a
motion-menu background sourced from HDR or wide-gamut footage where the
_content_, not the menu chrome, might clip on an SD/BT.601 target). That's a
usability feature for catching authoring mistakes, not a correctness fix for
this issue, and should stay out of scope until Slice B/C's HDR tonemap path
(already BT.709-aware per `is_hdr_source` in `ffmpeg.rs`) gives a concrete
reason to want it.

---

## Summary for implementers

| Stage                           | Today                                                                    | After this spike lands                                          |
| ------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Skia scene render               | Untagged RGBA8888, sRGB by convention                                    | No change                                                       |
| Still-menu ffmpeg composite     | No colour flags; matrix guessed by swscale default, metadata unspecified | Explicit `smpte170m`/`bt470bg` flags + `out_color_matrix=bt601` |
| Title transcode                 | Same gap (HDR path is the one exception)                                 | Same explicit-flag treatment via shared helper                  |
| Motion-menu composite (Slice C) | Doesn't exist yet                                                        | Ships with the flags from day one                               |
| Subpicture/highlight overlays   | spumux converts RGB→YCrCb via BT.601-family coefficients                 | No change — already correct                                     |
| Editor preview                  | sRGB DOM/CSS + 4-colour quantised DVD preview                            | No change                                                       |
| BD backend (future)             | N/A                                                                      | BT.709 analogue behind the same seam                            |
