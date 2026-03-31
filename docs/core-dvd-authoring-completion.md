# Core DVD Authoring Completion

_Plan drafted March 30, 2026. This document will be updated as work is implemented: planning material will be removed and replaced with specification-grade descriptions of the final behaviour._

## Goal

Complete the core DVD authoring workflow and strengthen trust in the authoring process. When this work is done, Spindle should handle a real-world DVD project end to end — including subtitles, titlesets, scene selection menus, intelligent chapter seeding, per-stream compatibility reasoning, and validation that helps users fix problems rather than just listing them.

## Scope

Seven work items, grouped into two phases:

**Phase A — Complete the core authoring path**

1. Better default chapter seeding and import
2. Chapter-targeted menu actions
3. Reversible subtitle selection UX
4. Subtitle authoring and export pipeline
5. Titleset authoring workflow

**Phase B — Improve trust and guidance**

6. Trustworthy compatibility explanations
7. Validation with fix-oriented guidance

---

## Phase A: Complete the Core Authoring Path

### A1. Better Default Chapter Seeding and Import

#### Problem

Chapter editing is entirely manual today. Users must click "Add Chapter" and type timestamps by hand, even when their source media already contains chapter markers. This is tedious and error-prone for media ripped from existing discs or exported from editing software with chapter metadata.

#### Current state

- `ChaptersPage.tsx` provides manual add/edit/remove with a timeline visualisation.
- `inspect.rs` runs ffprobe but does not pass `-show_chapters`, so chapter metadata is never extracted.
- The `FfprobeOutput` struct has no `chapters` field.
- The `InspectionResult` / `AssetMetadata` types have no chapter data.

#### Planned behaviour

**Backend — chapter extraction during inspection**

Add `-show_chapters` to the ffprobe invocation in `inspect.rs`. Parse the returned chapter array into a new `SourceChapter` structure:

```
SourceChapter {
  start_secs: f64,
  end_secs: f64,
  title: Option<String>,
}
```

Store extracted chapters on `AssetMetadata` as `source_chapters: Vec<SourceChapter>`. Mirror this in the TypeScript `AssetMetadata` type.

**Frontend — auto-seeding on title creation**

When a source asset is assigned to a title (in `TitlesPage.tsx`), if the asset has source chapters and the title's chapter list is empty, auto-populate the title's chapters from the source metadata:

- Map each `SourceChapter` to a `ChapterPoint` using `start_secs` as the timestamp and `title` (or `Chapter N` fallback) as the name.
- Auto-seeded chapters are normal chapter points — fully editable, removable, and re-orderable.
- If the title already has chapters, do not overwrite them. Offer a "Re-seed from source" action in the chapter editor instead.

**Frontend — chapter editor enhancements**

Add a "Seed from source" button to `ChaptersPage.tsx` that appears when the title's source asset has chapter metadata. This replaces all current chapters after a confirmation prompt.

#### Files to change

| File | Change |
| --- | --- |
| `plugins/.../src/inspect.rs` | Add `-show_chapters` flag, parse chapter array, add `FfprobeChapter` struct, populate `source_chapters` on `AssetMetadata` |
| `plugins/.../src/models.rs` | Add `SourceChapter` struct, add `source_chapters: Vec<SourceChapter>` to `AssetMetadata` |
| `apps/.../src/types/project.ts` | Add `SourceChapter` interface, add `sourceChapters` to `AssetMetadata` |
| `apps/.../src/pages/TitlesPage.tsx` | Auto-seed chapters when asset assigned to empty-chapter title |
| `apps/.../src/pages/ChaptersPage.tsx` | Add "Seed from source" button with confirmation |

---

### A2. Chapter-Targeted Menu Actions

#### Problem

Scene selection is one of the most expected features on a DVD. The backend model fully supports `PlayChapter` actions and the DVD navigation code correctly generates `jump title N chapter M` commands. But the menu editor UI does not expose chapter targets — users can only assign "Play Title", "Show Menu", or "Stop" to buttons.

#### Current state

- `PlaybackAction` enum in `models.rs` includes `PlayChapter { title_id, chapter_id }`.
- `dvd_navigation.rs` generates correct DVD commands for `PlayChapter` across all menu domains (VMGM, titleset same/cross).
- `MenusPage.tsx` button action selector only has `playTitle`, `showMenu`, and `stop` options.
- `actionToString()` handles `playChapter` serialisation correctly.
- `stringToAction()` does **not** parse `playChapter:titleId:chapterId` — the split logic only handles a single `:` delimiter.

#### Planned behaviour

**Menu editor action selector**

Add a "Play Chapter" option group to the button action `<select>` in `MenusPage.tsx`. Structure it as a nested list: each title that has chapters becomes a group header, with individual chapters as selectable options.

```
Play Title
  ├─ Feature Film
  └─ Bonus Content
Play Chapter
  ├─ Feature Film
  │   ├─ Chapter 1 — Opening
  │   ├─ Chapter 2 — Act One
  │   └─ ...
  └─ Bonus Content
      ├─ Chapter 1
      └─ ...
Show Menu
  ├─ Main Menu
  └─ Scene Selection
Stop
```

The value format is `playChapter:{titleId}:{chapterId}`, consistent with the existing `actionToString()` output.

**Fix `stringToAction()` parser**

Update the parser to handle the three-segment `playChapter` format. Split on `:` with a limit of 3 and match accordingly:

- `playChapter:titleId:chapterId` → `{ type: 'playChapter', titleId, chapterId }`

**Title end-action selector**

Apply the same chapter-target options to the title end-action selector in `TitlesPage.tsx`, so a title can jump to a specific chapter of another title on completion.

#### Files to change

| File | Change |
| --- | --- |
| `apps/.../src/pages/MenusPage.tsx` | Add "Play Chapter" optgroup to action selector; fix `stringToAction()` parser |
| `apps/.../src/pages/TitlesPage.tsx` | Add chapter-target options to title end-action selector |

---

### A3. Reversible Subtitle Selection UX

#### Problem

When a source asset is assigned to a title, all detected subtitle streams are auto-mapped. Users can remove individual subtitle mappings, but there is no way to add them back. This makes subtitle selection effectively one-way — a removed track requires reassigning the source asset to restore it.

#### Current state

- `TitlesPage.tsx` auto-maps all subtitle streams on asset assignment (lines 311-319).
- The subtitle editor shows label, language, default/forced flags, and a remove button per track.
- There is no "add subtitle" flow.
- The source asset's `subtitleStreams` array is available from inspection data.

#### Planned behaviour

**Add subtitle track button**

Add an "Add Subtitle Track" control below the subtitle mapping list in the title editor. This opens a picker showing all subtitle streams from the title's source asset that are not already mapped.

Each option shows: stream index, codec, language, and title (matching the information shown during auto-mapping).

Selecting a stream creates a new `SubtitleTrackMapping` with the same defaults used during auto-mapping (language from source, label from title or language, `isDefault: false`, `isForced: false`).

**Edge cases**

- If all source streams are already mapped, the add button is disabled with a tooltip: "All subtitle streams from this asset are already mapped."
- If no source asset is assigned, the subtitle section shows a note instead of the editor.
- The DVD 8-subtitle limit warning already exists and continues to apply.

#### Files to change

| File | Change |
| --- | --- |
| `apps/.../src/pages/TitlesPage.tsx` | Add subtitle stream picker, filter to unmapped streams, create mapping on selection |

---

### A4. Subtitle Authoring and Export Pipeline

#### Problem

Subtitle streams can be detected, inspected, and mapped in the UI, but the build pipeline does not actually include subtitle tracks in the authored disc output. This is the most significant gap in the current DVD authoring path — subtitles are a core feature of real-world discs.

#### Current state

- Subtitle streams are detected and classified (bitmap/text/unknown) during inspection.
- Subtitle mappings are stored on titles with language, label, default, and forced flags.
- `ffmpeg.rs` does not include subtitle stream mapping (`-map`) or codec flags (`-c:s`).
- `authoring.rs` does not generate `<subpicture>` elements in the dvdauthor XML.
- `planner.rs` does not account for subtitle streams in build planning.

#### Planned behaviour

**DVD subtitle format constraints**

DVD-Video subtitles are bitmap-based subpictures. The pipeline must handle two source types differently:

- **Bitmap subtitles** (dvd_subtitle, dvdsub): Can be extracted and converted to DVD subpicture format directly. These are the most common case for DVD-sourced media.
- **Text subtitles** (srt, subrip, ass, ssa): Must be rendered to bitmap subpictures before authoring. This requires either a text-to-image rendering step or delegating to a tool that can handle it.

For the initial implementation, support bitmap subtitle passthrough as the primary path. Text subtitle rendering is a larger scope item that can follow.

**Build planner changes**

Add subtitle awareness to the build plan:

- For each title with subtitle mappings, generate subtitle extraction jobs.
- Bitmap subtitles: extract from source using ffmpeg to a format spumux can consume (VOBsub .sub/.idx pairs or raw subpicture streams).
- Track the subtitle prep jobs in `BuildSummary` for progress reporting.

**FFmpeg subtitle extraction**

Add a subtitle extraction step to `ffmpeg.rs`:

- For bitmap subtitles: `ffmpeg -i source.mkv -map 0:{subtitleStreamIndex} -c:s dvd_subtitle output.sub`
- Generate one subtitle file per mapped subtitle track per title.

**dvdauthor XML generation**

Update `authoring.rs` to include subtitle tracks in the VOB elements:

- For each title's subtitle mappings, generate `<subpicture>` stream definitions.
- spumux XML generation for subtitle overlay integration.
- Respect the subtitle ordering, default flag, and language metadata.

**Subtitle metadata in dvdauthor**

The `<subpictures>` element in dvdauthor XML specifies subtitle stream properties:

```xml
<subpictures>
  <stream id="0" mode="normal" />
</subpictures>
```

Each mapped subtitle track becomes a stream entry with its language attribute.

**Validation additions**

- Warning if a title has text-only subtitles (not yet supported for DVD authoring).
- Warning if subtitle count exceeds 32 subpicture streams (DVD limit is 32, practical limit often 8 per the existing UI cap).
- Error if a mapped subtitle stream index no longer exists on the source asset.

#### Files to change

| File | Change |
| --- | --- |
| `plugins/.../src/build/planner.rs` | Add subtitle extraction jobs to build plan, track in summary |
| `plugins/.../src/build/ffmpeg.rs` | Add subtitle extraction command generation |
| `plugins/.../src/build/authoring.rs` | Generate subpicture/spumux XML for subtitle tracks |
| `plugins/.../src/build/types.rs` | Add `ExtractSubtitles` job type |
| `plugins/.../src/models.rs` | Add any needed subtitle build metadata |
| `apps/.../src/types/project.ts` | Mirror any new build job types for progress UI |
| `apps/.../src/pages/BuildPage.tsx` | Show subtitle extraction progress in build UI |

---

### A5. Titleset Authoring Workflow

#### Problem

DVD titlesets are a real structural concept — titles within a titleset share video format properties (resolution, frame rate, aspect ratio), and each titleset can have its own menus. The backend model and dvdauthor XML generation fully support multiple titlesets, but the UI hardcodes `titlesets[0]` and provides no way to create, manage, or move titles between titlesets.

#### Current state

- `Disc` contains `titlesets: Vec<Titleset>`, each with `titles` and `menus`.
- Project initialisation creates one default titleset.
- `TitlesPage.tsx` reads `project.disc.titlesets[0]` only.
- `MenusPage.tsx` reads global menus from `project.disc.menus` only.
- `authoring.rs` correctly iterates all titlesets when generating dvdauthor XML.
- `dvd_navigation.rs` handles cross-titleset navigation correctly.

#### Planned behaviour

**Titleset management UI**

Add a titleset selector to the titles page. This appears above the title list and shows all titlesets with their names. Users can:

- **Rename** a titleset by clicking its name.
- **Add** a new titleset.
- **Remove** an empty titleset (non-empty titlesets cannot be deleted without first moving or removing their titles).

The current title list, chapter editor, and detail panel scope to the selected titleset.

**Moving titles between titlesets**

Titles can be moved between titlesets via a context menu action or a "Move to titleset" control in the title detail panel. When a title is moved:

- Its chapter list, stream mappings, and end action move with it.
- If the title's end action references a titleset-scoped menu that no longer applies, show a validation warning.
- The title's `orderIndex` is updated to append at the end of the destination titleset.

**Titleset-scoped menus**

Each titleset has its own `menus` array. The menu editor should show which titleset a menu belongs to, and menu creation should let the user choose between a global (VMGM) menu and a titleset-scoped menu.

- Global menus live on `disc.menus` and appear in the VMGM domain.
- Titleset menus live on `titleset.menus` and appear in that titleset's menu domain.
- The menu action selector should distinguish between global and titleset menus.
- Button actions that reference titles should be aware of cross-titleset navigation implications.

**Format compatibility grouping**

Titlesets exist in DVD to group titles with compatible video formats. Add an informational note to the titleset UI explaining this constraint, and add a validation warning when titles within a titleset have mismatched video output profiles (different resolution, aspect ratio, or TV standard).

**Default behaviour**

Most simple projects (single feature, one format) will continue to use a single titleset. The UI should not force users to think about titlesets unless they need them. The default project starts with one titleset named "Main", and the titleset selector is compact when only one exists.

#### Files to change

| File | Change |
| --- | --- |
| `apps/.../src/pages/TitlesPage.tsx` | Add titleset selector, scoped title list, move-title action |
| `apps/.../src/pages/MenusPage.tsx` | Add titleset-scoped menu creation and display, update action selectors |
| `apps/.../src/pages/ChaptersPage.tsx` | Scope chapter editing to selected titleset's titles |
| `apps/.../src/store/project-store.ts` | Add titleset CRUD helpers if needed |
| `apps/.../src/types/project.ts` | No schema changes needed — types already support multiple titlesets |
| `plugins/.../src/desktop.rs` | Add titleset format-mismatch validation rule |
| `plugins/.../src/models.rs` | No schema changes needed |

---

## Phase B: Improve Trust and Guidance

### B6. Trustworthy Compatibility Explanations

#### Problem

The asset list shows a one-word compatibility badge ("Remux OK", "Transform", "Re-encode", "Unsupported") but does not explain why. Users cannot tell which specific properties of their source file triggered the assessment, what the build will actually do to their media, or what they could change to get a better result.

#### Current state

- `inspect.rs` runs `assess_dvd_compatibility()` which checks: container format, video codec, resolution, frame rate, and audio codec.
- The result is a single enum: `RemuxCompatible`, `TransformCompatible`, `ReEncodeRequired`, or `Unsupported`.
- `AssetsPage.tsx` shows this as a coloured badge with a short label.
- No per-stream breakdown is provided.
- No guidance on what would change the assessment.

#### Planned behaviour

**Per-stream compatibility breakdown**

Replace the single assessment with a structured breakdown that evaluates each relevant property independently:

```
CompatibilityDetail {
  overall: CompatibilityAssessment,
  video: StreamCompatibility {
    codec: { value: "h264", dvd_requires: "mpeg2video", action: "re-encode" },
    resolution: { value: "1920x1080", dvd_requires: "720x480 or 720x576", action: "scale" },
    frame_rate: { value: "23.976", dvd_compatible: true, action: "none" },
  },
  audio_streams: Vec<StreamCompatibility { ... }>,
  container: { value: "matroska", dvd_requires: "mpeg-ps", action: "remux" },
  subtitle_notes: Vec<String>,
}
```

Each property includes:
- The source value
- What DVD requires
- What action the build will take (none, remux, re-encode, scale, convert)

**UI — expanded compatibility view**

Add an expandable detail section below the compatibility badge in the asset detail panel. When expanded, it shows:

- A table of properties with source value, DVD requirement, and planned action.
- Colour coding: green for compatible properties, amber for properties that need transformation, red for properties that force re-encoding.
- A plain-language summary sentence, e.g.: "This file's H.264 video and 1080p resolution require full re-encoding to DVD-compatible MPEG-2 at 720x480. The AC3 audio can be copied directly."

**UI — title-level compatibility summary**

On the title detail panel in `TitlesPage.tsx`, show a compact compatibility summary for the assigned asset that reflects the chosen output profile. This helps users understand how their profile selection (resolution, TV standard) interacts with the source material.

**No override controls yet**

This item adds explanation only, not user-controllable overrides for encoding decisions. Encoding overrides (e.g., choosing to copy a stream that the planner would re-encode) are a future enhancement.

#### Files to change

| File | Change |
| --- | --- |
| `plugins/.../src/inspect.rs` | Generate `CompatibilityDetail` with per-property breakdown |
| `plugins/.../src/models.rs` | Add `CompatibilityDetail`, `StreamCompatibility`, and related structs |
| `apps/.../src/types/project.ts` | Mirror new compatibility detail types |
| `apps/.../src/pages/AssetsPage.tsx` | Add expandable compatibility detail view below badge |
| `apps/.../src/pages/TitlesPage.tsx` | Add compact compatibility summary to title detail panel |

---

### B7. Validation with Fix-Oriented Guidance

#### Problem

Validation catches a useful set of structural issues (missing assets, dangling references, empty menus, chapter ordering problems), but the messages are informational only. Users must read the message, figure out which entity is affected, navigate to the right page, and determine the fix themselves. A workspace-first tool should close that loop.

#### Current state

- `desktop.rs` runs validation and returns `Vec<ValidationIssue>` with severity, code, message, and an optional `context` string (usually an entity ID).
- `OverviewPage.tsx` lists all issues in a colour-coded list.
- `BuildPage.tsx` shows error count and blocks build on errors.
- Issues have no navigation links, no suggested fixes, and no "fix this" actions.

#### Planned behaviour

**Structured issue context**

Expand `ValidationIssue` to include richer context:

```
ValidationIssue {
  severity: IssueSeverity,
  code: String,
  message: String,
  context: Option<String>,           // existing — entity ID
  entity_type: Option<String>,       // new — "title", "menu", "chapter", "asset", "titleset"
  entity_name: Option<String>,       // new — human-readable name for display
  suggested_fix: Option<String>,     // new — plain-language fix description
}
```

**Fix descriptions by validation rule**

| Code | Current message style | Suggested fix |
| --- | --- | --- |
| `title.no-source` | "Title has no source asset" | "Assign a source media file to this title in the title editor." |
| `title.dangling-source` | "Source asset not found" | "The source file may have been moved or deleted. Relink or replace the asset in the asset library." |
| `title.no-video-mapping` | "No video stream selected" | "Select a video stream in the title editor." |
| `title.no-output-profile` | "No output profile selected" | "Choose a video output profile (resolution and TV standard) in the title editor." |
| `chapter.non-increasing` | "Chapter timestamps not in order" | "Reorder or adjust chapter timestamps so they increase monotonically." |
| `chapter.beyond-duration` | "Chapter beyond asset duration" | "Remove or move this chapter point — it is past the end of the source media." |
| `menu.no-buttons` | "Menu has no buttons" | "Add at least one button to this menu, or remove the menu if it is not needed." |
| `menu.no-default-button` | "No default button set" | "Set a default button so the menu highlights correctly when first shown." |
| `menu.button-no-action` | "Button has no action" | "Assign a play or navigation action to this button." |
| `menu.dangling-title-ref` | "Button references missing title" | "The target title was deleted. Update or remove this button action." |
| `menu.dangling-menu-ref` | "Button references missing menu" | "The target menu was deleted. Update or remove this button action." |
| `menu.dangling-nav-ref` | "Navigation links to missing button" | "A directional navigation link points to a button that no longer exists. Re-run auto-navigation or fix manually." |
| `disc.no-first-play` | "No first-play action set" | "Set a first-play action on the overview page so the disc has a defined startup behaviour." |
| `build.no-output-dir` | "No output directory set" | "Set an output directory in build settings before building." |

**Frontend — clickable issue navigation**

Each validation issue in the overview and build pages becomes a clickable row. Clicking navigates to the relevant page and, where possible, selects the affected entity:

- `title.*` → navigate to Titles page, select the title by ID
- `chapter.*` → navigate to Chapters page, select the title, scroll to the chapter
- `menu.*` → navigate to Menus page, select the menu by ID
- `disc.*` → navigate to Overview page
- `build.*` → navigate to Build page / Settings page

This requires the sidebar navigation to support programmatic route changes with optional entity selection state.

**Frontend — inline fix hints**

Below each validation message, show the `suggested_fix` text in a muted style. This gives users immediate guidance without requiring them to click through.

**New validation rules**

Add these rules as part of this work:

- `title.mismatched-format-in-titleset`: Warning when titles in the same titleset have different output profiles (resolution, TV standard, aspect ratio). Fix: "Move this title to a separate titleset or change its output profile to match."
- `subtitle.text-only-unsupported`: Warning when a title has text subtitle mappings that cannot yet be authored to disc. Fix: "Text subtitle rendering is not yet supported. Remove text subtitles or provide bitmap subtitle sources."
- `subtitle.dangling-stream`: Error when a mapped subtitle stream index no longer exists on the source asset. Fix: "The source file may have changed. Remove this subtitle mapping or relink the asset."

#### Files to change

| File | Change |
| --- | --- |
| `plugins/.../src/desktop.rs` | Add `entity_type`, `entity_name`, `suggested_fix` to all validation rules |
| `plugins/.../src/models.rs` | Expand `ValidationIssue` struct with new fields |
| `apps/.../src/types/project.ts` | Mirror expanded `ValidationIssue` type |
| `apps/.../src/pages/OverviewPage.tsx` | Make issues clickable with navigation, show fix hints |
| `apps/.../src/pages/BuildPage.tsx` | Make issues clickable with navigation, show fix hints |
| `apps/.../src/components/Sidebar.tsx` | Support programmatic navigation with entity selection state |
| `apps/.../src/App.tsx` | Route state support for entity selection |
| `apps/.../src/store/project-store.ts` | Add selected-entity state for cross-page navigation |

---

## Implementation Order

The items are ordered to build on each other:

```
A1  Chapter seeding         ─┐
A2  Chapter menu actions     ├─ These three are independent, can be parallelised
A3  Subtitle selection UX   ─┘
         │
A4  Subtitle pipeline       ← depends on A3 (subtitle UX should be solid first)
A5  Titleset workflow        ← independent but larger; benefits from A2 (chapter actions feed into titleset menus)
         │
B6  Compatibility detail     ─┐
B7  Validation guidance       ├─ These build on Phase A (new rules reference new features)
                              ┘
```

A1, A2, and A3 are small and independent — they can be started in any order or in parallel. A4 is the largest item in Phase A and benefits from having A3 done first. A5 is medium-sized and mostly independent. B6 and B7 are Phase B items that reference features added in Phase A.

## Estimated Scale

| Item | Size | Primary area |
| --- | --- | --- |
| A1. Chapter seeding | Small | Backend (inspect) + frontend (chapters, titles) |
| A2. Chapter menu actions | Small | Frontend (menus, titles) |
| A3. Subtitle selection UX | Small | Frontend (titles) |
| A4. Subtitle pipeline | Medium-large | Backend (planner, ffmpeg, authoring) + frontend (build) |
| A5. Titleset workflow | Medium | Frontend (titles, menus, chapters) + backend (validation) |
| B6. Compatibility detail | Medium | Backend (inspect, models) + frontend (assets, titles) |
| B7. Validation guidance | Medium | Backend (validation) + frontend (overview, build, navigation) |
