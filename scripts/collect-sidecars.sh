#!/usr/bin/env bash
# Collect sidecar binaries for Spindle release packaging.
#
# Copies dvdauthor, spumux, genisoimage/mkisofs into src-tauri/binaries/
# with namespaced Tauri target-triple naming so that `tauri build` can
# bundle them without colliding with host tool names.
#
# Run in any environment that has (or can install) the tools:
#
#   # Native or inside a dev/CI container:
#   ./scripts/collect-sidecars.sh
#
#   # Via Docker (e.g. on a machine without the tools natively):
#   docker run --rm --platform linux/amd64 \
#     -v "$PWD:/workspace" -w /workspace \
#     ghcr.io/liminal-hq/tauri-dev-desktop:latest \
#     bash scripts/collect-sidecars.sh
#
# Usage:
#   ./scripts/collect-sidecars.sh [TARGET_TRIPLE]
#
# TARGET_TRIPLE defaults to the host triple reported by rustc, or is
# inferred from uname if rustc is not available.
#
# Platform notes:
#   Linux  — installs via apt-get if tools are missing.
#   macOS  — installs via brew if tools are missing; mkisofs comes from
#            the cdrtools formula. genisoimage is not available in Homebrew,
#            so the mkisofs binary is copied under both names.
#   Windows — dvdauthor has no Windows port; not supported here.
#
# (c) Copyright 2026 Liminal HQ, Scott Morris
# SPDX-License-Identifier: MIT

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BINARIES_DIR="${REPO_ROOT}/apps/spindle/src-tauri/binaries"

# ── Target triple detection ──────────────────────────────────────────────────

detect_target_triple() {
    # Prefer rustc's own report — authoritative and picks up cross targets.
    if command -v rustc &>/dev/null; then
        rustc -Vv 2>/dev/null | awk '/^host:/ { print $2 }'
        return
    fi
    # Fallback: construct from uname when rustc is not on PATH.
    local arch
    arch="$(uname -m)"
    case "$(uname -s)" in
        Linux)           echo "${arch}-unknown-linux-gnu" ;;
        Darwin)          echo "${arch}-apple-darwin" ;;
        MINGW*|MSYS*|CYGWIN*) echo "${arch}-pc-windows-msvc" ;;
        *)               echo "${arch}-unknown-unknown" ;;
    esac
}

TARGET_TRIPLE="${1:-$(detect_target_triple)}"

echo "Spindle Sidecar Collector"
echo "========================="
echo "Output : ${BINARIES_DIR}"
echo "Target : ${TARGET_TRIPLE}"
echo ""

mkdir -p "${BINARIES_DIR}"

# ── Resolve symlinks portably ────────────────────────────────────────────────

resolve_path() {
    # readlink -f is GNU-only; macOS ships BSD readlink without -f.
    if command -v realpath &>/dev/null; then
        realpath "$1"
    elif command -v greadlink &>/dev/null; then
        greadlink -f "$1"
    else
        readlink -f "$1"
    fi
}

# ── Ensure tools are available ───────────────────────────────────────────────

PLATFORM="$(uname -s)"

ensure_tools_linux() {
    local missing=()
    for tool in dvdauthor spumux genisoimage; do
        command -v "${tool}" &>/dev/null || missing+=("${tool}")
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo "Missing: ${missing[*]} — installing via apt-get..."
        apt-get update -qq
        # dvdauthor package includes spumux; genisoimage package includes mkisofs
        apt-get install -y -qq dvdauthor genisoimage
    fi
}

ensure_tools_macos() {
    local missing=()
    for tool in dvdauthor mkisofs; do
        command -v "${tool}" &>/dev/null || missing+=("${tool}")
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo "Missing: ${missing[*]} — installing via brew..."
        # dvdauthor provides dvdauthor + spumux
        # cdrtools provides mkisofs (genisoimage is not in Homebrew)
        brew install dvdauthor cdrtools
    fi
}

case "${PLATFORM}" in
    Linux)  ensure_tools_linux ;;
    Darwin) ensure_tools_macos ;;
    *)
        echo "Unsupported platform: ${PLATFORM}"
        echo "dvdauthor has no Windows port; Windows builds are not supported."
        exit 1
        ;;
esac

# ── Copy binaries ────────────────────────────────────────────────────────────

copy_as() {
    local tool="$1"
    local sidecar_name="$2"
    local dest="${BINARIES_DIR}/${sidecar_name}-${TARGET_TRIPLE}"
    local src
    src="$(resolve_path "$(command -v "${tool}")")"
    cp "${src}" "${dest}"
    chmod +x "${dest}"
}

copy_as dvdauthor spindle-dvdauthor
copy_as spumux    spindle-spumux

case "${PLATFORM}" in
    Linux)
        # genisoimage is the canonical name on Linux; mkisofs is typically
        # a symlink to the same binary. Copy both under their own names.
        copy_as genisoimage spindle-genisoimage
        if command -v mkisofs &>/dev/null; then
            copy_as mkisofs spindle-mkisofs
        else
            cp "${BINARIES_DIR}/spindle-genisoimage-${TARGET_TRIPLE}" \
               "${BINARIES_DIR}/spindle-mkisofs-${TARGET_TRIPLE}"
        fi
        ;;
    Darwin)
        # genisoimage is not available on macOS via Homebrew; mkisofs (from
        # cdrtools) fills both roles. Copy it under both sidecar names so the
        # Tauri bundle can satisfy both externalBin entries.
        copy_as mkisofs spindle-mkisofs
        cp "${BINARIES_DIR}/spindle-mkisofs-${TARGET_TRIPLE}" \
           "${BINARIES_DIR}/spindle-genisoimage-${TARGET_TRIPLE}"
        ;;
esac

# ── Verify ───────────────────────────────────────────────────────────────────

echo ""
echo "Collected binaries:"
ALL_OK=true
for name in spindle-dvdauthor spindle-spumux spindle-genisoimage spindle-mkisofs; do
    path="${BINARIES_DIR}/${name}-${TARGET_TRIPLE}"
    if [[ -f "${path}" ]]; then
        size=$(du -h "${path}" | cut -f1)
        echo "  ✓ ${name}-${TARGET_TRIPLE} (${size})"
    else
        echo "  ✗ ${name}-${TARGET_TRIPLE} MISSING"
        ALL_OK=false
    fi
done

echo ""
if [[ "${ALL_OK}" == "true" ]]; then
    echo "All sidecars collected. Run \`tauri build\` to bundle them."
else
    echo "Some sidecars are missing — check the output above."
    exit 1
fi
