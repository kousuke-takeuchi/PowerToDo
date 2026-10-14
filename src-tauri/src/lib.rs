pub mod commands;
pub mod domain;
pub mod error;
pub mod platform;
pub mod store;

use tauri::{Emitter, Manager};

use commands::AppState;

/// Id of the app menu's own Quit item (macOS).
#[cfg(target_os = "macos")]
const QUIT_MENU_ID: &str = "powertodo-quit";

/// Tauri's default macOS menu, except that the app menu's Quit is our own item. The predefined
/// Quit sends `terminate:`, which tao reports only as `RunEvent::Exit` (no `ExitRequested`), so
/// held projects could not be asked about. Our item goes through `on_menu_event` instead. The
/// other menus (Edit's copy / paste / undo, Window) stay as they are, so text editing shortcuts
/// keep working. Windows / Linux have no default menu; their window close goes through
/// `CloseRequested`.
#[cfg(target_os = "macos")]
fn app_menu(handle: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};

    let menu = Menu::default(handle)?;
    // The first submenu of the default menu is the app menu (About … Quit). Rebuild it with the
    // same items and our Quit.
    menu.remove_at(0)?;
    let pkg = handle.package_info();
    let config = handle.config();
    let about = AboutMetadata {
        name: Some(pkg.name.clone()),
        version: Some(pkg.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };
    let quit = MenuItem::with_id(
        handle,
        QUIT_MENU_ID,
        "PowerToDo を終了",
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let app_submenu = Submenu::with_items(
        handle,
        pkg.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(handle, None, Some(about))?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::services(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &quit,
        ],
    )?;
    menu.prepend(&app_submenu)?;
    Ok(menu)
}

/// Our Quit item: quit at once unless something is held; then the UI asks (same event as a
/// blocked `ExitRequested`) and calls `quit` itself.
#[cfg(target_os = "macos")]
fn on_quit_menu(handle: &tauri::AppHandle) {
    let held = handle
        .try_state::<AppState>()
        .map(|state| state.held_projects())
        .unwrap_or_default();
    if held.is_empty() {
        handle.exit(0);
    } else {
        let _ = handle.emit("exit-blocked", held);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(app_menu).on_menu_event(|handle, event| {
        if event.id() == QUIT_MENU_ID {
            on_quit_menu(handle);
        }
    });
    let app = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = platform::app_data_dir(app.handle())?;
            app.manage(AppState::new(dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_state,
            commands::set_data_dir,
            commands::watch_status,
            commands::pick_folder,
            commands::reveal_data_dir,
            commands::retry_save,
            commands::list_projects,
            commands::get_project,
            commands::reload_project,
            commands::create_project,
            commands::rename_project,
            commands::delete_project,
            commands::add_section,
            commands::rename_section,
            commands::reorder_sections,
            commands::add_task,
            commands::update_task,
            commands::complete_task,
            commands::delete_task,
            commands::move_task,
            commands::reorder_tasks,
            commands::quick_add,
            commands::parse_quick_add,
            commands::settings,
            commands::update_settings,
            commands::today_view,
            commands::upcoming_view,
            commands::label_view,
            commands::labels,
            commands::add_label,
            commands::update_label,
            commands::rename_label,
            commands::delete_label,
            commands::reschedule_overdue,
            commands::search,
            commands::counts,
            commands::resolve_external_change,
            commands::held_projects,
            commands::quit,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| match event {
        // Quitting (Cmd+Q, or the last window closing) must not drop an external change the
        // user has not decided about: keep running and let the UI ask. The `quit` command exits
        // with a code, which is let through.
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            if code.is_none()
                && let Some(state) = handle.try_state::<AppState>()
            {
                let held = state.held_projects();
                if !held.is_empty() {
                    api.prevent_exit();
                    let _ = handle.emit("exit-blocked", held);
                }
            }
        }
        // Closing the last window ends the app only after its window is gone, when there is no
        // page left to ask. Keep the window while something is held; same event for the UI.
        tauri::RunEvent::WindowEvent {
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } => {
            if let Some(state) = handle.try_state::<AppState>() {
                let held = state.held_projects();
                if !held.is_empty() {
                    api.prevent_close();
                    let _ = handle.emit("exit-blocked", held);
                }
            }
        }
        // Edits are written 1 s after the last change; do not lose the last second on quit.
        // Edits that cannot be written to their own file (held, or the file changed on disk)
        // go to a recovery copy in `archive/` (in `<app data>/recovery/` when `archive/` cannot
        // be written): the Dock's Quit or a logout reaches only this event, without
        // `ExitRequested`, so the UI never got to ask.
        tauri::RunEvent::Exit => {
            if let Some(state) = handle.try_state::<AppState>() {
                state.flush_all();
            }
        }
        _ => {}
    });
}
