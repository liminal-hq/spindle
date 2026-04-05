# SPEC.md — Liminal Spindle Authoring Studio

## 1. Overview

Liminal Spindle is a desktop optical-disc authoring tool built with a web-based user interface inside a Tauri wrapper.

Version 1 is focused on **DVD-Video authoring**, but the product should be architected from the beginning so that future versions can grow into **Blu-ray authoring** without requiring a fundamental rewrite of the project model, build orchestration layer, or menu-generation architecture.

The application combines:

- a modern visual editor for titles, chapters, menus, and navigation
- a disc-planning engine that calculates capacity usage and encoding budgets
- a stream-mapping system for video, audio, and subtitle tracks per title
- a native build pipeline that orchestrates external authoring and encoding tools

The app is not primarily a media player or a generic media conversion utility. It is an authoring and compilation environment for structured optical-disc output, beginning with `VIDEO_TS` export and optionally ISO generation for DVD in v1.

---

## 2. Vision

Create a modern, trustworthy replacement for older optical-disc authoring tools by separating the product into two clear layers:

1. **Creative layer**: menus, chapter points, labels, ordering, navigation, and disc structure.
2. **Compilation layer**: inspection, bitrate planning, re-encoding, stream mapping, XML generation, authoring, and packaging.

The UI should feel approachable and visual, but the output should be explicit, reproducible, and technically grounded.

The long-term vision for Spindle is broader than DVD alone: it should become a home for authored optical media workflows, with DVD-Video as the first format family and Blu-ray as a future expansion path.

---

## 3. Product Goals

### 3.1 Primary goals

- Import multiple media files and organise them into a DVD project.
- Model the disc as real DVD structures rather than as a loose file list.
- Allow explicit stream selection for video, audio, and subtitles per title.
- Allow explicit per-title output profile selection for video and per-stream output selection for audio.
- Support chapter creation and editing.
- Provide a disc-capacity planner and bitrate allocation system.
- Provide a visual menu layout editor.
- Build a valid `VIDEO_TS` folder structure.
- Optionally generate a DVD-Video ISO.
- Preserve enough technical visibility that advanced users can understand what the tool is doing.

### 3.2 Secondary goals

- Provide a simulated remote-navigation preview.
- Support multiple menus and multiple titlesets.
- Make build output reproducible from project data.
- Support future expansion into Blu-ray authoring concepts without coupling v1 to BD-specific requirements.

---

## 4. Non-goals for v1

- Full nonlinear video editing.
- Motion-graphics authoring comparable to professional compositing tools.
- In-app subtitle text editing beyond basic import and assignment.
- Full disc-image burning workflow.
- Copy-protection, CSS, region coding, or replication-plant mastering workflows.
- Full Blu-ray authoring.
- Exact emulation of every edge-case behaviour of every DVD player.

---

## 5. Platform Strategy

The product uses:

- **Tauri** for desktop packaging and native command orchestration
- **Web UI** for visual editing and project interaction
- **Rust** for project validation, orchestration, file handling, and build planning
- **External native tools** for encoding and authoring

This is intentionally not a browser-only app. The authoring pipeline depends on native binaries, long-running jobs, filesystem access, and deterministic outputs.

### 5.1 Format-family architecture principle

Although v1 is DVD-first, the architecture should distinguish between:

- **format-agnostic authored project concepts** such as titles, chapters, streams, menus, themes, and build intent
- **format-specific compilation backends** such as DVD-Video authoring and future Blu-ray authoring

This separation is important so that future Blu-ray support can reuse as much of the authored project model, editor experience, and orchestration layer as possible while still allowing different compilation rules, menu systems, filesystem outputs, and verification paths.

---

## 6. Core User Stories

### 6.1 Basic authoring

As a user, I want to import several video files, assign chapters, add a menu, and export a DVD-Video layout.

### 6.2 Disc planning

As a user, I want the application to tell me whether my project fits on the selected disc target and how bitrate changes affect quality.

### 6.3 Track control

As a user, I want to choose which audio and subtitle streams are included for each title, choose how included audio streams are authored, and label them correctly.

### 6.4 Deterministic output

As a user, I want the same project file to reproduce the same build choices and outputs.

### 6.5 Technical confidence

As a user, I want the app to explain why a file must be re-encoded, remuxed, copied, or rejected.

---

## 7. Target Users

### 7.1 Enthusiast / archivist

Someone digitising or compiling material into authored discs with menus and chapters.

### 7.2 Small studio / event producer

Someone creating simple playable DVDs for performances, classes, recitals, weddings, or archival distribution.

### 7.3 Technical hobbyist

Someone who understands FFmpeg and DVD authoring basics and wants a better front-end for disc planning and orchestration.

---

## 8. Functional Scope

### 8.1 Project management

- Create, open, save, and duplicate projects.
- Persist all structure, asset references, menu layouts, chapters, mappings, output profile choices, and build settings.
- Preserve build logs and inspection results.
- Keep room in the project model for future disc-family selection without forcing Blu-ray concepts into the v1 editing flow.

### 8.2 Media import and inspection

- Import local media files.
- Inspect container metadata and stream metadata, including the container-level title tag where present.
- Detect video properties such as resolution, interlacing, frame rate, aspect ratio, and duration.
- Detect audio streams, codecs, channel layouts, sample rates, and language tags where available.
- Detect subtitle streams and distinguish between bitmap and text-based sources where possible.
- Track source fingerprints for cache invalidation and asset-change detection.
- Support future relinking workflows for moved or missing source assets.
- Flag compatibility with target DVD settings.

### 8.3 Disc planning

- Select disc target size and video standard.
- Estimate usable capacity after filesystem, menu, and safety overhead.
- Allocate bitrate budgets across titles.
- Show whether assets can be remuxed, copied, or require re-encoding.
- Allow user priority tuning for quality distribution.

### 8.4 Stream mapping

- Allow explicit selection of one video stream per title.
- Allow explicit per-title video output profile selection.
- Allow selection and ordering of included audio tracks.
- Allow per-audio-stream output selection (`copy` or `re-encode`) with constrained target formats.
- Allow selection and ordering of included subtitle tracks.
- Store user-facing labels, language tags, and per-track metadata.
- Prevent accidental reliance on tool auto-selection.

### 8.5 Chapters

- Add chapter points manually.
- Add chapters from imported timestamp lists.
- Snap chapters to frame-safe boundaries where applicable.
- Validate monotonic timestamps.
- Associate chapters with title playback structure.

### 8.6 Menus

- Support still-image menu backgrounds in v1.
- Support text and image button overlays.
- Support highlight/select visual states.
- Support explicit navigation mapping (`up`, `down`, `left`, `right`, `activate`).
- Support root menu and per-title scene/chapter menus in later phases.
- Support future autogenerated menu creation for common structures such as title menus, chapter menus, audio menus, and subtitle menus.
- Keep menu-theme concepts in mind early so menu generation and visual styling are not tightly coupled.

### 8.7 Navigation and playback structure

- Link buttons to titles, chapters, and other menus.
- Support title end actions.
- Support first-play entry behaviour.
- Support title ordering.
- Support basic return flows.

### 8.8 Build/export

- Export authored `VIDEO_TS` folder structure.
- Optionally export ISO.
- Support future verification passes distinct from simple visual preview.
- Persist build logs, generated intermediate files, and emitted commands when requested.
- Support future compliance and QA reporting for authored output.
- Ship a Linux-first desktop release pipeline for the Tauri shell, including `AppImage`, `.deb`, and `.rpm` packages plus a consolidated `SHA256SUMS` manifest.
- Keep release versioning coordinated across the workspace package, desktop package, Tauri config, and release-facing Rust crates so published tags map cleanly to bundled outputs.
- Express Linux package-manager metadata for host `ffmpeg` requirements where the target package format supports it, while keeping host-tool detection in the app for portable bundle formats such as `AppImage`.

---

## 9. Disc Domain Model

The internal model should reflect actual authored-disc concepts, even if the UI presents them more gently.

Version 1 is explicitly DVD-focused, but the domain model should be designed so that future Blu-ray support can extend it through format-specific fields and compilation backends rather than through a separate unrelated project type.

### 9.1 Top-level entities

- **Project**
- **Disc**
- **Disc Family / Format Backend**
- **Titleset or Format-Specific Grouping Unit**
- **Title**
- **Menu**
- **Menu Page / Logical Menu Unit**
- **Button**
- **Track Mapping**
- **Video Output Profile**
- **Audio Output Configuration**
- **Chapter Point**
- **Asset**
- **Build Profile**
- **Build Job**

### 9.2 Suggested structure

```text
Project
 ├─ Disc
 │   ├─ Disc Family (DVD now, BD later)
 │   ├─ Standard / Region-like Format Settings
 │   ├─ Capacity Target
 │   ├─ First Play Action
 │   ├─ Global Menus
 │   ├─ Format-Specific Groupings[]
 │   │   ├─ Grouping Settings
 │   │   ├─ Menus[]
 │   │   └─ Titles[]
 │   │       ├─ Source Asset
 │   │       ├─ Video Mapping
 │   │       ├─ Video Output Profile
 │   │       ├─ Audio Mappings[]
 │   │       ├─ Audio Output Configurations[]
 │   │       ├─ Subtitle Mappings[]
 │   │       ├─ Chapters[]
 │   │       ├─ End Action
 │   │       └─ Encoding Plan
 │   └─ Format-Specific Compilation Settings
 └─ Build Settings
```

### 9.3 Why titlesets matter

In DVD, titlesets are not just folders. They are compatibility groupings that should constrain which titles can live together if they need to share format-level assumptions.

This matters because the tool should guide users away from invalid or awkward groupings.

For future Blu-ray support, Spindle should avoid assuming that every authored format uses the exact same grouping structure as DVD, even if some higher-level concepts still map cleanly.

### 9.4 Format backend abstraction

The data model should separate:

- authored content and intent
- shared navigation and menu concepts
- format-specific grouping rules
- format-specific compilation settings
- format-specific output structures

This allows the product to remain DVD-first in practice while still preparing for future Blu-ray compilation backends that may differ in output layout, menu capabilities, and verification rules.

Titlesets are not just folders. They are compatibility groupings that should constrain which titles can live together if they need to share format-level assumptions.

This matters because the tool should guide users away from invalid or awkward groupings.

---

## 10. Media Compatibility Model

Each imported asset should receive a compatibility assessment.

### 10.1 Compatibility states

- **Compatible for remux**
- **Compatible with light transformation**
- **Requires full re-encode**
- **Unsupported / invalid**

### 10.2 Example checks

- Video standard mismatch
- Resolution mismatch
- Unsupported codec
- Frame rate incompatibility
- Unsupported audio codec for desired output profile
- Subtitle source not directly usable as DVD subpicture
- Aspect ratio mismatch
- Audio sample rate mismatch

### 10.3 User-facing presentation

The app should not merely say "incompatible". It should explain:

- what was found
- what the target requires
- what action the build system proposes
- whether the user can override the decision

### 10.4 Output profile matrix

The application should model legal DVD output profiles explicitly.

This should include both the disc-level standard and the per-title chosen output raster/profile.

#### NTSC profiles

- **Full-D1**: `720x480`
- **704-wide full-height**: `704x480`
- **Half-D1**: `352x480`
- **Low-resolution / quarter-D1 style**: `352x240` (advanced use only)

#### PAL profiles

- **Full-D1**: `720x576`
- **704-wide full-height**: `704x576`
- **Half-D1**: `352x576`
- **Low-resolution / quarter-D1 style**: `352x288` (advanced use only)

### 10.5 Per-title video output configuration

Each title should expose an explicit video output configuration area.

At minimum, the user should be able to select:

- output raster/profile
- aspect presentation mode where supported by project rules
- copy vs re-encode mode when the source is already compliant
- selected source video stream
- quality and planner priority

### 10.6 Video copy vs re-encode rules

The app should determine whether a selected title video stream can be copied as-is for the chosen output profile.

Possible states:

- **Copy allowed**
- **Re-encode required**
- **Unsupported for selected profile**

This determination should consider at least:

- legal DVD raster/profile
- video codec compliance
- frame rate and standard compatibility
- aspect signalling requirements
- interlace/progressive handling where relevant
- mux and authoring compatibility assumptions

### 10.7 Profile selection guidance

The UI should help the user understand why a profile might be chosen.

Examples:

- **Full-D1** for higher-detail sources or shorter programmes
- **Half-D1** for long-form material or lower-detail sources where bitrate pressure is high
- **Low-resolution profiles** as advanced and compatibility options rather than common defaults

### 10.8 Planner integration

Chosen video profiles must influence:

- estimated encoded size
- bitrate targets
- quality warnings
- titleset grouping recommendations

### 10.9 Display and aspect-mode behaviour

The project model should preserve the distinction between stored video raster and displayed presentation.

The application should plan for DVD-specific display behaviour such as:

- 4:3 versus 16:9 presentation
- aspect signalling choices
- menu behaviour that may differ by display mode or authored assumptions
- safe-area and composition differences caused by display expectations

Even if v1 does not expose every display-path option, the architecture should avoid assuming that one visual layout or preview always maps cleanly to every playback context.

### 10.10 Source-normalisation considerations

The application should leave room for source-normalisation rules that affect authoring correctness.

Examples include:

- field order and interlace handling
- telecine or cadence-related source quirks
- frame-safe chapter placement
- timing offsets that influence sync or playback precision

These concerns may begin as validation and diagnostics rather than full user-facing editing controls in v1.

---

## 11. Disc Capacity and Bitrate Planner

This is a core product subsystem.

### 11.1 Inputs

- Disc target size
- Safety margin
- Estimated menu overhead
- Total title durations
- Included audio tracks and their target bitrates
- Included subtitle tracks
- Selected video output profiles
- Build profile choices
- Quality weighting or priority per title

### 11.2 Outputs

- Estimated used space
- Estimated free space
- Per-title target average video bitrate
- Warnings for likely over-capacity or very low quality
- Build-time recommendation summary

### 11.3 Conceptual formula

```text
usable_bits = (disc_capacity_bytes - filesystem_overhead - menu_overhead - safety_margin) * 8

per_title_available_video_bits = allocated_title_bits - audio_bits - subtitle_overhead_bits - mux_overhead_bits

target_video_avg_bitrate = per_title_available_video_bits / duration_seconds
```

### 11.4 Allocation strategies

- Equal-share across titles
- Duration-weighted
- User-priority weighted
- Manual override per title

### 11.5 Planner UX

The planner should give immediate feedback as the user:

- adds or removes titles
- changes video profiles
- changes audio tracks or audio output targets
- changes subtitle tracks
- changes disc target
- changes menu complexity assumptions
- modifies quality priorities

---

## 12. Stream Mapping System

This should be explicit and deterministic.

### 12.1 Video

Each title should have exactly one selected video source stream.

### 12.2 Audio

For each title, the user may include multiple audio tracks, each with:

- source stream reference
- output codec/profile target
- output mode (`copy` or `re-encode`)
- language code
- label
- order index
- default flag
- optional commentary / descriptive type metadata

### 12.2.1 Per-title audio output configuration

Each included audio stream should expose an explicit output configuration surface in the title editor.

The user should be able to choose, per included stream:

- whether to copy the source stream unchanged when it is already compliant
- whether to re-encode the stream into a selected DVD-compatible target format
- the target bitrate or profile where applicable
- the output language and label metadata independently of imperfect source metadata

This configuration should live alongside stream inclusion and ordering so that track selection and track authoring remain part of the same workflow.

### 12.2.2 Supported audio output targets

The application should model DVD audio output as a constrained target matrix rather than an open-ended codec picker.

Initial supported targets should include:

- **AC-3**
- **LPCM**
- **MP2**
- **DTS**

The app should distinguish between:

- formats supported by the DVD project model
- formats supported by the currently detected native toolchain
- formats enabled in the current build profile

### 12.2.3 Copy vs re-encode rules

For each included audio stream, the app should determine whether the source can be copied as-is for the selected output target.

Possible states:

- **Copy allowed**
- **Re-encode required**
- **Unsupported for selected target**

### 12.2.4 Toolchain capability detection

The UI should not assume all encoding targets are always available.

The native toolchain adapter should detect which encoders and pass-through paths are available in the current environment and expose that capability to the frontend.

This matters especially for:

- MP2 output availability
- DTS output availability
- copy and passthrough eligibility for existing compliant streams

### 12.2.5 Planner integration

Per-stream output choices must feed directly into the disc planner.

The planner should account for:

- copied vs re-encoded stream sizes
- target bitrate differences between formats
- the cumulative cost of multiple included audio tracks

### 12.3 Subtitles

For each title, the user may include multiple subtitle tracks, each with:

- source reference
- source type
- conversion status
- language code
- label
- order index
- default / forced intent where supported by project model

### 12.3.1 Subtitle rendering and conversion pipeline

Subtitle handling should be treated as a rendering and conversion pipeline, not just a track toggle.

The model should leave room for:

- text subtitle ingestion
- bitmap or DVD-subpicture-ready subtitle ingestion
- conversion status tracking
- safe-area aware subtitle positioning assumptions
- style or rendering presets for future subtitle conversion workflows
- forced and default behaviour where supported by the authoring model

This matters because text subtitle sources and DVD subtitle outputs are not the same thing, even when they represent the same language track.

### 12.3.2 Subtitle timing and offset considerations

The architecture should allow for future per-track timing adjustments or validation.

Examples include:

- subtitle offset handling
- PAL or NTSC-related timing concerns
- validation against title duration and chapter structure
- detection of potentially unsafe conversions or timing drift

### 12.4 Design principles

- Never depend on implicit stream selection during build.
- The UI should make included vs excluded tracks obvious.
- Track ordering must be visible.
- Track metadata should be editable even if source metadata is poor.
- Output selections should be constrained to legal DVD targets and detected toolchain capabilities.

---

## 13. Chapter System

### 13.1 v1 requirements

- Manual chapter creation
- Chapter rename support
- Timestamp editing
- Import from simple text list or common chapter format in future phase
- Validation for ascending timestamps and in-range placement

### 13.2 Future scope

- Program/cell-level editing
- Automatic chapter spacing suggestions
- Scene-detection-assisted chapter proposals

---

## 14. Menu Authoring System

### 14.1 v1 scope

- Scene-driven authoring with layers and non-interactive nodes.
- Integrated motion model with timing, animation tracks, and background audio.
- Interactive hotspots with semantic playback actions.
- Theme-driven components (HeroTitleButton, ChapterThumbnailTile).
- Target-specific compile variant preview (DVD 4:3/16:9 safe-areas).
- Explicit directional navigation with automatic generation heuristics.

### 14.2 Canvas features

- Fixed DVD menu resolution workspace
- Snap and align tools
- Layer ordering for non-interactive visual elements
- Button rectangle editing
- State preview (normal / highlight / selected)
- Navigation-path preview

### 14.3 Navigation model

Each button should support:

- target action
- up neighbour
- down neighbour
- left neighbour
- right neighbour
- activation behaviour

### 14.4 Design constraint

The preview is not merely visual. It must also simulate remote-navigation logic so users can detect bad directional mappings.

Motion menus should be treated as a future expansion area rather than a v1 requirement.

Future support may include:

- motion-video backgrounds
- animated button states or menu elements where feasible
- looping menu audio
- clip-based menu intros that transition into looping states
- motion-aware preview and timing simulation

This should be architected as an extension of the menu asset and compilation model rather than as a completely separate system.

The application should plan for future assisted menu generation for common DVD structures.

Potential autogenerated menu types include:

- root or main menu
- title-selection menus
- chapter or scene-selection menus
- audio-track menus
- subtitle-selection menus
- extras or bonus-feature menus

Autogeneration should be based on the authored project model rather than inferred from loose media files.

That means generated menus should derive from:

- title ordering
- chapter definitions
- included audio tracks
- included subtitle tracks
- end actions and return flows
- available menu theme and layout rules

Generated menus should remain editable after creation. The user should be able to accept a generated baseline and then customise layout, navigation, labels, and art.

### 14.7 Menu themes and style architecture

Menu themes do not need to be implemented in v1, but the architecture should preserve room for them early.

A future theme system may define:

- typography choices
- button styles
- highlight and select styles
- safe default layouts
- page templates
- colour treatments
- thumbnail presentation rules
- spacing, alignment, and grid systems

To support this cleanly, the menu model should separate:

- authored menu structure
- authored content
- visual theme tokens or theme references
- generated layout decisions
- compiled menu assets

This separation is important so that future autogenerated menus can be styled consistently without baking visual assumptions into the authored navigation model.

### 14.8 Theme-aware generation principle

If autogenerated menus are implemented later, they should be theme-aware rather than hardcoded to one visual style.

The user should be able to choose a generation approach such as:

- simple utility layout
- chapter-grid layout
- thumbnail-driven layout
- studio or event style theme
- archival or minimal theme

while preserving the same underlying targets and navigation graph.

### 14.9 Preview versus verification

The product should treat preview and verification as related but distinct concepts.

Examples:

- a visual layout preview checks composition and appearance
- a navigation preview checks focus movement and target flow
- an authored-output verification pass checks whether generated assets and structures match expectations closely enough for trust

This separation is important so users do not assume that a menu canvas preview guarantees final authored-disc behaviour in every respect.

---

## 15. Build System

The build system is the orchestrator that turns project data into authored optical-disc output.

In v1 this means DVD-Video output, but the system should be architected around format-aware build backends so that future Blu-ray support can plug into the same high-level planning and execution pipeline.

### 15.1 Build phases

1. Validate project
2. Inspect source asset cache freshness
3. Resolve encoding plan
4. Resolve target format backend
5. Generate intermediate assets
6. Encode, transcode, or copy media as needed
7. Generate menu overlays, theme-derived assets, and highlight assets
8. Emit format-specific authoring definitions
9. Author filesystem and authored output structure
10. Validate output structure
11. Optionally generate ISO or disc image output where supported
12. Write build report

### 15.2 Build modes

- **Draft build**: faster, lower quality, preview-oriented
- **Final build**: target-quality authoring
- **Menu-only rebuild**: when structure is unchanged and only menu assets changed
- **Metadata/layout validation pass**: no full build, only checks

### 15.3 Build outputs

- `VIDEO_TS/`
- Optional `AUDIO_TS/`
- Optional ISO
- Intermediate working directory
- Logs
- Manifest / build summary

---

## 16. Validation Rules

The tool should validate before build and, where possible, during editing.

### 16.1 Project-level validation

- Disc has at least one playable entry target
- Menu references are valid
- Build target is set
- Capacity plan is valid or acknowledged

### 16.2 Title validation

- Source asset exists
- Title duration is non-zero
- Video mapping selected
- Video output profile selected
- Chapters valid
- Track mappings valid

### 16.3 Menu validation

- Button targets resolve
- Directional navigation does not contain broken references
- Highlight/select assets exist where required
- Buttons do not overlap in invalid ways if forbidden by implementation

### 16.4 Build validation

- Required external tools available
- Requested output targets are actually supported by detected toolchain capabilities
- Generated intermediate files present
- Authoring definitions syntactically valid

---

## 17. External Toolchain Strategy

The application should treat the native toolchain as pluggable and inspectable.

### 17.1 Core tool roles

- **Media inspection**
- **Encoding/transcoding**
- **Stream copy and passthrough validation**
- **Subtitle conversion where needed**
- **Menu/subpicture composition or menu-asset generation**
- **Format-specific authoring backend**
- **Disc image generation**

### 17.2 Integration principles

- Tool invocations should be generated deterministically from project data.
- Commands should be loggable and inspectable.
- The app should distinguish between tool failure and project invalidity.
- The user should be able to export a build report for debugging.
- The orchestration layer should not assume one authoring backend forever.

### 17.3 Backend families

The toolchain layer should be designed around format-aware backend adapters.

Examples:

- **DVD backend** for DVD-Video authoring, filesystem generation, and image creation
- **Future BD backend** for Blu-ray-specific planning, compilation, menu handling, and output validation

The frontend and shared planning layers should talk to backend capabilities and backend requirements rather than directly encoding DVD-only assumptions everywhere.

### 17.4 Sidecar packaging

Tauri-side integration should support shipping known-good versions of required binaries or allowing advanced users to override paths.

### 17.5 Capability detection

The toolchain layer should detect and expose:

- available encoders
- supported audio output targets
- copy and passthrough eligibility for compliant streams
- subtitle conversion helpers
- authoring and image-generation availability
- available format backends
- backend-specific feature support such as menu capabilities or verification support

This capability model should be queryable by the frontend so unsupported targets can be disabled or clearly explained.

### 17.6 Compatibility profiles and safe defaults

The application should plan for compatibility profiles that bundle conservative defaults and behavioural guidance.

Examples may include:

- maximum compatibility
- balanced authoring
- advanced permissive mode

These profiles may influence choices such as:

- whether DTS or MP2 are presented as recommended or advanced options
- when low-resolution video profiles are suggested
- how aggressively copy mode is offered
- whether stricter warnings are shown for less broadly compatible choices

Even if compatibility profiles are not fully exposed in v1, the architecture should leave room for policy-style decision layers above raw format legality.

---

## 18. Application Architecture

### 18.1 Frontend

A React/TypeScript UI responsible for:

- project editing
- media organisation
- menu layout
- chapter editing
- stream mapping
- output profile configuration
- planner visualisation
- build monitoring
- future format-family-aware UI flows without forcing BD complexity into the DVD-first experience

### 18.2 Tauri/Rust layer

Responsible for:

- filesystem access
- asset hashing and caching
- media inspection orchestration
- compatibility analysis
- build planning
- command generation
- process execution
- structured logging
- toolchain capability detection
- format-backend selection and backend-specific planning

### 18.3 Data model layer

A serialisable project schema stored as:

- JSON for transparency and portability in v1
- optionally SQLite in later versions if asset databases and derived caches grow significantly

The schema should distinguish between:

- shared authored-disc concepts
- DVD-specific authored settings
- future format-extension fields for Blu-ray or other optical families

### 18.4 Derived-data cache

Should store:

- media inspection results
- thumbnail data
- waveform previews if added later
- compatibility summaries
- toolchain capability snapshots
- build intermediates

In the current desktop shell, thumbnail cache data persists across sessions and is manually inspectable and clearable from Settings rather than being purged automatically on shutdown.

### 18.5 Asset portability and relinking

The architecture should support projects that move between folders, drives, or machines.

This should leave room for:

- stable asset IDs separate from raw filesystem paths
- source fingerprinting
- missing-file detection
- relink workflows
- separation between authored project data and machine-local cache state

### 18.6 Undo, redo, and change history

The product should plan early for safe experimentation and reversible edits.

Areas likely to benefit include:

- menu editing
- chapter editing
- track inclusion and output selection
- generated-menu acceptance and subsequent manual edits
- planner or build-setting changes

Even if a full project history system is not part of v1, the state architecture should not make undo and redo difficult to add later.

---

## 19. UI Information Architecture

### 19.1 Primary application areas

- Dashboard / recent projects
- Disc overview
- Titles and assets
- Stream mapping
- Output profiles
- Chapters
- Menus
- Navigation preview
- Build planner
- Build/export
- Logs and diagnostics

### 19.2 Recommended left-nav structure

```text
Project
  Overview
  Assets
  Titlesets
  Titles
  Menus
  Planner
  Build
  Logs
```

### 19.3 Overview screen

Should show:

- disc family or authored format target
- disc standard
- target capacity
- title count
- total duration
- estimated usage
- warnings
- quick links into problem areas

---

## 20. Project File Format

### 20.1 Design goals

- Human-inspectable
- Stable IDs for cross-references
- Versioned schema
- Portable across machines
- Clear separation between source references and derived outputs

### 20.2 Example top-level shape

```json
{
	"schemaVersion": 1,
	"project": {
		"id": "proj_001",
		"name": "My DVD Project"
	},
	"disc": {
		"family": "dvd-video",
		"standard": "NTSC",
		"capacityTarget": "DVD5",
		"titlesets": []
	},
	"assets": [],
	"menus": [],
	"buildSettings": {},
	"cache": {}
}
```

### 20.3 Versioning

Schema migration should be first-class. The application should be able to read older project versions and migrate them forward.

---

## 21. Error Handling Philosophy

The app should not hide the build pipeline, but it also should not dump raw tool errors without interpretation.

### 21.1 User-facing error tiers

- Informational
- Warning
- Blocking error
- External tool failure
- Internal app failure

### 21.2 Good error examples

- "Title 3 exceeds estimated disc budget by 412 MB after adding the second audio track."
- "Subtitle track 2 is text-based and must be converted before DVD authoring."
- "Requested DTS output is not available in the current toolchain configuration."
- "Menu button 'Scenes' points to a missing chapter menu."

---

## 22. Logging and Diagnostics

### 22.1 Must-have logs

- media inspection results
- compatibility decisions
- bitrate planner results
- output profile decisions
- generated command lines
- build phase transitions
- tool stdout/stderr capture
- output manifest

### 22.2 Exportable diagnostics bundle

Include:

- redacted project copy if needed
- logs
- generated intermediate definitions
- environment info
- active developer-option flags that can affect tool resolution or build behaviour
- tool versions
- capability detection results

### 22.3 Compliance and QA reporting

The product should leave room for build-time or post-build reporting aimed at playback confidence.

Possible report areas include:

- risky compatibility choices
- unsupported or advanced-profile usage
- copied versus re-encoded stream decisions
- aspect-mode or display-related warnings
- subtitle conversion assumptions
- timing and sync warnings where detectable

This does not require full hardware-player emulation, but it should help users understand when a build is merely valid versus broadly safe.

---

## 23. Performance Considerations

### 23.1 Expected heavy operations

- media inspection
- thumbnail extraction
- transcoding
- menu asset generation
- full disc authoring

### 23.2 Strategies

- background job system via Rust/Tauri processes
- cancellable build stages where feasible
- incremental rebuild support
- reuse of unchanged intermediates
- lazy inspection for very large projects

---

## 24. Security and Trust Model

This is a local-first desktop tool.

### 24.1 Principles

- Source media remains local.
- Builds occur locally.
- No account is required.
- External tool execution should be constrained to known commands and validated arguments.

### 24.2 User trust

Because this app orchestrates binaries, the product should clearly communicate:

- which tools are installed or bundled
- which version is in use
- which output targets are currently available
- where outputs are written
- whether the current project is reproducible
- whether the current build choices prioritise broad compatibility or advanced flexibility

---

## 25. v1 Feature Set

### 25.1 Included in v1

- NTSC and PAL project modes
- DVD-5 target planning at minimum
- multi-title projects
- explicit video/audio/subtitle mapping
- per-title video output profile selection
- per-audio-stream copy vs re-encode selection
- DVD-compatible audio target selection constrained by detected toolchain capabilities
- chapter editing
- chapter seeding from source media
- Scene-driven menu system with authored documents and motion support
- semantic navigation mapping with remote simulation
- chapter-targeted menu and title end actions
- direct titleset editing with compatibility guidance
- reversible subtitle track selection
- bitmap subtitle authoring and muxing
- first-pass text subtitle rendering and DVD-safe conversion with simplified styling
- `VIDEO_TS` export
- optional ISO generation
- build logs and diagnostics

### 25.2 Nice-to-have if scope allows

- draft vs final quality modes
- chapter thumbnail generation
- menu remote simulation
- multiple menu pages

### 25.3 Deferred

- advanced VM command logic exposure
- deep program/cell editing
- Blu-ray authoring
- compatibility profiles as a formal user-facing mode system
- advanced subtitle rendering presets and conversion controls
- full authored-output verification and QA reporting beyond basic validation

---

## 26. Milestones

### Milestone 1 — Foundation

- project schema
- asset import
- media inspection
- compatibility analysis
- project persistence
- format-backend-aware architecture groundwork

### Milestone 2 — Authoring core

- title organisation
- stream mapping
- audio output configuration
- video output profile selection
- chapter editor
- titleset modelling
- basic planner

### Milestone 3 — Menu system

- menu canvas
- buttons
- navigation mapping
- visual preview
- generation-friendly theme and menu model boundaries

### Milestone 4 — Build pipeline

- command generation
- encoding plan execution
- DVD filesystem export
- logging
- backend selection layer

### Milestone 5 — Refinement

- ISO export
- incremental rebuilds
- better diagnostics
- polish and edge-case validation
- future BD-extension hooks validated in architecture

---

## 26.1 Design Focus — Titleset Exposure in the UI

Titlesets are one of the most important internal DVD concepts, but they are also one of the easiest ways to overwhelm users if exposed too literally too early.

### 26.1.1 Product stance

For v1, the application should use a **guided model with direct, lightweight titleset visibility**.

That means:

- the internal project model always stores titles within titlesets
- the default UI exposes titlesets directly in the Titles page, but keeps the interaction lightweight
- the app may automatically group titles into a default titleset during early project setup
- the app should keep titleset editing approachable rather than hiding it behind a separate advanced mode

### 26.1.2 Why this approach fits v1

A beginner usually thinks in terms of:

- which videos are on the disc
- what order they play in
- which menu button launches which video

A technical user may think in terms of:

- shared settings
- stream constraints
- menu domains
- titleset boundaries

The app should support both mental models while still making real DVD structure visible enough to edit.

### 26.1.3 Recommended UI behaviour

#### Default mode

- New projects begin with a default titleset.
- Titlesets are shown inline in the Titles page rather than hidden in a separate advanced view.
- Users can work with a simple ordered title list inside each titleset, and can ignore extra titlesets until they need them.

#### Guided intervention

When the app detects technical mismatches that make grouping awkward or invalid, it should surface a structured recommendation such as:

- "Title 4 uses a different format profile and should be placed in a separate titleset."
- "These titles can remain grouped, but chapter menu reuse may be simpler if they are split."

The user should then be able to:

- accept the recommended split
- review the reason
- move the title manually

#### Direct editing

Users should be able to:

- create titlesets explicitly
- rename titlesets
- move titles between titlesets
- inspect per-titleset constraints
- see menus attached to each titleset

### 26.1.4 Validation and assistance

The app should provide a compatibility assistant that explains why titles are grouped or split.

Suggested grouping signals:

- video standard consistency
- aspect-ratio compatibility
- shared output profile assumptions
- shared audio and subtitle profile assumptions where relevant
- menu-domain implications

### 26.1.5 v1 requirement

v1 should support titlesets as a real internal concept and expose direct titleset editing in a lightweight, approachable way.

---

## 26.2 Design Focus — Bitrate Planner Strictness in v1

The bitrate planner is not just a calculator. It is a trust feature. Users need to know whether the disc will fit and whether the resulting quality is likely to be acceptable.

### 26.2.1 Product stance

For v1, the planner should be **strict in warnings, conservative in estimates, and overrideable with acknowledgement**.

That means:

- the app should not silently assume everything will work out
- the planner should reserve safety headroom
- the app should warn early when projected quality becomes poor
- users may override warnings, but the system should record that choice clearly

### 26.2.2 Planner modes

#### Recommended mode

Default mode should present:

- estimated used space
- remaining space
- per-title target bitrate
- simple quality indicators such as good / acceptable / risky / poor

#### Advanced mode

Advanced users may inspect:

- audio-space contribution per track
- menu-space assumptions
- mux overhead assumptions
- safety margin value
- allocation strategy details
- manual per-title overrides

### 26.2.3 Strictness rules for v1

The planner should treat the following as blocking or near-blocking states unless the user explicitly accepts them:

- projected disc overflow beyond safety margin
- extremely low average video bitrate for long-form content
- track selections that dramatically reduce quality beyond a configurable threshold
- inconsistent assumptions caused by missing source metadata

The planner should treat the following as warnings but not blockers:

- small capacity overages before final mux overhead is known exactly
- low but still plausible quality targets
- menu-overhead estimates that are conservative rather than measured

### 26.2.4 Recommendation engine behaviour

When a project does not fit comfortably, the planner should suggest concrete actions such as:

- remove one audio track from Title 2
- lower menu complexity assumption
- split project across two discs
- reduce target bitrate for bonus material first
- prioritise Title 1 and Title 2 quality over shorter extras

### 26.2.5 v1 requirement

The planner should be conservative and legible rather than mathematically perfect. Trustworthiness matters more than squeezing every last megabyte in v1.

---

## 26.3 Design Focus — Menu and Navigation Modelling

The menu editor should feel modern and visual, but the underlying navigation model must stay honest to DVD behaviour.

### 26.3.1 Product stance

For v1, the menu system should use **simple authoring primitives backed by an explicit navigation graph**.

This means:

- users interact with buttons, pages, and targets
- the internal system stores directional mappings and activation actions explicitly
- the preview simulates both appearance and remote-navigation behaviour

### 26.3.2 Simplicity goals

The default editing experience should let a user:

- place a button
- label it
- connect it to a target
- preview highlight state
- test remote-style movement

The app should auto-generate reasonable directional mappings for simple layouts, especially grid and list structures.

### 26.3.3 Accuracy goals

Even when the app assists with mapping, the underlying stored model should remain explicit.

Each button should resolve to:

- normal visual state
- highlight/select visual state references
- activation target
- directional neighbours

The system should not rely entirely on visual proximity at build time.

### 26.3.4 Preview expectations

The preview should support:

- keyboard-based remote simulation
- visual indication of current focus
- test activation flow
- return-flow preview where defined
- warnings for dead ends or ambiguous navigation

### 26.3.5 v1 simplifications

To keep scope healthy, v1 should avoid overexposing deeper DVD command logic.

Recommended v1 scope:

- still menus only
- one clear action per button
- basic end-action routing
- no deep VM command authoring UI
- limited but explicit return and jump behaviour

### 26.3.6 v1 requirement

The menu system should prioritise behavioural correctness over decorative complexity. A simple menu that behaves like a real disc is more valuable than a flashy menu with inaccurate navigation.

---

## 27. Open Questions

These should be resolved during design review.

1. How strict should titleset grouping rules be in v1? — This affects whether the app behaves more like a guided consumer tool or a technically strict authoring environment when titles differ in format assumptions.
   - Each title should be configurable itself. Templates could be used to get the user going, but after that or from a Blank template they can configure their disk as they see fit, mixing video sizes, audio options/languages, etc.
2. Should v1 expose titlesets directly, or infer them automatically unless advanced mode is enabled? — This determines how much real DVD structure is visible to beginners versus hidden behind guided workflows.
3. How much subtitle conversion support belongs in-core versus as an advanced import step? — This affects scope, complexity, and whether subtitle handling feels like a native feature or a more technical preprocessing path.
4. Should ISO generation be built-in in v1 or delayed until filesystem export is stable? — This is a scope and reliability question, since ISO export is valuable but sits downstream of the core authoring flow.
5. How much of remote-navigation logic should be editable manually versus auto-generated? — This defines the balance between ease of use and exact control over button movement and focus behaviour.
6. Should the project file remain pure JSON in v1, or should a sidecar cache database be introduced immediately? — This affects portability, transparency, migration complexity, and how derived data is separated from authored data.
7. How should menu highlight/select assets be modelled internally to support both ease of use and DVD constraints? — This matters because button visuals are simple in the UI but have strict authored-disc implications.
8. How much of the generated build pipeline should be user-overridable? — This determines how inspectable and hackable the tool should be for advanced users without making the normal workflow fragile.
9. Should DTS output require a separate advanced-compatibility acknowledgement even when toolchain support is present? — This is about distinguishing legal authoring from broadly safe playback compatibility.
10. How aggressively should the app recommend Half-D1 over Full-D1 when bitrate pressure is high? — This affects how opinionated the planner becomes when trading resolution against expected quality.
11. How should autogenerated menus be regenerated after the user has manually customised them? — This raises important questions about preserving edits, reapplying templates, and avoiding destructive regeneration.
12. Should generated chapter, audio, and subtitle menus be opt-in per title or derived automatically from project rules? — This affects how much automation the app performs by default and how predictable the authored structure feels.
13. What should the theme architecture own versus what should remain raw authored layout? — This determines the boundary between reusable styling systems and user-authored menu geometry/content.
14. How should motion-menu timing, looping, and preview fidelity be represented in the project model? — This matters because motion menus add temporal structure that is more complex than still-menu layout alone.
15. How much display-mode and aspect behaviour should be exposed directly in v1 versus kept implicit? — This affects both UI complexity and how honestly the app represents DVD-era display quirks.
16. What should the compatibility-profile system control, and when should it override raw user choices versus only warn? — This determines whether profiles are advisory presets or stronger policy layers that shape authoring decisions.
17. How should missing assets, relinking, and portable project paths be represented in the project file? — This impacts long-term project durability when files move between folders, drives, or machines.
18. How much subtitle rendering control belongs in the core product versus in import presets or future advanced tools? — This defines whether subtitle styling is a central feature or a more specialised workflow.
19. What level of timing and sync correction should be modelled in authored data versus only surfaced as diagnostics? — This affects whether the app merely warns about source issues or can also preserve corrective intent in the project itself.
20. What should count as verification in v1 beyond structural validation? — This is about deciding how much confidence the product should provide that authored output will behave as expected on real players.
21. How should the shared authored project model be extended for Blu-ray without making the v1 DVD schema messy or misleading? — This affects the long-term maintainability of the schema and whether future BD support feels like an extension or a parallel product.
22. Which concepts should be universal across optical formats, and which should remain backend-specific? — This is about deciding what belongs in shared UI and data structures versus what should stay inside format adapters.
23. How much Blu-ray menu or interaction complexity should shape the architecture now versus being deferred until there is a concrete BD backend plan? — This affects how much speculative abstraction is healthy at this stage.
24. Should future BD support live in the same project type with a disc-family switch, or as a migrated superset of DVD-first projects? — This determines how seamless future expansion feels for both the product and the schema.

---

## 28. Risks

### 28.1 UX risk

If the app hides too much, advanced users will not trust it. If it exposes too much too early, casual users will be overwhelmed.

### 28.2 Technical risk

DVD structures contain historical constraints that are easy to mis-model in a purely modern UI.

### 28.3 Toolchain risk

Different environments may have different binary availability, behaviour, and edge cases.

### 28.4 Preview fidelity risk

A menu preview that looks correct but behaves differently from a real disc is dangerous.

### 28.5 Compatibility signalling risk

If the app exposes MP2, DTS, copy mode, or low-resolution video profiles without enough context, users may create technically valid but less broadly compatible discs without realising it.

### 28.6 Asset portability risk

If project files depend too directly on raw machine-local paths or stale caches, users may lose trust when projects move between environments.

### 28.7 Subtitle pipeline risk

If subtitle rendering and conversion are treated too casually, the app may appear simpler than it really is while still producing fragile results.

### 28.8 Verification gap risk

If the product does not distinguish clearly between preview, validation, and verification, users may overestimate how faithfully the app predicts final playback behaviour.

### 28.9 Format-extension risk

If the DVD-first architecture hardcodes too many format assumptions into shared systems, future Blu-ray support may require disruptive rewrites rather than a controlled backend extension.

---

## 29. Success Criteria

The app is successful when a user can:

- import multiple source videos
- choose tracks, output targets, and chapters with confidence
- understand whether the disc will fit
- create a functional menu
- export a playable `VIDEO_TS` structure
- inspect what the build system did
- reproduce the same result from the saved project

---

## 30.1 Future Expansion — Advanced DVD VM Logic and Easter Eggs

DVD-Video supports more than visible menus and straightforward title jumps. In later versions, the application may expose a controlled subset of advanced DVD virtual-machine-style behaviours for power users.

This section exists to acknowledge those capabilities without allowing them to distort the v1 product scope.

### 30.1.1 Why this matters

Commercial DVDs sometimes included hidden content or alternate navigation paths that were not visible through the main authored interface.

These behaviours were commonly achieved through combinations of:

- hidden or non-obvious menu buttons
- explicit directional-navigation paths
- alternate title or chapter jumps
- stateful logic using player registers
- conditional behaviour based on prior user actions

From a product perspective, these are not separate from menu authoring. They are advanced extensions of the same navigation and playback model.

### 30.1.2 Potential advanced capabilities

Future versions may support:

- hidden buttons that are selectable but visually subtle or not labelled as normal UI controls
- optional off-grid or non-obvious navigation paths
- conditional button visibility or behaviour
- state-driven navigation flows based on prior playback or user actions
- alternate first-play or return behaviours
- limited register-aware rules exposed through guided UI
- advanced jump and branching logic for power users

### 30.1.3 Product boundaries

This should not become a free-form scripting surface in early versions.

Recommended progression:

1. v1: explicit buttons, targets, and navigation graph only
2. later phase: hidden buttons and non-obvious navigation paths
3. later phase: guided conditional logic and state-based flows
4. advanced phase: constrained access to lower-level VM concepts where safe and understandable

### 30.1.4 UX philosophy

If advanced logic is exposed, it should be presented as authored behaviour rather than opaque code whenever possible.

For example, users should be able to express ideas like:

- "show this hidden button only after Title 3 has been played"
- "jump to secret extra when this button is selected and a specific state flag is set"
- "unlock alternate menu behaviour after a bonus clip is viewed"

without requiring direct low-level command authoring in the common path.

### 30.1.5 Risk note

Advanced DVD logic increases the risk of incorrect preview behaviour, broken navigation, and player-specific quirks.

Any future support in this area should include:

- stronger validation
- a state-aware preview simulator
- clear visualisation of conditional paths
- an escape hatch for advanced users without making the base product fragile

---

## 30. Future Expansion

- motion menus
- autogenerated title, chapter, audio-track, and subtitle-track menus
- theme-aware menu generation
- smarter bitrate optimisation
- visual titleset compatibility assistant
- subtitle conversion workflows
- Blu-ray planning concepts
- plugin system for alternate toolchains
- richer simulation of player behaviour
- archival metadata packaging
- advanced audio-target presets and compatibility profiles
- quality advisor for choosing between Full-D1 and Half-D1
- richer asset portability and project-bundling workflows
- formal verification passes and stronger authored-output QA reports

## 30.2 Future Expansion — Blu-ray Authoring Architecture

Blu-ray authoring should be treated as a future format-backend expansion of Spindle rather than as a separate unrelated application.

### 30.2.1 Architectural goals

Future Blu-ray support should aim to reuse:

- the shared authored project model where appropriate
- title, chapter, stream, and asset workflows
- menu themes and generation concepts where they still make sense
- planner and diagnostics infrastructure
- build orchestration, logging, and verification patterns

while allowing different backend implementations for:

- output structures and filesystem layout
- authoring definitions and compilation steps
- menu and interaction capabilities
- capability detection and backend validation
- format-specific compliance reporting

### 30.2.2 Design principle

Spindle should not prematurely flatten DVD and Blu-ray into one fake universal format model.

Instead, it should preserve a layered architecture where:

- shared authored concepts stay shared
- DVD-specific assumptions remain explicit
- future BD-specific behaviour enters through backend and schema extension points

### 30.2.3 Product implication

This means the architecture should be reviewed with future BD support in mind even though Blu-ray authoring remains outside the v1 feature set.

The goal is not to build BD early, but to avoid painting the product into a DVD-only corner.

## 31. Summary

This product should be treated as a **disc authoring compiler with a visual editor**, not merely a menu designer.

The central design idea is:

- model the disc honestly
- make technical decisions visible
- keep the interface approachable
- let the native build pipeline do the heavy lifting

If built with that philosophy, the application can become a strong modern authoring environment for DVD-Video projects.

---

## 32. Architectural Decisions Record

This section documents key architectural decisions made during implementation.

### 32.1 Plugin architecture

Non-business-logic native extensions use **official Tauri v2 plugins**:

| Plugin                            | Purpose                          |
| --------------------------------- | -------------------------------- |
| `@tauri-apps/plugin-dialog`       | Open/save file dialogs           |
| `@tauri-apps/plugin-fs`           | Filesystem read/write            |
| `@tauri-apps/plugin-store`        | Persistent key-value settings    |
| `@tauri-apps/plugin-window-state` | Window position/size persistence |
| `@tauri-apps/plugin-shell`        | External process execution       |
| `@tauri-apps/plugin-os`           | Platform detection               |
| `@tauri-apps/plugin-opener`       | Default application launching    |

Domain-specific business logic lives in a custom Tauri v2 plugin:

- **`tauri-plugin-spindle-project`** — project schema, serialisation, validation, and creation.

This separation keeps the app thin and pushes all DVD-domain logic into a testable, reusable plugin crate.

### 32.2 Project schema design

The project schema (`SpindleProjectFile`) uses a versioned JSON format with `schemaVersion: 1`. Key design choices:

- **`DiscFamily` enum** (`dvd-video`) — extensible to `bd-video` without schema rewrite.
- **Titleset-first hierarchy** — `Disc → Titleset[] → Title[]` mirrors real DVD-Video structure.
- **Explicit track mappings** — video, audio, and subtitle mappings are explicit per-title rather than inferred.
- **Tagged-union playback actions** — `PlaybackAction` serialises as `{ "type": "playTitle", "titleId": "..." }` for TypeScript compatibility.
- **Capacity targets** as named variants (`DVD5`, `DVD9`) rather than raw byte values.

### 32.3 State management

Frontend state uses **Zustand** with a single `useProjectStore` that wraps all Tauri plugin invocations. The store handles:

- Project CRUD via `invoke()` to the spindle-project plugin
- Dirty tracking for unsaved changes
- Validation issue aggregation
- File path tracking for save/save-as flows

### 32.4 Cross-platform window controls

Window decorations are disabled (`decorations: false` in `tauri.conf.json`). The `Topbar` component provides platform-specific controls:

- **macOS**: traffic-light buttons (close/minimise/maximise) positioned left.
- **Windows**: standard caption buttons positioned right.
- **Linux**: Adwaita-style buttons positioned right.

This pattern is shared with the Threshold application.

### 32.5 Routing

The app uses simple state-based routing (`useState` with a route string) rather than a URL-based router. This is appropriate for a desktop application where:

- There are no URLs to share or bookmark.
- Navigation is sidebar-driven with a fixed set of pages.
- Deep-linking is not needed in v1.

The `ROUTES` map in `App.tsx` can be upgraded to a full router if needed later.

### 32.6 Design system

The design system is implemented as CSS custom properties in `design-system.css`, ported from the HTML mockups. It defines:

- Colour palette with brand gradient and semantic colours
- Typography scale (Inter for body, Space Grotesk for headings, JetBrains Mono for code)
- Spacing scale, border radii, shadows, and layout dimensions
- Scrollbar styling and animations

### 32.7 Test strategy

- **Rust**: Unit tests in `models.rs` cover JSON round-trips, serialisation format, domain values, and field initialisation.
- **Frontend**: Vitest with happy-dom and testing-library. Tests cover type helpers, constants, and project creation defaults.
- **No Rust toolchain locally**: Rust tests run via Docker (`ghcr.io/liminal-hq/tauri-dev-desktop:latest`).
.
