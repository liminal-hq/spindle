#!/usr/bin/env bash
# Install DVD authoring sidecar tools for Spindle development and packaging.
#
# This script installs the external tools that Spindle uses for DVD-Video
# authoring. During development, tools are resolved from the system PATH.
# For release packaging, tools should be bundled using Tauri's externalBin
# or as resources.
#
# (c) Copyright 2026 Liminal HQ, Scott Morris
# SPDX-License-Identifier: MIT

set -euo pipefail

echo "Spindle Sidecar Installer"
echo "========================="
echo ""

# Detect package manager
if command -v apt-get &> /dev/null; then
    PM="apt"
elif command -v dnf &> /dev/null; then
    PM="dnf"
elif command -v pacman &> /dev/null; then
    PM="pacman"
elif command -v brew &> /dev/null; then
    PM="brew"
else
    echo "No supported package manager found."
    echo "Please install the following tools manually:"
    echo "  - ffmpeg (video/audio transcoding)"
    echo "  - ffprobe (media inspection, usually included with ffmpeg)"
    echo "  - dvdauthor (DVD-Video authoring)"
    echo "  - genisoimage or mkisofs (ISO image creation)"
    exit 1
fi

echo "Detected package manager: ${PM}"
echo ""

install_tools() {
    case "$PM" in
        apt)
            sudo apt-get update
            sudo apt-get install -y ffmpeg dvdauthor genisoimage
            ;;
        dnf)
            sudo dnf install -y ffmpeg dvdauthor genisoimage
            ;;
        pacman)
            sudo pacman -S --noconfirm ffmpeg dvdauthor cdrtools
            ;;
        brew)
            brew install ffmpeg dvdauthor cdrtools
            ;;
    esac
}

echo "Installing: ffmpeg, dvdauthor, genisoimage/mkisofs"
echo ""
install_tools

echo ""
echo "Verifying installation:"
echo ""

TOOLS=("ffmpeg" "ffprobe" "dvdauthor" "spumux")
ISO_TOOL=""

for tool in "${TOOLS[@]}"; do
    if command -v "$tool" &> /dev/null; then
        echo "  ✓ $tool found: $(command -v "$tool")"
    else
        echo "  ✗ $tool NOT found"
    fi
done

# Check for ISO tool (genisoimage or mkisofs)
if command -v genisoimage &> /dev/null; then
    echo "  ✓ genisoimage found: $(command -v genisoimage)"
    ISO_TOOL="genisoimage"
elif command -v mkisofs &> /dev/null; then
    echo "  ✓ mkisofs found: $(command -v mkisofs)"
    ISO_TOOL="mkisofs"
else
    echo "  ✗ genisoimage/mkisofs NOT found"
fi

echo ""
echo "Done. Run Spindle and check Settings → Toolchain to verify."
