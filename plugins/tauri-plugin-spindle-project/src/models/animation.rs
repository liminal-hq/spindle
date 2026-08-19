// The animation-track model — keyframed highlight/opacity/position tracks
// attached to scene nodes — and the evaluator that samples them. Ported
// bit-for-bit to TypeScript in apps/spindle/src/utils/animation.ts; the two
// implementations are pinned equal by the shared fixture at
// fixtures/animation-parity.json (see the `parity` test module below and
// animation.test.ts).
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};

/// A keyframed animation track targeting one animatable property of one
/// scene node.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationTrack {
    pub node_id: String,
    pub target: AnimatableProperty,
    pub keyframes: Vec<Keyframe>,
}

/// The closed set of properties an [`AnimationTrack`] can drive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AnimatableProperty {
    HighlightColour,
    HighlightOpacity,
    Opacity,
    Position,
}

/// One keyframe within an [`AnimationTrack`]: a value at a point in time,
/// with the easing applied to the segment that *follows* it (i.e. the
/// interval `[self.timestamp_secs, next.timestamp_secs)`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    pub timestamp_secs: f64,
    pub value: KeyValue,
    #[serde(default)]
    pub easing: Easing,
}

/// The value carried by a [`Keyframe`]. Internally tagged on `"kind"` so the
/// JSON shape is self-describing (`{ "kind": "colour", "hex": "#ffaa40" }`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum KeyValue {
    Colour { hex: String },
    Scalar { value: f64 },
    Point { x: f64, y: f64 },
}

/// The closed set of easing curves an [`AnimationTrack`] segment can use.
/// `Linear` is the default so keyframes authored without an explicit easing
/// interpolate smoothly; `Hold` steps directly to the next keyframe's value
/// with no interpolation (used by the DCSQ lowering, which always samples
/// exactly at keyframe timestamps — see `build/planner`'s
/// `OverlaySpuFrame` schedule).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Easing {
    #[default]
    Linear,
    Hold,
    EaseIn,
    EaseOut,
    EaseInOut,
}

/// Sample `track` at `t_secs`.
///
/// - An empty track has no value: `None`.
/// - Before the first keyframe: the first keyframe's value (clamped, not
///   extrapolated).
/// - After the last keyframe: the last keyframe's value.
/// - Between two keyframes `k0`, `k1`: `k0.easing` is applied to
///   `u = (t - k0.timestamp_secs) / (k1.timestamp_secs - k0.timestamp_secs)`
///   — `Hold` returns `k0`'s value outright (no interpolation); the other
///   curves reshape `u` before it's used to interpolate between `k0.value`
///   and `k1.value`. When two adjacent keyframes share a timestamp (a
///   degenerate zero-length segment), `u` is treated as `1.0` — the later
///   keyframe wins exactly at that instant.
pub fn evaluate_track(track: &AnimationTrack, t_secs: f64) -> Option<KeyValue> {
    let keyframes = &track.keyframes;
    let first = keyframes.first()?;
    if keyframes.len() == 1 || t_secs <= first.timestamp_secs {
        return Some(first.value.clone());
    }

    let last = keyframes.last().expect("keyframes is non-empty");
    if t_secs >= last.timestamp_secs {
        return Some(last.value.clone());
    }

    for pair in keyframes.windows(2) {
        let (k0, k1) = (&pair[0], &pair[1]);
        if t_secs >= k0.timestamp_secs && t_secs < k1.timestamp_secs {
            return Some(interpolate(k0, k1, t_secs));
        }
    }

    // Unreachable in practice (the first/last checks above bracket every
    // other `t_secs`), but keep evaluation total rather than panicking.
    Some(last.value.clone())
}

fn interpolate(k0: &Keyframe, k1: &Keyframe, t_secs: f64) -> KeyValue {
    if matches!(k0.easing, Easing::Hold) {
        return k0.value.clone();
    }

    let span = k1.timestamp_secs - k0.timestamp_secs;
    let u = if span > 0.0 {
        ((t_secs - k0.timestamp_secs) / span).clamp(0.0, 1.0)
    } else {
        1.0
    };
    let eased_u = match k0.easing {
        Easing::Linear => u,
        Easing::Hold => unreachable!("handled above"),
        Easing::EaseIn => u * u,
        Easing::EaseOut => 1.0 - (1.0 - u) * (1.0 - u),
        Easing::EaseInOut => 3.0 * u * u - 2.0 * u * u * u,
    };
    lerp_value(&k0.value, &k1.value, eased_u)
}

fn lerp_value(v0: &KeyValue, v1: &KeyValue, u: f64) -> KeyValue {
    match (v0, v1) {
        (KeyValue::Colour { hex: h0 }, KeyValue::Colour { hex: h1 }) => KeyValue::Colour {
            hex: lerp_colour_hex(h0, h1, u),
        },
        (KeyValue::Scalar { value: s0 }, KeyValue::Scalar { value: s1 }) => KeyValue::Scalar {
            value: s0 + (s1 - s0) * u,
        },
        (KeyValue::Point { x: x0, y: y0 }, KeyValue::Point { x: x1, y: y1 }) => KeyValue::Point {
            x: x0 + (x1 - x0) * u,
            y: y0 + (y1 - y0) * u,
        },
        // Mismatched variants shouldn't occur within a well-formed track
        // (every keyframe on a track shares the track's `target`), but stay
        // total rather than panicking on malformed data.
        _ => v0.clone(),
    }
}

/// Parse a `#rrggbb`/`#rrggbbaa` hex colour into (r, g, b, a, had_alpha).
/// `had_alpha` is `false` and `a` is `255` for a 6-digit input.
fn parse_hex_colour(hex: &str) -> (u8, u8, u8, u8, bool) {
    let h = hex.trim_start_matches('#');
    let byte = |start: usize| u8::from_str_radix(h.get(start..start + 2).unwrap_or("00"), 16).unwrap_or(0);
    let r = byte(0);
    let g = byte(2);
    let b = byte(4);
    if h.len() >= 8 {
        (r, g, b, byte(6), true)
    } else {
        (r, g, b, 255, false)
    }
}

fn lerp_u8(a: u8, b: u8, u: f64) -> u8 {
    let v = a as f64 + (b as f64 - a as f64) * u;
    v.round().clamp(0.0, 255.0) as u8
}

/// Componentwise sRGB `u8` lerp between two hex colours, round-half-up per
/// channel. The output includes an alpha channel (`#rrggbbaa`) iff either
/// input did; otherwise it's plain `#rrggbb`.
fn lerp_colour_hex(hex0: &str, hex1: &str, u: f64) -> String {
    let (r0, g0, b0, a0, alpha0) = parse_hex_colour(hex0);
    let (r1, g1, b1, a1, alpha1) = parse_hex_colour(hex1);
    let r = lerp_u8(r0, r1, u);
    let g = lerp_u8(g0, g1, u);
    let b = lerp_u8(b0, b1, u);
    if alpha0 || alpha1 {
        let a = lerp_u8(a0, a1, u);
        format!("#{r:02x}{g:02x}{b:02x}{a:02x}")
    } else {
        format!("#{r:02x}{g:02x}{b:02x}")
    }
}

/// Sample `track` at exactly each of its own keyframe timestamps, in order.
/// Because sampling at a keyframe's own timestamp always yields that
/// keyframe's value (see [`evaluate_track`]'s boundary semantics —
/// `Easing`'s effect is confined to the open interval *between* keyframes),
/// this is equivalent to reading the keyframes' `(timestamp, value)` pairs
/// directly, with no evaluator call needed. It's the schedule the DCSQ
/// lowering (`build/planner`) samples highlight tracks against: one overlay
/// frame per keyframe, exact by construction.
pub fn sample_at_keyframes(track: &AnimationTrack) -> Vec<(f64, KeyValue)> {
    track
        .keyframes
        .iter()
        .map(|kf| (kf.timestamp_secs, kf.value.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn colour_track(stops: &[(f64, &str, Easing)]) -> AnimationTrack {
        AnimationTrack {
            node_id: "btn-1".to_string(),
            target: AnimatableProperty::HighlightColour,
            keyframes: stops
                .iter()
                .map(|(t, hex, easing)| Keyframe {
                    timestamp_secs: *t,
                    value: KeyValue::Colour {
                        hex: (*hex).to_string(),
                    },
                    easing: *easing,
                })
                .collect(),
        }
    }

    #[test]
    fn empty_track_evaluates_to_none() {
        let track = AnimationTrack {
            node_id: "btn-1".to_string(),
            target: AnimatableProperty::HighlightColour,
            keyframes: vec![],
        };
        assert_eq!(evaluate_track(&track, 1.0), None);
        assert_eq!(sample_at_keyframes(&track), vec![]);
    }

    #[test]
    fn single_keyframe_is_constant_everywhere() {
        let track = colour_track(&[(1.0, "#ff0000", Easing::Linear)]);
        assert_eq!(
            evaluate_track(&track, -5.0),
            Some(KeyValue::Colour {
                hex: "#ff0000".to_string()
            })
        );
        assert_eq!(
            evaluate_track(&track, 100.0),
            Some(KeyValue::Colour {
                hex: "#ff0000".to_string()
            })
        );
    }

    #[test]
    fn before_first_and_after_last_clamp() {
        let track = colour_track(&[
            (1.0, "#000000", Easing::Linear),
            (2.0, "#ffffff", Easing::Linear),
        ]);
        assert_eq!(
            evaluate_track(&track, 0.0),
            Some(KeyValue::Colour {
                hex: "#000000".to_string()
            })
        );
        assert_eq!(
            evaluate_track(&track, 3.0),
            Some(KeyValue::Colour {
                hex: "#ffffff".to_string()
            })
        );
    }

    #[test]
    fn hold_steps_to_k0_value_across_the_whole_segment() {
        let track = colour_track(&[
            (0.0, "#000000", Easing::Hold),
            (2.0, "#ffffff", Easing::Linear),
        ]);
        for t in [0.0, 0.5, 1.0, 1.999] {
            assert_eq!(
                evaluate_track(&track, t),
                Some(KeyValue::Colour {
                    hex: "#000000".to_string()
                }),
                "Hold at t={t} should stay at k0's value"
            );
        }
    }

    #[test]
    fn linear_scalar_interpolates() {
        let track = AnimationTrack {
            node_id: "btn-1".to_string(),
            target: AnimatableProperty::HighlightOpacity,
            keyframes: vec![
                Keyframe {
                    timestamp_secs: 0.0,
                    value: KeyValue::Scalar { value: 0.0 },
                    easing: Easing::Linear,
                },
                Keyframe {
                    timestamp_secs: 2.0,
                    value: KeyValue::Scalar { value: 1.0 },
                    easing: Easing::Linear,
                },
            ],
        };
        let Some(KeyValue::Scalar { value }) = evaluate_track(&track, 1.0) else {
            panic!("expected a scalar value");
        };
        assert!((value - 0.5).abs() < 1e-9);
    }

    #[test]
    fn colour_lerp_rounds_half_up_at_one_third() {
        let track = colour_track(&[
            (0.0, "#000000", Easing::Linear),
            (3.0, "#ffffff", Easing::Linear),
        ]);
        // u = 1/3 -> 255/3 = 85.0 exactly, no rounding ambiguity.
        assert_eq!(
            evaluate_track(&track, 1.0),
            Some(KeyValue::Colour {
                hex: "#555555".to_string()
            })
        );
    }

    #[test]
    fn duplicate_timestamp_later_keyframe_wins_at_the_shared_instant() {
        let track = colour_track(&[
            (0.0, "#000000", Easing::Linear),
            (1.0, "#ff0000", Easing::Linear),
            (1.0, "#00ff00", Easing::Linear),
            (2.0, "#0000ff", Easing::Linear),
        ]);
        assert_eq!(
            evaluate_track(&track, 1.0),
            Some(KeyValue::Colour {
                hex: "#00ff00".to_string()
            })
        );
    }

    #[test]
    fn sample_at_keyframes_returns_exact_keyframe_values_in_order() {
        let track = colour_track(&[
            (0.0, "#000000", Easing::Linear),
            (1.5, "#ff8040", Easing::EaseInOut),
        ]);
        assert_eq!(
            sample_at_keyframes(&track),
            vec![
                (
                    0.0,
                    KeyValue::Colour {
                        hex: "#000000".to_string()
                    }
                ),
                (
                    1.5,
                    KeyValue::Colour {
                        hex: "#ff8040".to_string()
                    }
                ),
            ]
        );
    }

    #[test]
    fn key_value_serializes_with_kind_tag() {
        let value = KeyValue::Colour {
            hex: "#ffaa40".to_string(),
        };
        let json = serde_json::to_value(&value).unwrap();
        assert_eq!(json["kind"], "colour");
        assert_eq!(json["hex"], "#ffaa40");
    }

    // ── Fixture parity (fixtures/animation-parity.json, shared with
    // apps/spindle/src/utils/animation.test.ts) ────────────────────────────

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ParityCase {
        name: String,
        track: AnimationTrack,
        samples: Vec<ParitySample>,
    }

    #[derive(Debug, Deserialize)]
    struct ParitySample {
        t: f64,
        expected: Option<KeyValue>,
    }

    #[test]
    fn evaluate_track_matches_the_shared_parity_fixture() {
        let raw = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/animation-parity.json"
        ))
        .expect("fixtures/animation-parity.json should be readable");
        let cases: Vec<ParityCase> =
            serde_json::from_str(&raw).expect("fixtures/animation-parity.json should parse");
        assert!(!cases.is_empty(), "parity fixture must not be empty");

        for case in &cases {
            for sample in &case.samples {
                let actual = evaluate_track(&case.track, sample.t);
                match (&actual, &sample.expected) {
                    (
                        Some(KeyValue::Scalar { value: actual_v }),
                        Some(KeyValue::Scalar { value: expected_v }),
                    ) => {
                        assert!(
                            (actual_v - expected_v).abs() < 1e-9,
                            "case \"{}\" at t={}: expected scalar {expected_v}, got {actual_v}",
                            case.name,
                            sample.t
                        );
                    }
                    _ => {
                        assert_eq!(
                            actual, sample.expected,
                            "case \"{}\" at t={}",
                            case.name, sample.t
                        );
                    }
                }
            }
        }
    }
}
