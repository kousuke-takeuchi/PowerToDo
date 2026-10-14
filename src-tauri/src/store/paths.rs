//! Where things live on disk: the data folder layout and the app's own `settings.json`.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::common_book::COMMON_FILE;
use crate::error::{AppError, AppResult};

/// Characters that cannot appear in a project name (it becomes a file name on every OS).
const FORBIDDEN: [char; 9] = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Layout of the data folder: `_PowerToDo.xlsx`, `<project>.xlsx` and `archive/`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paths {
    pub data_dir: PathBuf,
}

impl Paths {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Paths {
            data_dir: data_dir.into(),
        }
    }

    pub fn common(&self) -> PathBuf {
        self.data_dir.join(COMMON_FILE)
    }

    /// `<data_dir>/<name>.xlsx`. Rejects names that are not safe file names: empty, only dots,
    /// leading / trailing space, trailing dot, control characters, any of `/ \ : * ? " < > |`,
    /// or the common workbook's own name.
    pub fn project(&self, name: &str) -> AppResult<PathBuf> {
        validate_project_name(name)?;
        Ok(self.data_dir.join(format!("{name}.xlsx")))
    }

    pub fn archive_dir(&self) -> PathBuf {
        self.data_dir.join("archive")
    }
}

pub fn validate_project_name(name: &str) -> AppResult<()> {
    let invalid = |why: &str| {
        Err(AppError::Invalid {
            message: format!("プロジェクト名「{name}」は使えません ({why})"),
        })
    };
    if name.trim().is_empty() || name.chars().all(|c| c == '.') {
        return invalid("空、または . だけです");
    }
    if name.trim() != name || name.ends_with('.') {
        return invalid("前後の空白や末尾の . は使えません");
    }
    if let Some(c) = name
        .chars()
        .find(|c| FORBIDDEN.contains(c) || c.is_control())
    {
        return invalid(&format!("{c:?} は使えません"));
    }
    if name.eq_ignore_ascii_case(COMMON_FILE.trim_end_matches(".xlsx")) {
        return invalid("共通ファイルと同じ名前です");
    }
    Ok(())
}

/// Writes `bytes` to a temp file in the target directory and renames it over `path`.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let dir = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    let mut tmp = tempfile::Builder::new()
        .prefix(".powertodo-")
        .suffix(".tmp")
        .tempfile_in(dir)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| AppError::from(e.error))?;
    Ok(())
}

/// The app's own settings, kept in `<app_data_dir>/settings.json` (not in the data folder, so
/// it can say where the data folder is).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_dir: Option<PathBuf>,
}

impl AppSettings {
    pub const FILE: &'static str = "settings.json";

    /// Defaults when the file does not exist yet; `Corrupt` when it exists but is not valid.
    pub fn load(app_data_dir: &Path) -> AppResult<Self> {
        let text = match std::fs::read_to_string(app_data_dir.join(Self::FILE)) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(e.into()),
        };
        serde_json::from_str(&text).map_err(|e| AppError::Corrupt {
            message: format!("{} を読めません: {e}", Self::FILE),
        })
    }

    /// Creates `app_data_dir` if needed.
    pub fn save(&self, app_data_dir: &Path) -> AppResult<()> {
        std::fs::create_dir_all(app_data_dir)?;
        let json = serde_json::to_string_pretty(self).map_err(|e| AppError::Io {
            message: e.to_string(),
        })?;
        write_atomic(&app_data_dir.join(Self::FILE), json.as_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;

    #[test]
    fn paths_reject_bad_names() {
        let p = Paths::new("/data");
        for bad in [
            "",
            " ",
            ".",
            "..",
            "a/b",
            "a\\b",
            "a:b",
            "a*b",
            "a?b",
            "a\"b",
            "<a>",
            "a|b",
            " a",
            "a ",
            "a.",
            "_PowerToDo",
            "a\nb",
        ] {
            assert!(
                matches!(p.project(bad), Err(AppError::Invalid { .. })),
                "{bad:?} should be rejected"
            );
        }
        assert_eq!(p.project("仕事").unwrap(), PathBuf::from("/data/仕事.xlsx"));
        assert_eq!(
            p.project("a b.c").unwrap(),
            PathBuf::from("/data/a b.c.xlsx")
        );
        assert_eq!(p.common(), PathBuf::from("/data/_PowerToDo.xlsx"));
        assert_eq!(p.archive_dir(), PathBuf::from("/data/archive"));
    }

    #[test]
    fn app_settings_load_save() {
        let dir = tempfile::tempdir().unwrap();
        // Missing file and missing directory: defaults.
        let missing = dir.path().join("nope");
        assert_eq!(AppSettings::load(&missing).unwrap(), AppSettings::default());

        // Save creates the directory; JSON key is camelCase.
        let s = AppSettings {
            data_dir: Some(PathBuf::from("/x/y")),
        };
        s.save(&missing).unwrap();
        let text = std::fs::read_to_string(missing.join("settings.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v["dataDir"], "/x/y");
        assert_eq!(AppSettings::load(&missing).unwrap(), s);

        // Default (no data dir) round-trips too.
        AppSettings::default().save(&missing).unwrap();
        assert_eq!(AppSettings::load(&missing).unwrap(), AppSettings::default());

        // Broken JSON is reported, not silently replaced.
        std::fs::write(missing.join("settings.json"), "{not json").unwrap();
        assert!(matches!(
            AppSettings::load(&missing),
            Err(AppError::Corrupt { .. })
        ));
    }
}
