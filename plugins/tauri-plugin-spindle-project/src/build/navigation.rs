// Menu navigation auto-generation from button geometry.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use crate::models::Menu;

pub fn auto_generate_navigation(menu: &mut Menu) {
    let doc = menu.doc_mut();
    // Use `MenuDocument::buttons()` — the single definition of "what counts
    // as a button" shared with the build pipeline and validation — rather
    // than re-deriving it from `scene.nodes` here. Once group flattening
    // lands, this keeps auto-nav from silently skipping grouped buttons.
    let buttons: Vec<(String, f64, f64)> = doc
        .buttons()
        .iter()
        .map(|b| (b.id.to_string(), b.x + b.width / 2.0, b.y + b.height / 2.0))
        .collect();

    let n = buttons.len();
    if n < 2 {
        if n == 1 && doc.interaction.default_focus_id.is_none() {
            doc.interaction.default_focus_id = Some(buttons[0].0.clone());
        }
        return;
    }

    let mut nav_results = Vec::new();

    for i in 0..n {
        let (id, cx, cy) = &buttons[i];
        let mut best_up: Option<(usize, f64)> = None;
        let mut best_down: Option<(usize, f64)> = None;
        let mut best_left: Option<(usize, f64)> = None;
        let mut best_right: Option<(usize, f64)> = None;

        for (j, (_, ox, oy)) in buttons.iter().enumerate() {
            if i == j {
                continue;
            }
            let dx = ox - cx;
            let dy = oy - cy;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < 1.0 {
                continue;
            }

            let cos_up = -dy / dist;
            let cos_down = dy / dist;
            let cos_left = -dx / dist;
            let cos_right = dx / dist;

            const MIN_COS: f64 = 0.35;

            if dy < 0.0 && cos_up > MIN_COS {
                let c2 = cos_up * cos_up;
                let score = dist / (c2 * c2 * c2);
                if best_up.is_none() || score < best_up.unwrap().1 {
                    best_up = Some((j, score));
                }
            }
            if dy > 0.0 && cos_down > MIN_COS {
                let c2 = cos_down * cos_down;
                let score = dist / (c2 * c2 * c2);
                if best_down.is_none() || score < best_down.unwrap().1 {
                    best_down = Some((j, score));
                }
            }
            if dx < 0.0 && cos_left > MIN_COS {
                let c2 = cos_left * cos_left;
                let score = dist / (c2 * c2 * c2);
                if best_left.is_none() || score < best_left.unwrap().1 {
                    best_left = Some((j, score));
                }
            }
            if dx > 0.0 && cos_right > MIN_COS {
                let c2 = cos_right * cos_right;
                let score = dist / (c2 * c2 * c2);
                if best_right.is_none() || score < best_right.unwrap().1 {
                    best_right = Some((j, score));
                }
            }
        }

        nav_results.push((
            id.clone(),
            best_up.map(|(j, _)| buttons[j].0.clone()),
            best_down.map(|(j, _)| buttons[j].0.clone()),
            best_left.map(|(j, _)| buttons[j].0.clone()),
            best_right.map(|(j, _)| buttons[j].0.clone()),
        ));
    }

    for (id, up, down, left, right) in nav_results {
        if let Some(node) = doc.interaction.nodes.iter_mut().find(|n| n.node_id == id) {
            node.nav_up = up;
            node.nav_down = down;
            node.nav_left = left;
            node.nav_right = right;
        } else {
            // If the interaction node is missing, create it
            doc.interaction.nodes.push(crate::models::FocusNode {
                node_id: id,
                nav_up: up,
                nav_down: down,
                nav_left: left,
                nav_right: right,
                action: None,
            });
        }
    }

    if doc.interaction.default_focus_id.is_none() && !buttons.is_empty() {
        doc.interaction.default_focus_id = Some(buttons[0].0.clone());
    }
}

#[cfg(test)]
mod tests {
    use crate::models::{
        AspectMode, BackgroundMode, FocusNode, Menu, MenuCompilePolicy, MenuDocument, MenuDomain,
        MenuHighlightColours, MenuInteractionGraph, MenuRole, MenuScene, MenuSize, SceneBackground,
        SceneNode,
    };

    use super::auto_generate_navigation;

    /// Build a menu whose authored document has one top-level `Button` scene
    /// node per `(id, label, x, y, width, height)` tuple, with an empty
    /// interaction graph (as `auto_generate_navigation` expects to build it).
    fn menu_with_buttons(
        id: &str,
        name: &str,
        buttons: &[(&str, &str, f64, f64, f64, f64)],
    ) -> Menu {
        let nodes = buttons
            .iter()
            .map(|(bid, label, x, y, width, height)| SceneNode::Button {
                id: (*bid).to_string(),
                label: (*label).to_string(),
                x: *x,
                y: *y,
                width: *width,
                height: *height,
                highlight_mode: Default::default(),
                highlight_keyframes: Vec::new(),
                video_asset_id: None,
                button_style: None,
                label_style: None,
            })
            .collect();

        Menu::new(id, name).with_document(MenuDocument {
            animation: vec![],
            id: id.to_string(),
            name: name.to_string(),
            domain: MenuDomain::Vmgm,
            role: Some(MenuRole::TitleSelect),
            scene: MenuScene {
                design_size: MenuSize {
                    width: 720.0,
                    height: 480.0,
                    aspect: AspectMode::SixteenByNine,
                },
                background: SceneBackground {
                    asset_id: None,
                    colour: None,
                },
                nodes,
                guides: Vec::new(),
            },
            interaction: MenuInteractionGraph {
                default_focus_id: None,
                nodes: Vec::new(),
                timeout_action: None,
            },
            timing: Default::default(),
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::default(),
            theme_ref: None,
            generation_meta: None,
            compile_policy: MenuCompilePolicy::default(),
        })
    }

    fn focus_node<'a>(menu: &'a Menu, button_id: &str) -> &'a FocusNode {
        menu.doc()
            .interaction
            .nodes
            .iter()
            .find(|n| n.node_id == button_id)
            .unwrap_or_else(|| panic!("expected a focus node for \"{button_id}\""))
    }

    #[test]
    fn auto_navigation_vertical_buttons() {
        let mut menu = menu_with_buttons(
            "m1",
            "Test",
            &[
                ("b1", "Top", 260.0, 100.0, 200.0, 40.0),
                ("b2", "Bottom", 260.0, 200.0, 200.0, 40.0),
            ],
        );

        auto_generate_navigation(&mut menu);

        assert_eq!(focus_node(&menu, "b1").nav_down.as_deref(), Some("b2"));
        assert_eq!(focus_node(&menu, "b2").nav_up.as_deref(), Some("b1"));
        assert_eq!(
            menu.doc().interaction.default_focus_id.as_deref(),
            Some("b1")
        );
    }

    #[test]
    fn auto_navigation_grid_buttons() {
        let mut menu = menu_with_buttons(
            "m1",
            "Grid",
            &[
                ("tl", "Top Left", 100.0, 100.0, 150.0, 40.0),
                ("tr", "Top Right", 400.0, 100.0, 150.0, 40.0),
                ("bl", "Bottom Left", 100.0, 300.0, 150.0, 40.0),
                ("br", "Bottom Right", 400.0, 300.0, 150.0, 40.0),
            ],
        );

        auto_generate_navigation(&mut menu);

        assert_eq!(focus_node(&menu, "tl").nav_right.as_deref(), Some("tr"));
        assert_eq!(focus_node(&menu, "tl").nav_down.as_deref(), Some("bl"));
        assert_eq!(focus_node(&menu, "br").nav_left.as_deref(), Some("bl"));
        assert_eq!(focus_node(&menu, "br").nav_up.as_deref(), Some("tr"));
    }

    #[test]
    fn auto_navigation_one_top_two_bottom() {
        // Layout: one button centered at top, two buttons side-by-side at bottom.
        // Left/right from the bottom buttons should link to each other, NOT to the
        // top button.
        let mut menu = menu_with_buttons(
            "m1",
            "Inverted-T",
            &[
                ("top", "E04E01", 285.0, 160.0, 150.0, 40.0),
                ("bl", "Chapter 1", 110.0, 300.0, 200.0, 40.0),
                ("br", "Chapter 2", 410.0, 300.0, 200.0, 40.0),
            ],
        );

        auto_generate_navigation(&mut menu);

        // Bottom-left right should go to bottom-right (not top)
        assert_eq!(
            focus_node(&menu, "bl").nav_right.as_deref(),
            Some("br"),
            "Chapter 1 right should go to Chapter 2"
        );
        // Bottom-right left should go to bottom-left (not top)
        assert_eq!(
            focus_node(&menu, "br").nav_left.as_deref(),
            Some("bl"),
            "Chapter 2 left should go to Chapter 1"
        );
        // Both bottom buttons should go up to top
        assert_eq!(focus_node(&menu, "bl").nav_up.as_deref(), Some("top"));
        assert_eq!(focus_node(&menu, "br").nav_up.as_deref(), Some("top"));
        // Top button should go down to one of the bottom buttons
        assert!(focus_node(&menu, "top").nav_down.is_some());
    }

    #[test]
    fn auto_navigation_close_vertical_spacing() {
        // Regression: real-world layout where the top button is only ~77px above
        // the two bottom buttons. With weaker scoring the algorithm picked the
        // diagonal top button as "right" from bottom-left, bypassing the
        // perfectly-aligned bottom-right button.
        let mut menu = menu_with_buttons(
            "m1",
            "Close-V",
            &[
                ("top", "E04E01", 260.0, 268.0, 200.0, 40.0),
                ("bl", "Chapter 1", 95.0, 345.0, 200.0, 40.0),
                ("br", "Chapter 2", 406.0, 345.0, 200.0, 40.0),
            ],
        );

        auto_generate_navigation(&mut menu);

        assert_eq!(
            focus_node(&menu, "bl").nav_right.as_deref(),
            Some("br"),
            "Chapter 1 right should go to Chapter 2, not diagonally to E04E01"
        );
        assert_eq!(
            focus_node(&menu, "br").nav_left.as_deref(),
            Some("bl"),
            "Chapter 2 left should go to Chapter 1, not diagonally to E04E01"
        );
        assert_eq!(focus_node(&menu, "bl").nav_up.as_deref(), Some("top"));
        assert_eq!(focus_node(&menu, "br").nav_up.as_deref(), Some("top"));
    }
}
