// CSS colour string parsing for Skia rendering.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use skia_safe::Color;

/// Parse a CSS colour string into a Skia `Color`.
///
/// Supported formats:
/// - `#rrggbb` — six-digit hex, opaque
/// - `#rrggbbaa` — eight-digit hex, with alpha
/// - `rgba(r, g, b, a)` — CSS rgba() with float alpha in [0, 1]
/// - `rgb(r, g, b)` — CSS rgb(), opaque
///
/// Returns opaque black on parse failure.
pub(super) fn parse_colour(s: &str) -> Color {
    let s = s.trim();

    // rgba(...) / rgb(...)
    if let Some(inner) = s.strip_prefix("rgba(").and_then(|s| s.strip_suffix(')')) {
        let parts: Vec<&str> = inner.splitn(4, ',').collect();
        if parts.len() == 4 {
            let r = parts[0]
                .trim()
                .parse::<f32>()
                .unwrap_or(0.0)
                .clamp(0.0, 255.0) as u8;
            let g = parts[1]
                .trim()
                .parse::<f32>()
                .unwrap_or(0.0)
                .clamp(0.0, 255.0) as u8;
            let b = parts[2]
                .trim()
                .parse::<f32>()
                .unwrap_or(0.0)
                .clamp(0.0, 255.0) as u8;
            let a = (parts[3]
                .trim()
                .parse::<f32>()
                .unwrap_or(1.0)
                .clamp(0.0, 1.0)
                * 255.0)
                .round() as u8;
            return Color::from_argb(a, r, g, b);
        }
    }
    if let Some(inner) = s.strip_prefix("rgb(").and_then(|s| s.strip_suffix(')')) {
        let parts: Vec<&str> = inner.splitn(3, ',').collect();
        if parts.len() == 3 {
            let r = parts[0]
                .trim()
                .parse::<f32>()
                .unwrap_or(0.0)
                .clamp(0.0, 255.0) as u8;
            let g = parts[1]
                .trim()
                .parse::<f32>()
                .unwrap_or(0.0)
                .clamp(0.0, 255.0) as u8;
            let b = parts[2]
                .trim()
                .parse::<f32>()
                .unwrap_or(0.0)
                .clamp(0.0, 255.0) as u8;
            return Color::from_argb(255, r, g, b);
        }
    }

    // Hex formats
    let hex = s.trim_start_matches('#');
    match hex.len() {
        6 => {
            let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
            let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
            let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
            Color::from_argb(255, r, g, b)
        }
        8 => {
            let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
            let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
            let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
            let a = u8::from_str_radix(&hex[6..8], 16).unwrap_or(255);
            Color::from_argb(a, r, g, b)
        }
        _ => Color::BLACK,
    }
}

/// Accept either a CSS hex string or a small set of named colours used in menus.
pub(super) fn parse_colour_name_or_hex(s: &str) -> Color {
    match s.to_ascii_lowercase().as_str() {
        "white" => Color::WHITE,
        "black" => Color::BLACK,
        "red" => Color::from_argb(255, 255, 0, 0),
        "green" => Color::from_argb(255, 0, 128, 0),
        "blue" => Color::from_argb(255, 0, 0, 255),
        "yellow" => Color::from_argb(255, 255, 255, 0),
        "cyan" => Color::from_argb(255, 0, 255, 255),
        "magenta" => Color::from_argb(255, 255, 0, 255),
        _ => parse_colour(s),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_colour_hex6_round_trips() {
        let c = parse_colour("#ff8040");
        assert_eq!(c.r(), 0xff);
        assert_eq!(c.g(), 0x80);
        assert_eq!(c.b(), 0x40);
        assert_eq!(c.a(), 255);
    }

    #[test]
    fn parse_colour_hex8_includes_alpha() {
        let c = parse_colour("#ff804080");
        assert_eq!(c.r(), 0xff);
        assert_eq!(c.g(), 0x80);
        assert_eq!(c.b(), 0x40);
        assert_eq!(c.a(), 0x80);
    }

    #[test]
    fn parse_colour_invalid_falls_back_to_black() {
        let c = parse_colour("notacolour");
        assert_eq!(c, Color::BLACK);
    }

    #[test]
    fn parse_colour_rgba_with_fractional_alpha() {
        // rgba(255, 128, 64, 0.5) → a ≈ 128
        let c = parse_colour("rgba(255, 128, 64, 0.5)");
        assert_eq!(c.r(), 255);
        assert_eq!(c.g(), 128);
        assert_eq!(c.b(), 64);
        assert_eq!(c.a(), 128); // round(0.5 × 255) = 128
    }

    #[test]
    fn parse_colour_rgba_fully_transparent() {
        let c = parse_colour("rgba(255, 255, 255, 0.0)");
        assert_eq!(c.a(), 0);
    }

    #[test]
    fn parse_colour_rgb_is_opaque() {
        let c = parse_colour("rgb(100, 200, 50)");
        assert_eq!(c.r(), 100);
        assert_eq!(c.g(), 200);
        assert_eq!(c.b(), 50);
        assert_eq!(c.a(), 255);
    }
}
