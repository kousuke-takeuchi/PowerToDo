// No commands are exposed to the page: the app's Rust code calls the plugin directly.
const COMMANDS: &[&str] = &[];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
