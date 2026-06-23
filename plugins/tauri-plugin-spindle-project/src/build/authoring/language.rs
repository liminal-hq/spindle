// ISO 639 language code normalisation for dvdauthor subpicture stream
// declarations.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use isolang::Language;

pub(super) fn dvdauthor_subpicture_language(language: &str) -> Option<String> {
    let normalised = language
        .trim()
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();

    if matches!(normalised.as_str(), "" | "und" | "nolang") {
        return None;
    }

    // FFprobe often surfaces ISO 639-2/B bibliographic codes from container metadata
    // such as `fre`, while `isolang` resolves the canonical 639-3 form `fra`.
    // Canonicalise the common bibliographic aliases here, then let `isolang`
    // handle the real 639-1/639-3 conversion work.
    let canonical = match normalised.as_str() {
        "alb" => "sqi",
        "arm" => "hye",
        "baq" => "eus",
        "bur" => "mya",
        "chi" => "zho",
        "cze" => "ces",
        "dut" => "nld",
        "fre" => "fra",
        "geo" => "kat",
        "ger" => "deu",
        "gre" => "ell",
        "ice" => "isl",
        "mac" => "mkd",
        "mao" => "mri",
        "may" => "msa",
        "per" => "fas",
        "rum" => "ron",
        "slo" => "slk",
        "tib" => "bod",
        "wel" => "cym",
        _ => normalised.as_str(),
    };

    Language::from_639_1(canonical)
        .and_then(|lang| lang.to_639_1())
        .or_else(|| Language::from_639_3(canonical).and_then(|lang| lang.to_639_1()))
        .map(str::to_string)
}
