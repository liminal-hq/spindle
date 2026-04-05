// Menu navigation auto-generation from button geometry.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use crate::models::{Menu, SceneNode};

pub fn auto_generate_navigation(menu: &mut Menu) {
    if let Some(doc) = &mut menu.authored_document {
        // ── Scene-Aware Navigation Generation ───────────────────────────────
        let mut buttons: Vec<(String, f64, f64)> = doc
            .scene
            .nodes
            .iter()
            .filter_map(|node| {
                if let SceneNode::Button {
                    id,
                    x,
                    y,
                    width,
                    height,
                    ..
                } = node
                {
                    Some((id.clone(), x + width / 2.0, y + height / 2.0))
                } else {
                    None
                }
            })
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
    } else {
        // ── Legacy Navigation Generation ────────────────────────────────────
        let centres: Vec<(f64, f64)> = menu
            .buttons
            .iter()
            .map(|b| {
                (
                    b.bounds.x + b.bounds.width / 2.0,
                    b.bounds.y + b.bounds.height / 2.0,
                )
            })
            .collect();

        let n = menu.buttons.len();
        if n < 2 {
            if n == 1 && menu.default_button_id.is_none() {
                menu.default_button_id = Some(menu.buttons[0].id.clone());
            }
            return;
        }

        for i in 0..n {
            let (cx, cy) = centres[i];
            let mut best_up: Option<(usize, f64)> = None;
            let mut best_down: Option<(usize, f64)> = None;
            let mut best_left: Option<(usize, f64)> = None;
            let mut best_right: Option<(usize, f64)> = None;

            for (j, &(ox, oy)) in centres.iter().enumerate() {
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

            let up_id = best_up.map(|(j, _)| menu.buttons[j].id.clone());
            let down_id = best_down.map(|(j, _)| menu.buttons[j].id.clone());
            let left_id = best_left.map(|(j, _)| menu.buttons[j].id.clone());
            let right_id = best_right.map(|(j, _)| menu.buttons[j].id.clone());

            menu.buttons[i].nav_up = up_id;
            menu.buttons[i].nav_down = down_id;
            menu.buttons[i].nav_left = left_id;
            menu.buttons[i].nav_right = right_id;
        }

        if menu.default_button_id.is_none() && !menu.buttons.is_empty() {
            menu.default_button_id = Some(menu.buttons[0].id.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::models::{
        BackgroundMode, ButtonBounds, HighlightMode, Menu, MenuButton, MenuHighlightColours,
    };

    use super::auto_generate_navigation;

    #[test]
    fn auto_navigation_vertical_buttons() {
        let mut menu = Menu {
            id: "m1".to_string(),
            name: "Test".to_string(),
            background_asset_id: None,
            buttons: vec![
                MenuButton {
                    id: "b1".to_string(),
                    label: "Top".to_string(),
                    bounds: ButtonBounds {
                        x: 260.0,
                        y: 100.0,
                        width: 200.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
                MenuButton {
                    id: "b2".to_string(),
                    label: "Bottom".to_string(),
                    bounds: ButtonBounds {
                        x: 260.0,
                        y: 200.0,
                        width: 200.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
            ],
            default_button_id: None,
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::default(),
            motion_duration_secs: None,
            motion_audio_asset_id: None,
            motion_loop_count: 0,
            timeout_action: None,
            authored_document: None,
        };

        auto_generate_navigation(&mut menu);

        assert_eq!(menu.buttons[0].nav_down.as_deref(), Some("b2"));
        assert_eq!(menu.buttons[1].nav_up.as_deref(), Some("b1"));
        assert_eq!(menu.default_button_id.as_deref(), Some("b1"));
    }

    #[test]
    fn auto_navigation_grid_buttons() {
        let mut menu = Menu {
            id: "m1".to_string(),
            name: "Grid".to_string(),
            background_asset_id: None,
            buttons: vec![
                MenuButton {
                    id: "tl".to_string(),
                    label: "Top Left".to_string(),
                    bounds: ButtonBounds {
                        x: 100.0,
                        y: 100.0,
                        width: 150.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
                MenuButton {
                    id: "tr".to_string(),
                    label: "Top Right".to_string(),
                    bounds: ButtonBounds {
                        x: 400.0,
                        y: 100.0,
                        width: 150.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
                MenuButton {
                    id: "bl".to_string(),
                    label: "Bottom Left".to_string(),
                    bounds: ButtonBounds {
                        x: 100.0,
                        y: 300.0,
                        width: 150.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
                MenuButton {
                    id: "br".to_string(),
                    label: "Bottom Right".to_string(),
                    bounds: ButtonBounds {
                        x: 400.0,
                        y: 300.0,
                        width: 150.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
            ],
            default_button_id: None,
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::default(),
            motion_duration_secs: None,
            motion_audio_asset_id: None,
            motion_loop_count: 0,
            timeout_action: None,
            authored_document: None,
        };

        auto_generate_navigation(&mut menu);

        assert_eq!(menu.buttons[0].nav_right.as_deref(), Some("tr"));
        assert_eq!(menu.buttons[0].nav_down.as_deref(), Some("bl"));
        assert_eq!(menu.buttons[3].nav_left.as_deref(), Some("bl"));
        assert_eq!(menu.buttons[3].nav_up.as_deref(), Some("tr"));
    }

    #[test]
    fn auto_navigation_one_top_two_bottom() {
        // Layout: one button centered at top, two buttons side-by-side at bottom.
        // Left/right from the bottom buttons should link to each other, NOT to the
        // top button.
        let mut menu = Menu {
            id: "m1".to_string(),
            name: "Inverted-T".to_string(),
            background_asset_id: None,
            buttons: vec![
                MenuButton {
                    id: "top".to_string(),
                    label: "E04E01".to_string(),
                    bounds: ButtonBounds {
                        x: 285.0,
                        y: 160.0,
                        width: 150.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
                MenuButton {
                    id: "bl".to_string(),
                    label: "Chapter 1".to_string(),
                    bounds: ButtonBounds {
                        x: 110.0,
                        y: 300.0,
                        width: 200.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
                MenuButton {
                    id: "br".to_string(),
                    label: "Chapter 2".to_string(),
                    bounds: ButtonBounds {
                        x: 410.0,
                        y: 300.0,
                        width: 200.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
            ],
            default_button_id: None,
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::default(),
            motion_duration_secs: None,
            motion_audio_asset_id: None,
            motion_loop_count: 0,
            timeout_action: None,
            authored_document: None,
        };

        auto_generate_navigation(&mut menu);

        // Bottom-left right should go to bottom-right (not top)
        assert_eq!(
            menu.buttons[1].nav_right.as_deref(),
            Some("br"),
            "Chapter 1 right should go to Chapter 2"
        );
        // Bottom-right left should go to bottom-left (not top)
        assert_eq!(
            menu.buttons[2].nav_left.as_deref(),
            Some("bl"),
            "Chapter 2 left should go to Chapter 1"
        );
        // Both bottom buttons should go up to top
        assert_eq!(menu.buttons[1].nav_up.as_deref(), Some("top"));
        assert_eq!(menu.buttons[2].nav_up.as_deref(), Some("top"));
        // Top button should go down to one of the bottom buttons
        assert!(menu.buttons[0].nav_down.is_some());
    }

    #[test]
    fn auto_navigation_close_vertical_spacing() {
        // Regression: real-world layout where the top button is only ~77px above
        // the two bottom buttons. With weaker scoring the algorithm picked the
        // diagonal top button as "right" from bottom-left, bypassing the
        // perfectly-aligned bottom-right button.
        let mut menu = Menu {
            id: "m1".to_string(),
            name: "Close-V".to_string(),
            background_asset_id: None,
            buttons: vec![
                MenuButton {
                    id: "top".to_string(),
                    label: "E04E01".to_string(),
                    bounds: ButtonBounds {
                        x: 260.0,
                        y: 268.0,
                        width: 200.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
                MenuButton {
                    id: "bl".to_string(),
                    label: "Chapter 1".to_string(),
                    bounds: ButtonBounds {
                        x: 95.0,
                        y: 345.0,
                        width: 200.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
                MenuButton {
                    id: "br".to_string(),
                    label: "Chapter 2".to_string(),
                    bounds: ButtonBounds {
                        x: 406.0,
                        y: 345.0,
                        width: 200.0,
                        height: 40.0,
                    },
                    action: None,
                    nav_up: None,
                    nav_down: None,
                    nav_left: None,
                    nav_right: None,
                    highlight_mode: HighlightMode::default(),
                    highlight_keyframes: Vec::new(),
                    video_asset_id: None,
                },
            ],
            default_button_id: None,
            highlight_colours: MenuHighlightColours::default(),
            background_mode: BackgroundMode::default(),
            motion_duration_secs: None,
            motion_audio_asset_id: None,
            motion_loop_count: 0,
            timeout_action: None,
            authored_document: None,
        };

        auto_generate_navigation(&mut menu);

        assert_eq!(
            menu.buttons[1].nav_right.as_deref(),
            Some("br"),
            "Chapter 1 right should go to Chapter 2, not diagonally to E04E01"
        );
        assert_eq!(
            menu.buttons[2].nav_left.as_deref(),
            Some("bl"),
            "Chapter 2 left should go to Chapter 1, not diagonally to E04E01"
        );
        assert_eq!(menu.buttons[1].nav_up.as_deref(), Some("top"));
        assert_eq!(menu.buttons[2].nav_up.as_deref(), Some("top"));
    }
}
