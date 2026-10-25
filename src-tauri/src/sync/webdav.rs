//! The NAS side of the sync (spec sections 4.2 and 9): a folder on a WebDAV server, reached over
//! the tailnet through the sidecar's SOCKS5 proxy. [`WebDavBackend`] is the
//! [`StorageBackend`]; [`resolve_nas_url`] turns what the user typed into the URL it talks to.
//!
//! A file's `id` is its name (the folder is flat), so a listing's hrefs never have to be
//! replayed against a differently spelled base path.

use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use chrono::{DateTime, NaiveDateTime};
use percent_encoding::{AsciiSet, CONTROLS, percent_decode_str, utf8_percent_encode};
use unicode_normalization::UnicodeNormalization;
use url::{Host, Url};

use super::backend::{BackendError, BoxFut, RemoteFile, StorageBackend};
use super::tailnet::ResolveError;
use super::tls::install_crypto_provider;
use crate::store::project_store::archive_file_name;

/// The port a NAS WebDAV (HTTP) server listens on when the URL has none (Synology's default).
pub const DEFAULT_PORT: u16 = 5005;
const ARCHIVE_DIR: &str = "archive";
/// The comment files' folder in the target (spec ① §3.4).
const COMMENTS_DIR: &str = "_comments";
/// `COMMENTS_DIR` as the `dir` of `child_url`.
const COMMENTS_SUB: &str = "_comments/";
const COMMENTS_ID_PREFIX: &str = "_comments/";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// No byte for this long on a read (including waiting for the answer) ends the request.
const READ_TIMEOUT: Duration = Duration::from_secs(60);
/// The whole request, however slowly it keeps moving (an upload over a poor link).
const TOTAL_TIMEOUT: Duration = Duration::from_secs(600);
/// How many names `archive/` is tried with before giving up.
const MAX_ARCHIVE_NAMES: u32 = 50;
const OCTET_STREAM: &str = "application/octet-stream";

/// What `utf8_percent_encode` escapes in a path segment: everything but unreserved characters
/// and the harmless sub-delimiters. In particular space, `#`, `?`, `%` and `/`.
const PATH_SEGMENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'/')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'\\')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

fn encode_segment(name: &str) -> String {
    utf8_percent_encode(name, PATH_SEGMENT).to_string()
}

// ---------------------------------------------------------------------------------------------
// The URL the user types

/// Why what the user typed cannot be used as the NAS folder (the texts are shown as they are).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum NasUrlError {
    #[error("https は使えません (http://<NAS 名>:5005/<フォルダ>/ の形で入力してください)")]
    HttpsNotSupported,
    #[error("NAS の URL を読めません ({0})")]
    Invalid(String),
    #[error("NAS が tailnet にありません。NAS の Tailscale にログインしているか確認してください")]
    NotInTailnet,
    #[error("Tailscale に接続していません")]
    NotRunning,
    #[error("NAS の場所を調べられませんでした ({0})")]
    Resolve(String),
}

/// `http://<NAS 名>[:port]/<フォルダ>/` as typed → the URL to talk to: http only, the port
/// defaults to [`DEFAULT_PORT`], the path ends with `/`, and the host is replaced by the
/// tailnet address `resolve` finds for it (so no DNS outside the tailnet is ever asked).
/// A host that is not in the tailnet is an error, never a direct connection.
pub fn resolve_nas_url(
    input: &str,
    resolve: impl Fn(&str) -> Result<IpAddr, ResolveError>,
) -> Result<Url, NasUrlError> {
    let invalid = |why: &str| NasUrlError::Invalid(why.to_string());
    let input = input.trim();
    if input.is_empty() {
        return Err(invalid("空です"));
    }
    let with_scheme = match input.split_once("://") {
        Some((scheme, _)) if scheme.eq_ignore_ascii_case("https") => {
            return Err(NasUrlError::HttpsNotSupported);
        }
        Some((scheme, _)) if scheme.eq_ignore_ascii_case("http") => input.to_string(),
        Some((scheme, _)) => return Err(invalid(&format!("{scheme}:// は使えません"))),
        None => format!("http://{input}"),
    };
    let mut url = Url::parse(&with_scheme).map_err(|e| NasUrlError::Invalid(e.to_string()))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(invalid("ユーザー名とパスワードは別の欄に入力してください"));
    }
    let host = match url.host() {
        Some(Host::Domain(d)) => d.to_string(),
        Some(Host::Ipv4(ip)) => ip.to_string(),
        Some(Host::Ipv6(ip)) => ip.to_string(),
        None => return Err(invalid("NAS の名前がありません")),
    };
    // `:80` is the scheme's default and `Url` drops it; it was typed on purpose.
    let authority = with_scheme["http://".len()..]
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    if url.port().is_none() && !authority.ends_with(":80") {
        url.set_port(Some(DEFAULT_PORT))
            .map_err(|()| invalid("ポートを設定できません"))?;
    }
    url.set_query(None);
    url.set_fragment(None);
    if !url.path().ends_with('/') {
        let path = format!("{}/", url.path());
        url.set_path(&path);
    }
    let ip = resolve(&host).map_err(|e| match e {
        ResolveError::NotInTailnet => NasUrlError::NotInTailnet,
        ResolveError::NotRunning => NasUrlError::NotRunning,
        ResolveError::Timeout => NasUrlError::Resolve("応答がありません".into()),
        ResolveError::Failed(m) => NasUrlError::Resolve(m),
    })?;
    url.set_ip_host(ip)
        .map_err(|()| invalid("アドレスを設定できません"))?;
    Ok(url)
}

// ---------------------------------------------------------------------------------------------
// Backend

#[derive(Clone, Copy)]
struct Timeouts {
    connect: Duration,
    read: Duration,
    total: Duration,
}

pub struct WebDavBackend {
    http: reqwest::Client,
    /// Ends with `/`; no query or fragment.
    base: Url,
    user: String,
    password: String,
}

impl std::fmt::Debug for WebDavBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WebDavBackend")
            .field("base", &self.base.as_str())
            .field("user", &self.user)
            .field("password", &"<redacted>")
            .finish()
    }
}

impl WebDavBackend {
    /// `proxy`: `socks5h://127.0.0.1:port` (the tailnet sidecar). `None` connects directly
    /// and ignores the system proxy (tests only).
    pub fn new(
        base_url: Url,
        user: impl Into<String>,
        password: impl Into<String>,
        proxy: Option<String>,
    ) -> Result<Self, BackendError> {
        Self::with_timeouts(
            base_url,
            user.into(),
            password.into(),
            proxy,
            Timeouts {
                connect: CONNECT_TIMEOUT,
                read: READ_TIMEOUT,
                total: TOTAL_TIMEOUT,
            },
        )
    }

    fn with_timeouts(
        mut base: Url,
        user: String,
        password: String,
        proxy: Option<String>,
        timeouts: Timeouts,
    ) -> Result<Self, BackendError> {
        if base.cannot_be_a_base() || !matches!(base.scheme(), "http" | "https") {
            return Err(BackendError::Other("NAS の URL が正しくありません".into()));
        }
        // Credentials belong in their own fields (the URL ends up in settings and logs).
        if !base.username().is_empty() || base.password().is_some() {
            return Err(BackendError::Other(
                "NAS の URL にユーザー名とパスワードは含められません".into(),
            ));
        }
        install_crypto_provider();
        base.set_query(None);
        base.set_fragment(None);
        // Both spellings of the folder (with and without the last slash) are the same folder.
        let path = format!("{}/", base.path().trim_end_matches('/'));
        base.set_path(&path);
        let mut builder = reqwest::Client::builder()
            // A redirect would resend the credentials somewhere we did not choose.
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(timeouts.connect)
            .read_timeout(timeouts.read)
            .timeout(timeouts.total);
        builder = match proxy {
            // The error would quote the proxy URL, which may carry the proxy's credentials.
            Some(p) => builder.proxy(
                reqwest::Proxy::all(p.as_str())
                    .map_err(|_| BackendError::Other("プロキシの設定が正しくありません".into()))?,
            ),
            None => builder.no_proxy(),
        };
        let http = builder
            .build()
            .map_err(|e| BackendError::Other(format!("HTTP クライアントを作れません: {e}")))?;
        Ok(WebDavBackend {
            http,
            base,
            user,
            password,
        })
    }

    fn file_url(&self, name: &str) -> Result<Url, BackendError> {
        self.file_url_in("", name)
    }

    /// `name` in the folder `dir` (`""` = the root, else `"_comments/"`).
    fn file_url_in(&self, dir: &str, name: &str) -> Result<Url, BackendError> {
        if !safe_name(name) {
            return Err(BackendError::Other(format!(
                "使えないファイル名です: {name}"
            )));
        }
        self.child_url(dir, name)
    }

    fn comments_url(&self) -> Url {
        Url::parse(&format!("{}{COMMENTS_DIR}/", self.base)).expect("base plus a plain segment")
    }

    fn archive_url(&self) -> Url {
        Url::parse(&format!("{}{ARCHIVE_DIR}/", self.base)).expect("base plus a plain segment")
    }

    fn child_url(&self, dir: &str, name: &str) -> Result<Url, BackendError> {
        Url::parse(&format!("{}{dir}{}", self.base, encode_segment(name)))
            .map_err(|e| BackendError::Other(format!("URL を作れません: {e}")))
    }

    /// One request; any status comes back (see [`check_status`]).
    async fn send(
        &self,
        method: &str,
        url: Url,
        headers: &[(&str, &str)],
        body: Option<Vec<u8>>,
    ) -> Result<reqwest::Response, BackendError> {
        let method = reqwest::Method::from_bytes(method.as_bytes()).expect("valid method");
        let mut req = self
            .http
            .request(method, url)
            .basic_auth(&self.user, Some(&self.password));
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        if let Some(b) = body {
            req = req.body(b);
        }
        req.send().await.map_err(transport)
    }

    async fn propfind(&self, url: Url, depth: &str) -> Result<Option<Vec<Entry>>, BackendError> {
        let resp = self
            .send(
                "PROPFIND",
                url,
                &[("Depth", depth), ("Content-Type", "application/xml")],
                Some(PROPFIND_BODY.as_bytes().to_vec()),
            )
            .await?;
        if resp.status().as_u16() == 404 {
            return Ok(None);
        }
        let resp = check_status(resp)?;
        if resp.status().as_u16() != 207 {
            return Err(unexpected_propfind());
        }
        let text = resp.text().await.map_err(transport)?;
        parse_multistatus(&text).map(Some)
    }

    /// The properties of one file of the folder `dir`: `None` when it does not exist.
    async fn stat_in(&self, dir: &str, name: &str) -> Result<Option<Entry>, BackendError> {
        let entries = self.propfind(self.file_url_in(dir, name)?, "0").await?;
        Ok(entries.and_then(|e| e.into_iter().next()))
    }

    async fn list_files(&self) -> Result<Vec<RemoteFile>, BackendError> {
        let entries = self
            .propfind(self.base.clone(), "1")
            .await?
            .ok_or_else(folder_missing)?;
        self.files_of(self.base.clone(), entries, ".xlsx")
    }

    /// The comment files: `_comments/` that does not exist (yet) has none.
    async fn list_comment_files(&self) -> Result<Vec<RemoteFile>, BackendError> {
        let url = self.comments_url();
        let files = match self.propfind(url.clone(), "1").await? {
            Some(entries) => self.files_of(url, entries, ".jsonl")?,
            None => Vec::new(),
        };
        Ok(files.into_iter().map(in_comments).collect())
    }

    /// The files directly in the folder `url` whose name ends in `suffix`, from its PROPFIND entries.
    fn files_of(
        &self,
        url: Url,
        entries: Vec<Entry>,
        suffix: &str,
    ) -> Result<Vec<RemoteFile>, BackendError> {
        let folder = norm(
            percent_decode_str(url.path())
                .decode_utf8()
                .map_err(|_| unexpected_propfind())?
                .trim_end_matches('/'),
        );
        let mut files = Vec::new();
        for e in entries {
            if e.is_collection {
                continue;
            }
            let raw = href_path(&e.href).to_string();
            // Only workbooks matter, and `is_sync_target` takes the exact lower-case `.xlsx`.
            // Checked before decoding so an oddly encoded file of another kind cannot fail
            // the whole listing.
            if !raw.ends_with(suffix) {
                continue;
            }
            let path = percent_decode_str(&raw)
                .decode_utf8()
                .map_err(|_| BackendError::Other(format!("名前を読めません: {raw}")))?;
            // The folder itself, in case the server left out its resourcetype.
            let Some((parent, name)) = path.rsplit_once('/') else {
                return Err(BackendError::Other(format!(
                    "想定外の場所のファイルです: {raw}"
                )));
            };
            // Compared in NFC (a server may keep names decomposed, macOS does) and without
            // regard to ASCII case (Synology share names are case-insensitive). A file that
            // is not in this folder at all means the listing cannot be trusted: fail instead
            // of returning less. Files deeper down are not ours.
            let parent = norm(parent);
            if parent.eq_ignore_ascii_case(&folder) {
                if safe_name(name) {
                    files.push(remote_file(name, e)?);
                }
            } else if !strip_prefix_ci(&parent, &folder).is_some_and(|r| r.starts_with('/')) {
                return Err(BackendError::Other(format!(
                    "想定外の場所のファイルです: {raw}"
                )));
            }
        }
        Ok(files)
    }

    async fn upload_file(
        &self,
        name: &str,
        existing: Option<&RemoteFile>,
        bytes: Vec<u8>,
    ) -> Result<RemoteFile, BackendError> {
        self.upload_in("", name, existing, bytes).await
    }

    /// Makes the folder `url` (a folder that is already there is fine).
    async fn make_folder(&self, url: Url) -> Result<(), BackendError> {
        let made = self.send("MKCOL", url, &[], None).await?;
        // 405: the folder is already there.
        if made.status().as_u16() != 405 {
            check_status(made)?;
        }
        Ok(())
    }

    async fn upload_in(
        &self,
        dir: &str,
        name: &str,
        existing: Option<&RemoteFile>,
        bytes: Vec<u8>,
    ) -> Result<RemoteFile, BackendError> {
        let url = self.file_url_in(dir, name)?;
        let mut headers = vec![("Content-Type", OCTET_STREAM)];
        match existing {
            // No etag to send: the version was made of the timestamp and the size. Look at the
            // file right before writing; a server that ignores `If-Match` cannot be helped, but
            // this is the best a bare listing allows.
            Some(e) if is_synthesized(&e.version) => {
                let unchanged = self.stat_in(dir, name).await?.is_some_and(|now| {
                    now.last_modified
                        .as_deref()
                        .is_some_and(|lm| synthesize(lm, now.length) == e.version)
                });
                if !unchanged {
                    return Err(BackendError::Precondition);
                }
            }
            Some(e) => headers.push(("If-Match", &e.version)),
            None => headers.push(("If-None-Match", "*")),
        }
        let mut resp = self
            .send("PUT", url.clone(), &headers, Some(bytes.clone()))
            .await?;
        if resp.status().as_u16() == 412 {
            let Some(e) = existing.filter(|e| !is_synthesized(&e.version)) else {
                return Err(BackendError::Precondition);
            };
            // Either the file changed, or the server compares etags strongly and only has weak
            // ones (`If-Match` then never matches). Look once: the same tag means the latter,
            // and the write goes out without the condition (the same small window as for a
            // server without etags).
            let now = self.stat_in(dir, name).await?.and_then(|n| n.etag);
            if now.as_deref().map(normalize_etag) != Some(e.version.as_str()) {
                return Err(BackendError::Precondition);
            }
            let plain = [("Content-Type", OCTET_STREAM)];
            resp = self.send("PUT", url, &plain, Some(bytes)).await?;
            if resp.status().as_u16() == 412 {
                return Err(BackendError::Precondition);
            }
        }
        check_status(resp)?;
        let entry = self
            .stat_in(dir, name)
            .await?
            .ok_or_else(|| BackendError::Other(format!("「{name}」を書き込めませんでした")))?;
        remote_file(name, entry)
    }

    async fn archive_file(&self, file: &RemoteFile) -> Result<(), BackendError> {
        self.archive_in("", file).await
    }

    async fn archive_in(&self, folder: &str, file: &RemoteFile) -> Result<(), BackendError> {
        let src = self.file_url_in(folder, &file.name)?;
        let dir = self.archive_url();
        self.make_folder(dir.clone()).await?;
        // Never overwrite an earlier archived copy: `<stem> (<modified>).xlsx`, then `-2`, `-3`,
        // ... like the local `archive/` (a comment file keeps its `.jsonl`).
        let (stem, ext) = match file.name.strip_suffix(".jsonl") {
            Some(stem) => (stem, ".jsonl"),
            None => (
                file.name.strip_suffix(".xlsx").unwrap_or(&file.name),
                ".xlsx",
            ),
        };
        let tag = file.modified.format("%Y-%m-%d %H%M").to_string();
        for n in 1..=MAX_ARCHIVE_NAMES {
            let archived = archive_file_name(stem, &tag, n);
            let archived = match ext {
                ".jsonl" => format!(
                    "{}.jsonl",
                    archived.strip_suffix(".xlsx").unwrap_or(&archived)
                ),
                _ => archived,
            };
            let dest = format!("{dir}{}", encode_segment(&archived));
            let moved = self
                .send(
                    "MOVE",
                    src.clone(),
                    &[("Destination", &dest), ("Overwrite", "F")],
                    None,
                )
                .await?;
            match moved.status().as_u16() {
                // Gone already (another PC archived it): the file is no longer in the folder.
                404 => return Ok(()),
                // The destination exists.
                412 => continue,
                _ => return check_status(moved).map(|_| ()),
            }
        }
        Err(BackendError::Other(format!(
            "同期先の archive に「{}」の控えが多すぎて移せません",
            file.name
        )))
    }

    /// 「確かめる」: writes a small file, reads it back and deletes it. Fails with what the
    /// user can act on: the folder is missing, the credentials are wrong, writing is not
    /// allowed, the server changed the content.
    pub async fn check(&self) -> Result<(), BackendError> {
        self.propfind(self.base.clone(), "0")
            .await?
            .ok_or_else(folder_missing)?;
        let name = format!("powertodo-check-{}.txt", unique_token());
        let url = self.file_url(&name)?;
        let payload = format!("powertodo check {name}").into_bytes();
        let put = self
            .send(
                "PUT",
                url.clone(),
                &[("Content-Type", "text/plain")],
                Some(payload.clone()),
            )
            .await?;
        check_status(put)?;
        let got = async {
            let resp = check_status(self.send("GET", url.clone(), &[], None).await?)?;
            resp.bytes().await.map(|b| b.to_vec()).map_err(transport)
        }
        .await;
        // Always clean up, also when reading failed.
        let deleted = match self.send("DELETE", url, &[], None).await {
            Ok(resp) if resp.status().as_u16() == 404 => Ok(()),
            Ok(resp) => check_status(resp).map(|_| ()),
            Err(e) => Err(e),
        };
        if got? != payload {
            return Err(BackendError::Other(
                "書き込んだ内容と読み込んだ内容が違います".into(),
            ));
        }
        deleted
    }
}

impl StorageBackend for WebDavBackend {
    fn list(&self) -> BoxFut<'_, Vec<RemoteFile>> {
        Box::pin(self.list_files())
    }

    fn download<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, Vec<u8>> {
        Box::pin(async move {
            // A comment file's id carries its folder (see `in_comments`).
            let dir = if file.id.starts_with(COMMENTS_ID_PREFIX) {
                COMMENTS_SUB
            } else {
                ""
            };
            let url = self.file_url_in(dir, &file.name)?;
            let resp = check_status(self.send("GET", url, &[], None).await?)?;
            resp.bytes().await.map(|b| b.to_vec()).map_err(transport)
        })
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
            self.make_folder(self.comments_url()).await?;
            self.upload_in(COMMENTS_SUB, name, existing, bytes)
                .await
                .map(in_comments)
        })
    }

    fn archive_comment<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, ()> {
        Box::pin(self.archive_in(COMMENTS_SUB, file))
    }
}

/// A file of `_comments/`: its id carries the folder, so `download` finds it.
fn in_comments(f: RemoteFile) -> RemoteFile {
    RemoteFile {
        id: format!("{COMMENTS_ID_PREFIX}{}", f.name),
        ..f
    }
}

// ---------------------------------------------------------------------------------------------
// Responses

/// A name is one plain path segment: no separators, no `.` or `..`.
fn safe_name(name: &str) -> bool {
    !(name.is_empty()
        || name == "."
        || name == ".."
        || name.contains(['/', '\\'])
        || name.chars().any(char::is_control))
}

fn norm(s: &str) -> String {
    s.nfc().collect()
}

/// `W/"x"` and `"x"` are one version: a server may call a tag weak at one time and strong at
/// another, and that is not a change of the file. The stored (and sent) form is the strong one.
fn normalize_etag(etag: &str) -> &str {
    etag.strip_prefix("W/").unwrap_or(etag)
}

fn folder_missing() -> BackendError {
    BackendError::Other("同期先のフォルダが見つかりません".into())
}

fn unexpected_propfind() -> BackendError {
    BackendError::Other("同期先の応答を読めません (PROPFIND)".into())
}

fn transport(e: reqwest::Error) -> BackendError {
    // The texts never quote the URL (the proxy's may hold credentials).
    if e.is_builder() {
        BackendError::Other("リクエストを作れません".into())
    } else if e.is_timeout() {
        BackendError::Offline("NAS への接続がタイムアウトしました".into())
    } else if e.is_connect() {
        BackendError::Offline("NAS に接続できません".into())
    } else {
        // A connection cut short and the like: also "try again later".
        BackendError::Offline("NAS との通信が途中で切れました".into())
    }
}

/// The error for an unsuccessful status; callers that give a status a special meaning (412, 404,
/// 405) look at it before this.
fn status_error(code: u16) -> BackendError {
    match code {
        401 => BackendError::Auth,
        507 | 413 => BackendError::Full,
        403 => BackendError::Forbidden,
        300..=399 => BackendError::Other("リダイレクトされました".into()),
        408 | 429 | 500..=599 => BackendError::Offline(format!("HTTP {code}")),
        _ => BackendError::Other(format!("HTTP {code}")),
    }
}

fn check_status(resp: reqwest::Response) -> Result<reqwest::Response, BackendError> {
    if resp.status().is_success() {
        Ok(resp)
    } else {
        Err(status_error(resp.status().as_u16()))
    }
}

/// A name nobody else uses at the same time (the check file).
fn unique_token() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    format!(
        "{nanos:x}-{:x}-{:x}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

/// When the server sends no etag: the version is the timestamp as sent plus the size.
fn synthesize(last_modified: &str, length: Option<u64>) -> String {
    format!("{}|{}", last_modified.trim(), length.unwrap_or(0))
}

/// Whether `version` came from [`synthesize`] (an etag is quoted, never an RFC 2822 date plus
/// `|`).
fn is_synthesized(version: &str) -> bool {
    version
        .split_once('|')
        .is_some_and(|(lm, _)| DateTime::parse_from_rfc2822(lm).is_ok())
}

fn remote_file(name: &str, e: Entry) -> Result<RemoteFile, BackendError> {
    let raw = e
        .last_modified
        .ok_or_else(|| BackendError::Other(format!("「{name}」の更新日時を読めません")))?;
    let modified: NaiveDateTime = DateTime::parse_from_rfc2822(raw.trim())
        .map_err(|err| BackendError::Other(format!("「{name}」の更新日時を読めません ({err})")))?
        .with_timezone(&chrono::Local)
        .naive_local();
    let version = match e.etag.filter(|t| !t.is_empty()) {
        Some(etag) => normalize_etag(&etag).to_string(),
        None => synthesize(&raw, e.length),
    };
    Ok(RemoteFile {
        id: name.to_string(),
        name: name.to_string(),
        version,
        modified,
        size: e.length.unwrap_or(0),
    })
}

// ---------------------------------------------------------------------------------------------
// PROPFIND

const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:getetag/><D:getlastmodified/><D:getcontentlength/><D:resourcetype/></D:prop></D:propfind>"#;

#[derive(Debug, Default)]
struct Entry {
    href: String,
    etag: Option<String>,
    last_modified: Option<String>,
    length: Option<u64>,
    is_collection: bool,
}

/// The path part of an `href`, which may be absolute (`http://host/path`).
fn href_path(href: &str) -> &str {
    let href = href.trim();
    match href.find("://") {
        Some(i) => match href[i + 3..].find('/') {
            Some(j) => &href[i + 3 + j..],
            None => "/",
        },
        None => href,
    }
}

fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let head = s.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &s[prefix.len()..])
}

/// One `propstat`: only one whose status is 200 (or absent) is trusted.
#[derive(Default)]
struct PropStat {
    etag: Option<String>,
    last_modified: Option<String>,
    length: Option<u64>,
    is_collection: bool,
    status: Option<String>,
}

impl PropStat {
    fn ok(&self) -> bool {
        match &self.status {
            None => true,
            Some(s) => s.split_whitespace().nth(1) == Some("200"),
        }
    }
}

/// Parses a `207 Multi-Status` body. Elements are matched by local name, so any prefix for
/// the `DAV:` namespace (`D:`, `d:`, none) works.
fn parse_multistatus(xml: &str) -> Result<Vec<Entry>, BackendError> {
    use quick_xml::XmlVersion;
    use quick_xml::events::Event;
    let bad = |e: &dyn std::fmt::Display| {
        BackendError::Other(format!("同期先の応答を読めません (PROPFIND: {e})"))
    };
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut entries = Vec::new();
    let mut current: Option<Entry> = None;
    let mut seen_root = false;
    let mut prop: Option<PropStat> = None;
    let mut field: Option<String> = None;
    let mut text = String::new();
    loop {
        match reader.read_event().map_err(|e| bad(&e))? {
            Event::Start(e) => {
                let name = e.local_name().as_ref().to_string();
                match name.as_str() {
                    "multistatus" => seen_root = true,
                    "response" => current = Some(Entry::default()),
                    "propstat" => prop = Some(PropStat::default()),
                    "href" | "getetag" | "getlastmodified" | "getcontentlength" | "status" => {
                        field = Some(name);
                        text.clear();
                    }
                    "collection" => {
                        if let Some(p) = prop.as_mut() {
                            p.is_collection = true;
                        }
                    }
                    _ => {}
                }
            }
            Event::Empty(e) => {
                let name = e.local_name().as_ref().to_string();
                if name == "multistatus" {
                    seen_root = true;
                } else if name == "collection"
                    && let Some(p) = prop.as_mut()
                {
                    p.is_collection = true;
                }
            }
            Event::Text(t) => {
                if field.is_some() {
                    text.push_str(&t.xml_content(XmlVersion::Implicit1_0));
                }
            }
            // `&quot;` around an etag, `&amp;` in a name.
            Event::GeneralRef(r) => {
                if field.is_some() {
                    if let Ok(Some(c)) = r.resolve_char_ref() {
                        text.push(c);
                    } else if let Some(s) = quick_xml::escape::resolve_xml_entity(
                        &r.xml_content(XmlVersion::Implicit1_0),
                    ) {
                        text.push_str(s);
                    }
                }
            }
            Event::End(e) => {
                let name = e.local_name().as_ref().to_string();
                if name == "response" {
                    if let Some(c) = current.take() {
                        entries.push(c);
                    }
                } else if name == "propstat" {
                    if let (Some(p), Some(c)) = (prop.take(), current.as_mut())
                        && p.ok()
                    {
                        c.is_collection |= p.is_collection;
                        c.etag = c.etag.take().or(p.etag);
                        c.last_modified = c.last_modified.take().or(p.last_modified);
                        c.length = c.length.or(p.length);
                    }
                } else if field.as_deref() == Some(name.as_str()) {
                    let value = text.trim().to_string();
                    match name.as_str() {
                        "href" => {
                            if let Some(c) = current.as_mut() {
                                c.href = value;
                            }
                        }
                        "getetag" => {
                            if let Some(p) = prop.as_mut() {
                                p.etag = Some(value).filter(|v| !v.is_empty());
                            }
                        }
                        "getlastmodified" => {
                            if let Some(p) = prop.as_mut() {
                                p.last_modified = Some(value).filter(|v| !v.is_empty());
                            }
                        }
                        "getcontentlength" => {
                            if let Some(p) = prop.as_mut() {
                                p.length = value.parse().ok();
                            }
                        }
                        _ => {
                            if let Some(p) = prop.as_mut() {
                                p.status = Some(value);
                            }
                        }
                    }
                    field = None;
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !seen_root {
        return Err(unexpected_propfind());
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, SocketAddr};
    use std::sync::{Arc, Mutex};
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

    const FOLDER: &str = "/powertodo/";
    const JA: &str = "%E5%8F%97%E4%BF%A1%E3%83%88%E3%83%AC%E3%82%A4.xlsx";
    const LM: &str = "Wed, 14 Oct 2026 03:21:09 GMT";

    fn backend(server: &MockServer) -> WebDavBackend {
        WebDavBackend::new(
            Url::parse(&format!("{}{FOLDER}", server.uri())).unwrap(),
            "taro",
            "pw",
            None,
        )
        .unwrap()
    }

    fn local(rfc2822: &str) -> NaiveDateTime {
        DateTime::parse_from_rfc2822(rfc2822)
            .unwrap()
            .with_timezone(&chrono::Local)
            .naive_local()
    }

    /// A `<D:response>` for a file.
    fn file_response(href: &str, etag: Option<&str>, lm: &str, len: u64) -> String {
        let etag = etag.map_or(String::new(), |t| format!("<D:getetag>{t}</D:getetag>"));
        format!(
            "<D:response><D:href>{href}</D:href><D:propstat><D:prop>{etag}\
             <D:getlastmodified>{lm}</D:getlastmodified><D:getcontentlength>{len}</D:getcontentlength>\
             <D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>"
        )
    }

    fn collection_response(href: &str) -> String {
        format!(
            "<D:response><D:href>{href}</D:href><D:propstat><D:prop>\
             <D:getlastmodified>{LM}</D:getlastmodified>\
             <D:resourcetype><D:collection/></D:resourcetype></D:prop>\
             <D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>"
        )
    }

    fn multistatus(responses: &[String]) -> String {
        format!(
            r#"<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">{}</D:multistatus>"#,
            responses.concat()
        )
    }

    async fn mount(server: &MockServer, verb: &str, p: &str, status: u16, body: &str) {
        Mock::given(method(verb))
            .and(path(p))
            .respond_with(ResponseTemplate::new(status).set_body_string(body.to_string()))
            .mount(server)
            .await;
    }

    async fn requests(server: &MockServer) -> Vec<Request> {
        server.received_requests().await.unwrap()
    }

    fn header_of(r: &Request, name: &str) -> Option<String> {
        r.headers.get(name).map(|v| v.to_str().unwrap().to_string())
    }

    fn listing() -> String {
        multistatus(&[
            collection_response(FOLDER),
            collection_response("/powertodo/archive/"),
            file_response(
                &format!("/powertodo/{JA}"),
                Some("&quot;abc123&quot;"),
                LM,
                2048,
            ),
            file_response(
                "/powertodo/%E4%BB%95%E4%BA%8B%20%231%3F%25.xlsx",
                Some("W/&quot;weak&quot;"),
                "Tue, 13 Oct 2026 23:59:59 GMT",
                10,
            ),
            file_response(
                "/powertodo/p0.xlsx",
                None,
                "Mon, 12 Oct 2026 01:02:03 GMT",
                7,
            ),
            file_response("/powertodo/notes.txt", None, LM, 1),
            file_response("/powertodo/%FF%FE.dat", None, LM, 1),
            file_response("/powertodo/Upper.XLSX", None, LM, 1),
            file_response("/powertodo/~$p0.xlsx", None, LM, 1),
        ])
    }

    // --- list ----------------------------------------------------------------------------

    #[tokio::test]
    async fn list_reads_names_versions_and_times() {
        let s = MockServer::start().await;
        Mock::given(method("PROPFIND"))
            .and(path(FOLDER))
            .and(header("depth", "1"))
            .and(header("authorization", "Basic dGFybzpwdw=="))
            .respond_with(ResponseTemplate::new(207).set_body_string(listing()))
            .mount(&s)
            .await;
        let files = backend(&s).list().await.unwrap();
        // The folder, `archive/` and the non-workbooks (`notes.txt`, `.XLSX`) are left out; the Excel
        // lock file is a workbook name as far as the backend is concerned (the plan drops it).
        assert_eq!(
            files,
            vec![
                RemoteFile {
                    id: "受信トレイ.xlsx".into(),
                    name: "受信トレイ.xlsx".into(),
                    version: "\"abc123\"".into(),
                    modified: local(LM),
                    size: 2048,
                },
                RemoteFile {
                    id: "仕事 #1?%.xlsx".into(),
                    name: "仕事 #1?%.xlsx".into(),
                    version: "\"weak\"".into(),
                    modified: local("Tue, 13 Oct 2026 23:59:59 GMT"),
                    size: 10,
                },
                RemoteFile {
                    id: "p0.xlsx".into(),
                    name: "p0.xlsx".into(),
                    version: "Mon, 12 Oct 2026 01:02:03 GMT|7".into(),
                    modified: local("Mon, 12 Oct 2026 01:02:03 GMT"),
                    size: 7,
                },
                RemoteFile {
                    id: "~$p0.xlsx".into(),
                    name: "~$p0.xlsx".into(),
                    version: format!("{LM}|1"),
                    modified: local(LM),
                    size: 1,
                },
            ]
        );
        assert!(is_synthesized(&files[2].version));
        assert!(!is_synthesized(&files[0].version));
        assert!(!is_synthesized(&files[1].version));
        // `Upper.XLSX` and the badly encoded `.dat` are skipped, not fatal.
    }

    // --- the _comments folder (spec ① §3.4) ----------------------------------------------

    #[tokio::test]
    async fn comments_listing_of_a_missing_folder_is_empty() {
        let s = MockServer::start().await;
        mount(&s, "PROPFIND", "/powertodo/_comments/", 404, "").await;
        assert!(backend(&s).list_comments().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn comments_listing_reads_jsonl_files() {
        let s = MockServer::start().await;
        let body = multistatus(&[
            collection_response("/powertodo/_comments/"),
            file_response(
                "/powertodo/_comments/%E4%BB%95%E4%BA%8B.12.jsonl",
                Some("&quot;e1&quot;"),
                LM,
                40,
            ),
            file_response("/powertodo/_comments/notes.txt", None, LM, 1),
        ]);
        mount(&s, "PROPFIND", "/powertodo/_comments/", 207, &body).await;
        let files = backend(&s).list_comments().await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "仕事.12.jsonl");
        assert_eq!(files[0].id, "_comments/仕事.12.jsonl");
    }

    #[tokio::test]
    async fn comment_upload_makes_the_folder_and_puts_inside_it() {
        let s = MockServer::start().await;
        mount(&s, "MKCOL", "/powertodo/_comments/", 201, "").await;
        mount(&s, "PUT", "/powertodo/_comments/a.1.jsonl", 201, "").await;
        let stat = multistatus(&[file_response(
            "/powertodo/_comments/a.1.jsonl",
            Some("&quot;v1&quot;"),
            LM,
            3,
        )]);
        mount(&s, "PROPFIND", "/powertodo/_comments/a.1.jsonl", 207, &stat).await;
        let f = backend(&s)
            .upload_comment("a.1.jsonl", None, b"x\n".to_vec())
            .await
            .unwrap();
        assert_eq!(
            (f.name.as_str(), f.id.as_str(), f.version.as_str()),
            ("a.1.jsonl", "_comments/a.1.jsonl", "\"v1\"")
        );
        let reqs = requests(&s).await;
        let put = reqs.iter().find(|r| r.method.as_str() == "PUT").unwrap();
        assert_eq!(header_of(put, "if-none-match").as_deref(), Some("*"));
        assert!(reqs.iter().any(|r| r.method.as_str() == "MKCOL"));
    }

    #[tokio::test]
    async fn comment_download_reads_from_the_folder() {
        let s = MockServer::start().await;
        mount(&s, "GET", "/powertodo/_comments/a.1.jsonl", 200, "line\n").await;
        let f = RemoteFile {
            id: "_comments/a.1.jsonl".into(),
            name: "a.1.jsonl".into(),
            version: "v".into(),
            modified: local(LM),
            size: 5,
        };
        assert_eq!(backend(&s).download(&f).await.unwrap(), b"line\n");
    }

    #[tokio::test]
    async fn list_accepts_other_dav_prefixes_absolute_hrefs_and_a_differently_cased_folder() {
        let s = MockServer::start().await;
        let body = format!(
            r#"<?xml version="1.0"?><multistatus xmlns="DAV:">
            <response><href>http://nas:5005/PowerToDo</href><propstat><prop><resourcetype><collection/></resourcetype></prop></propstat></response>
            <response><href>http://nas:5005/PowerToDo/a.xlsx</href><propstat><prop>
              <getetag>"e1"</getetag><getlastmodified>{LM}</getlastmodified><getcontentlength>5</getcontentlength><resourcetype/>
            </prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>"#
        );
        mount(&s, "PROPFIND", FOLDER, 207, &body).await;
        let files = backend(&s).list().await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "a.xlsx");
        assert_eq!(files[0].version, "\"e1\"");
    }

    #[tokio::test]
    async fn properties_the_server_could_not_give_are_not_trusted() {
        let s = MockServer::start().await;
        // The 404 propstat lists getetag (not found); only the 200 one counts.
        let body = format!(
            r#"<D:multistatus xmlns:D="DAV:"><D:response><D:href>/powertodo/a.xlsx</D:href>
            <D:propstat><D:prop><D:getlastmodified>{LM}</D:getlastmodified><D:getcontentlength>5</D:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
            <D:propstat><D:prop><D:getetag/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat>
            </D:response></D:multistatus>"#
        );
        mount(&s, "PROPFIND", FOLDER, 207, &body).await;
        let files = backend(&s).list().await.unwrap();
        assert_eq!(files[0].version, format!("{LM}|5"));
    }

    #[tokio::test]
    async fn a_listing_it_cannot_trust_is_an_error_not_a_shorter_list() {
        // A file outside the folder, a file without a time, not a multistatus, no 207.
        let cases: [(u16, String); 5] = [
            (
                207,
                multistatus(&[file_response("/elsewhere/a.xlsx", None, LM, 1)]),
            ),
            (
                207,
                multistatus(&[
                    "<D:response><D:href>/powertodo/a.xlsx</D:href><D:propstat><D:prop>\
                     <D:getcontentlength>1</D:getcontentlength></D:prop>\
                     <D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>"
                        .into(),
                ]),
            ),
            (
                207,
                multistatus(&[file_response("/powertodo/a.xlsx", None, "yesterday", 1)]),
            ),
            (207, "<html>hi</html>".into()),
            (200, multistatus(&[])),
        ];
        for (status, body) in cases {
            let s = MockServer::start().await;
            mount(&s, "PROPFIND", FOLDER, status, &body).await;
            let err = backend(&s).list().await.unwrap_err();
            assert!(matches!(err, BackendError::Other(_)), "{body}: {err:?}");
        }
    }

    #[tokio::test]
    async fn a_missing_folder_is_said_so() {
        let s = MockServer::start().await;
        mount(&s, "PROPFIND", FOLDER, 404, "").await;
        let err = backend(&s).list().await.unwrap_err();
        assert_eq!(err.to_string(), "同期先のフォルダが見つかりません");
    }

    // --- errors --------------------------------------------------------------------------

    #[tokio::test]
    async fn statuses_map_to_backend_errors() {
        type Expect = fn(&BackendError) -> bool;
        let cases: [(u16, Expect); 13] = [
            (401, |e| matches!(e, BackendError::Auth)),
            (403, |e| matches!(e, BackendError::Forbidden)),
            (507, |e| matches!(e, BackendError::Full)),
            (413, |e| matches!(e, BackendError::Full)),
            (
                301,
                |e| matches!(e, BackendError::Other(m) if m == "リダイレクトされました"),
            ),
            (
                307,
                |e| matches!(e, BackendError::Other(m) if m == "リダイレクトされました"),
            ),
            (408, |e| matches!(e, BackendError::Offline(_))),
            (429, |e| matches!(e, BackendError::Offline(_))),
            (500, |e| matches!(e, BackendError::Offline(_))),
            (503, |e| matches!(e, BackendError::Offline(_))),
            (
                404,
                |e| matches!(e, BackendError::Other(m) if m == "HTTP 404"),
            ),
            (409, |e| matches!(e, BackendError::Other(_))),
            (412, |e| matches!(e, BackendError::Other(_))),
        ];
        for (status, expected) in cases {
            let s = MockServer::start().await;
            mount(&s, "GET", &format!("{FOLDER}a.xlsx"), status, "").await;
            let file = remote("a.xlsx", "v");
            let err = backend(&s).download(&file).await.unwrap_err();
            assert!(expected(&err), "{status}: {err:?}");
        }
    }

    #[tokio::test]
    async fn redirects_are_not_followed() {
        let target = MockServer::start().await;
        let s = MockServer::start().await;
        Mock::given(method("PROPFIND"))
            .respond_with(
                ResponseTemplate::new(302)
                    .insert_header("Location", format!("{}{FOLDER}", target.uri()).as_str()),
            )
            .mount(&s)
            .await;
        let err = backend(&s).list().await.unwrap_err();
        assert!(matches!(err, BackendError::Other(m) if m == "リダイレクトされました"));
        assert!(requests(&target).await.is_empty());
    }

    #[tokio::test]
    async fn connection_failures_and_timeouts_are_offline() {
        // Nothing listens there any more.
        let port = {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        let b = WebDavBackend::new(
            Url::parse(&format!("http://127.0.0.1:{port}{FOLDER}")).unwrap(),
            "u",
            "p",
            None,
        )
        .unwrap();
        let err = b.list().await.unwrap_err();
        assert!(matches!(&err, BackendError::Offline(m) if m == "NAS に接続できません"));
        assert!(!err.to_string().contains("127.0.0.1"));

        let s = MockServer::start().await;
        Mock::given(method("PROPFIND"))
            .respond_with(
                ResponseTemplate::new(207)
                    .set_body_string(multistatus(&[]))
                    .set_delay(Duration::from_millis(1500)),
            )
            .mount(&s)
            .await;
        let slow = WebDavBackend::with_timeouts(
            Url::parse(&format!("{}{FOLDER}", s.uri())).unwrap(),
            "u".into(),
            "p".into(),
            None,
            Timeouts {
                connect: Duration::from_secs(5),
                read: Duration::from_millis(200),
                total: Duration::from_secs(600),
            },
        )
        .unwrap();
        let err = slow.list().await.unwrap_err();
        assert!(
            matches!(&err, BackendError::Offline(m) if m == "NAS への接続がタイムアウトしました"),
            "{err:?}"
        );

        // The total limit stops a transfer that keeps trickling.
        let total = WebDavBackend::with_timeouts(
            Url::parse(&format!("{}{FOLDER}", s.uri())).unwrap(),
            "u".into(),
            "p".into(),
            None,
            Timeouts {
                connect: Duration::from_secs(5),
                read: Duration::from_secs(60),
                total: Duration::from_millis(200),
            },
        )
        .unwrap();
        assert!(matches!(
            total.list().await.unwrap_err(),
            BackendError::Offline(m) if m == "NAS への接続がタイムアウトしました"
        ));
    }

    #[test]
    fn debug_hides_the_password() {
        let b = WebDavBackend::new(
            Url::parse("http://100.64.0.1:5005/powertodo/").unwrap(),
            "taro",
            "s3cret",
            None,
        )
        .unwrap();
        let text = format!("{b:?}");
        assert!(text.contains("taro") && !text.contains("s3cret"));
    }

    #[test]
    fn a_bad_proxy_or_url_is_refused() {
        let url = Url::parse("http://100.64.0.1:5005/x/").unwrap();
        assert!(WebDavBackend::new(url.clone(), "u", "p", Some("not a proxy".into())).is_err());
        assert!(WebDavBackend::new(url, "u", "p", Some("socks5h://127.0.0.1:1080".into())).is_ok());
        let mailto = Url::parse("mailto:a@example.com").unwrap();
        assert!(WebDavBackend::new(mailto, "u", "p", None).is_err());
    }

    #[test]
    fn credentials_in_the_nas_url_are_refused() {
        for url in [
            "http://u:p@100.64.0.1:5005/x/",
            "http://u@100.64.0.1:5005/x/",
        ] {
            let err = WebDavBackend::new(Url::parse(url).unwrap(), "u", "p", None).unwrap_err();
            assert!(matches!(err, BackendError::Other(_)), "{url}");
            assert!(!err.to_string().contains("p@"), "{url}");
        }
    }

    #[test]
    fn a_proxy_error_does_not_quote_the_proxy_url() {
        let url = Url::parse("http://100.64.0.1:5005/x/").unwrap();
        let bad = "socks5h://user:hunter2@127.0.0.1:notaport";
        let err = WebDavBackend::new(url, "u", "p", Some(bad.into())).unwrap_err();
        let text = err.to_string();
        assert_eq!(text, "プロキシの設定が正しくありません");
        assert!(!text.contains("hunter2") && !text.contains("127.0.0.1"));
    }

    // --- download / names ----------------------------------------------------------------

    fn remote(name: &str, version: &str) -> RemoteFile {
        RemoteFile {
            id: name.into(),
            name: name.into(),
            version: version.into(),
            modified: local(LM),
            size: 0,
        }
    }

    #[tokio::test]
    async fn download_reads_the_bytes_of_an_encoded_name() {
        let s = MockServer::start().await;
        mount(&s, "GET", &format!("{FOLDER}{JA}"), 200, "bytes").await;
        let got = backend(&s)
            .download(&remote("受信トレイ.xlsx", "v"))
            .await
            .unwrap();
        assert_eq!(got, b"bytes");
        // Characters that would change the URL's meaning are escaped in a name.
        mount(
            &s,
            "GET",
            &format!("{FOLDER}%E4%BB%95%E4%BA%8B%20%231%3F%25.xlsx"),
            200,
            "x",
        )
        .await;
        let got = backend(&s)
            .download(&remote("仕事 #1?%.xlsx", "v"))
            .await
            .unwrap();
        assert_eq!(got, b"x");
    }

    #[test]
    fn names_are_percent_encoded_per_segment() {
        assert_eq!(
            encode_segment("a b#c?d%e/f.xlsx"),
            "a%20b%23c%3Fd%25e%2Ff.xlsx"
        );
        assert_eq!(encode_segment("受信トレイ.xlsx"), JA);
        assert_eq!(encode_segment("p-0_a.b~c.xlsx"), "p-0_a.b~c.xlsx");
    }

    #[tokio::test]
    async fn unsafe_names_are_refused_without_a_request() {
        let s = MockServer::start().await;
        let b = backend(&s);
        for name in ["../x.xlsx", "a/b.xlsx", "a\\b.xlsx", "..", ".", ""] {
            let err = b.upload(name, None, vec![1]).await.unwrap_err();
            assert!(matches!(err, BackendError::Other(_)), "{name}");
            assert!(b.download(&remote(name, "v")).await.is_err(), "{name}");
        }
        assert!(requests(&s).await.is_empty());
    }

    // --- upload --------------------------------------------------------------------------

    fn stat_response(etag: Option<&str>, lm: &str, len: u64) -> String {
        multistatus(&[file_response("/powertodo/a.xlsx", etag, lm, len)])
    }

    #[tokio::test]
    async fn creating_a_file_is_conditional_on_it_not_existing() {
        let s = MockServer::start().await;
        let file = format!("{FOLDER}a.xlsx");
        Mock::given(method("PUT"))
            .and(path(file.as_str()))
            .and(header("if-none-match", "*"))
            .respond_with(ResponseTemplate::new(201))
            .mount(&s)
            .await;
        mount(
            &s,
            "PROPFIND",
            &file,
            207,
            &stat_response(Some("&quot;n1&quot;"), LM, 3),
        )
        .await;
        let got = backend(&s)
            .upload("a.xlsx", None, vec![1, 2, 3])
            .await
            .unwrap();
        assert_eq!(got.version, "\"n1\"");
        assert_eq!(got.size, 3);
        assert_eq!(got.name, "a.xlsx");
        let reqs = requests(&s).await;
        let put = reqs.iter().find(|r| r.method.as_str() == "PUT").unwrap();
        assert_eq!(header_of(put, "if-match"), None);
        assert_eq!(put.body, [1, 2, 3]);
        let stat = reqs
            .iter()
            .find(|r| r.method.as_str() == "PROPFIND")
            .unwrap();
        assert_eq!(header_of(stat, "depth").as_deref(), Some("0"));
    }

    #[tokio::test]
    async fn a_file_that_appeared_meanwhile_is_a_precondition_failure() {
        let s = MockServer::start().await;
        mount(&s, "PUT", &format!("{FOLDER}a.xlsx"), 412, "").await;
        let err = backend(&s)
            .upload("a.xlsx", None, vec![1])
            .await
            .unwrap_err();
        assert!(matches!(err, BackendError::Precondition));
        // Nothing but the PUT happened.
        assert_eq!(requests(&s).await.len(), 1);
    }

    #[tokio::test]
    async fn overwriting_sends_the_listed_etag_as_the_condition() {
        for etag in ["\"abc\"", "abc-unquoted"] {
            let s = MockServer::start().await;
            let file = format!("{FOLDER}a.xlsx");
            Mock::given(method("PUT"))
                .and(path(file.as_str()))
                .and(header("if-match", etag))
                .respond_with(ResponseTemplate::new(204))
                .mount(&s)
                .await;
            mount(
                &s,
                "PROPFIND",
                &file,
                207,
                &stat_response(Some("&quot;new&quot;"), LM, 2),
            )
            .await;
            let got = backend(&s)
                .upload("a.xlsx", Some(&remote("a.xlsx", etag)), vec![9, 9])
                .await
                .unwrap();
            assert_eq!(got.version, "\"new\"");
            let reqs = requests(&s).await;
            let put = reqs.iter().find(|r| r.method.as_str() == "PUT").unwrap();
            assert_eq!(header_of(put, "if-none-match"), None);
            // The etag is the condition; no look-ahead PROPFIND before the PUT.
            assert_eq!(reqs[0].method.as_str(), "PUT");
        }
    }

    #[tokio::test]
    async fn a_changed_etag_is_a_precondition_failure() {
        let s = MockServer::start().await;
        mount(&s, "PUT", &format!("{FOLDER}a.xlsx"), 412, "").await;
        let err = backend(&s)
            .upload("a.xlsx", Some(&remote("a.xlsx", "\"old\"")), vec![1])
            .await
            .unwrap_err();
        assert!(matches!(err, BackendError::Precondition));
    }

    #[tokio::test]
    async fn without_an_etag_the_file_is_checked_right_before_the_put() {
        let version = format!("{LM}|3");
        // Unchanged: the PUT goes out (nothing to send as a condition).
        let s = MockServer::start().await;
        let file = format!("{FOLDER}a.xlsx");
        mount(&s, "PROPFIND", &file, 207, &stat_response(None, LM, 3)).await;
        mount(&s, "PUT", &file, 204, "").await;
        let got = backend(&s)
            .upload("a.xlsx", Some(&remote("a.xlsx", &version)), vec![1])
            .await
            .unwrap();
        assert_eq!(got.version, format!("{LM}|3"));
        let methods: Vec<String> = requests(&s)
            .await
            .iter()
            .map(|r| r.method.to_string())
            .collect();
        assert_eq!(methods, ["PROPFIND", "PUT", "PROPFIND"]);
        let reqs = requests(&s).await;
        assert_eq!(header_of(&reqs[1], "if-match"), None);
        assert_eq!(header_of(&reqs[1], "if-none-match"), None);

        // Changed in size, in time, or gone: Precondition and no PUT.
        let other_time = "Wed, 14 Oct 2026 03:21:10 GMT";
        for current in [
            Some(stat_response(None, LM, 4)),
            Some(stat_response(None, other_time, 3)),
            None,
        ] {
            let s = MockServer::start().await;
            match &current {
                Some(body) => mount(&s, "PROPFIND", &file, 207, body).await,
                None => mount(&s, "PROPFIND", &file, 404, "").await,
            }
            mount(&s, "PUT", &file, 204, "").await;
            let err = backend(&s)
                .upload("a.xlsx", Some(&remote("a.xlsx", &version)), vec![1])
                .await
                .unwrap_err();
            assert!(matches!(err, BackendError::Precondition), "{current:?}");
            assert!(
                requests(&s)
                    .await
                    .iter()
                    .all(|r| r.method.as_str() != "PUT")
            );
        }
    }

    #[tokio::test]
    async fn upload_errors_map_like_the_rest() {
        for (status, full) in [(507u16, true), (413, true), (403, false)] {
            let s = MockServer::start().await;
            mount(&s, "PUT", &format!("{FOLDER}a.xlsx"), status, "").await;
            let err = backend(&s)
                .upload("a.xlsx", None, vec![1])
                .await
                .unwrap_err();
            assert_eq!(matches!(err, BackendError::Full), full, "{status}");
            assert_eq!(matches!(err, BackendError::Forbidden), !full, "{status}");
        }
    }

    // --- archive -------------------------------------------------------------------------

    #[tokio::test]
    async fn archiving_makes_the_folder_then_moves_the_file() {
        let s = MockServer::start().await;
        mount(&s, "MKCOL", "/powertodo/archive/", 201, "").await;
        mount(&s, "MOVE", &format!("{FOLDER}{JA}"), 201, "").await;
        let file = remote("受信トレイ.xlsx", "v");
        backend(&s).move_to_archive(&file).await.unwrap();
        let reqs = requests(&s).await;
        let methods: Vec<&str> = reqs.iter().map(|r| r.method.as_str()).collect();
        assert_eq!(methods, ["MKCOL", "MOVE"]);
        assert_eq!(
            header_of(&reqs[1], "destination").unwrap(),
            format!(
                "{}/powertodo/archive/{}",
                s.uri(),
                encode_segment(&format!(
                    "受信トレイ ({}).xlsx",
                    file.modified.format("%Y-%m-%d %H%M")
                ))
            )
        );
        // Never over an existing archived copy.
        assert_eq!(header_of(&reqs[1], "overwrite").as_deref(), Some("F"));
    }

    #[tokio::test]
    async fn an_existing_archive_folder_is_fine_and_failures_are_reported() {
        let s = MockServer::start().await;
        mount(&s, "MKCOL", "/powertodo/archive/", 405, "").await;
        mount(&s, "MOVE", &format!("{FOLDER}a.xlsx"), 204, "").await;
        backend(&s)
            .move_to_archive(&remote("a.xlsx", "v"))
            .await
            .unwrap();

        // Already moved by someone else.
        let s = MockServer::start().await;
        mount(&s, "MKCOL", "/powertodo/archive/", 405, "").await;
        mount(&s, "MOVE", &format!("{FOLDER}a.xlsx"), 404, "").await;
        backend(&s)
            .move_to_archive(&remote("a.xlsx", "v"))
            .await
            .unwrap();

        let s = MockServer::start().await;
        mount(&s, "MKCOL", "/powertodo/archive/", 403, "").await;
        let err = backend(&s)
            .move_to_archive(&remote("a.xlsx", "v"))
            .await
            .unwrap_err();
        assert!(matches!(err, BackendError::Forbidden));
        assert!(
            requests(&s)
                .await
                .iter()
                .all(|r| r.method.as_str() != "MOVE")
        );

        let s = MockServer::start().await;
        mount(&s, "MKCOL", "/powertodo/archive/", 201, "").await;
        mount(&s, "MOVE", &format!("{FOLDER}a.xlsx"), 507, "").await;
        let err = backend(&s)
            .move_to_archive(&remote("a.xlsx", "v"))
            .await
            .unwrap_err();
        assert!(matches!(err, BackendError::Full));
    }

    /// An `archive/` that remembers what was moved into it: MOVE onto an existing name is a 412
    /// (`Overwrite: F`), the source disappears with the first move.
    #[derive(Clone, Default)]
    struct Archive {
        taken: Arc<Mutex<Vec<String>>>,
        refuse_all: bool,
    }

    impl Respond for Archive {
        fn respond(&self, req: &Request) -> ResponseTemplate {
            assert_eq!(header_of(req, "overwrite").as_deref(), Some("F"));
            let dest = header_of(req, "destination").unwrap();
            let mut taken = self.taken.lock().unwrap();
            if self.refuse_all || taken.contains(&dest) {
                return ResponseTemplate::new(412);
            }
            taken.push(dest);
            ResponseTemplate::new(201)
        }
    }

    #[tokio::test]
    async fn archiving_the_same_name_twice_keeps_both_copies() {
        let s = MockServer::start().await;
        mount(&s, "MKCOL", "/powertodo/archive/", 405, "").await;
        let archive = Archive::default();
        Mock::given(method("MOVE"))
            .respond_with(archive.clone())
            .mount(&s)
            .await;
        let file = remote("受信トレイ.xlsx", "v");
        let b = backend(&s);
        b.move_to_archive(&file).await.unwrap();
        b.move_to_archive(&file).await.unwrap();
        b.move_to_archive(&file).await.unwrap();
        let tag = file.modified.format("%Y-%m-%d %H%M");
        let want: Vec<String> = [
            format!("受信トレイ ({tag}).xlsx"),
            format!("受信トレイ ({tag}-2).xlsx"),
            format!("受信トレイ ({tag}-3).xlsx"),
        ]
        .iter()
        .map(|n| format!("{}/powertodo/archive/{}", s.uri(), encode_segment(n)))
        .collect();
        assert_eq!(*archive.taken.lock().unwrap(), want);
    }

    #[tokio::test]
    async fn archiving_gives_up_after_fifty_names() {
        let s = MockServer::start().await;
        mount(&s, "MKCOL", "/powertodo/archive/", 405, "").await;
        Mock::given(method("MOVE"))
            .respond_with(Archive {
                refuse_all: true,
                ..Archive::default()
            })
            .mount(&s)
            .await;
        let err = backend(&s)
            .move_to_archive(&remote("a.xlsx", "v"))
            .await
            .unwrap_err();
        assert!(matches!(err, BackendError::Other(_)));
        let moves = requests(&s)
            .await
            .iter()
            .filter(|r| r.method.as_str() == "MOVE")
            .count();
        assert_eq!(moves, 50);
    }

    // --- weak etags ----------------------------------------------------------------------

    /// A server that only has weak etags: `If-Match` never matches (412), a write without it
    /// works and changes the tag.
    #[derive(Clone)]
    struct WeakOnly {
        etag: Arc<Mutex<String>>,
    }

    impl Respond for WeakOnly {
        fn respond(&self, req: &Request) -> ResponseTemplate {
            let mut etag = self.etag.lock().unwrap();
            match req.method.as_str() {
                "PUT" if req.headers.contains_key("if-match") => ResponseTemplate::new(412),
                "PUT" => {
                    *etag = "W/&quot;y&quot;".to_string();
                    ResponseTemplate::new(201)
                }
                _ => ResponseTemplate::new(207).set_body_string(stat_response(
                    Some(etag.as_str()),
                    LM,
                    3,
                )),
            }
        }
    }

    #[tokio::test]
    async fn a_server_with_only_weak_etags_can_still_be_written_to() {
        let s = MockServer::start().await;
        let server = WeakOnly {
            etag: Arc::new(Mutex::new("W/&quot;x&quot;".to_string())),
        };
        let file = format!("{FOLDER}a.xlsx");
        for verb in ["PUT", "PROPFIND"] {
            Mock::given(method(verb))
                .and(path(file.as_str()))
                .respond_with(server.clone())
                .mount(&s)
                .await;
        }
        let b = backend(&s);
        let listed = remote("a.xlsx", "\"x\"");
        let got = b
            .upload("a.xlsx", Some(&listed), vec![1, 2, 3])
            .await
            .unwrap();
        assert_eq!(got.version, "\"y\"");
        let reqs = requests(&s).await;
        let seen: Vec<(String, Option<String>)> = reqs
            .iter()
            .map(|r| (r.method.to_string(), header_of(r, "if-match")))
            .collect();
        assert_eq!(
            seen,
            [
                ("PUT".to_string(), Some("\"x\"".to_string())),
                ("PROPFIND".to_string(), None),
                ("PUT".to_string(), None),
                ("PROPFIND".to_string(), None),
            ]
        );
        assert_eq!(reqs[2].body, [1, 2, 3]);

        // The file really changed meanwhile: the tags differ, nothing is written.
        let stale = remote("a.xlsx", "\"old\"");
        let err = b.upload("a.xlsx", Some(&stale), vec![9]).await.unwrap_err();
        assert!(matches!(err, BackendError::Precondition));
        let puts = requests(&s)
            .await
            .iter()
            .filter(|r| r.method.as_str() == "PUT")
            .count();
        assert_eq!(puts, 3, "only the stale attempt's If-Match PUT was added");
    }

    #[tokio::test]
    async fn a_tag_that_turns_from_weak_to_strong_is_not_a_change() {
        let s = MockServer::start().await;
        let file = format!("{FOLDER}a.xlsx");
        mount(&s, "PUT", &file, 201, "").await;
        // Right after the PUT the tag is weak; the next listing has the same tag, strong.
        Mock::given(method("PROPFIND"))
            .and(path(file.as_str()))
            .respond_with(ResponseTemplate::new(207).set_body_string(stat_response(
                Some("W/&quot;x&quot;"),
                LM,
                3,
            )))
            .mount(&s)
            .await;
        Mock::given(method("PROPFIND"))
            .and(path(FOLDER))
            .respond_with(ResponseTemplate::new(207).set_body_string(multistatus(&[
                collection_response(FOLDER),
                file_response("/powertodo/a.xlsx", Some("&quot;x&quot;"), LM, 3),
            ])))
            .mount(&s)
            .await;
        let b = backend(&s);
        let written = b.upload("a.xlsx", None, vec![1, 2, 3]).await.unwrap();
        let listed = b.list().await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].version, written.version);
        assert_eq!(written.version, "\"x\"");
    }

    // --- check ---------------------------------------------------------------------------

    /// A one-file server: PUT stores the body (tampered with when `corrupt`), GET returns it,
    /// DELETE forgets it.
    #[derive(Clone, Default)]
    struct Store {
        body: Arc<Mutex<Option<Vec<u8>>>>,
        corrupt: bool,
    }

    impl Respond for Store {
        fn respond(&self, req: &Request) -> ResponseTemplate {
            let mut body = self.body.lock().unwrap();
            match req.method.as_str() {
                "PUT" => {
                    let mut b = req.body.clone();
                    if self.corrupt {
                        b.push(b'!');
                    }
                    *body = Some(b);
                    ResponseTemplate::new(201)
                }
                "GET" => match body.clone() {
                    Some(b) => ResponseTemplate::new(200).set_body_bytes(b),
                    None => ResponseTemplate::new(404),
                },
                _ => {
                    *body = None;
                    ResponseTemplate::new(204)
                }
            }
        }
    }

    async fn check_server(store: Store) -> MockServer {
        let s = MockServer::start().await;
        mount(
            &s,
            "PROPFIND",
            FOLDER,
            207,
            &multistatus(&[collection_response(FOLDER)]),
        )
        .await;
        for verb in ["PUT", "GET", "DELETE"] {
            Mock::given(method(verb))
                .and(wiremock::matchers::path_regex(
                    r"^/powertodo/powertodo-check-[0-9a-f-]+\.txt$",
                ))
                .respond_with(store.clone())
                .mount(&s)
                .await;
        }
        s
    }

    #[tokio::test]
    async fn check_writes_reads_back_and_deletes() {
        let store = Store::default();
        let s = check_server(store.clone()).await;
        backend(&s).check().await.unwrap();
        let methods: Vec<String> = requests(&s)
            .await
            .iter()
            .map(|r| r.method.to_string())
            .collect();
        assert_eq!(methods, ["PROPFIND", "PUT", "GET", "DELETE"]);
        assert!(store.body.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn check_notices_changed_content_and_still_cleans_up() {
        let store = Store {
            corrupt: true,
            ..Store::default()
        };
        let s = check_server(store.clone()).await;
        let err = backend(&s).check().await.unwrap_err();
        assert!(matches!(err, BackendError::Other(_)));
        assert!(store.body.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn check_reports_the_first_problem() {
        // Wrong password.
        let s = MockServer::start().await;
        mount(&s, "PROPFIND", FOLDER, 401, "").await;
        assert!(matches!(backend(&s).check().await, Err(BackendError::Auth)));
        // No such folder.
        let s = MockServer::start().await;
        mount(&s, "PROPFIND", FOLDER, 404, "").await;
        let err = backend(&s).check().await.unwrap_err();
        assert_eq!(err.to_string(), "同期先のフォルダが見つかりません");
        // Read-only share.
        let s = MockServer::start().await;
        mount(
            &s,
            "PROPFIND",
            FOLDER,
            207,
            &multistatus(&[collection_response(FOLDER)]),
        )
        .await;
        Mock::given(method("PUT"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&s)
            .await;
        assert!(matches!(
            backend(&s).check().await,
            Err(BackendError::Forbidden)
        ));
    }

    // --- resolve_nas_url -----------------------------------------------------------------

    fn ip(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::V4(Ipv4Addr::new(a, b, c, d))
    }

    fn resolve_to(tail: IpAddr) -> impl Fn(&str) -> Result<IpAddr, ResolveError> {
        move |_| Ok(tail)
    }

    #[test]
    fn nas_url_gets_the_default_port_a_trailing_slash_and_the_tailnet_address() {
        let seen = Mutex::new(Vec::new());
        let url = resolve_nas_url("http://synology/powertodo", |h| {
            seen.lock().unwrap().push(h.to_string());
            Ok(ip(100, 101, 102, 103))
        })
        .unwrap();
        assert_eq!(url.as_str(), "http://100.101.102.103:5005/powertodo/");
        assert_eq!(*seen.lock().unwrap(), ["synology"]);
        for (input, want) in [
            (
                "http://nas.tail1234.ts.net:8080/a/b/",
                "http://100.64.0.5:8080/a/b/",
            ),
            ("  http://nas/a  ", "http://100.64.0.5:5005/a/"),
            ("HTTP://nas:5005/a/", "http://100.64.0.5:5005/a/"),
            ("nas/a", "http://100.64.0.5:5005/a/"),
            ("http://nas:80/a/", "http://100.64.0.5/a/"),
            ("http://nas/a?x=1#y", "http://100.64.0.5:5005/a/"),
            (
                "http://nas/受信 フォルダ",
                "http://100.64.0.5:5005/%E5%8F%97%E4%BF%A1%20%E3%83%95%E3%82%A9%E3%83%AB%E3%83%80/",
            ),
        ] {
            let got = resolve_nas_url(input, resolve_to(ip(100, 64, 0, 5))).unwrap();
            assert_eq!(got.as_str(), want, "{input}");
        }
    }

    #[test]
    fn https_is_refused_with_the_format_to_use() {
        let called = Mutex::new(false);
        let err = resolve_nas_url("https://nas:5006/a/", |_| {
            *called.lock().unwrap() = true;
            Ok(ip(100, 64, 0, 5))
        })
        .unwrap_err();
        assert_eq!(err, NasUrlError::HttpsNotSupported);
        assert_eq!(
            err.to_string(),
            "https は使えません (http://<NAS 名>:5005/<フォルダ>/ の形で入力してください)"
        );
        assert!(!*called.lock().unwrap());
        assert_eq!(
            resolve_nas_url("HTTPS://nas/a/", resolve_to(ip(100, 64, 0, 5))).unwrap_err(),
            NasUrlError::HttpsNotSupported
        );
    }

    #[test]
    fn rejects_host_outside_tailnet() {
        let err = resolve_nas_url("http://192.168.0.10:5005/a/", |_| {
            Err(ResolveError::NotInTailnet)
        })
        .unwrap_err();
        assert_eq!(err, NasUrlError::NotInTailnet);
        assert_eq!(
            err.to_string(),
            "NAS が tailnet にありません。NAS の Tailscale にログインしているか確認してください"
        );
    }

    #[test]
    fn resolve_failures_have_their_own_messages() {
        let run = |e: ResolveError| resolve_nas_url("http://nas/a/", move |_| Err(e.clone()));
        let err = run(ResolveError::NotRunning).unwrap_err();
        assert_eq!(err, NasUrlError::NotRunning);
        assert_eq!(err.to_string(), "Tailscale に接続していません");
        assert!(matches!(
            run(ResolveError::Timeout).unwrap_err(),
            NasUrlError::Resolve(_)
        ));
        assert_eq!(
            run(ResolveError::Failed("boom".into())).unwrap_err(),
            NasUrlError::Resolve("boom".into())
        );
    }

    #[test]
    fn unusable_inputs_are_invalid() {
        for input in [
            "",
            "   ",
            "ftp://nas/a/",
            "http://",
            "http://user:pw@nas/a/",
            "http://nas:notaport/a/",
        ] {
            let err = resolve_nas_url(input, resolve_to(ip(100, 64, 0, 5))).unwrap_err();
            assert!(matches!(err, NasUrlError::Invalid(_)), "{input}: {err:?}");
        }
    }

    // --- the proxy -----------------------------------------------------------------------

    /// A SOCKS5 proxy that requires user/pass authentication (method 0x02, RFC 1929) with
    /// `credentials`, sends every connection to `target` and records where the client asked to
    /// go. A client that offers no password method, or the wrong password, is turned away.
    async fn fake_socks5(
        target: SocketAddr,
        credentials: (&'static str, &'static str),
    ) -> (SocketAddr, Arc<Mutex<Vec<String>>>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let asked = Arc::new(Mutex::new(Vec::new()));
        let log = asked.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut client, _)) = listener.accept().await else {
                    return;
                };
                let log = log.clone();
                tokio::spawn(async move {
                    let mut head = [0u8; 2];
                    client.read_exact(&mut head).await?;
                    let mut methods = vec![0u8; head[1] as usize];
                    client.read_exact(&mut methods).await?;
                    if !methods.contains(&2) {
                        client.write_all(&[5, 0xff]).await?;
                        return std::io::Result::Ok(());
                    }
                    client.write_all(&[5, 2]).await?;
                    let mut ver = [0u8; 2];
                    client.read_exact(&mut ver).await?;
                    let mut user = vec![0u8; ver[1] as usize];
                    client.read_exact(&mut user).await?;
                    let mut plen = [0u8; 1];
                    client.read_exact(&mut plen).await?;
                    let mut pass = vec![0u8; plen[0] as usize];
                    client.read_exact(&mut pass).await?;
                    if ver[0] != 1
                        || user != credentials.0.as_bytes()
                        || pass != credentials.1.as_bytes()
                    {
                        client.write_all(&[1, 1]).await?;
                        return Ok(());
                    }
                    client.write_all(&[1, 0]).await?;
                    let mut req = [0u8; 4];
                    client.read_exact(&mut req).await?;
                    let host = match req[3] {
                        1 => {
                            let mut a = [0u8; 4];
                            client.read_exact(&mut a).await?;
                            Ipv4Addr::from(a).to_string()
                        }
                        3 => {
                            let mut n = [0u8; 1];
                            client.read_exact(&mut n).await?;
                            let mut name = vec![0u8; n[0] as usize];
                            client.read_exact(&mut name).await?;
                            String::from_utf8(name).unwrap()
                        }
                        other => panic!("address type {other}"),
                    };
                    let mut port = [0u8; 2];
                    client.read_exact(&mut port).await?;
                    log.lock()
                        .unwrap()
                        .push(format!("{host}:{}", u16::from_be_bytes(port)));
                    let mut upstream = tokio::net::TcpStream::connect(target).await?;
                    client.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
                    tokio::io::copy_bidirectional(&mut client, &mut upstream).await?;
                    Ok(())
                });
            }
        });
        (addr, asked)
    }

    #[tokio::test]
    async fn requests_go_through_the_socks_proxy_to_the_tailnet_address() {
        let s = MockServer::start().await;
        mount(&s, "PROPFIND", FOLDER, 207, &listing()).await;
        let (proxy, asked) = fake_socks5(*s.address(), ("ptd", "p@ss")).await;
        // 100.64.0.9 is not reachable from here: only the proxy can get there.
        let b = WebDavBackend::new(
            Url::parse("http://100.64.0.9:5005/powertodo/").unwrap(),
            "taro",
            "pw",
            Some(format!("socks5h://ptd:p%40ss@{proxy}")),
        )
        .unwrap();
        assert_eq!(b.list().await.unwrap().len(), 4);
        assert_eq!(*asked.lock().unwrap(), ["100.64.0.9:5005"]);

        // Without the credentials (or with wrong ones) the proxy lets nothing through.
        for url in [
            format!("socks5h://{proxy}"),
            format!("socks5h://ptd:nope@{proxy}"),
        ] {
            let b = WebDavBackend::new(
                Url::parse("http://100.64.0.9:5005/powertodo/").unwrap(),
                "taro",
                "pw",
                Some(url),
            )
            .unwrap();
            let err = b.list().await.unwrap_err();
            assert!(matches!(err, BackendError::Offline(_)), "{err:?}");
            assert!(!err.to_string().contains("nope"));
        }
        assert_eq!(asked.lock().unwrap().len(), 1);
    }
}
