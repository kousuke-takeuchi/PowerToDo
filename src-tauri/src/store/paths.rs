//! Where things live on disk: the data folder layout and the app's own `settings.json`.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::common_book::COMMON_FILE;
use crate::error::{AppError, AppResult};

/// Characters that cannot appear in a project name (it becomes a file name on every OS).
const FORBIDDEN: [char; 9] = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// Marks a sync conflict copy: `<name> (競合 yyyy-mm-dd hhmm).xlsx` (see `sync::conflict_name`).
/// Not allowed in project names, so a project never looks like a conflict copy.
pub(crate) const CONFLICT_MARK: &str = "(競合 ";

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
    if name.contains(CONFLICT_MARK) {
        return invalid("「(競合 」は同期の競合コピーの印なので使えません");
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
    /// Where the data folder is synced to (Phase 4). Per device, so it lives here and not in the
    /// data folder. The NAS password is in the OS keychain, never in this file.
    #[serde(default, skip_serializing_if = "SyncSettings::is_default")]
    pub sync: SyncSettings,
    /// Whether the app looks for a new version by itself. Per device. Left out of the file
    /// while it is the default.
    #[serde(default, skip_serializing_if = "UpdateSettings::is_default")]
    pub updates: UpdateSettings,
}

/// The update part of `settings.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettings {
    /// Check for a new version at launch and once a day. On unless the user turned it off.
    #[serde(default = "yes")]
    pub auto_check: bool,
}

fn yes() -> bool {
    true
}

impl Default for UpdateSettings {
    fn default() -> Self {
        UpdateSettings { auto_check: true }
    }
}

impl UpdateSettings {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

/// Which sync target is chosen. An unknown value (a newer version's) reads as `None`: the sync
/// stays off instead of the whole `settings.json` being rejected.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncBackend {
    #[default]
    None,
    Nas,
    Gdrive,
}

/// The sync part of `settings.json`: the chosen target and the account details that are not
/// secret.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettings {
    #[serde(default, deserialize_with = "lenient_backend")]
    pub backend: SyncBackend,
    /// The WebDAV folder as typed by the user (`http://nas:5005/powertodo/`), without credentials.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nas_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nas_user: Option<String>,
    /// Shown as 「ログイン中: …」 (Google Drive).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub google_email: Option<String>,
}

fn lenient_backend<'de, D: serde::Deserializer<'de>>(d: D) -> Result<SyncBackend, D::Error> {
    // Any value that is not a known target (also a wrong type) means no sync.
    Ok(serde_json::Value::deserialize(d)
        .ok()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

impl SyncSettings {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
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
            ..AppSettings::default()
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

    #[test]
    fn sync_settings_default_to_no_sync_and_stay_out_of_the_file() {
        // An old settings.json (no `sync` key) reads as no sync.
        let old: AppSettings = serde_json::from_str(r#"{"dataDir":"/x"}"#).unwrap();
        assert_eq!(old.sync, SyncSettings::default());
        assert_eq!(old.sync.backend, SyncBackend::None);
        // A default value is not written at all (the file stays as it was before Phase 4).
        let text = serde_json::to_string(&AppSettings::default()).unwrap();
        assert_eq!(text, "{}");
    }

    #[test]
    fn sync_settings_round_trip_with_camel_case_keys() {
        let dir = tempfile::tempdir().unwrap();
        let s = AppSettings {
            data_dir: Some(PathBuf::from("/x/y")),
            sync: SyncSettings {
                backend: SyncBackend::Nas,
                nas_url: Some("http://nas:5005/powertodo/".into()),
                nas_user: Some("たろう".into()),
                google_email: Some("user@example.com".into()),
            },
            ..AppSettings::default()
        };
        s.save(dir.path()).unwrap();
        let v: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join("settings.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(v["sync"]["backend"], "nas");
        assert_eq!(v["sync"]["nasUrl"], "http://nas:5005/powertodo/");
        assert_eq!(v["sync"]["nasUser"], "たろう");
        assert_eq!(v["sync"]["googleEmail"], "user@example.com");
        assert_eq!(AppSettings::load(dir.path()).unwrap(), s);

        // Each target is spelled in lower case.
        for (b, text) in [
            (SyncBackend::None, "none"),
            (SyncBackend::Nas, "nas"),
            (SyncBackend::Gdrive, "gdrive"),
        ] {
            assert_eq!(serde_json::to_string(&b).unwrap(), format!("\"{text}\""));
        }
    }

    #[test]
    fn an_unknown_sync_target_keeps_the_rest_of_the_settings() {
        let s: AppSettings = serde_json::from_str(
            r#"{"dataDir":"/x","sync":{"backend":"dropbox","nasUser":"たろう"}}"#,
        )
        .unwrap();
        assert_eq!(s.data_dir.as_deref(), Some(Path::new("/x")));
        assert_eq!(s.sync.backend, SyncBackend::None);
        assert_eq!(s.sync.nas_user.as_deref(), Some("たろう"));
        // A value of the wrong type is treated the same way.
        let s: AppSettings = serde_json::from_str(r#"{"sync":{"backend":3}}"#).unwrap();
        assert_eq!(s.sync.backend, SyncBackend::None);
    }
}
