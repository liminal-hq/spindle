// Resolution of sidecar/system binary paths for the tools a build invokes.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

pub(super) struct ResolvedToolchain {
    pub(super) ffmpeg: String,
    pub(super) spumux: String,
    pub(super) dvdauthor: String,
    pub(super) iso_authoring: String,
}

impl ResolvedToolchain {
    pub(super) fn resolve(skip_sidecar: bool) -> Self {
        Self {
            ffmpeg: crate::toolchain::resolve_tool("ffmpeg", skip_sidecar)
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "ffmpeg".to_string()),
            spumux: crate::toolchain::resolve_tool("spumux", skip_sidecar)
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "spumux".to_string()),
            dvdauthor: crate::toolchain::resolve_tool("dvdauthor", skip_sidecar)
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "dvdauthor".to_string()),
            iso_authoring: crate::toolchain::resolve_tool("genisoimage", skip_sidecar)
                .or_else(|| crate::toolchain::resolve_tool("mkisofs", skip_sidecar))
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "genisoimage".to_string()),
        }
    }
}
