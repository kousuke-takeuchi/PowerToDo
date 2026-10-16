pub mod commands;
pub mod domain;
pub mod error;
pub mod platform;
pub mod scheduler;
pub mod store;
pub mod sync;
pub mod tray;
pub mod window;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before any HTTP client of the sync is built (reqwest has no provider of its own).
    sync::tls::install_crypto_provider();
    let builder = tauri::Builder::default();
    // One app per user (仕様 §9): with close-to-tray, launching the app again while it runs
    // hidden would start a second scheduler and a second saver on the same xlsx files. The
    // second launch exits and the running one shows its window instead. Must be the first
    // plugin (the plugin's README: plugins run in the order they are added).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        window::show_main_window(app);
    }));
    #[cfg(target_os = "macos")]
    let builder = builder.menu(app_menu).on_menu_event(|handle, event| {
        if event.id() == QUIT_MENU_ID {
            window::request_quit(handle);
        }
    });
    let app = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let dir = platform::app_data_dir(app.handle())?;
            app.manage(AppState::new(dir));
            // Buttons and the action handler first: notifications shown before a handler
            // exists report no clicks.
            scheduler::register(app.handle());
            scheduler::start(app.handle().clone());
            commands::start_sync(app.handle());
            tray::setup(app.handle());
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
            commands::parse_recurrence,
            commands::summarize_recurrence,
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
            commands::snooze_reminder,
            commands::pending_reminders,
            commands::notification_permission,
            commands::request_notification_permission,
            commands::show_main_window,
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
        // Closing the main window hides it (kept in the tray / Dock) unless the user turned that
        // off; then it ends the app, after asking about held projects while the page can still
        // ask. See `tray::close_policy`.
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } if label == window::MAIN_WINDOW => tray::on_close_requested(handle, &api),
        // Dock icon click while no window is visible (macOS).
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => window::show_main_window(handle),
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
