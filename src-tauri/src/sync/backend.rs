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
    /// Which folder the last successful [`StorageBackend::list`] read, when the backend finds
    /// its root folder by searching (Google Drive: the folder id) and so may land on another
    /// one than before. `None` when the root is fixed by the address (WebDAV, memory). The
    /// engine forgets its records when this changes: they describe another folder.
    fn root_identity(&self) -> Option<String> {
        None
    }

    // ---- the `_comments` folder (spec ① §3.4). Names are the leaf names (`仕事.12.jsonl`). ----

    /// The `*.jsonl` files directly in `_comments/`, `None` when the target has no such folder (it
    /// is made on the first upload and stays, so a missing one was never made or was wiped).
    /// Complete or `Err`, like [`StorageBackend::list`].
    fn list_comments(&self) -> BoxFut<'_, Option<Vec<RemoteFile>>> {
        Box::pin(async { Ok(None) })
    }
    /// [`StorageBackend::upload`] inside `_comments/` (the folder is created when needed).
    fn upload_comment<'a>(
        &'a self,
        _name: &'a str,
        _existing: Option<&'a RemoteFile>,
        _bytes: Vec<u8>,
    ) -> BoxFut<'a, RemoteFile> {
        Box::pin(async {
            Err(BackendError::Other(
                "この同期先はコメントを扱えません".into(),
            ))
        })
    }
    /// [`StorageBackend::move_to_archive`] for a file of `_comments/`.
    fn archive_comment<'a>(&'a self, _file: &'a RemoteFile) -> BoxFut<'a, ()> {
        Box::pin(async {
            Err(BackendError::Other(
                "この同期先はコメントを扱えません".into(),
            ))
        })
    }

    // ---- the `_docs` folder (project documents). Names are the leaf names (`仕事.<id>.md`). ----

    /// The document files directly in `_docs/`, `None` when the target has no such folder.
    /// Complete or `Err`, like [`StorageBackend::list`].
    fn list_docs(&self) -> BoxFut<'_, Option<Vec<RemoteFile>>> {
        Box::pin(async { Ok(None) })
    }
    /// [`StorageBackend::upload`] inside `_docs/` (the folder is created when needed).
    fn upload_doc<'a>(
        &'a self,
        _name: &'a str,
        _existing: Option<&'a RemoteFile>,
        _bytes: Vec<u8>,
    ) -> BoxFut<'a, RemoteFile> {
        Box::pin(async {
            Err(BackendError::Other(
                "この同期先はドキュメントを扱えません".into(),
            ))
        })
    }
    /// [`StorageBackend::move_to_archive`] for a file of `_docs/`.
    fn archive_doc<'a>(&'a self, _file: &'a RemoteFile) -> BoxFut<'a, ()> {
        Box::pin(async {
            Err(BackendError::Other(
                "この同期先はドキュメントを扱えません".into(),
            ))
        })
    }

    // ---- the `_attachments` folder (spec attachments §7). A file is named by its content, so a
    // name that exists is never written again and a deletion is never passed on. ----

    /// The blobs directly in `_attachments/` (names as [`crate::store::attachments::parse_file_name`]
    /// reads them); empty when the folder does not exist. Complete or `Err`.
    fn list_attachments(&self) -> BoxFut<'_, Vec<RemoteFile>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    /// Creates `name` in `_attachments/` (the folder is made when needed). Never overwrites:
    /// [`BackendError::Precondition`] when the name exists. A failed write must not leave a file
    /// under that name, nor a temporary one that [`StorageBackend::list_attachments`] reads.
    fn upload_attachment<'a>(&'a self, _name: &'a str, _bytes: Vec<u8>) -> BoxFut<'a, RemoteFile> {
        Box::pin(async {
            Err(BackendError::Other("この同期先は添付を扱えません".into()))
        })
    }
}

/// Where comment files live inside the target, as a name prefix of [`MemoryBackend`] entries.
const COMMENTS_PREFIX: &str = "_comments/";
/// The same for project documents.
const DOCS_PREFIX: &str = "_docs/";
/// The same for attachment blobs.
const ATTACHMENTS_PREFIX: &str = "_attachments/";

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
    /// By name: only `upload` of that name fails (its download still works).
    upload_failures: BTreeMap<String, Failure>,
    /// By name: the next `upload` of that name first finds these bytes written by "another
    /// PC" (see `race_upload`).
    races: BTreeMap<String, Vec<u8>>,
    /// By id.
    files: BTreeMap<String, Entry>,
    /// `(name, bytes)` of what was moved to `archive/`, oldest first.
    archive: Vec<(String, Vec<u8>)>,
    /// The `_comments` folder exists (made by the first comment upload).
    comments_folder: bool,
    /// The `_docs` folder exists (made by the first document upload).
    docs_folder: bool,
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

    /// `upload_doc` of the document `name` returns `failure` from now on; downloading it still works.
    pub fn fail_doc_upload(&self, name: &str, failure: Failure) {
        self.lock()
            .upload_failures
            .insert(format!("{DOCS_PREFIX}{name}"), failure);
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

    /// Someone deletes the `_comments` folder on the target (its files are gone, not archived).
    pub fn wipe_comments(&self) {
        let mut inner = self.lock();
        inner
            .files
            .retain(|_, e| !e.name.starts_with(COMMENTS_PREFIX));
        inner.comments_folder = false;
    }

    /// Someone deletes the `_docs` folder on the target (its files are gone, not archived).
    pub fn wipe_docs(&self) {
        let mut inner = self.lock();
        inner.files.retain(|_, e| !e.name.starts_with(DOCS_PREFIX));
        inner.docs_folder = false;
    }

    /// Someone deletes every file in `_docs` on the target by hand; the folder stays (nothing is archived).
    pub fn empty_docs(&self) {
        self.lock()
            .files
            .retain(|_, e| !e.name.starts_with(DOCS_PREFIX));
    }

    /// Test setup: a blob appears in `_attachments/` under `name`, whatever its content.
    pub fn put_attachment(&self, name: &str, bytes: &[u8]) {
        self.put_entry(
            &format!("{ATTACHMENTS_PREFIX}{name}"),
            None,
            bytes.to_vec(),
            (self.clock)(),
        );
    }

    /// The content of the blob `name` in `_attachments/`.
    pub fn attachment(&self, name: &str) -> Option<Vec<u8>> {
        self.get(&format!("{ATTACHMENTS_PREFIX}{name}"))
    }

    /// The names in `_attachments/`, in order.
    pub fn attachment_names(&self) -> Vec<String> {
        let mut names: Vec<String> = self
            .lock()
            .files
            .values()
            .filter_map(|e| e.name.strip_prefix(ATTACHMENTS_PREFIX).map(str::to_string))
            .collect();
        names.sort();
        names
    }

    /// Ends every injected failure.
    pub fn clear_failures(&self) {
        let mut inner = self.lock();
        inner.failures.clear();
        inner.upload_failures.clear();
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
                .filter(|(_, e)| !e.name.contains('/') && e.name.to_lowercase().ends_with(".xlsx"))
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
            if let Some(f) = self.lock().upload_failures.get(name).copied() {
                return Err(f.error());
            }
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

    fn list_comments(&self) -> BoxFut<'_, Option<Vec<RemoteFile>>> {
        Box::pin(async move {
            let inner = self.lock();
            if let Some(f) = inner.list_failure {
                return Err(f.error());
            }
            if !inner.comments_folder {
                return Ok(None);
            }
            let mut files: Vec<RemoteFile> = inner
                .files
                .iter()
                .filter_map(|(id, e)| {
                    let leaf = e.name.strip_prefix(COMMENTS_PREFIX)?;
                    leaf.ends_with(".jsonl").then(|| RemoteFile {
                        name: leaf.to_string(),
                        ..Self::remote_file(id, e)
                    })
                })
                .collect();
            files.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(Some(files))
        })
    }

    fn upload_comment<'a>(
        &'a self,
        name: &'a str,
        existing: Option<&'a RemoteFile>,
        bytes: Vec<u8>,
    ) -> BoxFut<'a, RemoteFile> {
        Box::pin(async move {
            let full = format!("{COMMENTS_PREFIX}{name}");
            let existing = existing.map(|f| RemoteFile {
                name: full.clone(),
                ..f.clone()
            });
            let f = self.upload(&full, existing.as_ref(), bytes).await?;
            self.lock().comments_folder = true;
            Ok(RemoteFile {
                name: name.to_string(),
                ..f
            })
        })
    }

    fn list_docs(&self) -> BoxFut<'_, Option<Vec<RemoteFile>>> {
        Box::pin(async move {
            let inner = self.lock();
            if let Some(f) = inner.list_failure {
                return Err(f.error());
            }
            if !inner.docs_folder {
                return Ok(None);
            }
            let mut files: Vec<RemoteFile> = inner
                .files
                .iter()
                .filter_map(|(id, e)| {
                    let leaf = e.name.strip_prefix(DOCS_PREFIX)?;
                    leaf.ends_with(".md").then(|| RemoteFile {
                        name: leaf.to_string(),
                        ..Self::remote_file(id, e)
                    })
                })
                .collect();
            files.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(Some(files))
        })
    }

    fn upload_doc<'a>(
        &'a self,
        name: &'a str,
        existing: Option<&'a RemoteFile>,
        bytes: Vec<u8>,
    ) -> BoxFut<'a, RemoteFile> {
        Box::pin(async move {
            let full = format!("{DOCS_PREFIX}{name}");
            let existing = existing.map(|f| RemoteFile {
                name: full.clone(),
                ..f.clone()
            });
            let f = self.upload(&full, existing.as_ref(), bytes).await?;
            self.lock().docs_folder = true;
            Ok(RemoteFile {
                name: name.to_string(),
                ..f
            })
        })
    }

    fn archive_doc<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, ()> {
        Box::pin(async move {
            let full = RemoteFile {
                name: format!("{DOCS_PREFIX}{}", file.name),
                ..file.clone()
            };
            self.move_to_archive(&full).await
        })
    }

    fn list_attachments(&self) -> BoxFut<'_, Vec<RemoteFile>> {
        Box::pin(async move {
            let inner = self.lock();
            if let Some(f) = inner.list_failure {
                return Err(f.error());
            }
            let mut files: Vec<RemoteFile> = inner
                .files
                .iter()
                .filter_map(|(id, e)| {
                    let leaf = e.name.strip_prefix(ATTACHMENTS_PREFIX)?;
                    Some(RemoteFile {
                        name: leaf.to_string(),
                        ..Self::remote_file(id, e)
                    })
                })
                .collect();
            files.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(files)
        })
    }

    fn upload_attachment<'a>(&'a self, name: &'a str, bytes: Vec<u8>) -> BoxFut<'a, RemoteFile> {
        Box::pin(async move {
            self.check(name)?;
            let full = format!("{ATTACHMENTS_PREFIX}{name}");
            let f = self.upload(&full, None, bytes).await?;
            Ok(RemoteFile {
                name: name.to_string(),
                ..f
            })
        })
    }

    fn archive_comment<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, ()> {
        Box::pin(async move {
            let full = RemoteFile {
                name: format!("{COMMENTS_PREFIX}{}", file.name),
                ..file.clone()
            };
            self.move_to_archive(&full).await
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

    #[tokio::test]
    async fn docs_round_trip_and_stay_out_of_list() {
        let b = backend();
        assert_eq!(b.list_docs().await.unwrap(), None);
        let n = "仕事.1792929845000-3f2a00000000009c.md";
        let f = b.upload_doc(n, None, b"---\ntitle: a\n---\nx".to_vec()).await.unwrap();
        let listed = b.list_docs().await.unwrap().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, n);
        assert_eq!(b.download(&listed[0]).await.unwrap(), b"---\ntitle: a\n---\nx");
        assert!(b.list().await.unwrap().iter().all(|x| x.name != n));
        assert_eq!(b.list_comments().await.unwrap(), None);
        b.archive_doc(&f).await.unwrap();
        assert_eq!(b.list_docs().await.unwrap(), Some(Vec::new()));
    }

    #[tokio::test]
    async fn comments_round_trip() {
        let b = MemoryBackend::new(chrono::NaiveDateTime::default);
        let f = b
            .upload_comment("仕事.1.jsonl", None, b"a\n".to_vec())
            .await
            .unwrap();
        assert_eq!(f.name, "仕事.1.jsonl");
        let listed = b.list_comments().await.unwrap().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(b.download(&listed[0]).await.unwrap(), b"a\n");
        let g = b
            .upload_comment("仕事.1.jsonl", Some(&listed[0]), b"a\nb\n".to_vec())
            .await
            .unwrap();
        assert!(matches!(
            b.upload_comment("仕事.1.jsonl", Some(&listed[0]), b"x".to_vec())
                .await,
            Err(BackendError::Precondition)
        ));
        b.archive_comment(&g).await.unwrap();
        // Archiving the last file leaves the folder.
        assert_eq!(b.list_comments().await.unwrap(), Some(Vec::new()));
    }

    #[tokio::test]
    async fn attachments_round_trip_and_never_overwrite() {
        let b = MemoryBackend::new(chrono::NaiveDateTime::default);
        assert!(b.list_attachments().await.unwrap().is_empty());
        let f = b.upload_attachment("x.png", b"a".to_vec()).await.unwrap();
        assert_eq!(f.name, "x.png");
        assert!(matches!(
            b.upload_attachment("x.png", b"b".to_vec()).await,
            Err(BackendError::Precondition)
        ));
        assert_eq!(b.attachment("x.png").unwrap(), b"a");
        let listed = b.list_attachments().await.unwrap();
        assert_eq!(b.download(&listed[0]).await.unwrap(), b"a");
        assert!(
            b.list().await.unwrap().is_empty(),
            "not in the root listing"
        );
    }

    #[tokio::test]
    async fn comments_are_not_in_list() {
        let b = MemoryBackend::new(chrono::NaiveDateTime::default);
        b.upload_comment("仕事.1.jsonl", None, b"a\n".to_vec())
            .await
            .unwrap();
        assert!(b.list().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn missing_remote_comments_folder_is_none() {
        let b = MemoryBackend::new(chrono::NaiveDateTime::default);
        assert_eq!(b.list_comments().await.unwrap(), None);
    }
}
