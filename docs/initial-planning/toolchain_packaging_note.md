# TOOLCHAIN_PACKAGING_NOTE.md — Liminal Spindle

## 1. Purpose

This note captures the recommended packaging strategy for Spindle's external authoring tools inside a Tauri app.

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

This keeps Spindle deterministic and prevents it from drifting into a generic media utility that depends on whatever happens to be installed on the user's machine.

---

## 3. What a sidecar is

A sidecar is an external executable shipped with the app and invoked by the app at runtime.

In Spindle's case, examples include:

- `ffmpeg`
- `ffprobe`
- `dvdauthor`
- `spumux`
- `genisoimage` / `mkisofs`
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

Actual structure as implemented:

```text
apps/spindle/src-tauri/
  tauri.conf.json          — externalBin declares all four sidecar names
  capabilities/
  binaries/                — gitignored; populated by collect-sidecars.sh
    dvdauthor-x86_64-unknown-linux-gnu
    spumux-x86_64-unknown-linux-gnu
    genisoimage-x86_64-unknown-linux-gnu
    mkisofs-x86_64-unknown-linux-gnu

    dvdauthor-aarch64-apple-darwin
    spumux-aarch64-apple-darwin
    genisoimage-aarch64-apple-darwin    (mkisofs binary, copied under both names)
    mkisofs-aarch64-apple-darwin

  resources/               (future)
    templates/
    themes/
    presets/
    schema/

scripts/
  collect-sidecars.sh      — collects real binaries into binaries/ for packaging
  create-sidecar-stubs.sh  — creates stub executables for CI/dev (no real tools needed)
  install-sidecars.sh      — installs tools system-wide for local dev via PATH

plugins/tauri-plugin-spindle-project/src/
  toolchain.rs             — resolve_tool(): sidecar-first, PATH fallback
```

Notes:

- `binaries/` is gitignored; it is a build artefact populated before packaging
- `binaries/` is for executables only; `resources/` is for non-executable files
- keep names stable at the logical level (`dvdauthor`, `genisoimage`, etc.)
- target-triple suffixes are stripped by Tauri at bundle time; at runtime the
  binary is available as `dvdauthor`, `genisoimage`, etc. alongside the executable
- on macOS, `genisoimage` is not in Homebrew; `mkisofs` (from cdrtools) fills
  both roles and is copied under both sidecar names

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

`genisoimage` and `mkisofs` both support UDF for DVD via:

- `-udf` — plain UDF filesystem
- `-dvd-video` — UDF Bridge (hybrid ISO 9660 + UDF 1.02), the correct on-disc
  format for DVD-Video; this is what the Spindle build pipeline uses

`dvdauthor` and `spumux` produce the `VIDEO_TS` directory structure only; they
do not create ISO images.

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

### Development (current state)

`plugins/tauri-plugin-spindle-project/src/toolchain.rs` provides `resolve_tool(name)`:

1. checks for the binary next to the running executable (where Tauri places
   bundled sidecars in both `tauri dev` and release mode)
2. falls back to the system PATH

This means development still works with system-installed tools. Running
`./scripts/install-sidecars.sh` sets up the PATH-based tools for local dev.

To test with real sidecars bundled, run `./scripts/collect-sidecars.sh` first
to populate `src-tauri/binaries/` before running `tauri dev` or `tauri build`.

### CI (quality pipeline)

The quality CI (fmt, clippy, tests) does not need real binaries. Before each
Rust job that triggers the Tauri build script, the CI runs:

```
bash scripts/create-sidecar-stubs.sh x86_64-unknown-linux-gnu
```

This places minimal stub executables in `src-tauri/binaries/` so that Tauri's
build-time validation passes. Unit tests do not invoke the external tools, so
stubs are sufficient.

### Release CI (not yet written — details to be worked out)

The release workflow will be a platform matrix. The shape will be roughly:

```
matrix:
  - os: ubuntu-latest,  target: x86_64-unknown-linux-gnu
  - os: macos-latest,   target: aarch64-apple-darwin
  - os: macos-latest,   target: x86_64-apple-darwin
```

Each job:

1. checkout
2. install Rust toolchain
3. `./scripts/collect-sidecars.sh` — runs natively on the runner, installs
   tools via apt-get (Linux) or brew (macOS), copies binaries with target-triple
   suffix; auto-detects the triple via `rustc -Vv`
4. `tauri build`
5. upload/publish artefacts

`collect-sidecars.sh` is designed to work in any environment — natively on a
developer machine, inside a dev container, on a CI runner, or invoked inside
Docker when tools are not available natively. It does not assume a specific
container image.

**Open decisions for release CI:**

- macOS signing/notarisation (Developer ID, Gatekeeper)
- Tauri updater configuration and update manifest signing
- artefact upload destination (GitHub Releases, CDN, etc.)
- whether to pin exact tool versions via checksums rather than installing
  whatever apt/brew provides at build time

**Windows:** dvdauthor has no Windows port. Windows builds are not supported
for the DVD authoring pipeline.

---

## 11. What should be a sidecar versus a resource

### Sidecars (current)

Bundled now:

- `dvdauthor` — DVD-Video authoring (VIDEO_TS structure)
- `spumux` — DVD subtitle/highlight overlay (shipped with dvdauthor)
- `genisoimage` — ISO 9660 / UDF Bridge image creation
- `mkisofs` — same role; on Linux often the same binary as genisoimage;
  on macOS comes from cdrtools

Deferred (still PATH-based):

- `ffmpeg` — video/audio transcoding; large binary, deferred to a later pass
- `ffprobe` — media inspection; deferred alongside ffmpeg

### Resources (future)

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

Implemented:

- `toolchain::resolve_tool` — binary path resolution (sidecar-first, PATH fallback)

Planned:

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
- no broad "run anything from shell" policy
- backend-owned command construction

This is another reason sidecars are preferable to defaulting to arbitrary system binaries.

---

## 14. Tool policy — current status

### Bundled (done)

- `dvdauthor`
- `spumux`
- `genisoimage`
- `mkisofs`

### Deferred — bundle with ffmpeg pass

- `ffmpeg` — large binary; deferred until the ffmpeg packaging pass
- `ffprobe` — deferred alongside ffmpeg

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
