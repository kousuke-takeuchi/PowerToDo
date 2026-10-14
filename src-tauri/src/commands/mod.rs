//! Tauri commands. They are thin: lock the store, call one `ProjectStore` method, mark what
//! changed for the debounced [`Saver`], and return the new view. The few non-trivial bits
//! (start-up, quick add) live in plain functions so they can be tested without Tauri.

pub mod saver;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use chrono::{Local, NaiveDate, NaiveDateTime};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::domain::model::{INBOX, TaskInput, TaskPatch};
use crate::domain::quick_add::{QuickAddResult, parse};
use crate::error::{AppError, AppResult};
use crate::platform;
use crate::store::common_book::Settings;
use crate::store::paths::{AppSettings, Paths};
use crate::store::project_store::{ProjectStore, ProjectSummary, ProjectView};

use saver::{COMMON_KEY, SaveSink, SaveStatus, Saver};

// ---- state and DTOs ----

pub struct AppState {
    /// `None` until a data folder has been chosen (or when the saved one is missing).
    pub store: Mutex<Option<ProjectStore>>,
    pub app_settings: Mutex<AppSettings>,
    pub saver: Saver,
    app_data_dir: PathBuf,
}

impl AppState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self::with_saver(app_data_dir, Saver::new())
    }

    pub fn with_saver(app_data_dir: PathBuf, saver: Saver) -> Self {
        AppState {
            store: Mutex::new(None),
            app_settings: Mutex::new(AppSettings::default()),
            saver,
            app_data_dir,
        }
    }

    fn lock_store(&self) -> MutexGuard<'_, Option<ProjectStore>> {
        self.store.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn lock_settings(&self) -> MutexGuard<'_, AppSettings> {
        self.app_settings.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Writes everything still dirty (used when the app quits). One failed write (say, a file
    /// locked by Excel) does not stop the others; each failure is logged and returned as
    /// `(project name or COMMON_KEY, error)`. Empty means everything was saved.
    pub fn flush_all(&self) -> Vec<(String, AppError)> {
        self.saver.cancel_all();
        let failures = self.lock_store().as_mut().map(flush).unwrap_or_default();
        for (name, e) in &failures {
            eprintln!("flush on exit failed for {name}: {e}");
        }
        failures
    }
}

/// Tries to save the common workbook and every dirty project, continuing past failures.
/// Returns the failures as `(project name or COMMON_KEY, error)`.
fn flush(store: &mut ProjectStore) -> Vec<(String, AppError)> {
    let mut failures = Vec::new();
    if store.common_dirty()
        && let Err(e) = store.save_common()
    {
        failures.push((COMMON_KEY.to_string(), e));
    }
    for name in store.dirty_projects() {
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ProjectChanged {
    name: String,
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
    }
}

// ---- saver glue ----

struct TauriSink {
    app: AppHandle,
}

impl SaveSink for TauriSink {
    fn save(&self, key: &str) -> AppResult<()> {
        let state = self.app.state::<AppState>();
        let mut guard = state.lock_store();
        // The store can be gone or already clean (a flush, a rename, a data folder switch).
        let Some(store) = guard.as_mut() else {
            return Ok(());
        };
        if key == COMMON_KEY {
            if store.common_dirty() {
                store.save_common()?;
            }
        } else if store.dirty_projects().iter().any(|p| p == key) {
            store.save(key)?;
        }
        Ok(())
    }

    fn report(&self, status: SaveStatus) {
        let _ = self.app.emit("save-status", status);
    }
}

impl Saver {
    pub fn schedule(&self, app: AppHandle, project: String) {
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
    // Never leave a folder with unsaved edits: any failed write aborts the switch.
    if let Some(old) = store.as_mut()
        && let Some((_, e)) = flush(old).into_iter().next()
    {
        return Err(e);
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

// ---- quick add ----

pub fn parse_quick_add_in(store: &ProjectStore, text: &str, today: NaiveDate) -> QuickAddResult {
    let projects: Vec<String> = store.summaries().into_iter().map(|p| p.name).collect();
    let labels: Vec<String> = store.labels().into_iter().map(|l| l.name).collect();
    parse(text, today, &projects, &labels)
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
    };
    let view = store.add_task(&project, input)?;
    Ok(QuickAddOutcome { parsed, view })
}

// ---- commands: app and data folder ----

#[tauri::command]
pub async fn app_state(app: AppHandle, state: State<'_, AppState>) -> AppResult<AppStateDto> {
    let dto = startup(state.inner())?;
    schedule_dirty(&app, state.inner());
    Ok(dto)
}

#[tauri::command]
pub async fn set_data_dir(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<AppStateDto> {
    let dto = switch_data_dir(state.inner(), &path)?;
    schedule_dirty(&app, state.inner());
    Ok(dto)
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
    mutate(&app, state.inner(), &[], true, |s| {
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
    mutate(&app, state.inner(), &[&new_name], true, |s| {
        s.rename_project(&name, &new_name)
    })
}

#[tauri::command]
pub async fn delete_project(
    name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    mutate(&app, state.inner(), &[], true, |s| s.delete_project(&name))
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
        for name in [project, to_project] {
            let _ = app.emit("project-changed", ProjectChanged { name });
        }
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
        s.update_settings(Settings {
            display_name: settings.display_name,
            week_start: settings.week_start,
            timezone,
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

        let first_run = serde_json::to_value(state_dto(None, Some("w".into()))).unwrap();
        assert!(first_run["dataDir"].is_null());
        assert_eq!(first_run["projects"], serde_json::json!([]));
        assert_eq!(first_run["warning"], "w");
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
}
