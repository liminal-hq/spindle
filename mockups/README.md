# Spindle UI Mockups

Static HTML/CSS mockups for the Spindle desktop disc authoring workstation.

## Viewing

Open `index.html` in any modern browser. Each screen links to the shared `design-system.css` and loads fonts from Google Fonts (Inter, Space Grotesk).

## Screens

| # | File | Screen |
|---|------|--------|
| 01 | `01-app-shell.html` | Application frame, sidebar navigation, status bar |
| 02 | `02-project-overview.html` | Project dashboard with health, capacity, and activity |
| 03 | `03-assets.html` | Asset library grid with import and compatibility badges |
| 04 | `04-asset-inspector.html` | Asset detail view with preview, metadata, and streams |
| 05 | `05-titles-overview.html` | Title list with grouping, streams, and reordering |
| 06 | `06-title-detail.html` | Title editing with streams, chapters, and end actions |
| 07 | `07-stream-mapping.html` | Source-to-output stream mapping with copy/re-encode |
| 08 | `08-output-profiles.html` | Video raster selection and audio target configuration |
| 09 | `09-chapters.html` | Timeline/list hybrid chapter editor |
| 10 | `10-menus-overview.html` | Menu list with button previews and navigation status |
| 11 | `11-menu-editor.html` | Canvas-based menu editor with safe-area guides |
| 12 | `12-navigation-preview.html` | DVD remote simulator with navigation graph |
| 13 | `13-disc-planner.html` | Capacity bar and per-title bitrate allocation |
| 14 | `14-build.html` | Build mode, destination, and pre-build checklist |
| 15 | `15-build-progress.html` | Build phase progress with live output |
| 16 | `16-logs-diagnostics.html` | Build log viewer with filtering and diagnostics export |
| 17 | `17-verification.html` | Post-build QA scorecard and check categories |
| 18 | `18-relink-assets.html` | Missing asset detection with fingerprint matching |
| 19 | `19-settings.html` | Toolchain versions, capabilities, and cache management |

### Blu-ray Disc Support

| # | File | Screen |
|---|------|--------|
| 20 | `20-format-selector.html` | DVD vs Blu-ray format selection during project creation |
| 21 | `21-bd-output-profiles.html` | HD rasters, H.264/HEVC codec selection, lossless audio targets |
| 22 | `22-bd-popup-menu.html` | BD popup menu canvas editor with overlay behaviour config |
| 23 | `23-bd-planner.html` | BD-25/BD-50 capacity planning with high bitrate allocation |
| 24 | `24-bd-verification.html` | BDMV structure checks, AVC compliance, audio fallback validation |
| 25 | `25-bd-toolchain.html` | BD backend selector, tsMuxeR, BD menu compiler, architecture diagram |

### BD Variant Screens

These are Blu-ray adaptations of existing DVD screens, with BD-specific terminology, codecs, and UI elements.

| DVD Screen | BD Variant | Key Changes |
|------------|-----------|-------------|
| `02-project-overview.html` | `02-project-overview-bd.html` | BD-50 capacity, playlists (not titlesets), BDMV health, BD toolchain |
| `05-titles-overview.html` | `05-titles-overview-bd.html` | "Playlists" terminology, H.264/DTS-HD streams, 1080p profiles |
| `06-title-detail.html` | `06-title-detail-bd.html` | AVC video, DTS-HD MA + AC-3 fallback, PGS subs, Top Menu end action |
| `07-stream-mapping.html` | `07-stream-mapping-bd.html` | HD codec dropdowns, AC-3 fallback auto-gen, SRT→PGS conversion |
| `09-chapters.html` | `09-chapters-bd.html` | PlayList marks, up to 999 chapters, popup menu navigation targets |
| `10-menus-overview.html` | `10-menus-overview-bd.html` | Top menu + popup menu sections, IG streams, 1920×1080 |
| `11-menu-editor.html` | `11-menu-editor-bd.html` | 16:9 canvas, IG stream buttons (Normal/Selected/Activated states) |
| `12-navigation-preview.html` | `12-navigation-preview-bd.html` | BD remote with colour keys, Top Menu/Popup Menu buttons |
| `14-build.html` | `14-build-bd.html` | BDMV output, tsMuxeR backend, ISO creation, BD compliance checks |
| `15-build-progress.html` | `15-build-progress-bd.html` | 12-phase BD pipeline: AC-3 fallback, M2TS mux, IG compile, BDMV author |

### Format-Agnostic Screens

These screens do not need BD variants — they work identically for both DVD and Blu-ray projects:

| # | Screen | Why format-agnostic |
|---|--------|-------------------|
| 01 | App Shell | Application frame is the same regardless of disc format |
| 03 | Assets Library | Asset management is format-independent |
| 04 | Asset Inspector | Stream inspection works for any codec |
| 16 | Logs & Diagnostics | Log viewer is backend-agnostic |
| 18 | Missing Assets / Relink | Fingerprint matching is format-independent |
| 19 | Settings & Toolchain | General settings; BD toolchain has its own screen (25) |

### DVD → BD Implementation Mapping

When implementing BD support, use this mapping to trace from the DVD baseline to the BD-enhanced screens:

| Area | DVD Baseline | BD Screens | Implementation Notes |
|------|-------------|------------|---------------------|
| **Project creation** | — | 20 (Format Selector) | New screen: choose DVD or BD at project creation |
| **Dashboard** | 02 | 02-bd | Replace titleset metrics with playlist metrics, DVD-5/9 capacity with BD-25/50 |
| **Content structure** | 05, 06 | 05-bd, 06-bd | "Titles/Titlesets" → "Playlists/Clips"; add AC-3 fallback requirement |
| **Stream handling** | 07, 08 | 07-bd, 21 (BD Output Profiles) | HD codec options, lossless audio, AC-3 fallback auto-generation |
| **Chapters** | 09 | 09-bd | PlayList marks, 999 chapter limit, popup menu chapter targets |
| **Menus** | 10, 11, 12 | 10-bd, 11-bd, 12-bd, 22 (Popup Menu) | IG streams replace subpictures; add popup menu overlay; BD remote with colour keys |
| **Disc planning** | 13 | 23 (BD Planner) | BD-25/BD-50 capacity tiers, higher bitrate ranges |
| **Build pipeline** | 14, 15 | 14-bd, 15-bd | tsMuxeR backend, BDMV structure, M2TS muxing, IG compilation, ISO creation |
| **Verification** | 17 | 24 (BD Verification) | BDMV structure checks, AVC profile/level compliance, audio fallback validation |
| **Toolchain** | 19 | 25 (BD Toolchain) | tsMuxeR, BD Menu Compiler, BDMV Author — separate from DVD's dvdauthor |

## Design System

`design-system.css` contains the full token system:

- **Colours:** Liminal HQ brand palette (orange `#ffaa40`, pink `#f43f5e`, purple `#a78bfa`, cyan `#22d3ee`, blue `#60a5fa`, green `#2ec66a`)
- **Typography:** Inter (body), Space Grotesk (headings), JetBrains Mono (code)
- **Surfaces:** Dark mode with `#050507` base, semi-transparent cards, subtle borders
- **Components:** Cards, buttons, badges, progress bars, tabs, timeline markers, modals, tables, capacity bars

## Notes

- All mockups use Canadian English spelling per Liminal HQ project rules
- Window controls use GNOME/GTK style (not macOS)
- Mockups are static HTML — no JavaScript required
- Screens 01–19 cover DVD-Video authoring; screens 20–25 add BD-specific features; 10 BD variant screens adapt DVD screens for Blu-ray
- BD screens use a blue accent colour to visually distinguish from the orange DVD screens
- Screen content maps to the 19 core screens defined in `docs/initial-planning/ui_and_cli_planning.md`, plus 6 BD-specific screens and 10 BD variants (35 total)
