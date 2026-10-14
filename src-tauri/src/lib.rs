pub mod commands;
pub mod domain;
pub mod error;
pub mod platform;
pub mod store;

use tauri::{Emitter, Manager};

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
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
        tauri::RunEvent::Exit => {
            if let Some(state) = handle.try_state::<AppState>() {
                state.flush_all();
            }
        }
        _ => {}
    });
}
