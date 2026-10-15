//! Tauri commands. They are thin: lock the store, call one `ProjectStore` method, mark what
//! changed for the debounced [`Saver`], and return the new view. The few non-trivial bits
//! (start-up, quick add) live in plain functions so they can be tested without Tauri.

pub mod saver;

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use chrono::{Local, NaiveDate, NaiveDateTime, NaiveTime};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::domain::model::{INBOX, TaskInput, TaskPatch};
use crate::domain::quick_add::{QuickAddResult, parse};
use crate::domain::recurrence;
use crate::domain::search;
use crate::domain::search::Hit;
use crate::domain::views::{self, DayGroup};
use crate::domain::{Label, Task};
use crate::error::{AppError, AppResult};
use crate::platform;
use crate::store::common_book::Settings;
use crate::store::external::{FileKind, Verdict, classify_path, fingerprint, verdict};
use crate::store::paths::{AppSettings, Paths};
use crate::store::project_store::{ProjectStore, ProjectSummary, ProjectView};
use crate::store::watcher::{self, Watcher};

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
    app_data_dir: PathBuf,
}

// Lock order (never the reverse): `store`, then `saver.pending`. The watcher thread holds the
// store lock while it asks the saver about / cancels a pending save; `TauriSink::save` runs in
// a saver task that is not holding `pending` when it takes the store lock. `saving` and
// `app_settings` are leaf locks (nothing is acquired while holding them).

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
            app_data_dir,
        }
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickAddOutcome {
    pub parsed: QuickAddResult,
    pub view: ProjectView,
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

fn state_dto(store: Option<&ProjectStore>, warning: Option<String>) -> AppStateDto {
    AppStateDto {
        data_dir: store.map(dir_string),
        projects: store.map(ProjectStore::summaries).unwrap_or_default(),
        inbox: INBOX.to_string(),
        warning,
        watch_error: None,
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
    let settings = AppSettings {
        data_dir: Some(dir),
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

/// Starts (or restarts) watching the open data folder, replacing the previous watcher. Without
/// an open store, or when watching cannot start, no watcher is left running.
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
    Ok(QuickAddOutcome { parsed, view })
}

// ---- commands: app and data folder ----

#[tauri::command]
pub async fn app_state(app: AppHandle, state: State<'_, AppState>) -> AppResult<AppStateDto> {
    let dto = startup(state.inner())?;
    schedule_dirty(&app, state.inner());
    let watching = state
        .watcher
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some();
    if !watching {
        start_watching(&app, state.inner());
    }
    Ok(AppStateDto {
        watch_error: state.watch_error(),
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
    schedule_dirty(&app, state.inner());
    start_watching(&app, state.inner());
    Ok(AppStateDto {
        watch_error: state.watch_error(),
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
pub async fn reveal_data_dir(state: State<'_, AppState>) -> AppResult<()> {
    let dir = with_store(state.inner(), |s| Ok(s.paths().data_dir.clone()))?;
    platform::reveal_path(&dir)
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
    mutate_structure(&app, state.inner(), &[&new_name], |s| {
        s.rename_project(&name, &new_name)
    })
}

#[tauri::command]
pub async fn delete_project(
    name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    mutate_structure(&app, state.inner(), &[], |s| s.delete_project(&name))
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
    mutate(&app, state.inner(), &[&project], false, |s| {
        s.update_task(&project, no, patch)
    })
}

#[tauri::command]
pub async fn complete_task(
    project: String,
    no: u32,
    done: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ProjectView> {
    mutate(&app, state.inner(), &[&project], false, |s| {
        s.complete_task(&project, no, done)
    })
}

#[tauri::command]
pub async fn delete_task(
    project: String,
    no: u32,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ProjectView> {
    mutate(&app, state.inner(), &[&project], false, |s| {
        s.delete_task(&project, no)
    })
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

#[tauri::command]
pub async fn reschedule_overdue(
    today: String,
    due: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ChangedProjects> {
    let today = parse_ymd(&today)?;
    let due = parse_ymd(&due)?;
    let changed = mutate(&app, state.inner(), &[], false, |s| {
        s.reschedule_overdue(today, due)
    })?;
    for p in &changed {
        state.saver.schedule(app.clone(), p.clone());
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
        let failed = AppStateDto {
            watch_error: Some("inotify".into()),
            ..state_dto(Some(&store), None)
        };
        assert_eq!(
            serde_json::to_value(failed).unwrap()["watchError"],
            "inotify"
        );

        let first_run = serde_json::to_value(state_dto(None, Some("w".into()))).unwrap();
        assert!(first_run["dataDir"].is_null());
        assert_eq!(first_run["projects"], serde_json::json!([]));
        assert_eq!(first_run["warning"], "w");
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
    fn startup_surfaces_a_corrupt_common_workbook() {
        let app_dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        std::fs::write(data.path().join("_PowerToDo.xlsx"), "not a workbook").unwrap();
        AppSettings {
            data_dir: Some(data.path().to_path_buf()),
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
