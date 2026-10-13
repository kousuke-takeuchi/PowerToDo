//! OS-facing helpers: the app data directory, the folder picker and "open in file manager".

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::error::{AppError, AppResult};

/// Per-user directory for `settings.json` (not the user's data folder).
pub fn app_data_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path().app_data_dir().map_err(|e| AppError::Io {
        message: e.to_string(),
    })
}

/// Native folder picker. `None` when the user cancels. Blocks, so call it off the main thread
/// (async commands already are).
pub fn pick_folder(app: &AppHandle) -> AppResult<Option<String>> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| AppError::Io {
        message: e.to_string(),
    })?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Opens `path` (a folder) in Finder / Explorer / the file manager.
pub fn reveal_path(path: &Path) -> AppResult<()> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| AppError::Io {
        message: e.to_string(),
    })
}
