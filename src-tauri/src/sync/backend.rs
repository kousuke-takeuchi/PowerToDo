//! The remote side of the sync (spec section 3): a folder of `*.xlsx` files on a NAS (WebDAV) or
//! in Google Drive. The sync engine only sees [`StorageBackend`]; [`MemoryBackend`] stands in
//! for it in tests.
//!
//! The trait methods return boxed futures instead of being `async fn`, so the engine can hold an
//! `Arc<dyn StorageBackend>` (an `async fn` in a trait is not dyn compatible).

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;

use chrono::NaiveDateTime;

use super::sha256_hex;

/// A file in the remote root folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFile {
    /// What the backend needs to address the file again (a WebDAV href, a Drive file id).
    pub id: String,
    pub name: String,
    /// Opaque change marker: it differs whenever the content differs (etag, md5, ...).
    pub version: String,
    /// Last modification in local time (the backend converts).
    pub modified: NaiveDateTime,
    pub size: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("認証に失敗しました")]
    Auth,
    #[error("容量が足りません")]
    Full,
    #[error("権限がありません")]
    Forbidden,
    #[error("接続できません: {0}")]
    Offline(String),
    /// An upload's precondition failed: the remote file changed (or appeared) since it was
    /// listed. Nothing was written.
    #[error("同期先が先に更新されました")]
    Precondition,
    #[error("{0}")]
    Other(String),
}

pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = Result<T, BackendError>> + Send + 'a>>;

pub trait StorageBackend: Send + Sync {
    /// The `*.xlsx` files directly in the root folder (not `archive/`).
    ///
    /// The listing is complete or it is an `Err`, never partial (follow every page; fail when a
    /// page cannot be read): `plan` reads a file missing from the listing as deleted.
    fn list(&self) -> BoxFut<'_, Vec<RemoteFile>>;
    fn download<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, Vec<u8>>;
    /// Writes `bytes` as `name`: over `existing` when given, else as a new file. Returns the
    /// file as the backend now sees it.
    ///
    /// Conditional, so a concurrent upload from another PC is never overwritten: with
    /// `existing`, only while the remote file still has `existing.version` (WebDAV `If-Match`;
    /// Drive checks the version right before the update); without it, only when no file of
    /// that name exists (`If-None-Match: *`). Otherwise [`BackendError::Precondition`] and
    /// nothing is written.
    fn upload<'a>(
        &'a self,
        name: &'a str,
        existing: Option<&'a RemoteFile>,
        bytes: Vec<u8>,
    ) -> BoxFut<'a, RemoteFile>;
    /// Moves the file to `archive/` in the root folder (nothing is deleted for good).
    fn move_to_archive<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, ()>;
}

struct Entry {
    name: String,
    bytes: Vec<u8>,
    version: String,
    modified: NaiveDateTime,
}

/// An error a [`MemoryBackend`] can be told to return.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    Offline,
    Auth,
    Full,
}

impl Failure {
    fn error(self) -> BackendError {
        match self {
            Failure::Offline => BackendError::Offline("injected".into()),
            Failure::Auth => BackendError::Auth,
            Failure::Full => BackendError::Full,
        }
    }
}

#[derive(Default)]
struct Inner {
    next_id: u64,
    /// Counter behind the etag-like versions of `opaque_versions`.
    next_etag: u64,
    /// By name: `download`, `upload` and `move_to_archive` of that name fail.
    failures: BTreeMap<String, Failure>,
    /// `list` fails.
    list_failure: Option<Failure>,
    /// By name: the next `upload` of that name first finds these bytes written by "another
    /// PC" (see `race_upload`).
    races: BTreeMap<String, Vec<u8>>,
    /// By id.
    files: BTreeMap<String, Entry>,
    /// `(name, bytes)` of what was moved to `archive/`, oldest first.
    archive: Vec<(String, Vec<u8>)>,
}

/// An in-memory remote for tests. `version` is the SHA-256 of the content (or, with
/// [`MemoryBackend::opaque_versions`], a counter-based etag that changes on every write) and
/// `modified` comes from the clock given to [`MemoryBackend::new`].
pub struct MemoryBackend {
    clock: Box<dyn Fn() -> NaiveDateTime + Send + Sync>,
    opaque: bool,
    inner: Mutex<Inner>,
}

impl MemoryBackend {
    pub fn new(clock: impl Fn() -> NaiveDateTime + Send + Sync + 'static) -> Self {
        MemoryBackend {
            clock: Box::new(clock),
            opaque: false,
            inner: Mutex::new(Inner::default()),
        }
    }

    /// Versions become `etag-<n>`, new on every write even when the content stays the same, like
    /// a real etag: nothing can be derived from them.
    pub fn opaque_versions(mut self) -> Self {
        self.opaque = true;
        self
    }

    /// `download` / `upload` / `move_to_archive` of `name` return `failure` from now on.
    pub fn fail(&self, name: &str, failure: Failure) {
        self.lock().failures.insert(name.to_string(), failure);
    }

    /// `list` returns `failure` from now on.
    pub fn fail_list(&self, failure: Failure) {
        self.lock().list_failure = Some(failure);
    }

    /// The next `upload` of `name` meets a concurrent upload: right before it, `bytes` land on
    /// the remote as if another PC had written them, so the precondition fails.
    pub fn race_upload(&self, name: &str, bytes: &[u8]) {
        self.lock().races.insert(name.to_string(), bytes.to_vec());
    }

    /// Ends every injected failure.
    pub fn clear_failures(&self) {
        let mut inner = self.lock();
        inner.failures.clear();
        inner.list_failure = None;
    }

    fn check(&self, name: &str) -> Result<(), BackendError> {
        match self.lock().failures.get(name) {
            Some(f) => Err(f.error()),
            None => Ok(()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn remote_file(id: &str, e: &Entry) -> RemoteFile {
        RemoteFile {
            id: id.to_string(),
            name: e.name.clone(),
            version: e.version.clone(),
            modified: e.modified,
            size: e.bytes.len() as u64,
        }
    }

    fn put_entry(&self, name: &str, existing_id: Option<&str>, bytes: Vec<u8>, at: NaiveDateTime) {
        let mut inner = self.lock();
        let version = if self.opaque {
            inner.next_etag += 1;
            format!("etag-{}", inner.next_etag)
        } else {
            sha256_hex(&bytes)
        };
        let id = existing_id
            .filter(|id| inner.files.contains_key(*id))
            .map(str::to_string)
            .or_else(|| {
                inner
                    .files
                    .iter()
                    .find(|(_, e)| e.name == name)
                    .map(|(id, _)| id.clone())
            })
            .unwrap_or_else(|| {
                inner.next_id += 1;
                format!("mem-{}", inner.next_id)
            });
        inner.files.insert(
            id,
            Entry {
                name: name.to_string(),
                bytes,
                version,
                modified: at,
            },
        );
    }

    /// Test setup: a file appears (or changes) on the remote, stamped with the clock.
    pub fn put(&self, name: &str, bytes: &[u8]) {
        self.put_entry(name, None, bytes.to_vec(), (self.clock)());
    }

    /// Test setup: like [`MemoryBackend::put`] with an explicit modification time.
    pub fn put_at(&self, name: &str, bytes: &[u8], at: NaiveDateTime) {
        self.put_entry(name, None, bytes.to_vec(), at);
    }

    /// Test setup: the file disappears from the root (not archived). `true` when it existed.
    pub fn remove(&self, name: &str) -> bool {
        let mut inner = self.lock();
        let id = inner
            .files
            .iter()
            .find(|(_, e)| e.name == name)
            .map(|(id, _)| id.clone());
        id.is_some_and(|id| inner.files.remove(&id).is_some())
    }

    /// The content of the root file `name`.
    pub fn get(&self, name: &str) -> Option<Vec<u8>> {
        self.lock()
            .files
            .values()
            .find(|e| e.name == name)
            .map(|e| e.bytes.clone())
    }

    /// `(name, bytes)` of the files moved to `archive/`, oldest first.
    pub fn archived(&self) -> Vec<(String, Vec<u8>)> {
        self.lock().archive.clone()
    }
}

impl StorageBackend for MemoryBackend {
    fn list(&self) -> BoxFut<'_, Vec<RemoteFile>> {
        Box::pin(async move {
            let inner = self.lock();
            if let Some(f) = inner.list_failure {
                return Err(f.error());
            }
            let mut files: Vec<RemoteFile> = inner
                .files
                .iter()
                .filter(|(_, e)| e.name.to_lowercase().ends_with(".xlsx"))
                .map(|(id, e)| Self::remote_file(id, e))
                .collect();
            files.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(files)
        })
    }

    fn download<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, Vec<u8>> {
        Box::pin(async move {
            self.check(&file.name)?;
            self.lock()
                .files
                .get(&file.id)
                .map(|e| e.bytes.clone())
                .ok_or_else(|| BackendError::Other(format!("{} が見つかりません", file.name)))
        })
    }

    fn upload<'a>(
        &'a self,
        name: &'a str,
        existing: Option<&'a RemoteFile>,
        bytes: Vec<u8>,
    ) -> BoxFut<'a, RemoteFile> {
        Box::pin(async move {
            self.check(name)?;
            let at = (self.clock)();
            let race = self.lock().races.remove(name);
            if let Some(theirs) = race {
                self.put_entry(name, None, theirs, at);
            }
            {
                let inner = self.lock();
                let unchanged = match existing {
                    Some(f) => inner
                        .files
                        .get(&f.id)
                        .is_some_and(|e| e.version == f.version && e.name == f.name),
                    None => !inner.files.values().any(|e| e.name == name),
                };
                if !unchanged {
                    return Err(BackendError::Precondition);
                }
            }
            self.put_entry(name, existing.map(|f| f.id.as_str()), bytes, at);
            let inner = self.lock();
            inner
                .files
                .iter()
                .find(|(_, e)| e.name == name)
                .map(|(id, e)| Self::remote_file(id, e))
                .ok_or_else(|| BackendError::Other("upload failed".into()))
        })
    }

    fn move_to_archive<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, ()> {
        Box::pin(async move {
            self.check(&file.name)?;
            let mut inner = self.lock();
            let entry = inner
                .files
                .remove(&file.id)
                .ok_or_else(|| BackendError::Other(format!("{} が見つかりません", file.name)))?;
            inner.archive.push((entry.name, entry.bytes));
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").unwrap()
    }

    fn backend() -> MemoryBackend {
        MemoryBackend::new(|| dt("2026-10-16T09:30:00"))
    }

    #[tokio::test]
    async fn upload_list_download_round_trip() {
        let b: Arc<dyn StorageBackend> = Arc::new(backend());
        let f = b.upload("a.xlsx", None, b"one".to_vec()).await.unwrap();
        assert_eq!(f.name, "a.xlsx");
        assert_eq!(f.version, sha256_hex(b"one"));
        assert_eq!(f.modified, dt("2026-10-16T09:30:00"));
        assert_eq!(f.size, 3);
        let list = b.list().await.unwrap();
        assert_eq!(list, vec![f.clone()]);
        assert_eq!(b.download(&f).await.unwrap(), b"one");
    }

    #[tokio::test]
    async fn upload_over_existing_keeps_id_and_changes_version() {
        let b = backend();
        let first = b.upload("a.xlsx", None, b"one".to_vec()).await.unwrap();
        let second = b
            .upload("a.xlsx", Some(&first), b"two".to_vec())
            .await
            .unwrap();
        assert_eq!(second.id, first.id);
        assert_ne!(second.version, first.version);
        assert_eq!(b.list().await.unwrap().len(), 1);
        assert_eq!(b.get("a.xlsx").unwrap(), b"two");
    }

    #[tokio::test]
    async fn list_is_sorted_by_name() {
        let b = backend();
        b.put("b.xlsx", b"b");
        b.put("a.xlsx", b"a");
        let names: Vec<String> = b
            .list()
            .await
            .unwrap()
            .into_iter()
            .map(|f| f.name)
            .collect();
        assert_eq!(names, ["a.xlsx", "b.xlsx"]);
    }

    #[tokio::test]
    async fn move_to_archive_removes_from_root() {
        let b = backend();
        b.put("a.xlsx", b"a");
        let f = b.list().await.unwrap().remove(0);
        b.move_to_archive(&f).await.unwrap();
        assert!(b.list().await.unwrap().is_empty());
        assert_eq!(b.archived(), vec![("a.xlsx".to_string(), b"a".to_vec())]);
        assert!(matches!(
            b.move_to_archive(&f).await,
            Err(BackendError::Other(_))
        ));
        assert!(matches!(b.download(&f).await, Err(BackendError::Other(_))));
    }

    #[tokio::test]
    async fn upload_is_conditional() {
        let b = backend();
        let first = b.upload("a.xlsx", None, b"one".to_vec()).await.unwrap();
        // Creating over an existing file is refused.
        assert!(matches!(
            b.upload("a.xlsx", None, b"x".to_vec()).await,
            Err(BackendError::Precondition)
        ));
        // Another PC wrote since `first` was seen: refused, their bytes stay.
        b.put("a.xlsx", b"theirs");
        assert!(matches!(
            b.upload("a.xlsx", Some(&first), b"mine".to_vec()).await,
            Err(BackendError::Precondition)
        ));
        assert_eq!(b.get("a.xlsx").unwrap(), b"theirs");
        // A raced upload fails the same way.
        let now = b.list().await.unwrap().remove(0);
        b.race_upload("a.xlsx", b"raced");
        assert!(matches!(
            b.upload("a.xlsx", Some(&now), b"mine".to_vec()).await,
            Err(BackendError::Precondition)
        ));
        assert_eq!(b.get("a.xlsx").unwrap(), b"raced");
        let now = b.list().await.unwrap().remove(0);
        b.upload("a.xlsx", Some(&now), b"mine".to_vec())
            .await
            .unwrap();
        assert_eq!(b.get("a.xlsx").unwrap(), b"mine");
    }

    #[tokio::test]
    async fn put_at_sets_the_modified_time() {
        let b = backend();
        b.put_at("a.xlsx", b"a", dt("2026-01-02T03:04:05"));
        assert_eq!(
            b.list().await.unwrap()[0].modified,
            dt("2026-01-02T03:04:05")
        );
    }

    #[tokio::test]
    async fn list_only_shows_xlsx_files() {
        let b = backend();
        b.put("a.xlsx", b"a");
        b.put("notes.txt", b"t");
        let names: Vec<String> = b
            .list()
            .await
            .unwrap()
            .into_iter()
            .map(|f| f.name)
            .collect();
        assert_eq!(names, ["a.xlsx"]);
    }

    #[tokio::test]
    async fn opaque_versions_change_on_every_write() {
        let b = backend().opaque_versions();
        let first = b.upload("a.xlsx", None, b"one".to_vec()).await.unwrap();
        assert_ne!(first.version, sha256_hex(b"one"));
        let same = b
            .upload("a.xlsx", Some(&first), b"one".to_vec())
            .await
            .unwrap();
        assert_ne!(same.version, first.version);
        b.put("b.xlsx", b"one");
        let listed = b.list().await.unwrap();
        assert_eq!(listed[0].version, same.version);
        assert_ne!(listed[1].version, same.version);
    }

    #[tokio::test]
    async fn failures_are_injected_per_name_and_can_be_cleared() {
        let b = backend();
        b.put("a.xlsx", b"a");
        b.put("b.xlsx", b"b");
        let files = b.list().await.unwrap();
        b.fail("a.xlsx", Failure::Offline);
        assert!(matches!(
            b.download(&files[0]).await,
            Err(BackendError::Offline(_))
        ));
        assert!(matches!(
            b.upload("a.xlsx", Some(&files[0]), vec![]).await,
            Err(BackendError::Offline(_))
        ));
        assert!(matches!(
            b.move_to_archive(&files[0]).await,
            Err(BackendError::Offline(_))
        ));
        // Other names are fine, and nothing changed on the failed ones.
        assert_eq!(b.download(&files[1]).await.unwrap(), b"b");
        assert_eq!(b.get("a.xlsx").unwrap(), b"a");
        b.fail("b.xlsx", Failure::Full);
        assert!(matches!(
            b.upload("b.xlsx", None, vec![]).await,
            Err(BackendError::Full)
        ));
        b.fail_list(Failure::Auth);
        assert!(matches!(b.list().await, Err(BackendError::Auth)));
        b.clear_failures();
        assert_eq!(b.list().await.unwrap().len(), 2);
        assert_eq!(b.download(&files[0]).await.unwrap(), b"a");
    }
}
