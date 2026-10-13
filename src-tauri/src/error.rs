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

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        let message = e.to_string();
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
