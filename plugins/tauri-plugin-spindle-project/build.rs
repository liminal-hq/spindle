const COMMANDS: &[&str] = &[
    "create_project",
    "parse_project",
    "serialise_project",
    "validate_project",
    "inspect_asset",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
