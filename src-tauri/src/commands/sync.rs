//! Commands of the sync with a NAS (Phase 4, spec sections 4 and 6): the choice of the target,
//! the Tailscale sidecar's login, the connection check and the status the UI shows.
//!
//! The engine itself (`crate::sync::SyncEngine`) is started by `super::start_sync`; this module
//! decides when the engine gets a target. For the NAS that is the moment the sidecar reports
//! `running` (at start-up when the user logged in before, or after the login in the settings)
//! and the saved URL, user and password are complete.
//!
//! Blocking calls (the keychain, `Tailnet::resolve`, starting and stopping the sidecar) run in
//! `spawn_blocking`. The password, the sidecar's proxy URL and its credentials never go into an
//! error text, an event or a DTO.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use super::{AppState, TauriSyncHost};
use crate::error::{AppError, AppResult};
use crate::store::paths::{AppSettings, SyncBackend, SyncSettings};
use crate::sync::backend::BackendError;
use crate::sync::secrets::{KeyringStore, MemoryStore, NAS_SERVICE, SecretResult, SecretStore};
use crate::sync::state::BackendKind;
use crate::sync::tailnet::{
    self, RESOLVE_TIMEOUT, Tailnet, TailnetError, TailnetState, TailnetStatusView,
};
use crate::sync::webdav::{NasUrlError, WebDavBackend, resolve_nas_url};
use crate::sync::{PlanMode, RunOutcome, SyncReason, SyncStatusView};

/// The file tsnet keeps its node key in (`tailscaled.state` in the state folder, see tsnet's
/// `Server.Start`). Its presence is what 「過去のログインがある」 means (spec section 4.1).
const TAILNET_LOGIN_FILE: &str = "tailscaled.state";

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Runs `f` where blocking is allowed.
async fn blocking<R: Send + 'static>(f: impl FnOnce() -> R + Send + 'static) -> AppResult<R> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Io {
            message: format!("内部エラー: {e}"),
        })
}

// ---- secrets ----

/// The NAS password, kept in the OS keychain. When the keychain cannot be used the password is
/// held in memory for this run instead (spec section 7), and [`Secrets::persistent`] says so.
///
/// Every call may block (D-Bus, an unlock prompt): call from `spawn_blocking`. Reads are
/// remembered, so the keychain is asked once per secret, not on every settings read.
pub struct Secrets {
    primary: Arc<dyn SecretStore>,
    memory: MemoryStore,
    /// The last `set` could not reach the keychain: the secret is in `memory` only.
    memory_only: AtomicBool,
    cache: Mutex<BTreeMap<(String, String), Option<String>>>,
}

impl Secrets {
    pub fn new(primary: Arc<dyn SecretStore>) -> Self {
        Secrets {
            primary,
            memory: MemoryStore::new(),
            memory_only: AtomicBool::new(false),
            cache: Mutex::new(BTreeMap::new()),
        }
    }

    /// `false` when the password could only be kept in memory (it is gone after a restart).
    pub fn persistent(&self) -> bool {
        !self.memory_only.load(Ordering::SeqCst)
    }

    fn memory_get(&self, service: &str, account: &str) -> Option<String> {
        self.memory.get(service, account).ok().flatten()
    }

    pub fn get(&self, service: &str, account: &str) -> Option<String> {
        let key = (service.to_string(), account.to_string());
        if let Some(hit) = lock(&self.cache).get(&key) {
            return hit.clone();
        }
        let found = match self.primary.get(service, account) {
            Ok(Some(v)) => Some(v),
            Ok(None) => self.memory_get(service, account),
            Err(e) => {
                // Not remembered: the keychain may be usable (unlocked) next time.
                eprintln!("keychain read failed: {e}");
                return self.memory_get(service, account);
            }
        };
        lock(&self.cache).insert(key, found.clone());
        found
    }

    /// Stores the secret; `true` when it went to the keychain, `false` when only to memory.
    pub fn set(&self, service: &str, account: &str, secret: &str) -> bool {
        let persistent = match self.primary.set(service, account, secret) {
            Ok(()) => {
                let _ = self.memory.delete(service, account);
                true
            }
            Err(e) => {
                eprintln!("keychain write failed, keeping the secret in memory: {e}");
                let _ = self.memory.set(service, account, secret);
                false
            }
        };
        self.memory_only.store(!persistent, Ordering::SeqCst);
        lock(&self.cache).insert(
            (service.to_string(), account.to_string()),
            Some(secret.to_string()),
        );
        persistent
    }

    /// Removes the secret everywhere. A keychain that cannot be reached is an error only while
    /// it was believed to hold the secret.
    pub fn delete(&self, service: &str, account: &str) -> SecretResult<()> {
        let key = (service.to_string(), account.to_string());
        let _ = self.memory.delete(service, account);
        match self.primary.delete(service, account) {
            Ok(()) => {
                lock(&self.cache).insert(key, None);
                Ok(())
            }
            Err(_) if self.memory_only.load(Ordering::SeqCst) => {
                lock(&self.cache).insert(key, None);
                Ok(())
            }
            Err(e) => {
                lock(&self.cache).remove(&key);
                Err(e)
            }
        }
    }
}

// ---- runtime state ----

/// What the NAS sync keeps next to the engine: the sidecar, the secrets, and the bookkeeping
/// that decides when the engine gets a backend.
pub struct SyncRuntime {
    tailnet: Mutex<Option<Arc<Tailnet>>>,
    /// Why the sidecar could not be started (binary missing, no permission); `None` otherwise.
    start_error: Mutex<Option<String>>,
    secrets: Arc<Secrets>,
    /// The sidecar's last state was `running`.
    running: AtomicBool,
    /// Bumped by every sidecar state change and every stop. A backend built for an older value
    /// is dropped.
    seq: AtomicU64,
    /// Held while the engine's backend is built from the saved settings or replaced.
    connect_lock: tokio::sync::Mutex<()>,
}

impl SyncRuntime {
    pub fn new() -> Self {
        SyncRuntime {
            tailnet: Mutex::new(None),
            start_error: Mutex::new(None),
            secrets: Arc::new(Secrets::new(Arc::new(KeyringStore))),
            running: AtomicBool::new(false),
            seq: AtomicU64::new(0),
            connect_lock: tokio::sync::Mutex::new(()),
        }
    }

    fn current_tailnet(&self) -> Option<Arc<Tailnet>> {
        lock(&self.tailnet).clone()
    }

    fn secrets(&self) -> Arc<Secrets> {
        Arc::clone(&self.secrets)
    }

    /// Records a state change of the sidecar. Returns the new sequence number and whether the
    /// sidecar just came up (`running` after something else): then the backend is rebuilt, which
    /// also covers a restart with a new proxy port and credential (a restart always passes
    /// through `starting`).
    fn note_tailnet_state(&self, running: bool) -> (u64, bool) {
        let was = self.running.swap(running, Ordering::SeqCst);
        let seq = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        (seq, running && !was)
    }
}

impl Default for SyncRuntime {
    fn default() -> Self {
        Self::new()
    }
}

// ---- DTOs ----

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettingsDto {
    pub backend: SyncBackend,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nas_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nas_user: Option<String>,
    pub nas_password_set: bool,
    /// `false` while the password could not be put in the OS keychain and only lives in memory
    /// (UI: 「パスワードを保存できません (再起動するまで有効)」).
    pub password_persistent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub google_email: Option<String>,
    /// This build carries Google OAuth client credentials (Task 8 embeds them).
    pub google_available: bool,
}

fn google_available() -> bool {
    option_env!("POWERTODO_GOOGLE_CLIENT_ID").is_some()
}

fn settings_dto(
    s: &SyncSettings,
    password_set: bool,
    password_persistent: bool,
    google_available: bool,
) -> SyncSettingsDto {
    SyncSettingsDto {
        backend: s.backend,
        nas_url: s.nas_url.clone(),
        nas_user: s.nas_user.clone(),
        nas_password_set: password_set,
        password_persistent,
        google_email: s.google_email.clone(),
        google_available,
    }
}

async fn current_dto(app: &AppHandle) -> AppResult<SyncSettingsDto> {
    let state = app.state::<AppState>();
    let s = state.lock_settings().sync.clone();
    let secrets = state.sync_rt.secrets();
    let account = stored_account(&s);
    let password_set = match account {
        Some(account) => blocking(move || secrets.get(NAS_SERVICE, &account).is_some()).await?,
        None => false,
    };
    let persistent = state.sync_rt.secrets.persistent();
    Ok(settings_dto(
        &s,
        password_set,
        persistent,
        google_available(),
    ))
}

// ---- NAS input ----

/// What the typed NAS address means: `root` is the folder as the sync names it (also what
/// `nas_url` keeps), `host` the NAS name the user typed.
#[derive(Debug, Clone, PartialEq, Eq)]
struct NasTarget {
    root: String,
    host: String,
}

fn nas_url_error(e: NasUrlError) -> AppError {
    AppError::Invalid {
        message: e.to_string(),
    }
}

/// The texts of [`BackendError`] are Japanese and never quote the URL, the proxy or the
/// password (see `webdav::transport`).
fn backend_error(e: BackendError) -> AppError {
    let message = e.to_string();
    match e {
        BackendError::Offline(_) => AppError::Io { message },
        _ => AppError::Invalid { message },
    }
}

fn tailnet_error(e: TailnetError) -> AppError {
    let message = match e {
        TailnetError::Spawn(_) => "Tailscale を起動できません".to_string(),
        TailnetError::NotRunning => "Tailscale が動いていません".to_string(),
        TailnetError::Timeout => "Tailscale からの応答がありません".to_string(),
        TailnetError::Failed(m) => format!("Tailscale の操作に失敗しました: {m}"),
    };
    AppError::Io { message }
}

/// Checks the typed address without touching the network: http only, a host name, no
/// credentials in it. The resolver is a stand-in; the real one asks the sidecar.
fn parse_nas_url(input: &str) -> AppResult<NasTarget> {
    let host = RefCell::new(String::new());
    let mut url = resolve_nas_url(input, |h| {
        *host.borrow_mut() = h.to_string();
        Ok(IpAddr::V4(Ipv4Addr::LOCALHOST))
    })
    .map_err(nas_url_error)?;
    let host = host.into_inner();
    // The address is stored with the name the user typed, not the tailnet IP the sync talks to.
    url.set_host(Some(&host)).map_err(|_| AppError::Invalid {
        message: "NAS の名前を読めません".into(),
    })?;
    Ok(NasTarget {
        root: url.to_string(),
        host,
    })
}

/// The input of 「確かめる」: address, user and password.
fn validate_nas_input(url: &str, user: &str, password: &str) -> AppResult<(NasTarget, String)> {
    let target = parse_nas_url(url)?;
    let user = user.trim();
    if user.is_empty() {
        return Err(AppError::Invalid {
            message: "ユーザー名を入力してください".into(),
        });
    }
    if password.is_empty() {
        return Err(AppError::Invalid {
            message: "パスワードを入力してください".into(),
        });
    }
    Ok((target, user.to_string()))
}

/// The keychain account of a NAS password: `<user>@<host>`.
fn nas_account(user: &str, host: &str) -> String {
    format!("{user}@{host}")
}

fn stored_account(s: &SyncSettings) -> Option<String> {
    let user = s.nas_user.as_deref().filter(|u| !u.is_empty())?;
    let target = parse_nas_url(s.nas_url.as_deref()?).ok()?;
    Some(nas_account(user, &target.host))
}

// ---- settings ----

/// Applies `f` to the sync part of the settings and writes `settings.json`. In memory it only
/// changes when the file was written.
fn update_sync_settings(
    state: &AppState,
    f: impl FnOnce(&mut SyncSettings),
) -> AppResult<SyncSettings> {
    let mut guard = state.lock_settings();
    let mut next = guard.clone();
    f(&mut next.sync);
    if next == *guard {
        return Ok(next.sync);
    }
    next.save(state.app_data_dir())?;
    *guard = next;
    Ok(guard.sync.clone())
}

/// Moves the sync to another target: the old target is detached first (the records are about to
/// go, and a run against it would start from nothing), then `sync.json` is removed so the new
/// target starts from fresh records (every file is sent again). Returns whether anything
/// changed. The sidecar is the caller's business.
fn switch_backend(state: &AppState, new: SyncBackend) -> AppResult<bool> {
    if state.lock_settings().sync.backend == new {
        return Ok(false);
    }
    update_sync_settings(state, |s| s.backend = new)?;
    state.sync.set_backend(None, BackendKind::Nas, "");
    state.sync.reset_records();
    Ok(true)
}

/// A previous login exists in the state folder: the sidecar can come up without a browser.
fn has_tailnet_login(app_data_dir: &Path) -> bool {
    tailnet::state_dir(app_data_dir)
        .join(TAILNET_LOGIN_FILE)
        .is_file()
}

/// Spec section 4.1: the sidecar starts at launch when the target is the NAS and the user
/// logged in to Tailscale before.
fn should_start_sidecar(s: &SyncSettings, app_data_dir: &Path) -> bool {
    s.backend == SyncBackend::Nas && has_tailnet_login(app_data_dir)
}

fn tailnet_view(state: Option<TailnetState>, start_error: Option<String>) -> TailnetStatusView {
    match (state, start_error) {
        (Some(s), _) => s.view(),
        (None, Some(reason)) => TailnetState::Failed { reason }.view(),
        (None, None) => TailnetState::Stopped.view(),
    }
}

// ---- sidecar ----

/// The running sidecar, started when there is none. Blocking.
fn ensure_tailnet(app: &AppHandle) -> AppResult<Arc<Tailnet>> {
    let state = app.state::<AppState>();
    let rt = &state.sync_rt;
    let mut slot = lock(&rt.tailnet);
    if let Some(t) = slot.as_ref() {
        return Ok(Arc::clone(t));
    }
    let cb_app = app.clone();
    let started = Tailnet::start(
        tailnet::sidecar_path(),
        tailnet::state_dir(state.app_data_dir()),
        tailnet::default_hostname(),
        move |view| on_tailnet_status(&cb_app, view),
    );
    match started {
        Ok(t) => {
            *lock(&rt.start_error) = None;
            let t = Arc::new(t);
            *slot = Some(Arc::clone(&t));
            Ok(t)
        }
        Err(e) => {
            eprintln!("could not start the Tailscale sidecar: {e}");
            let reason =
                "Tailscale を起動できません (powertodo-tailnet が見つからないか、実行できません)"
                    .to_string();
            *lock(&rt.start_error) = Some(reason.clone());
            drop(slot);
            let _ = app.emit("tailnet-status", tailnet_view(None, Some(reason.clone())));
            report_unreachable(app, &reason);
            Err(AppError::Io { message: reason })
        }
    }
}

/// Stops the sidecar (the node leaves the tailnet until it is started again). Blocking: the
/// sidecar gets a few seconds to exit.
fn stop_sidecar(app: &AppHandle) {
    let state = app.state::<AppState>();
    let rt = &state.sync_rt;
    rt.note_tailnet_state(false);
    *lock(&rt.start_error) = None;
    let t = lock(&rt.tailnet).take();
    drop(t);
    let _ = app.emit("tailnet-status", TailnetState::Stopped.view());
}

/// For the app's exit: the sidecar also ends by itself when our end of its stdin closes.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        let t = lock(&state.sync_rt.tailnet).take();
        drop(t);
    }
}

/// Starts the sidecar if the target is the NAS and a login exists. Blocking.
fn start_if_logged_in(app: &AppHandle) {
    let state = app.state::<AppState>();
    let settings = state.lock_settings().sync.clone();
    if should_start_sidecar(&settings, state.app_data_dir()) {
        let _ = ensure_tailnet(app);
    }
}

/// Called on the sidecar's reader thread: no call into `Tailnet` from here (its documentation).
fn on_tailnet_status(app: &AppHandle, view: TailnetStatusView) {
    let _ = app.emit("tailnet-status", &view);
    let state = app.state::<AppState>();
    let (seq, came_up) = state.sync_rt.note_tailnet_state(view.state == "running");
    if came_up {
        let app = app.clone();
        tauri::async_runtime::spawn(async move { connect_nas(&app, Some(seq)).await });
    }
}

/// The NAS is chosen and set up, but the connection cannot be made: say `offline`. Only while
/// the engine has no target (with one, its runs report).
fn report_unreachable(app: &AppHandle, message: &str) {
    let state = app.state::<AppState>();
    let s = state.lock_settings().sync.clone();
    if s.backend == SyncBackend::Nas
        && s.nas_url.is_some()
        && s.nas_user.is_some()
        && !state.sync.has_target()
    {
        state.sync.set_offline(message);
    }
}

/// The WebDAV backend for typed or saved details. Asks the sidecar where the NAS is (a host
/// outside the tailnet is refused) and goes through its proxy. Blocking.
fn build_webdav(
    tailnet: &Tailnet,
    url: &str,
    user: &str,
    password: &str,
) -> AppResult<WebDavBackend> {
    let resolved = resolve_nas_url(url, |host| tailnet.resolve(host, RESOLVE_TIMEOUT))
        .map_err(nas_url_error)?;
    let proxy = tailnet
        .proxy_url()
        .ok_or_else(|| nas_url_error(NasUrlError::NotRunning))?;
    WebDavBackend::new(resolved, user, password, Some(proxy)).map_err(backend_error)
}

/// Gives the engine its backend from the saved URL, user and password. `seq` is the sidecar
/// event this was started for: when a newer one arrived meanwhile the result is dropped. A
/// proxy that went away needs no handling: the engine's runs fail offline until the sidecar is
/// `running` again, which rebuilds the backend here (simpler than detaching on every drop).
async fn connect_nas(app: &AppHandle, seq: Option<u64>) {
    let state = app.state::<AppState>();
    let rt = &state.sync_rt;
    let _guard = rt.connect_lock.lock().await;
    let stale = || seq.is_some_and(|s| rt.seq.load(Ordering::SeqCst) != s);
    if stale() {
        return;
    }
    let s = state.lock_settings().sync.clone();
    let (SyncBackend::Nas, Some(url), Some(user)) = (s.backend, s.nas_url, s.nas_user) else {
        return;
    };
    let Some(tailnet) = rt.current_tailnet() else {
        return;
    };
    let account = nas_account(
        &user,
        &parse_nas_url(&url).map(|t| t.host).unwrap_or_default(),
    );
    let secrets = rt.secrets();
    let built = blocking(move || {
        // Disconnected, or not connected yet: nothing to build.
        let password = secrets.get(NAS_SERVICE, &account)?;
        Some(build_webdav(&tailnet, &url, &user, &password).map(|b| (b, url)))
    })
    .await;
    let built = match built {
        Ok(Some(b)) => b,
        Ok(None) => return,
        Err(e) => {
            eprintln!("connecting to the NAS: {e}");
            return;
        }
    };
    match built {
        Ok((backend, root)) => {
            if stale() || state.lock_settings().sync.backend != SyncBackend::Nas {
                return;
            }
            state
                .sync
                .set_backend(Some(Arc::new(backend)), BackendKind::Nas, &root);
        }
        Err(e) => report_unreachable(app, &e.to_string()),
    }
}

// ---- start-up ----

/// Loads the sync settings and, when the NAS was in use and a login exists, starts the sidecar
/// (spec section 4.1). Never opens a login page. The engine gets its backend when the sidecar
/// reports `running`.
pub fn start(app: &AppHandle) {
    let state = app.state::<AppState>();
    // `startup` reads the file again when the store opens; the sidecar must not wait for that.
    match AppSettings::load(state.app_data_dir()) {
        Ok(loaded) => *state.lock_settings() = loaded,
        Err(e) => eprintln!("settings.json ignored: {e}"),
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || start_if_logged_in(&app));
}

// ---- commands ----

#[tauri::command]
pub async fn sync_settings(app: AppHandle) -> AppResult<SyncSettingsDto> {
    current_dto(&app).await
}

/// Chooses the sync target. A change sends every file again at the next sync (the records are
/// dropped) and ends the sidecar when the new target is not the NAS.
#[tauri::command]
pub async fn set_sync_backend(
    backend: SyncBackend,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<SyncSettingsDto> {
    if switch_backend(state.inner(), backend)? {
        let a = app.clone();
        if backend == SyncBackend::Nas {
            blocking(move || start_if_logged_in(&a)).await?;
        } else {
            blocking(move || stop_sidecar(&a)).await?;
        }
    }
    current_dto(&app).await
}

#[tauri::command]
pub async fn tailnet_status(state: State<'_, AppState>) -> AppResult<TailnetStatusView> {
    let rt = &state.sync_rt;
    let tailnet_state = rt.current_tailnet().map(|t| t.state());
    Ok(tailnet_view(tailnet_state, lock(&rt.start_error).clone()))
}

fn require_nas(state: &AppState) -> AppResult<()> {
    if state.lock_settings().sync.backend == SyncBackend::Nas {
        Ok(())
    } else {
        Err(AppError::Invalid {
            message: "同期先が Synology NAS ではありません".into(),
        })
    }
}

/// Starts the sidecar if needed and the interactive login; the URL arrives as a
/// `tailnet-status` with `needs_login` and the UI opens it.
#[tauri::command]
pub async fn tailnet_login(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    require_nas(state.inner())?;
    let a = app.clone();
    let tailnet = blocking(move || ensure_tailnet(&a)).await??;
    blocking(move || tailnet.login().map_err(tailnet_error)).await?
}

#[tauri::command]
pub async fn tailnet_logout(state: State<'_, AppState>) -> AppResult<()> {
    match state.sync_rt.current_tailnet() {
        Some(tailnet) => blocking(move || tailnet.logout().map_err(tailnet_error)).await?,
        None => Ok(()),
    }
}

/// Deletes the Tailscale state and starts over (the node needs a login again).
#[tauri::command]
pub async fn tailnet_reset(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    require_nas(state.inner())?;
    let a = app.clone();
    blocking(move || {
        let state = a.state::<AppState>();
        match state.sync_rt.current_tailnet() {
            Some(tailnet) => tailnet.reset().map_err(tailnet_error),
            None => {
                let dir = tailnet::state_dir(state.app_data_dir());
                if let Err(e) = std::fs::remove_dir_all(&dir)
                    && e.kind() != std::io::ErrorKind::NotFound
                {
                    return Err(AppError::from(e));
                }
                ensure_tailnet(&a).map(|_| ())
            }
        }
    })
    .await?
}

/// Everything 「確かめる」 can refuse without asking the network.
fn check_preconditions(
    state: &AppState,
    url: &str,
    user: &str,
    password: &str,
) -> AppResult<(NasTarget, String, Arc<Tailnet>)> {
    let (target, user) = validate_nas_input(url, user, password)?;
    require_nas(state)?;
    let tailnet = state
        .sync_rt
        .current_tailnet()
        .ok_or_else(|| AppError::Invalid {
            message: "Tailscale に接続していません。先に「Tailscale にログイン」してください"
                .into(),
        })?;
    Ok((target, user, tailnet))
}

/// 「確かめる」: finds the NAS in the tailnet, writes a file, reads it back and deletes it. On
/// success the details are kept (the password in the keychain), the engine gets the backend
/// and a sync is asked for.
#[tauri::command]
pub async fn nas_check(
    url: String,
    user: String,
    password: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let (target, user, tailnet) = check_preconditions(state.inner(), &url, &user, &password)?;
    let (typed_url, typed_user, typed_password) = (url, user.clone(), password.clone());
    let backend =
        blocking(move || build_webdav(&tailnet, &typed_url, &typed_user, &typed_password))
            .await??;
    backend.check().await.map_err(backend_error)?;

    let rt = &state.sync_rt;
    let _guard = rt.connect_lock.lock().await;
    // The details are right; keep them.
    let previous = stored_account(&state.lock_settings().sync);
    let account = nas_account(&user, &target.host);
    let secrets = rt.secrets();
    let (acc, pw, old) = (
        account.clone(),
        password,
        previous.filter(|p| *p != account),
    );
    blocking(move || {
        secrets.set(NAS_SERVICE, &acc, &pw);
        // The details moved to another account: the old password has no use.
        if let Some(old) = old {
            let _ = secrets.delete(NAS_SERVICE, &old);
        }
    })
    .await?;
    update_sync_settings(state.inner(), |s| {
        s.nas_url = Some(target.root.clone());
        s.nas_user = Some(user);
    })?;
    // `set_backend` also lets the runs go again after an earlier rejection and asks for one.
    state
        .sync
        .set_backend(Some(Arc::new(backend)), BackendKind::Nas, &target.root);
    Ok(())
}

/// Takes the backend away and forgets the password; the URL and the user stay for the next
/// time. The sidecar keeps running (the Tailscale login is a separate thing).
#[tauri::command]
pub async fn nas_disconnect(state: State<'_, AppState>) -> AppResult<()> {
    let rt = &state.sync_rt;
    let _guard = rt.connect_lock.lock().await;
    // A backend being built for an older sidecar event must not come back.
    rt.seq.fetch_add(1, Ordering::SeqCst);
    state.sync.set_backend(None, BackendKind::Nas, "");
    let Some(account) = stored_account(&state.lock_settings().sync) else {
        return Ok(());
    };
    let secrets = rt.secrets();
    blocking(move || secrets.delete(NAS_SERVICE, &account))
        .await?
        .map_err(|_| AppError::Io {
            message: "キーチェーンからパスワードを削除できませんでした".into(),
        })
}

/// 「今すぐ同期」. A NAS whose backend could not be built earlier gets another try first.
#[tauri::command]
pub async fn sync_now(app: AppHandle, state: State<'_, AppState>) -> AppResult<SyncStatusView> {
    let tailnet_up = state
        .sync_rt
        .current_tailnet()
        .is_some_and(|t| matches!(t.state(), TailnetState::Running { .. }));
    if !state.sync.has_target() && tailnet_up {
        connect_nas(&app, None).await;
    }
    state.sync.request(SyncReason::SyncNow);
    Ok(state.sync.status())
}

#[tauri::command]
pub async fn sync_status(state: State<'_, AppState>) -> AppResult<SyncStatusView> {
    Ok(state.sync.status())
}

/// The user's choice after a side looked wiped (`SyncStatusView::suspect`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecoverMode {
    /// This folder becomes equal to the sync target.
    MirrorRemote,
    /// The sync target becomes equal to this folder.
    MirrorLocal,
}

impl RecoverMode {
    fn plan_mode(self) -> PlanMode {
        match self {
            RecoverMode::MirrorRemote => PlanMode::MirrorRemote,
            RecoverMode::MirrorLocal => PlanMode::MirrorLocal,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRecoverDto {
    /// `done`, `suspect`, `offline`, `failed`, `interrupted` or `notRun`.
    pub outcome: &'static str,
    pub uploaded: u32,
    pub downloaded: u32,
    pub archived: u32,
    pub failed: u32,
}

fn outcome_name(o: RunOutcome) -> &'static str {
    match o {
        RunOutcome::NotRun => "notRun",
        RunOutcome::Done => "done",
        RunOutcome::Suspect(_) => "suspect",
        RunOutcome::Offline => "offline",
        RunOutcome::Failed => "failed",
        RunOutcome::Interrupted => "interrupted",
    }
}

fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// Runs the one-shot recovery after a `suspect` status. The UI asks the user first.
#[tauri::command]
pub async fn sync_recover(
    mode: RecoverMode,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<SyncRecoverDto> {
    let host = TauriSyncHost { app };
    let report = state.sync.run_mirror(&host, mode.plan_mode()).await;
    Ok(SyncRecoverDto {
        outcome: outcome_name(report.outcome),
        uploaded: count(report.uploaded.len()),
        downloaded: count(report.downloaded.len()),
        archived: count(report.archived_local.len() + report.archived_remote.len()),
        failed: count(report.failed.len()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;
    use crate::store::paths::write_atomic;
    use crate::sync::SyncPhase;
    use crate::sync::backend::MemoryBackend;
    use crate::sync::secrets::SecretError;
    use crate::sync::state::SyncState;
    use chrono::NaiveDateTime;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").unwrap()
    }

    fn invalid_text<T>(r: AppResult<T>) -> String {
        match r {
            Err(AppError::Invalid { message }) => message,
            Err(e) => panic!("expected an invalid error, got {e:?}"),
            Ok(_) => panic!("expected an error"),
        }
    }

    // ---- NAS input ----

    #[test]
    fn nas_check_input_is_validated_before_anything_else() {
        // https is refused (the sync talks to the tailnet IP, a certificate would not match).
        let m = invalid_text(validate_nas_input(
            "https://nas:5005/powertodo/",
            "たろう",
            "pw",
        ));
        assert!(m.contains("https"), "{m}");
        // An empty user (also blanks), an empty password, an empty address.
        assert!(
            invalid_text(validate_nas_input("http://nas/powertodo/", "  ", "pw"))
                .contains("ユーザー名")
        );
        assert!(
            invalid_text(validate_nas_input("http://nas/powertodo/", "たろう", ""))
                .contains("パスワード")
        );
        invalid_text(validate_nas_input("   ", "たろう", "pw"));
        // Credentials belong in their own fields.
        invalid_text(validate_nas_input(
            "http://たろう:pw@nas/powertodo/",
            "たろう",
            "pw",
        ));
        // Other schemes.
        invalid_text(validate_nas_input("ftp://nas/powertodo/", "たろう", "pw"));
    }

    #[test]
    fn nas_address_is_kept_as_the_user_named_it() {
        let (t, user) = validate_nas_input(" http://NAS/powertodo ", " たろう ", "pw").unwrap();
        // Port and trailing slash filled in, host in lower case, never the tailnet IP.
        assert_eq!(t.root, "http://nas:5005/powertodo/");
        assert_eq!(t.host, "nas");
        assert_eq!(user, "たろう");
        let (t, _) = validate_nas_input("nas.tail1234.ts.net:5006/a/b/", "u", "p").unwrap();
        assert_eq!(t.root, "http://nas.tail1234.ts.net:5006/a/b/");
        assert_eq!(nas_account("たろう", &t.host), "たろう@nas.tail1234.ts.net");
    }

    #[test]
    fn nas_password_account_comes_from_the_saved_details() {
        let mut s = SyncSettings::default();
        assert_eq!(stored_account(&s), None);
        s.nas_url = Some("http://nas:5005/powertodo/".into());
        assert_eq!(stored_account(&s), None);
        s.nas_user = Some("たろう".into());
        assert_eq!(stored_account(&s).as_deref(), Some("たろう@nas"));
        s.nas_user = Some(String::new());
        assert_eq!(stored_account(&s), None);
    }

    #[test]
    fn the_check_stops_early_without_nas_chosen_or_a_sidecar() {
        let app = tempfile::tempdir().unwrap();
        let state = AppState::new(app.path().to_path_buf());
        // Bad input first, whatever the rest looks like.
        let m = invalid_text(check_preconditions(&state, "https://nas/", "u", "p"));
        assert!(m.contains("https"), "{m}");
        // The NAS is not the chosen target.
        let m = invalid_text(check_preconditions(&state, "http://nas/x/", "u", "p"));
        assert!(m.contains("Synology NAS"), "{m}");
        // The NAS is chosen but the sidecar is not up.
        switch_backend(&state, SyncBackend::Nas).unwrap();
        let m = invalid_text(check_preconditions(&state, "http://nas/x/", "u", "p"));
        assert!(m.contains("Tailscale"), "{m}");
    }

    // ---- DTO ----

    #[test]
    fn the_settings_dto_has_camel_case_keys_and_omits_what_is_unset() {
        let s = SyncSettings {
            backend: SyncBackend::Nas,
            nas_url: Some("http://nas:5005/powertodo/".into()),
            nas_user: Some("たろう".into()),
            google_email: None,
        };
        let v = serde_json::to_value(settings_dto(&s, true, false, false)).unwrap();
        assert_eq!(
            v,
            serde_json::json!({
                "backend": "nas",
                "nasUrl": "http://nas:5005/powertodo/",
                "nasUser": "たろう",
                "nasPasswordSet": true,
                "passwordPersistent": false,
                "googleAvailable": false,
            })
        );
        let v = serde_json::to_value(settings_dto(&SyncSettings::default(), false, true, true))
            .unwrap();
        assert_eq!(
            v,
            serde_json::json!({
                "backend": "none",
                "nasPasswordSet": false,
                "passwordPersistent": true,
                "googleAvailable": true,
            })
        );
    }

    // ---- switching ----

    #[tokio::test]
    async fn switching_the_target_starts_from_fresh_records_and_keeps_the_nas_details() {
        let app = tempfile::tempdir().unwrap();
        let state = AppState::new(app.path().to_path_buf());
        // A saved folder setting must survive the changes below.
        AppSettings {
            data_dir: Some(app.path().join("data")),
            ..AppSettings::default()
        }
        .save(app.path())
        .unwrap();
        *state.lock_settings() = AppSettings::load(app.path()).unwrap();
        update_sync_settings(&state, |s| {
            s.backend = SyncBackend::Nas;
            s.nas_url = Some("http://nas:5005/powertodo/".into());
            s.nas_user = Some("たろう".into());
        })
        .unwrap();

        // The engine syncs with a NAS and left records behind.
        state.sync.set_backend(
            Some(Arc::new(MemoryBackend::new(|| dt("2026-10-16T09:30:00")))),
            BackendKind::Nas,
            "http://nas:5005/powertodo/",
        );
        let mut records = SyncState::new(
            &app.path().join("data"),
            BackendKind::Nas,
            "http://nas:5005/powertodo/",
        );
        records.last_sync = Some(dt("2026-10-16T09:30:00"));
        records.save(app.path()).unwrap();
        assert!(app.path().join(SyncState::FILE).exists());
        assert!(state.sync.has_target());

        // Same target again: nothing happens.
        assert!(!switch_backend(&state, SyncBackend::Nas).unwrap());
        assert!(app.path().join(SyncState::FILE).exists());
        assert!(state.sync.has_target());

        // Another target: the records are gone, the old target is detached, the sync is off.
        assert!(switch_backend(&state, SyncBackend::Gdrive).unwrap());
        assert!(!app.path().join(SyncState::FILE).exists());
        assert!(!state.sync.has_target());
        assert_eq!(state.sync.status().state, SyncPhase::Off);
        let fresh = SyncState::load(
            app.path(),
            &app.path().join("data"),
            BackendKind::Nas,
            "http://nas:5005/powertodo/",
        );
        assert!(fresh.files.is_empty() && fresh.last_sync.is_none());

        // Written down, with the NAS details and the data folder untouched.
        let saved = AppSettings::load(app.path()).unwrap();
        assert_eq!(saved.sync.backend, SyncBackend::Gdrive);
        assert_eq!(saved.sync.nas_user.as_deref(), Some("たろう"));
        assert_eq!(
            saved.data_dir.as_deref(),
            Some(app.path().join("data").as_path())
        );
        assert_eq!(*state.lock_settings(), saved);

        // And back to none.
        assert!(switch_backend(&state, SyncBackend::None).unwrap());
        assert_eq!(
            AppSettings::load(app.path()).unwrap().sync.backend,
            SyncBackend::None
        );
    }

    #[test]
    fn a_failed_settings_write_changes_nothing() {
        let app = tempfile::tempdir().unwrap();
        // The app data dir is a file: settings.json cannot be written under it.
        let blocker = app.path().join("not-a-dir");
        write_atomic(&blocker, b"x").unwrap();
        let state = AppState::new(blocker);
        assert!(switch_backend(&state, SyncBackend::Nas).is_err());
        assert_eq!(state.lock_settings().sync.backend, SyncBackend::None);
    }

    // ---- sidecar start-up ----

    #[test]
    fn the_sidecar_starts_at_launch_only_for_the_nas_with_a_past_login() {
        let app = tempfile::tempdir().unwrap();
        let nas = SyncSettings {
            backend: SyncBackend::Nas,
            ..SyncSettings::default()
        };
        // No login yet: nothing starts (and no login page opens by itself).
        assert!(!should_start_sidecar(&nas, app.path()));
        let dir = tailnet::state_dir(app.path());
        std::fs::create_dir_all(&dir).unwrap();
        assert!(
            !should_start_sidecar(&nas, app.path()),
            "an empty state folder"
        );
        std::fs::write(dir.join(TAILNET_LOGIN_FILE), b"{}").unwrap();
        assert!(should_start_sidecar(&nas, app.path()));
        // The login of an earlier NAS use does not start anything for other targets.
        for backend in [SyncBackend::None, SyncBackend::Gdrive] {
            let s = SyncSettings {
                backend,
                ..SyncSettings::default()
            };
            assert!(!should_start_sidecar(&s, app.path()));
        }
    }

    #[test]
    fn the_sidecar_coming_up_is_noticed_once() {
        let rt = SyncRuntime::new();
        let (s1, up) = rt.note_tailnet_state(false);
        assert!(!up);
        let (s2, up) = rt.note_tailnet_state(true);
        assert!(up && s2 > s1);
        // A repeated `running` (name or address changed) is not a new connection.
        let (s3, up) = rt.note_tailnet_state(true);
        assert!(!up && s3 > s2);
        // A restart goes through another state first, then comes up again.
        rt.note_tailnet_state(false);
        let (_, up) = rt.note_tailnet_state(true);
        assert!(up);
    }

    #[test]
    fn the_tailnet_status_without_a_sidecar() {
        assert_eq!(tailnet_view(None, None).state, "stopped");
        let failed = tailnet_view(None, Some("起動できません".into()));
        assert_eq!(failed.state, "failed");
        assert_eq!(failed.error.as_deref(), Some("起動できません"));
        let running = tailnet_view(
            Some(TailnetState::Running {
                name: "powertodo-mac".into(),
                ip: "100.64.0.2".into(),
            }),
            Some("stale".into()),
        );
        assert_eq!(running.state, "running");
    }

    // ---- recovery ----

    #[test]
    fn recover_modes_read_the_names_the_ui_sends() {
        let m: RecoverMode = serde_json::from_str("\"mirrorRemote\"").unwrap();
        assert_eq!(m.plan_mode(), PlanMode::MirrorRemote);
        let m: RecoverMode = serde_json::from_str("\"mirrorLocal\"").unwrap();
        assert_eq!(m.plan_mode(), PlanMode::MirrorLocal);
        // The normal mode is not something the UI can ask for.
        assert!(serde_json::from_str::<RecoverMode>("\"normal\"").is_err());
        assert_eq!(outcome_name(RunOutcome::Done), "done");
        assert_eq!(outcome_name(RunOutcome::NotRun), "notRun");
    }

    // ---- secrets ----

    /// A keychain that works or, with `broken`, fails every call.
    struct Keychain {
        inner: MemoryStore,
        broken: AtomicBool,
    }

    impl Keychain {
        fn new() -> Arc<Self> {
            Arc::new(Keychain {
                inner: MemoryStore::new(),
                broken: AtomicBool::new(false),
            })
        }
        fn check(&self) -> SecretResult<()> {
            if self.broken.load(Ordering::SeqCst) {
                Err(SecretError("キーチェーンを使えません".into()))
            } else {
                Ok(())
            }
        }
    }

    impl SecretStore for Keychain {
        fn get(&self, service: &str, account: &str) -> SecretResult<Option<String>> {
            self.check()?;
            self.inner.get(service, account)
        }
        fn set(&self, service: &str, account: &str, secret: &str) -> SecretResult<()> {
            self.check()?;
            self.inner.set(service, account, secret)
        }
        fn delete(&self, service: &str, account: &str) -> SecretResult<()> {
            self.check()?;
            self.inner.delete(service, account)
        }
    }

    #[test]
    fn the_password_goes_to_the_keychain_and_is_read_once() {
        let kc = Keychain::new();
        let secrets = Secrets::new(kc.clone());
        assert_eq!(secrets.get(NAS_SERVICE, "u@nas"), None);
        assert!(secrets.set(NAS_SERVICE, "u@nas", "pw"));
        assert!(secrets.persistent());
        assert_eq!(
            kc.inner.get(NAS_SERVICE, "u@nas").unwrap().as_deref(),
            Some("pw")
        );
        // A new process reads it back from the keychain.
        let again = Secrets::new(kc.clone());
        assert_eq!(again.get(NAS_SERVICE, "u@nas").as_deref(), Some("pw"));
        // Later reads do not touch the keychain (it may prompt): they come from memory.
        kc.broken.store(true, Ordering::SeqCst);
        assert_eq!(again.get(NAS_SERVICE, "u@nas").as_deref(), Some("pw"));
        assert!(
            again.persistent(),
            "a read from memory says nothing about the keychain"
        );
        kc.broken.store(false, Ordering::SeqCst);
        again.delete(NAS_SERVICE, "u@nas").unwrap();
        assert_eq!(again.get(NAS_SERVICE, "u@nas"), None);
        assert_eq!(kc.inner.get(NAS_SERVICE, "u@nas").unwrap(), None);
    }

    #[test]
    fn without_a_usable_keychain_the_password_lives_in_memory_for_this_run() {
        let kc = Keychain::new();
        kc.broken.store(true, Ordering::SeqCst);
        let secrets = Secrets::new(kc.clone());
        // A failed read is not "not set": the memory copy answers, nothing is cached as absent.
        assert_eq!(secrets.get(NAS_SERVICE, "u@nas"), None);
        assert!(!secrets.set(NAS_SERVICE, "u@nas", "pw"));
        assert!(!secrets.persistent());
        assert_eq!(secrets.get(NAS_SERVICE, "u@nas").as_deref(), Some("pw"));
        // Disconnecting works even though the keychain never held it.
        secrets.delete(NAS_SERVICE, "u@nas").unwrap();
        assert_eq!(secrets.get(NAS_SERVICE, "u@nas"), None);
        // The keychain comes back: the next password is saved there again.
        kc.broken.store(false, Ordering::SeqCst);
        assert!(secrets.set(NAS_SERVICE, "u@nas", "pw2"));
        assert!(secrets.persistent());
        assert_eq!(
            kc.inner.get(NAS_SERVICE, "u@nas").unwrap().as_deref(),
            Some("pw2")
        );
    }

    #[test]
    fn deleting_from_a_keychain_that_should_have_it_reports_the_failure() {
        let kc = Keychain::new();
        let secrets = Secrets::new(kc.clone());
        assert!(secrets.set(NAS_SERVICE, "u@nas", "pw"));
        kc.broken.store(true, Ordering::SeqCst);
        assert!(secrets.delete(NAS_SERVICE, "u@nas").is_err());
        // Still there: the next read asks the keychain again.
        kc.broken.store(false, Ordering::SeqCst);
        assert_eq!(secrets.get(NAS_SERVICE, "u@nas").as_deref(), Some("pw"));
    }
}
