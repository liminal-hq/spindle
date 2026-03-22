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
- Screens 01–19 cover DVD-Video authoring; screens 20–25 add Blu-ray Disc support
- BD screens use a blue accent colour to visually distinguish from the orange DVD screens
- Screen content maps to the 19 core screens defined in `docs/initial-planning/ui_and_cli_planning.md`, plus 6 BD-specific screens
