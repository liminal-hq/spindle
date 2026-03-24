# DVD and BD should share the authoring language, but not necessarily the compiler

The clean way to think about it is:

**DVD and BD should share the authoring language, but not necessarily the compiler.**

So the crossover is in the parts that describe **what the user is trying to author**, and the divergence is in the parts that describe **how that authored project becomes a real disc structure**.

Here’s the split.

## Where DVD and BD cross over

These are the things that should live in the shared architecture:

### Project structure

A project still has assets, titles, chapters, tracks, menus, navigation intent, build settings, diagnostics, and saved state regardless of whether the target is DVD or BD.

### Media organisation

Importing files, inspecting streams, tracking metadata, fingerprints, missing files, relinking, and cache management should all be shared.

### Track mapping intent

The user still wants to say:

- this video belongs to this title
- these audio tracks are included
- these subtitles are included
- this chapter structure exists
- this menu button goes here

That is authored intent, not disc-backend logic.

### Planning and diagnostics

Capacity planning, bitrate guidance, compatibility warnings, source inspection, and quality-risk signalling all belong in shared layers, even though the exact formulas and legal ranges may differ per backend.

### Menu authoring concepts

At the human level, both formats involve menus, buttons, targets, themes, layout, and navigation. The model for “a menu page with buttons and actions” should be shared at a high level.

### Build orchestration

The app still needs a job system, progress reporting, working directories, logs, manifests, dry-run mode, capability detection, and validation pipelines. That orchestration shell should be shared.

So the shared side is basically:

**editor + planner + project model + orchestration shell**.

## Where DVD and BD diverge

This is where you do **not** want fake universality.

### Disc structure

DVD has titlesets, VMG/VTS-style thinking, DVD menu constraints, DVD-Video filesystem output, and DVD-era assumptions.
BD will have different grouping rules, different output layout, and different authoring expectations.

So “grouping unit” should be shared as a concept, but “DVD titleset” should stay DVD-specific.

### Legal media/output targets

DVD has its own legal video rasters, codecs, subtitle/subpicture behaviour, and menu limitations.
BD will have a different capability envelope.

So “video output profile” is shared, but the actual allowed profiles come from the backend.

### Menu implementation

A shared menu model is fine, but the compilation target for menus may differ a lot.
DVD menu compilation is very DVD-shaped.
BD may support different interaction models and assets.

So the editor should author **menu intent**, while each backend compiles that intent differently.

### Validation rules

Both need validation, but the rules are not the same.
A shared validation engine can exist, but it should call backend-specific validators for backend-specific checks.

### Toolchain

DVD and BD almost certainly won’t share the same authoring toolchain end to end.
The encode/probe layers may overlap, but the authoring backend should be format-specific.

So the lowest layer is definitely separate.

## The architecture plan

The plan in the implementation doc is basically aiming for a layered model like this:

### 1. Shared authored-disc layer

This is the stable core.

It owns:

- Project
- Disc
- DiscFamily
- Title
- Chapter
- Track mappings
- Menu/page/button model
- Themes/generation hooks
- Planner intent
- Diagnostics model
- Build intent

This layer answers:

**What is the user making?**

### 2. Shared application services

This is the operational middle layer.

It owns:

- asset import
- media inspection
- cache/fingerprints
- relinking
- planner engine
- navigation preview
- logging
- manifests
- job orchestration
- capability reporting

This layer answers:

**How does the app reason about the project?**

### 3. Format backend layer

This is where DVD and later BD split.

Each backend owns:

- legal output targets
- grouping semantics
- format-specific validation
- menu compilation rules
- authoring-definition generation
- filesystem/image output rules
- backend-specific QA/compliance checks

This layer answers:

**How does this authored project become a real disc for this format?**

### 4. Tool adapters

These are backend-facing wrappers around external tools.

They own:

- capability detection
- command construction
- tool invocation
- parsing output/errors
- classifying failures

This layer answers:

**How do we drive the real native tools safely?**

## The important design rule

The shared model should not become “lowest common denominator optical mush”.

In other words, don’t flatten DVD and BD into one vague fake format.

A better rule is:

- share the **human authoring concepts**
- isolate the **format law**
- let the build planner route into the right backend

That is why the current plan uses ideas like:

- `disc.family`
- format backend selector
- grouping unit instead of assuming titleset everywhere
- backend capability plumbing
- backend-aware build planning

## A good mental model

Think of Spindle like this:

**Frontend/editor** = the workshop  
**Shared Rust core** = the foreman  
**DVD backend / future BD backend** = different mastering lines in the same factory

The workshop and foreman can stay mostly the same.
The mastering line changes depending on the target format.

## In practical terms

For v1, you should build:

- a shared project schema with `disc.family = dvd-video`
- shared title/chapter/menu/track authoring
- a DVD backend that knows how to validate and compile that into DVD output
- backend capability reporting from day one

Then later, BD support becomes:

- add `disc.family = blu-ray` or equivalent
- add BD-specific schema extensions where needed
- add BD backend validator/planner/compiler/image builder
- reuse as much of the editor, planner shell, and diagnostics shell as possible

So the crossover is mostly:

**authoring intent, UI, inspection, planning shell, orchestration**

And the divergence is mostly:

**backend legality, compilation, output structure, and final validation**

The architecture plan is therefore:

**shared authored core + shared app services + pluggable format backends + tool adapters**.

That’s the right shape if you want Spindle to stay disciplined and not turn into either a DVD-only dead end or a vague universal media tool.
