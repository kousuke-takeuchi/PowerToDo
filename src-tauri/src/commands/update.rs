//! App updates (spec section 3 of the release / updater design): look for a new version, and
//! install it after the sync was stopped. The JS side has no `updater:*` permission; it goes
//! through the commands here, which keep the order of the steps.
//!
//! Nothing here logs an error's text: a `reqwest` error names the update URL.

use std::ffi::OsStr;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::AppState;
use crate::error::{AppError, AppResult};
use crate::store::paths::UpdateSettings;

#[cfg(desktop)]
use std::sync::Mutex;
#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(desktop)]
use std::time::{Duration, Instant};
#[cfg(desktop)]
use tauri::Emitter;
#[cfg(desktop)]
use tauri_plugin_updater::UpdaterExt;

/// How long `update_install` waits for a running sync to end.
#[cfg(desktop)]
const SYNC_WAIT: Duration = Duration::from_secs(60);
/// The longest wait for a connection to the update server.
#[cfg(desktop)]
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// The longest silence on an open connection. It is per read, so a slow download that keeps
/// receiving data is not cut off (unlike `UpdaterBuilder::timeout`, a limit on the whole
/// request).
#[cfg(desktop)]
const READ_TIMEOUT: Duration = Duration::from_secs(60);
/// The least time between two `downloading` events.
#[cfg(desktop)]
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

#[cfg(desktop)]
const MSG_OFFLINE: &str = "更新を確かめられませんでした (ネットワークを確かめてください)";
#[cfg(desktop)]
const MSG_NO_MANIFEST: &str = "更新の案内がまだありません。しばらくしてからもう一度お試しください";
#[cfg(desktop)]
const MSG_INVALID: &str = "更新ファイルを確かめられませんでした";
#[cfg(desktop)]
const MSG_BUSY: &str =
    "同期が終わらないため、更新を中止しました。しばらくしてからもう一度お試しください";
#[cfg(desktop)]
const MSG_HELD: &str =
    "Excel などで直した変更の確認が残っています。確認してからもう一度お試しください";
#[cfg(desktop)]
const MSG_DOWNLOAD: &str = "更新のダウンロードに失敗しました。データはそのままです";
#[cfg(desktop)]
const MSG_NOT_CHECKED: &str = "先に更新を確認してください";
const MSG_UNSUPPORTED: &str = "この環境ではアプリ内で更新できません";
#[cfg(desktop)]
const MSG_INSTALLING: &str = "更新の途中です";
#[cfg(desktop)]
const MSG_UNSAVED: &str =
    "保存できていない変更があるため、更新を中止しました。保存を確かめてからもう一度お試しください";

fn invalid(message: &str) -> AppError {
    AppError::Invalid {
        message: message.into(),
    }
}

// ---- DTOs ----

/// Whether this build can update itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateSupport {
    /// It can.
    Supported,
    /// A debug build: never checks.
    Dev,
    /// Linux outside an AppImage (deb / rpm): the user takes the new package from the release
    /// page.
    Manual,
}

/// `debug`: a debug build. `linux`: running on Linux. `appimage`: the `APPIMAGE` environment
/// variable (set by the AppImage runtime).
pub fn support(debug: bool, linux: bool, appimage: Option<&OsStr>) -> UpdateSupport {
    if debug {
        UpdateSupport::Dev
    } else if linux && appimage.is_none() {
        UpdateSupport::Manual
    } else {
        UpdateSupport::Supported
    }
}

#[cfg(desktop)]
fn support_now() -> UpdateSupport {
    support(
        cfg!(debug_assertions),
        cfg!(target_os = "linux"),
        std::env::var_os("APPIMAGE").as_deref(),
    )
}

/// Mobile apps are updated by their store.
#[cfg(not(desktop))]
fn support_now() -> UpdateSupport {
    UpdateSupport::Manual
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatusDto {
    pub current_version: String,
    pub support: UpdateSupport,
    pub auto_check: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckDto {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// RFC 3339.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
}

/// The `update-progress` event.
#[cfg(desktop)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    phase: Phase,
    #[serde(skip_serializing_if = "Option::is_none")]
    received: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<u64>,
}

#[cfg(desktop)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Phase {
    WaitingSync,
    Downloading,
    Installing,
}

#[cfg(desktop)]
impl ProgressEvent {
    fn phase(phase: Phase) -> Self {
        ProgressEvent {
            phase,
            received: None,
            total: None,
        }
    }
}

// ---- the order around the download ----

/// What `update_install` does around the download, so the order can be tested without an app.
#[cfg(desktop)]
trait Prep {
    /// New sync runs stop starting.
    fn pause(&self);
    /// `false`: a sync run was still going after `timeout`.
    async fn wait_idle(&self, timeout: Duration) -> bool;
    /// Projects with an external change the user has not decided about.
    fn held(&self) -> Vec<String>;
    /// Ends the Tailscale sidecar (it blocks for a moment while the child exits).
    async fn stop_sidecar(&self);
    fn resume(&self);
    async fn restart_sidecar(&self);
    /// Writes the edits the saver still holds. `false`: something could not be saved.
    async fn flush(&self) -> bool;
}

/// Pauses the sync, waits for it, refuses while a project is held, and stops the sidecar last.
/// On a refusal the sync is resumed again; after `Ok` the caller owns the undo (`undo`).
#[cfg(desktop)]
async fn prepare(prep: &impl Prep, timeout: Duration) -> AppResult<()> {
    prep.pause();
    if !prep.wait_idle(timeout).await {
        prep.resume();
        return Err(invalid(MSG_BUSY));
    }
    if !prep.held().is_empty() {
        prep.resume();
        return Err(invalid(MSG_HELD));
    }
    prep.stop_sidecar().await;
    Ok(())
}

/// Puts the sync back after `prepare` succeeded and the install then failed.
#[cfg(desktop)]
async fn undo(prep: &impl Prep) {
    prep.resume();
    prep.restart_sidecar().await;
}

/// The last step before `install`: on Windows a good install ends the process without
/// `RunEvent::Exit`, which is where the edits the saver holds are normally written. Saves them
/// now; when something cannot be saved the update is given up (and undone).
#[cfg(desktop)]
async fn flush_before_install(prep: &impl Prep) -> AppResult<()> {
    if prep.flush().await {
        Ok(())
    } else {
        undo(prep).await;
        Err(invalid(MSG_UNSAVED))
    }
}

/// The found version, kept between `update_check` and `update_install`, and the flag that only
/// one install runs. Both change under one lock, so a check that ends while an install starts
/// cannot put the version back after the install took it.
#[cfg(desktop)]
pub struct UpdateSlot<T> {
    found: Mutex<Option<T>>,
    installing: AtomicBool,
}

/// Held for the length of an install; ends it for the slot when dropped.
#[cfg(desktop)]
struct InstallGuard<'a, T>(&'a UpdateSlot<T>);

#[cfg(desktop)]
impl<T> Drop for InstallGuard<'_, T> {
    fn drop(&mut self) {
        self.0.installing.store(false, Ordering::SeqCst);
    }
}

#[cfg(desktop)]
impl<T> Default for UpdateSlot<T> {
    fn default() -> Self {
        UpdateSlot {
            found: Mutex::new(None),
            installing: AtomicBool::new(false),
        }
    }
}

#[cfg(desktop)]
impl<T> UpdateSlot<T> {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<T>> {
        self.found.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn is_installing(&self) -> bool {
        self.installing.load(Ordering::SeqCst)
    }

    /// What a check found (`None`: nothing newer). Ignored while an install runs.
    fn offer(&self, found: Option<T>) {
        let mut slot = self.lock();
        if !self.is_installing() {
            *slot = found;
        }
    }

    /// Takes the found version and marks the install as running. Refused while another one
    /// runs, and when nothing was found.
    fn begin_install(&self) -> AppResult<(InstallGuard<'_, T>, T)> {
        let mut slot = self.lock();
        if self.installing.swap(true, Ordering::SeqCst) {
            return Err(invalid(MSG_INSTALLING));
        }
        let guard = InstallGuard(self);
        match slot.take() {
            Some(found) => Ok((guard, found)),
            None => Err(invalid(MSG_NOT_CHECKED)),
        }
    }

    /// Gives the version back after a failed install, so asking again needs no new check.
    fn keep(&self, found: T) {
        *self.lock() = Some(found);
    }
}

// ---- errors ----

/// The package or the answer of the server is not what it should be (as opposed to the
/// network failing).
#[cfg(desktop)]
fn is_bad_package(e: &tauri_plugin_updater::Error) -> bool {
    use tauri_plugin_updater::Error as E;
    matches!(
        e,
        E::Minisign(_)
            | E::Base64(_)
            | E::SignatureUtf8(_)
            | E::SignedVersionMismatch { .. }
            | E::MissingSignedVersion
            | E::InvalidUpdaterFormat
            | E::BinaryNotFoundInArchive
            | E::Semver(_)
            | E::Serialization(_)
            | E::TargetNotFound(_)
            | E::TargetsNotFound(_)
    )
}

/// An error of `Updater::check`.
#[cfg(desktop)]
fn check_error(e: &tauri_plugin_updater::Error) -> AppError {
    use tauri_plugin_updater::Error as E;
    invalid(if matches!(e, E::ReleaseNotFound) {
        // The endpoint answered without a manifest (e.g. `latest.json` is not uploaded yet).
        MSG_NO_MANIFEST
    } else if is_bad_package(e) {
        MSG_INVALID
    } else {
        MSG_OFFLINE
    })
}

/// An error of `Update::download` or `Update::install`.
#[cfg(desktop)]
fn install_error(e: &tauri_plugin_updater::Error) -> AppError {
    invalid(if is_bad_package(e) {
        MSG_INVALID
    } else {
        MSG_DOWNLOAD
    })
}

// ---- progress ----

/// Lets a `downloading` event through at most every [`PROGRESS_EVERY`].
#[cfg(desktop)]
#[derive(Default)]
struct ProgressGate {
    received: u64,
    last: Option<Instant>,
}

#[cfg(desktop)]
impl ProgressGate {
    /// Adds a chunk; `Some(received so far)` when an event is due at `now`.
    fn add(&mut self, chunk: usize, now: Instant) -> Option<u64> {
        self.received += chunk as u64;
        match self.last {
            Some(t) if now.duration_since(t) < PROGRESS_EVERY => None,
            _ => {
                self.last = Some(now);
                Some(self.received)
            }
        }
    }
}

// ---- settings ----

/// Applies `f` to the update part of the settings and writes `settings.json`, the way
/// `update_sync_settings` does for the sync part. In memory it only changes when the file was
/// written. Does file I/O: call from `spawn_blocking`.
fn update_update_settings(
    state: &AppState,
    f: impl FnOnce(&mut UpdateSettings),
) -> AppResult<UpdateSettings> {
    let _writer = state.sync_rt.lock_settings_write();
    let current = state.lock_settings().clone();
    let mut next = current.clone();
    f(&mut next.updates);
    if next == current {
        return Ok(next.updates);
    }
    next.save(state.app_data_dir())?;
    *state.lock_settings() = next.clone();
    Ok(next.updates)
}

// ---- commands ----

#[tauri::command]
pub fn update_status(app: AppHandle) -> UpdateStatusDto {
    let state = app.state::<AppState>();
    let auto_check = state.lock_settings().updates.auto_check;
    UpdateStatusDto {
        current_version: app.package_info().version.to_string(),
        support: support_now(),
        auto_check,
    }
}

#[tauri::command]
pub async fn set_update_auto_check(app: AppHandle, enabled: bool) -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        update_update_settings(&state, |u| u.auto_check = enabled).map(|_| ())
    })
    .await
    .map_err(|e| AppError::Io {
        message: format!("内部エラー: {e}"),
    })?
}

/// Looks for a new version. The one found is kept for `update_install`.
#[cfg(desktop)]
#[tauri::command]
pub async fn update_check(app: AppHandle) -> AppResult<UpdateCheckDto> {
    if support_now() != UpdateSupport::Supported {
        return Ok(UpdateCheckDto::default());
    }
    let state = app.state::<AppState>();
    // An install is running: it has taken the version, and a check must not bring it back.
    if state.update_slot.is_installing() {
        return Ok(UpdateCheckDto::default());
    }
    // The context in `Update` is a clone of this one, so `download` gets the same timeouts.
    let updater = app
        .updater_builder()
        .configure_client(|c| {
            c.connect_timeout(CONNECT_TIMEOUT)
                .read_timeout(READ_TIMEOUT)
        })
        .build()
        .map_err(|e| check_error(&e))?;
    let found = updater.check().await.map_err(|e| check_error(&e))?;
    let dto = found.as_ref().map(|u| UpdateCheckDto {
        available: true,
        version: Some(u.version.clone()),
        notes: u.body.clone(),
        date: u
            .date
            .and_then(|d| chrono::DateTime::from_timestamp(d.unix_timestamp(), 0))
            .map(|d| d.to_rfc3339()),
    });
    state.update_slot.offer(found);
    Ok(dto.unwrap_or_default())
}

/// The real thing behind [`Prep`].
#[cfg(desktop)]
struct AppPrep(AppHandle);

#[cfg(desktop)]
impl Prep for AppPrep {
    fn pause(&self) {
        self.0.state::<AppState>().sync.pause_for_update();
    }

    async fn wait_idle(&self, timeout: Duration) -> bool {
        self.0.state::<AppState>().sync.wait_idle(timeout).await
    }

    fn held(&self) -> Vec<String> {
        self.0.state::<AppState>().held_projects()
    }

    async fn stop_sidecar(&self) {
        let app = self.0.clone();
        let _ =
            tauri::async_runtime::spawn_blocking(move || super::sync::stop_for_update(&app)).await;
    }

    fn resume(&self) {
        self.0.state::<AppState>().sync.resume();
    }

    async fn restart_sidecar(&self) {
        let app = self.0.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            super::sync::restart_after_failed_update(&app)
        })
        .await;
    }

    async fn flush(&self) -> bool {
        let app = self.0.clone();
        // A task that did not finish counts as not saved.
        tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().flush_all().is_empty())
            .await
            .unwrap_or(false)
    }
}

/// Installs the version `update_check` found: the sync is stopped first, the package is
/// downloaded and checked against the public key, the edits still held are written, then it is
/// installed. On macOS and Linux the app restarts here; on Windows the installer ends it. A
/// failure puts the sync back and keeps the found version, so asking again works without a new
/// check.
#[cfg(desktop)]
#[tauri::command]
pub async fn update_install(app: AppHandle) -> AppResult<()> {
    if support_now() != UpdateSupport::Supported {
        return Err(invalid(MSG_UNSUPPORTED));
    }
    let state = app.state::<AppState>();
    // The version is taken, and a second call (or a check) finds the slot busy.
    let (_installing, update) = state.update_slot.begin_install()?;

    let _ = app.emit("update-progress", ProgressEvent::phase(Phase::WaitingSync));
    let prep = AppPrep(app.clone());
    if let Err(e) = prepare(&prep, SYNC_WAIT).await {
        state.update_slot.keep(update);
        return Err(e);
    }

    let mut gate = ProgressGate::default();
    let events = app.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                if let Some(received) = gate.add(chunk, Instant::now()) {
                    let _ = events.emit(
                        "update-progress",
                        ProgressEvent {
                            phase: Phase::Downloading,
                            received: Some(received),
                            total,
                        },
                    );
                }
            },
            || {},
        )
        .await;
    let bytes = match bytes {
        Ok(b) => b,
        Err(e) => {
            undo(&prep).await;
            state.update_slot.keep(update);
            return Err(install_error(&e));
        }
    };

    // After the download, so edits made while it ran are written too.
    if let Err(e) = flush_before_install(&prep).await {
        state.update_slot.keep(update);
        return Err(e);
    }

    let _ = app.emit("update-progress", ProgressEvent::phase(Phase::Installing));
    let installing = update.clone();
    // On Windows a successful install ends the process inside this call.
    let installed = tauri::async_runtime::spawn_blocking(move || installing.install(bytes)).await;
    match installed {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            undo(&prep).await;
            state.update_slot.keep(update);
            return Err(install_error(&e));
        }
        Err(e) => {
            undo(&prep).await;
            state.update_slot.keep(update);
            return Err(AppError::Io {
                message: format!("内部エラー: {e}"),
            });
        }
    }

    // Off the async worker: from a thread that is not the main one, `restart` asks the event
    // loop to exit and then never returns. A clone, so the slot stays marked as installing.
    let restarting = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        restarting.restart();
    })
    .await;
    Ok(())
}

/// No updater plugin on mobile (the stores update the app).
#[cfg(not(desktop))]
#[tauri::command]
pub async fn update_check() -> AppResult<UpdateCheckDto> {
    Ok(UpdateCheckDto::default())
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn update_install() -> AppResult<()> {
    Err(invalid(MSG_UNSUPPORTED))
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::store::paths::AppSettings;

    #[test]
    fn support_depends_on_the_build_and_the_appimage() {
        assert_eq!(support(true, false, None), UpdateSupport::Dev);
        assert_eq!(support(false, true, None), UpdateSupport::Manual);
        assert_eq!(
            support(false, true, Some(OsStr::new("/home/u/PowerToDo.AppImage"))),
            UpdateSupport::Supported
        );
        assert_eq!(support(false, false, None), UpdateSupport::Supported);
        // A debug build never checks, AppImage or not.
        assert_eq!(
            support(true, true, Some(OsStr::new("/x.AppImage"))),
            UpdateSupport::Dev
        );
    }

    #[test]
    fn auto_check_defaults_to_on_and_round_trips() {
        let old: AppSettings = serde_json::from_str("{}").unwrap();
        assert!(old.updates.auto_check);
        // An `updates` object without the key is on as well.
        let partial: AppSettings = serde_json::from_str(r#"{"updates":{}}"#).unwrap();
        assert!(partial.updates.auto_check);
        // The default is not written.
        assert!(!serde_json::to_string(&old).unwrap().contains("updates"));

        let mut s = old.clone();
        s.updates.auto_check = false;
        let text = serde_json::to_string(&s).unwrap();
        assert!(text.contains("\"autoCheck\":false"), "{text}");
        let back: AppSettings = serde_json::from_str(&text).unwrap();
        assert!(!back.updates.auto_check);
    }

    #[test]
    fn the_dtos_use_the_names_the_page_reads() {
        let v = serde_json::to_value(UpdateStatusDto {
            current_version: "0.1.0".into(),
            support: UpdateSupport::Manual,
            auto_check: true,
        })
        .unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "currentVersion": "0.1.0", "support": "manual", "autoCheck": true })
        );
        let v = serde_json::to_value(UpdateCheckDto::default()).unwrap();
        assert_eq!(v, serde_json::json!({ "available": false }));
    }

    #[test]
    fn setting_auto_check_is_written_and_keeps_the_rest() {
        let app = tempfile::tempdir().unwrap();
        let state = AppState::new(app.path().to_path_buf());
        AppSettings {
            data_dir: Some(app.path().join("data")),
            ..AppSettings::default()
        }
        .save(app.path())
        .unwrap();
        *state.lock_settings() = AppSettings::load(app.path()).unwrap();

        let u = update_update_settings(&state, |u| u.auto_check = false).unwrap();
        assert!(!u.auto_check);
        let on_disk = AppSettings::load(app.path()).unwrap();
        assert!(!on_disk.updates.auto_check);
        assert_eq!(on_disk.data_dir, Some(app.path().join("data")));
        assert!(!state.lock_settings().updates.auto_check);

        // Back to the default: the key leaves the file.
        update_update_settings(&state, |u| u.auto_check = true).unwrap();
        let text = std::fs::read_to_string(app.path().join(AppSettings::FILE)).unwrap();
        assert!(!text.contains("updates"), "{text}");
        assert!(state.lock_settings().updates.auto_check);
    }

    #[test]
    fn a_failed_write_leaves_the_setting_as_it_was() {
        let tmp = tempfile::tempdir().unwrap();
        // The app data dir is a file: the write cannot succeed.
        let blocker = tmp.path().join("file");
        std::fs::write(&blocker, "x").unwrap();
        let state = AppState::new(blocker);
        assert!(update_update_settings(&state, |u| u.auto_check = false).is_err());
        assert!(state.lock_settings().updates.auto_check);
    }

    /// The updater plugin in a mock app against a local server, with the test-only key in
    /// `tests/fixtures/updater` (see its README).
    #[cfg(desktop)]
    mod served {
        use super::super::*;
        use serde_json::json;
        use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        const PUBKEY: &str = include_str!("../../tests/fixtures/updater/test-only.key.pub");
        const APP: &[u8] = include_bytes!("../../tests/fixtures/updater/app.tar.gz");
        const APP_SIG: &str = include_str!("../../tests/fixtures/updater/app.tar.gz.sig");
        /// The same package signed without a version (older CLI releases did).
        const APP_SIG_NO_VERSION: &str =
            include_str!("../../tests/fixtures/updater/app.tar.gz.noversion.sig");
        /// `APP_SIG` and `OTHER_SIG` are bound to this version.
        const SIGNED_VERSION: &str = "9.9.9";
        /// The signature of a different file, made with the same key.
        const OTHER_SIG: &str = include_str!("../../tests/fixtures/updater/other.bin.sig");

        fn app() -> tauri::App<MockRuntime> {
            let mut context = mock_context(noop_assets());
            context.config_mut().plugins.0.insert(
                "updater".into(),
                json!({
                    "pubkey": PUBKEY.trim(),
                    "endpoints": ["https://example.invalid/latest.json"],
                    // As in tauri.conf.json.
                    "requireSignedVersion": true,
                }),
            );
            mock_builder()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .build(context)
                .unwrap()
        }

        fn updater(
            app: &tauri::App<MockRuntime>,
            server_uri: &str,
        ) -> tauri_plugin_updater::Updater {
            app.handle()
                .updater_builder()
                .endpoints(vec![format!("{server_uri}/latest.json").parse().unwrap()])
                .unwrap()
                .no_proxy()
                .build()
                .unwrap()
        }

        /// Serves `latest.json` (announcing `SIGNED_VERSION`, signed with `signature`) and
        /// `app.tar.gz`.
        async fn serve(signature: &str, package: ResponseTemplate) -> MockServer {
            serve_version(SIGNED_VERSION, signature, package).await
        }

        async fn serve_version(
            version: &str,
            signature: &str,
            package: ResponseTemplate,
        ) -> MockServer {
            let server = MockServer::start().await;
            let manifest = json!({
                "version": version,
                "notes": "テスト",
                "url": format!("{}/app.tar.gz", server.uri()),
                "signature": signature.trim(),
            });
            Mock::given(method("GET"))
                .and(path("/latest.json"))
                .respond_with(ResponseTemplate::new(200).set_body_json(manifest))
                .mount(&server)
                .await;
            Mock::given(method("GET"))
                .and(path("/app.tar.gz"))
                .respond_with(package)
                .mount(&server)
                .await;
            server
        }

        #[tokio::test]
        async fn a_signed_package_downloads_and_the_found_version_is_reported() {
            let server = serve(APP_SIG, ResponseTemplate::new(200).set_body_bytes(APP)).await;
            let app = app();
            let update = updater(&app, &server.uri())
                .check()
                .await
                .unwrap()
                .expect("9.9.9 is newer than the mock app's 0.1.0");
            assert_eq!(update.version, SIGNED_VERSION);
            assert_eq!(update.body.as_deref(), Some("テスト"));
            let bytes = update.download(|_, _| {}, || {}).await.unwrap();
            assert_eq!(bytes, APP);
        }

        #[tokio::test]
        async fn a_bad_signature_is_invalid() {
            let server = serve(OTHER_SIG, ResponseTemplate::new(200).set_body_bytes(APP)).await;
            let app = app();
            let update = updater(&app, &server.uri()).check().await.unwrap().unwrap();
            let err = update.download(|_, _| {}, || {}).await.unwrap_err();
            assert!(
                matches!(err, tauri_plugin_updater::Error::Minisign(_)),
                "{err:?}"
            );
            let mapped = install_error(&err);
            assert!(matches!(mapped, AppError::Invalid { .. }));
            assert_eq!(mapped.to_string(), "更新ファイルを確かめられませんでした");
        }

        #[tokio::test]
        async fn a_signature_for_another_version_is_invalid() {
            // A tampered manifest pairs a newer number with an older release's package.
            let server = serve_version(
                "9.9.10",
                APP_SIG,
                ResponseTemplate::new(200).set_body_bytes(APP),
            )
            .await;
            let app = app();
            let update = updater(&app, &server.uri()).check().await.unwrap().unwrap();
            let err = update.download(|_, _| {}, || {}).await.unwrap_err();
            assert!(
                matches!(
                    err,
                    tauri_plugin_updater::Error::SignedVersionMismatch { .. }
                ),
                "{err:?}"
            );
            assert_eq!(install_error(&err).to_string(), MSG_INVALID);
        }

        #[tokio::test]
        async fn a_signature_without_a_version_is_invalid() {
            let server = serve(
                APP_SIG_NO_VERSION,
                ResponseTemplate::new(200).set_body_bytes(APP),
            )
            .await;
            let app = app();
            let update = updater(&app, &server.uri()).check().await.unwrap().unwrap();
            let err = update.download(|_, _| {}, || {}).await.unwrap_err();
            assert!(
                matches!(err, tauri_plugin_updater::Error::MissingSignedVersion),
                "{err:?}"
            );
            assert_eq!(install_error(&err).to_string(), MSG_INVALID);
        }

        #[tokio::test]
        async fn a_package_changed_on_the_way_is_invalid() {
            let server = serve(
                APP_SIG,
                ResponseTemplate::new(200).set_body_bytes(&b"not what was signed"[..]),
            )
            .await;
            let app = app();
            let update = updater(&app, &server.uri()).check().await.unwrap().unwrap();
            let err = update.download(|_, _| {}, || {}).await.unwrap_err();
            assert_eq!(install_error(&err).to_string(), MSG_INVALID);
        }

        #[tokio::test]
        async fn a_missing_package_is_a_failed_download() {
            let server = serve(APP_SIG, ResponseTemplate::new(404)).await;
            let app = app();
            let update = updater(&app, &server.uri()).check().await.unwrap().unwrap();
            let err = update.download(|_, _| {}, || {}).await.unwrap_err();
            assert_eq!(
                install_error(&err).to_string(),
                "更新のダウンロードに失敗しました。データはそのままです"
            );
        }

        #[tokio::test]
        async fn an_unreachable_server_is_offline() {
            // A port nobody listens on (a dropped `MockServer` can go back to a pool and keep
            // answering 404, so it is not unreachable).
            let port = std::net::TcpListener::bind("127.0.0.1:0")
                .unwrap()
                .local_addr()
                .unwrap()
                .port();
            let app = app();
            let err = updater(&app, &format!("http://127.0.0.1:{port}"))
                .check()
                .await
                .err()
                .expect("no server");
            assert_eq!(
                check_error(&err).to_string(),
                "更新を確かめられませんでした (ネットワークを確かめてください)"
            );
        }

        #[tokio::test]
        async fn a_server_without_latest_json_says_the_guide_is_not_there_yet() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/latest.json"))
                .respond_with(ResponseTemplate::new(404))
                .mount(&server)
                .await;
            let app = app();
            let err = updater(&app, &server.uri())
                .check()
                .await
                .err()
                .expect("404");
            assert_eq!(
                check_error(&err).to_string(),
                "更新の案内がまだありません。しばらくしてからもう一度お試しください"
            );
        }

        #[tokio::test]
        async fn no_newer_version_is_not_an_error() {
            let server = MockServer::start().await;
            Mock::given(method("GET"))
                .and(path("/latest.json"))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                    "version": "0.1.0",
                    "url": format!("{}/app.tar.gz", server.uri()),
                    "signature": APP_SIG.trim(),
                })))
                .mount(&server)
                .await;
            let app = app();
            assert!(
                updater(&app, &server.uri())
                    .check()
                    .await
                    .unwrap()
                    .is_none()
            );
        }
    }

    #[cfg(desktop)]
    mod desktop {
        use super::super::*;
        use std::sync::Mutex;
        use tauri_plugin_updater::Error as E;

        // ---- the order around the download ----

        struct FakePrep {
            calls: Mutex<Vec<&'static str>>,
            busy: bool,
            held: Vec<String>,
            unsaved: bool,
        }

        impl FakePrep {
            fn new(busy: bool, held: &[&str]) -> Self {
                FakePrep {
                    calls: Mutex::new(Vec::new()),
                    busy,
                    held: held.iter().map(|s| s.to_string()).collect(),
                    unsaved: false,
                }
            }
            fn idle() -> Self {
                Self::new(false, &[])
            }
            fn with_unsaved(mut self) -> Self {
                self.unsaved = true;
                self
            }
            fn busy_forever() -> Self {
                Self::new(true, &[])
            }
            fn idle_with_held(held: &[&str]) -> Self {
                Self::new(false, held)
            }
            fn note(&self, call: &'static str) {
                self.calls.lock().unwrap().push(call);
            }
            fn calls(&self) -> Vec<&'static str> {
                self.calls.lock().unwrap().clone()
            }
        }

        impl Prep for FakePrep {
            fn pause(&self) {
                self.note("pause");
            }
            async fn wait_idle(&self, timeout: Duration) -> bool {
                self.note("wait_idle");
                if self.busy {
                    tokio::time::sleep(timeout).await;
                    false
                } else {
                    true
                }
            }
            fn held(&self) -> Vec<String> {
                self.note("held");
                self.held.clone()
            }
            async fn stop_sidecar(&self) {
                self.note("stop_sidecar");
            }
            fn resume(&self) {
                self.note("resume");
            }
            async fn restart_sidecar(&self) {
                self.note("restart_sidecar");
            }
            async fn flush(&self) -> bool {
                self.note("flush");
                !self.unsaved
            }
        }

        #[tokio::test(start_paused = true)]
        async fn a_long_sync_aborts_the_update_and_resumes() {
            let prep = FakePrep::busy_forever();
            let err = prepare(&prep, Duration::from_secs(60)).await.unwrap_err();
            assert!(err.to_string().contains("同期が終わらない"));
            assert!(matches!(err, AppError::Invalid { .. }));
            assert_eq!(prep.calls(), ["pause", "wait_idle", "resume"]);
        }

        #[tokio::test]
        async fn a_held_project_blocks_the_update() {
            let prep = FakePrep::idle_with_held(&["仕事"]);
            let err = prepare(&prep, Duration::from_secs(60)).await.unwrap_err();
            assert!(err.to_string().contains("確認が残っています"));
            assert_eq!(prep.calls(), ["pause", "wait_idle", "held", "resume"]);
        }

        #[tokio::test]
        async fn a_ready_app_stops_the_sidecar_last() {
            let prep = FakePrep::idle();
            prepare(&prep, Duration::from_secs(60)).await.unwrap();
            assert_eq!(prep.calls(), ["pause", "wait_idle", "held", "stop_sidecar"]);
        }

        #[tokio::test]
        async fn a_failed_install_restores_sync_and_sidecar() {
            let prep = FakePrep::idle();
            undo(&prep).await;
            assert_eq!(prep.calls(), ["resume", "restart_sidecar"]);
        }

        // ---- the messages ----

        #[test]
        fn every_message_the_page_shows_is_the_agreed_text() {
            assert_eq!(
                MSG_OFFLINE,
                "更新を確かめられませんでした (ネットワークを確かめてください)"
            );
            assert_eq!(MSG_INVALID, "更新ファイルを確かめられませんでした");
            assert_eq!(
                MSG_BUSY,
                "同期が終わらないため、更新を中止しました。しばらくしてからもう一度お試しください"
            );
            assert_eq!(
                MSG_HELD,
                "Excel などで直した変更の確認が残っています。確認してからもう一度お試しください"
            );
            assert_eq!(
                MSG_DOWNLOAD,
                "更新のダウンロードに失敗しました。データはそのままです"
            );
        }

        #[tokio::test]
        async fn the_edits_are_flushed_after_the_download_and_before_the_install() {
            // `update_install` runs prepare, the download, then this, then `install`.
            let prep = FakePrep::idle();
            prepare(&prep, Duration::from_secs(60)).await.unwrap();
            flush_before_install(&prep).await.unwrap();
            assert_eq!(
                prep.calls(),
                ["pause", "wait_idle", "held", "stop_sidecar", "flush"]
            );
        }

        #[tokio::test]
        async fn edits_that_cannot_be_saved_give_the_update_up_and_undo_it() {
            let prep = FakePrep::idle().with_unsaved();
            prepare(&prep, Duration::from_secs(60)).await.unwrap();
            let err = flush_before_install(&prep).await.unwrap_err();
            assert!(matches!(err, AppError::Invalid { .. }));
            assert_eq!(
                err.to_string(),
                "保存できていない変更があるため、更新を中止しました。保存を確かめてからもう一度お試しください"
            );
            assert_eq!(
                prep.calls(),
                [
                    "pause",
                    "wait_idle",
                    "held",
                    "stop_sidecar",
                    "flush",
                    "resume",
                    "restart_sidecar"
                ]
            );
        }

        #[test]
        fn the_slot_hands_out_the_version_once_and_refuses_a_second_install() {
            let slot = UpdateSlot::<u32>::default();
            // Nothing found yet: refused, and not stuck as installing.
            let err = slot.begin_install().err().expect("nothing found");
            assert_eq!(err.to_string(), MSG_NOT_CHECKED);
            assert!(!slot.is_installing());

            slot.offer(Some(7));
            let (guard, found) = slot.begin_install().unwrap();
            assert_eq!(found, 7);
            assert!(slot.is_installing());
            // A second install is refused, whether or not a version is waiting.
            slot.keep(8);
            let err = slot.begin_install().err().expect("one at a time");
            assert_eq!(err.to_string(), "更新の途中です");
            assert!(matches!(err, AppError::Invalid { .. }));
            // The refused call did not end the first install.
            assert!(slot.is_installing());

            drop(guard);
            assert!(!slot.is_installing());
        }

        #[test]
        fn a_check_that_ends_during_an_install_does_not_bring_the_version_back() {
            let slot = UpdateSlot::<u32>::default();
            slot.offer(Some(1));
            let (guard, found) = slot.begin_install().unwrap();
            assert_eq!(found, 1);
            slot.offer(Some(2));
            slot.offer(None);
            drop(guard);
            assert!(slot.begin_install().is_err(), "nothing was stored");

            // After the install a check stores again, and a failed install can give it back.
            slot.offer(Some(3));
            let (guard, found) = slot.begin_install().unwrap();
            slot.keep(found);
            drop(guard);
            assert_eq!(slot.begin_install().unwrap().1, 3);
        }

        #[test]
        fn the_progress_events_use_the_names_the_page_reads() {
            let v = serde_json::to_value(ProgressEvent {
                phase: Phase::WaitingSync,
                received: None,
                total: None,
            })
            .unwrap();
            assert_eq!(v, serde_json::json!({ "phase": "waitingSync" }));
            let v = serde_json::to_value(ProgressEvent {
                phase: Phase::Downloading,
                received: Some(10),
                total: Some(20),
            })
            .unwrap();
            assert_eq!(
                v,
                serde_json::json!({ "phase": "downloading", "received": 10, "total": 20 })
            );
            assert_eq!(
                serde_json::to_value(ProgressEvent {
                    phase: Phase::Installing,
                    received: None,
                    total: None
                })
                .unwrap()["phase"],
                "installing"
            );
        }

        #[test]
        fn the_progress_gate_lets_an_event_through_every_250_ms() {
            let t0 = Instant::now();
            let mut g = ProgressGate::default();
            // The first chunk reports at once.
            assert_eq!(g.add(100, t0), Some(100));
            assert_eq!(g.add(100, t0 + Duration::from_millis(100)), None);
            assert_eq!(g.add(100, t0 + Duration::from_millis(249)), None);
            // The count includes what was held back.
            assert_eq!(g.add(50, t0 + Duration::from_millis(250)), Some(350));
            assert_eq!(g.add(1, t0 + Duration::from_millis(300)), None);
        }

        #[test]
        fn errors_of_the_check_are_offline_or_invalid() {
            for e in [E::Network("x".into()), E::EmptyEndpoints] {
                assert_eq!(check_error(&e).to_string(), MSG_OFFLINE, "{e:?}");
            }
            for e in [
                E::SignatureUtf8("x".into()),
                E::TargetsNotFound(vec!["darwin-aarch64".into()]),
                E::MissingSignedVersion,
            ] {
                assert_eq!(check_error(&e).to_string(), MSG_INVALID, "{e:?}");
            }
        }

        #[test]
        fn a_missing_manifest_gets_its_own_message() {
            let err = check_error(&E::ReleaseNotFound);
            assert_eq!(err.to_string(), MSG_NO_MANIFEST);
            assert_eq!(
                MSG_NO_MANIFEST,
                "更新の案内がまだありません。しばらくしてからもう一度お試しください"
            );
        }

        #[test]
        fn errors_of_the_install_are_download_or_invalid() {
            assert_eq!(
                install_error(&E::Network("x".into())).to_string(),
                MSG_DOWNLOAD
            );
            assert_eq!(install_error(&E::TempDirNotFound).to_string(), MSG_DOWNLOAD);
            assert_eq!(
                install_error(&E::SignedVersionMismatch {
                    signed: "1".into(),
                    announced: "2".into()
                })
                .to_string(),
                MSG_INVALID
            );
            assert!(matches!(
                install_error(&E::ReleaseNotFound),
                AppError::Invalid { .. }
            ));
        }
    }
}
