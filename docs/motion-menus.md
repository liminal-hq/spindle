# Motion Menus and Animated Highlights

## Overview

DVD-Video supports two types of menu presentation, and Spindle now builds both:

1. **Still menus** — a single MPEG-2 still frame displayed indefinitely
2. **Motion menus** — a looping MPEG-2 video background (optionally preceded by a one-shot intro segment) with an audio bed and multiplexed subpicture highlights

On top of motion menus, **animated button highlights** replace the single static subpicture overlay with a keyframed schedule of overlay images, lowered to multiple timestamped `<spu>` entries (spumux's DCSQ route — see `docs/dcsq-player-compat.md` for the player-compatibility research that picked this route over a raw DCSQ writer).

This document describes the implemented model, build pipeline, editor UI, and validation rules, and explicitly records what is _not_ built yet (see [Known gaps](#known-gaps-and-deferred-work)). The implementation lives in `plugins/tauri-plugin-spindle-project` (`src/build/menu_motion.rs`, `src/build/planner/animation.rs`, `src/build/authoring/menu.rs`, `src/models/animation.rs`) and `apps/spindle/src/components/menus/timeline/`.

---

## DVD-Video Technical Background

### Motion Menu Structure

A DVD motion menu is a standard menu VOB domain containing:

- **Video stream**: a looping MPEG-2 clip. The player loops playback via a PGC `<post>` command that jumps back to the loop cell when the cell finishes.
- **Audio stream**: background music or ambient sound. Spindle always encodes AC-3, even when the bed is synthesized silence — dvdauthor requires every cell in a PGC to share an identical stream layout.
- **Subpicture stream**: the button highlight overlay, composited by `spumux` with timing synchronised to the video.

Spindle authors an optional **intro cell** ahead of the loop cell: the same PGC carries two `<vob>` elements (intro = cell 1, loop = cell 2), the intro plays once, and the `<post>` loops only the loop cell. The intro cell carries no subpicture stream — buttons appear when the loop cell starts, which is standard commercial-DVD behaviour, and dvdauthor tolerates the missing SPU stream on the intro cell.

### Constraints

- The subpicture overlay is limited to a 4-colour CLUT per display set — one highlight colour for the whole menu at any instant, not one per button.
- Total subpicture bitrate must stay within DVD spec limits (~3.36 Mbit/s peak); every animated-highlight keyframe is a full re-rendered overlay image, so dense schedules are flagged by validation.
- Loop cuts happen at GOP granularity, so perfectly seamless loops are impossible; closed GOPs (`-flags +cgop`) keep the cut clean.

---

## Data Model

All motion and animation state lives on `MenuDocument` (the single authored menu model — see `CLAUDE.md`). The legacy flat fields this document once specified (`Menu.backgroundMode`, `Menu.motionDurationSecs`, `Menu.motionAudioAssetId`, `Menu.motionLoopCount`, `Menu.timeoutAction`, and per-button `highlightMode`/`highlightKeyframes`) are deserialize-only compatibility shims, lifted into the document on load.

### Timing — `MenuDocument.timing`

```typescript
/** Timing and motion rules for the menu. */
interface MenuTiming {
	introStartSecs: number;
	introDurationSecs: number; // 0 = no intro segment
	loopStartSecs: number;
	loopDurationSecs: number; // <= 0 = unset (motion menus must author one)
	loopCount: number; // 0 = infinite
	/** Optional audio asset for motion menu background music. */
	audioAssetId: string | null;
}
```

- `MenuDocument.backgroundMode` (`'still' | 'motion'`) selects the presentation; the background video is the scene's background asset (`scene.background.assetId`), not a separate field.
- The intro and loop windows are both source-relative offsets into the background video (`introStartSecs`/`introDurationSecs`, `loopStartSecs`/`loopDurationSecs`).
- The timeout action lives on the interaction graph (`interaction.timeoutAction`), reusing the standard `PlaybackAction` model.

The Rust twin is `MenuTiming` in `src/models/menu.rs`.

### Animation tracks — `MenuDocument.animation`

```typescript
interface AnimationTrack {
	nodeId: string; // a scene-node id, typically a Button
	target: AnimatableProperty;
	keyframes: Keyframe[];
}

type AnimatableProperty =
	| 'highlight-colour'
	| 'highlight-opacity'
	| 'activate-colour' // DVD: spumux's "select" (activated/pressed) state colour
	| 'activate-opacity' // the activated-state counterpart to activate-colour
	| 'opacity'
	| 'position';

interface Keyframe {
	timestampSecs: number; // loop-relative seconds
	value: KeyValue;
	easing: Easing; // applied to the segment FOLLOWING this keyframe
}

type KeyValue =
	| { kind: 'colour'; hex: string } // #rrggbb or #rrggbbaa
	| { kind: 'scalar'; value: number }
	| { kind: 'point'; x: number; y: number };

type Easing = 'linear' | 'hold' | 'ease-in' | 'ease-out' | 'ease-in-out';
```

The Rust model and evaluator live in `src/models/animation.rs` (`evaluate_track`, `sample_at_keyframes`); the TypeScript twin is `apps/spindle/src/utils/animation.ts`. The two implementations are pinned bit-for-bit equal by the shared fixture `fixtures/animation-parity.json`, exercised by both a Rust test and a vitest suite.

Evaluator semantics:

- An empty track has no value; before the first keyframe the first value is clamped; after the last keyframe the last value is clamped.
- Between two keyframes, the _earlier_ keyframe's easing reshapes `u = (t − t0) / (t1 − t0)`: `linear` lerps, `ease-in` is `u²`, `ease-out` is `1 − (1 − u)²`, `ease-in-out` is the smoothstep `3u² − 2u³`.
- `hold` steps: the segment keeps the earlier keyframe's value with no interpolation. This is the sampling mode the DCSQ lowering effectively uses — the disc schedule samples _at_ keyframe timestamps, where every easing yields the keyframe's own value exactly, so the on-disc result is exact by construction.
- Colour interpolation is a componentwise sRGB u8 lerp, round-half-up per channel; alpha is carried iff either endpoint has it.

`highlight-colour`/`highlight-opacity` and `activate-colour`/`activate-opacity` tracks are lowered to a DVD build today — the highlight pair drives spumux's "highlight" (focused/selected) state, the activate pair drives spumux's "select" (activated/pressed) state; `opacity` and `position` are modelled (and previewed nowhere yet) but draw a validation warning on DVD projects because the subpicture overlay model cannot express them.

### Migration

`MenuDocument::lift_highlight_keyframes` lifts the legacy per-button `highlightKeyframes` arrays into `AnimationTrack`s (one `highlight-colour` track per animated button, plus a `highlight-opacity` track when any keyframe overrode select opacity — and, mirroring that pair, an `activate-colour` track plus an `activate-opacity` track when any keyframe overrode activate opacity — all with `hold` easing), then clears the source arrays. It runs from `SpindleProjectFile::migrate_all_menus` — the idempotent load hook invoked on every IPC entry — so by the time validation or the planner sees a document, tracks are the only place animation lives. New optional fields default cleanly via `#[serde(default)]`, so no schema version bump was needed.

---

## Build Pipeline

### No new job type

Motion menus ride the existing `BuildJob::RenderMenu` job: it gains `introCommand: Option<Vec<String>>` and `durationSecs: Option<f64>` (both `#[serde(default)]`, mirroring `TranscodeTitle`'s `pass1_command` pattern). When `durationSecs` is set, the executor runs the intro command (if any) and then the loop command through the progress-reporting ffmpeg runner; when it is `None`, the still path runs unchanged. The hypothetical `transcodeMotionMenu` job type from the original design was never built — one job per menu keeps the plan shape stable.

### Segment composition (`build/menu_motion.rs`)

`plan_motion_segments` resolves the loop segment (always) and the intro segment (only when `introDurationSecs > 0`), then `build_ffmpeg_motion_segment_command` builds **one ffmpeg command per segment** that does trim + scene overlay + audio + encode + DVD mux with no intermediate files:

- **Trim**: input-side `-ss {start} -t {dur}` _before_ `-i {bg_video}` — frame-accurate with re-encode; never the `trim` filter.
- **Video**: `fps={fps}`, `scale={active}:{active}:out_color_matrix=bt601`, `pad` into the DVD raster, scene-PNG `overlay=0:0`, `setsar`.
- **Audio bed** — a three-way fallback chain:
  1. the authored bed asset (`timing.audioAssetId`), looped with `-stream_loop -1` and windowed with `atrim=start={off}:duration={dur},asetpts=PTS-STARTPTS,apad`;
  2. the background video's own audio, already time-aligned by the same input-side trim;
  3. synthesized silence (`-f lavfi -i anullsrc=r=48000:cl=stereo`).
- **Bed windows are continuous across intro+loop**: the intro plays bed `[0..introDur)` and the loop plays `[introDur..introDur+loopDur)`, so first-play audio doesn't hiccup at the intro/loop boundary. (On the second and later loop passes the bed restarts at its loop-window offset — an accepted artefact of cell-based looping.)
- **AC-3 always**: `-c:a ac3 -b:a 192k -ar 48000` in _both_ cells, silence included — dvdauthor rejects a PGC whose cells have differing stream layouts.
- **Encode**: `mpeg2video`, `-b:v 4000k -maxrate 7000k -bufsize 1835k`, `-g 18` (NTSC) / `-g 12` (PAL), `-flags +cgop` for a clean loop cut. ffmpeg's mpeg2video encoder cannot combine closed GOPs with scene-change-triggered GOP breaks, so scene-cut detection is disabled with `-sc_threshold 1000000000` — the workaround the encoder itself suggests, which also keeps every GOP exactly `-g` frames long.
- **Colour**: `dvd_colour_flags()` (`build/ffmpeg.rs`) tags `-color_primaries/-color_trc/-colorspace` as `smpte170m` (NTSC) or `bt470bg` (PAL), paired with `out_color_matrix=bt601` on the scale filter. _These flags are currently applied to motion composes only — the still-menu and title transcode retrofit is a pending follow-up._
- **Mux**: `-t {dur} -f dvd -muxrate 10080000`.

Outputs: the loop segment writes `{id}_base.mpg` (spumux input), the intro writes directly to the final `{id}_intro.mpg`.

The module deliberately does **not** introduce a `MenuCompiler` trait — a trait with one implementor would have forced still-path rewiring for zero value. `build/menu_motion.rs`'s module doc-comment is the seam: it maps each function to the future trait stage (`compose_background` ↔ `build_ffmpeg_motion_segment_command`; `mux` ↔ the spumux/dvdauthor emission).

### Subpicture pass

`spumux` runs on the **loop cell only**: the existing `ComposeMenuHighlights` job takes `{id}_base.mpg` and writes `{id}.mpg`, exactly as for still menus. The intro cell gets no subpicture pass at all.

### dvdauthor XML (`build/authoring/menu.rs`)

`append_menu_pgc` derives everything from the menu document — `MenuPgcSpec` needed no new fields.

Still menu PGC (unchanged):

```xml
<pgc>
  <vob file="menu.mpg" pause="inf" />
</pgc>
```

Motion menu with intro, loop count K = 3 and a timeout action:

```xml
<pgc>
  <pre>
    g1 = 0;
  </pre>
  <vob file="menu_intro.mpg" />
  <vob file="menu.mpg" />
  <post>
    g1 = g1 + 1; if (g1 lt 3) { jump cell 2; } g1 = 0; jump title 1;
  </post>
</pgc>
```

- Motion `<vob>`s carry **no** `pause` attribute. With an intro the loop target is `cell 2`; without one it is `cell 1`.
- `loopCount == 0` lowers to a bare `<post> jump cell N; </post>` — infinite loop, no counting.
- The loop counter is **`g1`** — `g0` is already taken by the titleset menu-dispatch mechanism (`build/dvd_navigation.rs`). When counting, `g1 = 0;` is prepended to `<pre>` so re-entering the menu resets the counter.
- The timeout command comes from the same `PlaybackAction` resolver as button actions, with the same compound-command/semicolon handling.
- `loopCount > 0` with **no** timeout action degrades to the infinite `jump cell N;` form — a `<post>` must never fall off the end — and `menu.motion-loop-count-without-timeout` warns about the authored mismatch.

---

## Animated Button Highlights (DCSQ lowering)

### Schedule (`build/planner/animation.rs`)

For each menu, the planner builds an `overlayKeyframes` schedule of `OverlayKeyframeSpec` entries (`{ startSecs, endSecs, highlightImagePath, selectImagePath, highlightColour, selectColour }`) carried on `RenderMenu`:

- The **relevant tracks** split into two groups by target: `highlight-colour`/`highlight-opacity` tracks (spumux's "highlight" state) and `activate-colour`/`activate-opacity` tracks (spumux's "select" state), each restricted to keyframes whose `nodeId` is one of the menu's buttons.
- The schedule's instants are the **union of every relevant track's keyframe timestamps, across both groups**, each individually clamped to `loopDuration − 1 frame` (`frame_duration_secs = 1 / standard.frame_rate()` — the last timestamp a frame can actually start displaying at, since playback wraps back to `0` before a later one would ever be reached), then sorted, deduped, always including `0.0`.
- At each instant, the highlight-group tracks are sampled with `evaluate_track` and folded onto the menu's default highlight colour/opacity, and the activate-group tracks are sampled and folded onto the default activate colour/opacity; each resulting opacity is baked into its own alpha channel (`#rrggbbaa`).
- Each frame's `end` is the next instant; the **last** frame's `end` is the full, unclamped `loopDuration` — because its `start` is always at most `loopDuration − 1 frame`, this guarantees at least one frame's worth of length, so a spumux `<spu>` can never come out zero-length even for a keyframe authored exactly at `loopDuration`.
- Per-frame overlay image paths are `{base}_hl_k{i}.png` / `{base}_sel_k{i}.png`; the executor renders one highlight/select PNG pair per frame through the existing Skia overlay renderer (`generate_menu_overlay_images_for_keyframes`). Anti-aliasing stays off for every frame — spumux's ≤16-colour palette limit applies to each one.

**No tracks → byte-identical output.** A menu without relevant tracks gets a single trivial frame reusing today's `{base}_highlight.png`/`{base}_select.png` paths and the menu's default colours, and the spumux XML for that case is pinned by test to be byte-identical to a build with no animation support at all.

### spumux XML (`build/menu.rs::generate_spumux_xml`)

A multi-frame schedule emits one `<spu start=".." end=".." image=".." highlight=".." select=".." transparent="#000000" force="yes">` per frame, with **identical `<button>` children repeated in every `<spu>`** — button rectangles and nav links don't change across keyframes, only the highlight artwork does. Timestamps are `hh:mm:ss.mmm` via `format_spu_timestamp`. The single-frame case keeps the original `end`-less form with the hardcoded `start="00:00:00.00"`.

### Degrades and limits

- **Still menu with tracks**: a still menu's video decode freezes after its first frame and can never reach a later keyframe, so the schedule degrades to a single frame baking in only each track's _first_ keyframe. `menu.animation-on-still-menu` (a warning) names the degrade; the build proceeds regardless — the feature never blocks a build.
- **One CLUT per menu**: DVD has one highlight colour for the whole menu at any instant. When more than one button carries a relevant track, every track is sampled at each instant and the _last_-listed track in `doc.animation` wins ties. In practice a menu authors at most one animated highlight track.
- **`opacity`/`position` tracks** are not lowered on DVD (warning `menu.animation-unsupported-property`).

---

## Editor UI

- **Inspector motion settings**: background mode toggle, loop start / intro start / intro duration numeric fields, loop count, audio bed picker, and a timeout-action select reusing the button-action option list.
- **Canvas video preview**: a motion menu's background renders as a real `<video>` element (`convertFileSrc` over the asset's source path), seeked to the loop start in design mode. Playback state lives in a dedicated zustand store (`store/menu-playback-store.ts`), outside the project store so scrubbing never enters undo history; the playhead is driven by a rAF loop (`useVideoPlayhead`), not the ~4 Hz `timeupdate` event.
- **Timeline strip** (`components/menus/timeline/`): mounted below the canvas, visible when the menu is motion or has any animation track. It comprises a ruler (click = seek), an intro/loop region bar (drag edges = retime the timing fields), a scrubber with transport controls (play/pause, ±1 frame step, loop-region toggle), a static audio-bed lane, and one keyframe lane per animated node (drag ◆ to retime, double-click for the value/easing/timestamp popover, double-click an empty lane to insert a keyframe sampling the current value). Drags live-preview locally and commit once on pointer-up — one undo entry. All writes go through `updateMenuDocument`. The ±1 frame step and drag snapping are standard-aware: `fpsForStandard` (`components/menus/timeline/useTimelineGeometry.ts`) resolves NTSC's exact `30000/1001` or PAL's `25`, rather than a hardcoded 30 fps.
- **Preview animates**: the navigation preview samples colours from the menu's animation tracks — `highlight-colour`/`highlight-opacity` for the focused state, `activate-colour`/`activate-opacity` for the activated state, with opacity baked into the outline's alpha for the activated state, mirroring the disc's alpha-baked `select_colour` — via the shared evaluator, falling back to the menu's static highlight colours when there's no track (`sampleTrackForPreview`/`sampleHonestPreview`/`sampleHonestFold` in `components/menus/timeline/timelineUtils.ts`). Sampling mirrors the disc's own fidelity rules: a still menu with tracks previews only the track's first keyframe regardless of playhead, matching the disc's still-menu degrade path (`build_overlay_keyframe_schedule`); a motion menu previews each button's own track, continuously eased, by default — a friendlier view than the disc produces — or, with honest preview enabled, folds every button's relevant track into the SAME menu-wide value (document-order last-track-wins, matching the disc's one CLUT) and quantises to the disc's actual DCSQ schedule boundary — the union of every relevant track's keyframe timestamps across BOTH the highlight and activate groups together, matching the planner exactly.
- **Keyframes are loop-relative; video time is source-relative**: `tLoop = video.currentTime − loopStartSecs`.
- **Asset scope**: the webview's asset protocol is granted access to _exactly the imported assets' source paths_, at runtime — `allowAssetScope` (plugin command `allow_asset_scope`) is called on project open with all asset paths, and again on import and relink with the new paths. Grants are cumulative and persisted across restarts (`tauri_plugin_persisted_scope`), so the scope is the union of every path ever granted, not a per-session allowlist (revocation is tracked as issue #129); the static scope stays confined to the app cache/data directories. This is what lets `<video>`/thumbnail previews read source media without widening the static filesystem scope.

---

## Validation

Current motion and animation validation codes (ground truth: `src/validation/menu.rs` and `src/validation/scene.rs`):

| Code                                      | Severity | Meaning                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `menu.motion-missing-background`          | Error    | Motion menu has no background video asset assigned.                                                                                                                                                                                                                                                     |
| `menu.motion-background-no-video-stream`  | Error    | Motion menu's background asset has no video stream.                                                                                                                                                                                                                                                     |
| `menu.motion-no-audio-bed`                | Warning  | No authored audio bed and the background video carries no audio (the build will use silence).                                                                                                                                                                                                           |
| `menu.motion-invalid-duration`            | Error    | Loop duration is not > 0 seconds.                                                                                                                                                                                                                                                                       |
| `menu.motion-loop-start-default`          | Warning  | Loop start is still 0.0 s, which causes a visible restart cut on each loop.                                                                                                                                                                                                                             |
| `menu.motion-audio-dangling`              | Error    | The audio bed references an asset that no longer exists.                                                                                                                                                                                                                                                |
| `menu.motion-audio-no-stream`             | Error    | The audio bed asset has no audio stream.                                                                                                                                                                                                                                                                |
| `menu.motion-loop-exceeds-source`         | Error    | `loopStart + loopDuration` runs past the end of the background asset (when its duration is known).                                                                                                                                                                                                      |
| `menu.motion-intro-invalid`               | Error    | Intro duration is negative, or the intro window runs past the end of the background asset.                                                                                                                                                                                                              |
| `menu.motion-loop-count-without-timeout`  | Warning  | Loop count > 0 but no timeout action — the disc will loop forever instead of stopping after N plays.                                                                                                                                                                                                    |
| `menu.animation-node-missing`             | Error    | An animation track targets a scene node that no longer exists.                                                                                                                                                                                                                                          |
| `menu.animation-node-not-compiled`        | Warning  | An animation track targets a button nested inside a group — group-nested buttons aren't compiled to the disc yet, so the track has no effect.                                                                                                                                                           |
| `menu.animation-empty-track`              | Warning  | An animation track has no keyframes yet.                                                                                                                                                                                                                                                                |
| `menu.animation-keyframe-invalid`         | Error    | An animation keyframe has a non-finite (`NaN`/`Infinity`) timestamp.                                                                                                                                                                                                                                    |
| `menu.animation-unsupported-property`     | Warning  | An `opacity`/`position` track on a DVD project — the subpicture model cannot express it.                                                                                                                                                                                                                |
| `menu.animation-on-still-menu`            | Warning  | Animation tracks on a still menu; names the first-keyframe-only degrade. Build proceeds.                                                                                                                                                                                                                |
| `menu.motion-keyframe-out-of-range`       | Error    | A keyframe falls outside the motion loop window.                                                                                                                                                                                                                                                        |
| `menu.motion-keyframes-out-of-order`      | Error    | A track's keyframes are not in chronological order.                                                                                                                                                                                                                                                     |
| `menu.animation-keyframe-density`         | Warning  | The overlay schedule — unioned across all four properties (highlight-colour/-opacity and activate-colour/-opacity, the same union the DCSQ lowering shares into one schedule) — exceeds ~1 frame/second; each frame is a full re-rendered subpicture image, risking the ~3.36 Mbit/s subpicture budget. |
| `menu.button-video-ignored-on-still-menu` | Warning  | A button has a video asset but the menu is authored as still.                                                                                                                                                                                                                                           |
| `menu.button-video-no-stream`             | Error    | A button's video asset has no video stream.                                                                                                                                                                                                                                                             |
| `menu.scene-dangling-button-video`        | Error    | A button references a video asset that no longer exists.                                                                                                                                                                                                                                                |

---

## Known gaps and deferred work

- **`MenuCompiler` trait deferred.** The build system is a serializable job list, and a trait with one implementor buys nothing today. The module seam in `build/menu_motion.rs` documents the future carve (`render_states → compose_background → mux`); the trait lands when a second backend (BD) exists to justify it.
- **BD motion backend not built.** Everything here is the DVD lowering; the Blu-ray path (IGS, per-state bitmaps, frame-sequence animation) is future work tracked in `docs/rich-menu-editor-plan.md` and `docs/lib-igs-author-plan.md`.
- **Video buttons (motion thumbnails) are model-only.** `SceneNode::Button.videoAssetId` and `SceneNode::Video` exist and are validated, but nothing composites per-button video into the motion background yet — that is Slice E (#109).
- **Colour flags are motion-only.** `dvd_colour_flags()` is applied to motion composes; retrofitting the still-menu and title transcode commands is a pending follow-up (kept out of the motion stack to avoid pinned-test churn).
- **`opacity`/`position` tracks don't lower on DVD** — authoring them is possible, the disc ignores them, and validation says so.
- **Render parity and rich visual properties (Slice B)** remain pending (#53, #106); themes (Slice F, #110) are untouched.
