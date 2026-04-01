# DVD Navigation Lab Notes

Working notes for reproducing and debugging menu-to-title navigation failures in authored DVD output.

## Test projects

- Original repro project:
  - `/home/scott/Documents/Liminal HQ/Spindle/Projects/Test Project.spindle`
- Focused navigation lab project:
  - `/home/scott/Documents/Liminal HQ/Spindle/Projects/Test Project Navigation Lab.spindle`
- Root-role rotation variants:
  - `/home/scott/Documents/Liminal HQ/Spindle/Projects/DVD Navigation Lab - Compare Root.spindle`
  - `/home/scott/Documents/Liminal HQ/Spindle/Projects/DVD Navigation Lab - Chapter Root.spindle`

The lab project strips subtitle mappings, routes title end actions back to a global test menu, and isolates menu/button combinations so authored DVD navigation cases can be compared without unrelated noise.

## Core repro

Observed in VLC:

- A titleset-local menu opens correctly.
- Pressing a button that should `playTitle` into the local title can stop playback with `DVDNAV_STOP`.
- A nearby button that `playChapter`s into the same title can work correctly.

From the original project:

- `Umbrella Academy S1` -> `S04E01` worked.
- `Titleset 2 Menu 1` -> `Episode 1-2` stopped playback.
- `Titleset 2 Menu 2` -> `Episode 1-2 - Chapter 1` worked.

## Navigation lab matrix

Results from the lab project:

- `VMGM Play Title 1`: works
- `Open TS1 Menu`: works
- `Open TS2 Default`: fails with `DVDNAV_STOP`
- `Open TS2 No Default`: works
- `Open TS2 Chapter Default`: works
- `Open TS2 Compare -> Play Title 2`: works

## Current strongest hypothesis

This no longer looks like a generic `playTitle` problem.

The strongest suspect is the first menu in a multi-menu titleset, because that menu is authored with a special role:

- it is marked as the titleset `root` entry menu
- it gets a `<pre>` dispatch block so VMGM can jump into later menus via `g0`

That means the likely failing combination is:

- titleset root-entry menu
- multi-menu titleset dispatch PGC
- user button with `playTitle`

This hypothesis fits the matrix better than:

- broken title VOBs
- broken chapter data
- broken `playTitle` commands in general
- broken default-button handling in general

## Important negative findings

- The generated `dvdauthor.xml` for the failing case contains a plausible local target:
  - `jump title 1;`
- The corresponding `playChapter` button contains:
  - `jump title 1 chapter 1;`
- The generated `spumux` XML for the failing and working single-button TS2 menus is structurally identical apart from file paths.
- Replacing `playTitle` with `playChapter 1` would be semantically wrong as a general fix:
  - chapter 1 is not guaranteed to mean title start in Spindle's model

## Useful artefacts

- Generated authoring XML:
  - `/home/scott/Documents/Liminal HQ/Spindle/Projects/Test Project_DVD/_spindle_work/dvdauthor.xml`
- Generated lab menu XML:
  - `/home/scott/Documents/Liminal HQ/Spindle/Projects/Test Project Navigation Lab_DVD/_spindle_work/menus/*.xml`
- VLC log signal:
  - `dvdnav debug: DVDNAV_STOP`

## Suggested next experiments

1. Reorder the TS2 lab menus so a different menu becomes the titleset root/entry menu.
2. Rebuild and see whether failure follows the root-entry menu role.
3. Inspect compiled `IFO` structure with container-installed DVD inspection tools such as `lsdvd` or an `ifo` dumper.
4. Compare authored structure for:
   - first menu in multi-menu titleset
   - non-root titleset menu
   - first menu in single-menu titleset

## Docker findings so far

`lsdvd` works in a disposable Ubuntu container and confirms the authored disc exposes the expected title tracks and chapter counts:

- Title 01: 2 chapters
- Title 02: 3 chapters

That does not explain the menu stop yet, but it helps rule out a missing or truncated title track.

## Useful commands

VLC CLI logging:

```bash
cvlc -vvv \
  --file-logging \
  --logfile=/tmp/vlc-dvd.log \
  --dvdnav-menu \
  dvd:///home/scott/Documents/Liminal\ HQ/Spindle/Projects/Test\ Project\ Navigation\ Lab_DVD/VIDEO_TS/VIDEO_TS
```

Raw authored structure inspection:

```bash
nl -ba '/home/scott/Documents/Liminal HQ/Spindle/Projects/Test Project_DVD/_spindle_work/dvdauthor.xml' | sed -n '1,260p'
xxd -g 1 '/home/scott/Documents/Liminal HQ/Spindle/Projects/Test Project Navigation Lab_DVD/VIDEO_TS/VIDEO_TS/VTS_02_0.IFO' | sed -n '1,80p'
```
