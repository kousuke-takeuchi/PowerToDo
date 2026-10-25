//! Tauri commands. They are thin: lock the store, call one `ProjectStore` method, mark what
//! changed for the debounced [`Saver`], and return the new view. The few non-trivial bits
//! (start-up, quick add) live in plain functions so they can be tested without Tauri.

pub mod autostart;
pub mod saver;
pub mod sync;
pub mod update;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use chrono::{Local, NaiveDate, NaiveDateTime, NaiveTime};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::{NotificationExt, PermissionState};

use crate::domain::model::{INBOX, TaskInput, TaskPatch};
use crate::domain::quick_add::{QuickAddResult, parse};
use crate::domain::recurrence;
use crate::domain::recurrence_words;
use crate::domain::reminders;
use crate::domain::search;
use crate::domain::search::Hit;
use crate::domain::views::{self, DayGroup};
use crate::domain::{Label, Task};
use crate::error::{AppError, AppResult};
use crate::platform;
use crate::store::common_book::Settings;
use crate::store::external::{FileKind, Verdict, classify_path, fingerprint, verdict};
use crate::store::fired::{Fired, ReminderItem, ReminderKey};
use crate::store::paths::{AppSettings, Paths};
use crate::store::project_store::{ProjectStore, ProjectSummary, ProjectView};
#[cfg(desktop)]
use crate::store::watcher;
use crate::store::watcher::Watcher;
use crate::sync::state::SyncState;
use crate::sync::{SyncEngine, SyncHost, SyncReason, SyncStatusView};

use saver::{COMMON_KEY, SaveSink, SaveStatus, Saver};

// ---- state and DTOs ----

pub struct AppState {
    /// `None` until a data folder has been chosen (or when the saved one is missing).
    pub store: Mutex<Option<ProjectStore>>,
    pub app_settings: Mutex<AppSettings>,
    pub saver: Saver,
    /// Watches the data folder; replaced whenever the folder changes.
    pub watcher: Mutex<Option<Watcher>>,
    /// Keys (project name or `COMMON_KEY`) whose write is in flight. Set before the store lock
    /// is taken, so a watcher batch that gets the lock first still sees "a save is coming".
    pub saving: Mutex<BTreeSet<String>>,
    /// Why watching the data folder could not start (仕様 §7), `None` while it runs. Kept here
    /// because the failure happens in `app_state` / `set_data_dir`, before the main screen
    /// listens for `watch-failed`; the screen reads it from `AppStateDto::watch_error`.
    pub watch_error: Mutex<Option<String>>,
    /// Why the tray icon could not be created (set once at start), `None` while it exists. The
    /// settings pane notes it; with no tray, closing the window must not hide it.
    pub tray_error: Mutex<Option<String>>,
    /// `fired.json` (仕様 §4.3): reminders already fired, snoozes, and the ones the UI has not
    /// taken yet. Loaded once at start; written by the scheduler and the reminder commands.
    pub fired: Mutex<Fired>,
    /// The sync with the NAS / Google Drive (Phase 4). Off until a target is set.
    pub sync: SyncEngine,
    /// The NAS side of the sync: the Tailscale sidecar, the keychain, the connection details.
    pub sync_rt: sync::SyncRuntime,
    /// The new version `update_check` found, for `update_install` (see `update`). A leaf lock.
    #[cfg(desktop)]
    pub update_slot: update::UpdateSlot<tauri_plugin_updater::Update>,
    app_data_dir: PathBuf,
}

// Lock order (never the reverse): `store`, then `saver.pending`. The watcher thread holds the
// store lock while it asks the saver about / cancels a pending save; `TauriSink::save` runs in
// a saver task that is not holding `pending` when it takes the store lock. `saving` and
// `app_settings` are leaf locks (nothing is acquired while holding them).
//
// `fired` is a leaf lock too, and is never held together with `store`: the scheduler copies
// the tasks and settings under the store lock, releases it, then takes `fired`; the task
// commands take `fired` only after their mutation released the store. Notifications are sent
// and events emitted with neither lock held.
//
// `sync_state` (the sync engine's own lock, `SyncEngine`) is a leaf as well: the engine takes
// the store lock (and `saving` under it) only while not holding its own, and never holds the
// store lock across network I/O. Order: store, then saver / fired / sync_state.

impl AppState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self::with_saver(app_data_dir, Saver::new())
    }

    pub fn with_saver(app_data_dir: PathBuf, saver: Saver) -> Self {
        AppState {
            store: Mutex::new(None),
            app_settings: Mutex::new(AppSettings::default()),
            saver,
            watcher: Mutex::new(None),
            saving: Mutex::new(BTreeSet::new()),
            watch_error: Mutex::new(None),
            tray_error: Mutex::new(None),
            fired: Mutex::new(Fired::load(&app_data_dir)),
            sync: SyncEngine::new(app_data_dir.clone()),
            sync_rt: sync::SyncRuntime::new(),
            #[cfg(desktop)]
            update_slot: update::UpdateSlot::default(),
            app_data_dir,
        }
    }

    pub(crate) fn lock_fired(&self) -> MutexGuard<'_, Fired> {
        self.fired.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Where `settings.json` and `fired.json` live.
    pub(crate) fn app_data_dir(&self) -> &Path {
        &self.app_data_dir
    }

    /// What the scheduler needs, copied under the store lock (released on return): the tasks,
    /// the settings and the data folder. `None` while no data folder is open.
    pub(crate) fn reminder_inputs(&self) -> Option<(Vec<Task>, Settings, PathBuf)> {
        self.lock_store()
            .as_ref()
            .map(|s| (s.all_tasks(), s.settings(), s.paths().data_dir.clone()))
    }

    /// The open data folder (store lock taken and released).
    pub(crate) fn current_data_dir(&self) -> Option<PathBuf> {
        self.lock_store()
            .as_ref()
            .map(|s| s.paths().data_dir.clone())
    }

    /// Ties `fired.json` to the open data folder, dropping another folder's records (see
    /// `Fired::bind`). Called after the store lock is released.
    fn bind_fired_to_store(&self) {
        if let Some(dir) = self.current_data_dir() {
            let mut fired = self.lock_fired();
            if fired.bind(&dir)
                && let Err(e) = fired.save(&self.app_data_dir)
            {
                eprintln!("could not write {}: {e}", Fired::FILE);
            }
        }
    }

    /// Changes `fired.json` and writes it. A failed write is logged: the in-memory record
    /// still holds for this run.
    fn update_fired(&self, f: impl FnOnce(&mut Fired)) {
        let mut fired = self.lock_fired();
        f(&mut fired);
        if let Err(e) = fired.save(&self.app_data_dir) {
            eprintln!("could not write {}: {e}", Fired::FILE);
        }
    }

    /// Lets the reminders of a task fire again (it changed, was completed or deleted).
    pub(crate) fn forget_fired(&self, project: &str, no: u32) {
        self.update_fired(|f| f.forget_task(project, no));
    }

    /// Fires `key` again at `until` (the notification's 「後で」 and `snooze_reminder`). The
    /// snooze is tied to the reminder's current fire time (store lock taken and released
    /// first), so it lapses when the due date moves (see `Fired::snooze_until`).
    pub(crate) fn snooze_fired(&self, key: &ReminderKey, until: NaiveDateTime) {
        let fire_at = self.lock_store().as_ref().and_then(|s| {
            let task = s
                .all_tasks()
                .into_iter()
                .find(|t| t.project == key.project && t.no == key.no)?;
            reminders::fire_time(&key.code, task.due, task.due_time, s.settings().notify_time)
        });
        let fire_at = Fired::snooze_binding(fire_at, now());
        self.update_fired(|f| f.snooze(key, fire_at, until));
    }

    /// The fired reminders the UI has not taken yet; they are removed.
    pub(crate) fn take_pending_reminders(&self) -> Vec<ReminderItem> {
        let mut items = Vec::new();
        self.update_fired(|f| items = f.take_pending());
        items
    }

    fn lock_store(&self) -> MutexGuard<'_, Option<ProjectStore>> {
        self.store.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn lock_settings(&self) -> MutexGuard<'_, AppSettings> {
        self.app_settings.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn lock_saving(&self) -> MutexGuard<'_, BTreeSet<String>> {
        self.saving.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// A write for `key` is in flight (see [`AppState::saving`]).
    pub fn is_saving(&self, key: &str) -> bool {
        self.lock_saving().contains(key)
    }

    /// Projects (and `COMMON_KEY`) that changed on disk while they had unsaved edits and wait
    /// for the user to choose. Empty when no data folder is open.
    pub fn held_projects(&self) -> Vec<String> {
        self.lock_store()
            .as_ref()
            .map(ProjectStore::held_projects)
            .unwrap_or_default()
    }

    /// The last failure to start watching the data folder (see [`AppState::watch_error`]).
    pub fn watch_error(&self) -> Option<String> {
        self.watch_error
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Why the tray icon could not be created (see [`AppState::tray_error`]).
    pub fn tray_error(&self) -> Option<String> {
        self.tray_error
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Whether closing the window hides it (the 「トレイに常駐」 setting). `true` while no data
    /// folder is open (the default setting). Always `false` when there is no tray to bring the
    /// window back from (`tray_error`), and on Linux regardless of the setting: stock GNOME has
    /// no tray host, so a hidden window could not be reached again (the settings pane says so).
    pub fn keep_in_tray(&self) -> bool {
        if cfg!(target_os = "linux") {
            return false;
        }
        let setting = self
            .lock_store()
            .as_ref()
            .map(|store| store.settings().keep_in_tray);
        resolve_keep_in_tray(self.tray_error().is_some(), setting)
    }

    /// Writes everything still dirty (used when the app quits). Held projects, and dirty ones
    /// whose file changed on disk, are not written to their own file: that would overwrite the
    /// external change the user has not decided about. Their in-memory workbook goes to a
    /// recovery copy in `archive/` instead (`ProjectStore::write_recovery_copy`), so quitting
    /// without the banner's choice (the Dock's Quit on macOS, a logout) loses no edits. One
    /// failed write (say, a file locked by Excel) does not stop the others; each failure is
    /// logged and returned as `(project name or COMMON_KEY, error)`. Empty means everything
    /// was saved.
    pub fn flush_all(&self) -> Vec<(String, AppError)> {
        self.saver.cancel_all();
        let mut guard = self.lock_store();
        let Some(store) = guard.as_mut() else {
            return Vec::new();
        };
        let at = now();
        let fallback = self.app_data_dir.join(RECOVERY_DIR);
        let mut recovered = BTreeSet::new();
        for key in store.unsavable_keys() {
            match store.write_recovery_copy(&key, at, &fallback) {
                Ok(path) => {
                    let place = if path.starts_with(&fallback) {
                        "the app data folder (archive/ was not writable)"
                    } else {
                        "archive/"
                    };
                    eprintln!(
                        "unsaved edits of {key} kept in {} ({place})",
                        path.display()
                    );
                    recovered.insert(key);
                }
                Err(e) => eprintln!("recovery copy failed for {key}: {e}"),
            }
        }
        let failures = flush(store, &recovered);
        for (name, e) in &failures {
            eprintln!("flush on exit failed for {name}: {e}");
        }
        failures
    }
}

fn changed_on_disk_error(key: &str) -> AppError {
    AppError::Unsaved {
        message: format!("「{key}」は他のアプリで変更されているため、書き込みませんでした"),
    }
}

/// Where `flush_all` writes a recovery copy when `archive/` cannot be written:
/// `<app_data_dir>/recovery/`.
const RECOVERY_DIR: &str = "recovery";

/// Tries to save the common workbook and every dirty project, continuing past failures.
/// Returns the failures as `(project name or COMMON_KEY, error)`. Keys in `recovered` already
/// have their edits in a recovery copy, so a changed-on-disk file among them is not reported
/// again.
fn flush(store: &mut ProjectStore, recovered: &BTreeSet<String>) -> Vec<(String, AppError)> {
    let mut failures = Vec::new();
    if store.common_dirty() && !store.is_held(COMMON_KEY) {
        if store.changed_on_disk(COMMON_KEY) {
            if !recovered.contains(COMMON_KEY) {
                failures.push((COMMON_KEY.to_string(), changed_on_disk_error(COMMON_KEY)));
            }
        } else if let Err(e) = store.save_common() {
            failures.push((COMMON_KEY.to_string(), e));
        }
    }
    for name in store.dirty_projects() {
        if store.is_held(&name) {
            continue;
        }
        // Someone saved the file since we read it and the watcher has not reported it yet:
        // writing now would overwrite their work. It stays dirty; the next watcher batch
        // holds it and the user chooses.
        if store.changed_on_disk(&name) {
            if !recovered.contains(&name) {
                failures.push((name.clone(), changed_on_disk_error(&name)));
            }
            continue;
        }
        if let Err(e) = store.save(&name) {
            failures.push((name, e));
        }
    }
    failures
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStateDto {
    pub data_dir: Option<String>,
    pub projects: Vec<ProjectSummary>,
    pub inbox: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
    /// Watching the data folder could not start (仕様 §7); the main screen shows it once.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub watch_error: Option<String>,
    /// The tray icon could not be created; the settings pane notes that closing quits.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tray_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAddOutcome {
    pub parsed: QuickAddResult,
    pub view: ProjectView,
    /// Number of the task just added (new numbers are above every existing one, so it is the highest in `view`).
    pub no: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct MoveOutcome {
    pub from: ProjectView,
    pub to: ProjectView,
}

/// `settings` / `update_settings`: the common workbook's settings plus the local data folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    pub display_name: String,
    pub week_start: String,
    /// Reminder code for tasks that get a time; `null` = none.
    pub default_reminder: Option<String>,
    /// `HH:MM`: when tasks without a time notify.
    pub notify_time: String,
    pub keep_in_tray: bool,
    pub notifications: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_dir: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeReason {
    Bulk,
    External,
    Move,
    /// Re-read after the sync downloaded the file (the UI updates quietly).
    Sync,
}

#[derive(Debug, Clone, Serialize)]
struct ProjectChanged {
    name: String,
    reason: ChangeReason,
}

/// `projects-changed`. `common_reloaded` says the common workbook was re-read from its file,
/// which is what clears an earlier `external-read-failed` for `_common` in the UI.
fn emit_projects_changed(app: &AppHandle, common_reloaded: bool) {
    let _ = app.emit(
        "projects-changed",
        serde_json::json!({ "commonReloaded": common_reloaded }),
    );
}

fn emit_changed(app: &AppHandle, names: &[String], reason: ChangeReason) {
    for name in names {
        let _ = app.emit(
            "project-changed",
            ProjectChanged {
                name: name.clone(),
                reason,
            },
        );
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingDto {
    pub days: Vec<DayGroup>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelViewDto {
    pub label: Label,
    pub tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelsDto {
    pub labels: Vec<Label>,
    pub counts: BTreeMap<String, u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelRenamed {
    pub label: Label,
    pub changed_projects: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedProjects {
    pub changed_projects: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDto {
    pub hits: Vec<Hit>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountsDto {
    pub today: u32,
    pub labels: BTreeMap<String, u32>,
}

/// `parse_recurrence`: the RRULE for a recurrence phrase (`null` when the text is not one) and
/// its short label (the RRULE itself when no short form exists).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceDto {
    pub rrule: Option<String>,
    pub label: Option<String>,
}

/// `summarize_recurrence`: the label for a stored RRULE, and whether the rule computes without
/// error (a finished COUNT / UNTIL rule is valid; only an unreadable one is not).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceLabelDto {
    pub label: String,
    pub valid: bool,
}

fn parse_ymd(s: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| AppError::Invalid {
        message: format!("日付の形式が不正です: {s}"),
    })
}

pub const MAX_UPCOMING_DAYS: u32 = 91;

fn check_days(days: u32) -> AppResult<u32> {
    if (1..=MAX_UPCOMING_DAYS).contains(&days) {
        Ok(days)
    } else {
        Err(AppError::Invalid {
            message: format!("days は 1〜{MAX_UPCOMING_DAYS} です"),
        })
    }
}

fn now() -> NaiveDateTime {
    Local::now().naive_local()
}

fn no_data_dir() -> AppError {
    AppError::Invalid {
        message: "データフォルダが設定されていません".into(),
    }
}

fn dir_string(store: &ProjectStore) -> String {
    store.paths().data_dir.to_string_lossy().into_owned()
}

/// The cfg-independent part of [`AppState::keep_in_tray`]: no tray beats the setting; no data
/// folder (`None`) means the default, which is on.
fn resolve_keep_in_tray(tray_failed: bool, setting: Option<bool>) -> bool {
    !tray_failed && setting.unwrap_or(true)
}

fn state_dto(store: Option<&ProjectStore>, warning: Option<String>) -> AppStateDto {
    AppStateDto {
        data_dir: store.map(dir_string),
        projects: store.map(ProjectStore::summaries).unwrap_or_default(),
        inbox: INBOX.to_string(),
        warning,
        watch_error: None,
        tray_error: None,
    }
}

// ---- saver glue ----

struct TauriSink {
    app: AppHandle,
}

/// Marks `key` as being written for as long as it lives (also when the write fails).
struct SavingGuard<'a> {
    state: &'a AppState,
    key: &'a str,
}

impl<'a> SavingGuard<'a> {
    fn new(state: &'a AppState, key: &'a str) -> Self {
        state.lock_saving().insert(key.to_string());
        SavingGuard { state, key }
    }
}

impl Drop for SavingGuard<'_> {
    fn drop(&mut self) {
        self.state.lock_saving().remove(self.key);
    }
}

impl SaveSink for TauriSink {
    fn save(&self, key: &str) -> AppResult<()> {
        let state = self.app.state::<AppState>();
        // Declared before the store lock is taken (and dropped after it is released).
        let _saving = SavingGuard::new(&state, key);
        let conflict = {
            let mut guard = state.lock_store();
            // The store can be gone or already clean (a flush, a rename, a data folder switch).
            let Some(store) = guard.as_mut() else {
                return Ok(());
            };
            // The file changed on disk while we had unsaved edits: wait for the user's choice.
            if store.is_held(key) {
                return Ok(());
            }
            let dirty = if key == COMMON_KEY {
                store.common_dirty()
            } else {
                store.dirty_projects().iter().any(|p| p == key)
            };
            if !dirty {
                return Ok(());
            }
            // An external save may have landed before the watcher reported it; never write
            // over it. Hold the key (the banner asks the user) instead.
            if store.changed_on_disk(key) {
                store.hold(key);
                true
            } else {
                if key == COMMON_KEY {
                    store.save_common()?;
                } else {
                    store.save(key)?;
                }
                false
            }
        };
        if conflict {
            let _ = self.app.emit(
                "external-change",
                ExternalChange {
                    project: key.to_string(),
                },
            );
        } else {
            // Written: send it to the sync target a little later (仕様 Phase 4 §3.4).
            state.sync.request(SyncReason::AfterSave);
        }
        Ok(())
    }

    fn report(&self, status: SaveStatus) {
        let _ = self.app.emit("save-status", status);
    }
}

impl Saver {
    /// Schedules a debounced save. Nothing is scheduled for a held project (its file changed
    /// on disk and the user has not chosen yet); `resolve_external_change` saves explicitly.
    pub fn schedule(&self, app: AppHandle, project: String) {
        let held = app
            .state::<AppState>()
            .lock_store()
            .as_ref()
            .is_some_and(|s| s.is_held(&project));
        if held {
            return;
        }
        self.schedule_with(Arc::new(TauriSink { app }), project);
    }

    pub fn schedule_common(&self, app: AppHandle) {
        self.schedule(app, COMMON_KEY.to_string());
    }
}

// ---- sync glue (Phase 4) ----

/// The sync engine's view of the app: the store, the saves in flight, and the events.
struct TauriSyncHost {
    app: AppHandle,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncConflict {
    file: String,
    conflict_file: String,
}

impl SyncHost for TauriSyncHost {
    fn lock_store(&self) -> MutexGuard<'_, Option<ProjectStore>> {
        self.app.state::<AppState>().inner().lock_store()
    }

    fn saving_keys(&self) -> BTreeSet<String> {
        self.app.state::<AppState>().lock_saving().clone()
    }

    fn status_changed(&self, status: &SyncStatusView) {
        let _ = self.app.emit("sync-status", status);
    }

    fn conflict(&self, file: &str, conflict_file: &str) {
        let _ = self.app.emit(
            "sync-conflict",
            SyncConflict {
                file: file.to_string(),
                conflict_file: conflict_file.to_string(),
            },
        );
    }

    fn projects_reloaded(&self, names: &[String]) {
        emit_changed(&self.app, names, ChangeReason::Sync);
        // A re-read file can come back normalized (dirty).
        schedule_dirty(&self.app, &self.app.state::<AppState>());
    }

    fn project_list_changed(&self, common_reloaded: bool) {
        emit_projects_changed(&self.app, common_reloaded);
        // An adopted file or a re-listed project dirties the common workbook.
        schedule_dirty(&self.app, &self.app.state::<AppState>());
    }

    fn project_archived(&self, project: &str) {
        // Like `delete_project`: an archived project's reminders must not fire.
        self.app
            .state::<AppState>()
            .update_fired(|f| f.forget_project(project));
    }

    /// iOS: take in edits made in Excel, then check the tailnet proxy. A run that has to wait for
    /// a rebuilt backend is asked again by `set_backend`. Desktop watches the folder instead.
    fn before_run(&self) -> bool {
        #[cfg(target_os = "ios")]
        {
            scan_external(&self.app);
            sync::prepare_run(&self.app)
        }
        #[cfg(not(target_os = "ios"))]
        {
            true
        }
    }
}

/// Starts the sync engine's task (one per app; see `SyncEngine::run_loop`). It stays idle until
/// a sync target is set.
pub fn start_sync(app: &AppHandle) {
    let engine = app.state::<AppState>().sync.clone();
    let host = Arc::new(TauriSyncHost { app: app.clone() });
    tauri::async_runtime::spawn(engine.run_loop(host));
    // The NAS: load the sync settings and bring the Tailscale sidecar up if it was in use.
    sync::start(app);
}

// ---- helpers ----

/// Schedules saves for everything the store reports dirty right now. Used after opening or
/// reloading: load-time normalization (blank 作成日時, unknown category, project name
/// mismatch) marks a project dirty without any user edit, and writing it back promptly keeps
/// such a project from looking like it has unsaved changes (e.g. to `reload_project`).
fn schedule_dirty(app: &AppHandle, state: &AppState) {
    let (projects, common) = match state.lock_store().as_ref() {
        Some(s) => (s.dirty_projects(), s.common_dirty()),
        None => return,
    };
    for p in projects {
        state.saver.schedule(app.clone(), p);
    }
    if common {
        state.saver.schedule_common(app.clone());
    }
}

fn with_store<T>(
    state: &AppState,
    f: impl FnOnce(&mut ProjectStore) -> AppResult<T>,
) -> AppResult<T> {
    let mut guard = state.lock_store();
    f(guard.as_mut().ok_or_else(no_data_dir)?)
}

/// Runs a mutation, then schedules saves for `projects` and (when `common` is set or the
/// common workbook ended up dirty) for the common workbook. Nothing is scheduled on error.
fn mutate<T>(
    app: &AppHandle,
    state: &AppState,
    projects: &[&str],
    common: bool,
    f: impl FnOnce(&mut ProjectStore) -> AppResult<T>,
) -> AppResult<T> {
    let (out, common_dirty) = with_store(state, |s| {
        let out = f(s)?;
        Ok((out, s.common_dirty()))
    })?;
    for p in projects {
        state.saver.schedule(app.clone(), (*p).to_string());
    }
    if common || common_dirty {
        state.saver.schedule_common(app.clone());
    }
    Ok(out)
}

/// `mutate` for create / rename / delete of a project, which write the common workbook at once.
/// When that file changed on disk since we last wrote or read it, the store holds `_common`
/// instead of writing (`save_common_unless_held`); tell the UI like a watcher batch would, so
/// the banner asks. Checked under the same lock as the mutation, so a hold made by the watcher
/// in between is not reported twice.
fn mutate_structure<T>(
    app: &AppHandle,
    state: &AppState,
    projects: &[&str],
    f: impl FnOnce(&mut ProjectStore) -> AppResult<T>,
) -> AppResult<T> {
    let mut newly_held = false;
    let out = mutate(app, state, projects, true, |s| {
        let before = s.is_held(COMMON_KEY);
        let out = f(s);
        newly_held = !before && s.is_held(COMMON_KEY);
        out
    });
    if newly_held {
        let _ = app.emit(
            "external-change",
            ExternalChange {
                project: COMMON_KEY.to_string(),
            },
        );
    }
    out
}

// ---- start-up and data folder ----

/// Reads `settings.json` and opens the data folder it names, if the store is not open yet.
pub fn startup(state: &AppState) -> AppResult<AppStateDto> {
    startup_in(state, None)
}

/// [`startup`] with a data folder the platform fixes (iOS: `Documents`; there is no folder
/// picker). A missing or different `dataDir` in `settings.json` (the spike's folder) is replaced
/// by it. `None` on desktop.
pub fn startup_in(state: &AppState, fixed_dir: Option<&Path>) -> AppResult<AppStateDto> {
    let mut store = state.lock_store();
    if store.is_some() {
        return Ok(state_dto(store.as_ref(), None));
    }
    let loaded = match AppSettings::load(&state.app_data_dir) {
        Ok(s) => s,
        Err(e) => {
            // Treated as a first run; the file is replaced when a folder is chosen.
            eprintln!("settings.json ignored: {e}");
            AppSettings::default()
        }
    };
    let data_dir = loaded.data_dir.clone();
    *state.lock_settings() = loaded;
    if let Some(fixed) = fixed_dir
        && data_dir.as_deref() != Some(fixed)
    {
        drop(store);
        if let Some(old) = data_dir.as_deref() {
            migrate_moved_container(&state.app_data_dir, &mut state.lock_fired(), old, fixed);
        }
        return switch_data_dir(state, &fixed.to_string_lossy());
    }
    let Some(dir) = data_dir else {
        return Ok(state_dto(None, None));
    };
    match ProjectStore::open(Paths::new(dir.clone()), now, false) {
        Ok(opened) => {
            *store = Some(opened);
            Ok(state_dto(store.as_ref(), None))
        }
        Err(AppError::NotFound { .. }) => Ok(state_dto(
            None,
            Some(format!("データフォルダが見つかりません: {}", dir.display())),
        )),
        Err(e) => Err(e),
    }
}

/// `<...>/Containers/Data/Application/<id>/Documents`: the data folder iOS gives the app.
fn is_container_documents(path: &Path) -> bool {
    let parts: Vec<_> = path.components().rev().take(5).collect();
    let name = |i: usize| parts.get(i).and_then(|c| c.as_os_str().to_str());
    name(0) == Some("Documents")
        && name(1).is_some_and(|id| !id.is_empty())
        && name(2) == Some("Application")
        && name(3) == Some("Data")
        && name(4) == Some("Containers")
}

/// iOS does not keep the app container's path across updates and reinstalls. When the saved data
/// folder and the current one are both container `Documents` folders (the container moved: iOS
/// has no folder picker, so it is not a choice), the records tied to the folder by its absolute
/// path follow it: `sync.json` (else the first sync after an update plans without its base) and
/// `fired.json` (else reminders fire again). Any other pair of folders is left alone, so those
/// records still start fresh. `true` when something was rewritten. Write failures are logged.
pub fn migrate_moved_container(
    app_data_dir: &Path,
    fired: &mut Fired,
    old: &Path,
    new: &Path,
) -> bool {
    if old == new || !is_container_documents(old) || !is_container_documents(new) {
        return false;
    }
    let mut changed = false;
    let sync_path = app_data_dir.join(SyncState::FILE);
    if let Ok(text) = std::fs::read_to_string(&sync_path)
        && let Ok(mut sync) = serde_json::from_str::<SyncState>(&text)
        && sync.data_dir == old
    {
        sync.data_dir = new.to_path_buf();
        match sync.save(app_data_dir) {
            Ok(()) => changed = true,
            Err(e) => eprintln!("could not write {}: {e}", SyncState::FILE),
        }
    }
    if fired.data_dir.as_deref() == Some(old) {
        fired.data_dir = Some(new.to_path_buf());
        match fired.save(app_data_dir) {
            Ok(()) => changed = true,
            Err(e) => eprintln!("could not write {}: {e}", Fired::FILE),
        }
    }
    changed
}

/// Opens (creating if needed) `path` as the data folder and remembers it in `settings.json`.
/// Unsaved edits in the folder being left are written first.
pub fn switch_data_dir(state: &AppState, path: &str) -> AppResult<AppStateDto> {
    if path.trim().is_empty() {
        return Err(AppError::Invalid {
            message: "フォルダが指定されていません".into(),
        });
    }
    let dir = PathBuf::from(path);
    let mut store = state.lock_store();
    // Never leave a folder with unsaved edits: a project waiting for the user's choice about an
    // external change (its edits cannot be flushed) or any failed write aborts the switch.
    if let Some(old) = store.as_mut() {
        if !old.held_projects().is_empty() {
            return Err(AppError::Unsaved {
                message: "他のアプリで変更されたファイルの扱いが決まっていません。先に「再読み込み」か「上書き」を選んでください。".into(),
            });
        }
        if let Some((_, e)) = flush(old, &BTreeSet::new()).into_iter().next() {
            return Err(e);
        }
    }
    let opened = ProjectStore::open(Paths::new(dir.clone()), now, true)?;
    // Only the data folder changes; the sync settings stay (taken under the writers' lock, so a
    // sync settings write cannot slip in between and be undone).
    let _writer = state.sync_rt.lock_settings_write();
    let settings = AppSettings {
        data_dir: Some(dir),
        ..state.lock_settings().clone()
    };
    settings.save(&state.app_data_dir)?;
    *state.lock_settings() = settings;
    state.saver.cancel_all();
    *store = Some(opened);
    Ok(state_dto(store.as_ref(), None))
}

// ---- external changes (仕様 §5) ----

/// What one batch of watcher events did to the store; the caller publishes it.
#[derive(Debug, Default, PartialEq, Eq)]
struct BatchOutcome {
    /// Newly held: changed on disk while having unsaved or in-flight edits (`external-change`).
    held: Vec<String>,
    /// Projects re-read from their changed file (`project-changed`, reason `external`).
    reloaded: Vec<String>,
    /// The project list or the common workbook changed (`projects-changed`).
    projects_changed: bool,
    /// The common workbook was re-read in this batch (`projects-changed` `commonReloaded`). A
    /// batch can also change the project list without reading it (a new file adopted), so
    /// `projects_changed` alone does not mean an earlier `_common` read failure is resolved.
    common_reloaded: bool,
    /// `(key, message)` for files that changed but could not be read (`external-read-failed`).
    failures: Vec<(String, String)>,
    /// The data folder itself is gone: every project was marked missing and the watcher should
    /// be dropped.
    data_dir_missing: bool,
}

impl BatchOutcome {
    fn is_empty(&self) -> bool {
        *self == BatchOutcome::default()
    }
}

/// Decides, per changed file, what to do (仕様 §5.2). `busy(key)` says a save for the key is
/// waiting or running; `cancel(key)` drops its timer. Our own writes are recognised by their
/// recorded fingerprint and ignored.
fn apply_fs_batch(
    store: &mut ProjectStore,
    busy: &dyn Fn(&str) -> bool,
    cancel: &dyn Fn(&str),
    paths: Vec<PathBuf>,
) -> BatchOutcome {
    let mut out = BatchOutcome::default();
    // The folder was deleted, renamed or unmounted (a removed drive, a synced folder going
    // away). Nothing below makes sense then. Returning to the onboarding screen is left to the
    // sync phase.
    if !store.paths().data_dir.is_dir() {
        store.mark_all_missing();
        out.data_dir_missing = true;
        out.projects_changed = true;
        return out;
    }
    for path in paths {
        match classify_path(store.paths(), &path) {
            FileKind::Ignore => {}
            FileKind::Common => {
                let changed =
                    verdict(store.recorded(COMMON_KEY), fingerprint(&path)) == Verdict::Changed;
                if !changed || store.is_held(COMMON_KEY) {
                    continue;
                }
                if store.common_dirty() || busy(COMMON_KEY) {
                    cancel(COMMON_KEY);
                    store.hold(COMMON_KEY);
                    out.held.push(COMMON_KEY.to_string());
                } else {
                    match store.reload_common() {
                        Ok(()) => {
                            out.projects_changed = true;
                            out.common_reloaded = true;
                        }
                        Err(e) => out.failures.push((COMMON_KEY.to_string(), e.to_string())),
                    }
                }
            }
            FileKind::Project(name) => {
                let known = store.summaries().iter().any(|p| p.name == name);
                match verdict(store.recorded(&name), fingerprint(&path)) {
                    Verdict::OwnWrite => {}
                    Verdict::Removed => {
                        if known {
                            store.mark_missing(&name);
                            out.projects_changed = true;
                        }
                    }
                    // Our own rename that only changes the spelling of the name (aaa -> AAA on a
                    // case-insensitive file system) reports the old spelling too: same file.
                    Verdict::Changed if !known && store.is_listed_project_file(&path) => {}
                    Verdict::Changed if !known => {
                        if store.adopt_new_file(&name).is_ok() {
                            out.projects_changed = true;
                        }
                    }
                    Verdict::Changed => {
                        if store.is_held(&name) {
                            // Already waiting for the user's choice.
                        } else if store.dirty_projects().contains(&name) || busy(&name) {
                            cancel(&name);
                            store.hold(&name);
                            out.held.push(name);
                        } else {
                            // An unreadable file (Excel mid-save, a broken file) keeps the book
                            // we have; the next change event tries again (仕様 §5.2).
                            match store.reload_external(&name) {
                                Ok(()) => out.reloaded.push(name),
                                Err(e) => out.failures.push((name, e.to_string())),
                            }
                        }
                    }
                }
            }
        }
    }
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalChange {
    project: String,
}

/// `external-read-failed`: `project` (or `_common`) changed on disk but could not be read. Not a
/// save failure: there is nothing to retry from here, the next change event reads it again.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalReadFailed {
    project: String,
    message: String,
}

/// One debounced batch of changed paths, delivered on the watcher thread. Lock order: the store
/// lock is taken first, and the saver is only asked about / told to cancel while holding it.
fn handle_fs_batch(app: &AppHandle, paths: Vec<PathBuf>) {
    let state = app.state::<AppState>();
    let out = {
        let mut guard = state.lock_store();
        let Some(store) = guard.as_mut() else {
            return;
        };
        apply_fs_batch(
            store,
            &|key| state.saver.is_pending(key) || state.is_saving(key),
            &|key| state.saver.cancel(key),
            paths,
        )
    };
    if out.is_empty() {
        return;
    }
    if out.data_dir_missing {
        // Dropping the watcher from its own callback thread is fine: it only signals stop.
        *state.watcher.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
    for project in out.held {
        let _ = app.emit("external-change", ExternalChange { project });
    }
    emit_changed(app, &out.reloaded, ChangeReason::External);
    let gone = out.data_dir_missing;
    for (project, message) in out.failures {
        let _ = app.emit(
            "external-read-failed",
            ExternalReadFailed { project, message },
        );
    }
    if out.projects_changed {
        emit_projects_changed(app, out.common_reloaded);
    }
    if gone {
        return;
    }
    // Re-read files can come back normalized (dirty), and a new file dirties the common
    // workbook. `schedule` needs a tokio runtime; this is a plain thread.
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        schedule_dirty(&handle, &handle.state::<AppState>());
    });
}

/// Everything a scan has to look at (仕様 §3.7): the common workbook, every `*.xlsx` directly in
/// the data folder, and the projects the store knows (to find the ones that vanished). No
/// duplicates; `archive/` is not entered. `apply_fs_batch` decides what each path means.
pub fn scan_paths(store: &ProjectStore) -> Vec<PathBuf> {
    let paths = store.paths();
    let mut found = BTreeSet::new();
    found.insert(paths.common());
    if let Ok(entries) = std::fs::read_dir(&paths.data_dir) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            let name = entry.file_name();
            let is_xlsx = path
                .extension()
                .is_some_and(|x| x.eq_ignore_ascii_case("xlsx"));
            if is_xlsx && !name.to_string_lossy().starts_with("~$") && path.is_file() {
                found.insert(path);
            }
        }
    }
    for p in store.summaries() {
        if let Ok(path) = paths.project(&p.name) {
            found.insert(path);
        }
    }
    found.into_iter().collect()
}

/// Looks for edits made outside the app (Excel on the phone) and treats them like a watcher
/// batch. Called on resume and before each sync run, instead of a file watcher (iOS).
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
pub fn scan_external(app: &AppHandle) {
    let state = app.state::<AppState>();
    let paths = {
        let guard = state.lock_store();
        match guard.as_ref() {
            Some(store) => scan_paths(store),
            None => return,
        }
    };
    handle_fs_batch(app, paths);
}

/// Starts (or restarts) watching the open data folder, replacing the previous watcher. Without
/// an open store, or when watching cannot start, no watcher is left running.
#[cfg(desktop)]
fn start_watching(app: &AppHandle, state: &AppState) {
    let dir = state
        .lock_store()
        .as_ref()
        .map(|s| s.paths().data_dir.clone());
    let mut error = None;
    let watcher = dir.and_then(|dir| {
        let handle = app.clone();
        match watcher::start(&dir, move |paths| handle_fs_batch(&handle, paths)) {
            Ok(w) => Some(w),
            Err(e) => {
                eprintln!("watch failed: {e}");
                // Usually nobody listens yet (start-up): the DTO carries it too.
                let _ = app.emit("watch-failed", e.to_string());
                error = Some(e.to_string());
                None
            }
        }
    });
    *state.watcher.lock().unwrap_or_else(|e| e.into_inner()) = watcher;
    *state.watch_error.lock().unwrap_or_else(|e| e.into_inner()) = error;
}

// ---- quick add ----

pub fn parse_quick_add_in(store: &ProjectStore, text: &str, today: NaiveDate) -> QuickAddResult {
    let projects: Vec<String> = store.summaries().into_iter().map(|p| p.name).collect();
    let labels: Vec<String> = store.labels().into_iter().map(|l| l.name).collect();
    let mut parsed = parse(text, today, &projects, &labels);
    // A recurrence without a date starts on its first occurrence on or after today. An
    // unreadable rule (or one that has no occurrence) leaves the date empty.
    if parsed.due.is_none()
        && let Some(rrule) = &parsed.rrule
    {
        parsed.due = recurrence::first_on_or_after(rrule, today, parsed.due_time)
            .ok()
            .flatten();
    }
    parsed
}

pub fn quick_add_in(
    store: &mut ProjectStore,
    text: &str,
    default_project: &str,
    today: NaiveDate,
) -> AppResult<QuickAddOutcome> {
    let parsed = parse_quick_add_in(store, text, today);
    let project = parsed
        .project
        .clone()
        .unwrap_or_else(|| default_project.to_string());
    let input = TaskInput {
        title: parsed.title.clone(),
        section: None,
        priority: parsed.priority,
        due: parsed.due,
        due_time: parsed.due_time,
        note: None,
        labels: parsed.labels.clone(),
        parent_no: None,
        rrule: parsed.rrule.clone(),
        reminders: Vec::new(),
    };
    let view = store.add_task(&project, input)?;
    let no = view.tasks.iter().map(|t| t.no).max().unwrap_or(0);
    Ok(QuickAddOutcome { parsed, view, no })
}

// ---- commands: app and data folder ----

#[tauri::command]
pub async fn app_state(app: AppHandle, state: State<'_, AppState>) -> AppResult<AppStateDto> {
    #[cfg(target_os = "ios")]
    let dto = startup_in(state.inner(), Some(&platform::ios_data_dir(&app)?))?;
    #[cfg(not(target_os = "ios"))]
    let dto = startup(state.inner())?;
    state.bind_fired_to_store();
    schedule_dirty(&app, state.inner());
    // The store is open now (the sync plans only against an opened store).
    state.sync.request(SyncReason::Startup);
    // iOS has no file watcher: external edits are looked for on resume and before each sync run.
    #[cfg(desktop)]
    {
        let watching = state
            .watcher
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some();
        if !watching {
            start_watching(&app, state.inner());
        }
    }
    Ok(AppStateDto {
        watch_error: state.watch_error(),
        tray_error: state.tray_error(),
        ..dto
    })
}

#[tauri::command]
pub async fn set_data_dir(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<AppStateDto> {
    let dto = switch_data_dir(state.inner(), &path)?;
    state.bind_fired_to_store();
    schedule_dirty(&app, state.inner());
    // `sync.json` belongs to the old folder; the new one starts from fresh records.
    state.sync.request(SyncReason::Settings);
    #[cfg(desktop)]
    start_watching(&app, state.inner());
    Ok(AppStateDto {
        watch_error: state.watch_error(),
        tray_error: state.tray_error(),
        ..dto
    })
}

/// Why watching the data folder could not start, or `None` while it runs (仕様 §7).
#[tauri::command]
pub async fn watch_status(state: State<'_, AppState>) -> AppResult<Option<String>> {
    Ok(state.watch_error())
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> AppResult<Option<String>> {
    platform::pick_folder(&app)
}

#[tauri::command]
pub async fn reveal_data_dir(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let dir = with_store(state.inner(), |s| Ok(s.paths().data_dir.clone()))?;
    platform::reveal_path(&app, &dir)
}

/// The OS the app runs on (the page hides what iPhone cannot do).
#[tauri::command]
pub fn platform_info() -> platform::PlatformInfo {
    platform::PlatformInfo::current()
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolveAction {
    Reload,
    Overwrite,
}

/// The banner's choice for a project (or `_common`) that changed on disk while it had unsaved
/// edits (仕様 §5.3). `reload` drops ours and returns the project's new view (`None` for
/// `_common`); `overwrite` writes ours now and returns the view.
#[tauri::command]
pub async fn resolve_external_change(
    project: String,
    action: ResolveAction,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Option<ProjectView>> {
    let is_common = project == COMMON_KEY;
    // The hold is released only once the choice took effect: a reload that fails (the file is
    // unreadable right now) leaves the project held and its edits intact.
    let view = with_store(state.inner(), |s| {
        let view = match (action, is_common) {
            (ResolveAction::Reload, true) => {
                s.reload_common()?;
                None
            }
            (ResolveAction::Reload, false) => {
                s.reload_external(&project)?;
                Some(s.view(&project)?)
            }
            (ResolveAction::Overwrite, true) => {
                s.accept_disk_state(COMMON_KEY);
                None
            }
            (ResolveAction::Overwrite, false) => {
                let view = s.view(&project)?;
                // The save below checks the file against what we know; the user chose ours.
                s.accept_disk_state(&project);
                Some(view)
            }
        };
        s.release(&project);
        Ok(view)
    })?;
    match action {
        ResolveAction::Overwrite => {
            let sink = Arc::new(TauriSink { app: app.clone() });
            state.saver.save_now(sink, &project).await?;
        }
        // Normalization on load (or re-listing in the common workbook) can leave it dirty.
        ResolveAction::Reload => schedule_dirty(&app, state.inner()),
    }
    if is_common {
        emit_projects_changed(&app, matches!(action, ResolveAction::Reload));
    } else if matches!(action, ResolveAction::Reload) {
        // Only a reload changed the in-memory view; after an overwrite it is unchanged (the UI
        // re-reads on `save-status` saved), and an "imported" notice would contradict the action.
        emit_changed(&app, &[project], ChangeReason::External);
    }
    Ok(view)
}

#[tauri::command]
pub async fn held_projects(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    with_store(state.inner(), |s| Ok(s.held_projects()))
}

/// Exits for real, after the user resolved (or gave up on) the held projects that blocked the
/// exit; `exit(0)` is not blocked again (see `lib.rs`).
#[tauri::command]
pub async fn quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub async fn retry_save(
    project: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let sink = Arc::new(TauriSink { app });
    state.saver.save_now(sink, &project).await
}

// ---- commands: projects ----

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> AppResult<Vec<ProjectSummary>> {
    with_store(state.inner(), |s| Ok(s.summaries()))
}

#[tauri::command]
pub async fn get_project(name: String, state: State<'_, AppState>) -> AppResult<ProjectView> {
    with_store(state.inner(), |s| s.view(&name))
}

/// Re-reads the project's file from disk. The way to retry a project that failed to load, or
/// to pick up a fix made in Excel. With unsaved in-memory changes it fails with `Unsaved`
/// unless `discard` is true (the UI asks the user first). A project that comes back dirty
/// from load-time normalization is scheduled for saving.
#[tauri::command]
pub async fn reload_project(
    name: String,
    discard: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ProjectView> {
    let (view, dirty) = with_store(state.inner(), |s| {
        let view = if discard {
            s.reload_discarding(&name)?
        } else {
            s.reload(&name)?
        };
        // A fresh read settles any pending conflict for this project.
        s.release(&name);
        Ok((view, s.dirty_projects().contains(&name)))
    })?;
    if dirty {
        state.saver.schedule(app, name);
    }
    Ok(view)
}

#[tauri::command]
pub async fn create_project(
    name: String,
    color: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    mutate_structure(&app, state.inner(), &[], |s| {
        s.create_project(&name, &color)
    })
}

#[tauri::command]
pub async fn rename_project(
    name: String,
    new_name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ProjectSummary> {
    let summary = mutate_structure(&app, state.inner(), &[&new_name], |s| {
        s.rename_project(&name, &new_name)
    })?;
    // The records follow the project (task numbers stay), so nothing fires twice.
    state.update_fired(|f| f.rename_project(&name, &new_name));
    Ok(summary)
}

#[tauri::command]
pub async fn delete_project(
    name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    mutate_structure(&app, state.inner(), &[], |s| s.delete_project(&name))?;
    state.update_fired(|f| f.forget_project(&name));
    Ok(())
}

// ---- commands: sections ----

#[tauri::command]
pub async fn add_section(
    project: String,
    name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ProjectView> {
    mutate(&app, state.inner(), &[&project], false, |s| {
        s.add_section(&project, &name)
    })
}

#[tauri::command]
pub async fn rename_section(
    project: String,
    name: String,
    new_name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ProjectView> {
    mutate(&app, state.inner(), &[&project], false, |s| {
        s.rename_section(&project, &name, &new_name)
    })
}

#[tauri::command]
pub async fn reorder_sections(
    project: String,
    names: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ProjectView> {
    mutate(&app, state.inner(), &[&project], false, |s| {
        s.reorder_sections(&project, &names)
    })
}

// ---- commands: tasks ----

#[tauri::command]
pub async fn add_task(
    project: String,
    input: TaskInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ProjectView> {
    mutate(&app, state.inner(), &[&project], false, |s| {
        s.add_task(&project, input)
    })
}

#[tauri::command]
pub async fn update_task(
    project: String,
    no: u32,
    patch: TaskPatch,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ProjectView> {
    let touches_reminders = patch_touches_reminders(&patch);
    let view = mutate(&app, state.inner(), &[&project], false, |s| {
        s.update_task(&project, no, patch)
    })?;
    if touches_reminders {
        state.forget_fired(&project, no);
    }
    Ok(view)
}

/// A change to the due date, its time or the reminders moves the fire times: the task's
/// records in `fired.json` are dropped so the new times can fire (仕様 §4.3).
pub fn patch_touches_reminders(patch: &TaskPatch) -> bool {
    patch.due.is_some() || patch.due_time.is_some() || patch.reminders.is_some()
}

/// `complete_task`, shared with the notification's 「完了」 button: completes (a recurring task
/// moves to its next due date), schedules the save, and forgets the task's fired reminders so
/// the next occurrence fires again.
fn complete_task_in(
    app: &AppHandle,
    state: &AppState,
    project: &str,
    no: u32,
    done: bool,
) -> AppResult<ProjectView> {
    let view = mutate(app, state, &[project], false, |s| {
        s.complete_task(project, no, done)
    })?;
    state.forget_fired(project, no);
    Ok(view)
}

/// The notification's 「完了」 button (`on_action` `done`). Open views refresh on
/// `project-changed` (reason `bulk`). A failure (a held project, a missing task) brings the
/// window back and tells the UI (`notification-error { message }`), which shows it.
pub(crate) fn complete_from_notification(app: &AppHandle, project: &str, no: u32) {
    let state = app.state::<AppState>();
    match complete_task_in(app, &state, project, no, true) {
        Ok(_) => emit_changed(app, &[project.to_string()], ChangeReason::Bulk),
        Err(e) => {
            eprintln!("could not complete {project}#{no} from a notification: {e}");
            crate::window::show_main_window(app);
            let _ = app.emit(
                "notification-error",
                NotificationErrorEvent {
                    message: format!("通知から完了にできませんでした: {e}"),
                },
            );
        }
    }
}

/// Payload of `notification-error`.
#[derive(Debug, Clone, Serialize)]
struct NotificationErrorEvent {
    message: String,
}

#[tauri::command]
pub async fn complete_task(
    project: String,
    no: u32,
    done: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ProjectView> {
    complete_task_in(&app, state.inner(), &project, no, done)
}

#[tauri::command]
pub async fn delete_task(
    project: String,
    no: u32,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ProjectView> {
    let view = mutate(&app, state.inner(), &[&project], false, |s| {
        s.delete_task(&project, no)
    })?;
    state.forget_fired(&project, no);
    Ok(view)
}

#[tauri::command]
pub async fn move_task(
    project: String,
    no: u32,
    to_project: String,
    to_section: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<MoveOutcome> {
    let (from, to) = mutate(&app, state.inner(), &[&project, &to_project], false, |s| {
        s.move_task(&project, no, &to_project, to_section.as_deref())
    })?;
    if project != to_project {
        // The task has a new key in the other project; the old records would never match.
        state.forget_fired(&project, no);
        emit_changed(&app, &[project, to_project], ChangeReason::Move);
    }
    Ok(MoveOutcome { from, to })
}

#[tauri::command]
pub async fn reorder_tasks(
    project: String,
    section: Option<String>,
    order: Vec<u32>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ProjectView> {
    mutate(&app, state.inner(), &[&project], false, |s| {
        s.reorder_tasks(&project, section.as_deref(), &order)
    })
}

// ---- commands: cross-project views (仕様 §3, §4) ----

#[tauri::command]
pub async fn today_view(today: String, state: State<'_, AppState>) -> AppResult<views::TodayView> {
    let today = parse_ymd(&today)?;
    with_store(state.inner(), |s| {
        Ok(views::today_view(&s.all_tasks(), today))
    })
}

#[tauri::command]
pub async fn upcoming_view(
    from: String,
    days: u32,
    state: State<'_, AppState>,
) -> AppResult<UpcomingDto> {
    let from = parse_ymd(&from)?;
    let days = check_days(days)?;
    with_store(state.inner(), |s| {
        Ok(UpcomingDto {
            days: views::upcoming(&s.all_tasks(), from, days),
        })
    })
}

#[tauri::command]
pub async fn label_view(label: String, state: State<'_, AppState>) -> AppResult<LabelViewDto> {
    with_store(state.inner(), |s| {
        Ok(LabelViewDto {
            label: s.label_by_name(&label),
            tasks: views::label_tasks(&s.all_tasks(), &label),
        })
    })
}

#[tauri::command]
pub async fn labels(state: State<'_, AppState>) -> AppResult<LabelsDto> {
    with_store(state.inner(), |s| {
        Ok(LabelsDto {
            labels: s.labels_union(),
            counts: views::label_counts(&s.all_tasks()),
        })
    })
}

#[tauri::command]
pub async fn add_label(
    name: String,
    color: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Label> {
    mutate(&app, state.inner(), &[], true, |s| {
        s.add_label(&name, &color)
    })
}

#[tauri::command]
pub async fn update_label(
    name: String,
    color: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Label> {
    mutate(&app, state.inner(), &[], true, |s| {
        s.update_label_color(&name, &color)
    })
}

#[tauri::command]
pub async fn rename_label(
    name: String,
    new_name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<LabelRenamed> {
    let (label, changed) = mutate(&app, state.inner(), &[], true, |s| {
        s.rename_label(&name, &new_name)
    })?;
    for p in &changed {
        state.saver.schedule(app.clone(), p.clone());
    }
    emit_changed(&app, &changed, ChangeReason::Bulk);
    Ok(LabelRenamed {
        label,
        changed_projects: changed,
    })
}

#[tauri::command]
pub async fn delete_label(
    name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ChangedProjects> {
    let changed = mutate(&app, state.inner(), &[], true, |s| s.delete_label(&name))?;
    for p in &changed {
        state.saver.schedule(app.clone(), p.clone());
    }
    emit_changed(&app, &changed, ChangeReason::Bulk);
    Ok(ChangedProjects {
        changed_projects: changed,
    })
}

/// The tasks whose due date differs between two copies of the store's tasks (`(project, no)`).
fn moved_due(before: &[Task], after: &[Task]) -> Vec<(String, u32)> {
    after
        .iter()
        .filter(|t| {
            before
                .iter()
                .any(|b| b.project == t.project && b.no == t.no && b.due != t.due)
        })
        .map(|t| (t.project.clone(), t.no))
        .collect()
}

#[tauri::command]
pub async fn reschedule_overdue(
    today: String,
    due: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ChangedProjects> {
    let today = parse_ymd(&today)?;
    let due = parse_ymd(&due)?;
    let (changed, moved) = mutate(&app, state.inner(), &[], false, |s| {
        let before = s.all_tasks();
        let changed = s.reschedule_overdue(today, due)?;
        Ok((changed, moved_due(&before, &s.all_tasks())))
    })?;
    for p in &changed {
        state.saver.schedule(app.clone(), p.clone());
    }
    // The due dates moved: their reminders can fire again on the new date (仕様 §4.3).
    if !moved.is_empty() {
        state.update_fired(|f| {
            for (project, no) in &moved {
                f.forget_task(project, *no);
            }
        });
    }
    emit_changed(&app, &changed, ChangeReason::Bulk);
    Ok(ChangedProjects {
        changed_projects: changed,
    })
}

#[tauri::command]
pub async fn search(
    query: String,
    include_done: bool,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> AppResult<SearchDto> {
    let limit = limit.unwrap_or(50).clamp(1, 200);
    with_store(state.inner(), |s| {
        Ok(SearchDto {
            hits: search::search(&s.all_tasks(), &query, include_done, limit),
        })
    })
}

#[tauri::command]
pub async fn counts(today: String, state: State<'_, AppState>) -> AppResult<CountsDto> {
    let today = parse_ymd(&today)?;
    with_store(state.inner(), |s| {
        let tasks = s.all_tasks();
        Ok(CountsDto {
            today: views::today_count(&tasks, today),
            labels: views::label_counts(&tasks),
        })
    })
}

// ---- commands: quick add ----

#[tauri::command]
pub async fn quick_add(
    text: String,
    default_project: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<QuickAddOutcome> {
    let today = Local::now().date_naive();
    let (outcome, common_dirty) = with_store(state.inner(), |s| {
        let outcome = quick_add_in(s, &text, &default_project, today)?;
        Ok((outcome, s.common_dirty()))
    })?;
    state
        .saver
        .schedule(app.clone(), outcome.view.project.name.clone());
    if common_dirty {
        state.saver.schedule_common(app);
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn parse_quick_add(
    text: String,
    state: State<'_, AppState>,
) -> AppResult<QuickAddResult> {
    let today = Local::now().date_naive();
    with_store(state.inner(), |s| Ok(parse_quick_add_in(s, &text, today)))
}

// ---- commands: settings ----

fn settings_dto(store: &ProjectStore) -> SettingsDto {
    let s = store.settings();
    SettingsDto {
        display_name: s.display_name,
        week_start: s.week_start,
        default_reminder: s.default_reminder,
        notify_time: s.notify_time.format("%H:%M").to_string(),
        keep_in_tray: s.keep_in_tray,
        notifications: s.notifications,
        data_dir: Some(dir_string(store)),
    }
}

// ---- recurrence ----

pub fn parse_recurrence_in(text: &str) -> RecurrenceDto {
    let rrule = recurrence_words::parse_recurrence_text(text);
    let label = rrule
        .as_deref()
        .map(|r| recurrence::summarize(r).unwrap_or_else(|| r.to_string()));
    RecurrenceDto { rrule, label }
}

/// `valid` is true when the rule computes without error (`next_due` is `Ok`). A finished rule
/// (COUNT / UNTIL used up, `Ok(None)`) is still well-formed, so it is valid; only an unreadable
/// rule (`Err`) is not.
pub fn summarize_recurrence_in(rrule: &str, today: NaiveDate) -> RecurrenceLabelDto {
    RecurrenceLabelDto {
        label: recurrence::summarize(rrule).unwrap_or_else(|| rrule.to_string()),
        valid: recurrence::next_due(rrule, None, None, today).is_ok(),
    }
}

#[tauri::command]
pub async fn parse_recurrence(text: String) -> RecurrenceDto {
    parse_recurrence_in(&text)
}

#[tauri::command]
pub async fn summarize_recurrence(rrule: String) -> RecurrenceLabelDto {
    summarize_recurrence_in(&rrule, now().date())
}

#[tauri::command]
pub async fn settings(state: State<'_, AppState>) -> AppResult<SettingsDto> {
    with_store(state.inner(), |s| Ok(settings_dto(s)))
}

#[tauri::command]
pub async fn update_settings(
    settings: SettingsDto,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<SettingsDto> {
    mutate(&app, state.inner(), &[], true, |s| {
        // The time zone is not editable yet; keep what the workbook has. `data_dir` is
        // changed with `set_data_dir`, not here.
        let timezone = s.settings().timezone;
        let notify_time =
            NaiveTime::parse_from_str(&settings.notify_time, "%H:%M").map_err(|_| {
                AppError::Invalid {
                    message: "時刻なしの通知時刻は HH:MM で指定してください".into(),
                }
            })?;
        s.update_settings(Settings {
            display_name: settings.display_name,
            week_start: settings.week_start,
            timezone,
            default_reminder: settings.default_reminder,
            notify_time,
            keep_in_tray: settings.keep_in_tray,
            notifications: settings.notifications,
        })?;
        Ok(settings_dto(s))
    })
}

// ---- commands: reminders and the window (仕様 §4.4, §6) ----

#[derive(Debug, Clone, Serialize)]
pub struct PendingRemindersDto {
    pub items: Vec<ReminderItem>,
}

/// Local `YYYY-MM-DDTHH:MM` (seconds accepted).
fn parse_local_datetime(s: &str) -> AppResult<NaiveDateTime> {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M")
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S"))
        .map_err(|_| AppError::Invalid {
            message: format!("日時を読めません: {s}"),
        })
}

/// `"granted" | "denied" | "prompt"` for the settings pane.
pub fn permission_str(state: PermissionState) -> &'static str {
    match state {
        PermissionState::Granted => "granted",
        PermissionState::Denied => "denied",
        PermissionState::Prompt | PermissionState::PromptWithRationale => "prompt",
    }
}

fn notification_error(e: tauri_plugin_notification::Error) -> AppError {
    AppError::Io {
        message: e.to_string(),
    }
}

/// The banner's 「後で」: fire the reminder again at `until` (the task's reminder codes do not
/// change).
#[tauri::command]
pub async fn snooze_reminder(
    project: String,
    no: u32,
    code: String,
    until: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let until = parse_local_datetime(&until)?;
    state.snooze_fired(&ReminderKey { project, no, code }, until);
    Ok(())
}

/// Reminders fired (or summarized at start-up) that the UI has not shown yet. Drains the list
/// (returns and clears it, and writes `fired.json`). The UI calls this on mount and on every
/// `reminder-fired` event and shows what it returns (see `ReminderItem`).
#[tauri::command]
pub async fn pending_reminders(state: State<'_, AppState>) -> AppResult<PendingRemindersDto> {
    Ok(PendingRemindersDto {
        items: state.take_pending_reminders(),
    })
}

#[tauri::command]
pub async fn notification_permission(app: AppHandle) -> AppResult<String> {
    let s = app
        .notification()
        .permission_state()
        .map_err(notification_error)?;
    Ok(permission_str(s).to_string())
}

/// Desktop never prompts: the plugin answers `granted` (the OS settings decide).
#[tauri::command]
pub async fn request_notification_permission(app: AppHandle) -> AppResult<String> {
    let s = app
        .notification()
        .request_permission()
        .map_err(notification_error)?;
    Ok(permission_str(s).to_string())
}

#[tauri::command]
pub async fn show_main_window(app: AppHandle) {
    crate::window::show_main_window(&app);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn fixed_now() -> NaiveDateTime {
        d("2026-10-14").and_hms_opt(9, 0, 0).unwrap()
    }

    fn open_store(dir: &Path) -> ProjectStore {
        ProjectStore::open(Paths::new(dir), fixed_now, true).unwrap()
    }

    #[test]
    fn keep_in_tray_resolution() {
        assert!(resolve_keep_in_tray(false, Some(true)));
        assert!(!resolve_keep_in_tray(false, Some(false)));
        assert!(resolve_keep_in_tray(false, None));
        assert!(!resolve_keep_in_tray(true, Some(true)));
        assert!(!resolve_keep_in_tray(true, None));
    }

    #[test]
    fn app_state_dto_serializes_camel_case() {
        let tmp = tempfile::tempdir().unwrap();
        let store = open_store(tmp.path());
        let json = serde_json::to_value(state_dto(Some(&store), None)).unwrap();
        assert_eq!(json["dataDir"], tmp.path().to_string_lossy().as_ref());
        assert_eq!(json["inbox"], "受信トレイ");
        assert_eq!(json["projects"][0]["name"], "受信トレイ");
        assert_eq!(json["projects"][0]["taskCount"], 0);
        assert!(json.get("warning").is_none());
        assert!(json.get("watchError").is_none());
        assert!(json.get("trayError").is_none());
        let failed = AppStateDto {
            watch_error: Some("inotify".into()),
            ..state_dto(Some(&store), None)
        };
        assert_eq!(
            serde_json::to_value(failed).unwrap()["watchError"],
            "inotify"
        );
        let no_tray = AppStateDto {
            tray_error: Some("no tray".into()),
            ..state_dto(Some(&store), None)
        };
        assert_eq!(
            serde_json::to_value(no_tray).unwrap()["trayError"],
            "no tray"
        );

        let first_run = serde_json::to_value(state_dto(None, Some("w".into()))).unwrap();
        assert!(first_run["dataDir"].is_null());
        assert_eq!(first_run["projects"], serde_json::json!([]));
        assert_eq!(first_run["warning"], "w");
    }

    #[test]
    fn only_date_time_and_reminder_patches_forget_fired() {
        let patch =
            |json: serde_json::Value| -> TaskPatch { serde_json::from_value(json).unwrap() };
        assert!(!patch_touches_reminders(&patch(
            serde_json::json!({ "title": "x" })
        )));
        assert!(!patch_touches_reminders(&patch(
            serde_json::json!({ "progress": 50 })
        )));
        assert!(patch_touches_reminders(&patch(
            serde_json::json!({ "due": null })
        )));
        assert!(patch_touches_reminders(&patch(
            serde_json::json!({ "dueTime": "15:00" })
        )));
        assert!(patch_touches_reminders(&patch(
            serde_json::json!({ "reminders": [] })
        )));
    }

    #[test]
    fn fired_lives_next_to_settings_json_and_survives_a_restart() {
        let tmp = tempfile::tempdir().unwrap();
        let at = d("2026-10-13").and_hms_opt(9, 0, 0).unwrap();
        let key = ReminderKey {
            project: "p".into(),
            no: 1,
            code: "-0m".into(),
        };
        let state = AppState::new(tmp.path().to_path_buf());
        state.lock_fired().mark(&key, at);
        state.snooze_fired(&key, at + chrono::Duration::minutes(10));
        assert!(tmp.path().join(Fired::FILE).exists());
        let again = AppState::new(tmp.path().to_path_buf());
        assert_eq!(
            again.lock_fired().snooze_until(&key, at),
            Some(at + chrono::Duration::minutes(10))
        );
        again.forget_fired("p", 1);
        assert!(
            AppState::new(tmp.path().to_path_buf())
                .lock_fired()
                .entries
                .is_empty()
        );
    }

    #[test]
    fn opening_another_folder_resets_and_persists_fired() {
        let app_dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let key = ReminderKey {
            project: INBOX.into(),
            no: 1,
            code: "-0m".into(),
        };
        let state = AppState::new(app_dir.path().to_path_buf());
        {
            let mut fired = state.lock_fired();
            fired.bind(Path::new("/some/other/folder"));
            fired.mark(&key, d("2026-10-13").and_hms_opt(9, 0, 0).unwrap());
        }
        *state.store.lock().unwrap() = Some(open_store(data.path()));
        state.bind_fired_to_store();
        let reloaded = AppState::new(app_dir.path().to_path_buf());
        let fired = reloaded.lock_fired();
        assert!(fired.entries.is_empty());
        assert_eq!(fired.data_dir.as_deref(), Some(data.path()));
    }

    #[test]
    fn rescheduling_reports_moved_tasks_and_snoozes_bind_to_the_current_fire_time() {
        let data = tempfile::tempdir().unwrap();
        let app_dir = tempfile::tempdir().unwrap();
        let mut store = open_store(data.path());
        let input: TaskInput = serde_json::from_value(serde_json::json!({
            "title": "t",
            "due": "2026-10-13",
            "dueTime": "15:00",
            "reminders": ["-0m"],
        }))
        .unwrap();
        let no = store
            .add_task(INBOX, input)
            .unwrap()
            .tasks
            .iter()
            .find(|t| t.title == "t")
            .unwrap()
            .no;
        let key = ReminderKey {
            project: INBOX.into(),
            no,
            code: "-0m".into(),
        };
        let state = AppState::new(app_dir.path().to_path_buf());
        *state.store.lock().unwrap() = Some(store);
        let at = |s: &str| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M").unwrap();

        // The banner's 後で for a reminder with no record ties the snooze to 10/13 15:00.
        state.snooze_fired(&key, at("2026-10-13T15:10"));
        assert_eq!(
            state
                .lock_fired()
                .snooze_until(&key, at("2026-10-13T15:00")),
            Some(at("2026-10-13T15:10"))
        );

        let moved = {
            let mut guard = state.store.lock().unwrap();
            let s = guard.as_mut().unwrap();
            let before = s.all_tasks();
            s.reschedule_overdue(d("2026-10-14"), d("2026-10-14"))
                .unwrap();
            moved_due(&before, &s.all_tasks())
        };
        assert_eq!(moved, vec![(INBOX.to_string(), no)]);
        // Unchanged tasks are not reported.
        let tasks = state.store.lock().unwrap().as_ref().unwrap().all_tasks();
        assert!(moved_due(&tasks, &tasks).is_empty());
    }

    #[test]
    fn pending_reminders_are_taken_once() {
        let tmp = tempfile::tempdir().unwrap();
        let state = AppState::new(tmp.path().to_path_buf());
        let item = ReminderItem {
            project: "p".into(),
            no: 1,
            title: "t".into(),
            code: "-0m".into(),
            at: d("2026-10-13").and_hms_opt(9, 0, 0).unwrap(),
            due: Some(d("2026-10-13")),
            due_time: None,
        };
        state.lock_fired().push_pending([item.clone()]);
        let json = serde_json::to_value(PendingRemindersDto {
            items: state.take_pending_reminders(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "items": [{
                "project": "p", "no": 1, "title": "t", "code": "-0m",
                "at": "2026-10-13T09:00", "due": "2026-10-13", "dueTime": null
            }] })
        );
        assert!(state.take_pending_reminders().is_empty());
        assert!(
            AppState::new(tmp.path().to_path_buf())
                .lock_fired()
                .pending
                .is_empty()
        );
    }

    #[test]
    fn snooze_until_parses_minutes_and_seconds() {
        assert_eq!(
            parse_local_datetime("2026-10-13T09:10").unwrap(),
            d("2026-10-13").and_hms_opt(9, 10, 0).unwrap()
        );
        assert_eq!(
            parse_local_datetime("2026-10-13T09:10:30").unwrap(),
            d("2026-10-13").and_hms_opt(9, 10, 30).unwrap()
        );
        assert!(parse_local_datetime("10分後").is_err());
        assert_eq!(permission_str(PermissionState::Granted), "granted");
        assert_eq!(permission_str(PermissionState::Denied), "denied");
        assert_eq!(
            permission_str(PermissionState::PromptWithRationale),
            "prompt"
        );
    }

    #[test]
    fn parse_recurrence_dto() {
        let r = parse_recurrence_in("毎週月曜");
        assert_eq!(r.rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=MO"));
        assert_eq!(r.label.as_deref(), Some("毎週月曜"));
        let r = parse_recurrence_in("あした");
        assert_eq!(r.rrule, None);
        assert_eq!(r.label, None);
        let s = summarize_recurrence_in("FREQ=WEEKLY;BYDAY=MO", d("2026-10-15"));
        assert!(s.valid);
        assert_eq!(s.label, "毎週月曜");
        let s = summarize_recurrence_in("FREQ=SOMETIMES", d("2026-10-15"));
        assert!(!s.valid);
        assert_eq!(s.label, "FREQ=SOMETIMES");
        // A finished rule (COUNT used up) is still well-formed.
        let s = summarize_recurrence_in("FREQ=DAILY;COUNT=1", d("2026-10-15"));
        assert!(s.valid);
    }

    #[test]
    fn quick_add_with_a_recurrence_starts_on_the_first_occurrence() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        // 2026-10-14 is a Wednesday: the next Tuesday is 10-20.
        let out =
            quick_add_in(&mut store, "ゴミ出し 毎週火曜 8:00", INBOX, d("2026-10-14")).unwrap();
        assert_eq!(out.parsed.due, Some(d("2026-10-20")));
        let t = &out.view.tasks[0];
        assert_eq!(t.title, "ゴミ出し");
        assert_eq!(t.due, Some(d("2026-10-20")));
        assert_eq!(t.rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=TU"));
        assert_eq!(t.rrule_label.as_deref(), Some("毎週火曜"));
        // When today matches, the first occurrence is today.
        let out = quick_add_in(&mut store, "朝会 毎週火曜", INBOX, d("2026-10-13")).unwrap();
        assert_eq!(out.parsed.due, Some(d("2026-10-13")));
        // Rules without a weekday / day anchor start today.
        let out = quick_add_in(&mut store, "週報 毎週", INBOX, d("2026-10-14")).unwrap();
        assert_eq!(out.parsed.due, Some(d("2026-10-14")));
        let out = quick_add_in(&mut store, "家賃 毎月", INBOX, d("2026-10-14")).unwrap();
        assert_eq!(out.parsed.due, Some(d("2026-10-14")));
        // An explicit date wins over the first occurrence.
        let out = quick_add_in(&mut store, "x 毎週火曜 明日", INBOX, d("2026-10-14")).unwrap();
        assert_eq!(out.parsed.due, Some(d("2026-10-15")));
        assert_eq!(out.parsed.rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=TU"));
    }

    #[test]
    fn settings_dto_carries_the_phase3_settings() {
        let tmp = tempfile::tempdir().unwrap();
        let store = open_store(tmp.path());
        let dto = settings_dto(&store);
        assert_eq!(dto.default_reminder.as_deref(), Some("-0m"));
        assert_eq!(dto.notify_time, "09:00");
        assert!(dto.keep_in_tray && dto.notifications);
        let json = serde_json::to_value(&dto).unwrap();
        assert_eq!(json["notifyTime"], "09:00");
        assert_eq!(json["defaultReminder"], "-0m");
    }

    #[test]
    fn quick_add_uses_default_project_unless_hash_names_one() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        store.create_project("仕事", "var(--c1)").unwrap();

        let out = quick_add_in(&mut store, "牛乳を買う 明日", "仕事", d("2026-10-14")).unwrap();
        assert_eq!(out.view.project.name, "仕事");
        assert_eq!(out.view.tasks.len(), 1);
        assert_eq!(out.view.tasks[0].title, "牛乳を買う");
        assert_eq!(out.view.tasks[0].due, Some(d("2026-10-15")));
        assert_eq!(out.no, out.view.tasks[0].no);

        // The returned no is the task just added, not an older one.
        let out = quick_add_in(&mut store, "二つ目", "仕事", d("2026-10-14")).unwrap();
        assert_eq!(
            out.view
                .tasks
                .iter()
                .find(|t| t.no == out.no)
                .unwrap()
                .title,
            "二つ目"
        );

        let out = quick_add_in(&mut store, "資料 #受信トレイ p1", "仕事", d("2026-10-14")).unwrap();
        assert_eq!(out.view.project.name, "受信トレイ");
        assert_eq!(out.parsed.project.as_deref(), Some("受信トレイ"));
        assert_eq!(out.view.tasks[0].priority.0, 1);

        // An unknown #name stays in the title and goes to the default project.
        let out = quick_add_in(&mut store, "メモ #nothing", "仕事", d("2026-10-14")).unwrap();
        assert_eq!(out.view.project.name, "仕事");
        assert!(out.view.tasks.iter().any(|t| t.title == "メモ #nothing"));
    }

    #[test]
    fn quick_add_rejects_unknown_default_project_and_empty_title() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        let err = quick_add_in(&mut store, "x", "nope", d("2026-10-14")).unwrap_err();
        assert!(matches!(err, AppError::NotFound { .. }));
        let err = quick_add_in(&mut store, "  ", INBOX, d("2026-10-14")).unwrap_err();
        assert!(matches!(err, AppError::Invalid { .. }));
    }

    #[test]
    fn startup_first_run_missing_dir_and_existing_dir() {
        let app_dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let state = AppState::new(app_dir.path().to_path_buf());

        // No settings.json: first run.
        let dto = startup(&state).unwrap();
        assert!(dto.data_dir.is_none() && dto.warning.is_none());

        // Broken settings.json: also first run, not an error.
        std::fs::write(app_dir.path().join(AppSettings::FILE), "{ nope").unwrap();
        let dto = startup(&state).unwrap();
        assert!(dto.data_dir.is_none() && dto.warning.is_none());

        // Saved folder that no longer exists: onboarding with a warning.
        let gone = data.path().join("gone");
        AppSettings {
            data_dir: Some(gone),
            ..AppSettings::default()
        }
        .save(app_dir.path())
        .unwrap();
        let dto = startup(&state).unwrap();
        assert!(dto.data_dir.is_none());
        assert!(dto.warning.unwrap().contains("gone"));
        assert!(state.lock_store().is_none());

        // set_data_dir creates the folder and remembers it.
        let chosen = data.path().join("PowerToDo");
        let dto = switch_data_dir(&state, chosen.to_str().unwrap()).unwrap();
        assert_eq!(dto.data_dir.as_deref(), chosen.to_str());
        assert!(chosen.join("_PowerToDo.xlsx").exists());
        assert!(chosen.join("受信トレイ.xlsx").exists());
        let saved = AppSettings::load(app_dir.path()).unwrap();
        assert_eq!(saved.data_dir.as_deref(), Some(chosen.as_path()));

        // A fresh state (next launch) opens that folder without creating anything.
        let next = AppState::new(app_dir.path().to_path_buf());
        let dto = startup(&next).unwrap();
        assert_eq!(dto.data_dir.as_deref(), chosen.to_str());
        assert_eq!(dto.projects.len(), 1);
    }

    #[test]
    fn choosing_another_data_folder_keeps_the_sync_settings() {
        use crate::store::paths::{SyncBackend, SyncSettings};
        let app_dir = tempfile::tempdir().unwrap();
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        AppSettings {
            data_dir: Some(a.path().to_path_buf()),
            sync: SyncSettings {
                backend: SyncBackend::Nas,
                nas_url: Some("http://nas:5005/powertodo/".into()),
                nas_user: Some("たろう".into()),
                google_email: None,
            },
            ..AppSettings::default()
        }
        .save(app_dir.path())
        .unwrap();
        let state = AppState::new(app_dir.path().to_path_buf());
        startup(&state).unwrap();
        switch_data_dir(&state, b.path().to_str().unwrap()).unwrap();
        let saved = AppSettings::load(app_dir.path()).unwrap();
        assert_eq!(saved.data_dir.as_deref(), Some(b.path()));
        assert_eq!(saved.sync.backend, SyncBackend::Nas);
        assert_eq!(saved.sync.nas_user.as_deref(), Some("たろう"));
    }

    #[test]
    fn startup_surfaces_a_corrupt_common_workbook() {
        let app_dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        std::fs::write(data.path().join("_PowerToDo.xlsx"), "not a workbook").unwrap();
        AppSettings {
            data_dir: Some(data.path().to_path_buf()),
            ..AppSettings::default()
        }
        .save(app_dir.path())
        .unwrap();
        let state = AppState::new(app_dir.path().to_path_buf());
        assert!(matches!(startup(&state), Err(AppError::Corrupt { .. })));
    }

    #[test]
    fn switching_data_dir_flushes_unsaved_edits_of_the_old_one() {
        let app_dir = tempfile::tempdir().unwrap();
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let state = AppState::new(app_dir.path().to_path_buf());
        switch_data_dir(&state, a.path().to_str().unwrap()).unwrap();
        with_store(&state, |s| {
            quick_add_in(s, "未保存", INBOX, d("2026-10-14")).map(|_| ())
        })
        .unwrap();
        switch_data_dir(&state, b.path().to_str().unwrap()).unwrap();
        // Back to the first folder: the task was written before leaving.
        let dto = switch_data_dir(&state, a.path().to_str().unwrap()).unwrap();
        assert_eq!(dto.projects[0].task_count, 1);
    }

    #[test]
    fn flush_all_saves_every_dirty_project_even_if_one_write_fails() {
        use crate::store::common_book::read_common_book;
        use crate::store::project_book::read_project_book;

        let app_dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let state = AppState::new(app_dir.path().to_path_buf());
        switch_data_dir(&state, data.path().to_str().unwrap()).unwrap();
        with_store(&state, |s| {
            s.create_project("aaa", "")?;
            s.create_project("bbb", "")?;
            quick_add_in(s, "A の作業", "aaa", d("2026-10-14"))?;
            quick_add_in(s, "B の作業", "bbb", d("2026-10-14"))?;
            let mut settings = s.settings();
            settings.display_name = "終了時".into();
            s.update_settings(settings).map(|_| ())
        })
        .unwrap();

        // "aaa" sorts first; make its file unwritable by putting a directory in its place.
        let aaa = data.path().join("aaa.xlsx");
        std::fs::remove_file(&aaa).unwrap();
        std::fs::create_dir(&aaa).unwrap();
        // The directory is what we "know" now, so this is a failed write, not an external change
        // (those go to a recovery copy instead).
        with_store(&state, |s| {
            s.accept_disk_state("aaa");
            Ok(())
        })
        .unwrap();

        let failures = state.flush_all();
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].0, "aaa");

        let bbb = read_project_book(&data.path().join("bbb.xlsx")).unwrap();
        assert_eq!(bbb.tasks.len(), 1);
        assert_eq!(bbb.tasks[0].title, "B の作業");
        let common = read_common_book(&data.path().join("_PowerToDo.xlsx")).unwrap();
        assert_eq!(common.settings.display_name, "終了時");
        let store = state.lock_store();
        let store = store.as_ref().unwrap();
        assert_eq!(store.dirty_projects(), vec!["aaa".to_string()]);
        assert!(!store.common_dirty());
    }

    #[test]
    fn mutating_without_a_data_dir_is_invalid() {
        let app_dir = tempfile::tempdir().unwrap();
        let state = AppState::new(app_dir.path().to_path_buf());
        let err = with_store(&state, |s| Ok(s.summaries())).unwrap_err();
        assert!(matches!(err, AppError::Invalid { .. }));
    }

    #[test]
    fn upcoming_view_rejects_out_of_range_days() {
        assert!(matches!(check_days(0), Err(AppError::Invalid { .. })));
        assert!(matches!(check_days(92), Err(AppError::Invalid { .. })));
        assert_eq!(check_days(91).unwrap(), 91);
    }

    #[test]
    fn parse_ymd_rejects_garbage() {
        assert!(matches!(
            parse_ymd("2026-13-01"),
            Err(AppError::Invalid { .. })
        ));
        assert_eq!(parse_ymd("2026-10-13").unwrap(), d("2026-10-13"));
    }

    // ---- external changes ----

    /// Simulates Excel saving `file` in `dir`: a second store works on a copy of the folder,
    /// `edit` changes it and it is written; then that one file is copied back over the
    /// original (new modification time, different content).
    fn excel_saves(dir: &Path, file: &str, edit: impl FnOnce(&mut ProjectStore)) {
        let copy = tempfile::tempdir().unwrap();
        for e in std::fs::read_dir(dir).unwrap().filter_map(Result::ok) {
            if e.file_type().unwrap().is_file() {
                std::fs::copy(e.path(), copy.path().join(e.file_name())).unwrap();
            }
        }
        let mut other = open_store(copy.path());
        edit(&mut other);
        assert!(flush(&mut other, &BTreeSet::new()).is_empty());
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::copy(copy.path().join(file), dir.join(file)).unwrap();
    }

    /// Runs one batch with a saver that has nothing pending unless `busy`; returns the outcome
    /// and the keys whose timers were cancelled.
    fn run_batch(
        store: &mut ProjectStore,
        busy: bool,
        paths: &[PathBuf],
    ) -> (BatchOutcome, Vec<String>) {
        let cancelled = std::cell::RefCell::new(Vec::new());
        let out = apply_fs_batch(
            store,
            &|_| busy,
            &|key| cancelled.borrow_mut().push(key.to_string()),
            paths.to_vec(),
        );
        (out, cancelled.into_inner())
    }

    fn titles(store: &ProjectStore, project: &str) -> Vec<String> {
        store
            .view(project)
            .unwrap()
            .tasks
            .into_iter()
            .map(|t| t.title)
            .collect()
    }

    #[test]
    fn own_writes_and_noise_are_not_external_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        quick_add_in(&mut store, "自分", INBOX, d("2026-10-14")).unwrap();
        store.save(INBOX).unwrap();
        store.update_settings(store.settings()).unwrap();
        store.save_common().unwrap();
        let (out, cancelled) = run_batch(
            &mut store,
            false,
            &[
                tmp.path().join("受信トレイ.xlsx"),
                tmp.path().join("_PowerToDo.xlsx"),
                tmp.path().join("~$受信トレイ.xlsx"),
                tmp.path().join(".powertodo-x1.tmp"),
                tmp.path().join("archive").join("x.xlsx"),
            ],
        );
        assert!(out.is_empty(), "{out:?}");
        assert!(cancelled.is_empty());
    }

    fn scan(store: &mut ProjectStore, busy: bool) -> (BatchOutcome, Vec<String>) {
        let paths = scan_paths(store);
        run_batch(store, busy, &paths)
    }

    #[test]
    fn scan_paths_lists_files_on_disk_and_known_projects() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        store.create_project("残る", "#e44").unwrap();
        store.create_project("消える", "#e44").unwrap();
        std::fs::remove_file(tmp.path().join("消える.xlsx")).unwrap();
        excel_saves(tmp.path(), "受信トレイ.xlsx", |_| {});
        std::fs::copy(tmp.path().join("残る.xlsx"), tmp.path().join("新しい.xlsx")).unwrap();
        std::fs::copy(tmp.path().join("残る.xlsx"), tmp.path().join("~$残る.xlsx")).unwrap();
        std::fs::create_dir(tmp.path().join("archive")).unwrap();
        std::fs::copy(
            tmp.path().join("残る.xlsx"),
            tmp.path().join("archive").join("古い.xlsx"),
        )
        .unwrap();
        let got: BTreeSet<PathBuf> = scan_paths(&store).into_iter().collect();
        let list = scan_paths(&store);
        assert_eq!(list.len(), got.len(), "no duplicates: {list:?}");
        for name in ["_PowerToDo", "受信トレイ", "残る", "消える", "新しい"] {
            assert!(
                got.contains(&tmp.path().join(format!("{name}.xlsx"))),
                "{name}"
            );
        }
        assert!(
            !got.iter()
                .any(|p| p.starts_with(tmp.path().join("archive")))
        );
        // Applied as a batch the scan finds the gone and the new project.
        let (out, _) = run_batch(&mut store, false, &list);
        assert!(out.projects_changed);
        assert!(out.failures.is_empty());
    }

    #[test]
    fn ios_scan_reloads_an_external_edit() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        excel_saves(tmp.path(), "受信トレイ.xlsx", |o| {
            quick_add_in(o, "Excel で追加", INBOX, d("2026-10-14")).unwrap();
        });
        let (out, _) = scan(&mut store, false);
        assert_eq!(out.reloaded, vec![INBOX.to_string()]);
        assert_eq!(titles(&store, INBOX), vec!["Excel で追加".to_string()]);
    }

    #[test]
    fn ios_scan_holds_a_dirty_project() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        quick_add_in(&mut store, "未保存", INBOX, d("2026-10-14")).unwrap();
        excel_saves(tmp.path(), "受信トレイ.xlsx", |o| {
            quick_add_in(o, "Excel で追加", INBOX, d("2026-10-14")).unwrap();
        });
        let (out, cancelled) = scan(&mut store, false);
        assert_eq!(out.held, vec![INBOX.to_string()]);
        assert_eq!(cancelled, vec![INBOX.to_string()]);
        assert_eq!(titles(&store, INBOX), vec!["未保存".to_string()]);
    }

    #[test]
    fn ios_scan_ignores_own_writes() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        quick_add_in(&mut store, "自分", INBOX, d("2026-10-14")).unwrap();
        store.save(INBOX).unwrap();
        store.save_common().unwrap();
        let (out, cancelled) = scan(&mut store, false);
        assert!(out.is_empty(), "{out:?}");
        assert!(cancelled.is_empty());
    }

    fn container(root: &Path, id: &str) -> PathBuf {
        root.join("Containers/Data/Application")
            .join(id)
            .join("Documents")
    }

    #[test]
    fn a_moved_container_keeps_the_sync_and_fired_records() {
        use crate::sync::state::{BackendKind, FileRecord};
        let tmp = tempfile::tempdir().unwrap();
        let app = tmp.path().join("app");
        let old = container(tmp.path(), "AAAA");
        let new = container(tmp.path(), "BBBB");
        let mut state = SyncState::new(&old, BackendKind::Nas, "http://nas:5005/powertodo/");
        state.files.insert(
            "受信トレイ.xlsx".into(),
            FileRecord {
                remote_id: "id".into(),
                remote_version: "v1".into(),
                remote_modified: fixed_now(),
                local_hash: "h".into(),
            },
        );
        state.save(&app).unwrap();
        let mut fired = Fired {
            data_dir: Some(old.clone()),
            last_seen: Some(fixed_now()),
            ..Fired::default()
        };
        fired.save(&app).unwrap();
        assert!(migrate_moved_container(&app, &mut fired, &old, &new));
        let loaded = SyncState::load(&app, &new, BackendKind::Nas, "http://nas:5005/powertodo/");
        assert_eq!(loaded.files, state.files);
        assert_eq!(fired.data_dir.as_deref(), Some(new.as_path()));
        assert_eq!(Fired::load(&app).data_dir.as_deref(), Some(new.as_path()));
        // Binding to the new folder keeps the records instead of dropping them.
        assert!(!fired.bind(&new));
    }

    #[test]
    fn other_folders_are_not_migrated() {
        use crate::sync::state::BackendKind;
        let tmp = tempfile::tempdir().unwrap();
        let app = tmp.path().join("app");
        let new = container(tmp.path(), "BBBB");
        for old in [tmp.path().join("Documents"), tmp.path().join("elsewhere")] {
            let state = SyncState::new(&old, BackendKind::Nas, "r");
            state.save(&app).unwrap();
            let mut fired = Fired {
                data_dir: Some(old.clone()),
                ..Fired::default()
            };
            assert!(!migrate_moved_container(&app, &mut fired, &old, &new));
            assert_eq!(fired.data_dir.as_deref(), Some(old.as_path()));
            assert!(
                SyncState::load(&app, &new, BackendKind::Nas, "r")
                    .files
                    .is_empty()
            );
            // Compare the parsed path: in the JSON text a Windows path has its `\` escaped.
            let raw = std::fs::read_to_string(app.join(SyncState::FILE)).unwrap();
            let saved: serde_json::Value = serde_json::from_str(&raw).unwrap();
            assert_eq!(saved["dataDir"].as_str(), Some(&*old.to_string_lossy()));
        }
        // The same folder is not a move either.
        let mut fired = Fired::default();
        assert!(!migrate_moved_container(&app, &mut fired, &new, &new));
    }

    #[test]
    fn clean_project_changed_in_excel_is_reloaded() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        excel_saves(tmp.path(), "受信トレイ.xlsx", |o| {
            quick_add_in(o, "Excel で追加", INBOX, d("2026-10-14")).unwrap();
        });
        let (out, _) = run_batch(&mut store, false, &[tmp.path().join("受信トレイ.xlsx")]);
        assert_eq!(out.reloaded, vec![INBOX.to_string()]);
        assert!(out.held.is_empty() && out.failures.is_empty());
        assert_eq!(titles(&store, INBOX), vec!["Excel で追加".to_string()]);
        // The same event again (the file is now what we read): nothing to do.
        let (again, _) = run_batch(&mut store, false, &[tmp.path().join("受信トレイ.xlsx")]);
        assert!(again.is_empty());
    }

    #[test]
    fn project_with_unsaved_edits_is_held_until_resolved() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        quick_add_in(&mut store, "未保存", INBOX, d("2026-10-14")).unwrap();
        excel_saves(tmp.path(), "受信トレイ.xlsx", |o| {
            quick_add_in(o, "Excel で追加", INBOX, d("2026-10-14")).unwrap();
        });
        let path = tmp.path().join("受信トレイ.xlsx");
        let (out, cancelled) = run_batch(&mut store, false, std::slice::from_ref(&path));
        assert_eq!(out.held, vec![INBOX.to_string()]);
        assert_eq!(cancelled, vec![INBOX.to_string()]);
        assert!(out.reloaded.is_empty());
        assert_eq!(titles(&store, INBOX), vec!["未保存".to_string()]);
        assert!(store.is_held(INBOX));
        // Another event while waiting: no second banner, nothing cancelled again.
        let (again, cancelled) = run_batch(&mut store, false, &[path]);
        assert!(again.is_empty() && cancelled.is_empty());
        // Quitting or switching folders must not write the held project.
        assert!(flush(&mut store, &BTreeSet::new()).is_empty());
        assert_eq!(store.dirty_projects(), vec![INBOX.to_string()]);
        // "Reload": ours is dropped, theirs is shown.
        store.release(INBOX);
        store.reload_discarding(INBOX).unwrap();
        assert_eq!(titles(&store, INBOX), vec!["Excel で追加".to_string()]);
        assert!(store.held_projects().is_empty());
    }

    #[test]
    fn overwrite_after_hold_writes_ours_over_theirs() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        quick_add_in(&mut store, "未保存", INBOX, d("2026-10-14")).unwrap();
        excel_saves(tmp.path(), "受信トレイ.xlsx", |o| {
            quick_add_in(o, "Excel で追加", INBOX, d("2026-10-14")).unwrap();
        });
        let path = tmp.path().join("受信トレイ.xlsx");
        run_batch(&mut store, false, std::slice::from_ref(&path));
        store.release(INBOX);
        store.save(INBOX).unwrap();
        let on_disk = crate::store::project_book::read_project_book(&path).unwrap();
        assert_eq!(on_disk.tasks.len(), 1);
        assert_eq!(on_disk.tasks[0].title, "未保存");
        // Our write is not mistaken for another external change.
        let (out, _) = run_batch(&mut store, false, &[path]);
        assert!(out.is_empty());
    }

    #[test]
    fn a_save_in_flight_holds_the_project_too() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        excel_saves(tmp.path(), "受信トレイ.xlsx", |o| {
            quick_add_in(o, "Excel で追加", INBOX, d("2026-10-14")).unwrap();
        });
        let (out, cancelled) = run_batch(&mut store, true, &[tmp.path().join("受信トレイ.xlsx")]);
        assert_eq!(out.held, vec![INBOX.to_string()]);
        assert_eq!(cancelled, vec![INBOX.to_string()]);
    }

    #[test]
    fn removed_file_marks_project_missing_and_coming_back_reloads_it() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        store.create_project("aaa", "").unwrap();
        let path = tmp.path().join("aaa.xlsx");
        let keep = tmp.path().join("keep.xlsx");
        std::fs::rename(&path, &keep).unwrap();
        let (out, _) = run_batch(&mut store, false, std::slice::from_ref(&path));
        assert!(out.projects_changed);
        let aaa = store
            .summaries()
            .into_iter()
            .find(|p| p.name == "aaa")
            .unwrap();
        assert!(aaa.load_error.is_some());

        std::fs::rename(&keep, &path).unwrap();
        let (out, _) = run_batch(&mut store, false, &[path]);
        assert_eq!(out.reloaded, vec!["aaa".to_string()]);
        let aaa = store
            .summaries()
            .into_iter()
            .find(|p| p.name == "aaa")
            .unwrap();
        assert!(aaa.load_error.is_none());
    }

    #[test]
    fn deleting_or_renaming_a_project_in_the_app_is_not_an_external_change() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        store.create_project("aaa", "").unwrap();
        store.create_project("bbb", "").unwrap();
        store.rename_project("aaa", "ccc").unwrap();
        store.delete_project("bbb").unwrap();
        store.save_common().unwrap();
        let (out, _) = run_batch(
            &mut store,
            false,
            &[
                tmp.path().join("aaa.xlsx"),
                tmp.path().join("ccc.xlsx"),
                tmp.path().join("bbb.xlsx"),
                tmp.path().join("_PowerToDo.xlsx"),
            ],
        );
        assert!(out.is_empty(), "{out:?}");
    }

    #[test]
    fn new_workbook_in_the_folder_is_adopted() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        excel_saves(tmp.path(), "新規.xlsx", |o| {
            o.create_project("新規", "").unwrap();
        });
        let (out, _) = run_batch(&mut store, false, &[tmp.path().join("新規.xlsx")]);
        assert!(out.projects_changed);
        assert!(!out.common_reloaded, "the common workbook was not read");
        assert!(store.summaries().iter().any(|p| p.name == "新規"));
        assert!(store.common_dirty(), "the common workbook must list it");
    }

    #[test]
    fn common_workbook_changed_in_excel_is_reloaded_or_held() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        excel_saves(tmp.path(), "_PowerToDo.xlsx", |o| {
            let mut settings = o.settings();
            settings.display_name = "Excel".into();
            o.update_settings(settings).unwrap();
        });
        let common = tmp.path().join("_PowerToDo.xlsx");
        let (out, _) = run_batch(&mut store, false, std::slice::from_ref(&common));
        assert!(out.projects_changed && out.common_reloaded && out.held.is_empty());
        assert_eq!(store.settings().display_name, "Excel");
        assert!(!store.common_dirty());

        // With unsaved edits to the common workbook it is held instead.
        let mut settings = store.settings();
        settings.display_name = "アプリ".into();
        store.update_settings(settings).unwrap();
        excel_saves(tmp.path(), "_PowerToDo.xlsx", |o| {
            let mut settings = o.settings();
            settings.display_name = "Excel 2".into();
            o.update_settings(settings).unwrap();
        });
        let (out, cancelled) = run_batch(&mut store, false, &[common]);
        assert_eq!(out.held, vec![COMMON_KEY.to_string()]);
        assert_eq!(cancelled, vec![COMMON_KEY.to_string()]);
        assert_eq!(store.settings().display_name, "アプリ");
        assert!(flush(&mut store, &BTreeSet::new()).is_empty());
        assert!(
            store.common_dirty(),
            "a held common workbook is not written"
        );
        assert_eq!(store.held_projects(), vec![COMMON_KEY.to_string()]);
    }

    #[test]
    fn switching_data_dir_is_refused_while_a_project_is_held() {
        let app_dir = tempfile::tempdir().unwrap();
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let state = AppState::new(app_dir.path().to_path_buf());
        switch_data_dir(&state, a.path().to_str().unwrap()).unwrap();
        with_store(&state, |s| {
            s.hold(INBOX);
            Ok(())
        })
        .unwrap();
        assert_eq!(state.held_projects(), vec![INBOX.to_string()]);
        let err = switch_data_dir(&state, b.path().to_str().unwrap()).unwrap_err();
        assert!(matches!(err, AppError::Unsaved { .. }));
        assert_eq!(state.held_projects(), vec![INBOX.to_string()]);
    }

    // ---- fix round 1 ----

    #[test]
    fn case_only_rename_does_not_adopt_the_old_spelling() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        store.create_project("aaa", "").unwrap();
        store.rename_project("aaa", "AAA").unwrap();
        store.save_common().unwrap();
        // On a case-insensitive file system the event names the old spelling, which still
        // resolves to the (renamed) file; elsewhere that path no longer exists.
        let (out, _) = run_batch(
            &mut store,
            false,
            &[tmp.path().join("aaa.xlsx"), tmp.path().join("AAA.xlsx")],
        );
        assert!(out.is_empty(), "{out:?}");
        let names: Vec<String> = store.summaries().into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec![INBOX.to_string(), "AAA".to_string()]);
    }

    #[test]
    fn an_unreadable_common_workbook_is_not_reported_as_reloaded() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        excel_saves(tmp.path(), "新規.xlsx", |o| {
            o.create_project("新規", "").unwrap();
        });
        // Excel is mid-save on the common workbook: the file is not a workbook yet.
        let common = tmp.path().join("_PowerToDo.xlsx");
        std::fs::write(&common, b"not a workbook").unwrap();
        let (out, _) = run_batch(&mut store, false, &[common, tmp.path().join("新規.xlsx")]);
        // The new file is adopted (the list changed) but `_common` was not re-read, so the UI
        // must keep its read-failure banner.
        assert!(out.projects_changed);
        assert!(!out.common_reloaded);
        assert_eq!(out.failures.len(), 1);
        assert_eq!(out.failures[0].0, COMMON_KEY);
    }

    #[test]
    fn a_genuinely_new_file_is_still_adopted_next_to_listed_ones() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        store.create_project("aaa", "").unwrap();
        excel_saves(tmp.path(), "bbb.xlsx", |o| {
            o.create_project("bbb", "").unwrap();
        });
        let (out, _) = run_batch(&mut store, false, &[tmp.path().join("bbb.xlsx")]);
        assert!(out.projects_changed);
        assert!(store.summaries().iter().any(|p| p.name == "bbb"));
    }

    #[test]
    fn writes_check_the_file_against_what_we_know() {
        use crate::store::common_book::read_common_book;
        use crate::store::project_book::read_project_book;

        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        assert!(!store.changed_on_disk(INBOX) && !store.changed_on_disk(COMMON_KEY));
        // Excel saves both files; the watcher has not told us yet. Meanwhile we edit.
        excel_saves(tmp.path(), "受信トレイ.xlsx", |o| {
            quick_add_in(o, "Excel の作業", INBOX, d("2026-10-14")).unwrap();
        });
        excel_saves(tmp.path(), "_PowerToDo.xlsx", |o| {
            let mut settings = o.settings();
            settings.display_name = "Excel".into();
            o.update_settings(settings).unwrap();
        });
        quick_add_in(&mut store, "アプリの作業", INBOX, d("2026-10-14")).unwrap();
        let mut settings = store.settings();
        settings.display_name = "アプリ".into();
        store.update_settings(settings).unwrap();
        assert!(store.changed_on_disk(INBOX) && store.changed_on_disk(COMMON_KEY));

        // The exit flush refuses to write over them, reports it and leaves them dirty.
        let failures = flush(&mut store, &BTreeSet::new());
        let mut keys: Vec<&str> = failures.iter().map(|(k, _)| k.as_str()).collect();
        keys.sort();
        assert_eq!(keys, vec![COMMON_KEY, INBOX]);
        assert!(
            failures
                .iter()
                .all(|(_, e)| matches!(e, AppError::Unsaved { .. }))
        );
        assert_eq!(store.dirty_projects(), vec![INBOX.to_string()]);
        assert!(store.common_dirty());
        // Keys that already have a recovery copy are not reported again, and stay dirty.
        let recovered: BTreeSet<String> = [COMMON_KEY.to_string(), INBOX.to_string()].into();
        assert!(flush(&mut store, &recovered).is_empty());
        assert_eq!(store.dirty_projects(), vec![INBOX.to_string()]);
        assert!(store.common_dirty());
        let inbox = read_project_book(&tmp.path().join("受信トレイ.xlsx")).unwrap();
        assert_eq!(inbox.tasks[0].title, "Excel の作業");
        let common = read_common_book(&tmp.path().join("_PowerToDo.xlsx")).unwrap();
        assert_eq!(common.settings.display_name, "Excel");

        // Overwrite chosen: the file's state is accepted, then the write goes through.
        store.accept_disk_state(INBOX);
        store.accept_disk_state(COMMON_KEY);
        assert!(!store.changed_on_disk(INBOX) && !store.changed_on_disk(COMMON_KEY));
        assert!(flush(&mut store, &BTreeSet::new()).is_empty());
        let inbox = read_project_book(&tmp.path().join("受信トレイ.xlsx")).unwrap();
        assert_eq!(inbox.tasks[0].title, "アプリの作業");
    }

    #[test]
    fn create_rename_delete_do_not_write_a_held_common_workbook() {
        use crate::store::common_book::read_common_book;

        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        store.create_project("aaa", "").unwrap();
        store.create_project("bbb", "").unwrap();
        let listed = |dir: &Path| -> Vec<String> {
            read_common_book(&dir.join("_PowerToDo.xlsx"))
                .unwrap()
                .projects
                .into_iter()
                .map(|p| p.name)
                .collect()
        };
        let before = listed(tmp.path());
        store.hold(COMMON_KEY);
        store.create_project("ccc", "").unwrap();
        store.rename_project("aaa", "aaa2").unwrap();
        store.delete_project("bbb").unwrap();
        assert_eq!(
            listed(tmp.path()),
            before,
            "the file is left as Excel has it"
        );
        assert!(store.common_dirty());
        // Released again, the next write lists everything.
        store.release(COMMON_KEY);
        store.save_common().unwrap();
        let after = listed(tmp.path());
        assert!(after.contains(&"ccc".to_string()) && after.contains(&"aaa2".to_string()));
        assert!(!after.contains(&"bbb".to_string()));
    }

    #[test]
    fn create_project_does_not_overwrite_a_common_workbook_changed_in_excel() {
        use crate::store::common_book::read_common_book;

        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        // Excel saves the common workbook; the watcher has not reported it yet.
        excel_saves(tmp.path(), "_PowerToDo.xlsx", |o| {
            let mut settings = o.settings();
            settings.display_name = "Excel 側".into();
            o.update_settings(settings).unwrap();
        });
        assert!(!store.is_held(COMMON_KEY));
        store.create_project("新規", "").unwrap();

        let on_disk = read_common_book(&tmp.path().join("_PowerToDo.xlsx")).unwrap();
        assert_eq!(on_disk.settings.display_name, "Excel 側", "not overwritten");
        assert!(!on_disk.projects.iter().any(|p| p.name == "新規"));
        assert!(store.is_held(COMMON_KEY));
        assert!(store.common_dirty());
        // The project itself exists in memory and on disk; the common workbook waits for the
        // banner's choice.
        assert!(tmp.path().join("新規.xlsx").exists());
        assert!(store.summaries().iter().any(|p| p.name == "新規"));
    }

    #[test]
    fn flush_all_keeps_held_and_externally_changed_edits_in_recovery_copies() {
        use crate::store::project_book::read_project_book;

        let app_dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let state = AppState::new(app_dir.path().to_path_buf());
        switch_data_dir(&state, data.path().to_str().unwrap()).unwrap();
        with_store(&state, |s| {
            s.create_project("aaa", "")?;
            s.create_project("bbb", "")?;
            quick_add_in(s, "A の作業", "aaa", d("2026-10-14"))?;
            quick_add_in(s, "B の作業", "bbb", d("2026-10-14"))?;
            s.hold("aaa");
            Ok(())
        })
        .unwrap();
        // "bbb" changed in Excel while dirty; the watcher has not reported it.
        excel_saves(data.path(), "bbb.xlsx", |o| {
            quick_add_in(o, "Excel の作業", "bbb", d("2026-10-14")).unwrap();
        });

        // Both are in recovery copies, so nothing is reported as a failed write.
        assert!(state.flush_all().is_empty());

        let copies: Vec<PathBuf> = std::fs::read_dir(data.path().join("archive"))
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.path())
            .collect();
        assert_eq!(copies.len(), 2, "{copies:?}");
        for (project, title) in [("aaa", "A の作業"), ("bbb", "B の作業")] {
            let copy = copies
                .iter()
                .find(|p| {
                    let name = p.file_name().unwrap().to_string_lossy();
                    name.starts_with(&format!("{project} (未保存 ")) && name.ends_with(").xlsx")
                })
                .unwrap_or_else(|| panic!("no copy for {project}: {copies:?}"));
            assert_eq!(read_project_book(copy).unwrap().tasks[0].title, title);
        }
        // The files themselves keep what is on disk.
        assert!(
            read_project_book(&data.path().join("aaa.xlsx"))
                .unwrap()
                .tasks
                .is_empty()
        );
        let bbb = read_project_book(&data.path().join("bbb.xlsx")).unwrap();
        assert_eq!(bbb.tasks.len(), 1);
        assert_eq!(bbb.tasks[0].title, "Excel の作業");
    }

    #[test]
    fn unreadable_external_file_keeps_the_book_and_is_retried() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        excel_saves(tmp.path(), "受信トレイ.xlsx", |o| {
            quick_add_in(o, "Excel の作業", INBOX, d("2026-10-14")).unwrap();
        });
        let path = tmp.path().join("受信トレイ.xlsx");
        let good = std::fs::read(&path).unwrap();
        quick_add_in(&mut store, "手元", INBOX, d("2026-10-14")).unwrap();
        store.save(INBOX).unwrap();
        std::fs::write(&path, b"not a workbook").unwrap();

        let (out, _) = run_batch(&mut store, false, std::slice::from_ref(&path));
        assert!(out.reloaded.is_empty() && out.held.is_empty() && !out.projects_changed);
        assert_eq!(out.failures.len(), 1);
        assert_eq!(out.failures[0].0, INBOX);
        assert_eq!(titles(&store, INBOX), vec!["手元".to_string()]);
        let summary = store.summaries().into_iter().next().unwrap();
        assert!(
            summary.load_error.is_none(),
            "must not become a failed project"
        );
        assert!(store.changed_on_disk(INBOX), "the old record is kept");

        // Excel finishes: the next event re-reads it.
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&path, good).unwrap();
        let (out, _) = run_batch(&mut store, false, std::slice::from_ref(&path));
        assert_eq!(out.reloaded, vec![INBOX.to_string()]);
        assert_eq!(titles(&store, INBOX), vec!["Excel の作業".to_string()]);
    }

    #[test]
    fn failed_external_reload_keeps_unsaved_edits_and_the_hold() {
        let tmp = tempfile::tempdir().unwrap();
        let mut store = open_store(tmp.path());
        quick_add_in(&mut store, "未保存", INBOX, d("2026-10-14")).unwrap();
        store.hold(INBOX);
        std::fs::write(tmp.path().join("受信トレイ.xlsx"), b"not a workbook").unwrap();
        assert!(store.reload_external(INBOX).is_err());
        assert!(store.is_held(INBOX));
        assert_eq!(store.dirty_projects(), vec![INBOX.to_string()]);
        assert_eq!(titles(&store, INBOX), vec!["未保存".to_string()]);
    }

    #[test]
    fn vanished_data_folder_marks_everything_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path().join("data");
        std::fs::create_dir(&data).unwrap();
        let mut store = open_store(&data);
        store.create_project("aaa", "").unwrap();
        quick_add_in(&mut store, "未保存", "aaa", d("2026-10-14")).unwrap();
        store.hold("aaa");
        std::fs::remove_dir_all(&data).unwrap();
        let (out, _) = run_batch(&mut store, false, &[data.join("aaa.xlsx")]);
        assert!(out.data_dir_missing && out.projects_changed);
        assert!(out.reloaded.is_empty() && out.held.is_empty());
        assert!(store.summaries().iter().all(|p| p.load_error.is_some()));
        assert!(store.held_projects().is_empty());
        assert!(store.dirty_projects().is_empty());
    }
}
