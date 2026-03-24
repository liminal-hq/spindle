# Motion Menus and Motion Buttons — Design Document

## Overview

DVD-Video supports two types of menu presentation:

1. **Still menus** — a single MPEG-2 still frame displayed indefinitely (current implementation)
2. **Motion menus** — a looping MPEG-2 video clip with multiplexed subpicture highlights

Motion _buttons_ extend this further: instead of a static subpicture overlay, the highlight layer can be a sequence of frames that animates when a button is selected or activated.

This document describes the model, build pipeline changes, and UI additions needed to support both features.

---

## DVD-Video Technical Background

### Motion Menu Structure

A DVD motion menu is a standard VOB containing:

- **Video stream**: a looping MPEG-2 clip (typically 10–30 seconds). The player loops playback using a `post` command that jumps back to the start of the cell.
- **Audio stream** (optional): background music or ambient sound, encoded as AC-3 or LPCM.
- **Subpicture stream**: the button highlight overlay, composited by `spumux` with timing synchronised to the video.

The key difference from a still menu is that `dvdauthor` receives a video file rather than a still frame, and the `<pgc>` element includes a `<post> jump cell 1; </post>` command for looping.

### Motion Button Highlights

There are two approaches to motion buttons on DVD-Video:

**Approach 1 — Animated subpicture overlay**: the highlight layer itself changes over time. Standard highlights use a single subpicture image for all frames; animated highlights replace this with a sequence of subpicture images that change at specific timestamps, creating effects like pulsing glow, sliding underline, or colour cycling. `spumux` supports this via multiple `<spu>` elements with different `start` and `end` timestamps.

**Approach 2 — Static overlay on localised video**: the button region contains encoded video (e.g., a looping thumbnail preview, animated icon, or visual effect) composited into the menu's background video stream at the button's bounding rectangle. The subpicture highlight overlay remains a standard static 4-colour image drawn on top. This is the more common technique in commercial DVDs — the "motion" comes from the video layer beneath a conventional highlight.

Both approaches can be combined: a button with localised video underneath _and_ animated highlights on top. The data model supports both independently.

### Constraints

- The subpicture overlay is still limited to the 4-colour CLUT palette per display set.
- Total subpicture bitrate must stay within DVD spec limits (~3.36 Mbit/s peak).
- Motion menu video + audio + subpicture must fit within the disc's capacity budget.
- Loop points should be frame-accurate to avoid visible jumps.

---

## Data Model

### Menu-Level Fields

```typescript
interface Menu {
	// ... existing fields ...

	/** Whether this menu uses a still frame or looping video background. */
	backgroundMode: 'still' | 'motion';

	/** For motion menus: duration of the loop in seconds. */
	motionDurationSecs: number | null;

	/** For motion menus: optional audio asset for background music/sound. */
	motionAudioAssetId: string | null;

	/** For motion menus: number of times to loop before executing the timeout action (0 = infinite). */
	motionLoopCount: number;

	/** Action to execute if the menu times out (motion menus only). */
	timeoutAction: PlaybackAction | null;
}
```

### Button-Level Fields

```typescript
interface MenuButton {
	// ... existing fields ...

	/** Whether button highlights are static or animated. */
	highlightMode: 'static' | 'animated';

	/**
	 * For animated highlights: keyframes defining highlight appearance at
	 * specific timestamps within the motion loop. Each keyframe can override
	 * the button's highlight colour and opacity.
	 */
	highlightKeyframes: HighlightKeyframe[];

	/**
	 * Optional video asset whose content is composited into the menu's
	 * background video at this button's bounding rectangle. Used for
	 * motion buttons where the "animation" comes from a localised video
	 * region (e.g., a looping thumbnail preview) beneath a standard
	 * static highlight overlay.
	 *
	 * Only meaningful when the parent menu's backgroundMode is 'motion'.
	 * The video is cropped/scaled to fit the button bounds and composited
	 * into the menu background during the render step.
	 */
	videoAssetId: string | null;
}

interface HighlightKeyframe {
	/** Timestamp within the motion loop (seconds from start). */
	timestampSecs: number;

	/** Override select colour at this keyframe (null = use menu default). */
	selectColour: string | null;

	/** Override select opacity at this keyframe (null = use menu default). */
	selectOpacity: number | null;

	/** Override activate colour at this keyframe (null = use menu default). */
	activateColour: string | null;

	/** Override activate opacity at this keyframe (null = use menu default). */
	activateOpacity: number | null;
}
```

### Rust Equivalents

The Rust `models.rs` types mirror the TypeScript interfaces:

```rust
/// Whether a menu background is a still frame or looping video.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackgroundMode {
    Still,
    Motion,
}

impl Default for BackgroundMode {
    fn default() -> Self {
        Self::Still
    }
}
```

The `Menu` struct gains:

```rust
pub background_mode: BackgroundMode,
pub motion_duration_secs: Option<f64>,
pub motion_audio_asset_id: Option<String>,
pub motion_loop_count: u32,
pub timeout_action: Option<PlaybackAction>,
```

The `MenuButton` struct gains:

```rust
pub highlight_mode: HighlightMode,
pub highlight_keyframes: Vec<HighlightKeyframe>,
/// Optional video asset composited into the menu background at this button's bounds.
pub video_asset_id: Option<String>,
```

---

## Build Pipeline Changes

### Still Menu (Current)

1. Render background image → MPEG-2 still via `ffmpeg -loop 1 -t 1 ...`
2. Generate subpicture overlay from button bounds + highlight colours
3. Composite with `spumux`
4. dvdauthor `<pgc>` with `pause="inf"`

### Motion Menu (New)

1. Transcode background video asset → DVD-compliant MPEG-2 (same as title transcoding)
2. If any buttons have `videoAssetId` set, composite their video clips into the background at the button bounds using FFmpeg's `overlay` filter (scaled/cropped to fit)
3. Optionally transcode audio asset → AC-3
4. Mux video + audio into a single MPEG-PS
5. Generate subpicture overlay(s):
   - **Static highlights**: single `<spu>` element (same as still menus)
   - **Animated highlights**: multiple `<spu>` elements with `start`/`end` timestamps derived from keyframes
6. Composite with `spumux`
7. dvdauthor `<pgc>` with `<post> jump cell 1; </post>` for looping

Step 2 uses an FFmpeg filter graph like:

```
ffmpeg -i menu_bg.mpg -i button_video.mpg \
  -filter_complex "[1:v]scale=200:40[btn];[0:v][btn]overlay=260:100" \
  -c:v mpeg2video ... menu_composed.mpg
```

Multiple button videos are chained with additional overlay filters.

### Build Plan Job Types

New `BuildJob` variant:

```typescript
| {
    type: 'transcodeMotionMenu';
    menuId: string;
    menuName: string;
    videoAssetPath: string;
    audioAssetPath: string | null;
    outputPath: string;
    command: string[];
    label: string;
  }
```

### dvdauthor XML Changes

Still menu PGC (current):

```xml
<pgc pause="inf">
  <vob file="menu_bg.mpg" pause="inf" />
</pgc>
```

Motion menu PGC (new):

```xml
<pgc>
  <vob file="menu_motion.mpg" />
  <post> jump cell 1; </post>
</pgc>
```

With timeout (plays first title after 3 loops of a 15-second menu = 45 seconds):

```xml
<pgc>
  <vob file="menu_motion.mpg" />
  <post>
    g1 = g1 + 1;
    if (g1 ge 3) { jump title 1; }
    jump cell 1;
  </post>
</pgc>
```

---

## UI Changes

### Menu Editor

1. **Background mode toggle**: radio buttons for "Still" vs "Motion" below the background asset dropdown.
2. **Motion settings panel** (visible when mode = motion):
   - Video asset selector (reuses the background asset dropdown — the selected asset's video stream becomes the loop)
   - Audio asset selector (optional, for background music)
   - Loop duration display (read from the video asset's duration)
   - Loop count input (0 = infinite)
   - Timeout action dropdown (same as end-action: play title, show menu, stop)
3. **Canvas preview**: when in motion mode, show a "Motion" badge on the canvas. Full video preview is a future enhancement.

### Button Properties

1. **Highlight mode toggle**: "Static" (default) or "Animated" per button.
2. **Keyframe editor** (visible when mode = animated):
   - Timeline bar showing the motion loop duration
   - Add/remove keyframe markers at specific timestamps
   - Per-keyframe colour + opacity overrides
   - Preview swatch strip showing interpolated colours across the timeline

### Validation

- Motion menu must have a video asset assigned (error)
- Motion menu video asset must have a video stream (error)
- Motion menu audio asset must have an audio stream (warning if video has no audio and no separate audio assigned)
- Animated button keyframes must be within the motion duration (error)
- Animated button keyframes should be ordered by timestamp (auto-sort)
- Loop count of 0 (infinite) with no timeout action raises a warning (user may get stuck)
- Button `videoAssetId` on a still menu is ignored with a warning (only applies to motion menus)
- Button `videoAssetId` asset must have a video stream (error)
- Button video should have duration ≥ motion loop duration (warning if shorter — will freeze on last frame)

---

## Migration

Since these are new optional fields with sensible defaults (`backgroundMode: 'still'`, `highlightMode: 'static'`, empty keyframes), no schema migration is needed. The `#[serde(default)]` attribute on Rust structs and optional fields in TypeScript handle backward compatibility automatically.

---

## Implementation Order

1. Add placeholder fields to `Menu` and `MenuButton` (Rust + TS) with defaults — **Stage 1 (current)**
2. Add background mode toggle UI and motion settings panel — **Stage 2.2**
3. Extend build pipeline for motion menu transcoding and looping PGC — **Stage 2.2**
4. Add animated highlight keyframe editor — **Stage 2.2**
5. Add `spumux` multi-timestamp subpicture generation — **Stage 2.2**
6. Motion menu video preview in canvas — **Stage 5.3**
