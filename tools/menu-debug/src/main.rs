// CLI tool to render and inspect Spindle menu scenes from .spindle project files.
//
// Usage:
//   menu-debug <project.spindle> [output-dir]
//
// For each menu in the project this tool:
//   1. Dumps font resolution diagnostics (project fonts, system fonts)
//   2. Renders the scene PNG at raster resolution
//   3. Renders the DAR-corrected preview PNG
//   4. Prints per-menu metadata (design size, render target, node summary)
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use tauri_plugin_spindle_project::build::{
    authorable_menus, enumerate_fonts, export_menu_render_preview, render_menu_scene_to_png,
    FontSource, MenuDomain,
};
use tauri_plugin_spindle_project::{
    AspectMode, Asset, RenderTarget, SceneNode, SpindleProjectFile,
};

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 || args[1] == "--help" || args[1] == "-h" {
        eprintln!("Usage: menu-debug <project.spindle> [output-dir]");
        eprintln!();
        eprintln!("Renders all menus from a .spindle project file and dumps");
        eprintln!("intermediate diagnostics to the output directory.");
        eprintln!();
        eprintln!("If output-dir is omitted, a _menu_debug/ directory is");
        eprintln!("created next to the project file.");
        std::process::exit(1);
    }

    let project_path = PathBuf::from(&args[1]);
    if !project_path.exists() {
        eprintln!("Error: project file not found: {}", project_path.display());
        std::process::exit(1);
    }

    let output_dir = if args.len() >= 3 {
        PathBuf::from(&args[2])
    } else {
        let stem = project_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("project");
        project_path
            .parent()
            .unwrap_or(Path::new("."))
            .join(format!("{stem}_menu_debug"))
    };

    // Load project.
    let raw = match std::fs::read_to_string(&project_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Error reading project file: {e}");
            std::process::exit(1);
        }
    };

    let project: SpindleProjectFile = match serde_json::from_str(&raw) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Error parsing project JSON: {e}");
            std::process::exit(1);
        }
    };

    std::fs::create_dir_all(&output_dir).unwrap_or_else(|e| {
        eprintln!("Error creating output directory: {e}");
        std::process::exit(1);
    });

    // ── Font diagnostics ─────────────────────────────────────────────────────

    println!("=== Font Resolution Diagnostics ===\n");

    let asset_refs: Vec<&Asset> = project.assets.iter().collect();
    let fonts = enumerate_fonts(&asset_refs);

    let mut project_font_count = 0;
    let mut system_font_count = 0;

    for font in &fonts {
        match font.source {
            FontSource::ProjectAsset => {
                project_font_count += 1;
                println!("  [project-asset] {}", font.family);
            }
            FontSource::AppSidecar => {
                println!("  [app-sidecar]   {}", font.family);
            }
            FontSource::System => {
                system_font_count += 1;
            }
        }
    }

    println!("\n  Project fonts: {project_font_count}");
    println!("  System fonts:  {system_font_count}");

    // Print system fonts on request.
    if std::env::var("MENU_DEBUG_SHOW_SYSTEM_FONTS").is_ok() {
        println!("\n  System font families:");
        for font in &fonts {
            if matches!(font.source, FontSource::System) {
                println!("    {}", font.family);
            }
        }
    } else {
        println!("  (set MENU_DEBUG_SHOW_SYSTEM_FONTS=1 to list system fonts)");
    }
    println!();

    // ── Per-menu rendering ───────────────────────────────────────────────────

    let menus = authorable_menus(&project);

    if menus.is_empty() {
        println!("No menus found in project.");
        return;
    }

    println!("=== Rendering {} menu(s) ===\n", menus.len());

    let asset_map: HashMap<&str, &Asset> =
        project.assets.iter().map(|a| (a.id.as_str(), a)).collect();

    for menu_ref in &menus {
        let menu = menu_ref.menu;
        let doc = match &menu.authored_document {
            Some(d) => d,
            None => {
                println!(
                    "  [{} / {}] — no authored document, skipping",
                    menu.id, menu.name
                );
                continue;
            }
        };

        let domain_str = match menu_ref.domain {
            MenuDomain::Vmgm => "VMGM".to_string(),
            MenuDomain::Titleset(i) => format!("VTS {}", i + 1),
        };

        let display_aspect = doc
            .compile_policy
            .display_aspect
            .unwrap_or(AspectMode::SixteenByNine);
        let target = RenderTarget::from_disc(&project.disc, display_aspect);

        println!("── Menu: {} ({}) ──", doc.name, domain_str);
        println!("   ID:           {}", menu.id);
        println!(
            "   Design size:  {}×{} ({})",
            doc.scene.design_size.width,
            doc.scene.design_size.height,
            match doc.scene.design_size.aspect {
                AspectMode::FourByThree => "4:3",
                AspectMode::SixteenByNine => "16:9",
            }
        );
        println!(
            "   Render target: {}×{} SAR {}/{}",
            target.raster_width, target.raster_height, target.sar_num, target.sar_den
        );

        // Node summary.
        let (mut buttons, mut texts, mut images, mut shapes, mut others) = (0, 0, 0, 0, 0);
        for node in &doc.scene.nodes {
            match node {
                SceneNode::Button {
                    label, label_style, ..
                } => {
                    buttons += 1;
                    let font_info = label_style
                        .as_ref()
                        .map(|ls| format!("{} {}px", ls.font_family, ls.font_size))
                        .unwrap_or_else(|| "default (no label_style)".to_string());
                    println!(
                        "   Button: {:30} font: {}",
                        format!("\"{}\"", label),
                        font_info
                    );
                }
                SceneNode::Text {
                    content,
                    font_family,
                    font_size,
                    ..
                } => {
                    texts += 1;
                    let fam = font_family.as_deref().unwrap_or("default");
                    let size = font_size.unwrap_or(24.0);
                    println!(
                        "   Text:   {:30} font: {} {:.0}px",
                        format!("\"{}\"", content),
                        fam,
                        size
                    );
                }
                SceneNode::Image { asset_id, .. } => {
                    images += 1;
                    let name = asset_map
                        .get(asset_id.as_str())
                        .map(|a| a.file_name.as_str())
                        .unwrap_or("???");
                    println!("   Image:  {}", name);
                }
                SceneNode::Shape { .. } => shapes += 1,
                _ => others += 1,
            }
        }
        println!(
            "   Nodes:  {} button(s), {} text(s), {} image(s), {} shape(s), {} other",
            buttons, texts, images, shapes, others
        );

        // Render scene PNG.
        let safe_name = menu
            .id
            .replace(|c: char| !c.is_alphanumeric() && c != '-', "_");
        let scene_png = output_dir.join(format!("{safe_name}_scene.png"));
        match render_menu_scene_to_png(menu_ref, &asset_map, target, &scene_png, false) {
            Ok(()) => println!("   Scene PNG:    {}", scene_png.display()),
            Err(e) => println!("   Scene PNG:    ERROR — {e}"),
        }

        // Render transparent scene PNG (as used in build pipeline).
        let scene_transparent = output_dir.join(format!("{safe_name}_scene_transparent.png"));
        match render_menu_scene_to_png(menu_ref, &asset_map, target, &scene_transparent, true) {
            Ok(()) => println!("   Transparent:  {}", scene_transparent.display()),
            Err(e) => println!("   Transparent:  ERROR — {e}"),
        }

        // DAR-corrected preview.
        let preview_png = output_dir.join(format!("{safe_name}_preview.png"));
        match export_menu_render_preview(&project, &menu.id, &preview_png) {
            Ok(()) => println!("   Preview PNG:  {}", preview_png.display()),
            Err(e) => println!("   Preview PNG:  ERROR — {e}"),
        }

        println!();
    }

    println!("Output written to: {}", output_dir.display());
}
