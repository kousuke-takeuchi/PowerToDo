pub mod commands;
pub mod domain;
pub mod error;
pub mod platform;
pub mod store;

use tauri::Manager;

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
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        // Edits are written 1 s after the last change; do not lose the last second on quit.
        if let tauri::RunEvent::Exit = event
            && let Some(state) = handle.try_state::<AppState>()
        {
            state.flush_all();
        }
    });
}
