//! A check of the iPhone's scheduled notifications (settings 「通知の確認」): what the OS has in line, and a test one that
//! arrives in 10 seconds through the same path as the reminders. iOS only; elsewhere both say so.

use serde::Serialize;
use tauri::AppHandle;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationCheckDto {
    /// Only the iPhone schedules notifications through the OS.
    pub supported: bool,
    /// `granted`, `denied` or `prompt` (the OS's permission).
    pub permission: String,
    /// How many notifications the OS has scheduled, not yet delivered.
    pub scheduled: usize,
    /// The titles of the first few (nearest first is not promised: the OS lists them as it likes).
    pub titles: Vec<String>,
    /// Why the OS could not be asked.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn notification_check(app: AppHandle) -> AppResult<NotificationCheckDto> {
    #[cfg(target_os = "ios")]
    {
        use tauri_plugin_notification::{NotificationExt, PermissionState};
        let n = app.notification();
        let permission = match n.permission_state() {
            Ok(PermissionState::Granted) => "granted",
            Ok(PermissionState::Denied) => "denied",
            _ => "prompt",
        }
        .to_string();
        return Ok(match n.pending() {
            Ok(list) => NotificationCheckDto {
                supported: true,
                permission,
                scheduled: list.len(),
                titles: list
                    .iter()
                    .take(5)
                    .map(|p| p.title().unwrap_or("").to_string())
                    .collect(),
                error: None,
            },
            Err(e) => NotificationCheckDto {
                supported: true,
                permission,
                scheduled: 0,
                titles: Vec::new(),
                error: Some(e.to_string()),
            },
        });
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Ok(NotificationCheckDto {
            supported: false,
            permission: "granted".into(),
            scheduled: 0,
            titles: Vec::new(),
            error: None,
        })
    }
}

/// Schedules one notification for 10 seconds from now, the way the reminders are scheduled. The answer is whether the OS took it.
#[tauri::command]
pub async fn notification_test(app: AppHandle) -> AppResult<()> {
    #[cfg(target_os = "ios")]
    {
        use tauri_plugin_notification::{NotificationExt, PermissionState, Schedule};
        let n = app.notification();
        if !matches!(n.permission_state(), Ok(PermissionState::Granted))
            && !matches!(n.request_permission(), Ok(PermissionState::Granted))
        {
            return Err(AppError::Invalid {
                message:
                    "通知が許可されていません。iPhone の設定 → PowerToDo → 通知 で許可してください"
                        .into(),
            });
        }
        let at = chrono::Local::now().naive_local() + chrono::Duration::seconds(10);
        let Some(date) = crate::scheduler::plugin_schedule_date(at) else {
            return Err(AppError::Invalid {
                message: "時刻を作れませんでした".into(),
            });
        };
        return n
            .builder()
            .id(2_000_000_000)
            .title("PowerToDo のテスト通知")
            .body("アプリを閉じても、この通知が届けば、リマインダーも届きます")
            .schedule(Schedule::At {
                date,
                repeating: false,
                allow_while_idle: false,
            })
            .show()
            .map_err(|e| AppError::Io {
                message: format!("通知を予約できませんでした: {e}"),
            });
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Err(AppError::Invalid {
            message: "テスト通知は iPhone だけです".into(),
        })
    }
}
