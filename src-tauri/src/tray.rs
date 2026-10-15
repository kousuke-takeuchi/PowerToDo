//! The tray icon and what closing the main window does (仕様 §5).

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

/// Creates the tray icon. On failure the reason is logged and kept in `AppState::tray_error`
/// (the settings pane notes it); closing the window then quits instead of hiding it.
pub fn setup(app: &AppHandle) {
    if let Err(e) = build(app) {
        eprintln!("could not create the tray icon: {e}");
        if let Some(state) = app.try_state::<AppState>() {
            *state.tray_error.lock().unwrap_or_else(|e| e.into_inner()) = Some(e.to_string());
        }
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
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
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
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    // macOS: tint the icon with the menu bar (no effect elsewhere).
    builder = builder.icon_as_template(true);
    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
