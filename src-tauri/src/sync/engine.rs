//! Running a sync (spec sections 3.3 to 3.5). [`SyncEngine::run_once`] lists both sides, asks
//! [`plan`] what to do and does it; everything that touches the data folder goes through the
//! store, so the app's own view and its external-change detection stay right.
//! [`SyncEngine::run_loop`] decides when: at start, every 5 minutes, 5 seconds after a save and
//! whenever [`SyncEngine::request`] is called.
//!
//! Locks (see the lock order in `commands`): the store lock is taken briefly to collect the files
//! to leave alone, and around each local write with the reload that follows. It is never held
//! across network I/O. The engine's own lock (`Inner`, the `sync_state` of the lock order) is a
//! leaf: nothing else is taken while it is held. `sync.json` is written under it, so a target
//! switch (`set_backend`, `reset_records`) cannot interleave with a run's save.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use chrono::{DateTime, Local, NaiveDateTime};
use serde::Serialize;
use tokio::sync::Notify;
use tokio::time::Instant;

use super::backend::{BackendError, RemoteFile, StorageBackend};
use super::state::{BackendKind, FileRecord, SyncState};
use super::{
    Action, LocalFile, PlanMode, Side, conflict_name, fold, is_sync_target, plan, sha256_hex,
};
use crate::error::AppError;
use crate::store::common_book::COMMON_FILE;
use crate::store::project_store::{ProjectStore, StagedDownload, file_key, stage_download};

/// Key of the common workbook in the store and the saver.
const COMMON_KEY: &str = "_common";

/// How often the engine syncs without being asked.
pub const INTERVAL: Duration = Duration::from_secs(5 * 60);
/// How long after a save its sync runs. More saves in that time join the same run.
pub const AFTER_SAVE_DELAY: Duration = Duration::from_secs(5);

/// Why a sync is asked for (spec section 3.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncReason {
    Startup,
    Interval,
    /// A workbook was written; the sync runs [`AFTER_SAVE_DELAY`] later.
    AfterSave,
    /// 「今すぐ同期」.
    SyncNow,
    /// The sync target or the data folder changed.
    Settings,
    /// The connection to the target came up (Tailscale reached running).
    Connected,
    /// An upload met a concurrent change on the remote; plan again at once.
    Retry,
}

impl SyncReason {
    fn delay(self) -> Duration {
        match self {
            SyncReason::AfterSave => AFTER_SAVE_DELAY,
            _ => Duration::ZERO,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncPhase {
    Off,
    Syncing,
    Synced,
    Offline,
    Error,
}

/// The `sync-status` event and `sync_status` (spec section 3.5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusView {
    pub state: SyncPhase,
    /// End of the last complete run, local time `YYYY-MM-DDTHH:MM:SS`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_synced: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Files the last run left for the next one: unsaved, held, being saved, unreadable, changed
    /// during the run, failed, or caught in a name clash.
    pub pending: u32,
    /// The side whose listing looked wiped. The sync stays stopped until the user picks
    /// [`SyncEngine::run_mirror`] with `MirrorRemote` (local wiped) or `MirrorLocal`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suspect: Option<Side>,
    /// The target refused the credentials (`BackendError::Auth`): no run happens until the
    /// settings change (a new login, 「確かめる」). Only this kind of error is fixed by logging
    /// in again, so the UI offers that only while it is set.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub auth_rejected: bool,
}

impl SyncStatusView {
    fn off() -> Self {
        SyncStatusView {
            state: SyncPhase::Off,
            last_synced: None,
            message: None,
            pending: 0,
            suspect: None,
            auth_rejected: false,
        }
    }
}

/// What the engine needs from the app. `commands` implements it on the `AppHandle`; tests use a
/// plain struct.
pub trait SyncHost: Send + Sync {
    fn lock_store(&self) -> MutexGuard<'_, Option<ProjectStore>>;
    /// Keys (project name or `"_common"`) whose write is in flight. Called with the store lock
    /// held (the `saving` lock is a leaf).
    fn saving_keys(&self) -> BTreeSet<String>;
    /// `sync-status`.
    fn status_changed(&self, status: &SyncStatusView);
    /// `sync-conflict { file, conflictFile }`.
    fn conflict(&self, file: &str, conflict_file: &str);
    /// Projects re-read from a downloaded file: `project-changed { reason: "sync" }`, and saves
    /// for whatever the reload left dirty.
    fn projects_reloaded(&self, names: &[String]);
    /// The project list or the common workbook changed: `projects-changed`, and saves for what
    /// became dirty.
    fn project_list_changed(&self, common_reloaded: bool);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RunOutcome {
    /// Nothing ran: no sync target, no data folder, or the target rejected the credentials
    /// earlier (`auth_rejected`).
    #[default]
    NotRun,
    /// Both sides were listed and the plan was carried out. Single files may have failed or
    /// waited (see the report).
    Done,
    /// A side looked wiped; nothing was done.
    Suspect(Side),
    /// The target could not be reached. Nothing more was done; the next run catches up.
    Offline,
    /// The target refused (credentials, space, permission, other) or the data folder could not
    /// be listed.
    Failed,
    /// The sync target or the data folder changed during the run; the rest is left for the next.
    Interrupted,
}

/// What one run did, by file name.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SyncReport {
    pub outcome: RunOutcome,
    pub uploaded: Vec<String>,
    pub downloaded: Vec<String>,
    /// Same content on both sides: only the record was written.
    pub recorded: Vec<String>,
    pub archived_local: Vec<String>,
    pub archived_remote: Vec<String>,
    /// `(file, conflict copy)`.
    pub conflicts: Vec<(String, String)>,
    /// Left alone from the start: unsaved, held, being saved or unreadable.
    pub skipped: Vec<String>,
    /// Changed (or got unsaved edits) while the run was going; tried again next time.
    pub deferred: Vec<String>,
    /// `(file, message for the user)`.
    pub failed: Vec<(String, String)>,
    /// `(file, app)`: deferred (also in `deferred`) because the app has the file open.
    pub open: Vec<(String, &'static str)>,
    /// Names that differ only in letter case or Unicode normalization.
    pub clashes: Vec<Vec<String>>,
    /// An upload met a concurrent change (`Precondition`): another run was requested.
    pub rerun: bool,
}

impl SyncReport {
    fn pending(&self) -> u32 {
        let n = self.skipped.len()
            + self.deferred.len()
            + self.failed.len()
            + self.clashes.iter().map(Vec::len).sum::<usize>();
        u32::try_from(n).unwrap_or(u32::MAX)
    }

    /// The text of an `error` status for per-file problems, `None` when there were none.
    fn problems(&self) -> Option<String> {
        let mut parts = Vec::new();
        if !self.clashes.is_empty() {
            let names: Vec<String> = self.clashes.iter().map(|c| c.join(" と ")).collect();
            parts.push(format!(
                "名前が大文字・小文字か見えない文字 (文字の符号化) の違いだけで重なっているため同期していません: {}。どちらかの名前を変えてください",
                names.join("、")
            ));
        }
        if let Some((_, message)) = self.failed.first() {
            let more = match self.failed.len() {
                1 => String::new(),
                n => format!(" (ほか {} 件)", n - 1),
            };
            parts.push(format!("{message}{more}"));
        }
        (!parts.is_empty()).then(|| parts.join(" / "))
    }

    /// What the status says, besides any problem, about files that wait for the user: open in
    /// an office app. Not an error.
    fn notice(&self) -> Option<String> {
        let (name, app) = self.open.first()?;
        let more = match self.open.len() {
            1 => String::new(),
            n => format!(" (ほか {} 件)", n - 1),
        };
        Some(format!(
            "「{name}」が {app} で開かれているため、閉じてから同期します{more}"
        ))
    }

    /// Every name this run left for the next one.
    fn left_over(&self) -> impl Iterator<Item = &String> {
        self.skipped
            .iter()
            .chain(&self.deferred)
            .chain(self.failed.iter().map(|(n, _)| n))
            .chain(self.clashes.iter().flatten())
    }
}

fn suspect_message(side: Side) -> String {
    match side {
        Side::Local => "この PC のデータフォルダが空に見えるため同期を止めました",
        Side::Remote => "同期先が空に見えるため同期を止めました",
    }
    .to_string()
}

/// What the status says once the target refused our credentials. The NAS has 「確かめる」; Google
/// Drive needs a new login (its refresh token is dead).
fn auth_failed_message(kind: BackendKind) -> &'static str {
    match kind {
        BackendKind::Nas => "同期先の認証に失敗しました。設定で接続を確かめるまで同期しません",
        BackendKind::Gdrive => "Google のログインが切れました。もう一度ログインしてください",
    }
}

fn stamp(t: NaiveDateTime) -> String {
    t.format("%Y-%m-%dT%H:%M:%S").to_string()
}

type Clock = Box<dyn Fn() -> NaiveDateTime + Send + Sync>;

#[derive(Clone)]
struct Target {
    backend: Arc<dyn StorageBackend>,
    kind: BackendKind,
    remote_root: String,
}

struct Inner {
    target: Option<Target>,
    /// Bumped by every target change and records reset. A run that started under another value
    /// saves nothing more and no longer changes the status.
    generation: u64,
    /// The target rejected the credentials: no run until `clear_auth_rejected` or a new target.
    auth_rejected: bool,
    /// When the next run is wanted (`request`).
    due: Option<Instant>,
    /// The wanted run was asked for by [`SyncReason::Retry`] alone (no other reason joined it).
    due_retry: bool,
    status: SyncStatusView,
    /// Where status changes made outside a run go (set by `run_loop`).
    host: Option<Arc<dyn SyncHost>>,
}

struct Shared {
    app_data_dir: PathBuf,
    clock: Clock,
    inner: Mutex<Inner>,
    /// Held for a whole run: one run at a time.
    running: tokio::sync::Mutex<()>,
    wake: Notify,
}

/// The sync engine. Cheap to clone (all clones are the same engine).
#[derive(Clone)]
pub struct SyncEngine {
    shared: Arc<Shared>,
}

/// Why a run stops before the end.
enum Stop {
    /// Offline or rejected credentials: the other files would fail the same way.
    Backend(BackendError),
    /// The target or the data folder changed under the run.
    Changed,
}

/// Why one file was not synced.
enum FileError {
    Backend(BackendError),
    /// The whole message for the user (names the file).
    Local(String),
    /// Busy or changed since the plan: the next run looks again.
    Deferred,
    /// Open in an office app (its lock file is there): replacing the file would be undone by
    /// the app's next save. The next run looks again.
    Open(&'static str),
    Changed,
}

impl From<BackendError> for FileError {
    fn from(e: BackendError) -> Self {
        FileError::Backend(e)
    }
}

/// 「「name」を同期できませんでした: …」.
fn failure_text(name: &str, e: impl std::fmt::Display) -> String {
    format!("「{name}」を同期できませんでした: {e}")
}

fn failure(name: &str, e: impl std::fmt::Display) -> FileError {
    FileError::Local(failure_text(name, e))
}

fn missing_remote(name: &str) -> FileError {
    FileError::Local(format!("同期先の「{name}」が見つかりません"))
}

/// Checks a download before it may replace anything (see [`stage_download`]).
fn stage(data_dir: &Path, name: &str, bytes: &[u8]) -> Result<StagedDownload, FileError> {
    stage_download(data_dir, name, bytes).map_err(|e| match e {
        AppError::Corrupt { .. } => {
            FileError::Local(format!("「{name}」を同期先から読み込めません"))
        }
        other => failure(name, other),
    })
}

impl SyncEngine {
    /// `sync.json` lives in `app_data_dir`. No target yet: the status is `off`.
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self::with_clock(app_data_dir, || Local::now().naive_local())
    }

    pub fn with_clock(
        app_data_dir: PathBuf,
        clock: impl Fn() -> NaiveDateTime + Send + Sync + 'static,
    ) -> Self {
        SyncEngine {
            shared: Arc::new(Shared {
                app_data_dir,
                clock: Box::new(clock),
                inner: Mutex::new(Inner {
                    target: None,
                    generation: 0,
                    auth_rejected: false,
                    due: None,
                    due_retry: false,
                    status: SyncStatusView::off(),
                    host: None,
                }),
                running: tokio::sync::Mutex::new(()),
                wake: Notify::new(),
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.shared.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn now(&self) -> NaiveDateTime {
        (self.shared.clock)()
    }

    /// Sets (or with `None` removes) the sync target. Clears `auth_rejected` (the settings
    /// changed) and asks for a run. `kind` and `remote_root` tie `sync.json` to the target: a
    /// different one starts from fresh records (`SyncState::load`). The status shows the last
    /// sync time saved for this target.
    pub fn set_backend(
        &self,
        backend: Option<Arc<dyn StorageBackend>>,
        kind: BackendKind,
        remote_root: &str,
    ) {
        let on = backend.is_some();
        let last = on
            .then(|| SyncState::peek_last_sync(&self.shared.app_data_dir, kind, remote_root))
            .flatten();
        {
            let mut inner = self.lock();
            inner.target = backend.map(|backend| Target {
                backend,
                kind,
                remote_root: remote_root.to_string(),
            });
            inner.generation += 1;
            inner.auth_rejected = false;
            inner.due = None;
            inner.due_retry = false;
        }
        self.publish(None, None, |s| {
            *s = SyncStatusView {
                state: if on {
                    SyncPhase::Syncing
                } else {
                    SyncPhase::Off
                },
                last_synced: last.map(stamp),
                ..SyncStatusView::off()
            };
        });
        if on {
            self.request(SyncReason::Settings);
        }
    }

    /// Forgets every record (`sync.json` is removed) and asks for a run, which treats both
    /// sides as new. For an explicit switch of the sync target. A run in progress saves nothing
    /// more.
    pub fn reset_records(&self) {
        let on = {
            let mut inner = self.lock();
            inner.generation += 1;
            let path = self.shared.app_data_dir.join(SyncState::FILE);
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => eprintln!("could not remove {}: {e}", path.display()),
            }
            inner.target.is_some()
        };
        if on {
            self.publish(None, None, |s| {
                *s = SyncStatusView {
                    state: SyncPhase::Syncing,
                    ..SyncStatusView::off()
                };
            });
            self.request(SyncReason::Settings);
        }
    }

    /// Lets runs happen again after the target rejected the credentials (「確かめる」 passed).
    pub fn clear_auth_rejected(&self) {
        self.lock().auth_rejected = false;
    }

    pub fn auth_rejected(&self) -> bool {
        self.lock().auth_rejected
    }

    pub fn status(&self) -> SyncStatusView {
        self.lock().status.clone()
    }

    /// Whether a sync target is set (also while it rejects the credentials).
    pub fn has_target(&self) -> bool {
        self.lock().target.is_some()
    }

    /// Shows `offline` with `message` while the target cannot be built, e.g. the NAS is chosen
    /// but the tailnet connection it needs is down. Keeps the last sync time and asks for no
    /// run: with a target the runs themselves report `offline`, without one there is nothing
    /// to run against. Does nothing when a target is set by now (decided under the engine's
    /// lock): a backend attached meanwhile owns the status.
    pub fn set_offline(&self, message: &str) {
        self.show_without_target(|s| {
            s.state = SyncPhase::Offline;
            s.message = Some(message.to_string());
        });
    }

    /// Shows that the target refuses the credentials while no backend is attached: the app
    /// does not build one for credentials it knows are refused (a NAS may lock the account
    /// after repeated failures). Like [`SyncEngine::set_offline`], nothing happens when a
    /// target is set by now.
    pub fn show_rejected(&self, kind: BackendKind) {
        self.show_without_target(|s| {
            s.state = SyncPhase::Error;
            s.message = Some(auth_failed_message(kind).to_string());
            s.auth_rejected = true;
        });
    }

    fn show_without_target(&self, f: impl FnOnce(&mut SyncStatusView)) {
        let (view, host) = {
            let mut inner = self.lock();
            if inner.target.is_some() {
                return;
            }
            inner.status.pending = 0;
            inner.status.suspect = None;
            inner.status.auth_rejected = false;
            f(&mut inner.status);
            (inner.status.clone(), inner.host.clone())
        };
        if let Some(h) = host {
            h.status_changed(&view);
        }
    }

    /// Asks for a run: now, or [`AFTER_SAVE_DELAY`] later after a save. Requests made before the
    /// run starts (also those made while another run is going) join into one run. Ignored
    /// (`false`) without a target or while the target rejects the credentials: retrying would
    /// only fail again, and a NAS may lock the account after repeated failures.
    pub fn request(&self, reason: SyncReason) -> bool {
        {
            let mut inner = self.lock();
            if inner.target.is_none() || inner.auth_rejected {
                return false;
            }
            let at = Instant::now() + reason.delay();
            inner.due_retry =
                reason == SyncReason::Retry && (inner.due.is_none() || inner.due_retry);
            inner.due = Some(inner.due.map_or(at, |d| d.min(at)));
        }
        self.shared.wake.notify_one();
        true
    }

    /// `Some` (and the request is used up) when a requested run is due at `now`; the value is
    /// `true` when that run is a retry after a precondition failure and nothing else.
    fn take_due_run(&self, now: Instant) -> Option<bool> {
        let mut inner = self.lock();
        match inner.due {
            Some(d) if d <= now => {
                inner.due = None;
                Some(std::mem::take(&mut inner.due_retry))
            }
            _ => None,
        }
    }

    #[cfg(test)]
    fn take_due(&self, now: Instant) -> bool {
        self.take_due_run(now).is_some()
    }

    fn next_due(&self) -> Option<Instant> {
        self.lock().due
    }

    /// The engine task: a run at start, then whenever one is due ([`SyncEngine::request`]) or
    /// every [`INTERVAL`]. Never returns; spawn it once on `tauri::async_runtime`.
    pub async fn run_loop(self, host: Arc<dyn SyncHost>) {
        self.lock().host = Some(Arc::clone(&host));
        self.request(SyncReason::Startup);
        let mut next_interval = Instant::now() + INTERVAL;
        loop {
            let now = Instant::now();
            if now >= next_interval {
                self.request(SyncReason::Interval);
                next_interval = now + INTERVAL;
            }
            if let Some(is_retry) = self.take_due_run(now) {
                self.run(host.as_ref(), PlanMode::Normal, is_retry, None)
                    .await;
                continue;
            }
            let until = self
                .next_due()
                .map_or(next_interval, |d| d.min(next_interval));
            let _ = tokio::time::timeout_at(until, self.shared.wake.notified()).await;
        }
    }

    /// One normal sync (spec section 3.4). Waits for a run in progress to end first.
    pub async fn run_once(&self, host: &dyn SyncHost) -> SyncReport {
        self.run(host, PlanMode::Normal, false, None).await
    }

    /// The one-shot recovery after a [`Side`] looked wiped (the UI asks the user first):
    /// `MirrorRemote` makes this folder equal to the target, `MirrorLocal` the other way. A
    /// file whose content would be replaced is kept first (the local one in `archive/` as
    /// `<name> (同期前 …).xlsx`, the remote one in the target's `archive/`). The records are
    /// rebuilt from what the mirror copied (names it skipped or failed keep theirs), so the
    /// next normal run starts clean.
    pub async fn run_mirror(&self, host: &dyn SyncHost, mode: PlanMode) -> SyncReport {
        self.run(host, mode, false, None).await
    }

    /// Whether a target is set, the status and the target's generation, read together. The
    /// generation changes with every target change and records reset.
    pub fn snapshot(&self) -> (bool, SyncStatusView, u64) {
        let inner = self.lock();
        (
            inner.target.is_some(),
            inner.status.clone(),
            inner.generation,
        )
    }

    /// [`SyncEngine::run_mirror`] for a user who confirmed it on the screen of `snapshot`
    /// (`generation`): when the target or the records changed since, or the sync is no longer
    /// stopped on a wiped side, nothing runs (`NotRun`, no status change). Decided under the
    /// run lock, right before the run starts.
    pub async fn run_mirror_confirmed(
        &self,
        host: &dyn SyncHost,
        mode: PlanMode,
        generation: u64,
    ) -> SyncReport {
        self.run(host, mode, false, Some(generation)).await
    }

    /// Updates the status and sends it to `host`, or to the loop's host when there is none.
    /// With `generation`, only while the target is still that one (a run of an old target must
    /// not overwrite the new target's status).
    fn publish(
        &self,
        host: Option<&dyn SyncHost>,
        generation: Option<u64>,
        f: impl FnOnce(&mut SyncStatusView),
    ) {
        let (view, stored) = {
            let mut inner = self.lock();
            if generation.is_some_and(|g| g != inner.generation) {
                return;
            }
            f(&mut inner.status);
            (inner.status.clone(), inner.host.clone())
        };
        match (host, stored) {
            (Some(h), _) => h.status_changed(&view),
            (None, Some(h)) => h.status_changed(&view),
            (None, None) => {}
        }
    }

    /// Writes `sync.json` unless the target changed since the run started (`false` then).
    fn save_state(&self, generation: u64, state: &SyncState) -> bool {
        let inner = self.lock();
        if inner.generation != generation {
            return false;
        }
        if let Err(e) = state.save(&self.shared.app_data_dir) {
            // The records stay in memory for this run; the next one may redo some work.
            eprintln!("could not write {}: {e}", SyncState::FILE);
        }
        true
    }

    /// Reports a failure of the target that ends the run.
    fn backend_failed(
        &self,
        host: &dyn SyncHost,
        generation: u64,
        kind: BackendKind,
        e: &BackendError,
    ) -> RunOutcome {
        let g = Some(generation);
        match e {
            BackendError::Offline(_) => {
                self.publish(Some(host), g, |s| {
                    s.state = SyncPhase::Offline;
                    s.message = Some(e.to_string());
                });
                RunOutcome::Offline
            }
            BackendError::Auth => {
                {
                    let mut inner = self.lock();
                    if inner.generation == generation {
                        inner.auth_rejected = true;
                    }
                }
                self.publish(Some(host), g, |s| {
                    s.state = SyncPhase::Error;
                    s.auth_rejected = true;
                    s.message = Some(auth_failed_message(kind).into());
                });
                RunOutcome::Failed
            }
            _ => {
                self.publish(Some(host), g, |s| {
                    s.state = SyncPhase::Error;
                    s.message = Some(e.to_string());
                });
                RunOutcome::Failed
            }
        }
    }

    /// `is_retry`: this run was asked for by a precondition failure alone. It does not ask for
    /// another retry, so a remote that keeps failing the precondition is retried once and then
    /// left to the normal schedule.
    async fn run(
        &self,
        host: &dyn SyncHost,
        mode: PlanMode,
        is_retry: bool,
        confirmed: Option<u64>,
    ) -> SyncReport {
        let _one_at_a_time = self.shared.running.lock().await;
        let mut report = SyncReport::default();
        let snapshot = {
            let inner = self.lock();
            // A mirror the user confirmed against an older situation must not run.
            if confirmed.is_some_and(|g| g != inner.generation || inner.status.suspect.is_none()) {
                return report;
            }
            (inner.target.clone(), inner.generation, inner.auth_rejected)
        };
        let (target, generation) = match snapshot {
            (None, g, _) => {
                self.publish(Some(host), Some(g), |s| *s = SyncStatusView::off());
                return report;
            }
            // The status still says why.
            (Some(_), _, true) => return report,
            (Some(t), g, false) => (t, g),
        };
        let g = Some(generation);

        // (1) What not to touch, under a short store lock.
        let opened = {
            let guard = host.lock_store();
            guard.as_ref().map(|store| {
                (
                    store.paths().data_dir.clone(),
                    busy_files(store, &host.saving_keys()),
                )
            })
        };
        let Some((data_dir, mut skip)) = opened else {
            self.publish(Some(host), g, |s| {
                *s = SyncStatusView {
                    message: Some("データフォルダが開かれていません".into()),
                    ..SyncStatusView::off()
                };
            });
            return report;
        };
        self.publish(Some(host), g, |s| {
            s.state = SyncPhase::Syncing;
            s.message = None;
            s.suspect = None;
            s.auth_rejected = false;
        });

        // (2) The local listing, without the lock.
        let local = match list_local(&data_dir, &mut skip) {
            Ok(files) => files,
            Err(e) => {
                report.outcome = RunOutcome::Failed;
                self.publish(Some(host), g, |s| {
                    s.state = SyncPhase::Error;
                    s.message = Some(format!("データフォルダを読めません: {e}"));
                });
                return report;
            }
        };

        // (3) The remote listing.
        let remote = match target.backend.list().await {
            Ok(files) => files,
            Err(e) => {
                report.outcome = self.backend_failed(host, generation, target.kind, &e);
                return report;
            }
        };

        // (4) The plan.
        let mut state = SyncState::load(
            &self.shared.app_data_dir,
            &data_dir,
            target.kind,
            &target.remote_root,
        );
        let new_root = adopt_root(&mut state, target.backend.root_identity());
        let dropped =
            mode == PlanMode::Normal && drop_gone_records(&mut state, &local, &remote, &skip);
        if (new_root || dropped) && !self.save_state(generation, &state) {
            report.outcome = RunOutcome::Interrupted;
            return report;
        }
        let mut actions = plan(&local, &remote, &state, &skip, mode);
        if let Some(side) = actions.iter().find_map(|a| match a {
            Action::Suspect { side } => Some(*side),
            _ => None,
        }) {
            report.outcome = RunOutcome::Suspect(side);
            self.publish(Some(host), g, |s| {
                s.state = SyncPhase::Error;
                s.message = Some(suspect_message(side));
                s.pending = 0;
                s.suspect = Some(side);
            });
            return report;
        }
        // The common workbook first: it lists the projects, so a project that came with it is
        // already listed when its file arrives (no adopting with a default color, which would
        // dirty the common workbook and hold back its download).
        actions.sort_by_key(|a| action_file(a) != Some(COMMON_FILE));

        report.skipped = skip.iter().filter(|n| is_sync_target(n)).cloned().collect();
        let records = state.files.clone();
        let mut run = Run {
            engine: self,
            host,
            backend: target.backend,
            data_dir,
            generation,
            mode,
            is_retry,
            local: local.into_iter().map(|f| (f.name.clone(), f)).collect(),
            remote,
            records,
            state,
            report,
            taken: BTreeSet::new(),
            done: BTreeSet::new(),
        };

        // (5), (6) Each action, saving the records after each file.
        let stop = run.execute(actions).await;
        let Run {
            mut state,
            mut report,
            done,
            ..
        } = run;
        match stop {
            Ok(()) => {}
            Err(Stop::Backend(e)) => {
                report.outcome = self.backend_failed(host, generation, target.kind, &e);
                return report;
            }
            Err(Stop::Changed) => {
                // The new target / folder publishes its own status.
                report.outcome = RunOutcome::Interrupted;
                return report;
            }
        }

        // (7) Done.
        if mode != PlanMode::Normal {
            // Records are rebuilt from what the mirror copied; names it left for later keep
            // theirs, the rest (stale, archived, junk) go.
            let keep: BTreeSet<String> = done
                .iter()
                .chain(report.left_over())
                .map(|n| fold(n))
                .collect();
            state.files.retain(|name, _| keep.contains(&fold(name)));
        }
        let now = self.now();
        state.last_sync = Some(now);
        if !self.save_state(generation, &state) {
            report.outcome = RunOutcome::Interrupted;
            return report;
        }
        report.outcome = RunOutcome::Done;
        let problems = report.problems();
        let failed = problems.is_some();
        let message = match (problems, report.notice()) {
            (Some(p), Some(n)) => Some(format!("{p} / {n}")),
            (p, n) => p.or(n),
        };
        let pending = report.pending();
        self.publish(Some(host), g, |s| {
            s.state = if failed {
                SyncPhase::Error
            } else {
                SyncPhase::Synced
            };
            s.last_synced = Some(stamp(now));
            s.message = message;
            s.pending = pending;
            s.suspect = None;
        });
        if report.rerun {
            self.request(SyncReason::Retry);
        }
        report
    }
}

/// The file an action is about (`None` for a clash or a suspect side).
fn action_file(a: &Action) -> Option<&str> {
    match a {
        Action::Upload(n)
        | Action::Download(n)
        | Action::ArchiveRemote(n)
        | Action::ArchiveLocal(n)
        | Action::Record(n)
        | Action::Conflict { name: n, .. } => Some(n),
        Action::NameClash { .. } | Action::Suspect { .. } => None,
    }
}

fn file_name_of(key: &str) -> String {
    if key == COMMON_KEY {
        COMMON_FILE.to_string()
    } else {
        format!("{key}.xlsx")
    }
}

/// File names with unsaved, held or in-flight edits: the sync leaves them alone this round.
fn busy_files(store: &ProjectStore, saving: &BTreeSet<String>) -> BTreeSet<String> {
    let mut keys: BTreeSet<String> = store.dirty_projects().into_iter().collect();
    keys.extend(store.held_projects());
    keys.extend(saving.iter().cloned());
    if store.common_dirty() {
        keys.insert(COMMON_KEY.to_string());
    }
    keys.iter().map(|k| file_name_of(k)).collect()
}

fn is_busy(store: &ProjectStore, saving: &BTreeSet<String>, key: &str) -> bool {
    let dirty = if key == COMMON_KEY {
        store.common_dirty()
    } else {
        store.dirty_projects().iter().any(|p| p == key)
    };
    dirty || store.is_held(key) || saving.contains(key)
}

/// The sync targets in the data folder with their hash and modification time. A file that
/// cannot be read goes into `skip` (left out of the listing it would read as deleted). An error
/// while listing the folder itself fails the whole listing: it must be complete.
fn list_local(dir: &Path, skip: &mut BTreeSet<String>) -> std::io::Result<Vec<LocalFile>> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if !is_sync_target(&name) {
            continue;
        }
        let path = entry.path();
        let meta = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => {
                skip.insert(name);
                continue;
            }
        };
        if !meta.is_file() {
            continue;
        }
        match std::fs::read(&path).and_then(|bytes| Ok((bytes, meta.modified()?))) {
            Ok((bytes, mtime)) => files.push(LocalFile {
                name,
                hash: sha256_hex(&bytes),
                modified: DateTime::<Local>::from(mtime).naive_local(),
            }),
            Err(_) => {
                skip.insert(name);
            }
        }
    }
    Ok(files)
}

/// Drops the records of files that are gone from both sides (`true` when any was dropped).
/// They mean nothing any more, and left in place they would keep the wiped-side guard armed.
/// A skipped name keeps its record (it may just be unreadable right now).
fn drop_gone_records(
    state: &mut SyncState,
    local: &[LocalFile],
    remote: &[RemoteFile],
    skip: &BTreeSet<String>,
) -> bool {
    let present: BTreeSet<String> = local
        .iter()
        .map(|f| fold(&f.name))
        .chain(remote.iter().map(|f| fold(&f.name)))
        .chain(skip.iter().map(|n| fold(n)))
        .collect();
    let before = state.files.len();
    state.files.retain(|name, _| present.contains(&fold(name)));
    state.files.len() != before
}

/// Notes the root folder the listing came from (`StorageBackend::root_identity`); `true` when
/// `state` changed. When it is not the folder the records were made against (Drive found
/// another `PowerToDo` folder, e.g. after two PCs made one each at their first sync), or the
/// records do not say which folder they were made against, they are dropped: read against
/// another folder they would take this PC's files for deleted (archive) and the remote's for
/// updates (overwrite without a copy). Without records both sides are compared by content, as
/// at a first sync. The same folder keeps its records, so an emptied folder is still `Suspect`.
fn adopt_root(state: &mut SyncState, listed: Option<String>) -> bool {
    let Some(listed) = listed else {
        return false;
    };
    if state.remote_root_id.as_deref() == Some(listed.as_str()) {
        return false;
    }
    if !state.files.is_empty() {
        eprintln!("the sync target's root folder changed; comparing the files by content");
        state.files.clear();
    }
    state.remote_root_id = Some(listed);
    true
}

/// Writes `bytes` as a new file at `path`; never replaces an existing one.
fn write_new_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    let mut tmp = tempfile::Builder::new()
        .prefix(".powertodo-")
        .suffix(".tmp")
        .tempfile_in(dir)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist_noclobber(path).map_err(|e| e.error)?;
    Ok(())
}

/// How a downloaded file was taken into the store.
enum Loaded {
    Project(String),
    Common,
    New,
}

/// Loads the file just written for `key` into the store.
fn load_written(store: &mut ProjectStore, key: &str, name: &str) -> Result<Loaded, FileError> {
    let loaded = if key == COMMON_KEY {
        store.reload_common().map(|()| Loaded::Common)
    } else if store.summaries().iter().any(|p| p.name == key) {
        store
            .reload_external(key)
            .map(|()| Loaded::Project(key.to_string()))
    } else {
        store.adopt_new_file(key).map(|_| Loaded::New)
    };
    loaded.map_err(|e| FileError::Local(format!("「{name}」を読み込めませんでした: {e}")))
}

/// The office app that has `<dir>/<name>` open, judged by its lock file: Excel's owner file
/// `~$<name>` (for a longer name Excel replaces the first two characters instead, so
/// `~$<name without them>` counts too) or LibreOffice's `.~lock.<name>#`. Replacing or moving a
/// workbook that is open there would be undone by the app's next save, which would also write
/// over what came from the other PC without a conflict copy. Saving it later is an external
/// change (Phase 2) and the next run makes a normal conflict of it.
fn open_in_app(dir: &Path, name: &str) -> Option<&'static str> {
    let rest: String = name.chars().skip(2).collect();
    let excel = [format!("~${name}"), format!("~${rest}")];
    if excel.iter().any(|lock| dir.join(lock).exists()) {
        return Some("Excel");
    }
    if dir.join(format!(".~lock.{name}#")).exists() {
        return Some("LibreOffice");
    }
    None
}

/// Under the store lock, right before a local write: the store still has the run's data folder,
/// `key` has no unsaved, held or in-flight edits, no office app has `name` open, and `name`
/// still has the content the plan saw (`expected`; `None` = no file).
fn check_local(
    store: &ProjectStore,
    saving: &BTreeSet<String>,
    data_dir: &Path,
    key: &str,
    name: &str,
    expected: Option<&str>,
) -> Result<(), FileError> {
    if store.paths().data_dir != data_dir {
        return Err(FileError::Changed);
    }
    if is_busy(store, saving, key) {
        return Err(FileError::Deferred);
    }
    if let Some(app) = open_in_app(data_dir, name) {
        return Err(FileError::Open(app));
    }
    let current = match std::fs::read(data_dir.join(name)) {
        Ok(bytes) => Some(sha256_hex(&bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err(FileError::Deferred),
    };
    if current.as_deref() != expected {
        return Err(FileError::Deferred);
    }
    Ok(())
}

fn key_of(name: &str) -> Result<String, FileError> {
    file_key(name).ok_or_else(|| FileError::Local(format!("「{name}」は同期できません")))
}

/// One run in progress.
struct Run<'a> {
    engine: &'a SyncEngine,
    host: &'a dyn SyncHost,
    backend: Arc<dyn StorageBackend>,
    data_dir: PathBuf,
    generation: u64,
    mode: PlanMode,
    /// This run is the one immediate retry after a failed precondition.
    is_retry: bool,
    /// The local listing the plan saw, by exact name.
    local: BTreeMap<String, LocalFile>,
    remote: Vec<RemoteFile>,
    /// The records the plan saw.
    records: BTreeMap<String, FileRecord>,
    state: SyncState,
    report: SyncReport,
    /// Conflict copy names given out in this run.
    taken: BTreeSet<String>,
    /// Names whose record this run wrote or removed (a mirror keeps only these and the ones it
    /// left for later).
    done: BTreeSet<String>,
}

impl Run<'_> {
    async fn execute(&mut self, actions: Vec<Action>) -> Result<(), Stop> {
        for action in actions {
            let (name, result) = match action {
                Action::Upload(n) => {
                    let r = self.upload(&n).await;
                    (n, r)
                }
                Action::Download(n) => {
                    let r = self.download(&n).await;
                    (n, r)
                }
                Action::ArchiveRemote(n) => {
                    let r = self.archive_remote(&n).await;
                    (n, r)
                }
                Action::ArchiveLocal(n) => {
                    let r = self.archive_local(&n);
                    (n, r)
                }
                Action::Conflict { name, keep } => {
                    let r = self.conflict(&name, keep).await;
                    (name, r)
                }
                Action::Record(n) => {
                    let r = self.record_only(&n);
                    (n, r)
                }
                Action::NameClash { names } => {
                    self.report.clashes.push(names);
                    continue;
                }
                // `run` returns before executing anything when a side is suspect.
                Action::Suspect { .. } => continue,
            };
            match result {
                Ok(()) => {}
                Err(FileError::Deferred) => self.report.deferred.push(name),
                Err(FileError::Open(app)) => {
                    self.report.deferred.push(name.clone());
                    self.report.open.push((name, app));
                }
                // Someone else wrote first: nothing was written, the record stays, and the
                // next run (asked for at once) sees their version and plans a conflict.
                Err(FileError::Backend(BackendError::Precondition)) if !self.is_retry => {
                    self.report.deferred.push(name);
                    self.report.rerun = true;
                }
                // The retry met it again: the file keeps changing on the remote (or the
                // server never honours the condition). Say so instead of looking synced.
                Err(FileError::Backend(BackendError::Precondition)) => {
                    let m = format!(
                        "「{name}」は同期先でも更新され続けているため同期できませんでした (次の同期でもう一度試します)"
                    );
                    self.report.failed.push((name, m));
                }
                Err(FileError::Local(m)) => self.report.failed.push((name, m)),
                Err(FileError::Backend(e @ (BackendError::Auth | BackendError::Offline(_)))) => {
                    return Err(Stop::Backend(e));
                }
                Err(FileError::Backend(e)) => {
                    let m = failure_text(&name, &e);
                    self.report.failed.push((name, m));
                }
                Err(FileError::Changed) => return Err(Stop::Changed),
            }
        }
        Ok(())
    }

    fn planned_hash(&self, name: &str) -> Option<String> {
        self.local.get(name).map(|f| f.hash.clone())
    }

    /// The remote file of `name`. Drive can hold a name twice: then the one in the record.
    fn remote_for(&self, name: &str) -> Option<RemoteFile> {
        let same: Vec<&RemoteFile> = self.remote.iter().filter(|r| r.name == name).collect();
        match same.as_slice() {
            [] => None,
            [one] => Some((*one).clone()),
            many => {
                let id = &self.records.get(name)?.remote_id;
                many.iter().find(|r| &r.id == id).map(|r| (*r).clone())
            }
        }
    }

    fn record(
        &mut self,
        name: &str,
        remote: &RemoteFile,
        local_hash: String,
    ) -> Result<(), FileError> {
        self.state.files.insert(
            name.to_string(),
            FileRecord {
                remote_id: remote.id.clone(),
                remote_version: remote.version.clone(),
                remote_modified: remote.modified,
                local_hash,
            },
        );
        self.done.insert(name.to_string());
        self.save()
    }

    fn forget(&mut self, name: &str) -> Result<(), FileError> {
        self.state.files.remove(name);
        self.done.insert(name.to_string());
        self.save()
    }

    fn save(&self) -> Result<(), FileError> {
        if self.engine.save_state(self.generation, &self.state) {
            Ok(())
        } else {
            Err(FileError::Changed)
        }
    }

    /// The remote file holds content with SHA-256 `hash` (a SHA version says so, otherwise the
    /// content is fetched and compared).
    async fn remote_has(&self, remote: &RemoteFile, hash: &str) -> Result<bool, FileError> {
        if remote.version == hash {
            return Ok(true);
        }
        let bytes = self.backend.download(remote).await?;
        Ok(sha256_hex(&bytes) == hash)
    }

    /// The store could not read this PC's copy of `key` (`LoadedProject::Failed`).
    fn local_load_failed(&self, key: &str) -> bool {
        self.host
            .lock_store()
            .as_ref()
            .is_some_and(|s| s.load_failed(key))
    }

    async fn upload(&mut self, name: &str) -> Result<(), FileError> {
        let planned = self.planned_hash(name).ok_or(FileError::Deferred)?;
        // A workbook this PC cannot read is not sent (a download may still repair it).
        if self.local_load_failed(&key_of(name)?) {
            return Err(FileError::Local(format!(
                "「{name}」はこの PC で読み込めていないため送りません"
            )));
        }
        // Read again: a save since the listing would make the hash wrong. Next round then.
        let bytes = std::fs::read(self.data_dir.join(name)).map_err(|_| FileError::Deferred)?;
        if sha256_hex(&bytes) != planned {
            return Err(FileError::Deferred);
        }
        let mut existing = self.remote_for(name);
        if self.mode == PlanMode::MirrorLocal
            && let Some(old) = existing.clone()
        {
            if self.remote_has(&old, &planned).await? {
                self.record(name, &old, planned)?;
                self.report.recorded.push(name.to_string());
                return Ok(());
            }
            // Keep what the remote held before the mirror replaces it.
            self.backend.move_to_archive(&old).await?;
            // That record is void now (should the upload fail, the next run uploads anew).
            self.state.files.remove(name);
            self.save()?;
            existing = None;
        }
        let uploaded = self.backend.upload(name, existing.as_ref(), bytes).await?;
        self.record(name, &uploaded, planned)?;
        self.report.uploaded.push(name.to_string());
        Ok(())
    }

    async fn download(&mut self, name: &str) -> Result<(), FileError> {
        let remote = self.remote_for(name).ok_or_else(|| missing_remote(name))?;
        let planned = self.planned_hash(name);
        let bytes = self.backend.download(&remote).await?;
        let hash = sha256_hex(&bytes);
        if planned.as_deref() == Some(hash.as_str()) {
            self.record(name, &remote, hash)?;
            self.report.recorded.push(name.to_string());
            return Ok(());
        }
        let staged = stage(&self.data_dir, name, &bytes)?;
        // A mirror keeps the local file it replaces.
        let keep_old = self.mode == PlanMode::MirrorRemote && planned.is_some();
        self.write_local(name, staged, planned.as_deref(), keep_old)?;
        self.record(name, &remote, hash)?;
        self.report.downloaded.push(name.to_string());
        Ok(())
    }

    /// Puts a checked download ([`stage`]) over `<data>/<name>` through the store and loads it,
    /// then tells the UI. `expected` is the content the plan saw (see [`check_local`]).
    fn write_local(
        &mut self,
        name: &str,
        staged: StagedDownload,
        expected: Option<&str>,
        keep_old: bool,
    ) -> Result<(), FileError> {
        let key = key_of(name)?;
        let host = self.host;
        let loaded = {
            let mut guard = host.lock_store();
            let store = guard.as_mut().ok_or(FileError::Changed)?;
            check_local(
                store,
                &host.saving_keys(),
                &self.data_dir,
                &key,
                name,
                expected,
            )?;
            if keep_old {
                store
                    .keep_copy_before_sync(name, self.engine.now())
                    .map_err(|e| failure(name, e))?;
            }
            store
                .install_download(staged)
                .map_err(|e| failure(name, e))?;
            load_written(store, &key, name)
        };
        match loaded? {
            Loaded::Project(p) => host.projects_reloaded(&[p]),
            Loaded::Common => host.project_list_changed(true),
            Loaded::New => host.project_list_changed(false),
        }
        Ok(())
    }

    async fn archive_remote(&mut self, name: &str) -> Result<(), FileError> {
        let remote = self.remote_for(name).ok_or_else(|| missing_remote(name))?;
        self.backend.move_to_archive(&remote).await?;
        self.forget(name)?;
        self.report.archived_remote.push(name.to_string());
        Ok(())
    }

    fn archive_local(&mut self, name: &str) -> Result<(), FileError> {
        let planned = self.planned_hash(name).ok_or(FileError::Deferred)?;
        let key = key_of(name)?;
        let host = self.host;
        {
            let mut guard = host.lock_store();
            let store = guard.as_mut().ok_or(FileError::Changed)?;
            check_local(
                store,
                &host.saving_keys(),
                &self.data_dir,
                &key,
                name,
                Some(&planned),
            )?;
            store.archive_synced(name).map_err(|e| failure(name, e))?;
        }
        host.project_list_changed(false);
        self.forget(name)?;
        self.report.archived_local.push(name.to_string());
        Ok(())
    }

    fn record_only(&mut self, name: &str) -> Result<(), FileError> {
        let hash = self.planned_hash(name).ok_or(FileError::Deferred)?;
        let remote = self.remote_for(name).ok_or_else(|| missing_remote(name))?;
        self.record(name, &remote, hash)?;
        self.report.recorded.push(name.to_string());
        Ok(())
    }

    /// A conflict copy name that is free locally, remotely and in this run.
    fn free_conflict_name(&self, name: &str) -> String {
        let taken = |n: &str| {
            self.taken.contains(n)
                || self.remote.iter().any(|r| fold(&r.name) == fold(n))
                || self.data_dir.join(n).exists()
        };
        let base = conflict_name(name, self.engine.now());
        if !taken(&base) {
            return base;
        }
        let stem = base.strip_suffix(").xlsx").unwrap_or(&base).to_string();
        let mut i = 2;
        loop {
            let candidate = format!("{stem}-{i}).xlsx");
            if !taken(&candidate) {
                return candidate;
            }
            i += 1;
        }
    }

    /// Both sides changed (spec section 3.3). The loser's content is kept as a conflict copy
    /// locally and remotely, then the winner is put on both sides. When the two contents are the
    /// same after all (an etag / md5 cannot tell), only the record is written. A fresh PC's
    /// pristine inbox / common workbook is just replaced (nothing to keep). A local workbook
    /// this PC cannot read never wins.
    async fn conflict(&mut self, name: &str, keep: Side) -> Result<(), FileError> {
        let remote = self.remote_for(name).ok_or_else(|| missing_remote(name))?;
        let planned = self.planned_hash(name).ok_or(FileError::Deferred)?;
        let key = key_of(name)?;
        let remote_bytes = self.backend.download(&remote).await?;
        let remote_hash = sha256_hex(&remote_bytes);
        let local_bytes =
            std::fs::read(self.data_dir.join(name)).map_err(|_| FileError::Deferred)?;
        if sha256_hex(&local_bytes) != planned {
            return Err(FileError::Deferred);
        }
        if remote_hash == planned {
            self.record(name, &remote, planned)?;
            self.report.recorded.push(name.to_string());
            return Ok(());
        }
        let first_sync = !self.records.contains_key(name);
        let (keep, pristine) = {
            let guard = self.host.lock_store();
            let store = guard.as_ref().ok_or(FileError::Changed)?;
            let keep = if store.load_failed(&key) {
                Side::Remote
            } else {
                keep
            };
            if keep == Side::Remote {
                // The local file will be replaced: make sure it can be before making copies, so
                // a busy project does not get a new copy every round.
                check_local(
                    store,
                    &self.host.saving_keys(),
                    &self.data_dir,
                    &key,
                    name,
                    Some(&planned),
                )?;
            }
            (
                keep,
                first_sync && keep == Side::Remote && store.is_pristine(&key),
            )
        };
        // A remote winner must be readable before anything is copied or replaced.
        let staged = match keep {
            Side::Remote => Some(stage(&self.data_dir, name, &remote_bytes)?),
            Side::Local => None,
        };
        if pristine && let Some(staged) = staged {
            self.write_local(name, staged, Some(&planned), false)?;
            self.record(name, &remote, remote_hash)?;
            self.report.downloaded.push(name.to_string());
            return Ok(());
        }
        let copy = self.free_conflict_name(name);
        let loser = match keep {
            Side::Remote => local_bytes.clone(),
            Side::Local => remote_bytes.clone(),
        };
        write_new_file(&self.data_dir.join(&copy), &loser).map_err(|e| failure(name, e))?;
        self.taken.insert(copy.clone());
        self.backend.upload(&copy, None, loser).await?;
        self.report.conflicts.push((name.to_string(), copy.clone()));
        self.host.conflict(name, &copy);
        match (keep, staged) {
            (Side::Remote, Some(staged)) => {
                self.write_local(name, staged, Some(&planned), false)?;
                self.record(name, &remote, remote_hash)?;
            }
            _ => {
                let uploaded = self
                    .backend
                    .upload(name, Some(&remote), local_bytes)
                    .await?;
                self.record(name, &uploaded, planned)?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{INBOX, TaskInput};
    use crate::store::paths::Paths;
    use crate::store::project_book::read_project_book;
    use crate::sync::backend::{BoxFut, Failure, MemoryBackend};
    use std::fs;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").unwrap()
    }

    /// The engine's clock: conflict copies are named after it.
    const NOW: &str = "2026-10-16T09:30:00";
    const ROOT: &str = "http://nas:5005/powertodo/";
    const INBOX_FILE: &str = "受信トレイ.xlsx";

    /// A remote whose files are stamped `at` (decides who wins a conflict).
    fn backend_at(at: &str) -> Arc<MemoryBackend> {
        let t = dt(at);
        Arc::new(MemoryBackend::new(move || t))
    }

    fn backend() -> Arc<MemoryBackend> {
        backend_at(NOW)
    }

    fn input(title: &str) -> TaskInput {
        TaskInput {
            title: title.into(),
            section: None,
            priority: None,
            due: None,
            due_time: None,
            note: None,
            labels: vec![],
            parent_no: None,
            rrule: None,
            reminders: vec![],
        }
    }

    #[derive(Debug, Clone, PartialEq)]
    enum Event {
        Status(SyncStatusView),
        Conflict(String, String),
        Reloaded(Vec<String>),
        ListChanged(bool),
    }

    #[derive(Default)]
    struct Host {
        store: Mutex<Option<ProjectStore>>,
        saving: Mutex<BTreeSet<String>>,
        events: Mutex<Vec<Event>>,
    }

    impl Host {
        fn push(&self, e: Event) {
            self.events.lock().unwrap().push(e);
        }
    }

    impl SyncHost for Host {
        fn lock_store(&self) -> MutexGuard<'_, Option<ProjectStore>> {
            self.store.lock().unwrap()
        }
        fn saving_keys(&self) -> BTreeSet<String> {
            self.saving.lock().unwrap().clone()
        }
        fn status_changed(&self, status: &SyncStatusView) {
            self.push(Event::Status(status.clone()));
        }
        fn conflict(&self, file: &str, conflict_file: &str) {
            self.push(Event::Conflict(file.into(), conflict_file.into()));
        }
        fn projects_reloaded(&self, names: &[String]) {
            self.push(Event::Reloaded(names.to_vec()));
        }
        fn project_list_changed(&self, common_reloaded: bool) {
            self.push(Event::ListChanged(common_reloaded));
        }
    }

    fn open_store(data: &Path) -> ProjectStore {
        ProjectStore::open(Paths::new(data), || dt("2026-10-16T09:00:00"), true).unwrap()
    }

    /// One PC: a data folder with an open store, an app data folder, an engine.
    struct Pc {
        _tmp: tempfile::TempDir,
        data: PathBuf,
        app: PathBuf,
        host: Arc<Host>,
        engine: SyncEngine,
    }

    impl Pc {
        fn new(remote: &Arc<MemoryBackend>) -> Pc {
            Pc::with_backend(remote.clone(), None)
        }

        /// `seed`: the `*.xlsx` files of that folder are copied in before the store opens.
        fn with_backend(backend: Arc<dyn StorageBackend>, seed: Option<&Path>) -> Pc {
            let tmp = tempfile::tempdir().unwrap();
            let data = tmp.path().join("data");
            let app = tmp.path().join("app");
            if let Some(seed) = seed {
                fs::create_dir_all(&data).unwrap();
                for e in fs::read_dir(seed).unwrap() {
                    let p = e.unwrap().path();
                    if p.is_file() && p.extension().is_some_and(|x| x == "xlsx") {
                        fs::copy(&p, data.join(p.file_name().unwrap())).unwrap();
                    }
                }
            }
            let host = Arc::new(Host::default());
            *host.store.lock().unwrap() = Some(open_store(&data));
            let engine = SyncEngine::with_clock(app.clone(), || dt(NOW));
            engine.set_backend(Some(backend), BackendKind::Nas, ROOT);
            Pc {
                _tmp: tmp,
                data,
                app,
                host,
                engine,
            }
        }

        fn with<R>(&self, f: impl FnOnce(&mut ProjectStore) -> R) -> R {
            f(self.host.store.lock().unwrap().as_mut().unwrap())
        }

        async fn sync(&self) -> SyncReport {
            self.engine.run_once(self.host.as_ref()).await
        }

        async fn mirror(&self, mode: PlanMode) -> SyncReport {
            self.engine.run_mirror(self.host.as_ref(), mode).await
        }

        fn create(&self, project: &str) {
            self.with(|s| {
                s.create_project(project, "var(--color-text-muted)")
                    .unwrap();
            });
        }

        /// Adds a task and saves the project.
        fn add(&self, project: &str, title: &str) {
            self.with(|s| {
                s.add_task(project, input(title)).unwrap();
                s.save(project).unwrap();
            });
        }

        /// Task titles of the project as the store has it in memory.
        fn titles(&self, project: &str) -> Vec<String> {
            self.with(|s| {
                s.view(project)
                    .unwrap()
                    .tasks
                    .iter()
                    .map(|t| t.title.clone())
                    .collect()
            })
        }

        fn file(&self, name: &str) -> Vec<u8> {
            fs::read(self.data.join(name)).unwrap()
        }

        fn has(&self, name: &str) -> bool {
            self.data.join(name).exists()
        }

        fn events(&self) -> Vec<Event> {
            self.host.events.lock().unwrap().clone()
        }

        fn records(&self) -> BTreeMap<String, FileRecord> {
            SyncState::load(&self.app, &self.data, BackendKind::Nas, ROOT).files
        }

        fn archive_names(&self) -> Vec<String> {
            let Ok(entries) = fs::read_dir(self.data.join("archive")) else {
                return Vec::new();
            };
            let mut names: Vec<String> = entries
                .map(|e| e.unwrap().file_name().into_string().unwrap())
                .collect();
            names.sort();
            names
        }
    }

    fn titles_in(bytes: &[u8]) -> Vec<String> {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("x.xlsx");
        fs::write(&path, bytes).unwrap();
        read_project_book(&path)
            .unwrap()
            .tasks
            .into_iter()
            .map(|t| t.title)
            .collect()
    }

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    fn sorted(mut v: Vec<String>) -> Vec<String> {
        v.sort();
        v
    }

    /// Nothing was done (no file action at all).
    fn idle(r: &SyncReport) -> bool {
        r.uploaded.is_empty()
            && r.downloaded.is_empty()
            && r.recorded.is_empty()
            && r.archived_local.is_empty()
            && r.archived_remote.is_empty()
            && r.conflicts.is_empty()
            && r.deferred.is_empty()
            && r.failed.is_empty()
            && r.clashes.is_empty()
    }

    /// A with a project 仕事, synced; B joined (its fresh inbox and common workbook became
    /// conflict copies, the rest came down).
    async fn two_pcs(remote: &Arc<MemoryBackend>) -> (Pc, Pc) {
        let a = Pc::new(remote);
        a.add(INBOX, "牛乳を買う");
        a.create("仕事");
        a.add("仕事", "資料を作る");
        let r = a.sync().await;
        assert_eq!(r.outcome, RunOutcome::Done);
        assert_eq!(
            sorted(r.uploaded),
            names(&["_PowerToDo.xlsx", "仕事.xlsx", INBOX_FILE])
        );
        let b = Pc::new(remote);
        let r = b.sync().await;
        assert_eq!(r.outcome, RunOutcome::Done, "{r:?}");
        (a, b)
    }

    #[tokio::test]
    async fn two_pcs_round_trip() {
        let remote = backend();
        let (a, b) = two_pcs(&remote).await;
        for name in ["_PowerToDo.xlsx", INBOX_FILE, "仕事.xlsx"] {
            assert_eq!(
                sha256_hex(&b.file(name)),
                sha256_hex(&a.file(name)),
                "{name}"
            );
            assert_eq!(remote.get(name).unwrap(), a.file(name), "{name}");
        }
        assert_eq!(b.titles(INBOX), ["牛乳を買う"]);
        assert_eq!(b.titles("仕事"), ["資料を作る"]);
        assert!(b.with(|s| {
            s.summaries()
                .iter()
                .any(|p| p.name == "仕事" && p.load_error.is_none())
        }));

        b.add("仕事", "見積もりを送る");
        let r = b.sync().await;
        assert_eq!(r.uploaded, ["仕事.xlsx"]);
        let r = a.sync().await;
        assert_eq!(r.downloaded, ["仕事.xlsx"]);
        assert_eq!(a.titles("仕事"), ["資料を作る", "見積もりを送る"]);
        assert_eq!(a.file("仕事.xlsx"), b.file("仕事.xlsx"));
        assert!(a.events().contains(&Event::Reloaded(names(&["仕事"]))));
        let status = a.engine.status();
        assert_eq!(status.state, SyncPhase::Synced);
        assert_eq!(status.last_synced.as_deref(), Some(NOW));
        assert_eq!(status.pending, 0);
        // Both sides agree now.
        assert!(idle(&a.sync().await));
        assert!(idle(&b.sync().await));
    }

    fn conflict_events(pc: &Pc) -> Vec<String> {
        let copies: Vec<String> = pc
            .events()
            .iter()
            .filter_map(|e| match e {
                Event::Conflict(_, c) => Some(c.clone()),
                _ => None,
            })
            .collect();
        sorted(copies)
    }

    #[tokio::test]
    async fn first_sync_replaces_pristine_defaults_without_copies() {
        let remote = backend();
        let (a, b) = two_pcs(&remote).await;
        // B's fresh inbox and common workbook held nothing: the remote's came down, no copy.
        assert!(conflict_events(&b).is_empty());
        assert!(
            fs::read_dir(&b.data)
                .unwrap()
                .all(|e| { !e.unwrap().file_name().to_string_lossy().contains("競合") })
        );
        assert!(futures_names(&remote).iter().all(|n| !n.contains("競合")));
        assert_eq!(b.file(INBOX_FILE), a.file(INBOX_FILE));
        assert_eq!(b.file("_PowerToDo.xlsx"), a.file("_PowerToDo.xlsx"));
    }

    #[tokio::test]
    async fn first_sync_keeps_a_used_inbox_and_common_as_conflict_copies() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.add(INBOX, "Aのタスク");
        a.sync().await;
        let b = Pc::new(&remote);
        // B was used before joining: a task in the inbox, a project in the common workbook.
        b.add(INBOX, "Bのタスク");
        b.create("Bの仕事");
        let r = b.sync().await;
        assert_eq!(r.outcome, RunOutcome::Done, "{r:?}");
        let copies = conflict_events(&b);
        assert_eq!(
            copies,
            names(&[
                "_PowerToDo (競合 2026-10-16 0930).xlsx",
                "受信トレイ (競合 2026-10-16 0930).xlsx"
            ])
        );
        for c in &copies {
            assert!(b.has(c));
            assert_eq!(remote.get(c).unwrap(), b.file(c));
        }
        assert_eq!(
            titles_in(&b.file("受信トレイ (競合 2026-10-16 0930).xlsx")),
            ["Bのタスク"]
        );
        assert_eq!(b.titles(INBOX), ["Aのタスク"]);
        // Conflict copies are not projects.
        assert!(b.with(|s| s.summaries().iter().all(|p| !p.name.contains("競合"))));
    }

    #[tokio::test]
    async fn two_pcs_conflict() {
        // The remote copy is the newer one (stamped far ahead).
        let remote = backend_at("2100-01-01T00:00:00");
        let (a, b) = two_pcs(&remote).await;
        a.add(INBOX, "Aの変更");
        b.add(INBOX, "Bの変更");
        assert_eq!(a.sync().await.uploaded, [INBOX_FILE]);
        // A copy of that name is already there: the new one gets a number.
        fs::write(
            b.data.join("受信トレイ (競合 2026-10-16 0930).xlsx"),
            b"older copy",
        )
        .unwrap();
        let r = b.sync().await;
        let copy = "受信トレイ (競合 2026-10-16 0930-2).xlsx".to_string();
        assert_eq!(r.conflicts, [(INBOX_FILE.to_string(), copy.clone())]);
        assert_eq!(
            b.file("受信トレイ (競合 2026-10-16 0930).xlsx"),
            b"older copy"
        );
        assert!(
            b.events()
                .contains(&Event::Conflict(INBOX_FILE.into(), copy.clone()))
        );
        // The winner (A's) on both sides of B, the loser (B's) in the copy on both sides.
        assert_eq!(b.titles(INBOX), ["牛乳を買う", "Aの変更"]);
        assert_eq!(b.file(INBOX_FILE), remote.get(INBOX_FILE).unwrap());
        assert_eq!(titles_in(&b.file(&copy)), ["牛乳を買う", "Bの変更"]);
        assert_eq!(remote.get(&copy).unwrap(), b.file(&copy));
        assert!(!b.with(|s| s.changed_on_disk(INBOX)));
        // Nothing more to do; A does not fetch conflict copies.
        assert!(idle(&b.sync().await));
        assert!(idle(&a.sync().await));
        assert!(!a.has(&copy));
    }

    #[tokio::test]
    async fn conflict_with_the_newer_local_side_keeps_local() {
        // The remote copy is the older one.
        let remote = backend_at("2000-01-01T00:00:00");
        let (a, b) = two_pcs(&remote).await;
        a.add(INBOX, "Aの変更");
        b.add(INBOX, "Bの変更");
        a.sync().await;
        let r = b.sync().await;
        let copy = "受信トレイ (競合 2026-10-16 0930).xlsx".to_string();
        assert_eq!(r.conflicts, [(INBOX_FILE.to_string(), copy.clone())]);
        // B's content stays and goes up; A's is the copy on both sides.
        assert_eq!(b.titles(INBOX), ["牛乳を買う", "Bの変更"]);
        assert_eq!(remote.get(INBOX_FILE).unwrap(), b.file(INBOX_FILE));
        assert_eq!(titles_in(&b.file(&copy)), ["牛乳を買う", "Aの変更"]);
        assert_eq!(remote.get(&copy).unwrap(), b.file(&copy));
        assert_eq!(a.sync().await.downloaded, [INBOX_FILE]);
        assert_eq!(a.titles(INBOX), ["牛乳を買う", "Bの変更"]);
    }

    #[tokio::test]
    async fn downloaded_file_is_not_an_external_change() {
        let remote = backend();
        let (a, b) = two_pcs(&remote).await;
        for key in ["仕事", INBOX, "_common"] {
            assert!(!b.with(|s| s.changed_on_disk(key)), "{key}");
        }
        a.add("仕事", "追加");
        a.sync().await;
        assert_eq!(b.sync().await.downloaded, ["仕事.xlsx"]);
        assert!(!b.with(|s| s.changed_on_disk("仕事")));
        assert!(b.with(|s| s.dirty_projects().is_empty() && !s.is_held("仕事")));
        assert_eq!(b.titles("仕事"), ["資料を作る", "追加"]);
    }

    #[tokio::test]
    async fn skips_dirty_held_and_saving() {
        let remote = backend();
        let a = Pc::new(&remote);
        for p in ["p0", "p1", "p2", "p3"] {
            a.create(p);
        }
        a.sync().await;
        let b = Pc::new(&remote);
        b.sync().await;
        for p in ["p0", "p1", "p2", "p3"] {
            b.add(p, "Bの変更");
        }
        assert_eq!(b.sync().await.uploaded.len(), 4);

        // p1 has unsaved edits, p2 changed on disk and waits for the user's choice, p3 is being
        // written. All of them changed remotely; p2 changed locally too.
        a.with(|s| s.add_task("p1", input("未保存")).unwrap());
        fs::write(a.data.join("p2.xlsx"), a.file("p0.xlsx")).unwrap();
        a.with(|s| s.hold("p2"));
        a.host.saving.lock().unwrap().insert("p3".into());
        let before: Vec<Vec<u8>> = ["p1", "p2", "p3"]
            .iter()
            .map(|p| a.file(&format!("{p}.xlsx")))
            .collect();
        let remote_before: Vec<Vec<u8>> = ["p1", "p2", "p3"]
            .iter()
            .map(|p| remote.get(&format!("{p}.xlsx")).unwrap())
            .collect();
        let records_before = a.records();

        let r = a.sync().await;
        assert_eq!(r.downloaded, ["p0.xlsx"]);
        assert!(r.uploaded.is_empty());
        assert_eq!(r.skipped, names(&["p1.xlsx", "p2.xlsx", "p3.xlsx"]));
        for (i, p) in ["p1", "p2", "p3"].iter().enumerate() {
            let name = format!("{p}.xlsx");
            assert_eq!(a.file(&name), before[i], "{name}");
            assert_eq!(remote.get(&name).unwrap(), remote_before[i], "{name}");
            assert_eq!(a.records().get(&name), records_before.get(&name), "{name}");
        }
        // The unsaved edit is still there.
        assert_eq!(a.titles("p1"), ["未保存"]);
        assert!(a.with(|s| s.dirty_projects()).contains(&"p1".to_string()));
        let status = a.engine.status();
        assert_eq!(status.state, SyncPhase::Synced);
        assert_eq!(status.pending, 3);
    }

    /// A backend that runs a hook once, when it is listed (after the local listing was taken).
    struct Hooked {
        inner: Arc<MemoryBackend>,
        on_list: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    }

    impl Hooked {
        fn new(inner: &Arc<MemoryBackend>) -> Arc<Hooked> {
            Arc::new(Hooked {
                inner: inner.clone(),
                on_list: Mutex::new(None),
            })
        }
        fn on_list(&self, f: impl FnOnce() + Send + 'static) {
            *self.on_list.lock().unwrap() = Some(Box::new(f));
        }
    }

    impl StorageBackend for Hooked {
        fn list(&self) -> BoxFut<'_, Vec<RemoteFile>> {
            let hook = self.on_list.lock().unwrap().take();
            if let Some(f) = hook {
                f();
            }
            self.inner.list()
        }
        fn download<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, Vec<u8>> {
            self.inner.download(file)
        }
        fn upload<'a>(
            &'a self,
            name: &'a str,
            existing: Option<&'a RemoteFile>,
            bytes: Vec<u8>,
        ) -> BoxFut<'a, RemoteFile> {
            self.inner.upload(name, existing, bytes)
        }
        fn move_to_archive<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, ()> {
            self.inner.move_to_archive(file)
        }
    }

    /// Every upload meets a concurrent change: `Precondition`, counted.
    struct AlwaysStale {
        inner: Arc<MemoryBackend>,
        uploads: std::sync::atomic::AtomicUsize,
    }

    impl StorageBackend for AlwaysStale {
        fn list(&self) -> BoxFut<'_, Vec<RemoteFile>> {
            self.inner.list()
        }
        fn download<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, Vec<u8>> {
            self.inner.download(file)
        }
        fn upload<'a>(
            &'a self,
            _name: &'a str,
            _existing: Option<&'a RemoteFile>,
            _bytes: Vec<u8>,
        ) -> BoxFut<'a, RemoteFile> {
            self.uploads
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Box::pin(async { Err(BackendError::Precondition) })
        }
        fn move_to_archive<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, ()> {
            self.inner.move_to_archive(file)
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_failing_precondition_is_retried_once_then_left_to_the_schedule() {
        let remote = backend();
        let stale = Arc::new(AlwaysStale {
            inner: remote.clone(),
            uploads: Default::default(),
        });
        let a = Pc::with_backend(stale.clone(), None);
        let host: Arc<dyn SyncHost> = a.host.clone();
        let task = tokio::spawn(a.engine.clone().run_loop(host));
        // The start-up run uploads (and fails), then exactly one immediate retry.
        tokio::time::sleep(Duration::from_secs(10)).await;
        let count = |s: &AlwaysStale| s.uploads.load(std::sync::atomic::Ordering::SeqCst);
        let after_retry = count(&stale);
        assert!(after_retry >= 2, "the retry did not happen");
        tokio::time::sleep(Duration::from_secs(60)).await;
        assert_eq!(count(&stale), after_retry, "the retry chain did not stop");
        // The interval run is a normal run again: it tries (and then retries once) once more.
        tokio::time::sleep(INTERVAL).await;
        assert_eq!(count(&stale), after_retry * 2);
        task.abort();
    }

    #[tokio::test]
    async fn a_retry_run_does_not_ask_for_another_retry() {
        let remote = backend();
        let a = Pc::with_backend(
            Arc::new(AlwaysStale {
                inner: remote.clone(),
                uploads: Default::default(),
            }),
            None,
        );
        a.engine.take_due(Instant::now());
        let r = a.sync().await;
        assert!(r.rerun);
        // The run asked for a retry, alone.
        assert_eq!(a.engine.take_due_run(Instant::now()), Some(true));
        let r = a
            .engine
            .run(a.host.as_ref(), PlanMode::Normal, true, None)
            .await;
        assert!(!r.rerun);
        assert_eq!(a.engine.take_due_run(Instant::now()), None);
        // The failure is visible: the status is an error naming a file, not "synced".
        assert!(r.deferred.is_empty());
        assert_eq!(r.failed.len(), 2);
        let status = a.engine.status();
        assert_eq!(status.state, SyncPhase::Error);
        let message = status.message.unwrap();
        assert!(message.contains(&r.failed[0].0), "{message}");
        assert!(
            message.contains("同期先でも更新され続けている"),
            "{message}"
        );
        assert_eq!(status.pending, 2);
        // A retry joined by another reason is a normal run.
        a.engine.request(SyncReason::Retry);
        a.engine.request(SyncReason::SyncNow);
        assert_eq!(a.engine.take_due_run(Instant::now()), Some(false));
    }

    #[tokio::test]
    async fn upload_waits_when_the_file_changed_after_the_listing() {
        let remote = backend();
        let hooked = Hooked::new(&remote);
        let a = Pc::with_backend(hooked.clone(), None);
        a.sync().await;
        let uploaded_before = remote.get(INBOX_FILE).unwrap();
        a.add(INBOX, "1");
        let path = a.data.join(INBOX_FILE);
        hooked.on_list(move || fs::write(path, b"saved again").unwrap());
        let r = a.sync().await;
        assert_eq!(r.deferred, [INBOX_FILE]);
        assert!(r.uploaded.is_empty());
        assert_eq!(remote.get(INBOX_FILE).unwrap(), uploaded_before);
        assert_eq!(a.engine.status().pending, 1);
    }

    #[tokio::test]
    async fn download_waits_when_the_project_is_edited_during_the_run() {
        let remote = backend();
        let hooked = Hooked::new(&remote);
        let a = Pc::with_backend(hooked.clone(), None);
        a.create("p0");
        a.create("p1");
        a.sync().await;
        let b = Pc::new(&remote);
        b.sync().await;
        b.add("p0", "Bの変更");
        b.sync().await;
        let before = a.file("p0.xlsx");
        let host = a.host.clone();
        hooked.on_list(move || {
            let mut g = host.store.lock().unwrap();
            g.as_mut().unwrap().add_task("p0", input("編集中")).unwrap();
        });
        let r = a.sync().await;
        assert_eq!(r.deferred, ["p0.xlsx"]);
        assert_eq!(a.file("p0.xlsx"), before);
        assert_eq!(a.titles("p0"), ["編集中"]);
    }

    #[tokio::test]
    async fn auth_failure_stops_retrying() {
        let remote = backend();
        let a = Pc::new(&remote);
        remote.fail_list(Failure::Auth);
        let r = a.sync().await;
        assert_eq!(r.outcome, RunOutcome::Failed);
        assert!(a.engine.auth_rejected());
        let status = a.engine.status();
        assert_eq!(status.state, SyncPhase::Error);
        assert!(status.message.unwrap().contains("認証"));
        // No automatic run is accepted, and a run that is started anyway does nothing.
        assert!(a.engine.take_due(Instant::now()));
        for reason in [
            SyncReason::Interval,
            SyncReason::AfterSave,
            SyncReason::Startup,
            SyncReason::Connected,
            SyncReason::SyncNow,
        ] {
            assert!(!a.engine.request(reason));
        }
        assert!(!a.engine.take_due(Instant::now() + INTERVAL));
        remote.clear_failures();
        assert_eq!(a.sync().await.outcome, RunOutcome::NotRun);
        assert!(remote.get(INBOX_FILE).is_none());

        a.engine.clear_auth_rejected();
        assert!(a.engine.request(SyncReason::SyncNow));
        let r = a.sync().await;
        assert_eq!(r.outcome, RunOutcome::Done);
        assert!(r.uploaded.contains(&INBOX_FILE.to_string()));
    }

    #[tokio::test]
    async fn a_google_login_that_stopped_working_asks_for_a_new_login() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.engine
            .set_backend(Some(remote.clone()), BackendKind::Gdrive, "gdrive:default");
        remote.fail_list(Failure::Auth);
        assert_eq!(a.sync().await.outcome, RunOutcome::Failed);
        let m = a.engine.status().message.unwrap();
        assert!(m.contains("ログイン") && !m.contains("確かめる"), "{m}");
        // The NAS keeps its own wording.
        assert!(auth_failed_message(BackendKind::Nas).contains("確かめる"));
    }

    #[tokio::test]
    async fn the_status_says_when_the_credentials_were_refused_and_only_then() {
        let remote = backend();
        let a = Pc::new(&remote);
        // A failure that logging in again would not fix (no space) is an error without the flag.
        remote.fail(INBOX_FILE, Failure::Full);
        a.sync().await;
        let s = a.engine.status();
        assert_eq!(s.state, SyncPhase::Error);
        assert!(!s.auth_rejected, "{s:?}");
        assert!(
            serde_json::to_value(&s)
                .unwrap()
                .get("authRejected")
                .is_none()
        );
        remote.clear_failures();

        // A refusal sets it, and it goes out in the event's JSON.
        remote.fail_list(Failure::Auth);
        a.sync().await;
        let s = a.engine.status();
        assert!(s.auth_rejected && s.state == SyncPhase::Error);
        assert_eq!(serde_json::to_value(&s).unwrap()["authRejected"], true);

        // A new target (a new login) clears it, and so does the run that follows.
        remote.clear_failures();
        a.engine
            .set_backend(Some(remote.clone()), BackendKind::Gdrive, "gdrive:default");
        assert!(!a.engine.status().auth_rejected);
        a.sync().await;
        let s = a.engine.status();
        assert_eq!(s.state, SyncPhase::Synced);
        assert!(!s.auth_rejected);

        // Removing the target clears it too.
        remote.fail_list(Failure::Auth);
        a.engine.clear_auth_rejected();
        a.engine.request(SyncReason::SyncNow);
        a.sync().await;
        assert!(a.engine.status().auth_rejected);
        a.engine.set_backend(None, BackendKind::Gdrive, "");
        assert!(!a.engine.status().auth_rejected);
    }

    #[tokio::test]
    async fn a_new_target_clears_auth_rejected() {
        let remote = backend();
        let a = Pc::new(&remote);
        remote.fail_list(Failure::Auth);
        a.sync().await;
        assert!(a.engine.auth_rejected());
        remote.clear_failures();
        a.engine
            .set_backend(Some(remote.clone()), BackendKind::Nas, ROOT);
        assert!(!a.engine.auth_rejected());
        assert_eq!(a.sync().await.outcome, RunOutcome::Done);
    }

    #[tokio::test]
    async fn offline_is_quiet() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.sync().await;
        let saved = fs::read(a.app.join(SyncState::FILE)).unwrap();
        let remote_inbox = remote.get(INBOX_FILE).unwrap();
        a.add(INBOX, "オフライン中");

        remote.fail_list(Failure::Offline);
        let r = a.sync().await;
        assert_eq!(r.outcome, RunOutcome::Offline);
        assert_eq!(a.engine.status().state, SyncPhase::Offline);
        assert_eq!(fs::read(a.app.join(SyncState::FILE)).unwrap(), saved);
        assert!(!a.engine.auth_rejected());

        // Failing in the middle (the upload) stops the run the same way.
        remote.clear_failures();
        remote.fail(INBOX_FILE, Failure::Offline);
        let r = a.sync().await;
        assert_eq!(r.outcome, RunOutcome::Offline);
        assert_eq!(a.engine.status().state, SyncPhase::Offline);
        assert_eq!(fs::read(a.app.join(SyncState::FILE)).unwrap(), saved);
        assert_eq!(remote.get(INBOX_FILE).unwrap(), remote_inbox);

        // Back online: the next request catches up.
        remote.clear_failures();
        assert!(a.engine.request(SyncReason::Interval));
        let r = a.sync().await;
        assert_eq!(r.uploaded, [INBOX_FILE]);
        assert_eq!(remote.get(INBOX_FILE).unwrap(), a.file(INBOX_FILE));
        assert_eq!(a.engine.status().state, SyncPhase::Synced);
    }

    #[tokio::test]
    async fn other_backend_errors_fail_only_that_file() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.create("p0");
        remote.fail("p0.xlsx", Failure::Full);
        let r = a.sync().await;
        assert_eq!(r.outcome, RunOutcome::Done);
        assert_eq!(r.failed.len(), 1);
        assert_eq!(r.failed[0].0, "p0.xlsx");
        assert!(r.uploaded.contains(&INBOX_FILE.to_string()));
        let status = a.engine.status();
        assert_eq!(status.state, SyncPhase::Error);
        assert!(status.message.unwrap().contains("容量"));
        remote.clear_failures();
        assert_eq!(a.sync().await.uploaded, ["p0.xlsx"]);
        assert_eq!(a.engine.status().state, SyncPhase::Synced);
    }

    #[tokio::test]
    async fn remote_deleted_archives_local() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.create("p0");
        a.create("p1");
        a.add("p1", "古いタスク");
        a.sync().await;
        let content = a.file("p1.xlsx");
        assert!(remote.remove("p1.xlsx"));
        let r = a.sync().await;
        assert_eq!(r.archived_local, ["p1.xlsx"]);
        assert!(!a.has("p1.xlsx"));
        let archived = a.archive_names();
        assert_eq!(archived.len(), 1);
        assert!(archived[0].starts_with("p1 ("), "{archived:?}");
        assert_eq!(
            fs::read(a.data.join("archive").join(&archived[0])).unwrap(),
            content
        );
        assert!(a.with(|s| s.summaries().iter().all(|p| p.name != "p1")));
        assert!(!a.records().contains_key("p1.xlsx"));
        assert!(a.events().contains(&Event::ListChanged(false)));
        // The common workbook (no p1 any more) goes up next.
        assert_eq!(a.sync().await.uploaded, ["_PowerToDo.xlsx"]);
    }

    #[tokio::test]
    async fn local_deleted_archives_remote() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.create("p0");
        a.create("p1");
        a.add("p1", "古いタスク");
        a.sync().await;
        let content = remote.get("p1.xlsx").unwrap();
        a.with(|s| s.delete_project("p1").unwrap());
        let r = a.sync().await;
        assert_eq!(r.archived_remote, ["p1.xlsx"]);
        assert_eq!(r.uploaded, ["_PowerToDo.xlsx"]);
        assert!(remote.get("p1.xlsx").is_none());
        assert_eq!(remote.archived(), [("p1.xlsx".to_string(), content)]);
        assert!(!a.records().contains_key("p1.xlsx"));
    }

    #[tokio::test]
    async fn records_of_files_gone_from_both_sides_are_dropped() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.create("p0");
        a.create("p1");
        a.sync().await;
        // Deleted here by hand and on the remote by another PC: no file on either side.
        a.with(|s| s.delete_project("p1").unwrap());
        assert!(remote.remove("p1.xlsx"));
        assert!(a.records().contains_key("p1.xlsx"));
        let r = a.sync().await;
        assert_eq!(r.outcome, RunOutcome::Done);
        assert!(!a.records().contains_key("p1.xlsx"));
        // Deleting p0 too empties the local side of ordinary files; with the stale p1 record
        // gone this is not mistaken for a wiped folder.
        a.with(|s| s.delete_project("p0").unwrap());
        assert!(remote.remove("p0.xlsx"));
        assert_eq!(a.sync().await.outcome, RunOutcome::Done);
        assert_eq!(a.engine.status().suspect, None);
    }

    #[tokio::test]
    async fn apparent_conflict_with_equal_content_records_only() {
        // Etag-like versions: the plan cannot see that the contents are the same.
        let remote = Arc::new(MemoryBackend::new(|| dt(NOW)).opaque_versions());
        let a = Pc::new(&remote);
        a.add(INBOX, "同じ内容");
        a.create("p0");
        a.sync().await;
        let listed = |r: &MemoryBackend| {
            let mut v: Vec<String> = futures_names(r);
            v.sort();
            v
        };
        let remote_names = listed(&remote);
        // B starts with a byte copy of A's folder.
        let b = Pc::with_backend(remote.clone(), Some(&a.data));
        let r = b.sync().await;
        assert_eq!(r.outcome, RunOutcome::Done);
        assert!(r.conflicts.is_empty());
        assert_eq!(
            sorted(r.recorded),
            names(&["_PowerToDo.xlsx", "p0.xlsx", INBOX_FILE])
        );
        assert!(r.uploaded.is_empty() && r.downloaded.is_empty());
        assert!(!b.events().iter().any(|e| matches!(e, Event::Conflict(..))));
        assert!(
            fs::read_dir(&b.data)
                .unwrap()
                .all(|e| { !e.unwrap().file_name().to_string_lossy().contains("競合") })
        );
        assert_eq!(listed(&remote), remote_names);
        assert!(remote.archived().is_empty());
        assert!(idle(&b.sync().await));
    }

    /// Names in the remote root (`MemoryBackend::list` is ready at once).
    fn futures_names(r: &MemoryBackend) -> Vec<String> {
        let list = r.list();
        let out = futures_ready(list);
        out.unwrap().into_iter().map(|f| f.name).collect()
    }

    /// Polls a future that is ready on the first poll.
    fn futures_ready<T>(mut f: BoxFut<'_, T>) -> Result<T, BackendError> {
        use std::task::{Context, Poll, Waker};
        let mut cx = Context::from_waker(Waker::noop());
        match f.as_mut().poll(&mut cx) {
            Poll::Ready(v) => v,
            Poll::Pending => panic!("not ready"),
        }
    }

    /// Removes every file of the data folder (an emptied or unmounted folder) and opens it
    /// again, which recreates the inbox and the common workbook.
    fn wipe_local(pc: &Pc) {
        *pc.host.store.lock().unwrap() = None;
        for e in fs::read_dir(&pc.data).unwrap() {
            let p = e.unwrap().path();
            if p.is_file() {
                fs::remove_file(p).unwrap();
            }
        }
        *pc.host.store.lock().unwrap() = Some(open_store(&pc.data));
    }

    #[tokio::test]
    async fn suspect_stops_and_mirror_remote_recovers() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.add(INBOX, "受信のタスク");
        a.create("p0");
        a.create("p1");
        a.add("p1", "大事なタスク");
        a.sync().await;
        let remote_before: Vec<(String, Vec<u8>)> = futures_names(&remote)
            .into_iter()
            .map(|n| {
                let bytes = remote.get(&n).unwrap();
                (n, bytes)
            })
            .collect();

        wipe_local(&a);
        let fresh_inbox = a.file(INBOX_FILE);
        let r = a.sync().await;
        assert_eq!(r.outcome, RunOutcome::Suspect(Side::Local));
        assert!(idle(&r));
        let status = a.engine.status();
        assert_eq!(status.state, SyncPhase::Error);
        assert_eq!(
            status.message.as_deref(),
            Some("この PC のデータフォルダが空に見えるため同期を止めました")
        );
        assert_eq!(status.suspect, Some(Side::Local));
        // Neither side was touched; the next run stops the same way.
        let remote_now: Vec<(String, Vec<u8>)> = futures_names(&remote)
            .into_iter()
            .map(|n| {
                let bytes = remote.get(&n).unwrap();
                (n, bytes)
            })
            .collect();
        assert_eq!(remote_now, remote_before);
        assert!(remote.archived().is_empty());
        assert!(!a.has("p1.xlsx"));
        assert_eq!(a.sync().await.outcome, RunOutcome::Suspect(Side::Local));

        // The user chooses to take everything from the remote.
        let r = a.mirror(PlanMode::MirrorRemote).await;
        assert_eq!(r.outcome, RunOutcome::Done, "{r:?}");
        assert_eq!(
            sorted(r.downloaded),
            names(&["_PowerToDo.xlsx", "p0.xlsx", "p1.xlsx", INBOX_FILE])
        );
        for (name, bytes) in &remote_before {
            assert_eq!(&a.file(name), bytes, "{name}");
        }
        assert_eq!(a.titles("p1"), ["大事なタスク"]);
        assert_eq!(a.titles(INBOX), ["受信のタスク"]);
        // The replaced local files (the recreated, differing inbox and common) were kept.
        assert_eq!(
            a.archive_names(),
            names(&[
                "_PowerToDo (同期前 2026-10-16 0930).xlsx",
                "受信トレイ (同期前 2026-10-16 0930).xlsx"
            ])
        );
        assert_eq!(
            fs::read(
                a.data
                    .join("archive/受信トレイ (同期前 2026-10-16 0930).xlsx")
            )
            .unwrap(),
            fresh_inbox
        );
        let status = a.engine.status();
        assert_eq!(status.state, SyncPhase::Synced);
        assert_eq!(status.suspect, None);
        // The remote was not touched by the mirror.
        assert!(remote.archived().is_empty());
        assert!(idle(&a.sync().await));
    }

    #[tokio::test]
    async fn suspect_remote_is_reported() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.create("p0");
        a.sync().await;
        for n in futures_names(&remote) {
            remote.remove(&n);
        }
        let r = a.sync().await;
        assert_eq!(r.outcome, RunOutcome::Suspect(Side::Remote));
        let status = a.engine.status();
        assert_eq!(
            status.message.as_deref(),
            Some("同期先が空に見えるため同期を止めました")
        );
        assert_eq!(status.suspect, Some(Side::Remote));
        assert!(futures_names(&remote).is_empty());
        // The user puts this folder back on the remote.
        let r = a.mirror(PlanMode::MirrorLocal).await;
        assert_eq!(r.uploaded.len(), 3);
        assert_eq!(remote.get("p0.xlsx").unwrap(), a.file("p0.xlsx"));
        assert!(idle(&a.sync().await));
    }

    #[tokio::test]
    async fn mirror_local_keeps_overwritten_remote_in_archive() {
        let remote = Arc::new(MemoryBackend::new(|| dt(NOW)).opaque_versions());
        let a = Pc::new(&remote);
        a.create("p0");
        a.add("p0", "Aの内容");
        a.sync().await;
        let other = a.file(INBOX_FILE);
        // Another PC replaced p0 and added a file of its own.
        remote.put("p0.xlsx", &other);
        remote.put("extra.xlsx", b"extra");
        let local_before = a.file("p0.xlsx");

        let r = a.mirror(PlanMode::MirrorLocal).await;
        assert_eq!(r.outcome, RunOutcome::Done);
        assert_eq!(r.uploaded, ["p0.xlsx"]);
        assert_eq!(r.archived_remote, ["extra.xlsx"]);
        assert_eq!(sorted(r.recorded), names(&["_PowerToDo.xlsx", INBOX_FILE]));
        let mut archived = remote.archived();
        archived.sort();
        assert_eq!(
            archived,
            [
                ("extra.xlsx".to_string(), b"extra".to_vec()),
                ("p0.xlsx".to_string(), other)
            ]
        );
        assert_eq!(remote.get("p0.xlsx").unwrap(), local_before);
        assert!(remote.get("extra.xlsx").is_none());
        // The local folder was not touched.
        assert_eq!(a.file("p0.xlsx"), local_before);
        assert!(a.archive_names().is_empty());
        assert!(!a.records().contains_key("extra.xlsx"));
        assert!(idle(&a.sync().await));
    }

    #[tokio::test]
    async fn records_rebuilt_after_mirror() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.create("p0");
        a.create("p1");
        a.sync().await;
        // Records that no longer describe anything: a wrong hash, a missing file, one gone.
        let mut state = SyncState::load(&a.app, &a.data, BackendKind::Nas, ROOT);
        state.files.get_mut("p0.xlsx").unwrap().local_hash = "wrong".into();
        state.files.remove("p1.xlsx");
        let any = state.files.values().next().unwrap().clone();
        state.files.insert("old.xlsx".into(), any);
        state.save(&a.app).unwrap();

        let r = a.mirror(PlanMode::MirrorLocal).await;
        assert_eq!(r.outcome, RunOutcome::Done);
        let records = a.records();
        assert_eq!(
            records.keys().cloned().collect::<Vec<_>>(),
            names(&["_PowerToDo.xlsx", "p0.xlsx", "p1.xlsx", INBOX_FILE])
        );
        for (name, rec) in &records {
            assert_eq!(rec.local_hash, sha256_hex(&a.file(name)), "{name}");
        }
        assert!(idle(&a.sync().await));
    }

    #[tokio::test]
    async fn name_clash_reports_error() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.create("p1");
        remote.put("P1.xlsx", &a.file("p1.xlsx"));
        let r = a.sync().await;
        assert_eq!(r.clashes, [names(&["P1.xlsx", "p1.xlsx"])]);
        // The other files still sync; the clashing ones are left alone.
        assert!(r.uploaded.contains(&INBOX_FILE.to_string()));
        assert!(remote.get("p1.xlsx").is_none());
        assert!(!a.records().contains_key("p1.xlsx"));
        let status = a.engine.status();
        assert_eq!(status.state, SyncPhase::Error);
        let message = status.message.unwrap();
        assert!(
            message.contains("P1.xlsx") && message.contains("p1.xlsx"),
            "{message}"
        );
        assert!(message.contains("大文字・小文字") && message.contains("見えない文字"));
        assert_eq!(status.pending, 2);
    }

    #[tokio::test]
    async fn no_target_or_no_data_folder_is_off() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = SyncEngine::with_clock(tmp.path().to_path_buf(), || dt(NOW));
        let host = Host::default();
        assert_eq!(engine.status().state, SyncPhase::Off);
        assert!(!engine.request(SyncReason::SyncNow));
        assert_eq!(engine.run_once(&host).await.outcome, RunOutcome::NotRun);
        engine.set_backend(Some(backend()), BackendKind::Nas, ROOT);
        // No data folder open yet.
        assert_eq!(engine.run_once(&host).await.outcome, RunOutcome::NotRun);
        let status = engine.status();
        assert_eq!(status.state, SyncPhase::Off);
        assert!(status.message.is_some());
        engine.set_backend(None, BackendKind::Nas, ROOT);
        assert_eq!(engine.status().state, SyncPhase::Off);
        assert!(!engine.request(SyncReason::SyncNow));
    }

    #[tokio::test]
    async fn reset_records_starts_over() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.create("p0");
        a.sync().await;
        assert!(!a.records().is_empty());
        assert!(a.engine.take_due(Instant::now()));
        a.engine.reset_records();
        assert!(a.records().is_empty());
        // It says so and asks for a run.
        assert_eq!(a.engine.status().state, SyncPhase::Syncing);
        assert_eq!(a.engine.status().last_synced, None);
        assert!(a.engine.take_due(Instant::now()));
        // Same content on both sides: only records again.
        let r = a.sync().await;
        assert_eq!(r.recorded.len(), 3);
        assert!(r.conflicts.is_empty());
    }

    #[tokio::test]
    async fn status_events_and_json_shape() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.sync().await;
        let statuses: Vec<SyncStatusView> = a
            .events()
            .into_iter()
            .filter_map(|e| match e {
                Event::Status(s) => Some(s),
                _ => None,
            })
            .collect();
        assert_eq!(statuses.first().unwrap().state, SyncPhase::Syncing);
        assert_eq!(statuses.last().unwrap().state, SyncPhase::Synced);
        let v = serde_json::to_value(a.engine.status()).unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "state": "synced", "lastSynced": NOW, "pending": 0 })
        );
        let v = serde_json::to_value(SyncStatusView {
            state: SyncPhase::Error,
            last_synced: None,
            message: Some("m".into()),
            pending: 1,
            suspect: Some(Side::Remote),
            auth_rejected: false,
        })
        .unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "state": "error", "message": "m", "pending": 1, "suspect": "remote" })
        );
    }

    #[tokio::test(start_paused = true)]
    async fn requests_after_saves_wait_and_join_into_one_run() {
        let tmp = tempfile::tempdir().unwrap();
        let e = SyncEngine::with_clock(tmp.path().to_path_buf(), || dt(NOW));
        e.set_backend(Some(backend()), BackendKind::Nas, ROOT);
        // Setting the target asks for a run.
        assert!(e.take_due(Instant::now()));
        assert!(!e.take_due(Instant::now()));
        assert!(e.request(SyncReason::AfterSave));
        assert!(!e.take_due(Instant::now()));
        tokio::time::advance(Duration::from_secs(3)).await;
        // Joins the pending one: still due 5 s after the first save.
        assert!(e.request(SyncReason::AfterSave));
        tokio::time::advance(Duration::from_secs(2)).await;
        assert!(e.take_due(Instant::now()));
        assert!(!e.take_due(Instant::now() + INTERVAL));
        // An immediate request moves a delayed one forward; both are one run.
        e.request(SyncReason::AfterSave);
        e.request(SyncReason::SyncNow);
        assert!(e.take_due(Instant::now()));
        assert!(!e.take_due(Instant::now() + INTERVAL));
    }

    #[tokio::test]
    async fn a_request_during_a_run_gives_one_more_run() {
        let remote = backend();
        let hooked = Hooked::new(&remote);
        let a = Pc::with_backend(hooked.clone(), None);
        assert!(a.engine.take_due(Instant::now()));
        let engine = a.engine.clone();
        hooked.on_list(move || {
            engine.request(SyncReason::AfterSave);
            engine.request(SyncReason::SyncNow);
            engine.request(SyncReason::Interval);
        });
        a.sync().await;
        assert!(a.engine.take_due(Instant::now()));
        assert!(!a.engine.take_due(Instant::now() + INTERVAL));
    }

    #[tokio::test(start_paused = true)]
    async fn the_loop_runs_at_start_after_a_save_and_every_five_minutes() {
        let remote = backend();
        let a = Pc::new(&remote);
        let host: Arc<dyn SyncHost> = a.host.clone();
        let task = tokio::spawn(a.engine.clone().run_loop(host));
        tokio::time::sleep(Duration::from_millis(10)).await;
        // The start-up run.
        assert_eq!(remote.get(INBOX_FILE).unwrap(), a.file(INBOX_FILE));

        a.add(INBOX, "保存した");
        assert!(a.engine.request(SyncReason::AfterSave));
        tokio::time::sleep(Duration::from_secs(4)).await;
        assert_ne!(remote.get(INBOX_FILE).unwrap(), a.file(INBOX_FILE));
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert_eq!(remote.get(INBOX_FILE).unwrap(), a.file(INBOX_FILE));

        // Nobody asks; the interval brings a remote file down.
        remote.put("p9.xlsx", &a.file(INBOX_FILE));
        tokio::time::sleep(INTERVAL - Duration::from_secs(10)).await;
        assert!(!a.has("p9.xlsx"));
        tokio::time::sleep(Duration::from_secs(10)).await;
        assert!(a.has("p9.xlsx"));
        assert!(a.with(|s| s.summaries().iter().any(|p| p.name == "p9")));
        task.abort();
    }

    #[tokio::test]
    async fn corrupt_download_changes_nothing() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.create("p0");
        a.add("p0", "大事");
        a.sync().await;
        let before = a.file("p0.xlsx");
        let record = a.records()["p0.xlsx"].clone();
        // Another PC (say, on a newer app version) sent something this one cannot read.
        remote.put("p0.xlsx", b"not a workbook");
        let r = a.sync().await;
        assert_eq!(
            r.failed,
            [(
                "p0.xlsx".to_string(),
                "「p0.xlsx」を同期先から読み込めません".to_string()
            )]
        );
        assert_eq!(a.file("p0.xlsx"), before);
        assert_eq!(a.records()["p0.xlsx"], record);
        assert_eq!(a.titles("p0"), ["大事"]);
        assert!(!a.with(|s| s.changed_on_disk("p0")));
        let status = a.engine.status();
        assert_eq!(status.state, SyncPhase::Error);
        assert_eq!(
            status.message.as_deref(),
            Some("「p0.xlsx」を同期先から読み込めません")
        );
        // No temp file is left behind.
        assert!(fs::read_dir(&a.data).unwrap().all(|e| {
            !e.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".powertodo-")
        }));
        // The next run tries again (nothing was recorded).
        assert_eq!(a.sync().await.failed.len(), 1);
    }

    #[tokio::test]
    async fn corrupt_remote_winner_makes_no_conflict_copy() {
        let remote = backend_at("2100-01-01T00:00:00");
        let a = Pc::new(&remote);
        a.create("p0");
        a.sync().await;
        a.add("p0", "ローカルの変更");
        let before = a.file("p0.xlsx");
        remote.put("p0.xlsx", b"not a workbook");
        let r = a.sync().await;
        assert!(r.conflicts.is_empty());
        assert_eq!(r.failed.len(), 1);
        assert_eq!(a.file("p0.xlsx"), before);
        assert!(
            fs::read_dir(&a.data)
                .unwrap()
                .all(|e| { !e.unwrap().file_name().to_string_lossy().contains("競合") })
        );
    }

    #[tokio::test]
    async fn concurrent_upload_becomes_a_conflict() {
        // The remote copy is the newer one.
        let remote = backend_at("2100-01-01T00:00:00");
        let (a, b) = two_pcs(&remote).await;
        b.add(INBOX, "Bの変更");
        let theirs = b.file(INBOX_FILE);
        a.add(INBOX, "Aの変更");
        let record = a.records()[INBOX_FILE].clone();
        a.engine.take_due(Instant::now());
        // B's upload lands between A's listing and A's upload.
        remote.race_upload(INBOX_FILE, &theirs);
        let r = a.sync().await;
        assert_eq!(r.deferred, [INBOX_FILE]);
        assert!(r.uploaded.is_empty());
        assert!(r.rerun);
        assert_eq!(remote.get(INBOX_FILE).unwrap(), theirs);
        assert_eq!(a.records()[INBOX_FILE], record);
        // The rerun was asked for, and it plans a conflict: both contents survive.
        assert!(a.engine.take_due(Instant::now()));
        let r = a.sync().await;
        let copy = "受信トレイ (競合 2026-10-16 0930).xlsx".to_string();
        assert_eq!(r.conflicts, [(INBOX_FILE.to_string(), copy.clone())]);
        assert_eq!(a.titles(INBOX), ["牛乳を買う", "Bの変更"]);
        assert_eq!(titles_in(&a.file(&copy)), ["牛乳を買う", "Aの変更"]);
        assert_eq!(remote.get(&copy).unwrap(), a.file(&copy));
    }

    #[tokio::test]
    async fn a_mirror_keeps_the_records_of_files_it_left_alone() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.create("p0");
        a.create("p1");
        a.sync().await;
        let record = a.records()["p1.xlsx"].clone();
        a.with(|s| s.add_task("p1", input("未保存")).unwrap());
        let r = a.mirror(PlanMode::MirrorLocal).await;
        assert_eq!(r.skipped, ["p1.xlsx"]);
        assert_eq!(a.records().get("p1.xlsx"), Some(&record));
    }

    #[tokio::test]
    async fn an_old_targets_failure_keeps_the_new_targets_status() {
        let old = backend();
        old.fail_list(Failure::Offline);
        let hooked = Hooked::new(&old);
        let a = Pc::with_backend(hooked.clone(), None);
        let engine = a.engine.clone();
        let new = backend();
        hooked.on_list(move || engine.set_backend(Some(new), BackendKind::Gdrive, "folder"));
        assert_eq!(a.sync().await.outcome, RunOutcome::Offline);
        assert_eq!(a.engine.status().state, SyncPhase::Syncing);
        assert!(!a.engine.auth_rejected());
    }

    #[tokio::test]
    async fn the_last_sync_time_is_shown_from_the_start() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.sync().await;
        let again = SyncEngine::with_clock(a.app.clone(), || dt(NOW));
        again.set_backend(Some(remote.clone()), BackendKind::Nas, ROOT);
        assert_eq!(again.status().last_synced.as_deref(), Some(NOW));
        let other = SyncEngine::with_clock(a.app.clone(), || dt(NOW));
        other.set_backend(Some(remote.clone()), BackendKind::Nas, "http://other/");
        assert_eq!(other.status().last_synced, None);
    }

    #[tokio::test]
    async fn a_workbook_that_failed_to_load_is_not_uploaded_but_can_be_repaired() {
        let remote = backend();
        let (a, b) = two_pcs(&remote).await;
        let good = remote.get("仕事.xlsx").unwrap();
        // A's copy breaks; the store keeps it as failed to load.
        fs::write(a.data.join("仕事.xlsx"), b"broken").unwrap();
        *a.host.store.lock().unwrap() = Some(open_store(&a.data));
        assert!(a.with(|s| s.load_failed("仕事")));
        let r = a.sync().await;
        assert!(r.uploaded.is_empty());
        assert_eq!(r.failed.len(), 1);
        assert!(r.failed[0].1.contains("読み込めていない"), "{r:?}");
        assert_eq!(remote.get("仕事.xlsx").unwrap(), good);
        // B changes it; A takes B's version (its broken file is kept as a copy).
        b.add("仕事", "Bの変更");
        b.sync().await;
        let r = a.sync().await;
        assert_eq!(r.conflicts.len(), 1, "{r:?}");
        assert!(!a.with(|s| s.load_failed("仕事")));
        assert_eq!(a.titles("仕事"), ["資料を作る", "Bの変更"]);
        assert_eq!(a.file(&r.conflicts[0].1), b"broken");
    }

    #[test]
    fn has_target_follows_set_backend() {
        let tmp = tempfile::tempdir().unwrap();
        let e = SyncEngine::with_clock(tmp.path().to_path_buf(), || dt(NOW));
        assert!(!e.has_target());
        e.set_backend(Some(backend()), BackendKind::Nas, ROOT);
        assert!(e.has_target());
        e.set_backend(None, BackendKind::Nas, ROOT);
        assert!(!e.has_target());
    }

    #[test]
    fn unreachable_target_shows_offline_without_a_target() {
        let tmp = tempfile::tempdir().unwrap();
        let e = SyncEngine::with_clock(tmp.path().to_path_buf(), || dt(NOW));
        let host: Arc<Host> = Arc::new(Host::default());
        e.lock().host = Some(host.clone());
        e.set_offline("NAS が tailnet にありません");
        let s = e.status();
        assert_eq!(s.state, SyncPhase::Offline);
        assert_eq!(s.message.as_deref(), Some("NAS が tailnet にありません"));
        assert_eq!(s.pending, 0);
        // Told to the UI, and no run is asked for (there is nothing to run against).
        assert!(matches!(
            host.events.lock().unwrap().last(),
            Some(Event::Status(v)) if v.state == SyncPhase::Offline
        ));
        assert!(!e.request(SyncReason::SyncNow));
        // Removing the target afterwards still reads as off.
        e.set_backend(None, BackendKind::Nas, ROOT);
        assert_eq!(e.status().state, SyncPhase::Off);
    }

    #[test]
    fn a_known_refusal_is_shown_without_a_target() {
        let tmp = tempfile::tempdir().unwrap();
        let e = SyncEngine::with_clock(tmp.path().to_path_buf(), || dt(NOW));
        let host: Arc<Host> = Arc::new(Host::default());
        e.lock().host = Some(host.clone());
        e.show_rejected(BackendKind::Nas);
        let s = e.status();
        assert_eq!(s.state, SyncPhase::Error);
        assert!(s.auth_rejected);
        assert_eq!(
            s.message.as_deref(),
            Some(auth_failed_message(BackendKind::Nas))
        );
        assert!(matches!(
            host.events.lock().unwrap().last(),
            Some(Event::Status(v)) if v.auth_rejected
        ));
        // A target attached meanwhile owns the status.
        e.set_backend(Some(backend()), BackendKind::Nas, ROOT);
        let before = e.status();
        e.show_rejected(BackendKind::Nas);
        assert_eq!(e.status(), before);
    }

    #[test]
    fn unreachable_target_does_not_overwrite_the_status_of_a_target() {
        let tmp = tempfile::tempdir().unwrap();
        let e = SyncEngine::with_clock(tmp.path().to_path_buf(), || dt(NOW));
        let host: Arc<Host> = Arc::new(Host::default());
        e.lock().host = Some(host.clone());
        // A backend attached meanwhile (the status says syncing): a late "offline" is ignored.
        e.set_backend(Some(backend()), BackendKind::Nas, ROOT);
        let before = e.status();
        let events = host.events.lock().unwrap().len();
        e.set_offline("x");
        assert!(e.has_target());
        assert_eq!(e.status(), before);
        assert_eq!(host.events.lock().unwrap().len(), events);
    }

    #[tokio::test]
    async fn a_confirmed_mirror_runs_only_for_the_situation_that_was_flagged() {
        let remote = backend();
        let a = Pc::new(&remote);
        a.create("p1");
        a.add("p1", "大事なタスク");
        a.sync().await;
        wipe_local(&a);
        assert_eq!(a.sync().await.outcome, RunOutcome::Suspect(Side::Local));
        let (has_target, status, generation) = a.engine.snapshot();
        assert!(has_target);
        assert_eq!(status.suspect, Some(Side::Local));

        // The user changes the target before the confirmed recovery starts.
        a.engine
            .set_backend(Some(backend()), BackendKind::Nas, "http://other/");
        let before = a.engine.status();
        let r = a
            .engine
            .run_mirror_confirmed(a.host.as_ref(), PlanMode::MirrorRemote, generation)
            .await;
        assert_eq!(r.outcome, RunOutcome::NotRun);
        assert!(idle(&r));
        // Nothing ran and the status was not touched.
        assert_eq!(a.engine.status(), before);
        assert!(!a.has("p1.xlsx"));

        // Back on the first remote: flagged again, confirmed against what the user saw.
        a.engine
            .set_backend(Some(remote.clone()), BackendKind::Nas, ROOT);
        assert_eq!(a.sync().await.outcome, RunOutcome::Suspect(Side::Local));
        let (_, status, generation) = a.engine.snapshot();
        assert!(status.suspect.is_some());
        let r = a
            .engine
            .run_mirror_confirmed(a.host.as_ref(), PlanMode::MirrorRemote, generation)
            .await;
        assert_eq!(r.outcome, RunOutcome::Done, "{r:?}");
        assert!(a.has("p1.xlsx"));

        // A mirror needs the stopped state it was confirmed for: not stopped any more, no run.
        let (_, status, generation) = a.engine.snapshot();
        assert_eq!(status.suspect, None);
        let r = a
            .engine
            .run_mirror_confirmed(a.host.as_ref(), PlanMode::MirrorLocal, generation)
            .await;
        assert_eq!(r.outcome, RunOutcome::NotRun);
    }

    /// A remote that finds its root folder by searching (like Google Drive): it reports which
    /// root it listed, and can be pointed at another one.
    struct Rooted {
        current: Mutex<(String, Arc<MemoryBackend>)>,
    }

    impl Rooted {
        fn new(id: &str, inner: &Arc<MemoryBackend>) -> Arc<Rooted> {
            Arc::new(Rooted {
                current: Mutex::new((id.to_string(), inner.clone())),
            })
        }
        fn switch(&self, id: &str, inner: &Arc<MemoryBackend>) {
            *self.current.lock().unwrap() = (id.to_string(), inner.clone());
        }
        fn inner(&self) -> Arc<MemoryBackend> {
            self.current.lock().unwrap().1.clone()
        }
    }

    impl StorageBackend for Rooted {
        fn list(&self) -> BoxFut<'_, Vec<RemoteFile>> {
            let inner = self.inner();
            Box::pin(async move { inner.list().await })
        }
        fn download<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, Vec<u8>> {
            let inner = self.inner();
            Box::pin(async move { inner.download(file).await })
        }
        fn upload<'a>(
            &'a self,
            name: &'a str,
            existing: Option<&'a RemoteFile>,
            bytes: Vec<u8>,
        ) -> BoxFut<'a, RemoteFile> {
            let inner = self.inner();
            Box::pin(async move { inner.upload(name, existing, bytes).await })
        }
        fn move_to_archive<'a>(&'a self, file: &'a RemoteFile) -> BoxFut<'a, ()> {
            let inner = self.inner();
            Box::pin(async move { inner.move_to_archive(file).await })
        }
        fn root_identity(&self) -> Option<String> {
            Some(self.current.lock().unwrap().0.clone())
        }
    }

    fn saved_state(pc: &Pc) -> SyncState {
        SyncState::load(&pc.app, &pc.data, BackendKind::Nas, ROOT)
    }

    #[tokio::test]
    async fn a_new_root_folder_compares_by_content_instead_of_by_records() {
        // A and B did their first sync at the same moment and each made a root folder. A's
        // wins from now on; B's first files went into the losing one.
        let root_a = backend();
        let root_b = backend();
        let a = Pc::with_backend(Rooted::new("root-a", &root_a), None);
        a.add(INBOX, "Aのタスク");
        assert_eq!(a.sync().await.outcome, RunOutcome::Done);
        let b_side = Rooted::new("root-b", &root_b);
        let b = Pc::with_backend(b_side.clone(), None);
        b.add(INBOX, "Bのタスク");
        b.create("Bの仕事");
        b.add("Bの仕事", "Bだけの予定");
        let r = b.sync().await;
        assert_eq!(r.uploaded.len(), 3, "{r:?}");
        assert_eq!(saved_state(&b).remote_root_id.as_deref(), Some("root-b"));

        b_side.switch("root-a", &root_a);
        let r = b.sync().await;
        assert_eq!(r.outcome, RunOutcome::Done, "{r:?}");
        // B's own project is not taken for deleted by the other PC: it goes up.
        assert!(r.archived_local.is_empty(), "{r:?}");
        assert!(b.has("Bの仕事.xlsx"));
        assert!(r.uploaded.contains(&"Bの仕事.xlsx".to_string()), "{r:?}");
        assert_eq!(root_a.get("Bの仕事.xlsx").unwrap(), b.file("Bの仕事.xlsx"));
        // B's inbox is not silently replaced: the remote one wins, B's stays as a copy.
        let copy = "受信トレイ (競合 2026-10-16 0930).xlsx";
        assert!(
            r.conflicts
                .contains(&(INBOX_FILE.to_string(), copy.to_string())),
            "{r:?}"
        );
        assert_eq!(b.titles(INBOX), ["Aのタスク"]);
        assert_eq!(titles_in(&b.file(copy)), ["Bのタスク"]);
        assert_eq!(saved_state(&b).remote_root_id.as_deref(), Some("root-a"));
        // From now on the records are about root-a: the files B uploaded meanwhile stay
        // put, and A does not lose its own.
        let r = b.sync().await;
        assert!(
            r.archived_local.is_empty() && r.conflicts.is_empty(),
            "{r:?}"
        );
        let r = a.sync().await;
        assert!(
            r.archived_local.is_empty() && r.conflicts.is_empty(),
            "{r:?}"
        );
        assert!(a.has("Bの仕事.xlsx"));
    }

    #[tokio::test]
    async fn the_first_run_only_stores_the_root_folder() {
        let remote = backend();
        let side = Rooted::new("root-a", &remote);
        let a = Pc::with_backend(side, None);
        a.create("p0");
        let r = a.sync().await;
        assert_eq!(r.outcome, RunOutcome::Done);
        assert_eq!(r.uploaded.len(), 3);
        let state = saved_state(&a);
        assert_eq!(state.remote_root_id.as_deref(), Some("root-a"));
        assert_eq!(state.files.len(), 3);
        assert!(idle(&a.sync().await));
    }

    #[tokio::test]
    async fn records_without_a_known_root_folder_are_not_trusted() {
        // Records saved before the root folder was noted (or by a backend that did not say):
        // nothing is archived on their word, everything is compared by content.
        let remote = backend();
        let a = Pc::new(&remote);
        a.create("p0");
        a.create("p1");
        a.sync().await;
        assert_eq!(saved_state(&a).remote_root_id, None);
        assert!(remote.remove("p1.xlsx"));
        a.engine
            .set_backend(Some(Rooted::new("root-a", &remote)), BackendKind::Nas, ROOT);
        let r = a.sync().await;
        assert_eq!(r.outcome, RunOutcome::Done, "{r:?}");
        assert!(r.archived_local.is_empty(), "{r:?}");
        assert_eq!(r.uploaded, ["p1.xlsx"]);
        assert_eq!(saved_state(&a).remote_root_id.as_deref(), Some("root-a"));
    }

    #[tokio::test]
    async fn an_emptied_root_folder_that_stayed_the_same_is_still_suspect() {
        let remote = backend();
        let a = Pc::with_backend(Rooted::new("root-a", &remote), None);
        a.create("p0");
        a.sync().await;
        for n in futures_names(&remote) {
            remote.remove(&n);
        }
        let r = a.sync().await;
        assert_eq!(r.outcome, RunOutcome::Suspect(Side::Remote));
        assert!(idle(&r));
        assert!(a.has("p0.xlsx"));
        assert_eq!(saved_state(&a).files.len(), 3);
    }

    /// The lock files an office suite leaves next to an open `name`, with the app the status
    /// names: Excel's owner file (the whole name, or with the first two characters replaced
    /// for a longer name) and LibreOffice's.
    fn lock_files(name: &str) -> Vec<(String, &'static str)> {
        let rest: String = name.chars().skip(2).collect();
        vec![
            (format!("~${name}"), "Excel"),
            (format!("~${rest}"), "Excel"),
            (format!(".~lock.{name}#"), "LibreOffice"),
        ]
    }

    fn open_in(pc: &Pc, lock: &str) {
        fs::write(pc.data.join(lock), b"owner").unwrap();
    }

    fn assert_open_notice(pc: &Pc, name: &str, app: &str) {
        let status = pc.engine.status();
        // Not an error: the file waits for the app to close it.
        assert_eq!(status.state, SyncPhase::Synced, "{status:?}");
        assert_eq!(
            status.message.as_deref(),
            Some(format!("「{name}」が {app} で開かれているため、閉じてから同期します").as_str())
        );
        assert!(status.pending >= 1);
    }

    #[tokio::test]
    async fn a_download_waits_while_the_workbook_is_open() {
        const LONG: &str = "週次ミーティング資料";
        let file = format!("{LONG}.xlsx");
        for (lock, app) in lock_files(&file) {
            let remote = backend();
            let a = Pc::new(&remote);
            a.create(LONG);
            a.sync().await;
            let b = Pc::new(&remote);
            b.sync().await;
            a.add(LONG, "Aの変更");
            a.sync().await;
            let before = b.file(&file);
            open_in(&b, &lock);
            let r = b.sync().await;
            assert_eq!(r.deferred, [file.clone()], "{lock}: {r:?}");
            assert!(r.downloaded.is_empty() && r.conflicts.is_empty(), "{lock}");
            assert_eq!(b.file(&file), before, "{lock}");
            assert_open_notice(&b, &file, app);
            // Closed: the next run brings it down.
            fs::remove_file(b.data.join(&lock)).unwrap();
            assert_eq!(b.sync().await.downloaded, [file.clone()], "{lock}");
            assert_eq!(b.titles(LONG), ["Aの変更"]);
            assert_eq!(b.engine.status().message, None);
        }
    }

    #[tokio::test]
    async fn an_archive_after_a_remote_delete_waits_while_the_workbook_is_open() {
        for (lock, app) in lock_files("p1.xlsx") {
            let remote = backend();
            let a = Pc::new(&remote);
            a.create("p0");
            a.create("p1");
            a.sync().await;
            assert!(remote.remove("p1.xlsx"));
            open_in(&a, &lock);
            let r = a.sync().await;
            assert_eq!(r.deferred, ["p1.xlsx"], "{lock}: {r:?}");
            assert!(r.archived_local.is_empty(), "{lock}");
            assert!(a.has("p1.xlsx"), "{lock}");
            assert!(a.records().contains_key("p1.xlsx"), "{lock}");
            assert_open_notice(&a, "p1.xlsx", app);
        }
    }

    #[tokio::test]
    async fn a_conflict_that_replaces_the_local_side_waits_while_the_workbook_is_open() {
        for (lock, app) in lock_files(INBOX_FILE) {
            let remote = backend_at("2100-01-01T00:00:00");
            let (a, b) = two_pcs(&remote).await;
            a.add(INBOX, "Aの変更");
            b.add(INBOX, "Bの変更");
            a.sync().await;
            open_in(&b, &lock);
            let before = b.file(INBOX_FILE);
            let r = b.sync().await;
            assert_eq!(r.deferred, [INBOX_FILE], "{lock}: {r:?}");
            assert!(r.conflicts.is_empty(), "{lock}");
            assert_eq!(b.file(INBOX_FILE), before, "{lock}");
            assert!(conflict_events(&b).is_empty(), "{lock}");
            assert_open_notice(&b, INBOX_FILE, app);
        }
    }

    #[tokio::test]
    async fn a_mirror_waits_for_an_open_workbook() {
        for (lock, app) in lock_files(INBOX_FILE) {
            let remote = backend();
            let a = Pc::new(&remote);
            a.add(INBOX, "受信のタスク");
            a.create("p0");
            a.sync().await;
            wipe_local(&a);
            assert_eq!(a.sync().await.outcome, RunOutcome::Suspect(Side::Local));
            open_in(&a, &lock);
            let fresh = a.file(INBOX_FILE);
            let r = a.mirror(PlanMode::MirrorRemote).await;
            assert_eq!(r.deferred, [INBOX_FILE], "{lock}: {r:?}");
            assert_eq!(a.file(INBOX_FILE), fresh, "{lock}");
            assert!(a.has("p0.xlsx"), "{lock}");
            assert_open_notice(&a, INBOX_FILE, app);
        }
    }

    #[tokio::test]
    async fn another_workbooks_lock_file_does_not_hold_a_download_back() {
        let remote = backend();
        let (a, b) = two_pcs(&remote).await;
        a.add("仕事", "追加");
        a.sync().await;
        // Open: an unrelated workbook, and a file whose name only ends like this one.
        open_in(&b, "~$見積.xlsx");
        open_in(&b, ".~lock.他の仕事.xlsx#");
        let r = b.sync().await;
        assert_eq!(r.downloaded, ["仕事.xlsx"], "{r:?}");
        assert!(r.deferred.is_empty());
        assert_eq!(b.engine.status().message, None);
    }
}
