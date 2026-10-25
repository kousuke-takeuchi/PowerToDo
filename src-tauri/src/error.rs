use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AppError {
    #[error("{message}")]
    NotFound { message: String },
    #[error("{message}")]
    Invalid { message: String },
    #[error("{message}")]
    Io { message: String },
    #[error("{message}")]
    Locked { message: String },
    #[error("{message}")]
    Corrupt { message: String },
    /// The operation would drop unsaved in-memory edits (e.g. `reload_project` without
    /// `discard`). The UI asks the user and retries.
    #[error("{message}")]
    Unsaved { message: String },
}

/// The text for a write the OS refused (Windows `ERROR_ACCESS_DENIED`). On a folder the user can
/// write to, the usual cause is a security product stopping an app it does not know: Avast's
/// ransomware shield, or Windows' Controlled Folder Access. `original` is kept at the end.
pub fn access_denied_message(original: &str) -> String {
    format!(
        "書き込みが拒否されました。セキュリティソフト (Avast のランサムウェア対策や、Windows の「コントロールされたフォルダー アクセス」など) が PowerToDo を止めている可能性があります。PowerToDo を許可するか、別のフォルダを選んでください。({original})"
    )
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        let mut message = e.to_string();
        // 5: Windows ERROR_ACCESS_DENIED (EIO elsewhere, so only on Windows).
        if cfg!(windows) && e.raw_os_error() == Some(5) {
            message = access_denied_message(&message);
        }
        // 32 / 33: Windows ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION (file open in Excel).
        // The codes mean something else on other platforms but are never produced for these
        // operations there.
        if e.kind() == std::io::ErrorKind::PermissionDenied
            || matches!(e.raw_os_error(), Some(32 | 33))
        {
            AppError::Locked { message }
        } else {
            AppError::Io { message }
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_kind_tag() {
        let json = serde_json::to_string(&AppError::Invalid {
            message: "x".into(),
        })
        .unwrap();
        assert_eq!(json, r#"{"kind":"invalid","message":"x"}"#);
        let json = serde_json::to_string(&AppError::Unsaved {
            message: "y".into(),
        })
        .unwrap();
        assert_eq!(json, r#"{"kind":"unsaved","message":"y"}"#);
    }

    #[test]
    fn io_error_mapping() {
        let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert!(matches!(AppError::from(denied), AppError::Locked { .. }));
        let other = std::io::Error::from(std::io::ErrorKind::NotFound);
        assert!(matches!(AppError::from(other), AppError::Io { .. }));
    }

    #[test]
    fn access_denied_message_points_at_security_software() {
        let m = access_denied_message("アクセスが拒否されました。 (os error 5)");
        assert!(m.contains("セキュリティソフト"), "{m}");
        assert!(m.contains("許可"), "{m}");
        assert!(
            m.ends_with("(アクセスが拒否されました。 (os error 5))"),
            "{m}"
        );
    }

    /// Windows ERROR_ACCESS_DENIED: a security product (Avast's ransomware shield, Windows'
    /// Controlled Folder Access) refusing an unsigned app is the usual cause on a fresh folder.
    #[cfg(windows)]
    #[test]
    fn windows_access_denied_explains_the_likely_cause() {
        let e = std::io::Error::from_raw_os_error(5);
        match AppError::from(e) {
            AppError::Locked { message } => {
                assert!(message.contains("セキュリティソフト"), "{message}")
            }
            other => panic!("expected Locked, got {other:?}"),
        }
    }

    /// The same number is EIO on macOS / Linux: no hint there.
    #[cfg(unix)]
    #[test]
    fn os_error_5_elsewhere_is_left_alone() {
        let e = std::io::Error::from_raw_os_error(5);
        assert!(!AppError::from(e).to_string().contains("セキュリティソフト"));
    }

    #[test]
    fn windows_sharing_violation_codes_are_locked() {
        for code in [32, 33] {
            let e = std::io::Error::from_raw_os_error(code);
            assert!(
                matches!(AppError::from(e), AppError::Locked { .. }),
                "os error {code}"
            );
        }
    }
}
