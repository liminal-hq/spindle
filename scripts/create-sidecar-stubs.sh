#!/usr/bin/env bash
# Create minimal stub executables for sidecar binaries.
#
# Tauri's build script validates that externalBin paths exist before compiling.
# In CI environments (linting, unit tests) and dev checkouts where real sidecar
# binaries have not been collected yet, this script places tiny stub executables
# so that `cargo check`, `clippy`, and `cargo test` can proceed.
#
# The stubs print an error and exit non-zero if accidentally invoked at runtime,
# so any test or code path that mistakenly calls a sidecar will fail loudly.
#
# For actual app builds and integration testing, run collect-sidecars.sh instead.
#
# (c) Copyright 2026 Liminal HQ, Scott Morris
# SPDX-License-Identifier: MIT

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BINARIES_DIR="${REPO_ROOT}/apps/spindle/src-tauri/binaries"

TARGET_TRIPLE="${1:-x86_64-unknown-linux-gnu}"

mkdir -p "${BINARIES_DIR}"

TOOLS=(spindle-dvdauthor spindle-spumux spindle-genisoimage spindle-mkisofs)

for tool in "${TOOLS[@]}"; do
    dest="${BINARIES_DIR}/${tool}-${TARGET_TRIPLE}"
    if [[ ! -f "${dest}" ]]; then
        printf '#!/usr/bin/env sh\necho "%s stub: real binary not collected" >&2\nexit 1\n' "${tool}" > "${dest}"
        chmod +x "${dest}"
        echo "  created stub: ${tool}-${TARGET_TRIPLE}"
    else
        echo "  exists:       ${tool}-${TARGET_TRIPLE}"
    fi
done

echo ""
echo "Stubs ready in: ${BINARIES_DIR}/"
