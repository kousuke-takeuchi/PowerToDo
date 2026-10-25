//! Start at login (resident sync spec 2). The OS keeps the registration (a LaunchAgent on
//! macOS, the Run key on Windows, `~/.config/autostart` on Linux, through
//! `tauri-plugin-autostart`); `settings.json` keeps `autostart` so the first launch knows it has
//! not decided yet. After that the OS's state wins: turning it off in the OS settings sticks.
//! Development builds never touch the OS (their executable must not start at login).

use serde::Serialize;
use tauri::AppHandle;

use crate::error::{AppError, AppResult};

/// What start-up does with the saved setting and the OS's registration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutostartAction {
    /// Register with the OS and save `Some(true)` (the first launch with this feature).
    Register,
    /// Save the OS's state as the setting (the user changed it in the OS).
    Adopt(bool),
    /// Nothing to do.
    Keep,
}

pub fn autostart_decision(
    saved: Option<bool>,
    os_enabled: bool,
    dev_build: bool,
) -> AutostartAction {
    if dev_build {
        return AutostartAction::Keep;
    }
    match saved {
        None => AutostartAction::Register,
        Some(s) if s != os_enabled => AutostartAction::Adopt(os_enabled),
        Some(_) => AutostartAction::Keep,
    }
}

/// `autostart_status` / `set_autostart`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutostartDto {
    /// `false` on iPhone (no such thing) and in development builds.
    pub supported: bool,
    pub enabled: bool,
}

#[cfg(desktop)]
const DEV_BUILD: bool = cfg!(debug_assertions);

#[cfg(desktop)]
mod imp {
    use tauri::{AppHandle, Manager};
    use tauri_plugin_autostart::ManagerExt;

    use super::*;
    use crate::commands::AppState;
    use crate::store::paths::AppSettings;

    fn failed(e: impl std::fmt::Display) -> AppError {
        AppError::Io {
            message: format!("ログイン時に起動を設定できませんでした: {e}"),
        }
    }

    fn os_enabled(app: &AppHandle) -> AppResult<bool> {
        app.autolaunch().is_enabled().map_err(failed)
    }

    fn save(app: &AppHandle, enabled: bool) -> AppResult<()> {
        let state = app.state::<AppState>();
        let _writer = state.sync_rt.lock_settings_write();
        let next = AppSettings {
            autostart: Some(enabled),
            ..state.lock_settings().clone()
        };
        next.save(state.app_data_dir())?;
        *state.lock_settings() = next;
        Ok(())
    }

    pub fn status(app: &AppHandle) -> AppResult<AutostartDto> {
        if DEV_BUILD {
            return Ok(AutostartDto {
                supported: false,
                enabled: false,
            });
        }
        Ok(AutostartDto {
            supported: true,
            enabled: os_enabled(app)?,
        })
    }

    pub fn set(app: &AppHandle, enabled: bool) -> AppResult<AutostartDto> {
        if DEV_BUILD {
            return Err(AppError::Invalid {
                message: "開発中のビルドではログイン時の起動を設定しません".into(),
            });
        }
        let launch = app.autolaunch();
        if enabled {
            launch.enable().map_err(failed)?;
        } else {
            launch.disable().map_err(failed)?;
        }
        let now = os_enabled(app)?;
        save(app, now)?;
        Ok(AutostartDto {
            supported: true,
            enabled: now,
        })
    }

    pub fn reconcile(app: &AppHandle) {
        let saved = app.state::<AppState>().lock_settings().autostart;
        let os = match os_enabled(app) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("{e}");
                return;
            }
        };
        let result = match autostart_decision(saved, os, DEV_BUILD) {
            AutostartAction::Keep => Ok(()),
            AutostartAction::Adopt(v) => save(app, v),
            AutostartAction::Register => app
                .autolaunch()
                .enable()
                .map_err(failed)
                .and_then(|()| save(app, true)),
        };
        if let Err(e) = result {
            eprintln!("{e}");
        }
    }
}

#[cfg(mobile)]
mod imp {
    use super::*;

    pub fn status(_app: &AppHandle) -> AppResult<AutostartDto> {
        Ok(AutostartDto {
            supported: false,
            enabled: false,
        })
    }

    pub fn set(_app: &AppHandle, _enabled: bool) -> AppResult<AutostartDto> {
        Err(AppError::Invalid {
            message: "iPhone では使えません".into(),
        })
    }

    pub fn reconcile(_app: &AppHandle) {}
}

/// Runs once after the settings are loaded, off the main thread (the OS calls may block).
pub fn reconcile_at_startup(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || imp::reconcile(&app));
}

#[tauri::command]
pub async fn autostart_status(app: AppHandle) -> AppResult<AutostartDto> {
    tauri::async_runtime::spawn_blocking(move || imp::status(&app))
        .await
        .map_err(|e| AppError::Io {
            message: format!("内部エラー: {e}"),
        })?
}

#[tauri::command]
pub async fn set_autostart(app: AppHandle, enabled: bool) -> AppResult<AutostartDto> {
    tauri::async_runtime::spawn_blocking(move || imp::set(&app, enabled))
        .await
        .map_err(|e| AppError::Io {
            message: format!("内部エラー: {e}"),
        })?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_builds_never_register() {
        for saved in [None, Some(true), Some(false)] {
            for os in [true, false] {
                assert_eq!(autostart_decision(saved, os, true), AutostartAction::Keep);
            }
        }
    }

    #[test]
    fn first_launch_registers() {
        assert_eq!(
            autostart_decision(None, false, false),
            AutostartAction::Register
        );
        assert_eq!(
            autostart_decision(None, true, false),
            AutostartAction::Register
        );
    }

    #[test]
    fn os_choice_wins_after_the_first_launch() {
        assert_eq!(
            autostart_decision(Some(true), false, false),
            AutostartAction::Adopt(false)
        );
        assert_eq!(
            autostart_decision(Some(false), true, false),
            AutostartAction::Adopt(true)
        );
        assert_eq!(
            autostart_decision(Some(true), true, false),
            AutostartAction::Keep
        );
        assert_eq!(
            autostart_decision(Some(false), false, false),
            AutostartAction::Keep
        );
    }
}
