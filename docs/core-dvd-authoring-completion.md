# Core DVD Authoring Completion

_Specification for the core DVD authoring and trust features added to Spindle. Covers chapter seeding, chapter-targeted navigation, subtitle authoring, titleset management, compatibility explanations, and fix-oriented validation._

## Scope

Seven features, grouped into two phases:

**Phase A — Complete the core authoring path**

1. Auto-seed chapters from source media
2. Chapter-targeted menu and end actions
3. Reversible subtitle selection
4. Subtitle authoring and export pipeline
5. Titleset authoring workflow

**Phase B — Improve trust and guidance**

6. Per-stream compatibility explanations
7. Fix-oriented validation

---

## Phase A: Complete the Core Authoring Path

### 1. Auto-Seed Chapters from Source Media

**Backend** — `inspect.rs` passes `-show_chapters` to ffprobe during asset inspection. Chapters are parsed into `SourceChapter { start_secs, end_secs, title }` and stored on the `Asset` as `source_chapters: Vec<SourceChapter>`. The TypeScript `Asset` type mirrors this as `sourceChapters: SourceChapter[]`.

**Frontend — auto-seeding on asset assignment** — When a source asset is assigned to a title in `TitlesPage.tsx`, if the asset has source chapters and the title's chapter list is empty, the title's chapters are auto-populated from the source metadata. Each `SourceChapter` maps to a `ChapterPoint` using `start_secs` as the timestamp and `title` (or `Chapter N` fallback) as the name. Auto-seeded chapters are normal chapter points — fully editable, removable, and re-orderable.

**Frontend — manual re-seeding** — `ChaptersPage.tsx` shows a "Seed from Source" button when the title's source asset has chapter metadata. This replaces the current chapter list with freshly seeded chapters.

---

### 2. Chapter-Targeted Menu and End Actions

**Menu editor** — The button action selector in `MenusPage.tsx` includes a "Play Chapter" optgroup. Titles with chapters appear as group headers, with individual chapters as selectable options beneath. The value format is `playChapter:{titleId}:{chapterId}`, parsed by an updated `stringToAction()` that splits on `:` with a limit of 3.

**Title end actions** — The same chapter-target options appear in the title end-action selector in `TitlesPage.tsx`, allowing a title to jump to a specific chapter of another title on completion.

**Backend** — No backend changes were needed. `PlaybackAction::PlayChapter` and the DVD navigation code (`dvd_navigation.rs`) already supported chapter-targeted jumps across all menu domains.

---

### 3. Reversible Subtitle Selection

`TitlesPage.tsx` includes a `SubtitleAddPicker` component below the subtitle mapping list. It shows all subtitle streams from the title's source asset that are not already mapped, with stream index, codec, language, and title metadata. Selecting a stream creates a new `SubtitleTrackMapping` with auto-mapping defaults.

When all source streams are already mapped, the picker is disabled. The subtitle section renders whenever a source asset is assigned, not only when mappings exist.

---

### 4. Subtitle Authoring and Export Pipeline

**Build planner** — `planner.rs` generates `ExtractSubtitles` jobs for each title with bitmap subtitle mappings. Only bitmap subtitles (`dvd_subtitle`, `dvdsub`, `hdmv_pgs_subtitle`, `pgssub`) are extracted; text subtitle rendering is out of scope.

**FFmpeg extraction** — `ffmpeg.rs` provides `build_ffmpeg_subtitle_extract_command()` which generates: `ffmpeg -i source -map 0:{index} -c:s dvd_subtitle output.sub`

**dvdauthor XML** — `authoring.rs` generates `<subpicture>` declarations with language attributes for each title's subtitle mappings within the titleset's `<titles>` section.

**Build job type** — `ExtractSubtitles` variant added to `BuildJob` enum in `types.rs`, with title_id, title_name, source_path, output_path, command, and label fields. The frontend `BuildJob` union and `BuildPage.tsx` handle this job type for progress display.

---

### 5. Titleset Authoring Workflow

**Titleset selector** — `TitlesPage.tsx` shows a tab bar of titlesets above the title list. Users can add, rename, and remove titlesets. Non-empty titlesets cannot be deleted. The title list, chapter editor, and detail panel scope to the selected titleset.

**Format compatibility** — `desktop.rs` validates that all titles within a titleset share the same video output profile (resolution and aspect ratio). Mismatches produce a `titleset.format-mismatch` warning explaining the DVD constraint.

**Default behaviour** — New projects start with one titleset named "Default". The titleset selector is compact when only one exists.

---

## Phase B: Improve Trust and Guidance

### 6. Per-Stream Compatibility Explanations

**Backend** — `inspect.rs` builds a `CompatibilityDetail` alongside the overall `CompatibilityAssessment` during asset inspection. The detail contains per-property checks:

```
CompatibilityDetail {
  overall: CompatibilityAssessment,
  video: Option<VideoCompatibility> {
    codec:      PropertyCheck { value, dvd_requires, action, compatible },
    resolution: PropertyCheck { ... },
    frame_rate: PropertyCheck { ... },
  },
  audio_streams: Vec<AudioStreamCompatibility> {
    stream_index: u32,
    codec: PropertyCheck { ... },
  },
  container: ContainerCompatibility {
    format: PropertyCheck { ... },
  },
}
```

Each `PropertyCheck` records the source value, what DVD requires, the planned build action (none/copy/re-encode/scale/remux), and whether the property is compatible.

**Frontend** — `AssetsPage.tsx` shows an expandable compatibility detail section below the badge in the asset detail panel. When expanded, it renders a table of properties with source value, DVD requirement, and planned action. Incompatible rows are colour-coded.

---

### 7. Fix-Oriented Validation

**Structured issue context** — `ValidationIssue` includes three additional optional fields:

| Field | Type | Purpose |
| --- | --- | --- |
| `entity_type` | `Option<String>` | Navigation target: "title", "menu", "titleset", "disc", "build" |
| `entity_name` | `Option<String>` | Human-readable name of the affected entity |
| `suggested_fix` | `Option<String>` | Plain-language guidance on how to resolve the issue |

All fields use `#[serde(default)]` for backwards compatibility with existing project files.

**Fix descriptions by rule:**

| Code | Suggested fix |
| --- | --- |
| `disc.no-titlesets` | Add at least one titleset to the disc. |
| `disc.no-titles` | Add titles in the Titles page to define the disc's playback structure. |
| `disc.no-first-play` | Set a first-play action on the overview page so the disc has a defined startup behaviour. |
| `title.no-source` | Open the title and assign a source asset from the Assets library. |
| `title.dangling-source` | Re-import the missing asset or assign a different source. |
| `title.no-video-mapping` | Select a video stream in the title's track mapping section. |
| `title.no-output-profile` | Choose a video output profile (resolution and aspect ratio) for this title. |
| `chapter.non-increasing` | Reorder or adjust chapter timestamps so they are strictly increasing. |
| `chapter.beyond-duration` | Move this chapter to a timestamp within the asset's duration or remove it. |
| `menu.no-buttons` | Add at least one button to define user interaction. |
| `menu.no-default-button` | Set a default button so the player knows which button to highlight on entry. |
| `menu.button-no-action` | Assign an action (play title, show menu, etc.) to this button. |
| `menu.dangling-title-ref` | Update the button action to point to an existing title or remove it. |
| `menu.dangling-menu-ref` | Update the button action to point to an existing menu or remove it. |
| `menu.dangling-nav-ref` | Remove the broken nav link or use auto-generate navigation to rebuild all links. |
| `menu.button-no-navigation` | Use the auto-generate navigation feature to create directional links for all buttons. |
| `titleset.format-mismatch` | Ensure all titles in this titleset use the same resolution and aspect ratio, or move mismatched titles to a separate titleset. |
| `build.no-output-dir` | Set an output directory in the build settings to avoid being prompted each time. |

**Frontend** — `BuildPage.tsx` renders each validation issue with its `suggestedFix` text in a muted style below the message, giving users immediate guidance.
