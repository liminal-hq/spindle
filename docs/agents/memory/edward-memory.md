# Edward Memory

## Purpose

This file is a working memory note for Edward.

Use it to capture durable strategic context, recurring traps, and product truths that should survive across multiple passes.

## How To Use This File

Update this file when you learn something likely to matter later, especially:

- product-scope pivots
- optical or format constraints
- validation expectations
- recurring traps in plans, docs, or UI promises

Prefer structural facts over narration.

## Current Notes

- Edward's core job is to keep the map aligned with the destination: polished UI work must still respect the real limits of optical-disc authoring.
- Old systems carry old assumptions forward. In Spindle, legacy DVD and authoring constraints should be treated as active product boundaries, not trivia.
- Compatibility and validation should be earned with practical checks rather than trusted because the implementation feels elegant.
- A recurring trap to watch for is promise drift: the UI or docs can imply broader editing or authoring freedom than v1 is actually meant to support.
- Edward is most useful when product ambition, UX language, and native machinery begin to diverge.
- His strongest partnerships are with Franklin for runbook synthesis and Jullian for tracing legacy constraints down into exact system behaviour.
- **Product Truth**: Bitmap subtitle extraction (dvd_subtitle) is the only supported path for v1; text-based subtitle rendering is currently a non-goal.
- **Product Truth**: Placeholders (e.g., 'Coming in Milestone X') are a sign of unearned trust and must be actively avoided in core navigation flows.
- **Technical Trap**: The 'root' menu role in multi-menu titlesets is a known failure point that can cause `DVDNAV_STOP` in authored output (see `docs/dvd-navigation-lab-notes.md`).
- **Technical Trap**: Placeholder-based development can lead to 'Glossy but Broken' UI releases. All authored modes (Bind, Compile, Design, Remote) must be functional before a UI milestone is marked as 'Verified.'
- **Validation Oracle**: The `execute_build_plan_smoke_authors_titleset_menu_return_path` test in the Rust plugin is the primary proof of a working end-to-end authoring loop.
- **Architectural Boundary**: The project model and state are intentionally "format-agnostic" to support future Blu-ray, but implementation logic must remain strictly DVD-Video compliant for now.
- **Product Strategy**: Blu-ray (HDMV/IG) is the primary authoring ceiling. DVD and VCD are targets for graceful degradation. The UI should hide complexity but honestly expose downsampling constraints via the Compile Preview.
- **Technical Trap**: Fluid UI transitions simulated via seamless branching (timecode jumping) require absolute precision with I-frame alignment on sector boundaries to avoid laser seek "clunks".

## Open Questions

- Which specific fix for the titleset-root-entry navigation trap will become the canonical implementation.
- How to transition from bitmap-only subtitle support to a text-rendering pipeline without breaking the 4-colour palette constraint.
- Where the current docs still underspecify non-goals or compatibility boundaries for future Blu-ray expansion.
- Which validation rituals will become Spindle's equivalent of a trusted oracle for authored output.
