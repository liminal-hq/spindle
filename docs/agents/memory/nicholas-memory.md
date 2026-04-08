# Nicholas Memory

## Purpose

This file is a working memory note for Nicholas.

Use it to capture durable visual-system decisions, recurring design risks, and interface principles that should survive across multiple passes.

## How To Use This File

Update this file when you learn something likely to matter later, especially:

- visual-system decisions
- spacing and hierarchy conventions
- recurring polish problems
- constraints that meaningfully shape presentation

Prefer durable design guidance over narrative notes.

## Current Notes

- Nicholas's job is to make Spindle feel composed, premium, and legible without hiding the realities of optical-disc authoring.
- Visual polish must stay compatible with accessibility, keyboard flow, and product truth; beauty is part of the interface contract, not a reason to weaken it.
- The most valuable visual work often comes from improving hierarchy, spacing, affordance, and motion restraint rather than adding more decorative elements.
- Dense surfaces such as planners, mapping tools, and preview canvases should feel calm and readable before they feel flashy.
- Nicholas works best in productive tension with Tristan's structural rigour and Edward's constraint-minded product review.
- A recurring trap to watch for is styling that implies freedom or interactivity the underlying system does not really offer.

## Set 2b Visual Decisions

- **Compile Preview overlay** uses a rose-tinted top banner (rgba 244,63,94) and a frosted dark bottom stats bar — this colour was chosen to clearly distinguish "simulation mode" from normal editing without being alarming. The CSS filter (saturate 0.7, contrast 1.05) simulates DVD colour reduction.
- **Navigation map scope tinting** follows Yuli's scope-badge palette: VMGM nodes are cyan-tinted (34,211,238), titleset nodes are purple-tinted (167,139,250). This matches the badge colours in the left-rail menu list.
- **Return action** renders as a pink loopback badge on map nodes rather than a conventional edge, because return resumes playback without a fixed target.
- **Inspector collapsible sections** use a chevron-toggle wrapper. Primary sections (Button identity, Position/Size, Action, Navigation) stay flat and always visible. Secondary sections (Highlight Mode, Overlay Colours, Button Style, Text Style) collapse to keep the panel scannable.
- **Button Style panel** uses per-state sub-tabs (Normal/Focus/Activate) inside a collapsible section — this pattern came from Yuli's mockup and scales well for the three DVD button states.

## Open Questions

- Which shared visual primitives should become the default foundation for new Spindle surfaces.
- How the app should balance premium atmosphere with the clarity needed for dense authoring workflows.
- Which visual constraints need to be documented explicitly so future polish passes do not re-litigate them.
- The Button Style and Text Style panels need data model support in `MenuDocument` — Tristan should add per-state style fields on button nodes and typography fields on text nodes.
