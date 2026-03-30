// FFmpeg stderr progress parsing for step-level build progress.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

/// Parse an `out_time` value from FFmpeg `-progress` output into seconds.
///
/// Accepts the `HH:MM:SS.microseconds` format that FFmpeg emits, e.g.
/// `00:01:23.456000`. Returns `None` if the line is not a valid timestamp.
pub fn parse_out_time_secs(value: &str) -> Option<f64> {
    let value = value.trim();
    // Negative sentinel values like `-0:00:00.000000` mean "no data yet".
    if value.starts_with('-') {
        return None;
    }
    let mut parts = value.splitn(3, ':');
    let hours: f64 = parts.next()?.parse().ok()?;
    let minutes: f64 = parts.next()?.parse().ok()?;
    let seconds: f64 = parts.next()?.parse().ok()?;
    let total = hours * 3600.0 + minutes * 60.0 + seconds;
    if total >= 0.0 {
        Some(total)
    } else {
        None
    }
}

/// Extract the value from a `-progress` key-value line.
///
/// FFmpeg `-progress pipe:2` emits lines like `out_time=00:01:23.456000`.
/// Returns `Some(value)` when the line matches the given key.
pub fn extract_progress_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let line = line.trim();
    if line.starts_with(key) && line.as_bytes().get(key.len()) == Some(&b'=') {
        Some(&line[key.len() + 1..])
    } else {
        None
    }
}

/// Compute step percent from elapsed seconds and total duration.
///
/// Returns a value clamped to 0.0–100.0, or `None` when the duration
/// is missing or zero.
pub fn step_percent(elapsed_secs: f64, duration_secs: Option<f64>) -> Option<f64> {
    let dur = duration_secs.filter(|&d| d > 0.0)?;
    let pct = (elapsed_secs / dur) * 100.0;
    Some(pct.clamp(0.0, 100.0))
}

/// Format elapsed seconds as a human-readable `HH:MM:SS` string.
pub fn format_timestamp(secs: f64) -> String {
    let total = secs.max(0.0) as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    format!("{h:02}:{m:02}:{s:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_out_time_basic() {
        assert_eq!(parse_out_time_secs("00:01:23.456000"), Some(83.456));
    }

    #[test]
    fn parse_out_time_negative_sentinel() {
        assert_eq!(parse_out_time_secs("-0:00:00.000000"), None);
    }

    #[test]
    fn parse_out_time_zero() {
        assert_eq!(parse_out_time_secs("00:00:00.000000"), Some(0.0));
    }

    #[test]
    fn parse_out_time_whitespace() {
        assert_eq!(parse_out_time_secs("  00:00:10.500000  "), Some(10.5));
    }

    #[test]
    fn parse_out_time_garbage() {
        assert_eq!(parse_out_time_secs("not-a-time"), None);
    }

    #[test]
    fn extract_progress_value_matches() {
        assert_eq!(
            extract_progress_value("out_time=00:01:23.456000", "out_time"),
            Some("00:01:23.456000")
        );
    }

    #[test]
    fn extract_progress_value_no_match() {
        assert_eq!(
            extract_progress_value("bitrate=1234.5kbits/s", "out_time"),
            None
        );
    }

    #[test]
    fn extract_progress_value_partial_key() {
        // "out_time_us" should not match "out_time"
        assert_eq!(
            extract_progress_value("out_time_us=123456", "out_time"),
            None
        );
    }

    #[test]
    fn step_percent_normal() {
        assert_eq!(step_percent(50.0, Some(100.0)), Some(50.0));
    }

    #[test]
    fn step_percent_clamps_over_100() {
        assert_eq!(step_percent(110.0, Some(100.0)), Some(100.0));
    }

    #[test]
    fn step_percent_none_without_duration() {
        assert_eq!(step_percent(50.0, None), None);
    }

    #[test]
    fn step_percent_none_for_zero_duration() {
        assert_eq!(step_percent(50.0, Some(0.0)), None);
    }

    #[test]
    fn format_timestamp_basic() {
        assert_eq!(format_timestamp(3661.0), "01:01:01");
    }

    #[test]
    fn format_timestamp_zero() {
        assert_eq!(format_timestamp(0.0), "00:00:00");
    }

    #[test]
    fn format_timestamp_negative_clamps() {
        assert_eq!(format_timestamp(-5.0), "00:00:00");
    }
}
