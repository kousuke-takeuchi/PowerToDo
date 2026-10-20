//! OS-facing helpers: the app data directory, the folder picker and "open in file manager".

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

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
    // The dialog plugin has no folder picker on mobile (`blocking_pick_folder` is
    // cfg(desktop)): acts like a cancel.
    #[cfg(mobile)]
    {
        let _ = app;
        Ok(None)
    }
    #[cfg(desktop)]
    {
        let Some(picked) = app.dialog().file().blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|e| AppError::Io {
            message: e.to_string(),
        })?;
        Ok(Some(path.to_string_lossy().into_owned()))
    }
}

/// Opens `path` (a folder) in Finder / Explorer / the file manager. On iPhone there is no such
/// thing to open.
pub fn reveal_path(app: &AppHandle, path: &Path) -> AppResult<()> {
    #[cfg(mobile)]
    {
        let _ = (app, path);
        Err(AppError::Invalid {
            message: "iPhone では「ファイル」アプリで開いてください".into(),
        })
    }
    #[cfg(desktop)]
    {
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|e| AppError::Io {
                message: e.to_string(),
            })
    }
}

/// Opens `url` in the default browser. Through the plugin's handle: on iOS the free function
/// `tauri_plugin_opener::open_url` fails with `os error 2` (it spawns a desktop opener).
pub fn open_url(app: &AppHandle, url: &str) -> AppResult<()> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::Io {
            message: e.to_string(),
        })
}

/// What the page needs to know about the OS it runs on.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: &'static str,
    pub mobile: bool,
}

impl PlatformInfo {
    pub fn current() -> Self {
        PlatformInfo {
            os: std::env::consts::OS,
            mobile: cfg!(mobile),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_info_reports_the_build_target() {
        let info = PlatformInfo::current();
        assert_eq!(info.os, std::env::consts::OS);
        assert_eq!(info.mobile, cfg!(mobile));
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["mobile"], serde_json::json!(cfg!(mobile)));
    }
}
