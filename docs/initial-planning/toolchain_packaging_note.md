# TOOLCHAIN_PACKAGING_NOTE.md — Liminal Spindle

## 1. Purpose

This note captures the recommended packaging strategy for Spindle’s external authoring tools inside a Tauri app.

It answers:

- how external tools should be bundled
- where they should live in the repo
- what versions to pin first
- whether to compile them directly or consume upstream binaries
- what the normal Tauri-side pattern looks like

---

## 2. Recommendation

For Spindle, the default pattern should be:

- **Tauri app code and plugins** as normal Rust / JS dependencies
- **External media/authoring tools** as bundled **sidecar executables**
- **Templates and static non-executable assets** as bundled **resources**

This keeps Spindle deterministic and prevents it from drifting into a generic media utility that depends on whatever happens to be installed on the user’s machine.

---

## 3. What a sidecar is

A sidecar is an external executable shipped with the app and invoked by the app at runtime.

In Spindle’s case, examples include:

- `ffmpeg`
- `ffprobe`
- `dvdauthor`
- `spumux`
- future ISO/image helpers
- future BD backend tools

Spindle should treat these as **backend executables** rather than as frontend package dependencies.

---

## 4. Why sidecars are the right default

### Benefits

- exact versions are pinned per Spindle release
- behaviour is more reproducible across machines
- diagnostics are easier because the toolchain is known
- capabilities can be locked down tightly
- the product does not depend on the user installing system packages first

### Trade-offs

- release artifacts get larger
- each supported OS/architecture needs its own matching binaries
- CI/release packaging becomes more deliberate
- you may need to build or collect binaries yourself for some tools

---

## 5. Can the tools come from the OS instead?

Yes, but that should be treated as an **advanced override path**, not the default.

Using system-installed tools means:

- version drift between users
- different compile options across distributions
- more support complexity
- more discovery/path logic in the app
- less deterministic diagnostics

Recommended stance:

- **Default:** bundled sidecars
- **Later advanced option:** allow user-specified system tool overrides

---

## 6. How this is normally done in Tauri projects

The normal Tauri pattern is:

1. install the Shell plugin for process execution
2. place sidecar binaries under `src-tauri/binaries/`
3. declare them in `tauri.conf.json` under `bundle.externalBin`
4. invoke them as sidecars through the Shell plugin
5. constrain execution through capabilities/permissions

For non-executable files such as XML templates, menu-theme files, presets, or backend config, use bundled **resources** instead of sidecars.

---

## 7. Repo layout for Spindle

Recommended structure:

```text
/apps
  /desktop
    /src
    /src-tauri
      tauri.conf.json
      capabilities/
      binaries/
        ffmpeg-x86_64-pc-windows-msvc.exe
        ffprobe-x86_64-pc-windows-msvc.exe
        dvdauthor-x86_64-pc-windows-msvc.exe
        spumux-x86_64-pc-windows-msvc.exe

        ffmpeg-aarch64-apple-darwin
        ffprobe-aarch64-apple-darwin
        dvdauthor-aarch64-apple-darwin
        spumux-aarch64-apple-darwin

        ffmpeg-x86_64-unknown-linux-gnu
        ffprobe-x86_64-unknown-linux-gnu
        dvdauthor-x86_64-unknown-linux-gnu
        spumux-x86_64-unknown-linux-gnu

      resources/
        templates/
        themes/
        presets/
        schema/
```

Notes:

- `binaries/` is for executables only
- `resources/` is for non-executable files
- keep names stable at the logical level (`ffmpeg`, `ffprobe`, etc.)
- the target-specific suffixes are part of the packaging workflow

---

## 8. Recommended starting version matrix

These are **recommended starting pins**, not eternal requirements.

### App/runtime

- **Tauri:** v2 line
- **Shell plugin:** matching Tauri v2 plugin version
- **Rust:** version required by the chosen Tauri/Shell stack

### Core DVD toolchain for first packaging pass

- **FFmpeg / FFprobe:** pin a single stable branch for the first release train
  - Recommended starting point: **FFmpeg 8.1.x**
- **DVDAuthor:** **0.7.2**
- **Spumux:** shipped together with the pinned DVDAuthor toolset where available

### ISO/image generation

Recommended product approach:

- **Phase 1:** focus on `VIDEO_TS` export first
- **Phase 2:** add a pinned ISO/image tool once the DVD filesystem flow is stable

That keeps early packaging smaller and reduces release complexity while the authoring core is still settling.

---

## 9. Should Spindle compile the tools directly?

Not usually as part of the Tauri app build itself.

A more practical split is:

### Option A — Use upstream prebuilt binaries

Use this when:

- trusted upstream binaries exist
- licensing and redistribution are acceptable
- the build options match what Spindle needs
- reproducibility is good enough for the release stage

Pros:

- fastest to adopt
- simplest early release path
- less CI complexity

Cons:

- less control over build flags
- harder to patch or standardise behaviour
- availability may vary by platform

### Option B — Build from source in CI/release tooling

Use this when:

- upstream binaries are missing or inconsistent
- you need exact compile flags or encoder support
- you need deterministic release packaging
- you want to patch or stabilise older tools

Pros:

- maximum control
- better long-term reproducibility
- same build policy across platforms where possible

Cons:

- more CI complexity
- more maintenance burden
- more release engineering work

### Recommended approach for Spindle

Start with a **hybrid strategy**:

- use trusted upstream/prebuilt binaries where practical for early experimentation
- move toward **project-controlled pinned binaries** assembled in CI for production releases
- do **not** try to compile third-party tools during every ordinary `tauri build` on a developer machine

Instead, think of the binaries as **release inputs** prepared before packaging.

---

## 10. Practical packaging workflow

### Development

For early local development:

- place pinned test binaries in `src-tauri/binaries/`
- wire them through `bundle.externalBin`
- invoke them through Spindle’s Rust adapter layer
- log exact tool versions and paths at startup or build time

### CI / Release

Recommended release flow:

1. fetch or build platform-specific binaries
2. verify versions/checksums
3. place them in `src-tauri/binaries/` using target-triple naming
4. run `tauri build`
5. produce installer/app bundle with sidecars embedded
6. capture capability snapshot + tool versions into the build manifest

---

## 11. What should be a sidecar versus a resource

### Sidecars

Use sidecars for:

- ffmpeg
- ffprobe
- dvdauthor
- spumux
- future bd backend executables
- future disc image helpers

### Resources

Use resources for:

- XML templates
- default menu-theme definitions
- generated-layout presets
- schema files
- policy presets / compatibility profiles
- icon packs / visual templates / static artwork

---

## 12. Rust architecture expectation

Do not let the frontend call tools directly in an ad hoc way.

Spindle should have:

- a Rust tool adapter layer
- a backend selector
- capability detection
- structured command generation
- structured output/error parsing
- one logical interface per tool family

Example conceptual modules:

- `toolchain::probe`
- `toolchain::encode`
- `toolchain::dvd`
- `toolchain::image`
- later `toolchain::bd`

This keeps sidecars as an implementation detail of the backend, not as random executables the UI happens to know about.

---

## 13. Security and permissions

Because Spindle will execute external binaries, the sidecar model should be paired with:

- explicit capabilities
- narrow command/argument permissions where possible
- no broad “run anything from shell” policy
- backend-owned command construction

This is another reason sidecars are preferable to defaulting to arbitrary system binaries.

---

## 14. Recommended first-pass tool policy

For the first serious Spindle packaging pass:

### Bundle now

- `ffmpeg`
- `ffprobe`
- `dvdauthor`
- `spumux`

### Defer until the DVD authoring flow is stable

- ISO/image creation helper if it adds packaging complexity
- any BD-specific backend tools

### Allow later as advanced override

- user-specified paths to system-installed binaries
- optional alternate toolchain profiles

---

## 15. Conclusion

For Spindle, the normal and healthy Tauri pattern is:

- app logic in Rust/TypeScript dependencies
- external executables as **bundled sidecars**
- non-executable backend data as **resources**
- binaries prepared before packaging, not casually compiled during every app build

The long-term release direction should be:

- **pin exact tool versions**
- **bundle them as sidecars**
- **wrap them behind Rust backend adapters**
- **treat system-installed tools as an optional expert path, not the default**

