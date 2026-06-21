const COMMANDS: &[&str] = &["get_displays", "get_active_display"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
