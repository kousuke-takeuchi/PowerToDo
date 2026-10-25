//! The Google Drive side of the sync (spec section 5): a visible `PowerToDo/` folder created
//! with the `drive.file` scope, `*.xlsx` files directly in it and an `archive` sub-folder.
//! [`GoogleDriveBackend`] is the [`StorageBackend`].
//!
//! A file's `id` is Drive's file id. Drive allows several files of one name in a folder; `list`
//! returns all of them and the engine picks by the recorded id (see `sync::plan`).
//!
//! Errors never quote a URL or a Google text; the access token comes from a
//! [`TokenSource`] and is never logged.

use std::collections::BTreeSet;
use std::sync::Arc;

use chrono::{DateTime, NaiveDateTime};
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use url::Url;

use super::backend::{BackendError, BoxFut, RemoteFile, StorageBackend};
use super::oauth::{self, TokenSource};
use crate::store::project_store::archive_file_name;

const API_BASE: &str = "https://www.googleapis.com";
const FOLDER_MIME: &str = "application/vnd.google-apps.folder";
const XLSX_MIME: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ROOT_FOLDER_NAME: &str = "PowerToDo";
const ARCHIVE_FOLDER_NAME: &str = "archive";
/// `appProperties.powertodo` on the two folders, so they are found again by what they are
/// and not by their (renameable) name.
const PROP_ROOT: &str = "root";
const PROP_ARCHIVE: &str = "archive";
/// The comment files' folder in the root (spec ① §3.4).
const COMMENTS_FOLDER_NAME: &str = "_comments";
const PROP_COMMENTS: &str = "comments";
const JSONL_MIME: &str = "application/x-ndjson";
/// The metadata every returned file carries.
const FILE_FIELDS: &str = "id,name,md5Checksum,modifiedTime,size";
/// Pages of 1000 files; more than this many pages means something is wrong.
const MAX_PAGES: usize = 1000;
const MAX_ARCHIVE_NAMES: u32 = 50;

/// A Drive id inside a URL path: everything but unreserved characters is escaped.
const PATH_ID: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');

pub struct GoogleDriveBackend {
    http: reqwest::Client,
    tokens: Arc<TokenSource>,
    /// No trailing slash.
    api: String,
    /// The root folder's id once found (the other calls reuse it; every `list` looks again).
    /// Never held across an await.
    root: std::sync::Mutex<Option<String>>,
}

impl std::fmt::Debug for GoogleDriveBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GoogleDriveBackend")
            .field("api", &self.api)
            .finish_non_exhaustive()
    }
}

/// A finished request: any 2xx, or 404 (callers give it a meaning); everything else is an
/// error already.
struct Reply {
    status: u16,
    body: Vec<u8>,
}

impl Reply {
    fn json(&self, what: &str) -> Result<serde_json::Value, BackendError> {
        if self.status == 404 {
            return Err(BackendError::Other(format!("{what}が見つかりません")));
        }
        serde_json::from_slice(&self.body)
            .map_err(|_| BackendError::Other(format!("{what}の応答を読めません")))
    }
}

impl GoogleDriveBackend {
    pub fn new(tokens: Arc<TokenSource>) -> Result<Self, BackendError> {
        Self::with_api_base(tokens, API_BASE)
    }

    /// `api_base`: `https://www.googleapis.com` in production, a mock server in tests.
    pub fn with_api_base(tokens: Arc<TokenSource>, api_base: &str) -> Result<Self, BackendError> {
        Ok(GoogleDriveBackend {
            http: oauth::http_client()?,
            tokens,
            api: api_base.trim_end_matches('/').to_string(),
            root: std::sync::Mutex::new(None),
        })
    }

    fn url(&self, path: &str, query: &[(&str, &str)]) -> Result<Url, BackendError> {
        let mut url = Url::parse(&format!("{}{path}", self.api))
            .map_err(|_| BackendError::Other("Google Drive の URL が正しくありません".into()))?;
        if !query.is_empty() {
            url.query_pairs_mut().extend_pairs(query);
        }
        Ok(url)
    }

    fn file_path(prefix: &str, id: &str) -> String {
        format!("{prefix}/files/{}", utf8_percent_encode(id, PATH_ID))
    }

    /// One authorized request. `build` makes the request for a given access token (it runs
    /// again for the retry). A 401 renews the token once and retries once; a second 401 is
    /// [`BackendError::Auth`].
    async fn call(
        &self,
        build: impl Fn(&reqwest::Client, &str) -> reqwest::RequestBuilder,
    ) -> Result<Reply, BackendError> {
        let mut token = self.tokens.access_token().await?;
        let mut renewed = false;
        loop {
            let resp = build(&self.http, &token)
                .send()
                .await
                .map_err(|e| BackendError::from(oauth::transport(&e)))?;
            let status = resp.status().as_u16();
            let body = resp
                .bytes()
                .await
                .map_err(|e| BackendError::from(oauth::transport(&e)))?
                .to_vec();
            if status == 401 {
                if renewed {
                    return Err(BackendError::Auth);
                }
                token = self.tokens.renew(&token).await?;
                renewed = true;
                continue;
            }
            if (200..300).contains(&status) || status == 404 {
                return Ok(Reply { status, body });
            }
            return Err(status_error(status, &body));
        }
    }

    async fn get_json(&self, url: Url) -> Result<Reply, BackendError> {
        self.call(|http, token| http.get(url.clone()).bearer_auth(token))
            .await
    }

    /// All files matching `q`, every page, as raw JSON objects with `fields` (a `files(...)`
    /// selector; `nextPageToken` is added here). Complete or an error.
    async fn query(&self, q: &str, fields: &str) -> Result<Vec<serde_json::Value>, BackendError> {
        let fields = format!("nextPageToken,{fields}");
        let mut files = Vec::new();
        let mut page: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let mut query = vec![("q", q), ("fields", fields.as_str()), ("pageSize", "1000")];
            if let Some(p) = &page {
                query.push(("pageToken", p));
            }
            let reply = self.get_json(self.url("/drive/v3/files", &query)?).await?;
            let json = reply.json("Google Drive のフォルダ")?;
            if let Some(items) = json.get("files").and_then(serde_json::Value::as_array) {
                files.extend(items.iter().cloned());
            }
            match json
                .get("nextPageToken")
                .and_then(serde_json::Value::as_str)
                .filter(|t| !t.is_empty())
            {
                Some(next) => page = Some(next.to_string()),
                None => return Ok(files),
            }
        }
        Err(BackendError::Other(
            "Google Drive の一覧が長すぎて読めません".into(),
        ))
    }

    /// The folder marked `powertodo=<kind>` (inside `parent` when given), created when
    /// missing. Folders made at the same moment by two PCs are told apart by id: every PC takes
    /// the smallest, so they converge on one.
    async fn find_or_create_folder(
        &self,
        name: &str,
        kind: &str,
        parent: Option<&str>,
    ) -> Result<String, BackendError> {
        if let Some(id) = self.find_folder(kind, parent).await? {
            return Ok(id);
        }
        let mut meta = serde_json::json!({
            "name": name,
            "mimeType": FOLDER_MIME,
            "appProperties": {"powertodo": kind},
        });
        if let Some(p) = parent {
            meta["parents"] = serde_json::json!([p]);
        }
        let body = meta.to_string();
        let url = self.url("/drive/v3/files", &[("fields", "id")])?;
        let reply = self
            .call(|http, token| {
                http.post(url.clone())
                    .bearer_auth(token)
                    .header("Content-Type", "application/json")
                    .body(body.clone())
            })
            .await?;
        id_of(&reply.json("Google Drive のフォルダ")?)
            .ok_or_else(|| BackendError::Other("Google Drive のフォルダを作れませんでした".into()))
    }

    /// The folder marked `powertodo=<kind>` (inside `parent` when given), without creating it.
    async fn find_folder(
        &self,
        kind: &str,
        parent: Option<&str>,
    ) -> Result<Option<String>, BackendError> {
        let mut q = format!(
            "mimeType='{FOLDER_MIME}' and appProperties has {{ key='powertodo' and value='{kind}' }} and trashed=false"
        );
        if let Some(p) = parent {
            q.push_str(&format!(" and '{}' in parents", escape_q(p)));
        }
        let found = self.query(&q, "files(id)").await?;
        Ok(found
            .iter()
            .filter_map(|f| f.get("id").and_then(serde_json::Value::as_str))
            .min()
            .map(str::to_string))
    }

    /// The comment files (`*.jsonl` in `_comments`). A root without that folder has none.
    async fn list_comment_files(&self) -> Result<Vec<RemoteFile>, BackendError> {
        let root = self.resolve_root().await?;
        let Some(folder) = self.find_folder(PROP_COMMENTS, Some(&root)).await? else {
            return Ok(Vec::new());
        };
        let q = format!(
            "'{}' in parents and trashed=false and mimeType!='{FOLDER_MIME}'",
            escape_q(&folder)
        );
        let mut files = Vec::new();
        for item in self.query(&q, &format!("files({FILE_FIELDS})")).await? {
            let is_comment = item
                .get("name")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|n| crate::store::comments::parse_file_name(n).is_some());
            if is_comment {
                files.push(remote_file(&item)?);
            }
        }
        Ok(files)
    }

    async fn comments_folder(&self) -> Result<String, BackendError> {
        let root = self.root_id().await?;
        self.find_or_create_folder(COMMENTS_FOLDER_NAME, PROP_COMMENTS, Some(&root))
            .await
    }

    /// Looks for the root folder again (creating it) and remembers it.
    async fn resolve_root(&self) -> Result<String, BackendError> {
        let id = self
            .find_or_create_folder(ROOT_FOLDER_NAME, PROP_ROOT, None)
            .await?;
        *self.root_lock() = Some(id.clone());
        Ok(id)
    }

    fn root_lock(&self) -> std::sync::MutexGuard<'_, Option<String>> {
        self.root.lock().unwrap_or_else(|e| e.into_inner())
    }

    async fn root_id(&self) -> Result<String, BackendError> {
        let known = self.root_lock().clone();
        match known {
            Some(id) => Ok(id),
            None => self.resolve_root().await,
        }
    }

    async fn list_files(&self) -> Result<Vec<RemoteFile>, BackendError> {
        // Looked up on every listing: a root that went missing is made again (an empty
        // listing), and another PC's root with a smaller id takes over. Either way
        // `root_identity` changes and the engine stops trusting its records.
        let root = self.resolve_root().await?;
        let q = format!(
            "'{}' in parents and trashed=false and mimeType!='{FOLDER_MIME}'",
            escape_q(&root)
        );
        let mut files = Vec::new();
        for item in self.query(&q, &format!("files({FILE_FIELDS})")).await? {
            // Every `.xlsx` is returned, conflict copies included (the engine needs them to
            // pick a free conflict name). An entry that cannot be read only fails the listing
            // when it is a sync target: anything else (a lock file, a conflict copy, a
            // stray workbook) is of no use to the engine and is skipped.
            let Some(name) = item
                .get("name")
                .and_then(serde_json::Value::as_str)
                .filter(|n| n.ends_with(".xlsx"))
            else {
                continue;
            };
            match remote_file(&item) {
                Ok(file) => files.push(file),
                Err(e) if super::is_sync_target(name) => return Err(e),
                Err(_) => {}
            }
        }
        Ok(files)
    }

    async fn download_file(&self, file: &RemoteFile) -> Result<Vec<u8>, BackendError> {
        let url = self.url(&Self::file_path("/drive/v3", &file.id), &[("alt", "media")])?;
        let reply = self.get_json(url).await?;
        if reply.status == 404 {
            return Err(BackendError::Other(format!(
                "「{}」が同期先に見つかりません",
                file.name
            )));
        }
        Ok(reply.body)
    }

    async fn upload_file(
        &self,
        name: &str,
        existing: Option<&RemoteFile>,
        bytes: Vec<u8>,
    ) -> Result<RemoteFile, BackendError> {
        match existing {
            Some(file) => self.update_file(file, bytes).await,
            None => self.create_file(name, bytes).await,
        }
    }

    /// Only when no live file of that name is in the root folder. (The window between this
    /// look and the write is accepted, like WebDAV without etags; spec section 9.)
    async fn create_file(&self, name: &str, bytes: Vec<u8>) -> Result<RemoteFile, BackendError> {
        let root = self.root_id().await?;
        self.create_in(&root, name, bytes, XLSX_MIME).await
    }

    /// [`Self::create_file`] in the folder `root` with the content type `mime`.
    async fn create_in(
        &self,
        root: &str,
        name: &str,
        bytes: Vec<u8>,
        mime: &str,
    ) -> Result<RemoteFile, BackendError> {
        let root = root.to_string();
        let q = format!(
            "'{}' in parents and trashed=false and mimeType!='{FOLDER_MIME}' and name='{}'",
            escape_q(&root),
            escape_q(name)
        );
        if !self.query(&q, "files(id)").await?.is_empty() {
            return Err(BackendError::Precondition);
        }
        let meta = serde_json::json!({"name": name, "parents": [root]}).to_string();
        let (content_type, body) = multipart_related(&meta, mime, &bytes);
        let url = self.url(
            "/upload/drive/v3/files",
            &[("uploadType", "multipart"), ("fields", FILE_FIELDS)],
        )?;
        let reply = self
            .call(|http, token| {
                http.post(url.clone())
                    .bearer_auth(token)
                    .header("Content-Type", content_type.as_str())
                    .body(body.clone())
            })
            .await?;
        remote_file(&reply.json("Google Drive のファイル")?)
    }

    /// Only while the remote file is still the version that was listed: its md5 is read right
    /// before the write. Gone, in the trash or changed: [`BackendError::Precondition`].
    async fn update_file(
        &self,
        file: &RemoteFile,
        bytes: Vec<u8>,
    ) -> Result<RemoteFile, BackendError> {
        let root = self.root_id().await?;
        self.update_in(&root, file, bytes, XLSX_MIME).await
    }

    /// [`Self::update_file`] for a file of the folder `root`, with the content type `mime`.
    async fn update_in(
        &self,
        root: &str,
        file: &RemoteFile,
        bytes: Vec<u8>,
        mime: &str,
    ) -> Result<RemoteFile, BackendError> {
        // Drive keeps a file's id across a move or a rename, so the id alone does not say it
        // is still the file that was listed: another PC may have archived it (moved and
        // renamed) or the user may have renamed it in the browser.
        let root = root.to_string();
        let meta_url = self.url(
            &Self::file_path("/drive/v3", &file.id),
            &[("fields", "md5Checksum,trashed,name,parents")],
        )?;
        let reply = self.get_json(meta_url).await?;
        if reply.status == 404 {
            return Err(BackendError::Precondition);
        }
        let meta = reply.json("Google Drive のファイル")?;
        let trashed = meta
            .get("trashed")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let md5 = meta.get("md5Checksum").and_then(serde_json::Value::as_str);
        let name = meta.get("name").and_then(serde_json::Value::as_str);
        let in_root = meta
            .get("parents")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|ps| ps.iter().any(|p| p.as_str() == Some(root.as_str())));
        if trashed
            || md5 != Some(file.version.as_str())
            || !in_root
            || name != Some(file.name.as_str())
        {
            return Err(BackendError::Precondition);
        }
        let url = self.url(
            &Self::file_path("/upload/drive/v3", &file.id),
            &[("uploadType", "media"), ("fields", FILE_FIELDS)],
        )?;
        let reply = self
            .call(|http, token| {
                http.patch(url.clone())
                    .bearer_auth(token)
                    .header("Content-Type", mime)
                    .body(bytes.clone())
            })
            .await?;
        if reply.status == 404 {
            return Err(BackendError::Precondition);
        }
        remote_file(&reply.json("Google Drive のファイル")?)
    }

    /// Moves the file into `archive` (made when missing) and renames it the way the NAS and the
    /// local `archive/` do: `<stem> (<modified>).xlsx`, then `-2`, `-3`, ... Drive would take a
    /// repeated name, so the archive is looked at first. Nothing is trashed or deleted.
    async fn archive_file(&self, file: &RemoteFile) -> Result<(), BackendError> {
        let root = self.root_id().await?;
        self.archive_in(&root, file).await
    }

    /// [`Self::archive_file`] for a file of the folder `from` (the root or `_comments`).
    async fn archive_in(&self, from: &str, file: &RemoteFile) -> Result<(), BackendError> {
        let root = self.root_id().await?;
        let from = from.to_string();
        let archive = self
            .find_or_create_folder(ARCHIVE_FOLDER_NAME, PROP_ARCHIVE, Some(&root))
            .await?;
        let q = format!("'{}' in parents and trashed=false", escape_q(&archive));
        let taken: BTreeSet<String> = self
            .query(&q, "files(name)")
            .await?
            .iter()
            .filter_map(|f| f.get("name").and_then(serde_json::Value::as_str))
            .map(str::to_string)
            .collect();
        // A comment file keeps its `.jsonl` (archive_file_name writes `.xlsx`).
        let (stem, jsonl) = match file.name.strip_suffix(".jsonl") {
            Some(stem) => (stem, true),
            None => (file.name.strip_suffix(".xlsx").unwrap_or(&file.name), false),
        };
        let tag = file.modified.format("%Y-%m-%d %H%M").to_string();
        let dest = (1..=MAX_ARCHIVE_NAMES)
            .map(|n| {
                let name = archive_file_name(stem, &tag, n);
                if jsonl {
                    format!("{}.jsonl", name.strip_suffix(".xlsx").unwrap_or(&name))
                } else {
                    name
                }
            })
            .find(|candidate| !taken.contains(candidate))
            .ok_or_else(|| {
                BackendError::Other(format!(
                    "同期先の archive に「{}」の控えが多すぎて移せません",
                    file.name
                ))
            })?;
        let url = self.url(
            &Self::file_path("/drive/v3", &file.id),
            &[
                ("addParents", archive.as_str()),
                ("removeParents", from.as_str()),
                ("fields", FILE_FIELDS),
            ],
        )?;
        let body = serde_json::json!({"name": dest}).to_string();
        // A 404 comes back as a reply too: the file is gone already (another PC archived it),
        // which is the state we wanted.
        self.call(|http, token| {
            http.patch(url.clone())
                .bearer_auth(token)
                .header("Content-Type", "application/json")
                .body(body.clone())
        })
        .await?;
        Ok(())
    }
}

impl StorageBackend for GoogleDriveBackend {
    fn list(&self) -> BoxFut<'_, Vec<RemoteFile>> {
        Box::pin(self.list_files())
    }

    fn download<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, Vec<u8>> {
        Box::pin(self.download_file(file))
    }

    fn upload<'a>(
        &'a self,
        name: &'a str,
        existing: Option<&'a RemoteFile>,
        bytes: Vec<u8>,
    ) -> BoxFut<'a, RemoteFile> {
        Box::pin(self.upload_file(name, existing, bytes))
    }

    fn move_to_archive<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, ()> {
        Box::pin(self.archive_file(file))
    }

    /// The root folder `list` found last: it can change (another PC's folder with a smaller id,
    /// or a new one after the old was deleted), and the records only fit the folder they were
    /// made against.
    fn root_identity(&self) -> Option<String> {
        self.root_lock().clone()
    }

    fn list_comments(&self) -> BoxFut<'_, Vec<RemoteFile>> {
        Box::pin(self.list_comment_files())
    }

    fn upload_comment<'a>(
        &'a self,
        name: &'a str,
        existing: Option<&'a RemoteFile>,
        bytes: Vec<u8>,
    ) -> BoxFut<'a, RemoteFile> {
        Box::pin(async move {
            let folder = self.comments_folder().await?;
            match existing {
                Some(file) => self.update_in(&folder, file, bytes, JSONL_MIME).await,
                None => self.create_in(&folder, name, bytes, JSONL_MIME).await,
            }
        })
    }

    fn archive_comment<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, ()> {
        Box::pin(async move {
            let folder = self.comments_folder().await?;
            self.archive_in(&folder, file).await
        })
    }
}

// ---------------------------------------------------------------------------------------------
// Helpers

/// A string for the inside of a `q` literal: `\` and `'` are escaped with a backslash.
fn escape_q(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

fn id_of(json: &serde_json::Value) -> Option<String> {
    json.get("id")
        .and_then(serde_json::Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

fn remote_file(item: &serde_json::Value) -> Result<RemoteFile, BackendError> {
    let name = item
        .get("name")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let unreadable = |what: &str| {
        BackendError::Other(format!(
            "Drive の「{name}」の{what}を読めません。Drive 上でこのファイルの名前を変えるか、PowerToDo フォルダの外へ移してください"
        ))
    };
    let id = id_of(item).ok_or_else(|| unreadable("ID"))?;
    // A file without an md5 is not an uploaded binary (a Google-native document): it has no
    // version to compare, so the listing cannot be trusted.
    let version = item
        .get("md5Checksum")
        .and_then(serde_json::Value::as_str)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| unreadable("版の情報"))?
        .to_string();
    let modified: NaiveDateTime = item
        .get("modifiedTime")
        .and_then(serde_json::Value::as_str)
        .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
        .ok_or_else(|| unreadable("更新日時"))?
        .with_timezone(&chrono::Local)
        .naive_local();
    // An int64 comes as a string in Drive's JSON.
    let size = match item.get("size") {
        Some(serde_json::Value::String(s)) => s.parse().map_err(|_| unreadable("サイズ"))?,
        Some(serde_json::Value::Number(n)) => n.as_u64().ok_or_else(|| unreadable("サイズ"))?,
        _ => 0,
    };
    Ok(RemoteFile {
        id,
        name: name.to_string(),
        version,
        modified,
        size,
    })
}

/// A `multipart/related` upload body (not form-data): the JSON metadata, then the media.
/// Returns the `Content-Type` header value and the body.
fn multipart_related(metadata: &str, media_type: &str, media: &[u8]) -> (String, Vec<u8>) {
    // A boundary that does not occur in the content (it all but never does).
    let boundary = loop {
        let candidate = format!(
            "powertodo-{:016x}{:016x}",
            rand::random::<u64>(),
            rand::random::<u64>()
        );
        let needle = candidate.as_bytes();
        if !media.windows(needle.len()).any(|w| w == needle) && !metadata.contains(&candidate) {
            break candidate;
        }
    };
    let mut body = Vec::with_capacity(media.len() + metadata.len() + 256);
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: {media_type}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(media);
    body.extend_from_slice(format!("\r\n--{boundary}--").as_bytes());
    (format!("multipart/related; boundary={boundary}"), body)
}

/// The error for an unsuccessful status (401 and 404 are handled by the caller). The reason is
/// read from `error.errors[].reason` and `error.status`; Google's own message is not shown.
fn status_error(status: u16, body: &[u8]) -> BackendError {
    let reasons = error_reasons(body);
    let has = |names: &[&str]| reasons.iter().any(|r| names.contains(&r.as_str()));
    match status {
        403 if has(&["storageQuotaExceeded"]) => BackendError::Full,
        403 if has(&["rateLimitExceeded", "userRateLimitExceeded"]) => {
            BackendError::Offline("Google Drive の利用制限に達しました".into())
        }
        403 => BackendError::Forbidden,
        408 | 429 | 500..=599 => {
            BackendError::Offline(format!("Google Drive が応答しません (HTTP {status})"))
        }
        _ => BackendError::Other(format!("Google Drive のエラー (HTTP {status})")),
    }
}

fn error_reasons(body: &[u8]) -> Vec<String> {
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(body) else {
        return Vec::new();
    };
    let Some(error) = json.get("error") else {
        return Vec::new();
    };
    let mut reasons: Vec<String> = error
        .get("errors")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|e| e.get("reason").and_then(serde_json::Value::as_str))
        .map(str::to_string)
        .collect();
    if let Some(status) = error.get("status").and_then(serde_json::Value::as_str) {
        reasons.push(status.to_string());
    }
    reasons
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::oauth::{Endpoints, GoogleOAuth};
    use serde_json::json;
    use wiremock::matchers::{body_json, header, method, path, query_param};
    use wiremock::{Mock, MockServer, Request, ResponseTemplate};

    const ROOT_Q: &str = "mimeType='application/vnd.google-apps.folder' and appProperties has { key='powertodo' and value='root' } and trashed=false";
    const LIST_Q: &str =
        "'root1' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'";
    const MODIFIED: &str = "2026-10-16T09:30:00.123Z";

    fn local(rfc3339: &str) -> NaiveDateTime {
        DateTime::parse_from_rfc3339(rfc3339)
            .unwrap()
            .with_timezone(&chrono::Local)
            .naive_local()
    }

    fn tokens(server: &MockServer) -> Arc<TokenSource> {
        let endpoints = Endpoints {
            token_url: format!("{}/token", server.uri()),
            ..Endpoints::default()
        };
        let oauth = GoogleOAuth::new("cid", "csecret", endpoints).unwrap();
        Arc::new(TokenSource::new(oauth, "refresh-token"))
    }

    async fn backend(server: &MockServer) -> GoogleDriveBackend {
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"access_token": "at-1", "expires_in": 3600})),
            )
            .mount(server)
            .await;
        GoogleDriveBackend::with_api_base(tokens(server), &server.uri()).unwrap()
    }

    /// `files.list` answering `body` for exactly this `q`.
    async fn mount_list(server: &MockServer, q: &str, body: serde_json::Value) {
        Mock::given(method("GET"))
            .and(path("/drive/v3/files"))
            .and(query_param("q", q))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(server)
            .await;
    }

    async fn mount_root(server: &MockServer) {
        mount_list(server, ROOT_Q, json!({"files": [{"id": "root1"}]})).await;
    }

    fn file_json(id: &str, name: &str, md5: &str) -> serde_json::Value {
        json!({"id": id, "name": name, "md5Checksum": md5, "modifiedTime": MODIFIED, "size": "123"})
    }

    /// What `files.get` says about `a.xlsx` where it was listed (in `root1`).
    fn live_meta(md5: &str) -> serde_json::Value {
        json!({"md5Checksum": md5, "trashed": false, "name": "a.xlsx", "parents": ["root1"]})
    }

    fn rf(id: &str, name: &str, version: &str) -> RemoteFile {
        RemoteFile {
            id: id.into(),
            name: name.into(),
            version: version.into(),
            modified: local(MODIFIED),
            size: 123,
        }
    }

    async fn sent(server: &MockServer, verb: &str) -> Vec<Request> {
        server
            .received_requests()
            .await
            .unwrap()
            .into_iter()
            .filter(|r| r.method.as_str() == verb && r.url.path() != "/token")
            .collect()
    }

    fn param(r: &Request, key: &str) -> Option<String> {
        r.url
            .query_pairs()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
    }

    const COMMENTS_FOLDER_Q: &str = "mimeType='application/vnd.google-apps.folder' and appProperties has { key='powertodo' and value='comments' } and trashed=false and 'root1' in parents";
    const COMMENTS_LIST_Q: &str =
        "'com1' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'";

    #[tokio::test]
    async fn comments_listing_without_the_folder_is_empty() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        mount_list(&server, COMMENTS_FOLDER_Q, json!({"files": []})).await;
        assert!(b.list_comments().await.unwrap().is_empty());
        assert!(
            sent(&server, "POST").await.is_empty(),
            "listing never creates the folder"
        );
    }

    #[tokio::test]
    async fn comments_listing_reads_the_comments_folder() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        mount_list(
            &server,
            COMMENTS_FOLDER_Q,
            json!({"files": [{"id": "com1"}]}),
        )
        .await;
        mount_list(
            &server,
            COMMENTS_LIST_Q,
            json!({"files": [file_json("c1", "仕事.12.jsonl", "m1"), file_json("x", "notes.txt", "m2")]}),
        )
        .await;
        let files = b.list_comments().await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(
            (files[0].id.as_str(), files[0].name.as_str()),
            ("c1", "仕事.12.jsonl")
        );
    }

    #[tokio::test]
    async fn comment_upload_creates_inside_the_comments_folder() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        mount_list(
            &server,
            COMMENTS_FOLDER_Q,
            json!({"files": [{"id": "com1"}]}),
        )
        .await;
        let exists_q = "'com1' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder' and name='a.1.jsonl'";
        mount_list(&server, exists_q, json!({"files": []})).await;
        Mock::given(method("POST"))
            .and(path("/upload/drive/v3/files"))
            .respond_with(ResponseTemplate::new(200).set_body_json(file_json(
                "c9",
                "a.1.jsonl",
                "m9",
            )))
            .mount(&server)
            .await;
        let f = b
            .upload_comment("a.1.jsonl", None, b"x\n".to_vec())
            .await
            .unwrap();
        assert_eq!(f.id, "c9");
        let post = sent(&server, "POST").await;
        let body = String::from_utf8_lossy(&post[0].body).to_string();
        assert!(
            body.contains("\"parents\":[\"com1\"]") && body.contains("application/x-ndjson"),
            "{body}"
        );
    }

    #[tokio::test]
    async fn list_reads_the_root_folder_with_its_metadata() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        mount_list(
            &server,
            LIST_Q,
            json!({"files": [
                file_json("f1", "受信トレイ.xlsx", "md5-1"),
                file_json("f2", "仕事.xlsx", "md5-2"),
                {"id": "f3", "name": "notes.txt", "md5Checksum": "x", "modifiedTime": MODIFIED, "size": "1"},
                // Not a sync target and without any metadata: skipped, never fatal.
                {"id": "f5", "name": "Budget"},
                // A conflict copy is a listed file like any other ...
                file_json("f7", "仕事 (競合 2026-10-16 0930).xlsx", "md5-7"),
                // ... but one that cannot be read is skipped, not fatal.
                {"id": "f8", "name": "仕事 (競合 2026-10-16 0931).xlsx"},
                {"id": "f6", "name": "~$lock.xlsx"},
                {"id": "f4", "name": "~$仕事.xlsx.tmp", "md5Checksum": "x", "modifiedTime": MODIFIED, "size": "1"},
            ]}),
        )
        .await;
        let files = b.list().await.unwrap();
        assert_eq!(
            files,
            vec![
                rf("f1", "受信トレイ.xlsx", "md5-1"),
                rf("f2", "仕事.xlsx", "md5-2"),
                rf("f7", "仕事 (競合 2026-10-16 0930).xlsx", "md5-7")
            ]
        );
        // Every call carries the bearer token; the list asks for what the engine needs.
        let gets = sent(&server, "GET").await;
        assert!(
            gets.iter()
                .all(|r| r.headers.get("authorization").unwrap() == "Bearer at-1")
        );
        let list = gets
            .iter()
            .find(|r| param(r, "q").as_deref() == Some(LIST_Q))
            .unwrap();
        assert_eq!(
            param(list, "fields").unwrap(),
            "nextPageToken,files(id,name,md5Checksum,modifiedTime,size)"
        );
    }

    #[tokio::test]
    async fn list_creates_a_missing_root_and_returns_nothing() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_list(&server, ROOT_Q, json!({"files": []})).await;
        mount_list(&server, LIST_Q, json!({"files": []})).await;
        Mock::given(method("POST"))
            .and(path("/drive/v3/files"))
            .and(body_json(json!({
                "name": "PowerToDo",
                "mimeType": "application/vnd.google-apps.folder",
                "appProperties": {"powertodo": "root"}
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": "root1"})))
            .expect(1)
            .mount(&server)
            .await;
        assert_eq!(b.list().await.unwrap(), vec![]);
    }

    #[tokio::test]
    async fn a_made_again_root_is_another_root_folder() {
        // The root folder was deleted (trashed) in Drive: `list` makes a new one and returns it
        // empty. It is another folder, so the engine drops its records and uploads this PC's
        // files again (compared by content) instead of reading the empty listing as deletions.
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        mount_list(
            &server,
            LIST_Q,
            json!({"files": [file_json("f1", "a.xlsx", "m1")]}),
        )
        .await;
        assert_eq!(b.list().await.unwrap().len(), 1);
        assert_eq!(b.root_identity().as_deref(), Some("root1"));

        server.reset().await;
        mount_list(&server, ROOT_Q, json!({"files": []})).await;
        mount_list(
            &server,
            "'root2' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'",
            json!({"files": []}),
        )
        .await;
        Mock::given(method("POST"))
            .and(path("/drive/v3/files"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": "root2"})))
            .expect(1)
            .mount(&server)
            .await;
        assert_eq!(b.list().await.unwrap(), vec![]);
        assert_eq!(b.root_identity().as_deref(), Some("root2"));
    }

    #[tokio::test]
    async fn list_follows_every_page_and_fails_rather_than_returning_a_part() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        // The more specific mock first.
        Mock::given(method("GET"))
            .and(path("/drive/v3/files"))
            .and(query_param("q", LIST_Q))
            .and(query_param("pageToken", "p2"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"files": [file_json("f2", "b.xlsx", "m2")]})),
            )
            .mount(&server)
            .await;
        mount_list(
            &server,
            LIST_Q,
            json!({"files": [file_json("f1", "a.xlsx", "m1")], "nextPageToken": "p2"}),
        )
        .await;
        let names: Vec<_> = b
            .list()
            .await
            .unwrap()
            .into_iter()
            .map(|f| f.name)
            .collect();
        assert_eq!(names, ["a.xlsx", "b.xlsx"]);

        // The second page failing fails the listing.
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files"))
            .and(query_param("q", LIST_Q))
            .and(query_param("pageToken", "p2"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        mount_list(
            &server,
            LIST_Q,
            json!({"files": [file_json("f1", "a.xlsx", "m1")], "nextPageToken": "p2"}),
        )
        .await;
        assert!(matches!(b.list().await, Err(BackendError::Offline(_))));
    }

    #[tokio::test]
    async fn list_returns_same_named_duplicates_as_they_are() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        mount_list(
            &server,
            LIST_Q,
            json!({"files": [file_json("f1", "a.xlsx", "m1"), file_json("f2", "a.xlsx", "m2")]}),
        )
        .await;
        let files = b.list().await.unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!((files[0].id.as_str(), files[1].id.as_str()), ("f1", "f2"));
    }

    #[tokio::test]
    async fn a_listed_file_without_a_version_fails_the_listing() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        mount_list(
            &server,
            LIST_Q,
            json!({"files": [{"id": "f1", "name": "a.xlsx", "modifiedTime": MODIFIED}]}),
        )
        .await;
        let err = b.list().await.unwrap_err();
        assert!(matches!(err, BackendError::Other(_)));
        // Says which file, and what to do about it.
        let text = err.to_string();
        assert!(
            text.contains("「a.xlsx」")
                && text.contains("版の情報を読めません")
                && text.contains("PowerToDo フォルダの外へ移してください")
        );
    }

    #[tokio::test]
    async fn the_smallest_id_wins_among_duplicate_root_folders() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_list(
            &server,
            ROOT_Q,
            json!({"files": [{"id": "zzz"}, {"id": "aaa"}]}),
        )
        .await;
        mount_list(
            &server,
            "'aaa' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'",
            json!({"files": []}),
        )
        .await;
        assert_eq!(b.list().await.unwrap(), vec![]);
        // The engine compares this with the folder its records were made against.
        assert_eq!(b.root_identity().as_deref(), Some("aaa"));
    }

    #[tokio::test]
    async fn the_root_identity_is_the_folder_the_last_listing_read() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        assert_eq!(b.root_identity(), None);
        mount_root(&server).await;
        mount_list(&server, LIST_Q, json!({"files": []})).await;
        b.list().await.unwrap();
        assert_eq!(b.root_identity().as_deref(), Some("root1"));

        // Another PC's root folder shows up with a smaller id: the next listing moves to it.
        // (The access token is still cached: no token endpoint needed.)
        server.reset().await;
        mount_list(
            &server,
            ROOT_Q,
            json!({"files": [{"id": "root1"}, {"id": "root0"}]}),
        )
        .await;
        mount_list(
            &server,
            "'root0' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'",
            json!({"files": []}),
        )
        .await;
        b.list().await.unwrap();
        assert_eq!(b.root_identity().as_deref(), Some("root0"));
    }

    #[tokio::test]
    async fn download_reads_the_media_of_the_file_id() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/f%201"))
            .and(query_param("alt", "media"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![0u8, 1, 2, 255]))
            .mount(&server)
            .await;
        // An id is one path segment, whatever it contains.
        let got = b.download(&rf("f 1", "a.xlsx", "m")).await.unwrap();
        assert_eq!(got, vec![0u8, 1, 2, 255]);

        Mock::given(method("GET"))
            .and(path("/drive/v3/files/gone"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        assert!(matches!(
            b.download(&rf("gone", "a.xlsx", "m")).await,
            Err(BackendError::Other(_))
        ));
    }

    #[tokio::test]
    async fn a_new_file_is_created_with_a_multipart_related_upload() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        mount_list(
            &server,
            "'root1' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder' and name='受信トレイ.xlsx'",
            json!({"files": []}),
        )
        .await;
        Mock::given(method("POST"))
            .and(path("/upload/drive/v3/files"))
            .and(query_param("uploadType", "multipart"))
            .respond_with(ResponseTemplate::new(200).set_body_json(file_json(
                "new1",
                "受信トレイ.xlsx",
                "md5-n",
            )))
            .expect(1)
            .mount(&server)
            .await;
        let bytes = vec![0x50u8, 0x4b, 0x03, 0x04, 0, 255, 13, 10];
        let got = b
            .upload("受信トレイ.xlsx", None, bytes.clone())
            .await
            .unwrap();
        assert_eq!(got, rf("new1", "受信トレイ.xlsx", "md5-n"));

        let post = &sent(&server, "POST").await;
        let post = post
            .iter()
            .find(|r| r.url.path() == "/upload/drive/v3/files")
            .unwrap();
        let ct = post
            .headers
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let boundary = ct.strip_prefix("multipart/related; boundary=").unwrap();
        let text = String::from_utf8_lossy(&post.body).into_owned();
        let parts: Vec<&str> = text.split(&format!("--{boundary}")).collect();
        // "", metadata part, media part, "--" tail
        assert_eq!(parts.len(), 4);
        assert!(parts[1].starts_with("\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"));
        let meta: serde_json::Value =
            serde_json::from_str(parts[1].split_once("\r\n\r\n").unwrap().1.trim_end()).unwrap();
        assert_eq!(
            meta,
            json!({"name": "受信トレイ.xlsx", "parents": ["root1"]})
        );
        assert!(parts[2].starts_with(&format!("\r\nContent-Type: {XLSX_MIME}\r\n\r\n")));
        assert!(
            post.body
                .windows(bytes.len())
                .any(|w| w == bytes.as_slice())
        );
        assert_eq!(parts[3], "--");
        assert_eq!(param(post, "fields").unwrap(), FILE_FIELDS);
    }

    #[tokio::test]
    async fn a_new_file_over_an_existing_name_is_a_precondition_failure() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        mount_list(
            &server,
            "'root1' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder' and name='a.xlsx'",
            json!({"files": [{"id": "other"}]}),
        )
        .await;
        let err = b.upload("a.xlsx", None, vec![1]).await.unwrap_err();
        assert!(matches!(err, BackendError::Precondition));
        // Nothing was written.
        assert!(sent(&server, "POST").await.is_empty());
    }

    #[tokio::test]
    async fn quotes_and_backslashes_in_a_name_are_escaped_in_the_query() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        mount_list(
            &server,
            r"'root1' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder' and name='it\'s\\a.xlsx'",
            json!({"files": [{"id": "other"}]}),
        )
        .await;
        assert!(matches!(
            b.upload(r"it's\a.xlsx", None, vec![1]).await,
            Err(BackendError::Precondition)
        ));
    }

    #[tokio::test]
    async fn an_update_checks_the_version_then_patches_the_media() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/f1"))
            .and(query_param("fields", "md5Checksum,trashed,name,parents"))
            .respond_with(ResponseTemplate::new(200).set_body_json(live_meta("md5-1")))
            .mount(&server)
            .await;
        Mock::given(method("PATCH"))
            .and(path("/upload/drive/v3/files/f1"))
            .and(query_param("uploadType", "media"))
            .and(header("content-type", XLSX_MIME))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(file_json("f1", "a.xlsx", "md5-2")),
            )
            .expect(1)
            .mount(&server)
            .await;
        let got = b
            .upload("a.xlsx", Some(&rf("f1", "a.xlsx", "md5-1")), vec![9, 9, 9])
            .await
            .unwrap();
        assert_eq!(got.version, "md5-2");
        assert_eq!(sent(&server, "PATCH").await[0].body, vec![9u8, 9, 9]);
        // The check came before the write.
        let order: Vec<(String, String)> = server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .filter(|r| r.url.path().contains("/files/f1"))
            .map(|r| (r.method.to_string(), r.url.path().to_string()))
            .collect();
        assert_eq!(
            order,
            [
                ("GET".to_string(), "/drive/v3/files/f1".to_string()),
                ("PATCH".to_string(), "/upload/drive/v3/files/f1".to_string())
            ]
        );
    }

    #[tokio::test]
    async fn an_update_of_a_changed_trashed_or_gone_file_writes_nothing() {
        for (status, body) in [
            (200, live_meta("someone-else")),
            (
                200,
                json!({"md5Checksum": "md5-1", "trashed": true, "name": "a.xlsx", "parents": ["root1"]}),
            ),
            (
                200,
                json!({"trashed": false, "name": "a.xlsx", "parents": ["root1"]}),
            ),
            // Moved into the archive (another PC archived it), content unchanged.
            (
                200,
                json!({"md5Checksum": "md5-1", "trashed": false, "name": "a (2026-10-16 0930).xlsx", "parents": ["arch1"]}),
            ),
            // Moved but still named alike, and no parents at all.
            (
                200,
                json!({"md5Checksum": "md5-1", "trashed": false, "name": "a.xlsx", "parents": ["arch1"]}),
            ),
            (
                200,
                json!({"md5Checksum": "md5-1", "trashed": false, "name": "a.xlsx"}),
            ),
            // Renamed in the browser, still in the root.
            (
                200,
                json!({"md5Checksum": "md5-1", "trashed": false, "name": "renamed.xlsx", "parents": ["root1"]}),
            ),
            (404, json!({"error": {"code": 404}})),
        ] {
            let server = MockServer::start().await;
            let b = backend(&server).await;
            mount_root(&server).await;
            Mock::given(method("GET"))
                .and(path("/drive/v3/files/f1"))
                .respond_with(ResponseTemplate::new(status).set_body_json(body.clone()))
                .mount(&server)
                .await;
            let err = b
                .upload("a.xlsx", Some(&rf("f1", "a.xlsx", "md5-1")), vec![1])
                .await
                .unwrap_err();
            assert!(matches!(err, BackendError::Precondition), "{body}");
            assert!(sent(&server, "PATCH").await.is_empty(), "{body}");
        }
    }

    #[tokio::test]
    async fn a_file_that_vanishes_between_the_check_and_the_patch_is_a_precondition_failure() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/f1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(live_meta("md5-1")))
            .mount(&server)
            .await;
        Mock::given(method("PATCH"))
            .and(path("/upload/drive/v3/files/f1"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        assert!(matches!(
            b.upload("a.xlsx", Some(&rf("f1", "a.xlsx", "md5-1")), vec![1])
                .await,
            Err(BackendError::Precondition)
        ));
    }

    const ARCHIVE_Q: &str = "mimeType='application/vnd.google-apps.folder' and appProperties has { key='powertodo' and value='archive' } and trashed=false and 'root1' in parents";

    #[tokio::test]
    async fn archiving_moves_and_renames_without_deleting() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        mount_list(&server, ARCHIVE_Q, json!({"files": [{"id": "arch1"}]})).await;
        let tag = local(MODIFIED).format("%Y-%m-%d %H%M").to_string();
        // The first name is taken already: the second is used.
        mount_list(
            &server,
            "'arch1' in parents and trashed=false",
            json!({"files": [{"name": format!("a ({tag}).xlsx")}, {"name": "other.xlsx"}]}),
        )
        .await;
        Mock::given(method("PATCH"))
            .and(path("/drive/v3/files/f1"))
            .and(query_param("addParents", "arch1"))
            .and(query_param("removeParents", "root1"))
            .and(body_json(json!({"name": format!("a ({tag}-2).xlsx")})))
            .respond_with(ResponseTemplate::new(200).set_body_json(file_json("f1", "x", "m")))
            .expect(1)
            .mount(&server)
            .await;
        b.move_to_archive(&rf("f1", "a.xlsx", "m")).await.unwrap();
        // No delete, no trash.
        assert!(sent(&server, "DELETE").await.is_empty());
    }

    #[tokio::test]
    async fn archiving_makes_the_archive_folder_and_forgives_a_file_that_is_gone() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        mount_list(&server, ARCHIVE_Q, json!({"files": []})).await;
        mount_list(
            &server,
            "'arch9' in parents and trashed=false",
            json!({"files": []}),
        )
        .await;
        Mock::given(method("POST"))
            .and(path("/drive/v3/files"))
            .and(body_json(json!({
                "name": "archive",
                "mimeType": "application/vnd.google-apps.folder",
                "appProperties": {"powertodo": "archive"},
                "parents": ["root1"]
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": "arch9"})))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("PATCH"))
            .and(path("/drive/v3/files/f1"))
            .and(query_param("addParents", "arch9"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        b.move_to_archive(&rf("f1", "a.xlsx", "m")).await.unwrap();
    }

    #[tokio::test]
    async fn a_401_renews_the_token_once_and_retries() {
        let server = MockServer::start().await;
        let counter = Arc::new(std::sync::atomic::AtomicU32::new(0));
        let c = Arc::clone(&counter);
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(move |_: &Request| {
                let n = c.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                ResponseTemplate::new(200)
                    .set_body_json(json!({"access_token": format!("at-{n}"), "expires_in": 3600}))
            })
            .mount(&server)
            .await;
        let b = GoogleDriveBackend::with_api_base(tokens(&server), &server.uri()).unwrap();
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/f1"))
            .and(header("authorization", "Bearer at-1"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/f1"))
            .and(header("authorization", "Bearer at-2"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"data".to_vec()))
            .mount(&server)
            .await;
        assert_eq!(b.download(&rf("f1", "a.xlsx", "m")).await.unwrap(), b"data");
        assert_eq!(counter.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn a_second_401_is_an_auth_error_and_an_invalid_grant_too() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/f1"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;
        assert!(matches!(
            b.download(&rf("f1", "a.xlsx", "m")).await,
            Err(BackendError::Auth)
        ));

        // Google refuses the refresh token itself.
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .respond_with(
                ResponseTemplate::new(400).set_body_json(json!({"error": "invalid_grant"})),
            )
            .mount(&server)
            .await;
        let b = GoogleDriveBackend::with_api_base(tokens(&server), &server.uri()).unwrap();
        assert!(matches!(b.list().await, Err(BackendError::Auth)));
    }

    #[test]
    fn statuses_map_to_the_backend_errors() {
        let reason =
            |r: &str| json!({"error": {"errors": [{"reason": r}], "code": 403}}).to_string();
        let st = |s: &str| json!({"error": {"status": s}}).to_string();
        let e = |code, body: &str| status_error(code, body.as_bytes());
        assert!(matches!(
            e(403, &reason("rateLimitExceeded")),
            BackendError::Offline(_)
        ));
        assert!(matches!(
            e(403, &reason("userRateLimitExceeded")),
            BackendError::Offline(_)
        ));
        assert!(matches!(
            e(403, &st("rateLimitExceeded")),
            BackendError::Offline(_)
        ));
        assert!(matches!(
            e(403, &reason("storageQuotaExceeded")),
            BackendError::Full
        ));
        assert!(matches!(
            e(403, &reason("forbidden")),
            BackendError::Forbidden
        ));
        assert!(matches!(
            e(403, &st("PERMISSION_DENIED")),
            BackendError::Forbidden
        ));
        assert!(matches!(e(403, "not json"), BackendError::Forbidden));
        assert!(matches!(e(429, ""), BackendError::Offline(_)));
        assert!(matches!(e(500, ""), BackendError::Offline(_)));
        assert!(matches!(e(503, ""), BackendError::Offline(_)));
        assert!(matches!(e(400, ""), BackendError::Other(_)));
        // Google's own text is not passed on.
        let leaky =
            json!({"error": {"message": "LEAK https://x?token=1", "errors": [{"reason": "x"}]}});
        assert!(!e(400, &leaky.to_string()).to_string().contains("LEAK"));
    }

    #[tokio::test]
    async fn http_errors_surface_through_the_backend() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        mount_root(&server).await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files"))
            .and(query_param("q", LIST_Q))
            .respond_with(
                ResponseTemplate::new(403).set_body_json(
                    json!({"error": {"errors": [{"reason": "storageQuotaExceeded"}]}}),
                ),
            )
            .mount(&server)
            .await;
        assert!(matches!(b.list().await, Err(BackendError::Full)));
    }

    #[test]
    fn multipart_related_has_two_parts_and_a_boundary_outside_the_content() {
        let (ct, body) = multipart_related("{\"a\":1}", "text/plain", b"hello");
        let boundary = ct.strip_prefix("multipart/related; boundary=").unwrap();
        let text = String::from_utf8(body).unwrap();
        assert_eq!(
            text,
            format!(
                "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{{\"a\":1}}\r\n--{boundary}\r\nContent-Type: text/plain\r\n\r\nhello\r\n--{boundary}--"
            )
        );
        assert_ne!(ct, multipart_related("{}", "text/plain", b"").0);
    }

    #[tokio::test]
    async fn debug_output_shows_no_token() {
        let server = MockServer::start().await;
        let b = backend(&server).await;
        b.list().await.ok();
        let text = format!("{b:?}");
        assert!(!text.contains("at-1") && !text.contains("refresh-token"));
    }
}
