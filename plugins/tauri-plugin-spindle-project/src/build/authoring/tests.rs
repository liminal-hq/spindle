// Integration tests for dvdauthor XML generation.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

use crate::build::generate_build_plan;
use crate::build::test_support::{
    add_second_titleset, test_menu, test_menu_with_action, test_project,
};
use crate::models::{
    AspectMode, AudioOutputTarget, AudioTrackMapping, ChapterPoint, CopyMode, MenuDomain,
    PlaybackAction, SubtitleStreamInfo, SubtitleTrackMapping, SubtitleType, Title,
    VideoOutputProfile, VideoRaster, VideoStandard, VideoTrackMapping,
};

fn make_title(id: &str, name: &str, order_index: u32) -> Title {
    Title {
        id: id.to_string(),
        name: name.to_string(),
        source_asset_id: Some("asset-1".to_string()),
        video_mapping: Some(VideoTrackMapping {
            source_stream_index: 0,
            copy_mode: CopyMode::ReEncode,
        }),
        video_output_profile: Some(VideoOutputProfile {
            raster: VideoRaster::FullD1,
            aspect: crate::models::AspectMode::SixteenByNine,
        }),
        audio_mappings: vec![AudioTrackMapping {
            id: "am-x".to_string(),
            source_stream_index: 1,
            output_target: AudioOutputTarget::Ac3,
            copy_mode: CopyMode::ReEncode,
            label: "English".to_string(),
            language: "eng".to_string(),
            order_index: 0,
            is_default: true,
            channel_layout: None,
            bitrate_bps: None,
        }],
        subtitle_mappings: vec![],
        chapters: vec![ChapterPoint {
            id: "ch-x".to_string(),
            name: "Chapter 1".to_string(),
            timestamp_secs: 0.0,
            order_index: 0,
        }],
        end_action: None,
        order_index,
        bitrate_weight: 1.0,
        bitrate_floor_bps: None,
        bitrate_ceiling_bps: None,
        pinned_bitrate_bps: None,
    }
}

#[test]
fn play_next_in_titleset_expands_to_next_title_by_order_index() {
    let mut project = test_project();
    // Add a second title to the titleset with a higher order_index.
    project.disc.titlesets[0]
        .titles
        .push(make_title("title-2", "Episode 2", 1));
    project.disc.titlesets[0].titles[0].order_index = 0;
    project.disc.titlesets[0].titles[0].end_action = Some(PlaybackAction::PlayNextInTitleset);

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    // The first title's <post> should jump to title 2 (local titleset numbering).
    assert!(
        plan.dvdauthor_xml
            .contains("<post>\n          jump title 2;\n        </post>"),
        "PlayNextInTitleset should expand to a jump to the next title\n{}",
        plan.dvdauthor_xml
    );
}

#[test]
fn play_next_in_titleset_last_title_emits_no_post_block() {
    let mut project = test_project();
    // Only one title — it is already the last in the titleset.
    project.disc.titlesets[0].titles[0].order_index = 0;
    project.disc.titlesets[0].titles[0].end_action = Some(PlaybackAction::PlayNextInTitleset);

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    // No <post> block should be emitted when this is the last title.
    assert!(
        !plan.dvdauthor_xml.contains("<post>"),
        "PlayNextInTitleset on the last title should emit no <post> block\n{}",
        plan.dvdauthor_xml
    );
}

#[test]
fn play_all_in_titleset_on_button_expands_to_sequence_of_play_title() {
    let mut project = test_project();
    project.disc.titlesets[0]
        .titles
        .push(make_title("title-2", "Episode 2", 1));
    project.disc.titlesets[0].titles[0].order_index = 0;

    // Create a titleset menu with a "Play All" button.
    let menu = test_menu_with_action(
        "ts-menu-1",
        "Titleset Menu",
        PlaybackAction::PlayAllInTitleset,
    );
    project.disc.titlesets[0].menus.push(menu);

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    // The button command should expand to a sequence jumping both titles.
    assert!(
        plan.dvdauthor_xml.contains("jump title 1") && plan.dvdauthor_xml.contains("jump title 2"),
        "PlayAllInTitleset button should expand to a sequence jumping all titles\n{}",
        plan.dvdauthor_xml
    );
}

#[test]
fn dvdauthor_xml_contains_authored_menu_vob_and_button() {
    let mut project = test_project();
    project.disc.global_menus.push(test_menu());

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan.dvdauthor_xml.contains("menu-1.mpg"));
    assert!(plan
        .dvdauthor_xml
        .contains("<button>jump title 1;</button>"));
}

#[test]
fn dvdauthor_xml_contains_chapters() {
    let project = test_project();
    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan.dvdauthor_xml.contains("chapters="));
    assert!(plan.dvdauthor_xml.contains("0:00:00.0"));
    assert!(plan.dvdauthor_xml.contains("0:05:00.0"));
}

#[test]
fn dvdauthor_xml_contains_end_action() {
    let project = test_project();
    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan.dvdauthor_xml.contains("exit"));
}

#[test]
fn title_post_uses_call_for_menu_actions() {
    let mut project = test_project();
    project.disc.global_menus.push(test_menu());
    project.disc.titlesets[0].titles[0].end_action = Some(PlaybackAction::ShowMenu {
        menu_id: "menu-1".to_string(),
    });

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan
        .dvdauthor_xml
        .contains("<post>\n          call vmgm menu 1;\n        </post>"));
}

#[test]
fn dvdauthor_xml_contains_video_format() {
    let project = test_project();
    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(
        plan.dvdauthor_xml.contains("format=\"ntsc\""),
        "dvdauthor XML must declare video format\n{}",
        plan.dvdauthor_xml
    );
    assert!(
        plan.dvdauthor_xml.contains("aspect=\"16:9\""),
        "dvdauthor XML must declare aspect ratio\n{}",
        plan.dvdauthor_xml
    );
}

#[test]
fn dvdauthor_xml_declares_vmgm_video_format_with_first_play_but_no_global_menus() {
    // Regression test: a disc with a first-play action but no global/VMGM-level
    // menus (the common case where all real menus live at the titleset level)
    // must still declare a video format inside <vmgm>, otherwise dvdauthor fails
    // at the final table-of-contents step with "no video format specified for VMGM".
    let mut project = test_project();
    assert!(project.disc.global_menus.is_empty());
    project.disc.first_play_action = Some(PlaybackAction::PlayTitle {
        title_id: "title-1".to_string(),
    });

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    let vmgm_start = plan
        .dvdauthor_xml
        .find("<vmgm>")
        .expect("dvdauthor XML must contain a <vmgm> block");
    let vmgm_end = plan
        .dvdauthor_xml
        .find("</vmgm>")
        .expect("dvdauthor XML must close the <vmgm> block");
    let vmgm_block = &plan.dvdauthor_xml[vmgm_start..vmgm_end];

    assert!(
        vmgm_block.contains("<video format=\"ntsc\" aspect=\"16:9\" />"),
        "<vmgm> must declare a video format even with no global menus\n{}",
        plan.dvdauthor_xml
    );
    assert!(vmgm_block.contains("<fpc>"));
}

#[test]
fn dvdauthor_xml_targets_named_disc_output_directory() {
    let project = test_project();
    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(
        plan.dvdauthor_xml
            .contains("<dvdauthor dest=\"/tmp/dvd_output/DVD_DISC\">"),
        "dvdauthor XML should target the named authored disc directory, not the raw output root or a nested VIDEO_TS directory\n{}",
        plan.dvdauthor_xml
    );
}

#[test]
fn dvdauthor_xml_uses_authored_menu_display_aspect() {
    let mut project = test_project();
    let mut menu = test_menu();
    menu.migrate_to_document(
        MenuDomain::Vmgm,
        VideoStandard::Ntsc,
        AspectMode::FourByThree,
    );
    project.disc.global_menus.push(menu);

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan
        .dvdauthor_xml
        .contains("<video format=\"ntsc\" aspect=\"4:3\" />"));
}

#[test]
fn dvdauthor_xml_rejects_mixed_menu_aspects_within_one_section() {
    let mut project = test_project();
    let mut menu_a = test_menu_with_action(
        "menu-1",
        "Menu A",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    );
    menu_a.migrate_to_document(
        MenuDomain::Vmgm,
        VideoStandard::Ntsc,
        AspectMode::FourByThree,
    );

    let mut menu_b = test_menu_with_action(
        "menu-2",
        "Menu B",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    );
    menu_b.migrate_to_document(
        MenuDomain::Vmgm,
        VideoStandard::Ntsc,
        AspectMode::SixteenByNine,
    );

    project.disc.global_menus.extend([menu_a, menu_b]);

    let err = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap_err();
    assert!(err
        .to_string()
        .contains("Menus in the same DVD menu section must share one display aspect"));
}

#[test]
fn dvdauthor_xml_normalises_subpicture_languages_for_dvdauthor() {
    let mut project = test_project();
    project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
        index: 2,
        codec: "dvd_subtitle".to_string(),
        language: Some("eng".to_string()),
        subtitle_type: SubtitleType::Bitmap,
        title: None,
    });
    project.disc.titlesets[0].titles[0]
        .subtitle_mappings
        .push(SubtitleTrackMapping {
            id: "sm-1".to_string(),
            source_stream_index: 2,
            label: "English".to_string(),
            language: "eng".to_string(),
            order_index: 0,
            is_default: false,
            is_forced: false,
        });

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan.dvdauthor_xml.contains("<subpicture lang=\"en\" />"));
}

#[test]
fn dvdauthor_xml_omits_invalid_subpicture_language_values() {
    let mut project = test_project();
    project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
        index: 2,
        codec: "dvd_subtitle".to_string(),
        language: Some("en&\"g".to_string()),
        subtitle_type: SubtitleType::Bitmap,
        title: None,
    });
    project.disc.titlesets[0].titles[0]
        .subtitle_mappings
        .push(SubtitleTrackMapping {
            id: "sm-1".to_string(),
            source_stream_index: 2,
            label: "English".to_string(),
            language: "en&\"g".to_string(),
            order_index: 0,
            is_default: false,
            is_forced: false,
        });

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan.dvdauthor_xml.contains("<subpicture />"));
}

#[test]
fn dvdauthor_xml_normalises_bibliographic_french_language_code() {
    let mut project = test_project();
    project.assets[0].subtitle_streams.push(SubtitleStreamInfo {
        index: 2,
        codec: "dvd_subtitle".to_string(),
        language: Some("fre".to_string()),
        subtitle_type: SubtitleType::Bitmap,
        title: None,
    });
    project.disc.titlesets[0].titles[0]
        .subtitle_mappings
        .push(SubtitleTrackMapping {
            id: "sm-1".to_string(),
            source_stream_index: 2,
            label: "French".to_string(),
            language: "fre".to_string(),
            order_index: 0,
            is_default: false,
            is_forced: false,
        });

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(
        plan.dvdauthor_xml.contains("<subpicture lang=\"fr\" />"),
        "expected bibliographic French code to normalise to fr\n{}",
        plan.dvdauthor_xml
    );
}

#[test]
fn vmgm_menu_button_to_same_domain_menu_uses_jump_menu() {
    let mut project = test_project();
    project.disc.global_menus.push(test_menu_with_action(
        "menu-1",
        "Main Menu",
        PlaybackAction::ShowMenu {
            menu_id: "menu-2".to_string(),
        },
    ));
    project.disc.global_menus.push(test_menu_with_action(
        "menu-2",
        "Scene Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    ));

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan.dvdauthor_xml.contains("<button>jump menu 2;</button>"));
}

#[test]
fn vmgm_menu_button_to_titleset_menu_uses_jump_titleset_menu() {
    let mut project = test_project();
    project.disc.global_menus.push(test_menu_with_action(
        "menu-1",
        "Main Menu",
        PlaybackAction::ShowMenu {
            menu_id: "menu-2".to_string(),
        },
    ));
    project.disc.titlesets[0].menus.push(test_menu_with_action(
        "menu-2",
        "Titleset Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    ));

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(
        plan.dvdauthor_xml
            .contains("<button>jump titleset 1 menu entry root;</button>"),
        "VMGM should jump to the titleset root menu entry"
    );
    assert!(
        plan.dvdauthor_xml.contains("<pgc entry=\"root\">"),
        "Titleset menu entry PGC should be marked as the root menu"
    );
}

#[test]
fn vmgm_to_second_titleset_menu_uses_g0_dispatch() {
    let mut project = test_project();
    // Create a global menu that targets the second menu in titleset 1
    project.disc.global_menus.push(test_menu_with_action(
        "menu-global",
        "Main Menu",
        PlaybackAction::ShowMenu {
            menu_id: "ts-menu-2".to_string(),
        },
    ));
    // Add two menus to titleset 1
    project.disc.titlesets[0].menus.push(test_menu_with_action(
        "ts-menu-1",
        "Titleset Menu 1",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    ));
    project.disc.titlesets[0].menus.push(test_menu_with_action(
        "ts-menu-2",
        "Titleset Menu 2",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    ));

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    // VMGM button should set g0 then jump to the titleset root menu entry
    assert!(
        plan.dvdauthor_xml
            .contains("<button>{ g0 = 2; jump titleset 1 menu entry root; }</button>"),
        "VMGM targeting second menu should use g0 register dispatch"
    );
    // First titleset menu PGC should have <pre> dispatch logic
    assert!(
        plan.dvdauthor_xml.contains("if (g0 eq 2)"),
        "Entry PGC should dispatch based on g0"
    );
    assert!(
        plan.dvdauthor_xml.contains("button = 1024;"),
        "Entry PGC should explicitly select the default button on entry"
    );
}

#[test]
fn menu_entry_pre_selects_first_button_when_no_default_is_set() {
    let mut project = test_project();
    let mut menu = test_menu_with_action(
        "menu-1",
        "Main Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    );
    menu.default_button_id = None;
    project.disc.global_menus.push(menu);

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(
        plan.dvdauthor_xml
            .contains("<pre>\n          button = 1024;\n        </pre>"),
        "Menus without an explicit default should still select button 1 on entry"
    );
}

#[test]
fn menu_entry_pre_selects_second_button_when_it_is_default() {
    let mut project = test_project();
    let mut menu = test_menu_with_action(
        "menu-1",
        "Main Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    );
    menu.buttons.push(crate::models::MenuButton {
        id: "btn-2".to_string(),
        label: "Extras".to_string(),
        bounds: crate::models::ButtonBounds {
            x: 120.0,
            y: 380.0,
            width: 240.0,
            height: 48.0,
        },
        action: Some(PlaybackAction::Stop),
        nav_up: Some("btn-1".to_string()),
        nav_down: None,
        nav_left: None,
        nav_right: None,
        highlight_mode: crate::models::HighlightMode::Static,
        highlight_keyframes: vec![],
        video_asset_id: None,
    });
    menu.buttons[0].nav_down = Some("btn-2".to_string());
    menu.default_button_id = Some("btn-2".to_string());
    project.disc.global_menus.push(menu);

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(
        plan.dvdauthor_xml
            .contains("<pre>\n          button = 2048;\n        </pre>"),
        "Menus should initialise the authored default button, not always button 1"
    );
}

#[test]
fn titleset_root_entry_pre_combines_dispatch_and_default_button_selection() {
    let mut project = test_project();
    let mut root_menu = test_menu_with_action(
        "ts-menu-1",
        "Titleset Menu 1",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    );
    root_menu.buttons.push(crate::models::MenuButton {
        id: "btn-2".to_string(),
        label: "Scenes".to_string(),
        bounds: crate::models::ButtonBounds {
            x: 120.0,
            y: 380.0,
            width: 240.0,
            height: 48.0,
        },
        action: Some(PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        }),
        nav_up: Some("btn-1".to_string()),
        nav_down: None,
        nav_left: None,
        nav_right: None,
        highlight_mode: crate::models::HighlightMode::Static,
        highlight_keyframes: vec![],
        video_asset_id: None,
    });
    root_menu.buttons[0].nav_down = Some("btn-2".to_string());
    root_menu.default_button_id = Some("btn-2".to_string());
    project.disc.titlesets[0].menus.push(root_menu);
    project.disc.titlesets[0].menus.push(test_menu_with_action(
        "ts-menu-2",
        "Titleset Menu 2",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    ));
    project.disc.global_menus.push(test_menu_with_action(
        "menu-global",
        "Main Menu",
        PlaybackAction::ShowMenu {
            menu_id: "ts-menu-2".to_string(),
        },
    ));

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan.dvdauthor_xml.contains(
        "<pre>\n          if (g0 eq 2) { g0 = 0; jump menu 2; }\n          g0 = 0;\n          button = 2048;\n        </pre>"
    ));
}

#[test]
fn vmgm_menu_button_to_second_titleset_title_uses_disc_global_title_numbering() {
    let mut project = test_project();
    add_second_titleset(&mut project);
    project.disc.global_menus.push(test_menu_with_action(
        "menu-1",
        "Main Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-2".to_string(),
        },
    ));

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan
        .dvdauthor_xml
        .contains("<button>jump title 2;</button>"));
}

#[test]
fn titleset_menu_button_to_vmgm_menu_uses_jump_vmgm_menu() {
    let mut project = test_project();
    project.disc.global_menus.push(test_menu_with_action(
        "menu-1",
        "Main Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    ));
    project.disc.titlesets[0].menus.push(test_menu_with_action(
        "menu-2",
        "Episode Menu",
        PlaybackAction::ShowMenu {
            menu_id: "menu-1".to_string(),
        },
    ));

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan
        .dvdauthor_xml
        .contains("<button>jump vmgm menu 1;</button>"));
}

#[test]
fn title_post_to_same_titleset_root_menu_uses_call_menu_entry_root() {
    let mut project = test_project();
    project.disc.titlesets[0].menus.push(test_menu_with_action(
        "menu-2",
        "Episode Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    ));
    project.disc.titlesets[0].titles[0].end_action = Some(PlaybackAction::ShowMenu {
        menu_id: "menu-2".to_string(),
    });

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan
        .dvdauthor_xml
        .contains("<post>\n          call menu entry root;\n        </post>"));
}

#[test]
fn title_post_to_same_titleset_non_root_menu_uses_g0_and_call_menu_entry_root() {
    let mut project = test_project();
    project.disc.titlesets[0].menus.push(test_menu_with_action(
        "menu-1",
        "Root Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    ));
    project.disc.titlesets[0].menus.push(test_menu_with_action(
        "menu-2",
        "Episode Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    ));
    project.disc.titlesets[0].titles[0].end_action = Some(PlaybackAction::ShowMenu {
        menu_id: "menu-2".to_string(),
    });

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan
        .dvdauthor_xml
        .contains("<post>\n          { g0 = 2; call menu entry root; };\n        </post>"));
}

#[test]
fn title_post_to_other_titleset_root_menu_uses_call_titleset_menu_entry_root() {
    let mut project = test_project();
    add_second_titleset(&mut project);
    project.disc.titlesets[1].menus.push(test_menu_with_action(
        "menu-2",
        "Bonus Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-2".to_string(),
        },
    ));
    project.disc.titlesets[0].titles[0].end_action = Some(PlaybackAction::ShowMenu {
        menu_id: "menu-2".to_string(),
    });

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan
        .dvdauthor_xml
        .contains("<post>\n          call titleset 2 menu entry root;\n        </post>"));
}

#[test]
fn title_post_to_other_titleset_non_root_menu_uses_g0_and_call_titleset_entry_root() {
    let mut project = test_project();
    add_second_titleset(&mut project);
    project.disc.titlesets[1].menus.push(test_menu_with_action(
        "menu-1",
        "Bonus Root Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-2".to_string(),
        },
    ));
    project.disc.titlesets[1].menus.push(test_menu_with_action(
        "menu-2",
        "Bonus Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-2".to_string(),
        },
    ));
    project.disc.titlesets[0].titles[0].end_action = Some(PlaybackAction::ShowMenu {
        menu_id: "menu-2".to_string(),
    });

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    assert!(plan.dvdauthor_xml.contains(
        "<post>\n          { g0 = 2; call titleset 2 menu entry root; };\n        </post>"
    ));
}

/// A menu button with no action must still produce a `<button>` element so that
/// dvdauthor's button numbering matches the spumux subpicture overlay. Omitting
/// the element shifts all subsequent button numbers and triggers dvdauthor's
/// "Cannot find button N" assertion.
#[test]
fn menu_button_with_no_action_emits_empty_button_element() {
    let mut project = test_project();
    let mut menu = test_menu_with_action(
        "menu-1",
        "Main Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    );
    // Add a second button with no action (e.g. a "not yet implemented" placeholder).
    menu.buttons.push(crate::models::MenuButton {
        id: "btn-noop".to_string(),
        label: "Coming Soon".to_string(),
        bounds: crate::models::ButtonBounds {
            x: 120.0,
            y: 380.0,
            width: 240.0,
            height: 48.0,
        },
        action: None,
        nav_up: Some("btn-1".to_string()),
        nav_down: None,
        nav_left: None,
        nav_right: None,
        highlight_mode: crate::models::HighlightMode::Static,
        highlight_keyframes: vec![],
        video_asset_id: None,
    });
    project.disc.global_menus.push(menu);

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    // Both buttons must be present — one with a command, one empty.
    assert!(
        plan.dvdauthor_xml
            .contains("<button>jump title 1;</button>"),
        "First button (with action) should emit its DVD command\n{}",
        plan.dvdauthor_xml
    );
    assert!(
        plan.dvdauthor_xml.contains("<button>resume;</button>"),
        "No-action button must emit resume; to stay on the menu rather than stopping playback\n{}",
        plan.dvdauthor_xml
    );
}

/// When a no-action button appears between two buttons that do have actions, the
/// relative order of all three `<button>` elements must be preserved so that
/// spumux button slots align correctly.
#[test]
fn menu_button_order_preserved_with_mixed_action_and_no_action_buttons() {
    let mut project = test_project();
    let mut menu = test_menu_with_action(
        "menu-1",
        "Main Menu",
        PlaybackAction::PlayTitle {
            title_id: "title-1".to_string(),
        },
    );
    // btn-1 already set by test_menu_with_action (has action: jump title 1)
    // Insert no-action btn in slot 2
    menu.buttons.push(crate::models::MenuButton {
        id: "btn-noop".to_string(),
        label: "Placeholder".to_string(),
        bounds: crate::models::ButtonBounds {
            x: 120.0,
            y: 380.0,
            width: 240.0,
            height: 48.0,
        },
        action: None,
        nav_up: None,
        nav_down: None,
        nav_left: None,
        nav_right: None,
        highlight_mode: crate::models::HighlightMode::Static,
        highlight_keyframes: vec![],
        video_asset_id: None,
    });
    // btn-3 has action: Stop (slot 3)
    menu.buttons.push(crate::models::MenuButton {
        id: "btn-stop".to_string(),
        label: "Exit".to_string(),
        bounds: crate::models::ButtonBounds {
            x: 120.0,
            y: 440.0,
            width: 240.0,
            height: 48.0,
        },
        action: Some(PlaybackAction::Stop),
        nav_up: None,
        nav_down: None,
        nav_left: None,
        nav_right: None,
        highlight_mode: crate::models::HighlightMode::Static,
        highlight_keyframes: vec![],
        video_asset_id: None,
    });
    project.disc.global_menus.push(menu);

    let plan = generate_build_plan(&project, "/tmp/dvd_output", false).unwrap();

    // Extract the button elements in document order.
    let buttons: Vec<&str> = plan
        .dvdauthor_xml
        .lines()
        .filter(|l| l.trim().starts_with("<button>"))
        .collect();
    assert_eq!(
        buttons.len(),
        3,
        "Three buttons should be emitted (including the no-action one)\n{}",
        plan.dvdauthor_xml
    );
    assert!(
        buttons[0].contains("jump title 1"),
        "Slot 1 should be the play-title button"
    );
    assert!(
        buttons[1] == "        <button>resume;</button>",
        "Slot 2 should be the no-action button, emitting resume; to stay on the menu"
    );
    assert!(
        buttons[2].contains("exit"),
        "Slot 3 should be the stop/exit button"
    );
}
