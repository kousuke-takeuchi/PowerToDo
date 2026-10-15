//! The main window: bringing it back from the tray, a notification or the Dock.

use tauri::{AppHandle, Emitter, Manager};

/// Label of the only window (`tauri.conf.json`).
pub const MAIN_WINDOW: &str = "main";

/// Shows, restores and focuses the main window, then tells the UI (`window-shown {}`) so it can
/// refresh what changed while it was hidden. Failures are logged; there is nothing to undo.
pub fn show_main_window(app: &AppHandle) {
    match app.get_webview_window(MAIN_WINDOW) {
        Some(window) => {
            if let Err(e) = window.show() {
                eprintln!("could not show the main window: {e}");
            }
            if let Err(e) = window.unminimize() {
                eprintln!("could not restore the main window: {e}");
            }
            if let Err(e) = window.set_focus() {
                eprintln!("could not focus the main window: {e}");
            }
        }
        None => eprintln!("the main window is gone"),
    }
    let _ = app.emit("window-shown", serde_json::json!({}));
}
