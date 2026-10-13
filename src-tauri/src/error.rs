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
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        let message = e.to_string();
        match e.kind() {
            std::io::ErrorKind::PermissionDenied => AppError::Locked { message },
            _ => AppError::Io { message },
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
    }

    #[test]
    fn io_error_mapping() {
        let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert!(matches!(AppError::from(denied), AppError::Locked { .. }));
        let other = std::io::Error::from(std::io::ErrorKind::NotFound);
        assert!(matches!(AppError::from(other), AppError::Io { .. }));
    }
}
