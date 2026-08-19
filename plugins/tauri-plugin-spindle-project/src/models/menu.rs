// Menu scene graph, navigation/interaction graph, and button/text styling.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    AnimatableProperty, AnimationTrack, AspectMode, DiscFamily, Easing, KeyValue, Keyframe,
    PlaybackAction, VideoStandard,
};

/// The nine legacy flat-menu fields, retired in favour of `MenuDocument`.
///
/// Old project files still carry these keys at the top level of a `menu`
/// object (via `#[serde(flatten)]` below), so they keep deserialising —
/// that's the only way a `Menu` can end up with these populated. They are
/// never serialised back out (`skip_serializing`) and never read outside
/// [`Menu::migrate_to_document`], which lifts them into an authored
/// [`MenuDocument`] exactly once, at load time.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyMenuFields {
    #[serde(default)]
    background_asset_id: Option<String>,
    #[serde(default)]
    buttons: Vec<MenuButton>,
    #[serde(default)]
    default_button_id: Option<String>,
    #[serde(default)]
    highlight_colours: MenuHighlightColours,
    #[serde(default)]
    background_mode: BackgroundMode,
    #[serde(default)]
    motion_duration_secs: Option<f64>,
    #[serde(default)]
    motion_audio_asset_id: Option<String>,
    #[serde(default)]
    motion_loop_count: u32,
    #[serde(default)]
    timeout_action: Option<PlaybackAction>,
}

/// A menu page with buttons and navigation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Menu {
    pub id: String,
    pub name: String,
    /// The authored scene document. Guaranteed present for every menu once
    /// [`SpindleProjectFile::migrate_all_menus`] has run (i.e. for any menu
    /// reached via `parse_project`) — see [`Menu::doc`]/[`Menu::doc_mut`].
    #[serde(default)]
    pub authored_document: Option<MenuDocument>,
    /// Deserialise-only mirror of the pre-`MenuDocument` flat menu shape.
    /// See [`LegacyMenuFields`].
    #[serde(flatten, default, skip_serializing)]
    legacy: LegacyMenuFields,
}

impl Default for Menu {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: "Untitled Menu".to_string(),
            authored_document: None,
            legacy: LegacyMenuFields::default(),
        }
    }
}

impl Menu {
    /// Construct a menu with no authored document yet. The private `legacy`
    /// field means `Menu { .., ..Menu::default() }` struct-update syntax
    /// isn't usable outside `models::menu` (Rust requires read access to
    /// every field for that syntax, even unnamed ones) — this is the public
    /// constructor for callers elsewhere in the crate (mainly test
    /// fixtures). Chain [`Menu::with_document`] to attach a document.
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            authored_document: None,
            legacy: LegacyMenuFields::default(),
        }
    }

    /// Attach an authored document, builder-style.
    pub fn with_document(mut self, doc: MenuDocument) -> Self {
        self.authored_document = Some(doc);
        self
    }

    /// Lift a legacy menu into the new authored document format, consuming
    /// (and clearing) `self.legacy`. Used during migration to ensure old
    /// projects can be edited in the new scene editor.
    pub fn migrate_to_document(
        &mut self,
        domain: MenuDomain,
        standard: VideoStandard,
        display_aspect: AspectMode,
    ) {
        let legacy = std::mem::take(&mut self.legacy);

        if let Some(doc) = &mut self.authored_document {
            // Every legacy field except `motion_audio_asset_id` already had a
            // document home on main: the old editor's sync layer mirrored
            // background/buttons/highlights/etc into `authoredDocument` the
            // moment a menu was opened, so any project file that carries both
            // a document and legacy fields has a document that's already
            // up to date for those eight fields. Motion audio is the one
            // exception — the editor wrote `motionAudioAssetId` directly and
            // the old sync layer never mirrored it, and old `MenuTiming` had
            // no audio field to mirror it into — so it's the only field that
            // can be sitting exclusively in `legacy` even when a document is
            // already present. Backfill it (without clobbering an audio
            // asset already authored directly on the document) and stop.
            if doc.timing.audio_asset_id.is_none() {
                doc.timing.audio_asset_id = legacy.motion_audio_asset_id.clone();
            }
            return;
        }

        let (res_w, res_h) = standard.default_resolution();

        let scene = MenuScene {
            design_size: MenuSize {
                width: res_w,
                height: res_h,
                aspect: display_aspect,
            },
            background: SceneBackground {
                asset_id: legacy.background_asset_id.clone(),
                colour: Some("#101014".to_string()),
            },
            nodes: legacy
                .buttons
                .iter()
                .map(|b| SceneNode::Button {
                    id: b.id.clone(),
                    label: b.label.clone(),
                    x: b.bounds.x,
                    y: b.bounds.y,
                    width: b.bounds.width,
                    height: b.bounds.height,
                    highlight_mode: b.highlight_mode,
                    highlight_keyframes: b.highlight_keyframes.clone(),
                    video_asset_id: b.video_asset_id.clone(),
                    button_style: None,
                    label_style: None,
                })
                .collect(),
            guides: Vec::new(),
        };

        let interaction = MenuInteractionGraph {
            default_focus_id: legacy.default_button_id.clone(),
            nodes: legacy
                .buttons
                .iter()
                .map(|b| FocusNode {
                    node_id: b.id.clone(),
                    nav_up: b.nav_up.clone(),
                    nav_down: b.nav_down.clone(),
                    nav_left: b.nav_left.clone(),
                    nav_right: b.nav_right.clone(),
                    action: b.action.clone(),
                })
                .collect(),
            timeout_action: legacy.timeout_action.clone(),
        };

        let timing = MenuTiming {
            intro_start_secs: 0.0,
            intro_duration_secs: 0.0,
            loop_start_secs: 0.0,
            loop_duration_secs: legacy.motion_duration_secs.unwrap_or(0.0),
            loop_count: legacy.motion_loop_count,
            audio_asset_id: legacy.motion_audio_asset_id.clone(),
        };

        self.authored_document = Some(MenuDocument {
            animation: vec![],
            id: self.id.clone(),
            name: self.name.clone(),
            domain,
            // Left absent — a legacy flat menu never carried a role, so this
            // must always be inferred, not treated as an explicit choice.
            // `backfill_role` (called immediately after this lift, by
            // `SpindleProjectFile::migrate_all_menus`) fills it in with the
            // cross-menu context (generation metadata, entry-VMGM position)
            // this method doesn't have.
            role: None,
            scene,
            interaction,
            timing,
            highlight_colours: legacy.highlight_colours.clone(),
            background_mode: legacy.background_mode,
            theme_ref: None,
            generation_meta: None,
            compile_policy: MenuCompilePolicy {
                display_aspect: Some(display_aspect),
                safe_area_mode: SafeAreaMode::ActionSafe,
                palette_strategy: PaletteStrategy::Auto,
            },
        });
    }

    /// Run the full per-menu migration sequence — lift legacy fields into a
    /// document (or backfill motion audio onto an existing one), then apply
    /// the compile-default and design-size-aspect backfills that follow it.
    /// This is the single per-menu entry point shared by
    /// [`SpindleProjectFile::migrate_all_menus`] (the load path) and any
    /// Tauri command that receives a `Menu`/`SpindleProjectFile` payload
    /// straight from the webview, where the guest-js type still allows
    /// `authoredDocument: null` — those commands call this defensively so
    /// [`Menu::doc`]/[`Menu::doc_mut`]'s "populated after load" invariant
    /// genuinely holds regardless of how the payload arrived. Idempotent:
    /// safe to call on an already-migrated menu.
    pub fn ensure_document(
        &mut self,
        domain: MenuDomain,
        standard: VideoStandard,
        display_aspect: AspectMode,
    ) {
        self.migrate_to_document(domain, standard, display_aspect);
        self.ensure_authored_compile_defaults(display_aspect);
        self.backfill_design_size_aspect(display_aspect);
    }

    pub fn ensure_authored_compile_defaults(&mut self, display_aspect: AspectMode) {
        if let Some(doc) = &mut self.authored_document {
            if doc.compile_policy.display_aspect.is_none() {
                doc.compile_policy.display_aspect = Some(display_aspect);
            }
        }
    }

    /// Back-fill `design_size.aspect` on existing authored documents where the field
    /// was absent (old project files deserialise it as the default `SixteenByNine`).
    /// We overwrite only when the compile policy has an explicit display aspect that
    /// differs, so we don't clobber intentionally authored values.
    pub fn backfill_design_size_aspect(&mut self, display_aspect: AspectMode) {
        if let Some(doc) = &mut self.authored_document {
            let policy_aspect = doc.compile_policy.display_aspect.unwrap_or(display_aspect);
            if doc.scene.design_size.aspect != policy_aspect {
                doc.scene.design_size.aspect = policy_aspect;
            }
        }
    }

    /// Back-fill `role` on existing authored documents via
    /// [`MenuDocument::infer_role`], establishing the "always `Some` after
    /// migrate" invariant documented on [`MenuDocument::role`]. Only fills
    /// in a genuinely absent (`None`) role — a role explicitly persisted as
    /// [`MenuRole::TitleSelect`] is a real authored choice and survives
    /// unchanged, unlike the old sentinel-comparison approach which
    /// couldn't distinguish "never inferred" from "user deliberately picked
    /// Title Select" and silently re-inferred over the user's choice on
    /// every load.
    pub fn backfill_role(&mut self, domain: MenuDomain, is_entry_vmgm_menu: bool) {
        if let Some(doc) = &mut self.authored_document {
            if doc.role.is_none() {
                doc.role = Some(doc.infer_role(domain, is_entry_vmgm_menu));
            }
        }
    }

    /// Infallible accessor for the authored document. Every menu reached via
    /// `parse_project` has one, since `SpindleProjectFile::migrate_all_menus`
    /// runs `migrate_to_document` on every menu at load time. Menus built
    /// directly (e.g. in tests) must set `authored_document` themselves.
    pub fn doc(&self) -> &MenuDocument {
        self.authored_document.as_ref().expect(
            "Menu.authored_document must be populated (via migrate_to_document or directly) before use",
        )
    }

    /// Mutable counterpart to [`Menu::doc`].
    pub fn doc_mut(&mut self) -> &mut MenuDocument {
        self.authored_document.as_mut().expect(
            "Menu.authored_document must be populated (via migrate_to_document or directly) before use",
        )
    }

    pub fn resolved_background_asset_id(&self) -> Option<&str> {
        self.doc().scene.background.asset_id.as_deref()
    }

    pub fn resolved_background_mode(&self) -> BackgroundMode {
        self.doc().background_mode
    }

    pub fn resolved_motion_duration_secs(&self) -> Option<f64> {
        self.doc().motion_loop_duration()
    }

    pub fn resolved_motion_loop_start_secs(&self) -> f64 {
        self.doc().timing.loop_start_secs
    }

    pub fn resolved_motion_audio_asset_id(&self) -> Option<&str> {
        self.doc().timing.audio_asset_id.as_deref()
    }

    pub fn authored_display_aspect(&self) -> Option<AspectMode> {
        self.doc().compile_policy.display_aspect
    }

    pub fn resolved_display_aspect(&self, fallback: AspectMode) -> AspectMode {
        self.authored_display_aspect().unwrap_or(fallback)
    }
}

/// A structured menu document that separates authored intent from target compilation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuDocument {
    pub id: String,
    pub name: String,
    pub domain: MenuDomain,
    /// What the user means this menu to be, independent of `domain`'s
    /// physical VMGM/Titleset placement. See [`MenuRole`] and
    /// [`MenuDocument::infer_role`]. `None` only ever appears transiently,
    /// between deserialisation and [`Menu::backfill_role`] — it means "the
    /// field was absent from the JSON" (old project files written before
    /// this field existed, or a document built fresh without picking a role
    /// yet), as distinct from a role explicitly persisted as
    /// [`MenuRole::TitleSelect`]. [`SpindleProjectFile::migrate_all_menus`]
    /// backfills a real inference for `None` only, so an explicit
    /// `title-select` on a reloaded document survives instead of being
    /// silently re-inferred. Every menu reached via `parse_project` has this
    /// as `Some` — same "populated after migrate" invariant as
    /// [`Menu::authored_document`]/[`Menu::doc`].
    #[serde(default)]
    pub role: Option<MenuRole>,
    pub scene: MenuScene,
    pub interaction: MenuInteractionGraph,
    pub timing: MenuTiming,
    pub highlight_colours: MenuHighlightColours,
    pub background_mode: BackgroundMode,
    pub theme_ref: Option<String>,
    pub generation_meta: Option<MenuGenerationMeta>,
    pub compile_policy: MenuCompilePolicy,
    /// Keyframed animation tracks (highlight colour/opacity, and eventually
    /// opacity/position) for this document's scene nodes. Supersedes the
    /// legacy per-button `highlight_keyframes`/`highlight_mode` model.
    /// `#[serde(default)]` so project files written before this field
    /// existed deserialise cleanly.
    #[serde(default)]
    pub animation: Vec<AnimationTrack>,
}

impl MenuDocument {
    /// The motion loop duration, or `None` when it hasn't been authored
    /// (`loop_duration_secs` is a plain `f64`, not an `Option`, so `<= 0.0`
    /// is the "unset" sentinel).
    pub fn motion_loop_duration(&self) -> Option<f64> {
        (self.timing.loop_duration_secs > 0.0).then_some(self.timing.loop_duration_secs)
    }

    /// Lift legacy per-button `highlight_keyframes` (the Stage 2
    /// animated-highlight model) into [`AnimationTrack`]s on `self.animation`,
    /// clearing the source arrays afterwards. Idempotent: a document with no
    /// `HighlightMode::Animated` button carrying keyframes — including one
    /// this method has already lifted — is a no-op, since the guard is
    /// "non-empty `highlight_keyframes`", not "has ever been lifted".
    ///
    /// Called from [`crate::SpindleProjectFile::migrate_all_menus`] (the
    /// load-path migration hook), not from [`Menu::migrate_to_document`] —
    /// that method only runs for menus with no authored document yet
    /// (legacy-mirror projects), whereas keyframes can appear on
    /// already-documented menus too.
    pub fn lift_highlight_keyframes(&mut self) {
        let defaults = self.highlight_colours.clone();
        let mut lifted = Vec::new();
        for node in &mut self.scene.nodes {
            lift_highlight_keyframes_in_node(node, &defaults, &mut lifted);
        }
        self.animation.append(&mut lifted);
    }

    /// Collect the top-level buttons in this document's scene, joined with
    /// their interaction-graph nodes. This is the single definition of "what
    /// counts as a button" shared by both the build pipeline
    /// (`AuthorableMenuRef::buttons`) and validation, so they can't disagree.
    ///
    /// Scans only top-level `scene.nodes` `Button` variants — recursive
    /// `Group` flattening is deferred to a later PR.
    pub fn buttons(&self) -> Vec<MenuButtonView<'_>> {
        self.scene
            .nodes
            .iter()
            .filter_map(|node| {
                if let SceneNode::Button {
                    id,
                    label,
                    x,
                    y,
                    width,
                    height,
                    video_asset_id,
                    ..
                } = node
                {
                    let interaction = self.interaction.nodes.iter().find(|f| f.node_id == *id);
                    Some(MenuButtonView {
                        id,
                        label,
                        x: *x,
                        y: *y,
                        width: *width,
                        height: *height,
                        video_asset_id: video_asset_id.as_deref(),
                        action: interaction.and_then(|f| f.action.as_ref()),
                        nav_up: interaction.and_then(|f| f.nav_up.as_deref()),
                        nav_down: interaction.and_then(|f| f.nav_down.as_deref()),
                        nav_left: interaction.and_then(|f| f.nav_left.as_deref()),
                        nav_right: interaction.and_then(|f| f.nav_right.as_deref()),
                    })
                } else {
                    None
                }
            })
            .collect()
    }

    /// Infer this menu's [`MenuRole`] from generation metadata, then
    /// interaction content, then its VMGM entry-menu position — the
    /// precedence documented in `docs/rich-menu-editor-plan.md` §2 decision
    /// 3. Used both to backfill existing projects on load
    /// (`SpindleProjectFile::migrate_all_menus`) and by anything that wants
    /// a role default for a newly created menu before the user picks one.
    ///
    /// `is_entry_vmgm_menu` should be `true` only for the disc's first
    /// global (VMGM) menu — the conventional "VMGM menu 1" a player reaches
    /// via the title-menu key (`build/dvd_navigation.rs` numbers
    /// `global_menus` 1-based in that same order).
    pub fn infer_role(&self, domain: MenuDomain, is_entry_vmgm_menu: bool) -> MenuRole {
        if let Some(role) = self
            .generation_meta
            .as_ref()
            .and_then(|meta| meta.generator_kind.as_deref())
            .and_then(role_for_generator_kind)
        {
            return role;
        }

        if let Some(role) = self.infer_role_from_interaction_content() {
            return role;
        }

        if domain == MenuDomain::Vmgm {
            return if is_entry_vmgm_menu {
                MenuRole::Root
            } else {
                MenuRole::TitleSelect
            };
        }

        MenuRole::TitleSelect
    }

    /// Step 2 of [`MenuDocument::infer_role`]: classify by what the menu's
    /// buttons actually do, recursively flattening `Sequence` actions the
    /// way the setup generators wrap their stream setter + optional
    /// `showMenu` return (`menuGenerators.ts`). The majority vote counts
    /// only the role-diagnostic action kinds (`PlayChapter` vs.
    /// `SetAudioStream`/`SetSubtitleStream`) against each other — navigation
    /// noise like the trailing `ShowMenu` return doesn't dilute the vote.
    /// That noise is exactly why this can't count *all* actions: every
    /// setup-generator button is a `[setter, showMenu]` pair, so a
    /// majority-of-everything threshold would tie 50/50 on every real setup
    /// menu and never fire. A menu-name hint is a weak tiebreaker when
    /// counts are equal, and `None` (defer to the next precedence step) when
    /// there's no chapter/setup signal at all.
    fn infer_role_from_interaction_content(&self) -> Option<MenuRole> {
        let mut chapter_count = 0usize;
        let mut setup_count = 0usize;

        for node in &self.interaction.nodes {
            let Some(action) = &node.action else {
                continue;
            };
            let mut flattened = Vec::new();
            flatten_actions(action, &mut flattened);
            for action in flattened {
                match action {
                    PlaybackAction::PlayChapter { .. } => chapter_count += 1,
                    PlaybackAction::SetAudioStream { .. }
                    | PlaybackAction::SetSubtitleStream { .. } => {
                        setup_count += 1;
                    }
                    _ => {}
                }
            }
        }

        if chapter_count > setup_count {
            return Some(MenuRole::Chapter);
        }
        if setup_count > chapter_count {
            return Some(MenuRole::Setup);
        }

        // Tied (including 0-0): let the menu name break it.
        if chapter_count > 0 || setup_count > 0 {
            let name = self.name.to_ascii_lowercase();
            if name.contains("chapter") {
                return Some(MenuRole::Chapter);
            }
            if name.contains("audio") || name.contains("subtitle") {
                return Some(MenuRole::Setup);
            }
        }

        None
    }
}

/// Recursive worker for [`MenuDocument::lift_highlight_keyframes`]: lift one
/// animated button's `highlight_keyframes` into an `AnimationTrack` (plus a
/// second `HighlightOpacity` track when any keyframe overrides opacity),
/// appending to `lifted` and clearing the source array. Descends into
/// `Group` children the same way scene traversal does elsewhere in this
/// module (see `validate_motion_keyframes_in_node` in `validation::scene`).
fn lift_highlight_keyframes_in_node(
    node: &mut SceneNode,
    defaults: &MenuHighlightColours,
    lifted: &mut Vec<AnimationTrack>,
) {
    match node {
        SceneNode::Button {
            id,
            highlight_mode: HighlightMode::Animated,
            highlight_keyframes,
            ..
        } if !highlight_keyframes.is_empty() => {
            let colour_keyframes: Vec<Keyframe> = highlight_keyframes
                .iter()
                .map(|kf| Keyframe {
                    timestamp_secs: kf.timestamp_secs,
                    value: KeyValue::Colour {
                        hex: kf
                            .select_colour
                            .clone()
                            .unwrap_or_else(|| defaults.select_colour.clone()),
                    },
                    easing: Easing::Hold,
                })
                .collect();
            lifted.push(AnimationTrack {
                node_id: id.clone(),
                target: AnimatableProperty::HighlightColour,
                keyframes: colour_keyframes,
            });

            if highlight_keyframes
                .iter()
                .any(|kf| kf.select_opacity.is_some())
            {
                let opacity_keyframes: Vec<Keyframe> = highlight_keyframes
                    .iter()
                    .map(|kf| Keyframe {
                        timestamp_secs: kf.timestamp_secs,
                        value: KeyValue::Scalar {
                            value: kf.select_opacity.unwrap_or(defaults.select_opacity),
                        },
                        easing: Easing::Hold,
                    })
                    .collect();
                lifted.push(AnimationTrack {
                    node_id: id.clone(),
                    target: AnimatableProperty::HighlightOpacity,
                    keyframes: opacity_keyframes,
                });
            }

            highlight_keyframes.clear();
        }
        SceneNode::Group { children, .. } => {
            for child in children {
                lift_highlight_keyframes_in_node(child, defaults, lifted);
            }
        }
        _ => {}
    }
}

/// Recursively flatten `Sequence` actions into their leaf actions — the
/// setup generators wrap `SetAudioStream`/`SetSubtitleStream` in a
/// `sequence` with an optional trailing `showMenu` return
/// (`menuGenerators.ts`), so a naive top-level scan would undercount them.
fn flatten_actions<'a>(action: &'a PlaybackAction, out: &mut Vec<&'a PlaybackAction>) {
    match action {
        PlaybackAction::Sequence { actions } => {
            for inner in actions {
                flatten_actions(inner, out);
            }
        }
        other => out.push(other),
    }
}

/// Step 1 of [`MenuDocument::infer_role`]: map a generator's kind to the
/// role it's known to build. `None` for kinds this function doesn't
/// recognise, so callers fall through to the next precedence step.
fn role_for_generator_kind(kind: &str) -> Option<MenuRole> {
    match kind {
        "chapter-grid" => Some(MenuRole::Chapter),
        "audio-setup" | "subtitle-setup" => Some(MenuRole::Setup),
        _ => None,
    }
}

/// A top-level scene button joined with its interaction-graph node. See
/// [`MenuDocument::buttons`].
pub struct MenuButtonView<'a> {
    pub id: &'a str,
    pub label: &'a str,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub video_asset_id: Option<&'a str>,
    pub action: Option<&'a PlaybackAction>,
    pub nav_up: Option<&'a str>,
    pub nav_down: Option<&'a str>,
    pub nav_left: Option<&'a str>,
    pub nav_right: Option<&'a str>,
}

/// Menu domain indicates whether it belongs to the Video Manager (VMGM) or a Titleset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MenuDomain {
    Vmgm,
    Titleset,
}

/// What the user means this menu to be. Backends map role → physical
/// placement (DVD: [`MenuDomain`]; BD: Top Menu / popup IG); the terminology
/// layer maps role → on-screen wording. `MenuDocument.role` is authoritative;
/// `domain` stays the DVD backend's placement output (see
/// `docs/rich-menu-editor-plan.md` §2 decision 3).
///
/// `TitleSelect` is the closed-set fallback at step 4 of
/// [`MenuDocument::infer_role`], and is a perfectly ordinary authored value
/// otherwise — [`MenuDocument::role`] uses `Option<MenuRole>` (`None` for
/// "absent from the JSON") rather than treating `TitleSelect` itself as an
/// absence sentinel, so a role explicitly persisted as `TitleSelect`
/// survives reload instead of being silently re-inferred.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum MenuRole {
    /// DVD: VMGM title menu · BD: Top Menu.
    Root,
    /// DVD: VMGM or VTSM · BD: Top Menu page.
    #[default]
    TitleSelect,
    /// DVD: VTSM (per group) · BD: playlist menu page.
    Chapter,
    /// DVD: VTSM · BD: Top Menu page.
    Setup,
    /// DVD: VTSM · BD: Top Menu page.
    Extras,
    /// DVD: unsupported (validation error) · BD: popup IG.
    Popup,
}

impl MenuRole {
    /// Default DVD-backend [`MenuDomain`] for a newly created or generated
    /// menu of this role — used only as a placement default and for
    /// grouping/badging menus by role (e.g. the menu map and generate-menus
    /// rail). This is never used to move an *existing* menu between domains
    /// on load — `SpindleProjectFile::migrate_all_menus` infers `role` from
    /// `domain` (via [`MenuDocument::infer_role`]), not the other way round.
    ///
    /// `Popup` has no supported DVD placement (see the variant's doc
    /// comment); it defaults to `Vmgm` here purely so the function stays
    /// total — validation is what actually flags a DVD project authoring a
    /// popup menu, once the role picker allows choosing it at all (today no
    /// [`crate::models::FormatProfile::supported_roles`] includes `Popup`).
    pub fn default_domain(self) -> MenuDomain {
        match self {
            MenuRole::Root | MenuRole::TitleSelect | MenuRole::Popup => MenuDomain::Vmgm,
            MenuRole::Chapter | MenuRole::Setup | MenuRole::Extras => MenuDomain::Titleset,
        }
    }
}

/// The visual scene graph for the menu.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuScene {
    pub design_size: MenuSize,
    pub background: SceneBackground,
    pub nodes: Vec<SceneNode>,
    pub guides: Vec<SceneGuide>,
}

/// Design-space canvas size for a menu, expressed in square-pixel display-aspect coordinates.
///
/// The Skia renderer scales these dimensions to the raster target at build time:
/// `scale_x = raster_width / width`, `scale_y = raster_height / height`.
/// All scene node coordinates are stored in this space and are only rounded to integers
/// at render time.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuSize {
    pub width: f64,
    pub height: f64,
    /// Display aspect for this design canvas. Defaults to `SixteenByNine` for
    /// compatibility with project files written before this field existed.
    #[serde(default)]
    pub aspect: AspectMode,
}

impl Default for MenuSize {
    fn default() -> Self {
        Self::default_for(DiscFamily::DvdVideo, AspectMode::SixteenByNine)
    }
}

impl MenuSize {
    /// Default design-space canvas dimensions for a given disc family and aspect mode.
    pub fn default_for(family: DiscFamily, aspect: AspectMode) -> Self {
        let (width, height) = match (family, aspect) {
            (DiscFamily::DvdVideo, AspectMode::FourByThree) => (1024.0, 768.0),
            (DiscFamily::DvdVideo, AspectMode::SixteenByNine) => (1024.0, 576.0),
            (DiscFamily::BluRay, _) => (1920.0, 1080.0),
            (DiscFamily::Svcd, _) => (800.0, 600.0),
            (DiscFamily::Vcd, _) => (704.0, 528.0),
        };
        Self {
            width,
            height,
            aspect,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneBackground {
    pub asset_id: Option<String>,
    pub colour: Option<String>,
}

/// A node within the authored menu scene graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
#[allow(clippy::large_enum_variant)]
pub enum SceneNode {
    Group {
        id: String,
        name: String,
        children: Vec<SceneNode>,
    },
    Text {
        id: String,
        content: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        #[serde(default, rename = "fontSize", alias = "font_size")]
        font_size: Option<f64>,
        #[serde(default, rename = "fontFamily", alias = "font_family")]
        font_family: Option<String>,
        #[serde(default, rename = "fontWeight", alias = "font_weight")]
        font_weight: Option<FontWeight>,
        #[serde(default, rename = "fontItalic", alias = "font_italic")]
        font_italic: Option<bool>,
        #[serde(default, rename = "textDecoration", alias = "text_decoration")]
        text_decoration: Option<TextDecoration>,
        #[serde(default, rename = "textAlign", alias = "text_align")]
        text_align: Option<TextAlign>,
        #[serde(default)]
        colour: Option<String>,
        #[serde(default, rename = "lineHeight", alias = "line_height")]
        line_height: Option<f64>,
        #[serde(default, rename = "letterSpacing", alias = "letter_spacing")]
        letter_spacing: Option<f64>,
    },
    Image {
        id: String,
        #[serde(rename = "assetId", alias = "asset_id")]
        asset_id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    Shape {
        id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        #[serde(default)]
        fill: Option<String>,
    },
    Video {
        id: String,
        #[serde(rename = "assetId", alias = "asset_id")]
        asset_id: String,
        x: f64,
        y: f64,
    },
    Button {
        id: String,
        label: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        #[serde(default, rename = "highlightMode", alias = "highlight_mode")]
        highlight_mode: HighlightMode,
        /// Legacy Stage-2 animated-highlight keyframes, superseded by
        /// [`MenuDocument::animation`]. Deserialise-compat only — lifted (and
        /// cleared) by [`MenuDocument::lift_highlight_keyframes`] on load, so
        /// this is always empty and omitted from output once a document has
        /// been through migration.
        #[serde(
            default,
            rename = "highlightKeyframes",
            alias = "highlight_keyframes",
            skip_serializing_if = "Vec::is_empty"
        )]
        highlight_keyframes: Vec<HighlightKeyframe>,
        #[serde(default, rename = "videoAssetId", alias = "video_asset_id")]
        video_asset_id: Option<String>,
        #[serde(default, rename = "buttonStyle", alias = "button_style")]
        button_style: Option<ButtonStyleMap>,
        #[serde(default, rename = "labelStyle", alias = "label_style")]
        label_style: Option<TextStyle>,
    },
    ComponentInstance {
        id: String,
        #[serde(rename = "componentId", alias = "component_id")]
        component_id: String,
    },
    GeneratedCollection {
        id: String,
        source: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneGuide {
    pub orientation: GuideOrientation,
    pub position: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GuideOrientation {
    Horizontal,
    Vertical,
}

/// The interaction graph defining remote-driven behaviour.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuInteractionGraph {
    pub default_focus_id: Option<String>,
    pub nodes: Vec<FocusNode>,
    pub timeout_action: Option<PlaybackAction>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusNode {
    pub node_id: String,
    pub nav_up: Option<String>,
    pub nav_down: Option<String>,
    pub nav_left: Option<String>,
    pub nav_right: Option<String>,
    pub action: Option<PlaybackAction>,
}

/// Timing and motion rules for the menu.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuTiming {
    #[serde(default)]
    pub intro_start_secs: f64,
    pub intro_duration_secs: f64,
    #[serde(default)]
    pub loop_start_secs: f64,
    pub loop_duration_secs: f64,
    pub loop_count: u32, // 0 = infinite
    /// Optional audio asset for motion menu background music. The document
    /// home for what was the legacy `motionAudioAssetId` field.
    #[serde(default)]
    pub audio_asset_id: Option<String>,
}

impl Default for MenuTiming {
    fn default() -> Self {
        Self {
            intro_start_secs: 0.0,
            intro_duration_secs: 0.0,
            loop_start_secs: 0.0,
            loop_duration_secs: 0.0,
            loop_count: 0,
            audio_asset_id: None,
        }
    }
}

/// Metadata for generated menus.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuGenerationMeta {
    pub generator_id: String,
    pub last_generated_at: String,
    /// Which generator produced this menu, e.g. `"chapter-grid"`,
    /// `"audio-setup"`, `"subtitle-setup"`. Unlike `generator_id` (which
    /// today is uniformly `"menu-workspace"` for every generator —
    /// `apps/spindle/src/components/menus/menuGenerators.ts`), this is
    /// specific enough to drive [`MenuDocument::infer_role`]'s first
    /// precedence step. `None` for menus generated before this field
    /// existed, or authored by hand.
    #[serde(default)]
    pub generator_kind: Option<String>,
}

/// Format-specific compilation rules and safe-area policies.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuCompilePolicy {
    pub display_aspect: Option<AspectMode>,
    pub safe_area_mode: SafeAreaMode,
    pub palette_strategy: PaletteStrategy,
}

impl Default for MenuCompilePolicy {
    fn default() -> Self {
        Self {
            display_aspect: None,
            safe_area_mode: SafeAreaMode::ActionSafe,
            palette_strategy: PaletteStrategy::Auto,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SafeAreaMode {
    ActionSafe,
    TitleSafe,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PaletteStrategy {
    Auto,
    Manual,
}

/// Whether a menu background is a still frame or looping video.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum BackgroundMode {
    #[default]
    Still,
    Motion,
}

/// DVD subpicture highlight palette colours.
///
/// DVD menus use a 4-colour CLUT (colour look-up table) for button overlays.
/// The "select" colour is shown when a button is navigated to; the "activate"
/// colour flashes briefly when the button is pressed. Colours are stored as
/// CSS-style hex strings (e.g. "#ffaa40").
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuHighlightColours {
    /// Colour shown over a button when it is selected/focused.
    pub select_colour: String,
    /// Opacity of the select highlight (0.0–1.0).
    pub select_opacity: f64,
    /// Colour shown briefly when a button is activated/pressed.
    pub activate_colour: String,
    /// Opacity of the activate highlight (0.0–1.0).
    pub activate_opacity: f64,
}

impl Default for MenuHighlightColours {
    fn default() -> Self {
        Self {
            select_colour: "#ffaa40".to_string(),
            select_opacity: 0.6,
            activate_colour: "#ffffff".to_string(),
            activate_opacity: 0.8,
        }
    }
}

/// A navigable button within a menu.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuButton {
    pub id: String,
    pub label: String,
    pub bounds: ButtonBounds,
    pub action: Option<PlaybackAction>,
    pub nav_up: Option<String>,
    pub nav_down: Option<String>,
    pub nav_left: Option<String>,
    pub nav_right: Option<String>,
    /// Whether button highlights are static or animated (Stage 2).
    #[serde(default)]
    pub highlight_mode: HighlightMode,
    /// Animated highlight keyframes (Stage 2).
    #[serde(default)]
    pub highlight_keyframes: Vec<HighlightKeyframe>,
    /// Video asset composited into the menu background at this button's bounds (Stage 2).
    #[serde(default)]
    pub video_asset_id: Option<String>,
}

impl Default for MenuButton {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            label: "Untitled Button".to_string(),
            bounds: ButtonBounds {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 50.0,
            },
            action: None,
            nav_up: None,
            nav_down: None,
            nav_left: None,
            nav_right: None,
            highlight_mode: HighlightMode::Static,
            highlight_keyframes: Vec::new(),
            video_asset_id: None,
        }
    }
}

/// Whether button highlights are static or animated over the motion loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum HighlightMode {
    #[default]
    Static,
    Animated,
}

/// Legal shadow types for authored button styling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ButtonShadowType {
    #[default]
    None,
    BoxShadow,
    OuterGlow,
    InnerGlow,
}

/// Per-state visual appearance for a button node (authored layer only).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonStateStyle {
    pub bg_fill: String,
    pub border_colour: String,
    pub border_width: f64,
    pub border_radius: f64,
    pub padding_h: f64,
    pub padding_v: f64,
    pub shadow_type: ButtonShadowType,
    pub shadow_colour: String,
    pub shadow_blur: f64,
    pub shadow_spread: f64,
}

impl Default for ButtonStateStyle {
    fn default() -> Self {
        Self {
            bg_fill: "rgba(255, 255, 255, 0.04)".to_string(),
            border_colour: "rgba(255, 255, 255, 0.12)".to_string(),
            border_width: 1.5,
            border_radius: 6.0,
            padding_h: 16.0,
            padding_v: 0.0,
            shadow_type: ButtonShadowType::None,
            shadow_colour: "transparent".to_string(),
            shadow_blur: 0.0,
            shadow_spread: 0.0,
        }
    }
}

/// The three interactive states for a button.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonStyleMap {
    pub normal: ButtonStateStyle,
    pub focus: ButtonStateStyle,
    pub activate: ButtonStateStyle,
}

/// Typography style shared by button labels and standalone text nodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    pub font_family: String,
    pub font_size: f64,
    pub font_weight: FontWeight,
    pub font_italic: bool,
    pub text_decoration: TextDecoration,
    pub text_align: TextAlign,
    pub colour: String,
    pub line_height: f64,
    pub letter_spacing: f64,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            font_family: "Inter".to_string(),
            font_size: 14.0,
            font_weight: FontWeight::Normal,
            font_italic: false,
            text_decoration: TextDecoration::None,
            text_align: TextAlign::Left,
            colour: "#ffffff".to_string(),
            line_height: 1.4,
            letter_spacing: 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum FontWeight {
    #[default]
    Normal,
    Bold,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TextDecoration {
    #[default]
    None,
    Underline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
}

/// A keyframe for animated button highlights within a motion menu loop.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightKeyframe {
    /// Timestamp within the motion loop (seconds from start).
    pub timestamp_secs: f64,
    /// Override select colour at this keyframe (None = use menu default).
    pub select_colour: Option<String>,
    /// Override select opacity at this keyframe (None = use menu default).
    pub select_opacity: Option<f64>,
    /// Override activate colour at this keyframe (None = use menu default).
    pub activate_colour: Option<String>,
    /// Override activate opacity at this keyframe (None = use menu default).
    pub activate_opacity: Option<f64>,
}

/// Button position and size in menu coordinates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[cfg(test)]
mod lift_tests {
    use super::*;

    fn document_with_animated_button(keyframes: Vec<HighlightKeyframe>) -> MenuDocument {
        MenuDocument {
            animation: vec![],
            id: "menu-1".to_string(),
            name: "Menu".to_string(),
            domain: MenuDomain::Vmgm,
            role: MenuRole::TitleSelect,
            scene: MenuScene {
                design_size: MenuSize::default(),
                background: SceneBackground {
                    asset_id: None,
                    colour: None,
                },
                nodes: vec![SceneNode::Button {
                    id: "btn-1".to_string(),
                    label: "Play".to_string(),
                    x: 0.0,
                    y: 0.0,
                    width: 100.0,
                    height: 50.0,
                    highlight_mode: HighlightMode::Animated,
                    highlight_keyframes: keyframes,
                    video_asset_id: None,
                    button_style: None,
                    label_style: None,
                }],
                guides: vec![],
            },
            interaction: MenuInteractionGraph {
                default_focus_id: None,
                nodes: vec![],
                timeout_action: None,
            },
            timing: MenuTiming::default(),
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::Motion,
            theme_ref: None,
            generation_meta: None,
            compile_policy: MenuCompilePolicy::default(),
        }
    }

    #[test]
    fn lifts_colour_keyframes_into_a_highlight_colour_track() {
        let mut doc = document_with_animated_button(vec![
            HighlightKeyframe {
                timestamp_secs: 0.0,
                select_colour: Some("#ff0000".to_string()),
                select_opacity: None,
                activate_colour: None,
                activate_opacity: None,
            },
            HighlightKeyframe {
                timestamp_secs: 1.0,
                select_colour: Some("#00ff00".to_string()),
                select_opacity: None,
                activate_colour: None,
                activate_opacity: None,
            },
        ]);

        doc.lift_highlight_keyframes();

        assert_eq!(doc.animation.len(), 1);
        let track = &doc.animation[0];
        assert_eq!(track.node_id, "btn-1");
        assert_eq!(track.target, AnimatableProperty::HighlightColour);
        assert_eq!(track.keyframes.len(), 2);
        assert_eq!(
            track.keyframes[0].value,
            KeyValue::Colour {
                hex: "#ff0000".to_string()
            }
        );
        assert_eq!(track.keyframes[0].easing, Easing::Hold);
        assert_eq!(
            track.keyframes[1].value,
            KeyValue::Colour {
                hex: "#00ff00".to_string()
            }
        );
    }

    #[test]
    fn missing_per_keyframe_colour_falls_back_to_menu_default() {
        let mut doc = document_with_animated_button(vec![HighlightKeyframe {
            timestamp_secs: 0.0,
            select_colour: None,
            select_opacity: None,
            activate_colour: None,
            activate_opacity: None,
        }]);
        let default_colour = doc.highlight_colours.select_colour.clone();

        doc.lift_highlight_keyframes();

        assert_eq!(
            doc.animation[0].keyframes[0].value,
            KeyValue::Colour {
                hex: default_colour
            }
        );
    }

    #[test]
    fn adds_a_second_opacity_track_only_when_a_keyframe_overrides_opacity() {
        let mut doc = document_with_animated_button(vec![HighlightKeyframe {
            timestamp_secs: 0.0,
            select_colour: Some("#ff0000".to_string()),
            select_opacity: Some(0.25),
            activate_colour: None,
            activate_opacity: None,
        }]);

        doc.lift_highlight_keyframes();

        assert_eq!(doc.animation.len(), 2);
        assert_eq!(doc.animation[0].target, AnimatableProperty::HighlightColour);
        assert_eq!(doc.animation[1].target, AnimatableProperty::HighlightOpacity);
        assert_eq!(
            doc.animation[1].keyframes[0].value,
            KeyValue::Scalar { value: 0.25 }
        );
    }

    #[test]
    fn clears_the_legacy_arrays_after_lifting() {
        let mut doc = document_with_animated_button(vec![HighlightKeyframe {
            timestamp_secs: 0.0,
            select_colour: Some("#ff0000".to_string()),
            select_opacity: None,
            activate_colour: None,
            activate_opacity: None,
        }]);

        doc.lift_highlight_keyframes();

        let SceneNode::Button {
            highlight_keyframes,
            ..
        } = &doc.scene.nodes[0]
        else {
            panic!("expected a button node");
        };
        assert!(highlight_keyframes.is_empty());
    }

    #[test]
    fn is_idempotent() {
        let mut doc = document_with_animated_button(vec![HighlightKeyframe {
            timestamp_secs: 0.0,
            select_colour: Some("#ff0000".to_string()),
            select_opacity: None,
            activate_colour: None,
            activate_opacity: None,
        }]);

        doc.lift_highlight_keyframes();
        let first_pass = doc.animation.clone();
        doc.lift_highlight_keyframes();

        assert_eq!(doc.animation, first_pass);
    }

    #[test]
    fn a_document_with_no_animated_buttons_is_a_no_op() {
        let mut doc = document_with_animated_button(vec![]);
        doc.scene.nodes[0] = SceneNode::Button {
            id: "btn-1".to_string(),
            label: "Play".to_string(),
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 50.0,
            highlight_mode: HighlightMode::Static,
            highlight_keyframes: vec![],
            video_asset_id: None,
            button_style: None,
            label_style: None,
        };

        doc.lift_highlight_keyframes();

        assert!(doc.animation.is_empty());
    }

    #[test]
    fn serialisation_round_trip_omits_the_now_empty_legacy_array() {
        let mut doc = document_with_animated_button(vec![HighlightKeyframe {
            timestamp_secs: 0.0,
            select_colour: Some("#ff0000".to_string()),
            select_opacity: None,
            activate_colour: None,
            activate_opacity: None,
        }]);
        doc.lift_highlight_keyframes();

        let json = serde_json::to_string(&doc).unwrap();
        assert!(
            !json.contains("highlightKeyframes"),
            "expected the emptied legacy array to be omitted from output, got: {json}"
        );

        let round_tripped: MenuDocument = serde_json::from_str(&json).unwrap();
        assert_eq!(round_tripped.animation, doc.animation);
    }
}

#[cfg(test)]
mod role_tests {
    use super::*;

    /// A minimal, otherwise-empty `MenuDocument` — tests override just the
    /// fields (`generation_meta`, `interaction.nodes`, `name`) that drive
    /// `infer_role`.
    fn empty_document(name: &str) -> MenuDocument {
        MenuDocument {
            animation: vec![],
            id: "menu-1".to_string(),
            name: name.to_string(),
            domain: MenuDomain::Titleset,
            role: Some(MenuRole::TitleSelect),
            scene: MenuScene {
                design_size: MenuSize::default(),
                background: SceneBackground {
                    asset_id: None,
                    colour: None,
                },
                nodes: vec![],
                guides: vec![],
            },
            interaction: MenuInteractionGraph {
                default_focus_id: None,
                nodes: vec![],
                timeout_action: None,
            },
            timing: MenuTiming::default(),
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::Still,
            theme_ref: None,
            generation_meta: None,
            compile_policy: MenuCompilePolicy::default(),
        }
    }

    fn focus_node_with_action(id: &str, action: PlaybackAction) -> FocusNode {
        FocusNode {
            node_id: id.to_string(),
            nav_up: None,
            nav_down: None,
            nav_left: None,
            nav_right: None,
            action: Some(action),
        }
    }

    // ── Step 1: generation metadata ──────────────────────────────────────

    #[test]
    fn chapter_grid_generator_kind_infers_chapter_role() {
        let mut doc = empty_document("Chapter Select");
        doc.generation_meta = Some(MenuGenerationMeta {
            generator_id: "menu-workspace".to_string(),
            last_generated_at: "2026-01-01T00:00:00Z".to_string(),
            generator_kind: Some("chapter-grid".to_string()),
        });
        // Content disagrees with the metadata on purpose — metadata wins.
        doc.interaction.nodes = vec![focus_node_with_action(
            "btn-1",
            PlaybackAction::SetAudioStream { stream_index: 0 },
        )];

        assert_eq!(
            doc.infer_role(MenuDomain::Titleset, false),
            MenuRole::Chapter
        );
    }

    #[test]
    fn audio_setup_generator_kind_infers_setup_role() {
        let mut doc = empty_document("Audio Setup");
        doc.generation_meta = Some(MenuGenerationMeta {
            generator_id: "menu-workspace".to_string(),
            last_generated_at: "2026-01-01T00:00:00Z".to_string(),
            generator_kind: Some("audio-setup".to_string()),
        });

        assert_eq!(doc.infer_role(MenuDomain::Titleset, false), MenuRole::Setup);
    }

    #[test]
    fn subtitle_setup_generator_kind_infers_setup_role() {
        let mut doc = empty_document("Subtitle Setup");
        doc.generation_meta = Some(MenuGenerationMeta {
            generator_id: "menu-workspace".to_string(),
            last_generated_at: "2026-01-01T00:00:00Z".to_string(),
            generator_kind: Some("subtitle-setup".to_string()),
        });

        assert_eq!(doc.infer_role(MenuDomain::Titleset, false), MenuRole::Setup);
    }

    #[test]
    fn unrecognised_generator_kind_falls_through_to_content_detection() {
        let mut doc = empty_document("Bonus Features");
        doc.generation_meta = Some(MenuGenerationMeta {
            generator_id: "menu-workspace".to_string(),
            last_generated_at: "2026-01-01T00:00:00Z".to_string(),
            generator_kind: Some("some-future-generator".to_string()),
        });
        doc.interaction.nodes = vec![
            focus_node_with_action(
                "btn-1",
                PlaybackAction::PlayChapter {
                    title_id: "title-1".to_string(),
                    chapter_id: "chapter-1".to_string(),
                },
            ),
            focus_node_with_action(
                "btn-2",
                PlaybackAction::PlayChapter {
                    title_id: "title-1".to_string(),
                    chapter_id: "chapter-2".to_string(),
                },
            ),
        ];

        assert_eq!(
            doc.infer_role(MenuDomain::Titleset, false),
            MenuRole::Chapter
        );
    }

    // ── Step 2: interaction-content detection ────────────────────────────

    #[test]
    fn majority_play_chapter_actions_infer_chapter_role() {
        let mut doc = empty_document("Untitled Menu");
        doc.interaction.nodes = vec![
            focus_node_with_action(
                "btn-1",
                PlaybackAction::PlayChapter {
                    title_id: "title-1".to_string(),
                    chapter_id: "chapter-1".to_string(),
                },
            ),
            focus_node_with_action(
                "btn-2",
                PlaybackAction::PlayChapter {
                    title_id: "title-1".to_string(),
                    chapter_id: "chapter-2".to_string(),
                },
            ),
            focus_node_with_action(
                "btn-3",
                PlaybackAction::ShowMenu {
                    menu_id: "root".to_string(),
                },
            ),
        ];

        assert_eq!(
            doc.infer_role(MenuDomain::Titleset, false),
            MenuRole::Chapter
        );
    }

    #[test]
    fn setup_detection_flattens_nested_sequence_actions() {
        // The setup generators wrap `SetAudioStream`/`SetSubtitleStream` in a
        // `Sequence` with a trailing `ShowMenu` return
        // (`menuGenerators.ts::buildAudioSetupMenu`/`buildSubtitleSetupMenu`).
        // A naive top-level scan would see only `Sequence` nodes and never
        // find the setter underneath — this pins the recursive flatten.
        let mut doc = empty_document("Untitled Menu");
        doc.interaction.nodes = vec![
            focus_node_with_action(
                "btn-1",
                PlaybackAction::Sequence {
                    actions: vec![
                        PlaybackAction::SetAudioStream { stream_index: 0 },
                        PlaybackAction::ShowMenu {
                            menu_id: "root".to_string(),
                        },
                    ],
                },
            ),
            focus_node_with_action(
                "btn-2",
                PlaybackAction::Sequence {
                    actions: vec![
                        PlaybackAction::SetAudioStream { stream_index: 1 },
                        PlaybackAction::ShowMenu {
                            menu_id: "root".to_string(),
                        },
                    ],
                },
            ),
        ];

        assert_eq!(doc.infer_role(MenuDomain::Titleset, false), MenuRole::Setup);
    }

    #[test]
    fn setup_detection_flattens_nested_subtitle_sequence_actions() {
        let mut doc = empty_document("Untitled Menu");
        doc.interaction.nodes = vec![focus_node_with_action(
            "btn-1",
            PlaybackAction::Sequence {
                actions: vec![
                    PlaybackAction::SetSubtitleStream { stream_index: None },
                    PlaybackAction::ShowMenu {
                        menu_id: "root".to_string(),
                    },
                ],
            },
        )];

        assert_eq!(doc.infer_role(MenuDomain::Titleset, false), MenuRole::Setup);
    }

    #[test]
    fn setup_detection_wins_on_realistic_generator_shape_regardless_of_name() {
        // Mirrors `buildAudioSetupMenu`'s actual output shape
        // (`menuGenerators.ts`): each stream-setter button is wrapped in a
        // `Sequence` with a trailing `ShowMenu` return, plus a separate,
        // pure-`ShowMenu` "Back" button carrying no setup signal at all. A
        // per-*action* majority vote ties 50/50 here (N setters vs. N+1
        // `ShowMenu`s) and would never fire; per-*button* classification
        // does not, because the `ShowMenu`-only Back button doesn't count
        // toward either side. The name is deliberately unrelated (not even
        // English) so this can't be passing by way of the weak tiebreaker.
        let mut doc = empty_document("Página 3");
        doc.interaction.nodes = vec![
            focus_node_with_action(
                "btn-1",
                PlaybackAction::Sequence {
                    actions: vec![
                        PlaybackAction::SetAudioStream { stream_index: 0 },
                        PlaybackAction::ShowMenu {
                            menu_id: "root".to_string(),
                        },
                    ],
                },
            ),
            focus_node_with_action(
                "btn-2",
                PlaybackAction::Sequence {
                    actions: vec![
                        PlaybackAction::SetAudioStream { stream_index: 1 },
                        PlaybackAction::ShowMenu {
                            menu_id: "root".to_string(),
                        },
                    ],
                },
            ),
            focus_node_with_action(
                "btn-3",
                PlaybackAction::Sequence {
                    actions: vec![
                        PlaybackAction::SetAudioStream { stream_index: 2 },
                        PlaybackAction::ShowMenu {
                            menu_id: "root".to_string(),
                        },
                    ],
                },
            ),
            focus_node_with_action(
                "btn-back",
                PlaybackAction::ShowMenu {
                    menu_id: "root".to_string(),
                },
            ),
        ];

        assert_eq!(doc.infer_role(MenuDomain::Titleset, false), MenuRole::Setup);
    }

    #[test]
    fn chapter_detection_wins_on_realistic_generator_shape_with_renamed_menu() {
        // Mirrors `buildChapterMenusForTitleset`'s output shape: grid
        // buttons carry a bare `PlayChapter`, plus Previous/Back/Next
        // utility buttons carrying only `ShowMenu`. Renamed away from
        // anything containing "chapter" to prove this isn't relying on the
        // name tiebreaker either.
        let mut doc = empty_document("第3页");
        doc.interaction.nodes = vec![
            focus_node_with_action(
                "btn-1",
                PlaybackAction::PlayChapter {
                    title_id: "title-1".to_string(),
                    chapter_id: "chapter-1".to_string(),
                },
            ),
            focus_node_with_action(
                "btn-2",
                PlaybackAction::PlayChapter {
                    title_id: "title-1".to_string(),
                    chapter_id: "chapter-2".to_string(),
                },
            ),
            focus_node_with_action(
                "btn-back",
                PlaybackAction::ShowMenu {
                    menu_id: "root".to_string(),
                },
            ),
        ];

        assert_eq!(
            doc.infer_role(MenuDomain::Titleset, false),
            MenuRole::Chapter
        );
    }

    #[test]
    fn tied_content_uses_menu_name_as_weak_tiebreaker() {
        let mut doc = empty_document("Chapter Options");
        // One chapter signal, one setup signal — an exact tie, so the name
        // ("Chapter") breaks it.
        doc.interaction.nodes = vec![
            focus_node_with_action(
                "btn-1",
                PlaybackAction::PlayChapter {
                    title_id: "title-1".to_string(),
                    chapter_id: "chapter-1".to_string(),
                },
            ),
            focus_node_with_action("btn-2", PlaybackAction::SetAudioStream { stream_index: 0 }),
        ];

        assert_eq!(
            doc.infer_role(MenuDomain::Titleset, false),
            MenuRole::Chapter
        );
    }

    // ── Step 3/4: VMGM entry-menu position and fallback ──────────────────

    #[test]
    fn entry_vmgm_menu_infers_root_role() {
        let doc = empty_document("Main Menu");

        assert_eq!(doc.infer_role(MenuDomain::Vmgm, true), MenuRole::Root);
    }

    #[test]
    fn non_entry_vmgm_menu_infers_title_select_role() {
        let doc = empty_document("Extras");

        assert_eq!(
            doc.infer_role(MenuDomain::Vmgm, false),
            MenuRole::TitleSelect
        );
    }

    #[test]
    fn titleset_menu_with_no_signal_falls_back_to_title_select() {
        let doc = empty_document("Untitled Menu");

        assert_eq!(
            doc.infer_role(MenuDomain::Titleset, false),
            MenuRole::TitleSelect
        );
    }

    // ── `MenuRole::default_domain` ────────────────────────────────────────

    #[test]
    fn default_domain_matches_the_role_model_table() {
        assert_eq!(MenuRole::Root.default_domain(), MenuDomain::Vmgm);
        assert_eq!(MenuRole::TitleSelect.default_domain(), MenuDomain::Vmgm);
        assert_eq!(MenuRole::Chapter.default_domain(), MenuDomain::Titleset);
        assert_eq!(MenuRole::Setup.default_domain(), MenuDomain::Titleset);
        assert_eq!(MenuRole::Extras.default_domain(), MenuDomain::Titleset);
    }

    // ── `Menu::backfill_role` sentinel handling ───────────────────────────

    #[test]
    fn backfill_role_infers_when_role_is_absent() {
        let mut menu = Menu::new("menu-1", "Chapter Select").with_document(MenuDocument {
            role: None,
            ..empty_document("Chapter Select")
        });

        menu.backfill_role(MenuDomain::Vmgm, /* is_entry_vmgm_menu */ true);

        assert_eq!(menu.doc().role, Some(MenuRole::Root));
    }

    #[test]
    fn backfill_role_preserves_an_explicitly_persisted_title_select() {
        // A menu whose generation metadata/content would infer `Root` (entry
        // VMGM menu), but whose document explicitly persists `TitleSelect` —
        // the user's deliberate choice must survive, not be overwritten by
        // inference the way the old `role == MenuRole::TitleSelect` sentinel
        // comparison would have done.
        let mut menu = Menu::new("menu-1", "Main Menu").with_document(MenuDocument {
            role: Some(MenuRole::TitleSelect),
            ..empty_document("Main Menu")
        });

        menu.backfill_role(MenuDomain::Vmgm, /* is_entry_vmgm_menu */ true);

        assert_eq!(menu.doc().role, Some(MenuRole::TitleSelect));
    }

    #[test]
    fn backfill_role_preserves_any_other_explicit_role_too() {
        let mut menu = Menu::new("menu-1", "Bonus Features").with_document(MenuDocument {
            role: Some(MenuRole::Extras),
            ..empty_document("Bonus Features")
        });

        menu.backfill_role(MenuDomain::Titleset, false);

        assert_eq!(menu.doc().role, Some(MenuRole::Extras));
    }
}
