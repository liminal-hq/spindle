# Menu Editor Set 2b Specification

This document reviews the `mockups/yuli/set-2b` prototype against the current Spindle menu editor and defines a practical specification for the next-generation menu editing system.

It assumes the product direction stated by the team:

- Bind, remote, and compile are no longer separate modes in the primary experience.
- Their capabilities should be folded into one calmer, more unified editor.
- Any capability that exists today but is not yet clearly preserved in `set-2b` must be identified so it can either be ported forward or explicitly retired.

## Sources Reviewed

Prototype:

- `mockups/yuli/set-2b/index.html`
- `mockups/yuli/set-2b/menu-editor.html`
- `mockups/yuli/set-2b/menu-editor.css`
- `mockups/yuli/set-2b/menu-editor.js`

Current implementation:

- `apps/spindle/src/pages/MenusPage.tsx`
- `apps/spindle/src/components/menus/SceneCanvas.tsx`
- `apps/spindle/src/components/menus/InspectorPanel.tsx`
- `apps/spindle/src/components/menus/LayersPanel.tsx`
- `apps/spindle/src/components/menus/BindMode.tsx`
- `apps/spindle/src/components/menus/CompileMode.tsx`
- `apps/spindle/src/types/project.ts`
- `apps/spindle/src/store/project-store.ts`

Supporting docs:

- `docs/Spindle_Menu_System_Spec.md`
- `docs/menu-builder-and-authoring-pipeline.md`
- `docs/agents/personas/yuli-persona.md`

## Executive Review

`set-2b` is a strong upgrade in workflow design and information architecture.

Its main strength is not that it adds more controls. Its strength is that it arranges the work more coherently:

- menu selection, menu relationships, and generation live together in the left rail
- the design canvas stays primary
- action binding and navigation editing move beside the visual design instead of into a separate mode
- compile awareness becomes ambient and local instead of a hard context switch
- a full navigation map gives the system a proper multi-menu mental model

This is much closer to how users actually think about authored menus:

- what menu am I on?
- what does it look like?
- where does this button go?
- can the remote navigate it?
- how does it fit into the broader disc?
- will DVD compilation degrade this safely?

That said, `set-2b` also introduces several capability gaps and several aspirational features that are not yet supported by the current Spindle data model or runtime. The biggest risk is not visual complexity. The biggest risk is accidentally removing concrete current behaviour while adopting a more elegant shell.

## What The Current System Already Does

The current editor is more capable than it first appears. It already provides:

- menu creation grouped by `Global` and per-titleset scope
- a scene-based design canvas for buttons, text, image, and shape nodes
- drag, resize, snapping, safe-area guides, and navigation line overlays
- contextual inspector editing for buttons and non-button nodes
- deterministic auto-navigation backed by the plugin layer
- a dedicated bind workflow for per-button action assignment and directional navigation
- explicit default-focus selection
- a compile workflow with DVD preview, palette summary, compile-policy display, and downgrade diagnostics
- keyboard remote preview on the canvas
- undo and redo
- node deletion and menu deletion

In other words, the old system is clunkier in flow, but it has several very concrete authoring and validation affordances that must survive the redesign.

## Set 2b Design Intent

The prototype defines a unified menu authoring surface with two top-level views:

1. Editor
2. Map

Inside the Editor view, the user does not switch between Design, Bind, and Compile. Instead:

- design happens on the canvas
- action binding happens inline in the inspector
- navigation can be shown as an overlay and edited in the inspector
- compile feedback appears as a preview overlay and diagnostics section

This is the correct strategic direction.

## Folded Feature Stance

For this redesign, the correct parity question is not:

- does the new editor still have separate Bind, Remote, and Compile modes?

The correct question is:

- can the unified editor still perform the jobs those modes currently perform?

For acceptance, the new system must preserve these folded capabilities:

- assign and audit actions across all buttons
- edit and verify directional remote navigation
- set and verify default focus
- preview remote traversal behaviour
- show DVD-safe compile feedback
- surface downgrade diagnostics with enough detail to fix problems

## Specification

## 1. Product Goals

The new menu editor must:

- keep the canvas as the primary workspace
- keep users oriented across multiple menus, not just one menu at a time
- fold binding, remote navigation, and compile awareness into the same authoring flow
- preserve honest DVD constraints and diagnostics
- support both handcrafted menus and generated menus
- stay grounded in Spindle’s authored document model rather than becoming a disconnected mockup shell

## 2. Primary Layout

The editor should use a two-column application layout:

- left rail: navigation and generation
- right workspace: editor or map view

### Left Rail

The left rail should contain four persistent blocks:

1. Header with `Editor` / `Map` toggle
2. Scrollable grouped menu list
3. Mini navigation map
4. Templates and Generate Menus sections

### Workspace

The right side should switch between:

- `Editor View`: toolbar + canvas + inspector
- `Map View`: map toolbar + connection canvas + map inspector

This structure in `set-2b` is strong and should be treated as the locked layout direction.

## 3. Menu List

The menu list should remain grouped by authored scope:

- `VMGM` / global menus
- titleset-scoped menus

Each menu card should show:

- menu name
- compact visual preview
- button count or summary
- menu type or background mode
- incoming and outgoing connection counts
- health/status indicator

### Requirements

- Selecting a menu updates the canvas or map selection.
- Scope-local add actions must remain present.
- Menu deletion must remain available somewhere obvious.
- Connection indicators must be computed from authored actions, not hard-coded labels.
- Status indicators must derive from real diagnostics.

## 4. Mini Navigation Map

The mini map is one of the most valuable additions in `set-2b`.

It should:

- persist in the left rail
- show menu-to-menu and menu-to-title relationships
- keep the current menu highlighted
- allow click-to-jump selection
- offer an `Expand` affordance into the full map

### Requirements

- The mini map and full map should share one renderer.
- Connection styles must encode semantic meaning:
  - `showMenu`
  - playback actions
  - return links, if supported
- The renderer must handle dynamic layout and redraw on resize or inspector changes.

## 5. Editor View

### 5.1 Toolbar

The editor toolbar should include:

- editable menu name
- context summary such as domain, format, and button count
- `Preview` toggle
- `Auto Nav` action
- inspector visibility toggle

Optional secondary actions may include:

- menu duplication
- menu deletion
- generation refresh for generated menus

### 5.2 Canvas

The canvas remains the heart of the editor.

It should support:

- authored scene nodes
- first-class non-button scene authoring
- direct selection
- drag and resize
- safe-area overlays
- navigation-arrow overlays
- inline action badges on interactive nodes
- background rendering
- visual focus/default indicators

The canvas tool palette should support at minimum:

- select
- text
- button
- image
- shape

Text, image, and shape nodes must be treated as first-class authored content. The new editor is a menu scene editor, not only a button editor with a few supporting objects.

### 5.2a Safe Areas And Guides

Safe areas and guides must remain first-class canvas features.

The unified editor should support:

- action-safe overlays
- title-safe overlays
- clear visual distinction between guide types
- simple on-canvas toggling
- compile-time status reporting when authored content violates safe regions

Safe-area handling must not be reduced to a static visual reference. It should remain part of authored layout feedback and DVD-readiness review.

### 5.2b Navigation Lines And Arrow Rendering

Navigation lines and directional arrows must remain first-class editor features.

They should support:

- on-canvas rendering of directional navigation relationships
- clear directional arrowheads
- visual distinction between overlapping routes where possible
- toggling on demand without leaving the editor
- redraw when button positions or navigation assignments change

These overlays are not just decorative diagnostics. They are one of the clearest ways to verify authored remote behaviour spatially.

### 5.3 Preview Overlay

Compile awareness should be folded into the Editor view via a preview overlay, but this must remain more than a cosmetic badge strip.

The preview system should provide:

- DVD-safe visual treatment
- button count versus DVD limits
- palette usage against DVD overlay limits
- action-resolution status
- navigation completeness status
- safe-area status
- downgrade and risk diagnostics

The overlay may be summarised visually on-canvas, but detailed diagnostics must still be accessible in the inspector.

## 6. Inspector

The `set-2b` inspector is the centrepiece of the redesign. It turns the old modal workflow into progressive disclosure.

Inspector sections should be collapsible and independently stateful.

### Required inspector sections

1. Background
2. Transform
3. Visual States
4. Button Style
5. Text Style
6. Action
7. Navigation
8. Connections
9. CLUT Palette
10. Highlight Mode
11. Layers
12. Diagnostics

### 6.1 Background

The background section should support:

- solid colour
- still image
- motion video
- still image plus audio

This section should be menu-level, not selection-level.

It should also expose:

- asset picker
- fit mode
- audio source
- loop policy
- motion duration
- intro and loop segment timing

### 6.2 Transform

The transform section should support:

- X
- Y
- width
- height

It should also preserve current production behaviours:

- snapping
- edge and corner resizing
- safe-area awareness

These transform controls must apply cleanly to both button and non-button nodes.

### 6.3 Visual States and Button Style

These sections introduce an authored styling system that the current editor does not yet really have.

They should support separate button-state styling for:

- normal
- focus
- activate

Required style properties:

- background fill
- border colour
- border width
- border radius
- horizontal and vertical padding
- shadow or glow

Important constraint:

- this richer authored styling must compile honestly into DVD-safe highlight overlays and background renders
- the authored control surface cannot imply that all per-state styling is native DVD behaviour

### 6.4 Text Style

The new system should provide proper text styling for:

- standalone text nodes
- button labels

Required text controls:

- font family
- size
- line height
- bold
- italic
- underline
- colour
- alignment
- letter spacing
- text shadow

Standalone text editing is a first-class workflow and must not be reduced to button-label formatting.

### 6.4a Non-Button Node Editing

Non-button node editing must be a first-class feature of the unified editor.

This includes at minimum:

- text nodes
- image nodes
- shape nodes

These node types must support:

- direct canvas selection
- inspector-driven editing
- transform controls
- layer participation
- deletion
- type-appropriate visual styling

Required per-type editing coverage:

- text nodes: content, typography, colour, alignment, spacing, and sizing
- image nodes: asset selection, placement, sizing, and fit behaviour where applicable
- shape nodes: fill, bounds, and future stroke or radius controls if those become part of the authored style model

The unified editor should be understood as a scene editor for menus, not merely a button-routing tool.

### 6.5 Action

Action editing should remain inline in the inspector.

It should support the current concrete actions:

- `playTitle`
- `playChapter`
- `showMenu`
- `stop`

The prototype also proposes:

- `setAudioStream`
- `setSubtitleStream`
- `sequence`
- `return`

These are useful design targets, but they are not currently supported end-to-end in the reviewed Spindle implementation and must be treated as planned extensions, not assumed parity.

### 6.6 Navigation

Navigation should combine auto-generated and manual control.

Required behaviour:

- explicit up/down/left/right neighbours
- auto/manual state
- recalculate-from-geometry action
- visual overlay on canvas
- default-focus editing

Default focus must not be implicit-only. It needs an explicit control.

### 6.7 Connections

Connections should surface the broader authored graph without forcing a mode change.

This section should show:

- outgoing menu links
- incoming menu links
- title playback targets
- return targets, if supported

Each connection entry should support click-to-jump.

### 6.8 CLUT Palette

The CLUT palette section is a strong addition because it names the DVD constraint directly.

It should expose the authored-to-DVD mapping for the four DVD subpicture slots:

- background / transparent
- emphasis 1
- emphasis 2
- anti-alias

This should integrate with compile diagnostics and preview, not exist as an isolated cosmetic picker.

### 6.9 Highlight Mode

Highlight mode should support:

- static
- animated

Animated highlight controls should only be active when the menu can support motion output.

Required fields:

- mode
- keyframe count or timeline entry
- easing

Important note:

- the prototype implies animated highlight behaviour, but the production system currently only stores a lightweight keyframe structure
- a proper animation UI will need richer authoring and preview support than currently exists

### 6.10 Layers

The layer list should be moved into the inspector or an adjacent collapsible panel as in the prototype.

Required behaviour:

- ordered z-list
- type icon
- readable label
- select on click
- visibility toggle
- drag-to-reorder

Current Spindle already lists layers, but does not yet provide visibility or reordering.

### 6.11 Diagnostics

Diagnostics must remain first-class.

At minimum the unified editor must report:

- too many buttons
- unbound actions
- missing default focus
- broken directional references
- unreachable buttons
- motion-menu informational warnings
- compile-policy warnings

This section can be collapsed, but it cannot disappear.

## 7. Map View

The full navigation map is a major improvement over the old route mental model because it scales to multi-menu authoring.

The map should show:

- menu cards grouped spatially by scope
- title targets as distinct non-menu nodes
- colour-coded connection lines
- click-to-select
- double-click to open a menu in the editor
- a map inspector for outgoing, incoming, and title-play relationships

### Requirements

- The map must be data-driven from authored actions.
- Connection routing must redraw dynamically.
- The map must support both menu-to-menu and menu-to-title links.
- It should gracefully scale beyond the four-menu demo.

## 8. Generation

The left-rail `Generate Menus` section is directionally excellent and fits Spindle’s authored-project model very well.

The new system should support generation for:

- chapter grid menus
- audio setup menus
- subtitle setup menus

Generation should create editable authored menus, not locked templates.

### Required generation outputs

- menu scenes
- button labels
- playback or setting actions
- directional navigation
- pagination for large chapter sets
- next and back links where needed

### Important implementation note

The prototype proposes audio and subtitle setup menus before those actions clearly exist in the current reviewed action model. This is a valid product direction, but it requires schema and compiler work before it is feature-complete.

## 9. Data Model Requirements

To support the unified editor cleanly, Spindle should continue leaning into the authored `MenuDocument` model.

The production data model should clearly distinguish:

- authored scene data
- authored interaction graph
- authored menu timing
- authored style and highlight intent
- compile policy and DVD adaptation

### The current model already supports or partially supports

- scene nodes
- interaction graph
- default focus
- timing skeleton
- highlight colours
- highlight mode
- highlight keyframes
- compile policy
- generation metadata placeholder

### The new UI will require stronger model support for

- richer button visual styling
- text styling
- layer visibility and ordering controls
- background fit policy
- audio-only still menu backgrounds
- richer motion segment timing
- extended action types
- explicit return semantics, if retained
- generated-menu provenance and refresh strategy

## 10. Editing Safety

Undo, redo, and deletion must be treated as first-class authoring guarantees.

The more unified and canvas-centric the editor becomes, the more important it is that users can safely explore, recover, and remove authored changes without anxiety.

### Required safety behaviours

- undo
- redo
- delete selected node
- delete selected button
- delete menu
- clear visual selection state before destructive actions where appropriate

### Undo And Redo

The unified editor should preserve current undo and redo behaviour and make it easier to discover.

Requirements:

- keyboard shortcuts must remain supported
- undo and redo must work across canvas moves, inspector edits, action changes, navigation edits, and structural edits
- the UI should expose these actions in a visible place such as the editor toolbar or an overflow menu
- grouped operations should undo coherently rather than as noisy micro-steps where possible

### Deletion

Deletion must remain explicit, predictable, and type-aware.

Requirements:

- deleting a selected node must work from the keyboard when focus is not inside an input control
- deleting a button must also clean up associated interaction references safely
- deleting a menu must remain available from the main editor surface
- inspector-level remove actions should exist for the currently selected entity
- destructive actions should avoid surprising data loss and should always remain undoable

### Editing Safety Principle

The new editor should feel safer than the current one, not riskier.

That means unified flow should not come at the cost of losing:

- recoverability
- predictable destructive actions
- confidence during experimentation

## 11. Implementation Stance

The safest way to build `set-2b` is to preserve current behaviour first, then merge views, then add the richer authored features.

Recommended implementation order:

1. Replace mode switching with unified editor layout while preserving existing action, navigation, default-focus, and diagnostics capabilities.
2. Add the full map and mini-map as shared graph views.
3. Move compile reporting into preview plus inspector diagnostics without losing detail.
4. Add generation affordances backed by real project data.
5. Add richer styling and motion authoring only after authored-to-DVD compilation rules are explicit.

## Gaps Against The Current System

This section captures what the current editor offers today that `set-2b` does not yet preserve clearly enough.

## 1. Batch Binding Overview Is Weaker

The current `BindMode` gives a complete table of every button’s action and default-focus status, plus a grid of every button’s directional neighbours.

That table view is operationally valuable because it lets users audit a whole menu at once.

`set-2b` replaces that with selection-based inspector editing. That is calmer, but weaker for bulk verification.

### Requirement

The new unified editor should keep a batch-audit view somewhere, such as:

- an expandable inspector subsection
- a popover summary table
- a secondary “All Buttons” sheet

## 2. Explicit Default-Focus Editing Is Missing

The current editor has an explicit default-focus radio selection.

The prototype shows a visual default marker on the canvas, but it does not clearly expose how a different button becomes the default focus.

### Requirement

Add an explicit `Set as default focus` control in the inspector and surface the current default clearly in both Editor and Map views.

## 3. Remote Preview Is Not Fully Preserved

The current canvas supports keyboard navigation preview, which approximates DVD remote traversal inside the editor.

`set-2b` shows navigation arrows and compile preview, but does not clearly preserve interactive remote traversal.

### Requirement

Keep keyboard remote preview in the unified editor, ideally as:

- a `Preview navigation` toggle
- focus movement on arrow keys
- activation preview on Enter

## 4. Compile Diagnostics Are Less Detailed

The current compile mode reports concrete downgrade issues:

- button-count limits
- unbound actions
- missing default focus
- broken nav references
- unreachable buttons
- motion-menu info
- compile policy

The prototype’s preview overlay is excellent for at-a-glance status, but it is presently too summary-oriented.

### Requirement

Retain the detailed compile diagnostics list and compile-policy visibility inside the unified inspector.

## 5. Menu Deletion And Node Deletion Are Not Clearly Carried Forward

The current system exposes:

- `Delete Menu`
- selected-node deletion by keyboard
- remove button or node actions in the inspector

These removal paths are not clearly preserved in the prototype shell.

### Requirement

The unified editor must keep:

- delete menu
- remove selected node
- remove selected button
- keyboard deletion where safe

See also: `Editing Safety`.

## 6. Undo And Redo Are Not Surfaced

The current editor supports undo and redo.

The prototype does not show undo and redo in either toolbar or shortcut notes.

### Requirement

Preserve undo and redo with visible shortcut support and ideally a toolbar affordance.

See also: `Editing Safety`.

## 7. Some Proposed Actions Exceed Current Runtime Support

The prototype introduces:

- `setAudioStream`
- `setSubtitleStream`
- `sequence`
- `return`

These may be desirable, but they are not part of the reviewed currently-supported action set used by the present editor flow.

### Requirement

The spec must distinguish:

- `supported in current implementation`
- `planned for the new system`

The UI must not imply full runtime support before the schema, compiler, and authoring pipeline can actually honour it.

## 8. Non-Button Node Editing Is Under-Specified

The current editor already supports selecting and editing:

- text nodes
- image nodes
- shape nodes

The prototype strongly develops button styling and text styling, but image, shape, and general-node editing are still less explicit than the current production inspector model.

### Requirement

The new inspector needs clear per-node-type editing paths, not only button-centric controls.

This should be treated as a core product requirement, not just a parity note. Non-button node authoring belongs in the mainline editor model and implementation plan.

## 9. Current Asset-Backed Background Selection Is More Concrete

The current editor already binds background choices to real project assets and real asset filtering.

The prototype’s background section is richer, but it is still a mockup-level control surface.

### Requirement

Back the new background editor with:

- real asset pickers
- asset validation
- image versus video eligibility
- audio compatibility checks

## 10. Compile Policy And Authored Metadata Are Not Visible Enough

The current model already contains:

- compile policy
- timing
- generation metadata placeholder
- theme reference placeholder
- timeout action

The prototype improves UI breadth but does not yet clearly decide where these lower-level authored fields live.

### Requirement

Decide explicitly which of these remain user-facing in the unified editor and which become advanced or generated fields.

## 11. Layers Need Real Visibility And Ordering Behaviour

The prototype correctly adds visibility toggles and reorder intent to Layers.

However, the current production system does not yet implement these behaviours. That means the prototype is ahead of reality here, not at parity.

### Requirement

Treat layer visibility and reordering as implementation work, not as already-solved parity.

## 12. Route Intelligence Must Stay Trustworthy

The current auto-navigation is backed by the plugin layer and writes into the real model.

The prototype currently mocks this behaviour visually.

### Requirement

The unified UI must keep a deterministic, testable navigation engine and not regress to a purely front-end-only effect.

## Recommendation

Adopt `set-2b` as the layout and workflow target.

Do not treat it as feature-complete parity yet.

The correct path is:

1. preserve current binding, default-focus, remote-preview, deletion, undo/redo, and diagnostics capabilities
2. fold them into the new unified layout
3. then add the richer authored styling, motion, map, and generation features in grounded phases

If we do that, `set-2b` can become the calm, spatial, Yuli-aligned version of the menu editor without quietly dropping the very production features that make the current editor dependable.

---

**Supplemental Document:** See [Set 2b Format Scaling and Hardware Reality](menu-editor-set-2b-format-scaling.md) for details on targeting Blu-ray as the baseline and graceful degradation for DVD/VCD.
