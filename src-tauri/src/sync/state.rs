//! `sync.json` (spec section 3.1): what the last sync left in place. Kept in the app data dir
//! like `fired.json`: it is this machine's state, tied to one data folder and one sync target.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::store::paths::write_atomic;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackendKind {
    Nas,
    Gdrive,
}

/// Local time with seconds, `YYYY-MM-DDTHH:MM:SS`. Reading also accepts a missing seconds part.
mod secs {
    use chrono::NaiveDateTime;
    use serde::{Deserialize, Deserializer, Serializer};

    const FORMAT: &str = "%Y-%m-%dT%H:%M:%S";

    pub fn serialize<S: Serializer>(v: &NaiveDateTime, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.format(FORMAT).to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<NaiveDateTime, D::Error> {
        let text = String::deserialize(d)?;
        NaiveDateTime::parse_from_str(&text, FORMAT)
            .or_else(|_| NaiveDateTime::parse_from_str(&text, "%Y-%m-%dT%H:%M"))
            .map_err(serde::de::Error::custom)
    }

    pub mod option {
        use super::*;

        pub fn serialize<S: Serializer>(
            v: &Option<NaiveDateTime>,
            s: S,
        ) -> Result<S::Ok, S::Error> {
            match v {
                Some(v) => super::serialize(v, s),
                None => s.serialize_none(),
            }
        }

        pub fn deserialize<'de, D: Deserializer<'de>>(
            d: D,
        ) -> Result<Option<NaiveDateTime>, D::Error> {
            #[derive(Deserialize)]
            struct Wrap(#[serde(with = "super")] NaiveDateTime);
            Ok(Option::<Wrap>::deserialize(d)?.map(|w| w.0))
        }
    }
}

/// What was in place after the last sync of one file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRecord {
    pub remote_id: String,
    /// The remote `version` seen then (etag / md5 / ...).
    pub remote_version: String,
    #[serde(with = "secs")]
    pub remote_modified: NaiveDateTime,
    /// SHA-256 of the local file then.
    pub local_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub data_dir: PathBuf,
    pub backend: BackendKind,
    /// What the target was set up as: the WebDAV URL, or `gdrive:<account>`.
    pub remote_root: String,
    /// The root folder the records are about, for a backend that finds it by searching
    /// (`StorageBackend::root_identity`: the Drive folder id). `None` until one was listed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_root_id: Option<String>,
    #[serde(default, with = "secs::option")]
    pub last_sync: Option<NaiveDateTime>,
    /// By file name.
    #[serde(default)]
    pub files: BTreeMap<String, FileRecord>,
}

impl SyncState {
    pub const FILE: &'static str = "sync.json";

    pub fn new(data_dir: &Path, backend: BackendKind, remote_root: &str) -> Self {
        SyncState {
            data_dir: data_dir.to_path_buf(),
            backend,
            remote_root: remote_root.to_string(),
            remote_root_id: None,
            last_sync: None,
            files: BTreeMap::new(),
        }
    }

    /// The saved state, or a fresh one when the file is missing or unreadable, or when it
    /// belongs to another data folder, backend or remote root (the records would be wrong there).
    pub fn load(
        app_data_dir: &Path,
        data_dir: &Path,
        backend: BackendKind,
        remote_root: &str,
    ) -> Self {
        let path = app_data_dir.join(Self::FILE);
        let saved = match std::fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<SyncState>(&text) {
                Ok(s) => Some(s),
                Err(e) => {
                    eprintln!("{} is not readable, starting fresh: {e}", path.display());
                    None
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => {
                eprintln!("{} is not readable, starting fresh: {e}", path.display());
                None
            }
        };
        match saved {
            Some(s)
                if s.data_dir == data_dir
                    && s.backend == backend
                    && s.remote_root == remote_root =>
            {
                s
            }
            _ => Self::new(data_dir, backend, remote_root),
        }
    }

    /// The `lastSync` of the saved state when it belongs to this backend and remote root (the
    /// data folder is not known yet at start-up). For showing the last sync time early.
    pub fn peek_last_sync(
        app_data_dir: &Path,
        backend: BackendKind,
        remote_root: &str,
    ) -> Option<NaiveDateTime> {
        let text = std::fs::read_to_string(app_data_dir.join(Self::FILE)).ok()?;
        let s: SyncState = serde_json::from_str(&text).ok()?;
        (s.backend == backend && s.remote_root == remote_root)
            .then_some(s.last_sync)
            .flatten()
    }

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

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").unwrap()
    }

    fn sample(dir: &Path) -> SyncState {
        let mut s = SyncState::new(dir, BackendKind::Nas, "http://nas:5005/powertodo/");
        s.last_sync = Some(dt("2026-10-16T09:30:05"));
        s.files.insert(
            "受信トレイ.xlsx".into(),
            FileRecord {
                remote_id: "id1".into(),
                remote_version: "etag1".into(),
                remote_modified: dt("2026-10-16T09:29:00"),
                local_hash: "abc".into(),
            },
        );
        s
    }

    #[test]
    fn round_trip() {
        let app = tempfile::tempdir().unwrap();
        let s = sample(Path::new("/data"));
        s.save(app.path()).unwrap();
        let back = SyncState::load(
            app.path(),
            Path::new("/data"),
            BackendKind::Nas,
            "http://nas:5005/powertodo/",
        );
        assert_eq!(back, s);
    }

    #[test]
    fn json_shape_matches_the_spec() {
        let app = tempfile::tempdir().unwrap();
        sample(Path::new("/data")).save(app.path()).unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(app.path().join("sync.json")).unwrap())
                .unwrap();
        assert_eq!(v["dataDir"], "/data");
        assert_eq!(v["backend"], "nas");
        assert_eq!(v["remoteRoot"], "http://nas:5005/powertodo/");
        assert_eq!(v["lastSync"], "2026-10-16T09:30:05");
        let rec = &v["files"]["受信トレイ.xlsx"];
        assert_eq!(rec["remoteId"], "id1");
        assert_eq!(rec["remoteVersion"], "etag1");
        assert_eq!(rec["remoteModified"], "2026-10-16T09:29:00");
        assert_eq!(rec["localHash"], "abc");
    }

    #[test]
    fn missing_file_is_fresh() {
        let app = tempfile::tempdir().unwrap();
        let s = SyncState::load(
            app.path(),
            Path::new("/data"),
            BackendKind::Gdrive,
            "folder",
        );
        assert_eq!(
            s,
            SyncState::new(Path::new("/data"), BackendKind::Gdrive, "folder")
        );
        assert!(s.files.is_empty());
        assert!(s.last_sync.is_none());
    }

    #[test]
    fn corrupt_file_is_fresh() {
        let app = tempfile::tempdir().unwrap();
        std::fs::write(app.path().join("sync.json"), "{ not json").unwrap();
        let s = SyncState::load(app.path(), Path::new("/data"), BackendKind::Nas, "u");
        assert!(s.files.is_empty());
        // A well-formed file with an unknown backend is just as unusable.
        std::fs::write(
            app.path().join("sync.json"),
            r#"{"dataDir":"/data","backend":"ftp","remoteRoot":"u","files":{}}"#,
        )
        .unwrap();
        let s = SyncState::load(app.path(), Path::new("/data"), BackendKind::Nas, "u");
        assert!(s.files.is_empty());
    }

    #[test]
    fn different_data_dir_backend_or_root_starts_fresh() {
        let app = tempfile::tempdir().unwrap();
        sample(Path::new("/data")).save(app.path()).unwrap();
        let root = "http://nas:5005/powertodo/";
        let other_dir = SyncState::load(app.path(), Path::new("/other"), BackendKind::Nas, root);
        assert_eq!(
            other_dir,
            SyncState::new(Path::new("/other"), BackendKind::Nas, root)
        );
        let other_backend =
            SyncState::load(app.path(), Path::new("/data"), BackendKind::Gdrive, root);
        assert!(other_backend.files.is_empty());
        assert_eq!(other_backend.backend, BackendKind::Gdrive);
        let other_root = SyncState::load(
            app.path(),
            Path::new("/data"),
            BackendKind::Nas,
            "http://x/",
        );
        assert!(other_root.files.is_empty());
        assert_eq!(other_root.remote_root, "http://x/");
    }

    #[test]
    fn save_creates_the_app_data_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let app = tmp.path().join("not-yet");
        sample(Path::new("/data")).save(&app).unwrap();
        assert!(app.join("sync.json").is_file());
    }

    #[test]
    fn last_sync_may_be_absent_and_minutes_only_is_accepted() {
        let app = tempfile::tempdir().unwrap();
        std::fs::write(
            app.path().join("sync.json"),
            r#"{"dataDir":"/data","backend":"nas","remoteRoot":"u","lastSync":"2026-10-16T09:30",
               "files":{"a.xlsx":{"remoteId":"1","remoteVersion":"v","remoteModified":"2026-10-16T09:00","localHash":"h"}}}"#,
        )
        .unwrap();
        let s = SyncState::load(app.path(), Path::new("/data"), BackendKind::Nas, "u");
        assert_eq!(s.last_sync, Some(dt("2026-10-16T09:30:00")));
        assert_eq!(s.files["a.xlsx"].remote_modified, dt("2026-10-16T09:00:00"));
    }
}
