// Shared build utility helpers.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

pub(crate) fn sanitise_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub(crate) fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub(crate) fn format_dvd_timestamp(seconds: f64) -> String {
    let total_secs = seconds as u64;
    let h = total_secs / 3600;
    let m = (total_secs % 3600) / 60;
    let s = total_secs % 60;
    let f = ((seconds - seconds.floor()) * 30.0) as u64;
    format!("{h}:{m:02}:{s:02}.{f}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitise_filename_strips_special_chars() {
        assert_eq!(sanitise_filename("hello world!"), "hello_world_");
        assert_eq!(sanitise_filename("test-file_1"), "test-file_1");
    }

    #[test]
    fn xml_escape_handles_special_chars() {
        assert_eq!(
            xml_escape("a&b<c>d\"e'f"),
            "a&amp;b&lt;c&gt;d&quot;e&apos;f"
        );
    }

    #[test]
    fn format_dvd_timestamp_correct() {
        assert_eq!(format_dvd_timestamp(0.0), "0:00:00.0");
        assert_eq!(format_dvd_timestamp(300.0), "0:05:00.0");
        assert_eq!(format_dvd_timestamp(3661.5), "1:01:01.15");
    }
}
