#!/usr/bin/env bash
# Collect sidecar binaries for Spindle release packaging.
#
# Copies dvdauthor, spumux, genisoimage, and mkisofs into
# src-tauri/binaries/ with Tauri target-triple naming so that
# `tauri build` can bundle them into the app.
#
# Run this in any environment that has the tools available — natively
# on a Linux dev machine, inside a dev container, or via Docker:
#
#   # Native or inside a dev/CI container:
#   ./scripts/collect-sidecars.sh
#
#   # Via Docker (e.g. on a machine without the tools installed):
#   docker run --rm --platform linux/amd64 \
#     -v "$PWD:/workspace" -w /workspace \
#     ghcr.io/liminal-hq/tauri-dev-desktop:latest \
#     bash scripts/collect-sidecars.sh
#
# Usage:
#   ./scripts/collect-sidecars.sh [TARGET_TRIPLE]
#
# TARGET_TRIPLE defaults to x86_64-unknown-linux-gnu.
#
# (c) Copyright 2026 Liminal HQ, Scott Morris
# SPDX-License-Identifier: MIT

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BINARIES_DIR="${REPO_ROOT}/apps/spindle/src-tauri/binaries"

TARGET_TRIPLE="${1:-x86_64-unknown-linux-gnu}"

echo "Spindle Sidecar Collector"
echo "========================="
echo "Output : ${BINARIES_DIR}"
echo "Target : ${TARGET_TRIPLE}"
echo ""

mkdir -p "${BINARIES_DIR}"

# ── Ensure tools are available ──────────────────────────────────────────────

TOOLS_NEEDED=(dvdauthor spumux genisoimage)
MISSING=()

for tool in "${TOOLS_NEEDED[@]}"; do
    if ! command -v "${tool}" &>/dev/null; then
        MISSING+=("${tool}")
    fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo "Missing tools: ${MISSING[*]}"
    if command -v apt-get &>/dev/null; then
        echo "Installing via apt-get..."
        apt-get update -qq
        apt-get install -y -qq dvdauthor genisoimage
    else
        echo ""
        echo "Tools not found and apt-get is unavailable."
        echo "Install the missing tools manually, or run this script inside"
        echo "an environment that has them (dev container, Docker, etc.)."
        echo ""
        echo "  dvdauthor  — DVD-Video authoring"
        echo "  spumux     — shipped with dvdauthor"
        echo "  genisoimage — ISO image creation (also provides mkisofs)"
        exit 1
    fi
fi

# ── Copy binaries ────────────────────────────────────────────────────────────

copy_tool() {
    local name="$1"
    local dest="${BINARIES_DIR}/${name}-${TARGET_TRIPLE}"
    local src
    src="$(command -v "${name}")"
    # Resolve symlinks so we always copy a real executable
    src="$(readlink -f "${src}")"
    cp "${src}" "${dest}"
    chmod +x "${dest}"
}

copy_tool dvdauthor
copy_tool spumux
copy_tool genisoimage

# mkisofs is genisoimage on Debian/Ubuntu — copy under its own name
# so both logical sidecar names resolve to a real binary in the bundle.
if command -v mkisofs &>/dev/null; then
    copy_tool mkisofs
else
    cp "${BINARIES_DIR}/genisoimage-${TARGET_TRIPLE}" \
       "${BINARIES_DIR}/mkisofs-${TARGET_TRIPLE}"
fi

# ── Verify ──────────────────────────────────────────────────────────────────

echo ""
echo "Collected binaries:"
ALL_OK=true
for name in dvdauthor spumux genisoimage mkisofs; do
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
