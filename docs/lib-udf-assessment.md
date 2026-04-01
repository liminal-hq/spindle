# libudf — UDF Filesystem Image Creation Assessment

## Purpose

Create UDF 2.50 (standard BD) and UDF 2.60 (UHD BD) filesystem images from BDMV directory trees. This is the BD equivalent of DVD's `genisoimage`/`mkisofs` ISO 9660 pipeline.

## Status: Build-only-if-needed

Unlike igs-author and pgs::author which are definitively required, a native Rust UDF library is a **contingency item**. External tools may be sufficient.

## External tool options

### Option 1: `genisoimage -udf` (or `mkisofs -udf`)

**Pros:**
- Already integrated as sidecar for DVD ISO
- Supports UDF filesystem creation
- Widely available on Linux

**Cons:**
- UDF support may be incomplete for BD compliance (UDF 2.50 specifically)
- `genisoimage` is unmaintained (last release 2010)
- May not handle UDF 2.60 for UHD BD
- Large files (>4 GB) support uncertain with older versions

**Verdict:** Test first. If it produces BD images that play in reference players, use it.

### Option 2: `mkudffs` + `dd` + mount

**Pros:**
- Part of `udftools` package, actively maintained
- Creates proper UDF filesystems
- Supports UDF 2.50 and 2.60

**Cons:**
- Creates UDF on block devices or image files, not from directory trees directly
- Workflow: create image → mkudffs → mount → copy files → unmount
- Requires root/sudo for mount (or udisksctl/fuse)
- More complex than a single tool invocation

**Verdict:** Usable but awkward for a build pipeline. Consider if genisoimage fails.

### Option 3: tsMuxeR BD image creation

**Pros:**
- tsMuxeR is already needed for M2TS muxing
- Some versions support creating BD folder structures

**Cons:**
- BD image creation support varies by version/fork
- May not produce standalone ISO images
- Not its primary purpose

**Verdict:** Investigate but don't rely on it.

### Option 4: Build `libudf` in Rust

**Pros:**
- Full control over UDF compliance level
- No external tool dependency for ISO creation
- Can guarantee UDF 2.50/2.60 correctness
- Handles large files natively
- Can be reused across platforms without sidecar packaging

**Cons:**
- UDF is a complex specification (ECMA-167 + UDF revisions)
- Significant implementation effort (~4-6 weeks)
- Low-level filesystem work (partition descriptors, allocation tables, ICBs)
- Testing requires reference implementations for comparison

## Recommendation

1. **Phase 1:** Use `genisoimage -udf` — test with real BD content, verify playback
2. **Phase 2:** If Phase 1 fails, try `mkudffs` workflow with automated mount/copy
3. **Phase 3:** Only build `libudf` if external tools cannot produce compliant BD images

**Decision point:** After Phase 4.5 of the main integration plan (BD ISO generation). Test external tools with a real authored BDMV structure, verify in VLC/mpv, and decide.

## If we build it: scope

A minimal `libudf` for BD authoring would need:

- UDF 2.50 and 2.60 volume structure (Anchor Volume Descriptor Pointer, Partition Descriptor, Logical Volume Descriptor, File Set Descriptor)
- File Entry (ICB) creation for regular files and directories
- Allocation Extent descriptors for file data
- Short and Long Allocation Descriptors
- Directory structure with File Identifier Descriptors
- Large file support (>4 GB for UHD BD streams)
- Write to image file (sector-aligned, 2048-byte logical sectors)

**Not needed for BD authoring:**
- Reading/mounting existing UDF images
- UDF journaling or metadata partition (not used for BD-ROM)
- Sparing tables (not used for BD-ROM pressed discs)
- UDF 2.01 backward compatibility structures

**Estimated scope:** ~4-6 weeks for a write-only BD-focused UDF implementation.

## Research to do before deciding

1. Test `genisoimage -udf -allow-limited-size -udf-revision 2.50` on a real BDMV tree
2. Verify the resulting ISO plays in VLC and mpv with libbluray
3. Test `genisoimage -udf -udf-revision 2.60` for UHD BD
4. Check if any Rust crate already provides UDF write capability (none known as of 2026-04)
5. Review ECMA-167 and UDF 2.60 specs for implementation complexity assessment
