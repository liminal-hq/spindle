// Format law as data: one `FormatProfile` row per `DiscFamily`, consumed by
// diagnostics, the compile preview, canvas chrome, and validation. Replaces
// the scattered per-format constants (button-count ceiling, subpicture
// palette depth, canvas raster width) that used to hardcode DVD-only
// assumptions across the frontend and Rust validation.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::Serialize;

use super::{AspectMode, BackgroundMode, DiscFamily, MenuRole, MenuSize};

/// How a format renders button focus/activate states. DVD's 4-colour
/// subpicture highlight is the degenerate case of BD's per-state bitmap
/// model, not a separate concept — see `docs/rich-menu-editor-plan.md` §2.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum HighlightModel {
    /// DVD (and, as the closest available bucket, SVCD's OGT highlight
    /// overlay): one subpicture/overlay, small fixed-size CLUT, palette-only
    /// animation. VCD's remote-numeric-key PBC selection has no visible
    /// highlight overlay at all — it's mapped to this variant only because
    /// the closed set above doesn't yet have a third "no highlight" case;
    /// revisit when a VCD backend is actually scoped.
    FourColourSubpicture,
    /// BD: per-state 256-colour bitmaps, frame-sequence animation.
    StateBitmaps256,
}

/// Format law as data. One row per [`DiscFamily`]; consumed by diagnostics,
/// the compile preview, validation, and canvas chrome.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatProfile {
    pub family: DiscFamily,
    /// Human-readable format name, e.g. "DVD-Video", "BDMV".
    pub display_name: &'static str,
    /// Default design-space canvas sizes, one per [`AspectMode`]. Mirrors
    /// [`MenuSize::default_for`] for this family.
    pub design_sizes: &'static [MenuSize],
    /// Maximum navigable buttons/highlight regions per menu page.
    pub max_buttons_per_menu: u32,
    pub highlight_model: HighlightModel,
    /// Minimum legible font size in design-space points, before the
    /// design→raster scale is applied. The single source of truth for this
    /// value — `build/skia/fonts.rs::min_font_size_pt` delegates here.
    pub min_font_size_pt: f32,
    /// Menu roles this format's authoring/backend surface currently
    /// exposes. `Popup` is deliberately absent from every row until a
    /// backend actually implements popup-over-video menus (BD) — see
    /// `docs/rich-menu-editor-plan.md`'s "Menu role model" section.
    pub supported_roles: &'static [MenuRole],
    pub supported_background_modes: &'static [BackgroundMode],
    /// Whether the format can animate button states natively (BD IGS frame
    /// sequences) rather than only via DVD's palette/contrast DCSQ updates.
    pub supports_state_animation: bool,
}

// ── Design sizes ────────────────────────────────────────────────────────────
// Mirrors `MenuSize::default_for` — kept as separate `const` arrays here
// (rather than computed) so `FormatProfile` can hand out `&'static` slices.

const DVD_DESIGN_SIZES: [MenuSize; 2] = [
    MenuSize {
        width: 1024.0,
        height: 768.0,
        aspect: AspectMode::FourByThree,
    },
    MenuSize {
        width: 1024.0,
        height: 576.0,
        aspect: AspectMode::SixteenByNine,
    },
];

const BLU_RAY_DESIGN_SIZES: [MenuSize; 2] = [
    MenuSize {
        width: 1920.0,
        height: 1080.0,
        aspect: AspectMode::FourByThree,
    },
    MenuSize {
        width: 1920.0,
        height: 1080.0,
        aspect: AspectMode::SixteenByNine,
    },
];

const SVCD_DESIGN_SIZES: [MenuSize; 2] = [
    MenuSize {
        width: 800.0,
        height: 600.0,
        aspect: AspectMode::FourByThree,
    },
    MenuSize {
        width: 800.0,
        height: 600.0,
        aspect: AspectMode::SixteenByNine,
    },
];

const VCD_DESIGN_SIZES: [MenuSize; 2] = [
    MenuSize {
        width: 704.0,
        height: 528.0,
        aspect: AspectMode::FourByThree,
    },
    MenuSize {
        width: 704.0,
        height: 528.0,
        aspect: AspectMode::SixteenByNine,
    },
];

// ── Supported roles ─────────────────────────────────────────────────────────
// Same set for every family today — `Popup` stays out until a backend
// implements it (see `FormatProfile::supported_roles` doc comment).

const SUPPORTED_ROLES: [MenuRole; 5] = [
    MenuRole::Root,
    MenuRole::TitleSelect,
    MenuRole::Chapter,
    MenuRole::Setup,
    MenuRole::Extras,
];

// ── Background modes ────────────────────────────────────────────────────────

const DVD_BACKGROUND_MODES: [BackgroundMode; 2] = [BackgroundMode::Still, BackgroundMode::Motion];
const BLU_RAY_BACKGROUND_MODES: [BackgroundMode; 2] =
    [BackgroundMode::Still, BackgroundMode::Motion];
/// SVCD/VCD have no authored motion-menu pipeline in this codebase (unlike
/// DVD's still-blocked-but-modelled motion timing) — `Still` only.
const STILL_ONLY_BACKGROUND_MODES: [BackgroundMode; 1] = [BackgroundMode::Still];

// ── Profile rows ─────────────────────────────────────────────────────────────

static DVD_VIDEO_PROFILE: FormatProfile = FormatProfile {
    family: DiscFamily::DvdVideo,
    display_name: "DVD-Video",
    design_sizes: &DVD_DESIGN_SIZES,
    // DVD spec limit: 36 buttons (highlight rectangles) per menu.
    max_buttons_per_menu: 36,
    highlight_model: HighlightModel::FourColourSubpicture,
    min_font_size_pt: 12.0,
    supported_roles: &SUPPORTED_ROLES,
    supported_background_modes: &DVD_BACKGROUND_MODES,
    supports_state_animation: false,
};

static BLU_RAY_PROFILE: FormatProfile = FormatProfile {
    family: DiscFamily::BluRay,
    display_name: "BDMV",
    design_sizes: &BLU_RAY_DESIGN_SIZES,
    // HDMV IG page limit: up to 255 buttons.
    max_buttons_per_menu: 255,
    highlight_model: HighlightModel::StateBitmaps256,
    min_font_size_pt: 10.0,
    supported_roles: &SUPPORTED_ROLES,
    supported_background_modes: &BLU_RAY_BACKGROUND_MODES,
    supports_state_animation: true,
};

static SVCD_PROFILE: FormatProfile = FormatProfile {
    family: DiscFamily::Svcd,
    display_name: "Super Video CD",
    design_sizes: &SVCD_DESIGN_SIZES,
    // IEC 62107 PBC highlight (OGT) areas: conventionally a handful per
    // still — SVCD authoring tools commonly cap at 4. Model/render-only;
    // revisit against the spec if an SVCD backend is ever scoped.
    max_buttons_per_menu: 4,
    highlight_model: HighlightModel::FourColourSubpicture,
    min_font_size_pt: 16.0,
    supported_roles: &SUPPORTED_ROLES,
    supported_background_modes: &STILL_ONLY_BACKGROUND_MODES,
    supports_state_animation: false,
};

static VCD_PROFILE: FormatProfile = FormatProfile {
    family: DiscFamily::Vcd,
    display_name: "Video CD",
    design_sizes: &VCD_DESIGN_SIZES,
    // White Book PBC selection is driven by single-digit remote numeric
    // keys, not a visible highlight — 9 is the practical per-screen cap.
    // Model/render-only; revisit against the spec if a VCD backend is ever
    // scoped.
    max_buttons_per_menu: 9,
    highlight_model: HighlightModel::FourColourSubpicture,
    min_font_size_pt: 18.0,
    supported_roles: &SUPPORTED_ROLES,
    supported_background_modes: &STILL_ONLY_BACKGROUND_MODES,
    supports_state_animation: false,
};

/// Look up the format-law row for a disc family. `DvdVideo` is the only
/// family exposed in the UI format picker (`DiscFamily::is_ui_supported`);
/// the others are model/render-only but still get honest rows so the
/// pattern holds when a second family is switched on.
pub fn profile_for(family: DiscFamily) -> &'static FormatProfile {
    match family {
        DiscFamily::DvdVideo => &DVD_VIDEO_PROFILE,
        DiscFamily::BluRay => &BLU_RAY_PROFILE,
        DiscFamily::Svcd => &SVCD_PROFILE,
        DiscFamily::Vcd => &VCD_PROFILE,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_for_dvd_matches_known_constraints() {
        let profile = profile_for(DiscFamily::DvdVideo);
        assert_eq!(profile.family, DiscFamily::DvdVideo);
        assert_eq!(profile.max_buttons_per_menu, 36);
        assert_eq!(
            profile.highlight_model,
            HighlightModel::FourColourSubpicture
        );
        assert_eq!(profile.min_font_size_pt, 12.0);
        assert!(!profile.supports_state_animation);
        assert!(!profile.supported_roles.contains(&MenuRole::Popup));
    }

    #[test]
    fn profile_for_blu_ray_supports_state_animation() {
        let profile = profile_for(DiscFamily::BluRay);
        assert_eq!(profile.highlight_model, HighlightModel::StateBitmaps256);
        assert!(profile.supports_state_animation);
        assert_eq!(profile.max_buttons_per_menu, 255);
    }

    #[test]
    fn every_family_has_a_profile_row() {
        for family in [
            DiscFamily::DvdVideo,
            DiscFamily::BluRay,
            DiscFamily::Svcd,
            DiscFamily::Vcd,
        ] {
            let profile = profile_for(family);
            assert_eq!(profile.family, family);
            assert!(!profile.design_sizes.is_empty());
        }
    }

    #[test]
    fn no_profile_supports_popup_yet() {
        for family in [
            DiscFamily::DvdVideo,
            DiscFamily::BluRay,
            DiscFamily::Svcd,
            DiscFamily::Vcd,
        ] {
            assert!(!profile_for(family)
                .supported_roles
                .contains(&MenuRole::Popup));
        }
    }

    #[test]
    fn min_font_size_matches_skia_fonts_values() {
        // Regression guard: `build/skia/fonts.rs::min_font_size_pt` delegates
        // to this table — this test pins the values so the two can't drift.
        assert_eq!(profile_for(DiscFamily::Vcd).min_font_size_pt, 18.0);
        assert_eq!(profile_for(DiscFamily::Svcd).min_font_size_pt, 16.0);
        assert_eq!(profile_for(DiscFamily::DvdVideo).min_font_size_pt, 12.0);
        assert_eq!(profile_for(DiscFamily::BluRay).min_font_size_pt, 10.0);
    }

    #[test]
    fn design_sizes_match_menu_size_default_for() {
        // Regression guard: each profile's `design_sizes` (e.g.
        // `DVD_DESIGN_SIZES` above) is a separate `&'static` array that
        // duplicates `MenuSize::default_for`'s table — kept separate only so
        // `FormatProfile` can hand out `&'static` slices (see the "Design
        // sizes" section comment). Nothing enforces the two tables agree
        // except this test, so every (family, aspect) pair is checked here.
        for family in [
            DiscFamily::DvdVideo,
            DiscFamily::BluRay,
            DiscFamily::Svcd,
            DiscFamily::Vcd,
        ] {
            for aspect in [AspectMode::FourByThree, AspectMode::SixteenByNine] {
                let expected = MenuSize::default_for(family, aspect);
                let profile = profile_for(family);
                let actual = profile
                    .design_sizes
                    .iter()
                    .find(|size| size.aspect == aspect)
                    .unwrap_or_else(|| {
                        panic!("no design size for {family:?}/{aspect:?} in profile_for's table")
                    });
                assert_eq!(
                    actual.width, expected.width,
                    "{family:?}/{aspect:?} width diverges from MenuSize::default_for"
                );
                assert_eq!(
                    actual.height, expected.height,
                    "{family:?}/{aspect:?} height diverges from MenuSize::default_for"
                );
            }
        }
    }
}
