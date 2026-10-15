//! The tray icon and what closing the main window does (仕様 §5).

use std::path::{Path, PathBuf};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, CloseRequestApi, Emitter, Manager};

use crate::commands::AppState;
use crate::window::{MAIN_WINDOW, request_quit, show_main_window};

const TRAY_ID: &str = "main";
const OPEN_ID: &str = "tray-open";
const ADD_ID: &str = "tray-add";
const QUIT_ID: &str = "tray-quit";

/// What closing the main window does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    /// Hide the window; the app keeps running in the tray / Dock.
    Hide,
    /// Close it; the app exits.
    Quit,
    /// Keep the window: projects are held and the UI has to ask first.
    AskHeld,
}

/// `keep_in_tray` wins over held projects: a hidden window loses nothing, and quitting from the
/// tray asks about them.
pub fn close_policy(keep_in_tray: bool, held: usize) -> CloseAction {
    if keep_in_tray {
        CloseAction::Hide
    } else if held > 0 {
        CloseAction::AskHeld
    } else {
        CloseAction::Quit
    }
}

/// `WindowEvent::CloseRequested` of the main window.
pub fn on_close_requested(app: &AppHandle, api: &CloseRequestApi) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    // Both reads take their lock briefly; nothing is held while the window is touched.
    match close_policy(state.keep_in_tray(), state.held_projects().len()) {
        CloseAction::Hide => {
            api.prevent_close();
            if let Some(window) = app.get_webview_window(MAIN_WINDOW)
                && let Err(e) = window.hide()
            {
                eprintln!("could not hide the main window: {e}");
            }
        }
        CloseAction::AskHeld => {
            api.prevent_close();
            request_quit(app);
        }
        CloseAction::Quit => {}
    }
}

const APPINDICATOR_LIBS: [&str; 2] = ["libayatana-appindicator3.so.1", "libappindicator3.so.1"];

/// Where the dynamic loader usually finds libraries, then the `LD_LIBRARY_PATH` entries.
pub fn library_dirs(ld_library_path: Option<&str>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = [
        "/usr/lib",
        "/usr/lib64",
        "/usr/lib/x86_64-linux-gnu",
        "/usr/lib/aarch64-linux-gnu",
        "/lib",
        "/lib64",
        "/lib/x86_64-linux-gnu",
        "/lib/aarch64-linux-gnu",
    ]
    .iter()
    .map(PathBuf::from)
    .collect();
    dirs.extend(
        ld_library_path
            .unwrap_or_default()
            .split(':')
            .filter(|d| !d.is_empty())
            .map(PathBuf::from),
    );
    dirs
}

/// Whether one of the appindicator libraries is in one of `dirs`. On Linux the tray crate
/// panics (an abort in release) when none can be loaded, so this is checked before building
/// the tray.
pub fn appindicator_available(dirs: &[PathBuf], exists: impl Fn(&Path) -> bool) -> bool {
    dirs.iter()
        .any(|dir| APPINDICATOR_LIBS.iter().any(|lib| exists(&dir.join(lib))))
}

#[cfg(target_os = "linux")]
fn tray_unavailable() -> Option<String> {
    let dirs = library_dirs(std::env::var("LD_LIBRARY_PATH").ok().as_deref());
    if appindicator_available(&dirs, |p| p.exists()) {
        None
    } else {
        Some("トレイを表示できません (libayatana-appindicator が見つかりません)".to_string())
    }
}

#[cfg(not(target_os = "linux"))]
fn tray_unavailable() -> Option<String> {
    None
}

fn record_tray_error(app: &AppHandle, message: String) {
    eprintln!("{message}");
    if let Some(state) = app.try_state::<AppState>() {
        *state.tray_error.lock().unwrap_or_else(|e| e.into_inner()) = Some(message);
    }
}

/// Creates the tray icon. On failure the reason is logged and kept in `AppState::tray_error`
/// (the settings pane notes it); closing the window then quits instead of hiding it.
pub fn setup(app: &AppHandle) {
    if let Some(message) = tray_unavailable() {
        record_tray_error(app, message);
        return;
    }
    if let Err(e) = build(app) {
        record_tray_error(app, format!("could not create the tray icon: {e}"));
    }
}

fn build(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, OPEN_ID, "PowerToDo を開く", true, None::<&str>)?,
            &MenuItem::with_id(app, ADD_ID, "タスクを追加…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, QUIT_ID, "終了", true, None::<&str>)?,
        ],
    )?;
    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(tauri::include_image!("icons/tray.png"))
        .tooltip("PowerToDo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        // Called for every menu event, the macOS app menu's included; only our ids matter here.
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN_ID => show_main_window(app),
            ADD_ID => {
                show_main_window(app);
                let _ = app.emit("open-quick-add", serde_json::json!({}));
            }
            QUIT_ID => request_quit(app),
            _ => {}
        });
    // macOS: a template image, tinted by the menu bar (no effect elsewhere).
    let builder = builder.icon_as_template(true);
    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exists_only(path: &'static str) -> impl Fn(&Path) -> bool {
        move |p| p == Path::new(path)
    }

    #[test]
    fn appindicator_is_found_in_a_library_dir() {
        let dirs = library_dirs(None);
        let ayatana = "/usr/lib/x86_64-linux-gnu/libayatana-appindicator3.so.1";
        assert!(appindicator_available(&dirs, exists_only(ayatana)));
        let legacy = "/usr/lib64/libappindicator3.so.1";
        assert!(appindicator_available(&dirs, exists_only(legacy)));
        assert!(!appindicator_available(
            &dirs,
            exists_only("/opt/x/libappindicator3.so.1")
        ));
        assert!(!appindicator_available(&dirs, |_| false));
    }

    #[test]
    fn ld_library_path_entries_are_searched() {
        let dirs = library_dirs(Some("/opt/lib::/home/u/lib"));
        assert!(dirs.contains(&PathBuf::from("/opt/lib")));
        assert!(dirs.contains(&PathBuf::from("/home/u/lib")));
        assert_eq!(dirs.len(), 10);
        assert!(appindicator_available(
            &dirs,
            exists_only("/home/u/lib/libayatana-appindicator3.so.1")
        ));
    }

    #[test]
    fn keep_in_tray_hides_whatever_is_held() {
        assert_eq!(close_policy(true, 0), CloseAction::Hide);
        assert_eq!(close_policy(true, 2), CloseAction::Hide);
    }

    #[test]
    fn without_tray_held_projects_are_asked_about() {
        assert_eq!(close_policy(false, 1), CloseAction::AskHeld);
        assert_eq!(close_policy(false, 3), CloseAction::AskHeld);
    }

    #[test]
    fn without_tray_and_nothing_held_it_quits() {
        assert_eq!(close_policy(false, 0), CloseAction::Quit);
    }
}
