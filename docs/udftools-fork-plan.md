# UDF Fork Plan for Reusable BD Image Authoring

## Purpose

This note maps out how Spindle could use a fork of `udftools` as a starting point for a reusable UDF image-authoring library aimed at future Blu-ray support.

The goal is not to build a generic Linux UDF toolkit. The goal is to create a deterministic, non-interactive, reusable backend that can take a prepared filesystem tree such as `BDMV/` and emit a UDF 2.50 or 2.60 image without mount/copy workflows.

## Executive Summary

The upstream `udftools` codebase is a stronger starting point than it first appears.

It already contains three useful layers:

- `libudffs/` for low-level UDF data structures, extents, descriptors, CRC, and string handling.
- `mkudffs/` for initializing and laying out a fresh UDF filesystem image.
- `wrudf/` for higher-level file and directory manipulation logic.

The most important discovery is that `mkudffs` is not just a formatter. It already exposes internal authoring primitives such as:

- `udf_create(...)`
- `udf_mkdir(...)`
- `insert_data(...)`
- `insert_fid(...)`
- `udf_alloc_blocks(...)`

That means a fork does not need to invent file and directory authoring from scratch. The missing piece is mostly a clean, deterministic `host filesystem tree -> UDF image` pipeline and a reusable API surface.

## Why This Is Promising

### Existing Low-Level Core

`include/libudffs.h` defines the central disc model and core helpers:

- `struct udf_disc`
- extent and descriptor linked structures
- allocation and descriptor helpers
- CRC and unicode/string helpers

This is already the foundation of an internal library layer.

### Existing Filesystem Construction Layer

`mkudffs/` already handles:

- initializing a new disc model
- selecting UDF revision, including `0x0250` and `0x0260`
- partition and descriptor layout
- fileset and root creation
- final image writing

Useful functions already exposed in `mkudffs/mkudffs.h` include:

- `udf_init_disc()`
- `udf_set_version()`
- `split_space()`
- `setup_partition()`
- `setup_space()`
- `setup_fileset()`
- `setup_root()`
- `setup_vds()`
- `write_disc()`

### Existing File and Directory Authoring Primitives

`mkudffs/file.c` already includes reusable primitives for authoring filesystem objects:

- `udf_create()` creates a file FE/EFE descriptor and attaches it to a parent directory.
- `udf_mkdir()` creates a directory and back-reference.
- `insert_data()` appends payload data.
- `insert_fid()` adds file identifier descriptors.
- `udf_alloc_blocks()` allocates blocks for payloads and structures.

This is the core reason the fork path looks feasible.

### Existing Higher-Level Mutation Logic

`wrudf/` appears to contain higher-level file-copy and directory-manipulation logic, including recursive operations and metadata mapping. Even if it is not a good direct library API, it is useful donor code for:

- payload copying
- directory update patterns
- metadata propagation
- recursive traversal ideas

## Desired End State

The fork should evolve toward a small reusable authoring library with a narrow scope:

- offline image creation only
- directory tree input
- image file output
- UDF 2.50 and 2.60 support
- 2048-byte sectors
- deterministic, non-interactive behavior
- no mount step
- no writable-media UX assumptions

The fork should not try to remain a broad interactive UDF maintenance toolkit for this use case.

## Proposed Architecture

The clean shape for the fork is a four-layer design:

### 1. `udf_core`

Responsibilities:

- wraps the current `libudffs` structures and helpers
- owns disc state, extents, descriptors, allocation, CRC, and unicode handling

Likely source base:

- `libudffs/`
- `include/libudffs.h`

### 2. `udf_format`

Responsibilities:

- creates a fresh empty filesystem model
- selects the revision
- lays out descriptors, partitions, fileset, root, and other structural objects

Likely source base:

- `mkudffs/mkudffs.c`
- `mkudffs/mkudffs.h`

### 3. `udf_populate`

Responsibilities:

- walks a host filesystem tree
- creates directories and files in the UDF model
- allocates extents
- copies payload data
- applies metadata policy

Likely source base:

- new code
- selected logic adapted from `wrudf/`
- authoring primitives from `mkudffs/file.c`

### 4. `udf_emit`

Responsibilities:

- serializes the finished model into an image
- flushes and finalizes the image
- provides deterministic diagnostics and validation hooks

Likely source base:

- existing `write_disc()` path
- new validation wrappers

## Suggested Fork Layout

Short term, keep the original codebase visible while adding a new reusable layer:

```text
udftools-fork/
  include/
    udfbuild.h
    libudffs.h

  libudffs/
  mkudffs/
  wrudf/

  udfbuild/
    context.c
    format.c
    populate.c
    emit.c
    host_fs.c
    errors.c
    options.c

  tools/
    mkudffs-tree.c
```

This keeps upstream code recognizable while letting the new API grow in parallel.

## Reuse Map

### Reuse Directly or Nearly Directly

From `mkudffs`:

- `udf_init_disc()`
- `udf_set_version()`
- `split_space()`
- `setup_partition()`
- `setup_space()`
- `setup_fileset()`
- `setup_root()`
- `setup_vds()`
- `write_disc()`

From `mkudffs/file.c`:

- `udf_create()`
- `udf_mkdir()`
- `insert_fid()`
- `insert_data()`
- `udf_alloc_blocks()`
- supporting tag and descriptor helpers

### Use as Donor Code, Not Public Surface

From `wrudf`:

- file-copy patterns
- directory manipulation patterns
- metadata mapping patterns
- recursive traversal logic

These should likely be adapted, simplified, and stripped of interactive command semantics.

### Avoid Carrying Forward as Core Design

Do not design the reusable backend around:

- interactive command prompts
- writable-media verify/retry loops
- packet-writing assumptions
- mount-based workflows
- broad tool globals as public API

## Concrete Refactor Plan

## Phase 1: Create a Callable Formatting Entry Point

### Goal

Turn `mkudffs` from a CLI-first program into a callable engine.

### Tasks

- Introduce a structured options type, for example:
  - revision
  - block size
  - volume label
  - image size mode
  - output path
  - preset/profile
- Move the current orchestration from `main.c` into a callable function.
- Keep `main.c` as a thin wrapper around that function.

### Deliverable

An internal function such as:

```c
int udf_format_image(struct udf_disc *disc, const struct udf_build_options *opts);
```

This should create an empty filesystem model without requiring a shell-first control flow.

## Phase 2: Separate Formatting from Population

### Goal

Make "create empty filesystem" a first-class operation that stops before final write.

### Tasks

- Split current flow into:
  - disc init
  - revision selection
  - partition/fileset/root layout
  - image model ready for additions
- Expose:
  - root directory descriptor
  - partition extent
  - fileset descriptor
- Delay `write_disc()` until after population.

### Deliverable

A usable in-memory UDF model representing a valid empty filesystem.

## Phase 3: Add a New Population Layer

### Goal

Walk a normal host directory tree and author it into the UDF model without mounts.

### Tasks

- Add recursive traversal:
  - `populate_dir(ctx, parent_desc, host_path)`
- For each directory:
  - create with `udf_mkdir()`
  - recurse into children
- For each regular file:
  - create with `udf_create()`
  - allocate payload blocks
  - stream file bytes into the model
- Reject unsupported file types early:
  - symlinks
  - sockets
  - FIFOs
  - device nodes
- Define metadata policy for:
  - uid/gid
  - mode
  - timestamps

### Deliverable

A working `host tree -> authored UDF tree` path.

## Phase 4: Add BD-Oriented Profiles

### Goal

Stop treating the library as a generic UDF builder and add explicit BD-friendly presets.

### Suggested Profiles

- `UDF_PROFILE_BD_ROM_250`
- `UDF_PROFILE_BD_ROM_260`

### Profile Responsibilities

- revision selection
- 2048-byte block size
- allocation defaults
- disable unnecessary writable-media features
- choose deterministic filesystem options

### Deliverable

A clear BD-oriented entry point instead of raw low-level flag soup.

## Phase 5: Deterministic Image Sizing

### Goal

Avoid guesswork when choosing image size.

### Tasks

- Add a pre-scan pass over the source tree.
- Estimate:
  - file payload bytes
  - directory entry overhead
  - descriptor overhead
  - allocation slack
- Support modes like:
  - fixed size
  - auto size
  - auto size with margin

### Deliverable

A deterministic image planning step that is easy to integrate into Spindle build planning.

## Phase 6: Validation Layer

### Goal

Do not trust image creation unless we can verify outputs.

### Validation Tiers

- Structural validation:
  - required descriptors exist
  - root/fileset wiring is sane
  - tree shape matches input
  - file sizes and extents are consistent
- Self-inspection:
  - use `udfinfo` or related tooling where useful
- Oracle comparison:
  - compare outputs against `mkudffs + mount/copy` reference workflow
- Playback validation:
  - later use BD consumers or inspection tools against real authored trees

### Deliverable

A fixture-based validation harness that gives confidence in 2.50 and 2.60 image generation.

## Phase 7: Stable Reusable API

### Goal

Expose a narrow API suitable for Spindle integration or later Rust FFI.

### Candidate C API

```c
typedef struct udfbuild_ctx udfbuild_ctx;

typedef enum {
  UDFBUILD_REV_250,
  UDFBUILD_REV_260,
} udfbuild_revision;

typedef struct {
  udfbuild_revision revision;
  const char *volume_id;
  uint32_t block_size;
  uint64_t image_blocks;
  unsigned flags;
} udfbuild_options;

udfbuild_ctx *udfbuild_create(const udfbuild_options *opts);
int udfbuild_add_tree(udfbuild_ctx *ctx, const char *source_root);
int udfbuild_write_image(udfbuild_ctx *ctx, const char *output_path);
const char *udfbuild_last_error(udfbuild_ctx *ctx);
void udfbuild_free(udfbuild_ctx *ctx);
```

### Deliverable

A reusable authoring library surface that Spindle can call either through a CLI wrapper or FFI.

## Practical Use of `wrudf`

`wrudf` should probably be treated as donor code, not as the main architecture.

### Good Uses

- inspect how file payloads get copied into extents
- inspect how directory entry updates are performed
- inspect how metadata gets translated into FE structures
- inspect recursive mutation flows

### Poor Uses

- exporting its command semantics as the reusable library API
- preserving interactive or overwrite-oriented behavior
- inheriting writable-media assumptions into the BD image backend

## Expected Hard Parts

The hardest work is likely to be:

- untangling globals and command-shaped state
- shaping file payload insertion into a clean offline pipeline
- choosing sane BD defaults
- building confidence through tests
- validating real 2.50 vs 2.60 behavior with actual consumers

The hardest work is probably not descriptor creation itself. That part is already largely present.

## Testing Plan

### 1. Small Structural Tests

- empty UDF 2.50 image
- empty UDF 2.60 image
- small nested directory tree
- single large-file tree

### 2. Fixture Image Tests

- fixed source tree
- generate image
- inspect tree and metadata
- verify counts, descriptors, and file extraction

### 3. Oracle Tests

For the same source tree:

- build with reference workflow:
  - `mkudffs` plus mount/copy
- build with new fork path
- compare:
  - visible tree
  - extracted file hashes
  - revision
  - descriptor sanity

### 4. BD-Focused Tests

- real `BDMV/` sample tree
- large M2TS files
- nested playlist/stream structure
- revision-specific output checks

## Spindle Integration Strategy

Spindle should not bind itself to any one implementation too early.

Instead, preserve a backend boundary such as:

- source tree
- revision
- volume label
- output path

Potential implementations can then be:

- `GenisoimageBackend`
- `MkudffsMountBackend`
- `ForkedUdfBackend`
- later `NativeRustUdfBackend`

That keeps current DVD and future BD work from hard-coding the wrong assumptions.

## Suggested Milestones

### Milestone A

Callable formatter:

- fork builds
- empty 2.50 image creation
- empty 2.60 image creation

### Milestone B

Manual insertion proof:

- create one file and one subdirectory in a fresh image without mounts

### Milestone C

Recursive tree import:

- populate arbitrary source tree into the image

### Milestone D

BD profile proof:

- build one real `BDMV/` tree into a UDF image

### Milestone E

Validation harness:

- fixture images
- oracle comparisons
- regression checks

### Milestone F

Spindle-facing packaging:

- stable CLI and/or C API

## Language Strategy

The best first implementation path is probably to prove the approach inside the C fork before considering a Rust rewrite.

Reasons:

- the critical primitives already exist there
- the missing work is mostly integration and packaging
- the proven API shape can later inform a Rust port

After the BD-oriented fork works, the project can decide whether to:

- keep maintaining the fork as a sidecar backend
- or port the now-understood narrow API to Rust

## Bottom Line

This fork path looks substantially better after inspection than it did from the outside.

The codebase already contains:

- a low-level UDF library
- a filesystem formatting path
- file and directory authoring primitives
- separate mutation and copy logic we can mine

So the real task is not "invent UDF authoring from zero." The real task is:

- refactor the existing pieces
- expose a reusable API
- add a deterministic host-tree population step
- validate the result hard

That makes `udftools` a credible bootstrap for a future reusable BD image-authoring backend.
