# UDF Fork Execution Plan

## Purpose

This note turns the higher-level fork strategy into a concrete flow of work for building a reusable UDF image-authoring backend from a fork of `udftools`.

The focus here is execution order, concrete outputs, and decision points. This is not organized by week count. It is organized by the work flow needed to move from exploration to a usable backend.

The intended end state is:

- a forkable, testable codebase
- a reusable internal library surface
- a deterministic `source tree -> UDF image` path
- support for UDF 2.50 and 2.60
- a backend shape that Spindle can later call without mount workflows

## Working Scope

This execution plan assumes a narrow target:

- offline image creation only
- filesystem tree input
- image file output
- UDF 2.50 and 2.60
- 2048-byte sectors
- deterministic behavior
- no interactive shell UX
- no mount/copy dependency
- no attempt to preserve the full original `udftools` product surface as the primary API

## Phase 0: Fork Setup and Baseline Capture

### Goal

Start from a clean fork with enough baseline evidence that later changes can be validated against something concrete.

### Tasks

- Fork `pali/udftools`.
- Create a dedicated working branch for library-oriented extraction.
- Build the upstream project unchanged.
- Record:
  - build steps
  - outputs
  - warnings
  - current CLI behavior of `mkudffs`
- Generate a small set of baseline images using unmodified `mkudffs`:
  - empty 2.50 image
  - empty 2.60 image
  - image file written to a normal file path, not a device
- Save baseline inspection notes for those images.

### Outputs

- working fork
- reproducible build instructions
- baseline empty-image artifacts
- a small baseline notes file for later comparison

### Exit Criteria

- the fork builds cleanly enough to work on
- we can create empty UDF 2.50 and 2.60 image files
- we understand the current `mkudffs` entry path well enough to refactor it safely

## Phase 1: Codebase Orientation and Reuse Map

### Goal

Turn the codebase from "interesting upstream source" into "known components with clear responsibilities."

### Tasks

- Trace the full `mkudffs` control flow:
  - argument parsing
  - disc initialization
  - revision selection
  - partition/fileset/root setup
  - descriptor emission
  - final write path
- Trace the public and internal roles of:
  - `libudffs/`
  - `mkudffs/`
  - `wrudf/`
- Identify globals and implicit shared state.
- Write a local component map that answers:
  - what owns disc state
  - what creates files and directories
  - what allocates blocks
  - what writes descriptor data
  - what writes final bytes to the image
  - what parts assume interactive command behavior

### Outputs

- component map
- call graph notes
- list of reusable functions
- list of dangerous couplings and globals

### Exit Criteria

- we can point to the exact functions responsible for:
  - empty image creation
  - root/fileset creation
  - file creation
  - directory creation
  - payload insertion
  - final emission

## Phase 2: Stabilize Empty-Filesystem Creation as a Callable Engine

### Goal

Create a callable formatting pipeline that does not depend on the current CLI shape.

### Tasks

- Introduce a structured build options object.
- Extract orchestration logic from `mkudffs/main.c` into a callable function.
- Make `main.c` a wrapper around the new callable path.
- Ensure the callable path can:
  - initialize `udf_disc`
  - select revision
  - create the partition/fileset/root structures
  - stop before final write if requested

### Suggested Internal API Shape

```c
int udfbuild_prepare_empty_disc(struct udf_disc *disc, const struct udfbuild_options *opts);
```

### Outputs

- a callable formatter function
- a thin CLI wrapper
- no behavioral regression for the legacy `mkudffs` CLI

### Exit Criteria

- empty filesystem creation can be invoked from code, not only from CLI flow
- the resulting in-memory state is accessible before image write

## Phase 3: Freeze an Internal Context Model

### Goal

Stop passing around loose globals and opaque state wherever possible.

### Tasks

- Introduce a new internal context type for the forked reusable layer.
- Make it own:
  - build options
  - `struct udf_disc`
  - root path information
  - diagnostics buffer
  - policy flags
- Wrap global-heavy routines behind explicit context calls where possible.
- Add a stable error-reporting path instead of printing everything directly from deep logic.

### Suggested Shape

```c
typedef struct udfbuild_ctx {
  struct udf_disc disc;
  struct udfbuild_options opts;
  char last_error[1024];
  unsigned flags;
} udfbuild_ctx;
```

### Outputs

- reusable internal context
- a cleaner boundary for future population logic
- reduced dependency on CLI-global state

### Exit Criteria

- new code can operate through `udfbuild_ctx`
- formatting and later population work can share one stable context object

## Phase 4: Turn Empty-Image Setup into a Deliberate Formatting Layer

### Goal

Make "format a new UDF image model" an explicit reusable layer with a clean handoff to population.

### Tasks

- Split the preparation process into explicit steps:
  - initialize disc defaults
  - apply revision
  - apply preset/profile
  - allocate filesystem structures
  - create root/fileset
  - expose root descriptor and partition extent
- Ensure the following become easy to access from new code:
  - root directory descriptor
  - partition extent
  - fileset descriptor
  - image sizing info

### Outputs

- internal formatting layer
- explicit handoff point to population phase

### Exit Criteria

- after formatting, new code can reliably locate the root directory and partition space for tree insertion

## Phase 5: Build a Host Filesystem Scanning Layer

### Goal

Add a deterministic source-tree scanner before trying to author anything.

### Tasks

- Create a host filesystem abstraction module.
- Add tree scanning that records:
  - directories
  - regular files
  - sizes
  - timestamps
  - basic permissions
- Decide early how to handle unsupported node types:
  - symlinks
  - sockets
  - FIFOs
  - device files
- Decide path normalization rules:
  - reject or normalize weird paths
  - forbid escaping above the root
- Keep scanning separate from insertion.

### Outputs

- source tree manifest or manifest-like internal structure
- clear unsupported-file behavior

### Exit Criteria

- the project can scan a directory tree deterministically before image creation
- we can compute expected content counts and rough size requirements

## Phase 6: Add Deterministic Sizing and Planning

### Goal

Know how large the image should be before population begins.

### Tasks

- Build a sizing pass based on the scanned tree.
- Estimate:
  - payload bytes
  - directory entry overhead
  - descriptor overhead
  - alignment and allocation slack
- Support explicit sizing modes:
  - fixed image size
  - auto size
  - auto size with extra margin
- Keep the planning output visible for diagnostics.

### Outputs

- deterministic size planner
- image block count decision before authoring begins

### Exit Criteria

- the system can explain why a given image size was chosen
- image creation no longer depends on ad hoc manual sizing

## Phase 7: Implement Directory Authoring

### Goal

Prove that the new path can build directory structure inside the image without mounts.

### Tasks

- Write a recursive directory population function.
- Use `udf_mkdir()` to create child directories from the scanned manifest.
- Track mapping between:
  - host path
  - authored UDF descriptor
- Preserve consistent traversal order for deterministic outputs.
- Validate:
  - directory counts
  - parent links
  - visible tree shape

### Outputs

- a working "directories only" authoring path
- mapping structure from source tree nodes to UDF descriptors

### Exit Criteria

- a nested directory tree can be authored into a fresh image correctly
- inspection shows correct directory structure

## Phase 8: Implement File Authoring and Payload Insertion

### Goal

Add real file creation and payload writing to the tree importer.

### Tasks

- For each regular file:
  - create a file descriptor with `udf_create()`
  - allocate space for payload extents
  - copy file bytes into the allocated descriptor/data model
- Separate metadata logic from payload logic:
  - timestamps
  - permissions
  - ownership policy
- Ensure large-file support is exercised early.
- Fail fast on partial copy or extent mismatch.

### Likely Sources to Reuse

- `mkudffs/file.c` primitives
- file-copy logic patterns from `wrudf/wrudf-cmnd.c`

### Outputs

- a working "tree with files" authoring path
- payload insertion flow for regular files

### Exit Criteria

- generated image contents match source file bytes after inspection or extraction
- large files work through the new path

## Phase 9: Add BD-Oriented Profiles

### Goal

Turn the reusable backend into something explicitly useful for future BD work instead of leaving it as a generic formatter.

### Tasks

- Add named profiles such as:
  - `bd-rom-250`
  - `bd-rom-260`
- Define what each profile controls:
  - revision
  - block size
  - default flags
  - any feature constraints
  - deterministic allocation behavior
- Make profiles easy to request from code and CLI.

### Outputs

- explicit BD-friendly modes
- reduced flag complexity for callers

### Exit Criteria

- creating a 2.50 or 2.60 image can be requested through one intentional profile selection

## Phase 10: Add a Thin New CLI for Tree-to-Image Use

### Goal

Expose the new reusable path through a simple non-interactive command for testing and future sidecar use.

### Suggested Command

```text
mkudffs-tree --profile bd-rom-250 --source /path/to/BDMV_ROOT --output out.iso --label MY_DISC
```

### Tasks

- Create a new CLI wrapper around the reusable context path.
- Make its behavior explicit and deterministic.
- Avoid inheriting the original interactive command semantics.
- Ensure logs are suitable for automation.

### Outputs

- simple tree-to-image CLI
- easy harness for test fixtures and future integration

### Exit Criteria

- we can build an image from a directory tree in one direct invocation without mounts

## Phase 11: Build Structural Validation

### Goal

Do not rely on "it wrote a file" as evidence of correctness.

### Tasks

- Add validation routines that check:
  - required descriptors
  - root/fileset consistency
  - directory and file counts
  - expected file sizes
  - extent sanity
- Add image inspection helpers where useful.
- Keep validation deterministic and machine-readable where possible.

### Outputs

- internal structural validation pass
- reusable validation helpers for tests

### Exit Criteria

- generated images can be validated automatically beyond simple existence checks

## Phase 12: Build Oracle Comparisons

### Goal

Use the existing mount/copy workflow as a behavioral reference where helpful.

### Tasks

- Create the same source-tree image using:
  - reference workflow
  - new fork path
- Compare:
  - visible tree
  - extracted file hashes
  - revision markers
  - descriptor-level sanity where practical
- Record expected acceptable differences versus actual problems.

### Outputs

- oracle comparison fixtures
- evidence that the new path behaves plausibly against an existing workflow

### Exit Criteria

- the new path agrees with reference results closely enough to be trusted for further work

## Phase 13: Exercise Real BDMV Trees

### Goal

Move from toy trees to realistic BD-oriented inputs.

### Tasks

- Run the new backend against a real prepared `BDMV/` tree.
- Exercise:
  - nested directory structure
  - large M2TS payloads
  - realistic naming
  - 2.50 and 2.60 modes
- Inspect and validate the resulting images.

### Outputs

- first realistic BD-oriented fixture results
- notes on any profile or authoring adjustments required

### Exit Criteria

- one or more realistic `BDMV/` trees can be turned into structurally valid UDF images

## Phase 14: Clean API Boundary for Reuse

### Goal

Promote the internal authoring flow into a stable reusable surface.

### Tasks

- Add a public or semi-public header for the new authoring API.
- Ensure callers can do the following without knowing internals:
  - create context
  - choose profile
  - add source tree
  - write image
  - fetch error
  - destroy context
- Keep the API narrow and intentionally boring.

### Candidate Shape

```c
udfbuild_ctx *udfbuild_create(const udfbuild_options *opts);
int udfbuild_add_tree(udfbuild_ctx *ctx, const char *source_root);
int udfbuild_write_image(udfbuild_ctx *ctx, const char *output_path);
const char *udfbuild_last_error(udfbuild_ctx *ctx);
void udfbuild_free(udfbuild_ctx *ctx);
```

### Outputs

- stable reusable API surface
- clear boundary between callers and implementation details

### Exit Criteria

- a caller can use the backend without directly touching `mkudffs` implementation details

## Phase 15: Package the Backend for Spindle-Oriented Use

### Goal

Make the result easy to consume from Spindle later, whether as a sidecar CLI or future FFI layer.

### Tasks

- Decide whether the first integration surface should be:
  - CLI only
  - C library only
  - both
- If CLI:
  - make stdout/stderr structured enough for build logs
- If library:
  - ensure ABI expectations are manageable
- Preserve a backend abstraction in Spindle so this implementation can later be replaced if needed.

### Outputs

- integration-ready packaging strategy
- no forced commitment yet to a Rust rewrite or permanent C dependency

### Exit Criteria

- the backend can be invoked cleanly from external automation or future Spindle integration

## Supporting Cross-Cutting Work

These tasks should continue throughout the flow rather than being isolated to one step.

### Diagnostics

- Replace deep `printf` error behavior with structured error propagation where practical.
- Keep logs useful for non-interactive build systems.

### Determinism

- Use stable traversal order.
- Avoid hidden randomness where possible.
- Make outputs reproducible when inputs are unchanged.

### Scope Discipline

- Stay focused on offline image creation.
- Do not drift into writable-media repair, packet-writing UX, or generalized filesystem editing unless directly required.

### Safety

- Reject unsupported source file types early and clearly.
- Fail hard on partial or inconsistent image state during build.

## Decision Gates

There are a few places where the project should pause and decide how far to continue.

### Gate 1: After Callable Formatting Works

Question:

- Does the codebase feel stable enough to keep shaping, or already too brittle?

If yes:

- continue with population layer

If no:

- reconsider using the fork only as a reference for a Rust implementation

### Gate 2: After Files and Directories Work

Question:

- Does the new path successfully author arbitrary trees with acceptable maintainability?

If yes:

- proceed to BD profiles and realistic fixtures

If no:

- shrink scope further or reevaluate the fork approach

### Gate 3: After Real BDMV Trees Work

Question:

- Is the C fork a good long-term sidecar, or only a prototype to inform a Rust port?

If the C fork feels maintainable:

- keep it as a backend

If the C fork feels too brittle:

- preserve the API shape and validation suite, then port only the proven narrow backend to Rust

## Success Criteria

This effort is successful when all of the following are true:

- a prepared source tree can be authored directly into a UDF image without mount workflows
- UDF 2.50 and 2.60 are explicit supported modes
- outputs are deterministic enough for automated build usage
- the new path has validation beyond "file exists"
- the reusable interface is narrow and stable
- the resulting backend can be slotted behind a future Spindle BD image-generation boundary

## Bottom Line

The execution path should treat `udftools` as a set of reusable subsystems to be reorganized, not as a finished library waiting to be linked.

The practical flow is:

1. make formatting callable
2. stabilize context and state
3. add scanning and sizing
4. author directories
5. author files and payloads
6. add BD profiles
7. validate aggressively
8. expose a narrow API

That sequence gives the highest chance of producing a useful backend without getting lost in a premature rewrite or an overly broad fork.
