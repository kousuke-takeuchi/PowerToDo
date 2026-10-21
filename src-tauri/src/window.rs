//! The main window: bringing it back from the tray, a notification or the Dock.

use tauri::{AppHandle, Emitter, Manager};

use crate::commands::AppState;

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
            // `unminimize` is cfg(desktop).
            #[cfg(desktop)]
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

/// The one place that decides whether the app may quit now: with held projects the UI has to
/// ask first (the window is shown, then `exit-blocked`, then the `quit` command), otherwise exit at once. Used by the
/// macOS Quit item, the tray's 「終了」 and a window close that is not hidden.
pub fn request_quit(app: &AppHandle) {
    let held = app
        .try_state::<AppState>()
        .map(|state| state.held_projects())
        .unwrap_or_default();
    if held.is_empty() {
        app.exit(0);
    } else {
        // The UI asks with a native dialog, a sheet on the window: with the window hidden (in
        // the tray) it would be invisible. Show it first.
        show_main_window(app);
        let _ = app.emit("exit-blocked", held);
    }
}
