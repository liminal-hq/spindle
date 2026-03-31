# Text Subtitle Rendering

_Plan drafted March 31, 2026. This document will be updated as work is implemented: planning material will be removed and replaced with specification-grade descriptions of the final behaviour._

## Goal

Enable text-based subtitle streams (SRT, ASS/SSA, WebVTT, `mov_text`) to be rendered into DVD-compatible bitmap subpictures and authored onto the disc. When this work is done, a user should be able to import a file with SRT or ASS subtitles, map them to a title, and build a disc with working subtitle tracks — no external conversion step required.

## Background

### Current state

The bitmap subtitle path is fully functional: extraction via FFmpeg, muxing via spumux, and `<subpicture>` declarations in dvdauthor XML. Text subtitles are detected during inspection and classified as `SubtitleType::Text`, but the build pipeline filters them out. A `subtitle.text-only-unsupported` validation warning tells users that text subtitles cannot yet be authored.

### DVD subtitle constraints

DVD-Video subtitles are bitmap subpictures with severe constraints:

- **4-colour palette** per subtitle stream (including transparent). Typical usage: background (transparent), text fill, text outline, anti-alias.
- **Resolution** matches the title's video frame (720x480 NTSC, 720x576 PAL).
- **No font rendering on the player** — all text must be pre-rendered to bitmaps before authoring.
- **Format**: VOBsub (.sub/.idx pairs) or raw DVD subpicture streams, consumed by spumux.

### Recognised text codecs

From `inspect.rs::classify_subtitle_type`:

| Codec | Format | Notes |
| --- | --- | --- |
| `subrip` / `srt` | SRT | Plain text with basic timing. Most common. |
| `ass` / `ssa` | ASS/SSA | Rich styling: fonts, colours, positioning, effects. |
| `webvtt` | WebVTT | Web-origin format, similar to SRT with CSS-like styling. |
| `mov_text` | QuickTime | Simple text, common in MP4 containers. |

---

## Design

### Rendering approach

Use FFmpeg's subtitle filter chain to render text subtitles into bitmap subpictures. FFmpeg can:

1. Decode all recognised text formats (SRT, ASS, SSA, WebVTT, `mov_text`).
2. Render styled text onto a transparent canvas via the `subtitles` or `ass` filter.
3. Output the result as a VOBsub stream (`-c:s dvd_subtitle`).

The rendering pipeline is a two-step process per text subtitle mapping:

**Step 1 — Render text to bitmap video overlay**

Generate a short video stream where each frame is a transparent canvas with the subtitle text rendered on it. FFmpeg's `subtitles` filter handles this when applied to a blank video input:

```
ffmpeg -f lavfi -i "color=c=black@0:s=720x480:d={duration}" \
       -vf "subtitles={source}:si={stream_index}:force_style='{style}'" \
       -c:v rawvideo -pix_fmt yuva420p \
       {temp_overlay}.nut
```

**Step 2 — Convert overlay to VOBsub**

Quantise the rendered overlay to DVD's 4-colour palette and package as VOBsub:

```
ffmpeg -i {temp_overlay}.nut \
       -c:s dvd_subtitle \
       {output}.sub
```

An alternative single-pass approach may be viable depending on FFmpeg version capabilities. The two-step approach is safer and allows intermediate inspection.

### Style defaults

DVD's 4-colour palette forces significant style simplification. Define sensible defaults:

| Property | Default | Notes |
| --- | --- | --- |
| Font | Liberation Sans or system sans-serif | Must be bundled or resolved at build time |
| Font size | Scaled to ~5% of frame height | ~24px at 480p, readable on CRT/LCD |
| Text colour | White (#FFFFFF) | Palette slot 1 |
| Outline colour | Black (#000000) | Palette slot 2 |
| Outline width | 2px | Ensures legibility over varied backgrounds |
| Position | Bottom-centre, 90% action-safe | Standard subtitle placement |
| Anti-alias colour | Grey (#808080) | Palette slot 3, improves edge smoothing |

For ASS/SSA sources, honour the embedded styling where possible (font, size, colour, position) but quantise colours to the nearest palette entry and strip unsupported effects (blur, rotation, clip paths, karaoke timing).

### Pipeline integration

#### New build job type

Add a `RenderTextSubtitles` variant to `BuildJob`:

```
RenderTextSubtitles {
    title_id: String,
    title_name: String,
    source_path: String,
    source_stream_index: u32,
    output_path: PathBuf,
    command: Vec<String>,
    label: String,
    duration_secs: Option<f64>,
}
```

This is distinct from `ExtractSubtitles` because the operation is fundamentally different: extraction copies existing bitmap data, while rendering generates new bitmap data from text. The `duration_secs` field enables progress estimation (rendering time is proportional to video duration).

#### Build planner changes

In `planner.rs`, extend the subtitle job generation to handle text subtitles:

```rust
// Existing: bitmap subtitles → ExtractSubtitles job
// New: text subtitles → RenderTextSubtitles job
let text_subtitles: Vec<_> = title
    .subtitle_mappings
    .iter()
    .filter(|sm| {
        asset.subtitle_streams.iter().any(|ss|
            ss.index == sm.source_stream_index
            && ss.subtitle_type == SubtitleType::Text
        )
    })
    .collect();
```

Each text subtitle mapping produces one `RenderTextSubtitles` job. The output path follows the same pattern as bitmap extraction: `{subtitles_dir}/{title_id}_sub_{stream_index}.sub`.

#### FFmpeg command generation

Add `build_ffmpeg_text_subtitle_render_command` to `ffmpeg.rs`:

```rust
pub(crate) fn build_ffmpeg_text_subtitle_render_command(
    source_path: &str,
    output_path: &Path,
    source_stream_index: u32,
    video_standard: VideoStandard,
    duration_secs: f64,
) -> Vec<String>
```

Parameters:
- `video_standard` determines frame size (720x480 NTSC, 720x576 PAL)
- `duration_secs` sets the blank video input duration
- The `force_style` parameter applies the default style overrides

#### dvdauthor XML

No changes needed. The existing `<subpicture>` declaration code in `authoring.rs` already iterates all subtitle mappings regardless of type. Once text subtitles produce valid VOBsub output, they'll be picked up by spumux like bitmap subtitles.

### Validation changes

| Change | Detail |
| --- | --- |
| Remove `subtitle.text-only-unsupported` | No longer needed once rendering is supported |
| Add `subtitle.ass-styling-simplified` | Info-level note when ASS/SSA subtitles have styling that will be quantised to DVD palette |
| Add `subtitle.no-font-available` | Warning if the configured font cannot be resolved at build time |

### User-facing configuration (future)

The initial implementation uses fixed defaults. A future enhancement could expose per-subtitle-mapping overrides in the title editor:

- Font family picker (from system fonts)
- Font size slider
- Text/outline colour pickers (constrained to 4-colour palette)
- Position override (top/bottom)
- Preview of rendered subtitle appearance

This is explicitly out of scope for the initial implementation.

---

## Files to change

| File | Change |
| --- | --- |
| `plugins/.../src/build/types.rs` | Add `RenderTextSubtitles` variant to `BuildJob` |
| `plugins/.../src/build/ffmpeg.rs` | Add `build_ffmpeg_text_subtitle_render_command` |
| `plugins/.../src/build/planner.rs` | Generate `RenderTextSubtitles` jobs for text subtitle mappings |
| `plugins/.../src/build/runner.rs` | Execute `RenderTextSubtitles` jobs during build |
| `plugins/.../src/desktop.rs` | Remove `subtitle.text-only-unsupported`, add new validation rules |
| `apps/.../src/types/project.ts` | Add `renderTextSubtitles` to `BuildJob` union |
| `apps/.../src/pages/BuildPage.tsx` | Handle `renderTextSubtitles` job type for progress display |
| `docs/core-dvd-authoring-completion.md` | Update subtitle pipeline spec to reflect text rendering |

## Risks and open questions

1. **Font availability** — FFmpeg's subtitle filter requires fonts at render time. Need to either bundle a default font or resolve system fonts. Bundling Liberation Sans (~500 KB) is the safest option for reproducible builds.

2. **ASS/SSA fidelity** — Complex ASS styles (karaoke, animated clips, custom draw commands) cannot be faithfully reproduced in DVD's 4-colour palette. The plan is to render what we can and silently degrade the rest, with an info-level validation note.

3. **Performance** — Text subtitle rendering requires generating and encoding a full-duration video overlay per subtitle track. For a 2-hour title this is non-trivial. Progress reporting via `duration_secs` will help, but build times will increase compared to bitmap extraction.

4. **Multi-pass vs single-pass** — The two-step approach (render overlay, then convert to VOBsub) is safer but creates large intermediate files. If FFmpeg can do it in one pass reliably, the single-pass approach saves disk space and time. Needs testing across FFmpeg versions.

5. **Colour quantisation quality** — DVD's 4-colour palette means anti-aliased text edges may look rough. The grey anti-alias palette slot helps, but the result will never match modern text rendering. This is an inherent DVD limitation, not something to "fix".

## Estimated scale

**Medium** — Primary work is in FFmpeg command generation and build planner extension. The rendering approach leverages FFmpeg's existing subtitle filters rather than building a custom renderer. Most of the complexity is in getting the FFmpeg filter chain right and handling edge cases in ASS/SSA styling.
