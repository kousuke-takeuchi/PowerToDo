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
    #[error("{0}")]
    Other(String),
}

pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = Result<T, BackendError>> + Send + 'a>>;

pub trait StorageBackend: Send + Sync {
    /// The `*.xlsx` files directly in the root folder (not `archive/`).
    fn list(&self) -> BoxFut<'_, Vec<RemoteFile>>;
    fn download<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, Vec<u8>>;
    /// Writes `bytes` as `name`: over `existing` when given, else as a new file. Returns the
    /// file as the backend now sees it.
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
    modified: NaiveDateTime,
}

#[derive(Default)]
struct Inner {
    next_id: u64,
    /// By id.
    files: BTreeMap<String, Entry>,
    /// `(name, bytes)` of what was moved to `archive/`, oldest first.
    archive: Vec<(String, Vec<u8>)>,
}

/// An in-memory remote for tests. `version` is the SHA-256 of the content and `modified` comes
/// from the clock given to [`MemoryBackend::new`].
pub struct MemoryBackend {
    clock: Box<dyn Fn() -> NaiveDateTime + Send + Sync>,
    inner: Mutex<Inner>,
}

impl MemoryBackend {
    pub fn new(clock: impl Fn() -> NaiveDateTime + Send + Sync + 'static) -> Self {
        MemoryBackend {
            clock: Box::new(clock),
            inner: Mutex::new(Inner::default()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn remote_file(id: &str, e: &Entry) -> RemoteFile {
        RemoteFile {
            id: id.to_string(),
            name: e.name.clone(),
            version: sha256_hex(&e.bytes),
            modified: e.modified,
            size: e.bytes.len() as u64,
        }
    }

    fn put_entry(&self, name: &str, existing_id: Option<&str>, bytes: Vec<u8>, at: NaiveDateTime) {
        let mut inner = self.lock();
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
            let mut files: Vec<RemoteFile> = inner
                .files
                .iter()
                .map(|(id, e)| Self::remote_file(id, e))
                .collect();
            files.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(files)
        })
    }

    fn download<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, Vec<u8>> {
        Box::pin(async move {
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
            let at = (self.clock)();
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
    async fn put_at_sets_the_modified_time() {
        let b = backend();
        b.put_at("a.xlsx", b"a", dt("2026-01-02T03:04:05"));
        assert_eq!(
            b.list().await.unwrap()[0].modified,
            dt("2026-01-02T03:04:05")
        );
    }
}
