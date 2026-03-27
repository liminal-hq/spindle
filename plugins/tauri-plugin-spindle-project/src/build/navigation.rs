// Menu navigation auto-generation from button geometry.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use crate::models::Menu;

pub fn auto_generate_navigation(menu: &mut Menu) {
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

            if dy < 0.0
                && dy.abs() >= dx.abs() * 0.5
                && (best_up.is_none() || dist < best_up.unwrap().1)
            {
                best_up = Some((j, dist));
            }
            if dy > 0.0
                && dy.abs() >= dx.abs() * 0.5
                && (best_down.is_none() || dist < best_down.unwrap().1)
            {
                best_down = Some((j, dist));
            }
            if dx < 0.0
                && dx.abs() >= dy.abs() * 0.5
                && (best_left.is_none() || dist < best_left.unwrap().1)
            {
                best_left = Some((j, dist));
            }
            if dx > 0.0
                && dx.abs() >= dy.abs() * 0.5
                && (best_right.is_none() || dist < best_right.unwrap().1)
            {
                best_right = Some((j, dist));
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
        };

        auto_generate_navigation(&mut menu);

        assert_eq!(menu.buttons[0].nav_right.as_deref(), Some("tr"));
        assert_eq!(menu.buttons[0].nav_down.as_deref(), Some("bl"));
        assert_eq!(menu.buttons[3].nav_left.as_deref(), Some("bl"));
        assert_eq!(menu.buttons[3].nav_up.as_deref(), Some("tr"));
    }
}
