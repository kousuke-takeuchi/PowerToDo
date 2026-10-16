//! In-memory project store: the common workbook plus every project workbook, edited in memory
//! and written back on request.
//!
//! The store never writes task changes by itself. Mutations mark the project dirty
//! (`dirty_projects`); the caller (the debounce in `commands`) decides when to call `save`.
//! A failed `save` keeps the project dirty and the in-memory data untouched, so the next
//! attempt writes everything again. Structural changes (create / rename / delete a project)
//! touch files immediately; the matching update of the common workbook is attempted at once
//! and, if it fails, left to `save_common` (`common_dirty`).
//!
//! Task numbers: the next No. is max + 1 over the tasks and the invalid rows of the project,
//! and never goes below the highest No. seen in this session (`high_water`), so a number is
//! not reused even after its task was deleted, nor after a `reload`. The workbook has no memory
//! of deleted rows, so after a restart the highest deleted No. can be handed out again.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde::Serialize;

use super::common_book::{COMMON_FILE, CommonBook, Settings, read_common_book, write_common_book};
use super::external::{Fingerprint, Verdict, fingerprint, verdict};
use super::paths::{Paths, validate_project_name, write_atomic};
use super::project_book::{
    ProjectBook, created_at_sentinel, read_project_book, write_project_book,
};
use crate::domain::dates::business_days;
use crate::domain::ids::next_no;
use crate::domain::{INBOX, InvalidRow, Label, Project, Section, Task, TaskInput, TaskPatch};
use crate::domain::{recurrence, reminders};
use crate::error::{AppError, AppResult};

pub(super) const DEFAULT_COLOR: &str = "var(--color-text-muted)";

#[derive(Debug, Clone)]
pub enum LoadedProject {
    Ok(ProjectBook),
    /// The file could not be read; the message is shown to the user. The file is never
    /// overwritten while in this state.
    Failed(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub name: String,
    pub color: String,
    pub order: u32,
    pub favorite: bool,
    pub inbox: bool,
    /// Tasks that are not finished (progress < 100); 0 when the project failed to load.
    pub task_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub load_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    pub project: Project,
    pub sections: Vec<Section>,
    pub tasks: Vec<Task>,
    pub invalid_rows: Vec<InvalidRow>,
    /// Messages for the UI about the operation that produced this view (e.g. a recurrence that
    /// could not be read when completing a task).
    #[serde(default)]
    pub warnings: Vec<String>,
}

pub struct ProjectStore {
    paths: Paths,
    pub(super) common: CommonBook,
    pub(super) books: BTreeMap<String, LoadedProject>,
    pub(super) dirty: BTreeSet<String>,
    pub(super) common_dirty: bool,
    high_water: BTreeMap<String, u32>,
    /// What each workbook looked like on disk right after we last wrote or read it, keyed by
    /// project name or `"_common"`. A watcher event whose file still matches is our own write.
    last_written: BTreeMap<String, Fingerprint>,
    /// Projects (or `"_common"`) whose file changed on disk while they had unsaved edits. Not
    /// written until the user chooses to reload or overwrite.
    held: BTreeSet<String>,
    clock: Box<dyn Fn() -> NaiveDateTime + Send>,
}

/// Key of the common workbook in `last_written` / `held` (same as the saver's key).
const COMMON_KEY: &str = "_common";

/// Values a mutation needs besides the book itself.
struct Ctx {
    now: NaiveDateTime,
    display_name: String,
    settings: Settings,
    high_water: u32,
}

pub(super) fn invalid(message: impl Into<String>) -> AppError {
    AppError::Invalid {
        message: message.into(),
    }
}

/// The error for any operation on a project whose workbook failed to load.
fn load_failed(name: &str, message: &str) -> AppError {
    AppError::Corrupt {
        message: format!("「{name}」は読み込めていません: {message}"),
    }
}

fn not_found(message: impl Into<String>) -> AppError {
    AppError::NotFound {
        message: message.into(),
    }
}

fn all_nos(book: &ProjectBook) -> impl Iterator<Item = u32> + '_ {
    book.tasks
        .iter()
        .map(|t| t.no)
        .chain(book.invalid_rows.iter().filter_map(|r| r.no))
}

fn next_no_for(book: &ProjectBook, high_water: u32) -> u32 {
    next_no(all_nos(book).chain(std::iter::once(high_water)))
}

/// `due_time` only means something with a `due`, and a 00:00 time cannot be told from a
/// date-only value after a round trip through Excel, so it is stored as "no time".
fn normalize_due(t: &mut Task) {
    if t.due.is_none() || t.due_time == Some(NaiveTime::MIN) {
        t.due_time = None;
    }
}

pub(super) fn recompute_days(book: &mut ProjectBook, holidays: &[NaiveDate]) {
    for t in &mut book.tasks {
        t.days = match (t.start, t.due) {
            (Some(s), Some(d)) => Some(business_days(s, d, holidays)),
            _ => None,
        };
    }
}

/// Adds the default reminder to a task that has a due date and time but no reminder.
fn apply_default_reminder(t: &mut Task, settings: &Settings) {
    if t.due.is_some()
        && t.due_time.is_some()
        && t.reminders.is_empty()
        && let Some(code) = &settings.default_reminder
    {
        t.reminders.push(code.clone());
    }
}

/// Fills `rrule_label` (display text) for tasks that repeat. Never stored.
fn label_recurrence(t: &mut Task) {
    t.rrule_label = t
        .rrule
        .as_ref()
        .map(|r| recurrence::summarize(r).unwrap_or_else(|| r.clone()));
}

fn non_empty(s: &str) -> Option<String> {
    let t = s.trim();
    (!t.is_empty()).then(|| t.to_string())
}

/// Indices (in book order) of the task `no` and all of its descendants.
fn subtree(book: &ProjectBook, no: u32) -> Vec<usize> {
    let mut set = BTreeSet::from([no]);
    loop {
        let before = set.len();
        for t in &book.tasks {
            if t.parent_no.is_some_and(|p| set.contains(&p)) {
                set.insert(t.no);
            }
        }
        if set.len() == before {
            break;
        }
    }
    book.tasks
        .iter()
        .enumerate()
        .filter(|(_, t)| set.contains(&t.no))
        .map(|(i, _)| i)
        .collect()
}

fn sections_of(book: &ProjectBook) -> Vec<Section> {
    book.sections
        .iter()
        .enumerate()
        .map(|(i, name)| Section {
            project: book.project.clone(),
            name: name.clone(),
            order: i as u32,
        })
        .collect()
}

fn find_task(book: &ProjectBook, no: u32) -> AppResult<usize> {
    book.tasks
        .iter()
        .position(|t| t.no == no)
        .ok_or_else(|| not_found(format!("タスク No.{no} が見つかりません")))
}

fn check_section(book: &ProjectBook, name: &str) -> AppResult<()> {
    if book.sections.iter().any(|s| s == name) {
        Ok(())
    } else {
        Err(not_found(format!("セクション「{name}」がありません")))
    }
}

fn same_file(a: &Path, b: &Path) -> bool {
    matches!((a.canonicalize(), b.canonicalize()), (Ok(x), Ok(y)) if x == y)
}

/// Marks a sync conflict copy: `<name> (競合 yyyy-mm-dd hhmm).xlsx` (see `sync::conflict_name`).
pub(crate) const CONFLICT_MARK: &str = "(競合 ";

/// Files that are not project workbooks: Excel lock files (`~$`), our temp files (`.`), the
/// common workbook / other reserved names (`_`), and sync conflict copies (they stay in the
/// folder for the user to open in Excel; listing them would put a project into the common
/// workbook whose file never reaches the other PCs).
pub(crate) fn adoptable_stem(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?;
    if !ext.eq_ignore_ascii_case("xlsx") {
        return None;
    }
    let stem = path.file_stem()?.to_str()?;
    if stem.starts_with(['.', '~', '_'])
        || stem.contains(CONFLICT_MARK)
        || validate_project_name(stem).is_err()
    {
        return None;
    }
    Some(stem.to_string())
}

/// The key of a data-folder file name in `last_written` / `held` / the saver: the project name,
/// or `"_common"` for the common workbook. `None` for any other file (not ours to load).
pub fn file_key(name: &str) -> Option<String> {
    if name.contains(['/', '\\']) {
        return None;
    }
    if name == COMMON_FILE {
        return Some(COMMON_KEY.to_string());
    }
    adoptable_stem(Path::new(name))
}

/// `<dir>/<stem> (<tag>).xlsx`, or `<stem> (<tag>-2).xlsx`, `-3`, … when that name is taken.
fn free_archive_path(dir: &Path, stem: &str, tag: &str) -> PathBuf {
    let mut dest = dir.join(format!("{stem} ({tag}).xlsx"));
    let mut n = 2;
    while dest.exists() {
        dest = dir.join(format!("{stem} ({tag}-{n}).xlsx"));
        n += 1;
    }
    dest
}

impl ProjectStore {
    /// Opens the data folder. With `create` the folder is created when missing; without it a
    /// missing folder is `NotFound` and nothing is created (e.g. a drive that is not mounted).
    /// The common workbook and the inbox are created when missing. Then it reads the common
    /// workbook and every project workbook. A workbook that cannot be read
    /// becomes `LoadedProject::Failed` and does not stop the others. `.xlsx` files in the
    /// folder that the common workbook does not list are adopted as projects.
    /// Projects normalized while loading come back dirty (see `load_from_disk`); the caller
    /// should schedule saves for `dirty_projects` (and the common workbook if `common_dirty`).
    pub fn open(
        paths: Paths,
        clock: impl Fn() -> NaiveDateTime + Send + 'static,
        create: bool,
    ) -> AppResult<Self> {
        if !create && !paths.data_dir.is_dir() {
            return Err(not_found(format!(
                "データフォルダが見つかりません: {}",
                paths.data_dir.display()
            )));
        }
        std::fs::create_dir_all(&paths.data_dir)?;
        let common_path = paths.common();
        let is_new = !common_path.exists();
        let common = if is_new {
            CommonBook::new_default()
        } else {
            read_common_book(&common_path)?
        };
        let mut store = ProjectStore {
            paths,
            common,
            books: BTreeMap::new(),
            dirty: BTreeSet::new(),
            common_dirty: is_new,
            high_water: BTreeMap::new(),
            last_written: BTreeMap::new(),
            held: BTreeSet::new(),
            clock: Box::new(clock),
        };
        if !is_new {
            store.record_written(COMMON_KEY, &common_path);
        }

        if !store.common.projects.iter().any(|p| p.name == INBOX) {
            store.common.projects.insert(
                0,
                Project {
                    name: INBOX.into(),
                    color: DEFAULT_COLOR.into(),
                    order: 0,
                    favorite: false,
                    inbox: true,
                },
            );
            store.common_dirty = true;
        }
        store.adopt_unlisted();
        if is_new {
            store.save_common()?;
        } else if store.common_dirty {
            let _ = store.save_common();
        }

        let names: Vec<String> = store
            .common
            .projects
            .iter()
            .map(|p| p.name.clone())
            .collect();
        for name in names {
            let loaded = store.load_from_disk(&name);
            store.books.insert(name, loaded);
        }
        Ok(store)
    }

    pub fn paths(&self) -> &Paths {
        &self.paths
    }

    fn now(&self) -> NaiveDateTime {
        (self.clock)()
    }

    fn adopt_unlisted(&mut self) {
        let Ok(entries) = std::fs::read_dir(&self.paths.data_dir) else {
            return;
        };
        let mut names: Vec<String> = entries
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
            .filter_map(|e| adoptable_stem(&e.path()))
            .filter(|n| !self.common.projects.iter().any(|p| &p.name == n))
            .collect();
        names.sort();
        for name in names {
            let order = self.next_project_order();
            self.common.projects.push(Project {
                name,
                color: DEFAULT_COLOR.into(),
                order,
                favorite: false,
                inbox: false,
            });
            self.common_dirty = true;
        }
    }

    fn next_project_order(&self) -> u32 {
        self.common
            .projects
            .iter()
            .map(|p| p.order)
            .max()
            .map_or(0, |m| m.saturating_add(1))
    }

    /// Reads `<name>.xlsx` (creating an empty inbox when it is missing) and normalizes what
    /// the file may not have: the project column, a missing 作成日時, categories that are not
    /// in the section list. Sets the dirty flag when it changed anything, so a project can be
    /// dirty right after `open` / `reload` without any user edit. Callers that open or reload
    /// should schedule a save for whatever `dirty_projects` reports, so the normalized file is
    /// written and the project does not look like it has unsaved edits (the `commands` layer
    /// does this).
    fn load_from_disk(&mut self, name: &str) -> LoadedProject {
        self.dirty.remove(name);
        match self.read_normalized(name) {
            Ok((book, changed)) => {
                if changed {
                    self.dirty.insert(name.to_string());
                }
                LoadedProject::Ok(book)
            }
            Err(message) => LoadedProject::Failed(message),
        }
    }

    /// The reading half of `load_from_disk`: the normalized book and whether normalization
    /// changed anything. Leaves the store's books and dirty flags alone, so a failure can be
    /// ignored by the caller. On success it records the file's fingerprint and raises the
    /// high-water mark.
    fn read_normalized(&mut self, name: &str) -> Result<(ProjectBook, bool), String> {
        let path = self.paths.project(name).map_err(|e| e.to_string())?;
        if !path.exists() {
            if name != INBOX {
                return Err(format!("ファイルが見つかりません: {}", path.display()));
            }
            let book = self.empty_book(name);
            write_project_book(&path, &book, self.now().date(), &self.common.holidays)
                .map_err(|e| e.to_string())?;
        }
        let mut book = read_project_book(&path).map_err(|e| e.to_string())?;
        // What we just read is the state we know about.
        self.record_written(name, &path);

        let now = self.now();
        let mut changed = book.project != name;
        book.project = name.to_string();
        for t in &mut book.tasks {
            if t.project != name {
                t.project = name.to_string();
                changed = true;
            }
            if t.created_at == created_at_sentinel() {
                t.created_at = now;
                changed = true;
            }
            if let Some(c) = &t.category
                && !book.sections.contains(c)
            {
                book.sections.push(c.clone());
                changed = true;
            }
        }
        recompute_days(&mut book, &self.common.holidays);
        if let Some(max) = all_nos(&book).max() {
            let h = self.high_water.entry(name.to_string()).or_insert(0);
            *h = (*h).max(max);
        }
        Ok((book, changed))
    }

    fn empty_book(&self, name: &str) -> ProjectBook {
        ProjectBook {
            project: name.to_string(),
            assignees: vec![self.common.settings.display_name.clone()],
            ..Default::default()
        }
    }

    fn ok_book(&self, name: &str) -> AppResult<&ProjectBook> {
        match self.books.get(name) {
            Some(LoadedProject::Ok(b)) => Ok(b),
            Some(LoadedProject::Failed(m)) => Err(load_failed(name, m)),
            None => Err(not_found(format!("プロジェクト「{name}」がありません"))),
        }
    }

    fn summary(&self, p: &Project) -> ProjectSummary {
        let (task_count, load_error) = match self.books.get(&p.name) {
            Some(LoadedProject::Ok(b)) => {
                (b.tasks.iter().filter(|t| t.progress < 100).count(), None)
            }
            Some(LoadedProject::Failed(m)) => (0, Some(m.clone())),
            None => (0, None),
        };
        ProjectSummary {
            name: p.name.clone(),
            color: p.color.clone(),
            order: p.order,
            favorite: p.favorite,
            inbox: p.inbox,
            task_count: task_count as u32,
            load_error,
        }
    }

    /// All projects, ordered by 並び順 (the inbox first among equals).
    pub fn summaries(&self) -> Vec<ProjectSummary> {
        let mut projects: Vec<&Project> = self.common.projects.iter().collect();
        projects.sort_by(|a, b| (a.order, !a.inbox, &a.name).cmp(&(b.order, !b.inbox, &b.name)));
        projects.into_iter().map(|p| self.summary(p)).collect()
    }

    pub fn view(&self, name: &str) -> AppResult<ProjectView> {
        let project = self
            .common
            .projects
            .iter()
            .find(|p| p.name == name)
            .cloned()
            .ok_or_else(|| not_found(format!("プロジェクト「{name}」がありません")))?;
        let book = self.ok_book(name)?;
        Ok(ProjectView {
            project,
            sections: sections_of(book),
            tasks: book
                .tasks
                .iter()
                .cloned()
                .map(|mut t| {
                    label_recurrence(&mut t);
                    t
                })
                .collect(),
            invalid_rows: book.invalid_rows.clone(),
            warnings: Vec::new(),
        })
    }

    /// Re-reads the project's file. Also the way to retry a project that failed to load.
    /// Refuses (`Unsaved`) while the project has unsaved changes, so a reload never drops
    /// edits silently; `reload_discarding` is the explicit "throw them away" variant.
    /// Like `open`, the result can be dirty from load-time normalization; see `load_from_disk`.
    pub fn reload(&mut self, name: &str) -> AppResult<ProjectView> {
        if self.dirty.contains(name) {
            return Err(AppError::Unsaved {
                message: "未保存の変更があります。破棄して読み直す場合は確認してください。".into(),
            });
        }
        self.reload_discarding(name)
    }

    /// Re-reads the project's file, discarding any unsaved changes in memory.
    pub fn reload_discarding(&mut self, name: &str) -> AppResult<ProjectView> {
        if !self.common.projects.iter().any(|p| p.name == name) {
            return Err(not_found(format!("プロジェクト「{name}」がありません")));
        }
        let loaded = self.load_from_disk(name);
        self.books.insert(name.to_string(), loaded);
        self.view(name)
    }

    // ---- projects ----

    pub fn create_project(&mut self, name: &str, color: &str) -> AppResult<ProjectSummary> {
        let path = self.paths.project(name)?;
        if name == INBOX || self.common.projects.iter().any(|p| p.name == name) {
            return Err(invalid(format!("プロジェクト「{name}」は既にあります")));
        }
        if path.exists() {
            return Err(invalid(format!(
                "「{}」という名前のファイルが既にあります",
                path.display()
            )));
        }
        let book = self.empty_book(name);
        write_project_book(&path, &book, self.now().date(), &self.common.holidays)?;
        self.record_written(name, &path);

        let project = Project {
            name: name.to_string(),
            color: non_empty(color).unwrap_or_else(|| DEFAULT_COLOR.to_string()),
            order: self.next_project_order(),
            favorite: false,
            inbox: false,
        };
        self.common.projects.push(project.clone());
        self.books.insert(name.to_string(), LoadedProject::Ok(book));
        self.common_dirty = true;
        self.save_common_unless_held();
        Ok(self.summary(&project))
    }

    pub fn rename_project(&mut self, name: &str, new_name: &str) -> AppResult<ProjectSummary> {
        if name == INBOX {
            return Err(invalid("受信トレイの名前は変えられません"));
        }
        let idx = self
            .common
            .projects
            .iter()
            .position(|p| p.name == name)
            .ok_or_else(|| not_found(format!("プロジェクト「{name}」がありません")))?;
        if new_name == name {
            return Ok(self.summary(&self.common.projects[idx]));
        }
        let new_path = self.paths.project(new_name)?;
        if new_name == INBOX || self.common.projects.iter().any(|p| p.name == new_name) {
            return Err(invalid(format!("プロジェクト「{new_name}」は既にあります")));
        }
        let old_path = self.paths.project(name)?;
        if new_path.exists() && !same_file(&old_path, &new_path) {
            return Err(invalid(format!(
                "「{}」という名前のファイルが既にあります",
                new_path.display()
            )));
        }
        if old_path.exists() {
            std::fs::rename(&old_path, &new_path)?;
        }
        // The renamed file is the same file: carry over what we know about it.
        self.last_written.remove(name);
        self.record_written(new_name, &new_path);
        if self.held.remove(name) {
            self.held.insert(new_name.to_string());
        }

        self.common.projects[idx].name = new_name.to_string();
        if let Some(extra) = self.common.project_extra.remove(name) {
            self.common
                .project_extra
                .insert(new_name.to_string(), extra);
        }
        let loaded = match self.books.remove(name) {
            Some(LoadedProject::Ok(mut b)) => {
                b.project = new_name.to_string();
                for t in &mut b.tasks {
                    t.project = new_name.to_string();
                }
                // The project column of every task changed: rewrite the file.
                self.dirty.insert(new_name.to_string());
                LoadedProject::Ok(b)
            }
            Some(failed) => failed,
            None => LoadedProject::Failed("読み込まれていません".into()),
        };
        self.books.insert(new_name.to_string(), loaded);
        self.dirty.remove(name);
        if let Some(h) = self.high_water.remove(name) {
            self.high_water.insert(new_name.to_string(), h);
        }
        self.common_dirty = true;
        self.save_common_unless_held();
        Ok(self.summary(&self.common.projects[idx]))
    }

    /// Moves `<name>.xlsx` to `archive/<name> (YYYYMMDD-HHMM).xlsx` (never deletes it) and
    /// removes the project from the common workbook. Unsaved changes are written first so the
    /// archive holds the latest state; if that write fails, its error is returned and the
    /// project is left as it was (still listed, still dirty, file not moved). A project that
    /// is held, or has unsaved edits while its file changed on disk since we read it, is refused
    /// (`Unsaved`) without writing: saving first would overwrite the external change, and
    /// archiving the file would take the external change away before the user chose.
    pub fn delete_project(&mut self, name: &str) -> AppResult<()> {
        if name == INBOX {
            return Err(invalid("受信トレイは削除できません"));
        }
        if !self.common.projects.iter().any(|p| p.name == name) {
            return Err(not_found(format!("プロジェクト「{name}」がありません")));
        }
        // A clean project has nothing of ours to overwrite, and archiving moves the file as it
        // is (a file that failed to load has no recorded fingerprint, so it always reads as
        // "changed": it must stay deletable). Only unsaved edits make the disk state matter.
        if self.is_held(name) || (self.dirty.contains(name) && self.changed_on_disk(name)) {
            return Err(AppError::Unsaved {
                message: format!(
                    "「{name}」は Excel で変更されています。帯の操作で解決してから削除してください"
                ),
            });
        }
        if self.dirty.contains(name) {
            self.save(name)?;
        }
        if let Ok(path) = self.paths.project(name)
            && path.exists()
        {
            self.move_to_archive(&path, name)?;
        }
        self.common.projects.retain(|p| p.name != name);
        self.common.project_extra.remove(name);
        self.books.remove(name);
        self.dirty.remove(name);
        self.high_water.remove(name);
        self.last_written.remove(name);
        self.held.remove(name);
        self.common_dirty = true;
        self.save_common_unless_held();
        Ok(())
    }

    /// Moves `path` to `archive/<stem> (YYYYMMDD-HHMM).xlsx` (`-2`, `-3`, … when taken).
    fn move_to_archive(&self, path: &Path, stem: &str) -> AppResult<PathBuf> {
        let dir = self.paths.archive_dir();
        std::fs::create_dir_all(&dir)?;
        let stamp = self.now().format("%Y%m%d-%H%M").to_string();
        let dest = free_archive_path(&dir, stem, &stamp);
        std::fs::rename(path, &dest)?;
        Ok(dest)
    }

    // ---- sync (Phase 4 仕様 §3.4) ----

    /// The key and the path of a file the sync may write. `name` must be the exact file name the
    /// store uses (`<project>.xlsx` or the common workbook), so the file read back is this one.
    fn sync_file(&self, name: &str) -> AppResult<(String, PathBuf)> {
        let not_ours = || invalid(format!("「{name}」は同期できるファイル名ではありません"));
        let key = file_key(name).ok_or_else(not_ours)?;
        let path = if key == COMMON_KEY {
            self.paths.common()
        } else {
            self.paths.project(&key)?
        };
        if path.file_name().and_then(|n| n.to_str()) != Some(name) {
            return Err(not_ours());
        }
        Ok((key, path))
    }

    /// Writes a file fetched by the sync: a temp file renamed over `<data>/<name>`, then its
    /// fingerprint is recorded as our own write, so the watcher does not take it for an external
    /// change. The caller loads it next (`reload_external`, `adopt_new_file` or
    /// `reload_common`). The caller must have checked that the key has no unsaved, held or
    /// in-flight edits.
    pub fn write_downloaded(&mut self, name: &str, bytes: &[u8]) -> AppResult<()> {
        let (key, path) = self.sync_file(name)?;
        write_atomic(&path, bytes)?;
        self.record_written(&key, &path);
        Ok(())
    }

    /// Copies `<data>/<name>` to `archive/<stem> (同期前 yyyy-mm-dd hhmm).xlsx` (`-2`, … when
    /// taken) and returns the copy's path. Used before a one-shot mirror overwrites a local file
    /// whose content differs. A copy (not a move) leaves the file in place if writing the new
    /// content fails afterwards.
    pub fn keep_copy_before_sync(&self, name: &str, now: NaiveDateTime) -> AppResult<PathBuf> {
        let (_, path) = self.sync_file(name)?;
        let stem = name.strip_suffix(".xlsx").unwrap_or(name);
        let dir = self.paths.archive_dir();
        std::fs::create_dir_all(&dir)?;
        let tag = format!("同期前 {}", now.format("%Y-%m-%d %H%M"));
        let dest = free_archive_path(&dir, stem, &tag);
        std::fs::copy(&path, &dest)?;
        Ok(dest)
    }

    /// The sync follows a deletion on the other side: `<data>/<name>` goes to `archive/` like
    /// `delete_project` (a listed project is removed through it). A file the store does not
    /// list is just moved. The inbox and the common workbook are refused.
    pub fn archive_synced(&mut self, name: &str) -> AppResult<()> {
        let (key, path) = self.sync_file(name)?;
        if key == COMMON_KEY || key == INBOX {
            return Err(invalid(format!("「{name}」は archive に移せません")));
        }
        if self.common.projects.iter().any(|p| p.name == key) {
            return self.delete_project(&key);
        }
        if path.exists() {
            self.move_to_archive(&path, &key)?;
        }
        Ok(())
    }

    // ---- sections ----

    pub fn add_section(&mut self, project: &str, name: &str) -> AppResult<ProjectView> {
        let name = non_empty(name).ok_or_else(|| invalid("セクション名が空です"))?;
        self.mutate(project, |book, _| {
            if book.sections.contains(&name) {
                return Err(invalid(format!("セクション「{name}」は既にあります")));
            }
            book.sections.push(name);
            Ok(())
        })?;
        self.view(project)
    }

    pub fn rename_section(
        &mut self,
        project: &str,
        name: &str,
        new_name: &str,
    ) -> AppResult<ProjectView> {
        let new_name = non_empty(new_name).ok_or_else(|| invalid("セクション名が空です"))?;
        self.mutate(project, |book, _| {
            let idx = book
                .sections
                .iter()
                .position(|s| s == name)
                .ok_or_else(|| not_found(format!("セクション「{name}」がありません")))?;
            if new_name != name && book.sections.contains(&new_name) {
                return Err(invalid(format!("セクション「{new_name}」は既にあります")));
            }
            book.sections[idx] = new_name.clone();
            for t in &mut book.tasks {
                if t.category.as_deref() == Some(name) {
                    t.category = Some(new_name.clone());
                }
            }
            Ok(())
        })?;
        self.view(project)
    }

    /// `names` lists existing sections in the new order; sections not listed keep their
    /// relative order after the listed ones. Unknown names are an error.
    pub fn reorder_sections(&mut self, project: &str, names: &[String]) -> AppResult<ProjectView> {
        self.mutate(project, |book, _| {
            let mut ordered: Vec<String> = Vec::new();
            for n in names {
                check_section(book, n)?;
                if !ordered.contains(n) {
                    ordered.push(n.clone());
                }
            }
            let rest: Vec<String> = book
                .sections
                .iter()
                .filter(|s| !ordered.contains(s))
                .cloned()
                .collect();
            ordered.extend(rest);
            book.sections = ordered;
            Ok(())
        })?;
        self.view(project)
    }

    // ---- tasks ----

    /// Runs `f` on a loaded project, then marks it dirty. `f` must validate before it
    /// mutates: an `Err` leaves the project clean.
    fn mutate<R>(
        &mut self,
        name: &str,
        f: impl FnOnce(&mut ProjectBook, &Ctx) -> AppResult<R>,
    ) -> AppResult<R> {
        let ctx = Ctx {
            now: self.now(),
            display_name: self.common.settings.display_name.clone(),
            settings: self.common.settings.clone(),
            high_water: self.high_water.get(name).copied().unwrap_or(0),
        };
        let book = match self.books.get_mut(name) {
            Some(LoadedProject::Ok(b)) => b,
            Some(LoadedProject::Failed(m)) => return Err(load_failed(name, m)),
            None => return Err(not_found(format!("プロジェクト「{name}」がありません"))),
        };
        let r = f(book, &ctx)?;
        self.touch(name);
        Ok(r)
    }

    /// Bookkeeping after a change: derived 日数, number high-water mark, dirty flag.
    fn touch(&mut self, name: &str) {
        if let Some(LoadedProject::Ok(book)) = self.books.get_mut(name) {
            recompute_days(book, &self.common.holidays);
            if let Some(max) = all_nos(book).max() {
                let h = self.high_water.entry(name.to_string()).or_insert(0);
                *h = (*h).max(max);
            }
        }
        self.dirty.insert(name.to_string());
    }

    pub fn add_task(&mut self, project: &str, input: TaskInput) -> AppResult<ProjectView> {
        let name = project.to_string();
        self.mutate(project, move |book, ctx| {
            let title = non_empty(&input.title).ok_or_else(|| invalid("タスク名が空です"))?;
            let parent_category = match input.parent_no {
                Some(p) => book.tasks[find_task(book, p)?].category.clone(),
                None => None,
            };
            let category = match input.section.as_deref().and_then(non_empty) {
                Some(s) => {
                    check_section(book, &s)?;
                    Some(s)
                }
                None => parent_category,
            };
            let no = next_no_for(book, ctx.high_water);
            let order = book
                .tasks
                .iter()
                .filter(|t| t.category == category)
                .map(|t| t.order)
                .max()
                .map_or(1, |m| m.saturating_add(1));
            if !ctx.display_name.is_empty() && !book.assignees.contains(&ctx.display_name) {
                book.assignees.push(ctx.display_name.clone());
            }
            let mut task = Task {
                no,
                project: name,
                category,
                title,
                assignee: ctx.display_name.clone(),
                priority: input.priority.unwrap_or_default(),
                progress: 0,
                start: None,
                due: input.due,
                due_time: input.due_time,
                days: None,
                note: input.note.as_deref().and_then(non_empty),
                parent_no: input.parent_no,
                labels: input.labels.iter().filter_map(|l| non_empty(l)).collect(),
                rrule: input.rrule.as_deref().and_then(non_empty),
                rrule_label: None,
                reminders: input
                    .reminders
                    .iter()
                    .filter_map(|c| non_empty(c))
                    .collect(),
                order,
                created_at: ctx.now,
                completed_at: None,
                extra: BTreeMap::new(),
            };
            normalize_due(&mut task);
            apply_default_reminder(&mut task, &ctx.settings);
            book.tasks.push(task);
            Ok(())
        })?;
        self.view(project)
    }

    pub fn update_task(
        &mut self,
        project: &str,
        no: u32,
        patch: TaskPatch,
    ) -> AppResult<ProjectView> {
        self.mutate(project, move |book, ctx| {
            let idx = find_task(book, no)?;
            let title = match &patch.title {
                Some(t) => Some(non_empty(t).ok_or_else(|| invalid("タスク名が空です"))?),
                None => None,
            };
            if patch.progress.is_some_and(|p| p > 100) {
                return Err(invalid("進捗は 0〜100 です"));
            }
            if let Some(Some(c)) = &patch.category {
                check_section(book, c)?;
            }
            if let Some(Some(p)) = patch.parent_no {
                if p == no {
                    return Err(invalid("自分自身を親にはできません"));
                }
                find_task(book, p)?;
                // Walking up from the new parent must not reach this task.
                let mut cur = Some(p);
                for _ in 0..=book.tasks.len() {
                    let Some(c) = cur else { break };
                    if c == no {
                        return Err(invalid("子孫を親にはできません"));
                    }
                    cur = book
                        .tasks
                        .iter()
                        .find(|t| t.no == c)
                        .and_then(|t| t.parent_no);
                }
            }

            if let Some(a) = &patch.assignee
                && !a.is_empty()
                && !book.assignees.contains(a)
            {
                book.assignees.push(a.clone());
            }
            let t = &mut book.tasks[idx];
            let had_time = t.due_time.is_some();
            let sets_reminders = patch.reminders.is_some();
            if let Some(v) = title {
                t.title = v;
            }
            if let Some(v) = patch.category {
                t.category = v.as_deref().and_then(non_empty);
            }
            if let Some(v) = patch.assignee {
                t.assignee = v;
            }
            if let Some(v) = patch.priority {
                t.priority = v;
            }
            if let Some(v) = patch.progress {
                t.progress = v;
                if v == 100 {
                    t.completed_at.get_or_insert(ctx.now);
                } else {
                    t.completed_at = None;
                }
            }
            if let Some(v) = patch.start {
                t.start = v;
            }
            if let Some(v) = patch.due {
                t.due = v;
            }
            if let Some(v) = patch.due_time {
                t.due_time = v;
            }
            if let Some(v) = patch.note {
                t.note = v.as_deref().and_then(non_empty);
            }
            if let Some(v) = patch.parent_no {
                t.parent_no = v;
            }
            if let Some(v) = patch.labels {
                t.labels = v.iter().filter_map(|l| non_empty(l)).collect();
            }
            if let Some(v) = patch.rrule {
                t.rrule = v.as_deref().and_then(non_empty);
            }
            if let Some(v) = patch.reminders {
                t.reminders = v.iter().filter_map(|l| non_empty(l)).collect();
            }
            if let Some(v) = patch.order {
                t.order = v;
            }
            normalize_due(t);
            // A time was just added: give the task the default reminder (only when it has none
            // and this patch did not set the reminders itself).
            if !had_time && t.due_time.is_some() && !sets_reminders {
                apply_default_reminder(t, &ctx.settings);
            }
            Ok(())
        })?;
        self.view(project)
    }

    /// Completes (or reopens) a task. A repeating task is not finished: its due date moves to
    /// the next occurrence and it starts over. A recurrence that has run out is dropped and the
    /// task completes normally; one that cannot be read completes normally with a warning.
    pub fn complete_task(&mut self, project: &str, no: u32, done: bool) -> AppResult<ProjectView> {
        let mut warning: Option<String> = None;
        self.mutate(project, |book, ctx| {
            let idx = find_task(book, no)?;
            let t = &mut book.tasks[idx];
            if !done {
                t.progress = 0;
                t.completed_at = None;
                return Ok(());
            }
            if let Some(rrule) = t.rrule.clone() {
                let today = ctx.now.date();
                let base = if recurrence::split(&rrule).from_completed {
                    today
                } else {
                    t.due.unwrap_or(today)
                };
                match recurrence::next_due(&rrule, t.due, t.due_time, base) {
                    Ok(Some(next)) => {
                        t.due = Some(next);
                        t.progress = 0;
                        t.completed_at = None;
                        t.reminders.retain(|c| !reminders::is_absolute(c));
                        return Ok(());
                    }
                    Ok(None) => t.rrule = None,
                    Err(e) => warning = Some(e.to_string()),
                }
            }
            if t.progress != 100 {
                t.completed_at = None;
            }
            t.progress = 100;
            t.completed_at.get_or_insert(ctx.now);
            Ok(())
        })?;
        let mut view = self.view(project)?;
        view.warnings.extend(warning);
        Ok(view)
    }

    /// Deletes the task and all of its descendants.
    pub fn delete_task(&mut self, project: &str, no: u32) -> AppResult<ProjectView> {
        self.mutate(project, |book, _| {
            find_task(book, no)?;
            let gone: BTreeSet<u32> = subtree(book, no)
                .into_iter()
                .map(|i| book.tasks[i].no)
                .collect();
            book.tasks.retain(|t| !gone.contains(&t.no));
            Ok(())
        })?;
        self.view(project)
    }

    /// Moves the task and its descendants. In another project they get new numbers (appended
    /// after the target's highest), the moved task is detached from its old parent, the rest
    /// keep their tree, and their assignees join the target's assignee list. Within the same
    /// project only the section changes.
    pub fn move_task(
        &mut self,
        project: &str,
        no: u32,
        to_project: &str,
        to_section: Option<&str>,
    ) -> AppResult<(ProjectView, ProjectView)> {
        let to_section = to_section.and_then(non_empty);
        let source = self.ok_book(project)?;
        let target = self.ok_book(to_project)?;
        find_task(source, no)?;
        if let Some(s) = &to_section {
            check_section(target, s)?;
        }

        if project == to_project {
            self.mutate(project, |book, _| {
                let mut order = book
                    .tasks
                    .iter()
                    .filter(|t| t.category == to_section)
                    .map(|t| t.order)
                    .max()
                    .unwrap_or(0);
                for i in subtree(book, no) {
                    order = order.saturating_add(1);
                    book.tasks[i].category = to_section.clone();
                    book.tasks[i].order = order;
                }
                Ok(())
            })?;
            let v = self.view(project)?;
            return Ok((v.clone(), v));
        }

        let indices = subtree(source, no);
        let base = next_no_for(
            target,
            self.high_water.get(to_project).copied().unwrap_or(0),
        );
        let order_base = target
            .tasks
            .iter()
            .filter(|t| t.category == to_section)
            .map(|t| t.order)
            .max()
            .unwrap_or(0);
        let renumber: BTreeMap<u32, u32> = indices
            .iter()
            .enumerate()
            .map(|(i, &ix)| (source.tasks[ix].no, base + i as u32))
            .collect();
        let moved: Vec<Task> = indices
            .iter()
            .enumerate()
            .map(|(i, &ix)| {
                let mut t = source.tasks[ix].clone();
                let old_no = t.no;
                t.no = renumber[&old_no];
                t.parent_no = if old_no == no {
                    None
                } else {
                    t.parent_no.and_then(|p| renumber.get(&p).copied())
                };
                t.project = to_project.to_string();
                t.category = to_section.clone();
                t.order = order_base.saturating_add(1 + i as u32);
                t
            })
            .collect();
        let gone: BTreeSet<u32> = renumber.keys().copied().collect();

        if let Some(LoadedProject::Ok(b)) = self.books.get_mut(project) {
            b.tasks.retain(|t| !gone.contains(&t.no));
        }
        if let Some(LoadedProject::Ok(b)) = self.books.get_mut(to_project) {
            for t in &moved {
                if !t.assignee.is_empty() && !b.assignees.contains(&t.assignee) {
                    b.assignees.push(t.assignee.clone());
                }
            }
            b.tasks.extend(moved);
        }
        self.touch(project);
        self.touch(to_project);
        Ok((self.view(project)?, self.view(to_project)?))
    }

    /// Sets 並び順 of the tasks in `section` (None = no category): the listed tasks get
    /// 1..=n in the given sequence, unlisted ones follow in their old order.
    pub fn reorder_tasks(
        &mut self,
        project: &str,
        section: Option<&str>,
        order: &[u32],
    ) -> AppResult<ProjectView> {
        let section = section.and_then(non_empty);
        self.mutate(project, |book, _| {
            if let Some(s) = &section {
                check_section(book, s)?;
            }
            let mut seen = BTreeSet::new();
            for &n in order {
                let t = &book.tasks[find_task(book, n)?];
                if t.category != section {
                    return Err(invalid(format!(
                        "タスク No.{n} はこのセクションにありません"
                    )));
                }
                if !seen.insert(n) {
                    return Err(invalid(format!("タスク No.{n} が重複しています")));
                }
            }
            let mut rest: Vec<(u32, u32)> = book
                .tasks
                .iter()
                .filter(|t| t.category == section && !seen.contains(&t.no))
                .map(|t| (t.order, t.no))
                .collect();
            rest.sort();
            let sequence: Vec<u32> = order
                .iter()
                .copied()
                .chain(rest.into_iter().map(|(_, n)| n))
                .collect();
            for (i, n) in sequence.into_iter().enumerate() {
                if let Some(t) = book.tasks.iter_mut().find(|t| t.no == n) {
                    t.order = i as u32 + 1;
                }
            }
            Ok(())
        })?;
        self.view(project)
    }

    // ---- common workbook ----

    pub fn settings(&self) -> Settings {
        self.common.settings.clone()
    }

    pub fn update_settings(&mut self, s: Settings) -> AppResult<Settings> {
        let display_name = non_empty(&s.display_name).ok_or_else(|| invalid("表示名が空です"))?;
        if !matches!(s.week_start.as_str(), "mon" | "sun") {
            return Err(invalid("週の開始は mon か sun です"));
        }
        let timezone = non_empty(&s.timezone).ok_or_else(|| invalid("タイムゾーンが空です"))?;
        let default_reminder = match s.default_reminder.as_deref().map(str::trim) {
            None => None,
            Some(code)
                if reminders::parse_code(code).is_some() && !reminders::is_absolute(code) =>
            {
                Some(code.to_string())
            }
            Some(_) => return Err(invalid("既定リマインダーの指定が正しくありません")),
        };
        self.common.settings = Settings {
            display_name,
            week_start: s.week_start,
            timezone,
            default_reminder,
            notify_time: s.notify_time,
            keep_in_tray: s.keep_in_tray,
            notifications: s.notifications,
        };
        self.common_dirty = true;
        Ok(self.common.settings.clone())
    }

    pub fn labels(&self) -> Vec<Label> {
        let mut labels = self.common.labels.clone();
        labels.sort_by(|a, b| (a.order, &a.name).cmp(&(b.order, &b.name)));
        labels
    }

    /// Tasks of every project that loaded, in project order (仕様 §2). Failed projects are left out.
    pub fn all_tasks(&self) -> Vec<Task> {
        self.summaries()
            .iter()
            .filter_map(|p| match self.books.get(&p.name) {
                Some(LoadedProject::Ok(b)) => Some(b.tasks.iter().cloned()),
                _ => None,
            })
            .flatten()
            .map(|mut t| {
                label_recurrence(&mut t);
                t
            })
            .collect()
    }

    /// Names of the projects whose workbook loaded, in project order.
    pub fn loaded_names(&self) -> Vec<String> {
        self.summaries()
            .into_iter()
            .filter(|p| p.load_error.is_none())
            .map(|p| p.name)
            .collect()
    }

    // ---- saving ----

    pub fn dirty_projects(&self) -> Vec<String> {
        self.dirty.iter().cloned().collect()
    }

    pub fn common_dirty(&self) -> bool {
        self.common_dirty
    }

    /// Writes the project's workbook. On success the project is clean and the invalid rows'
    /// Excel row numbers are refreshed from the new file. On failure nothing changes: the
    /// project stays dirty and the in-memory tasks are intact.
    pub fn save(&mut self, name: &str) -> AppResult<()> {
        let path: PathBuf = self.paths.project(name)?;
        let today = self.now().date();
        match self.books.get(name) {
            Some(LoadedProject::Ok(book)) => {
                write_project_book(&path, book, today, &self.common.holidays)?;
            }
            Some(LoadedProject::Failed(m)) => return Err(load_failed(name, m)),
            None => return Err(not_found(format!("プロジェクト「{name}」がありません"))),
        }
        self.record_written(name, &path);
        self.dirty.remove(name);
        // Invalid rows are written after the valid tasks, so their row numbers moved.
        if let Ok(fresh) = read_project_book(&path)
            && let Some(LoadedProject::Ok(book)) = self.books.get_mut(name)
        {
            book.invalid_rows = fresh.invalid_rows;
            book.invalid_cells = fresh.invalid_cells;
            book.unknown_columns = fresh.unknown_columns;
        }
        Ok(())
    }

    pub fn save_common(&mut self) -> AppResult<()> {
        let path = self.paths.common();
        write_common_book(&path, &self.common)?;
        self.record_written(COMMON_KEY, &path);
        self.common_dirty = false;
        Ok(())
    }

    // ---- external changes (仕様 §5) ----

    /// The immediate write of the common workbook after create / rename / delete. While the
    /// common workbook is held (Excel changed it and the user has not chosen) it is not
    /// written: the dirty flag stays and the banner's choice decides. When the file changed on
    /// disk since we last wrote or read it (an external save the watcher has not reported yet),
    /// it is not written either but held, like `TauriSink::save` does; the caller sees the new
    /// hold through `is_held("_common")` and tells the UI.
    fn save_common_unless_held(&mut self) {
        if self.is_held(COMMON_KEY) {
            return;
        }
        if self.changed_on_disk(COMMON_KEY) {
            self.hold(COMMON_KEY);
            return;
        }
        let _ = self.save_common();
    }

    /// Keys (project names and `"_common"`) whose in-memory edits cannot be written to their own
    /// file on quit: held ones, and dirty ones whose file changed on disk since our last write
    /// or read. `write_recovery_copy` keeps them.
    pub fn unsavable_keys(&self) -> Vec<String> {
        let mut keys: BTreeSet<String> = self.held.clone();
        if self.common_dirty && self.changed_on_disk(COMMON_KEY) {
            keys.insert(COMMON_KEY.to_string());
        }
        for name in &self.dirty {
            if self.changed_on_disk(name) {
                keys.insert(name.clone());
            }
        }
        keys.into_iter().collect()
    }

    /// Writes the in-memory workbook of `key` (a project name or `"_common"`) to
    /// `archive/<name> (未保存 YYYYMMDD-HHMM).xlsx` (`archive/_PowerToDo (未保存 …).xlsx` for the
    /// common workbook; `-2`, `-3`, … when the name is taken) and returns its path. Used on quit
    /// for edits that cannot go to their own file without overwriting an external change: the
    /// file is left as it is and the edits are kept next to it. Nothing in the store changes.
    ///
    /// When `archive/` cannot be written (the folder cannot be created, the drive is gone or
    /// read-only), the copy goes to `fallback_dir` under the same file name instead; the
    /// returned path tells which one was used. The error of the `archive/` attempt is returned
    /// only when the fallback fails too.
    pub fn write_recovery_copy(
        &self,
        key: &str,
        now: NaiveDateTime,
        fallback_dir: &Path,
    ) -> AppResult<PathBuf> {
        let stem = if key == COMMON_KEY {
            COMMON_FILE.trim_end_matches(".xlsx").to_string()
        } else {
            validate_project_name(key)?;
            match self.books.get(key) {
                Some(LoadedProject::Ok(_)) => {}
                Some(LoadedProject::Failed(m)) => return Err(load_failed(key, m)),
                None => return Err(not_found(format!("プロジェクト「{key}」がありません"))),
            }
            key.to_string()
        };
        match self.write_recovery_copy_in(key, &stem, now, &self.paths.archive_dir()) {
            Ok(path) => Ok(path),
            Err(first) => self
                .write_recovery_copy_in(key, &stem, now, fallback_dir)
                .map_err(|second| {
                    eprintln!(
                        "recovery copy of {key}: fallback {} failed too: {second}",
                        fallback_dir.display()
                    );
                    first
                }),
        }
    }

    /// One attempt of `write_recovery_copy`: creates `dir` if needed and writes the copy there.
    fn write_recovery_copy_in(
        &self,
        key: &str,
        stem: &str,
        now: NaiveDateTime,
        dir: &Path,
    ) -> AppResult<PathBuf> {
        std::fs::create_dir_all(dir)?;
        let tag = format!("未保存 {}", now.format("%Y%m%d-%H%M"));
        let dest = free_archive_path(dir, stem, &tag);
        // Both writers go through a temp file next to the copy and rename it into place.
        if key == COMMON_KEY {
            write_common_book(&dest, &self.common)?;
        } else if let Some(LoadedProject::Ok(book)) = self.books.get(key) {
            write_project_book(&dest, book, now.date(), &self.common.holidays)?;
        }
        Ok(dest)
    }

    /// The file for `key` (a project name or `"_common"`) differs from what we last wrote or
    /// read. Check this right before writing: the file may have been replaced by an external
    /// save that the watcher has not reported yet, and writing would overwrite it. A missing
    /// file is not a conflict (writing recreates it).
    pub fn changed_on_disk(&self, key: &str) -> bool {
        let path = if key == COMMON_KEY {
            self.paths.common()
        } else {
            match self.paths.project(key) {
                Ok(p) => p,
                Err(_) => return false,
            }
        };
        verdict(self.recorded(key), fingerprint(&path)) == Verdict::Changed
    }

    /// Accepts the file's current state as known without reading it, so the next write goes
    /// through (the user chose to overwrite the external change).
    pub fn accept_disk_state(&mut self, key: &str) {
        let path = if key == COMMON_KEY {
            self.paths.common()
        } else {
            match self.paths.project(key) {
                Ok(p) => p,
                Err(_) => return,
            }
        };
        self.record_written(key, &path);
    }

    /// Re-reads a project after an external change. Unlike `reload_discarding`, a file that
    /// cannot be read (Excel mid-save, a broken file) changes nothing: the old book, its
    /// unsaved-changes flag and its fingerprint stay, and the error is returned. On success
    /// unsaved edits are dropped (the caller decided that).
    pub fn reload_external(&mut self, name: &str) -> AppResult<()> {
        if !self.common.projects.iter().any(|p| p.name == name) {
            return Err(not_found(format!("プロジェクト「{name}」がありません")));
        }
        let (book, changed) = self
            .read_normalized(name)
            .map_err(|message| AppError::Corrupt { message })?;
        self.books.insert(name.to_string(), LoadedProject::Ok(book));
        self.dirty.remove(name);
        if changed {
            self.dirty.insert(name.to_string());
        }
        Ok(())
    }

    /// The data folder itself is gone: every project is missing and nothing can be held.
    pub fn mark_all_missing(&mut self) {
        let names: Vec<String> = self.books.keys().cloned().collect();
        for name in names {
            self.mark_missing(&name);
        }
        self.held.clear();
    }

    /// `path` is the file of a listed project, reached under another spelling (the case of the
    /// name after a case-only rename, a different Unicode normalization). Not a new file.
    pub fn is_listed_project_file(&self, path: &Path) -> bool {
        self.common.projects.iter().any(|p| {
            self.paths
                .project(&p.name)
                .is_ok_and(|listed| same_file(&listed, path))
        })
    }

    /// Remembers the file's current size and modification time as "our" state. Call right after
    /// writing or reading a workbook (`key` is the project name or `"_common"`). A file that
    /// cannot be inspected clears the record.
    pub fn record_written(&mut self, key: &str, path: &Path) {
        match fingerprint(path) {
            Some(f) => {
                self.last_written.insert(key.to_string(), f);
            }
            None => {
                self.last_written.remove(key);
            }
        }
    }

    pub fn recorded(&self, key: &str) -> Option<&Fingerprint> {
        self.last_written.get(key)
    }

    pub fn is_held(&self, name: &str) -> bool {
        self.held.contains(name)
    }

    pub fn hold(&mut self, name: &str) {
        self.held.insert(name.to_string());
    }

    pub fn release(&mut self, name: &str) {
        self.held.remove(name);
    }

    pub fn held_projects(&self) -> Vec<String> {
        self.held.iter().cloned().collect()
    }

    /// The file disappeared under us (deleted, or moved away by hand). Unsaved edits are
    /// dropped with it; the project shows as failed to load until the file comes back.
    pub fn mark_missing(&mut self, name: &str) {
        if self.books.contains_key(name) {
            self.dirty.remove(name);
            self.held.remove(name);
            self.last_written.remove(name);
            self.books.insert(
                name.to_string(),
                LoadedProject::Failed("ファイルが見つかりません".into()),
            );
        }
    }

    /// A new `<name>.xlsx` appeared: list it in the common workbook (which becomes dirty) and
    /// load it.
    pub fn adopt_new_file(&mut self, name: &str) -> AppResult<ProjectSummary> {
        if !self.common.projects.iter().any(|p| p.name == name) {
            let order = self.next_project_order();
            self.common.projects.push(Project {
                name: name.into(),
                color: DEFAULT_COLOR.into(),
                order,
                favorite: false,
                inbox: false,
            });
            self.common_dirty = true;
        }
        let loaded = self.load_from_disk(name);
        self.books.insert(name.to_string(), loaded);
        let p = self
            .common
            .projects
            .iter()
            .find(|p| p.name == name)
            .cloned()
            .expect("listed above");
        Ok(self.summary(&p))
    }

    /// Re-reads the common workbook (labels, colors, holidays, settings), discarding unsaved
    /// edits to it. Projects loaded here but no longer listed in the file are kept and
    /// re-listed (so the common workbook comes back dirty); `.xlsx` files that are listed or
    /// new but not loaded yet are loaded. The common workbook is clean afterwards unless that
    /// re-listing happened.
    pub fn reload_common(&mut self) -> AppResult<()> {
        let path = self.paths.common();
        let fresh = read_common_book(&path)?;
        let unlisted: Vec<Project> = self
            .common
            .projects
            .iter()
            .filter(|p| !fresh.projects.iter().any(|f| f.name == p.name))
            .cloned()
            .collect();
        self.common = fresh;
        self.common_dirty = false;
        self.record_written(COMMON_KEY, &path);
        if !unlisted.is_empty() {
            self.common.projects.extend(unlisted);
            self.common_dirty = true;
        }
        self.adopt_unlisted();
        let to_load: Vec<String> = self
            .common
            .projects
            .iter()
            .map(|p| p.name.clone())
            .filter(|n| !self.books.contains_key(n))
            .collect();
        for name in to_load {
            let loaded = self.load_from_disk(&name);
            self.books.insert(name, loaded);
        }
        let holidays = self.common.holidays.clone();
        for b in self.books.values_mut() {
            if let LoadedProject::Ok(book) = b {
                recompute_days(book, &holidays);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{INBOX, Priority};
    use crate::error::AppError;
    use crate::store::cells::RawCell;
    use crate::store::project_book::{
        ProjectBook, created_at_sentinel, read_project_book, write_project_book,
    };
    use chrono::NaiveTime;
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M").unwrap()
    }

    type Clock = Arc<Mutex<NaiveDateTime>>;

    struct Env {
        dir: tempfile::TempDir,
        clock: Clock,
        store: ProjectStore,
    }

    fn open_at(dir: &Path, clock: &Clock) -> ProjectStore {
        let c = Arc::clone(clock);
        ProjectStore::open(Paths::new(dir), move || *c.lock().unwrap(), true).unwrap()
    }

    fn env() -> Env {
        let dir = tempfile::tempdir().unwrap();
        let clock: Clock = Arc::new(Mutex::new(dt("2026-10-14T09:30")));
        let store = open_at(&dir.path().join("data"), &clock);
        Env { dir, clock, store }
    }

    impl Env {
        fn data(&self) -> std::path::PathBuf {
            self.dir.path().join("data")
        }
        fn reopen(&self) -> ProjectStore {
            open_at(&self.data(), &self.clock)
        }
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

    fn child_of(title: &str, parent: u32) -> TaskInput {
        TaskInput {
            parent_no: Some(parent),
            ..input(title)
        }
    }

    fn nos(v: &ProjectView) -> Vec<u32> {
        v.tasks.iter().map(|t| t.no).collect()
    }

    fn task(v: &ProjectView, no: u32) -> &Task {
        v.tasks.iter().find(|t| t.no == no).unwrap()
    }

    #[test]
    fn open_creates_common_and_inbox() {
        let e = env();
        assert!(e.data().join("_PowerToDo.xlsx").exists());
        assert!(e.data().join("受信トレイ.xlsx").exists());
        let s = e.store.summaries();
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].name, INBOX);
        assert!(s[0].inbox);
        assert_eq!(s[0].task_count, 0);
        assert!(s[0].load_error.is_none());
        assert!(e.store.dirty_projects().is_empty());
        assert!(!e.store.common_dirty());
        // Reopening reads the same files back.
        let again = e.reopen();
        assert_eq!(again.summaries().len(), 1);
    }

    #[test]
    fn add_task_numbers_and_saves() {
        let mut e = env();
        e.store
            .create_project("仕事", "var(--color-priority-2)")
            .unwrap();
        let v = e.store.add_task("仕事", input("資料を作る")).unwrap();
        assert_eq!(nos(&v), vec![1]);
        let v = e.store.add_task("仕事", input("表を作る")).unwrap();
        assert_eq!(nos(&v), vec![1, 2]);
        let t = task(&v, 2);
        assert_eq!(t.project, "仕事");
        assert_eq!(t.assignee, e.store.settings().display_name);
        assert_eq!(t.created_at, dt("2026-10-14T09:30"));
        assert_eq!(t.priority, Priority(4));
        assert_eq!(t.progress, 0);
        assert!(task(&v, 1).order < t.order);
        assert_eq!(e.store.dirty_projects(), vec!["仕事".to_string()]);

        e.store.save("仕事").unwrap();
        assert!(e.store.dirty_projects().is_empty());
        let on_disk = read_project_book(&e.data().join("仕事.xlsx")).unwrap();
        assert_eq!(on_disk.tasks.len(), 2);
        assert_eq!(on_disk.tasks[1].title, "表を作る");
    }

    #[test]
    fn delete_parent_removes_descendants_and_keeps_numbering() {
        let mut e = env();
        e.store.add_task(INBOX, input("親")).unwrap(); // 1
        e.store.add_task(INBOX, child_of("子", 1)).unwrap(); // 2
        e.store.add_task(INBOX, child_of("孫", 2)).unwrap(); // 3
        e.store.add_task(INBOX, input("他")).unwrap(); // 4
        let v = e.store.delete_task(INBOX, 1).unwrap();
        assert_eq!(nos(&v), vec![4]);
        let v = e.store.add_task(INBOX, input("次")).unwrap();
        assert_eq!(nos(&v), vec![4, 5]);
    }

    #[test]
    fn move_task_renumbers_and_keeps_tree() {
        let mut e = env();
        e.store.create_project("A", "c").unwrap();
        e.store.create_project("B", "c").unwrap();
        e.store.add_section("A", "今週").unwrap();
        e.store.add_section("B", "来週").unwrap();
        e.store.add_task("B", input("b1")).unwrap(); // B1
        e.store.add_task("B", input("b2")).unwrap(); // B2
        e.store.add_task("A", input("a1")).unwrap(); // A1
        e.store.add_task("A", child_of("a2", 1)).unwrap(); // A2 (child of A1, stays behind)
        e.store.add_task("A", child_of("a3", 2)).unwrap(); // A3 (child of A2)
        e.store.add_task("A", child_of("a4", 3)).unwrap(); // A4 (grandchild)
        e.store.save("A").unwrap();
        e.store.save("B").unwrap();

        let (from, to) = e.store.move_task("A", 2, "B", Some("来週")).unwrap();
        assert_eq!(nos(&from), vec![1]);
        assert_eq!(nos(&to), vec![1, 2, 3, 4, 5]);
        let root = task(&to, 3);
        assert_eq!(root.title, "a2");
        assert_eq!(root.parent_no, None, "detached from its old parent");
        assert_eq!(task(&to, 4).title, "a3");
        assert_eq!(task(&to, 4).parent_no, Some(3));
        assert_eq!(task(&to, 5).title, "a4");
        assert_eq!(task(&to, 5).parent_no, Some(4));
        for n in [3, 4, 5] {
            assert_eq!(task(&to, n).project, "B");
            assert_eq!(task(&to, n).category.as_deref(), Some("来週"));
        }
        let mut dirty = e.store.dirty_projects();
        dirty.sort();
        assert_eq!(dirty, vec!["A".to_string(), "B".to_string()]);

        // Unknown target / section: nothing moves.
        assert!(matches!(
            e.store.move_task("B", 1, "Z", None),
            Err(AppError::NotFound { .. })
        ));
        assert!(e.store.move_task("B", 1, "A", Some("無い")).is_err());
        assert_eq!(nos(&e.store.view("B").unwrap()), vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn save_failure_keeps_dirty_state() {
        let mut e = env();
        e.store.create_project("仕事", "c").unwrap();
        e.store.add_task("仕事", input("残る")).unwrap();
        // Make the target path a directory so the final rename fails.
        let path = e.data().join("仕事.xlsx");
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();

        let err = e.store.save("仕事").unwrap_err();
        // Unix reports the rename over a directory as a plain I/O error; Windows returns
        // ERROR_ACCESS_DENIED (os error 5), which maps to `Locked`. Either way the save fails.
        assert!(
            matches!(err, AppError::Io { .. } | AppError::Locked { .. }),
            "{err:?}"
        );
        assert_eq!(e.store.dirty_projects(), vec!["仕事".to_string()]);
        assert_eq!(nos(&e.store.view("仕事").unwrap()), vec![1]);

        // Once the obstacle is gone, the next save succeeds and clears the flag.
        std::fs::remove_dir(&path).unwrap();
        e.store.save("仕事").unwrap();
        assert!(e.store.dirty_projects().is_empty());
        assert_eq!(read_project_book(&path).unwrap().tasks.len(), 1);
    }

    #[test]
    fn delete_project_archives_file() {
        let mut e = env();
        e.store.create_project("仕事", "c").unwrap();
        e.store.add_task("仕事", input("x")).unwrap();
        e.store.delete_project("仕事").unwrap();
        assert!(!e.data().join("仕事.xlsx").exists());
        let archived = e.data().join("archive").join("仕事 (20261014-0930).xlsx");
        assert!(archived.exists(), "archived file missing");
        // The unsaved task was written before archiving.
        assert_eq!(read_project_book(&archived).unwrap().tasks.len(), 1);
        assert!(e.store.summaries().iter().all(|s| s.name != "仕事"));
        assert!(e.store.dirty_projects().is_empty());
        assert!(matches!(
            e.store.view("仕事"),
            Err(AppError::NotFound { .. })
        ));
        assert!(!e.reopen().summaries().iter().any(|s| s.name == "仕事"));

        assert!(matches!(
            e.store.delete_project(INBOX),
            Err(AppError::Invalid { .. })
        ));
        assert!(e.data().join("受信トレイ.xlsx").exists());
        assert!(matches!(
            e.store.delete_project("無い"),
            Err(AppError::NotFound { .. })
        ));

        // Same name, same minute: the second archive does not overwrite the first.
        e.store.create_project("仕事", "c").unwrap();
        e.store.delete_project("仕事").unwrap();
        let n = std::fs::read_dir(e.data().join("archive")).unwrap().count();
        assert_eq!(n, 2);
    }

    #[test]
    fn held_edits_are_kept_in_a_recovery_copy() {
        use crate::store::common_book::read_common_book;

        let mut e = env();
        e.store.create_project("仕事", "c").unwrap();
        e.store.save("仕事").unwrap();
        e.store.add_task("仕事", input("未保存の作業")).unwrap();
        e.store.hold("仕事");
        assert_eq!(e.store.unsavable_keys(), vec!["仕事".to_string()]);

        let now = dt("2026-10-14T18:05");
        let fb = e.dir.path().join("app").join("recovery");
        let path = e.store.write_recovery_copy("仕事", now, &fb).unwrap();
        assert_eq!(
            path,
            e.data()
                .join("archive")
                .join("仕事 (未保存 20261014-1805).xlsx")
        );
        let copy = read_project_book(&path).unwrap();
        assert_eq!(copy.tasks.len(), 1);
        assert_eq!(copy.tasks[0].title, "未保存の作業");
        // The project's own file is untouched and the store still holds the edits.
        assert!(
            read_project_book(&e.data().join("仕事.xlsx"))
                .unwrap()
                .tasks
                .is_empty()
        );
        assert!(e.store.is_held("仕事"));
        assert_eq!(e.store.dirty_projects(), vec!["仕事".to_string()]);

        // Same minute again: a second copy, not an overwrite.
        let again = e.store.write_recovery_copy("仕事", now, &fb).unwrap();
        assert_eq!(
            again,
            e.data()
                .join("archive")
                .join("仕事 (未保存 20261014-1805-2).xlsx")
        );

        // The common workbook is copied under the common file's name.
        let mut settings = e.store.settings();
        settings.display_name = "回復".into();
        e.store.update_settings(settings).unwrap();
        let common = e.store.write_recovery_copy("_common", now, &fb).unwrap();
        assert_eq!(
            common,
            e.data()
                .join("archive")
                .join("_PowerToDo (未保存 20261014-1805).xlsx")
        );
        assert_eq!(
            read_common_book(&common).unwrap().settings.display_name,
            "回復"
        );
        assert!(matches!(
            e.store.write_recovery_copy("無い", now, &fb),
            Err(AppError::NotFound { .. })
        ));
    }

    #[test]
    fn complete_sets_progress_and_timestamp() {
        let mut e = env();
        e.store.add_task(INBOX, input("やる")).unwrap();
        let v = e.store.complete_task(INBOX, 1, true).unwrap();
        assert_eq!(task(&v, 1).progress, 100);
        assert_eq!(task(&v, 1).completed_at, Some(dt("2026-10-14T09:30")));

        // Completing again keeps the original timestamp.
        *e.clock.lock().unwrap() = dt("2026-10-15T10:00");
        let v = e.store.complete_task(INBOX, 1, true).unwrap();
        assert_eq!(task(&v, 1).completed_at, Some(dt("2026-10-14T09:30")));

        let v = e.store.complete_task(INBOX, 1, false).unwrap();
        assert_eq!(task(&v, 1).progress, 0);
        assert_eq!(task(&v, 1).completed_at, None);
        assert!(matches!(
            e.store.complete_task(INBOX, 99, true),
            Err(AppError::NotFound { .. })
        ));

        // Setting progress through a patch keeps completed_at consistent.
        let patch = TaskPatch {
            progress: Some(100),
            ..Default::default()
        };
        let v = e.store.update_task(INBOX, 1, patch).unwrap();
        assert_eq!(task(&v, 1).completed_at, Some(dt("2026-10-15T10:00")));
        let patch = TaskPatch {
            progress: Some(40),
            ..Default::default()
        };
        let v = e.store.update_task(INBOX, 1, patch).unwrap();
        assert_eq!(task(&v, 1).completed_at, None);
        assert!(
            e.store
                .update_task(
                    INBOX,
                    1,
                    TaskPatch {
                        progress: Some(101),
                        ..Default::default()
                    }
                )
                .is_err()
        );
    }

    #[test]
    fn failed_load_is_reported_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("壊れ.xlsx"), "ただのテキスト").unwrap();
        let clock: Clock = Arc::new(Mutex::new(dt("2026-10-14T09:30")));
        let mut store = open_at(&data, &clock);

        let s = store.summaries();
        assert_eq!(s.len(), 2);
        let broken = s.iter().find(|s| s.name == "壊れ").unwrap();
        assert!(broken.load_error.is_some());
        assert_eq!(broken.task_count, 0);
        assert!(
            s.iter()
                .find(|s| s.name == INBOX)
                .unwrap()
                .load_error
                .is_none()
        );
        assert!(matches!(store.view("壊れ"), Err(AppError::Corrupt { .. })));
        assert!(store.add_task("壊れ", input("x")).is_err());
        assert!(store.save("壊れ").is_err());
        // The broken file is never overwritten.
        assert_eq!(
            std::fs::read(data.join("壊れ.xlsx")).unwrap(),
            "ただのテキスト".as_bytes()
        );

        // Others keep working, and a reload picks up a repaired file.
        store.add_task(INBOX, input("使える")).unwrap();
        assert!(store.reload("壊れ").is_err());
        write_project_book(
            &data.join("壊れ.xlsx"),
            &ProjectBook {
                project: "壊れ".into(),
                ..Default::default()
            },
            NaiveDate::from_ymd_opt(2026, 10, 14).unwrap(),
            &[],
        )
        .unwrap();
        assert!(store.reload("壊れ").is_ok());
        assert!(store.summaries().iter().all(|s| s.load_error.is_none()));
    }

    #[test]
    fn rename_project_updates_file_and_tasks() {
        let mut e = env();
        e.store.create_project("旧", "c").unwrap();
        e.store.create_project("既存", "c").unwrap();
        e.store.add_task("旧", input("x")).unwrap();
        e.store.save("旧").unwrap();

        let s = e.store.rename_project("旧", "新").unwrap();
        assert_eq!(s.name, "新");
        assert!(!e.data().join("旧.xlsx").exists());
        assert!(e.data().join("新.xlsx").exists());
        let v = e.store.view("新").unwrap();
        assert_eq!(v.project.name, "新");
        assert_eq!(task(&v, 1).project, "新");
        assert_eq!(e.store.dirty_projects(), vec!["新".to_string()]);
        assert!(matches!(e.store.view("旧"), Err(AppError::NotFound { .. })));
        e.store.save("新").unwrap();

        // Persisted: the common book and the project cell both carry the new name.
        let again = e.reopen();
        assert!(again.summaries().iter().any(|s| s.name == "新"));
        assert!(!again.summaries().iter().any(|s| s.name == "旧"));
        assert_eq!(task(&again.view("新").unwrap(), 1).project, "新");

        assert!(matches!(
            e.store.rename_project("新", "既存"),
            Err(AppError::Invalid { .. })
        ));
        assert!(matches!(
            e.store.rename_project("新", "a/b"),
            Err(AppError::Invalid { .. })
        ));
        assert!(matches!(
            e.store.rename_project(INBOX, "x"),
            Err(AppError::Invalid { .. })
        ));
        assert!(matches!(
            e.store.rename_project("無い", "x"),
            Err(AppError::NotFound { .. })
        ));
        assert!(e.data().join("新.xlsx").exists());
    }

    #[test]
    fn due_time_midnight_is_none() {
        let mut e = env();
        let d = NaiveDate::from_ymd_opt(2026, 10, 20).unwrap();
        let midnight = NaiveTime::MIN;
        let mut i = input("a");
        i.due = Some(d);
        i.due_time = Some(midnight);
        let v = e.store.add_task(INBOX, i).unwrap();
        assert_eq!(task(&v, 1).due, Some(d));
        assert_eq!(task(&v, 1).due_time, None);

        let nine = NaiveTime::from_hms_opt(9, 0, 0).unwrap();
        let patch = TaskPatch {
            due_time: Some(Some(nine)),
            ..Default::default()
        };
        let v = e.store.update_task(INBOX, 1, patch).unwrap();
        assert_eq!(task(&v, 1).due_time, Some(nine));
        let patch = TaskPatch {
            due_time: Some(Some(midnight)),
            ..Default::default()
        };
        let v = e.store.update_task(INBOX, 1, patch).unwrap();
        assert_eq!(task(&v, 1).due_time, None);

        // A time without a date is meaningless and is dropped.
        let mut i = input("b");
        i.due_time = Some(nine);
        let v = e.store.add_task(INBOX, i).unwrap();
        assert_eq!(task(&v, 2).due_time, None);
        let patch = TaskPatch {
            due_time: Some(Some(nine)),
            ..Default::default()
        };
        e.store.update_task(INBOX, 1, patch).unwrap();
        let patch = TaskPatch {
            due: Some(None),
            ..Default::default()
        };
        let v = e.store.update_task(INBOX, 1, patch).unwrap();
        assert_eq!((task(&v, 1).due, task(&v, 1).due_time), (None, None));
    }

    /// A project file with one valid task (No. 1) and one row whose 終了 is text (No. 9).
    fn write_book_with_invalid_row(path: &Path, project: &str) {
        let mut cells = vec![RawCell::Empty; 18];
        cells[0] = RawCell::Number(9.0);
        cells[1] = RawCell::Text(project.into());
        cells[3] = RawCell::Text("謎".into());
        cells[8] = RawCell::Text("来週".into());
        let valid = Task {
            no: 1,
            project: project.into(),
            category: None,
            title: "普通".into(),
            assignee: "x".into(),
            priority: Priority(4),
            progress: 0,
            start: None,
            due: None,
            due_time: None,
            days: None,
            note: None,
            parent_no: None,
            labels: vec![],
            rrule: None,
            rrule_label: None,
            reminders: vec![],
            order: 1,
            created_at: dt("2026-10-01T09:00"),
            completed_at: None,
            extra: BTreeMap::new(),
        };
        let book = ProjectBook {
            project: project.into(),
            tasks: vec![valid],
            invalid_cells: BTreeMap::from([(3, cells)]),
            ..Default::default()
        };
        write_project_book(
            path,
            &book,
            NaiveDate::from_ymd_opt(2026, 10, 14).unwrap(),
            &[],
        )
        .unwrap();
    }

    #[test]
    fn next_no_includes_invalid_rows() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        write_book_with_invalid_row(&data.join("仕事.xlsx"), "仕事");
        let clock: Clock = Arc::new(Mutex::new(dt("2026-10-14T09:30")));
        let mut store = open_at(&data, &clock);

        let v = store.view("仕事").unwrap();
        assert_eq!(nos(&v), vec![1]);
        assert_eq!(v.invalid_rows.len(), 1);
        assert_eq!(v.invalid_rows[0].no, Some(9));
        assert_eq!(v.invalid_rows[0].row, 3);

        let v = store.add_task("仕事", input("新")).unwrap();
        assert_eq!(nos(&v), vec![1, 10]);

        // Saving moves the invalid row below the tasks; the store refreshes its row numbers.
        store.save("仕事").unwrap();
        let v = store.view("仕事").unwrap();
        assert_eq!(v.invalid_rows.len(), 1);
        assert_eq!(v.invalid_rows[0].row, 4);
        let on_disk = read_project_book(&data.join("仕事.xlsx")).unwrap();
        assert_eq!(on_disk.invalid_rows, v.invalid_rows);
    }

    #[test]
    fn numbers_are_not_reused_after_deleting_the_last_task() {
        let mut e = env();
        e.store.add_task(INBOX, input("1")).unwrap();
        e.store.add_task(INBOX, input("2")).unwrap();
        e.store.delete_task(INBOX, 2).unwrap();
        let v = e.store.add_task(INBOX, input("3")).unwrap();
        assert_eq!(nos(&v), vec![1, 3]);
    }

    #[test]
    fn sections_add_rename_reorder() {
        let mut e = env();
        e.store.create_project("仕事", "c").unwrap();
        e.store.add_section("仕事", "今週").unwrap();
        let v = e.store.add_section("仕事", "来週").unwrap();
        let names: Vec<_> = v
            .sections
            .iter()
            .map(|s| (s.name.as_str(), s.order))
            .collect();
        assert_eq!(names, vec![("今週", 0), ("来週", 1)]);
        assert!(e.store.add_section("仕事", "今週").is_err());
        assert!(e.store.add_section("仕事", "  ").is_err());

        let mut i = input("t");
        i.section = Some("今週".into());
        e.store.add_task("仕事", i).unwrap();
        let mut bad = input("u");
        bad.section = Some("無い".into());
        assert!(e.store.add_task("仕事", bad).is_err());

        let v = e.store.rename_section("仕事", "今週", "今月").unwrap();
        assert_eq!(v.sections[0].name, "今月");
        assert_eq!(task(&v, 1).category.as_deref(), Some("今月"));
        assert!(e.store.rename_section("仕事", "今月", "来週").is_err());
        assert!(matches!(
            e.store.rename_section("仕事", "無い", "x"),
            Err(AppError::NotFound { .. })
        ));

        let v = e
            .store
            .reorder_sections("仕事", &["来週".to_string(), "今月".to_string()])
            .unwrap();
        let names: Vec<_> = v.sections.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["来週", "今月"]);
        assert!(
            e.store
                .reorder_sections("仕事", &["無い".to_string()])
                .is_err()
        );
    }

    #[test]
    fn update_task_validates_parent() {
        let mut e = env();
        e.store.add_task(INBOX, input("a")).unwrap(); // 1
        e.store.add_task(INBOX, child_of("b", 1)).unwrap(); // 2
        let set_parent = |p: Option<u32>| TaskPatch {
            parent_no: Some(p),
            ..Default::default()
        };
        // Self, descendant (cycle), unknown parent.
        assert!(e.store.update_task(INBOX, 1, set_parent(Some(1))).is_err());
        assert!(e.store.update_task(INBOX, 1, set_parent(Some(2))).is_err());
        assert!(matches!(
            e.store.update_task(INBOX, 1, set_parent(Some(9))),
            Err(AppError::NotFound { .. })
        ));
        let v = e.store.update_task(INBOX, 2, set_parent(None)).unwrap();
        assert_eq!(task(&v, 2).parent_no, None);
        assert!(matches!(
            e.store.add_task(INBOX, child_of("c", 99)),
            Err(AppError::NotFound { .. })
        ));
        // Empty titles are rejected.
        assert!(e.store.add_task(INBOX, input("  ")).is_err());
        let patch = TaskPatch {
            title: Some(" ".into()),
            ..Default::default()
        };
        assert!(e.store.update_task(INBOX, 1, patch).is_err());
    }

    #[test]
    fn reorder_tasks_sets_order() {
        let mut e = env();
        for t in ["a", "b", "c"] {
            e.store.add_task(INBOX, input(t)).unwrap();
        }
        let v = e.store.reorder_tasks(INBOX, None, &[3, 1, 2]).unwrap();
        let mut by_order: Vec<_> = v.tasks.iter().map(|t| (t.order, t.no)).collect();
        by_order.sort();
        assert_eq!(
            by_order.iter().map(|(_, n)| *n).collect::<Vec<_>>(),
            vec![3, 1, 2]
        );
        assert!(e.store.reorder_tasks(INBOX, None, &[9]).is_err());
        assert!(e.store.reorder_tasks(INBOX, Some("無い"), &[1]).is_err());
    }

    #[test]
    fn create_project_validates() {
        let mut e = env();
        let s = e
            .store
            .create_project("仕事", "var(--color-priority-2)")
            .unwrap();
        assert_eq!(
            (s.name.as_str(), s.inbox, s.favorite),
            ("仕事", false, false)
        );
        assert_eq!(s.order, 1);
        assert!(e.data().join("仕事.xlsx").exists());
        assert!(matches!(
            e.store.create_project("仕事", "c"),
            Err(AppError::Invalid { .. })
        ));
        assert!(matches!(
            e.store.create_project("a/b", "c"),
            Err(AppError::Invalid { .. })
        ));
        assert!(matches!(
            e.store.create_project(INBOX, "c"),
            Err(AppError::Invalid { .. })
        ));
        // A stray file with that name also blocks creation instead of being overwritten.
        std::fs::write(e.data().join("既に.xlsx"), "x").unwrap();
        assert!(e.store.create_project("既に", "c").is_err());
        assert_eq!(std::fs::read(e.data().join("既に.xlsx")).unwrap(), b"x");
    }

    #[test]
    fn unlisted_workbooks_are_adopted_and_legacy_rows_normalized() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        // A workbook dropped into the folder: tasks lack a created_at and name another project.
        let mut t = Task {
            no: 1,
            project: "別名".into(),
            category: Some("未登録".into()),
            title: "x".into(),
            assignee: "a".into(),
            priority: Priority(4),
            progress: 0,
            start: None,
            due: None,
            due_time: None,
            days: None,
            note: None,
            parent_no: None,
            labels: vec![],
            rrule: None,
            rrule_label: None,
            reminders: vec![],
            order: 1,
            created_at: created_at_sentinel(),
            completed_at: None,
            extra: BTreeMap::new(),
        };
        t.order = 1;
        write_project_book(
            &data.join("外部.xlsx"),
            &ProjectBook {
                project: "外部".into(),
                tasks: vec![t],
                ..Default::default()
            },
            NaiveDate::from_ymd_opt(2026, 10, 14).unwrap(),
            &[],
        )
        .unwrap();
        // Excel lock / temp / hidden files are ignored.
        std::fs::write(data.join("~$外部.xlsx"), "x").unwrap();
        std::fs::write(data.join(".powertodo-abc.xlsx"), "x").unwrap();

        let clock: Clock = Arc::new(Mutex::new(dt("2026-10-14T09:30")));
        let store = open_at(&data, &clock);
        let names: Vec<_> = store.summaries().into_iter().map(|s| s.name).collect();
        assert_eq!(names, vec![INBOX.to_string(), "外部".to_string()]);
        let v = store.view("外部").unwrap();
        assert_eq!(task(&v, 1).project, "外部");
        assert_eq!(task(&v, 1).created_at, dt("2026-10-14T09:30"));
        assert_eq!(
            v.sections
                .iter()
                .map(|s| s.name.as_str())
                .collect::<Vec<_>>(),
            vec!["未登録"]
        );
        assert_eq!(store.dirty_projects(), vec!["外部".to_string()]);
        // The adoption is persisted in the common book.
        drop(store);
        let again = open_at(&data, &clock);
        assert_eq!(again.summaries().len(), 2);
    }

    #[test]
    fn settings_update_validates_and_marks_common_dirty() {
        let mut e = env();
        let mut s = e.store.settings();
        s.display_name = "はなこ".into();
        s.week_start = "sun".into();
        let back = e.store.update_settings(s.clone()).unwrap();
        assert_eq!(back, s);
        assert!(e.store.common_dirty());
        e.store.save_common().unwrap();
        assert!(!e.store.common_dirty());
        assert_eq!(e.reopen().settings(), s);

        let mut bad = s.clone();
        bad.week_start = "fri".into();
        assert!(matches!(
            e.store.update_settings(bad),
            Err(AppError::Invalid { .. })
        ));
        let mut bad = s;
        bad.display_name = " ".into();
        assert!(e.store.update_settings(bad).is_err());

        // New tasks use the display name.
        let v = e.store.add_task(INBOX, input("x")).unwrap();
        assert_eq!(task(&v, 1).assignee, "はなこ");
    }

    #[test]
    fn days_follow_holidays_and_dates() {
        let mut e = env();
        let mut i = input("x");
        i.due = Some(NaiveDate::from_ymd_opt(2026, 10, 16).unwrap());
        e.store.add_task(INBOX, i).unwrap();
        let patch = TaskPatch {
            start: Some(Some(NaiveDate::from_ymd_opt(2026, 10, 14).unwrap())),
            ..Default::default()
        };
        let v = e.store.update_task(INBOX, 1, patch).unwrap();
        assert_eq!(task(&v, 1).days, Some(3)); // Wed, Thu, Fri
    }

    #[test]
    fn reload_keeps_high_water_mark() {
        let mut e = env();
        for i in 1..=5 {
            e.store.add_task(INBOX, input(&i.to_string())).unwrap();
        }
        e.store.delete_task(INBOX, 5).unwrap();
        e.store.save(INBOX).unwrap();
        e.store.reload(INBOX).unwrap();
        let v = e.store.add_task(INBOX, input("next")).unwrap();
        assert_eq!(nos(&v), vec![1, 2, 3, 4, 6]);
    }

    #[test]
    fn reload_refuses_unsaved_changes_unless_discarding() {
        let mut e = env();
        e.store.add_task(INBOX, input("保存済み")).unwrap();
        e.store.save(INBOX).unwrap();
        e.store.add_task(INBOX, input("未保存")).unwrap();
        assert_eq!(e.store.dirty_projects(), vec![INBOX.to_string()]);

        let err = e.store.reload(INBOX).unwrap_err();
        assert!(matches!(err, AppError::Unsaved { .. }), "{err:?}");
        // Nothing was dropped.
        assert_eq!(e.store.view(INBOX).unwrap().tasks.len(), 2);
        assert_eq!(e.store.dirty_projects(), vec![INBOX.to_string()]);

        let v = e.store.reload_discarding(INBOX).unwrap();
        assert_eq!(nos(&v), vec![1]);
        assert!(e.store.dirty_projects().is_empty());
        // Clean again, so a plain reload works.
        assert!(e.store.reload(INBOX).is_ok());
    }

    #[test]
    fn delete_project_keeps_project_when_save_fails() {
        let mut e = env();
        e.store.create_project("仕事", "c").unwrap();
        e.store.add_task("仕事", input("未保存")).unwrap();
        // The pre-archive save fails: the target path is a directory.
        let path = e.data().join("仕事.xlsx");
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        // The directory is what we "know" now: this is a failed write, not an external change.
        e.store.accept_disk_state("仕事");

        let err = e.store.delete_project("仕事").unwrap_err();
        // Unix reports the rename over a directory as a plain I/O error; Windows returns
        // ERROR_ACCESS_DENIED (os error 5), which maps to `Locked`. Either way the save fails.
        assert!(
            matches!(err, AppError::Io { .. } | AppError::Locked { .. }),
            "{err:?}"
        );
        assert!(e.store.summaries().iter().any(|s| s.name == "仕事"));
        assert_eq!(e.store.dirty_projects(), vec!["仕事".to_string()]);
        assert_eq!(nos(&e.store.view("仕事").unwrap()), vec![1]);
        assert!(path.is_dir(), "nothing was moved");
        assert!(!e.data().join("archive").exists());
    }

    #[test]
    fn delete_project_refuses_a_held_or_externally_changed_project() {
        let mut e = env();
        e.store.create_project("仕事", "c").unwrap();
        e.store.save("仕事").unwrap();
        e.store.add_task("仕事", input("未保存")).unwrap();
        e.store.hold("仕事");
        let message = |err: AppError| match err {
            AppError::Unsaved { message } => message,
            other => panic!("expected Unsaved, got {other:?}"),
        };
        let held = message(e.store.delete_project("仕事").unwrap_err());
        assert_eq!(
            held,
            "「仕事」は Excel で変更されています。帯の操作で解決してから削除してください"
        );
        // Nothing was written or moved: the file is as it was, the edit is still ours.
        assert!(
            read_project_book(&e.data().join("仕事.xlsx"))
                .unwrap()
                .tasks
                .is_empty()
        );
        assert!(!e.data().join("archive").exists());
        assert_eq!(e.store.dirty_projects(), vec!["仕事".to_string()]);
        assert!(e.store.summaries().iter().any(|s| s.name == "仕事"));

        // Not held yet, but Excel saved the file and the watcher has not reported it.
        e.store.release("仕事");
        let mut other = e.reopen();
        other.add_task("仕事", input("Excel の作業")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        other.save("仕事").unwrap();
        assert!(e.store.changed_on_disk("仕事"));
        let changed = message(e.store.delete_project("仕事").unwrap_err());
        assert_eq!(changed, held);
        assert_eq!(
            read_project_book(&e.data().join("仕事.xlsx"))
                .unwrap()
                .tasks[0]
                .title,
            "Excel の作業"
        );
        assert!(!e.data().join("archive").exists());
        assert!(e.store.summaries().iter().any(|s| s.name == "仕事"));
    }

    #[test]
    fn delete_project_archives_a_file_that_failed_to_load() {
        let mut e = env();
        e.store.create_project("壊れた", "c").unwrap();
        e.store.save("壊れた").unwrap();
        let path = e.data().join("壊れた.xlsx");
        std::fs::write(&path, b"not a workbook").unwrap();
        assert!(e.store.reload_discarding("壊れた").is_err());
        assert!(e.store.dirty_projects().is_empty());

        e.store.delete_project("壊れた").unwrap();
        assert!(!path.exists());
        let n = std::fs::read_dir(e.data().join("archive")).unwrap().count();
        assert_eq!(n, 1, "the broken file was moved to archive/");
        assert!(e.store.summaries().iter().all(|s| s.name != "壊れた"));
    }

    #[test]
    fn recovery_copy_falls_back_when_archive_cannot_be_written() {
        let mut e = env();
        e.store.create_project("仕事", "c").unwrap();
        e.store.save("仕事").unwrap();
        e.store.add_task("仕事", input("未保存の作業")).unwrap();
        // A file named `archive` keeps the folder from being created.
        std::fs::write(e.data().join("archive"), b"not a folder").unwrap();
        let fallback = e.dir.path().join("app").join("recovery");

        let now = dt("2026-10-14T18:05");
        let path = e.store.write_recovery_copy("仕事", now, &fallback).unwrap();
        assert_eq!(path, fallback.join("仕事 (未保存 20261014-1805).xlsx"));
        assert_eq!(
            read_project_book(&path).unwrap().tasks[0].title,
            "未保存の作業"
        );
        // A second copy in the same minute does not overwrite the first.
        let again = e.store.write_recovery_copy("仕事", now, &fallback).unwrap();
        assert_eq!(again, fallback.join("仕事 (未保存 20261014-1805-2).xlsx"));

        // When the fallback cannot be written either, the archive error is returned.
        std::fs::write(e.dir.path().join("blocked"), b"x").unwrap();
        let err = e
            .store
            .write_recovery_copy("仕事", now, &e.dir.path().join("blocked").join("recovery"))
            .unwrap_err();
        assert!(matches!(err, AppError::Io { .. }), "{err:?}");

        // A writable archive/ is preferred and the fallback stays unused.
        std::fs::remove_file(e.data().join("archive")).unwrap();
        let other_fallback = e.dir.path().join("unused");
        let normal = e
            .store
            .write_recovery_copy("仕事", now, &other_fallback)
            .unwrap();
        assert!(normal.starts_with(e.data().join("archive")));
        assert!(!other_fallback.exists());
    }

    #[test]
    fn open_without_create_requires_existing_folder() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("missing");
        let clock: Clock = Arc::new(Mutex::new(dt("2026-10-14T09:30")));
        let c = Arc::clone(&clock);
        let r = ProjectStore::open(Paths::new(&data), move || *c.lock().unwrap(), false);
        assert!(matches!(r, Err(AppError::NotFound { .. })));
        assert!(!data.exists(), "no folder is created");

        // An existing folder opens without `create`.
        std::fs::create_dir_all(&data).unwrap();
        let c = Arc::clone(&clock);
        let s = ProjectStore::open(Paths::new(&data), move || *c.lock().unwrap(), false).unwrap();
        assert_eq!(s.summaries().len(), 1);
    }

    fn is_corrupt<T>(r: AppResult<T>) -> bool {
        matches!(r, Err(AppError::Corrupt { .. }))
    }

    #[test]
    fn failed_project_is_corrupt_everywhere() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("壊れ.xlsx"), "ただのテキスト").unwrap();
        let clock: Clock = Arc::new(Mutex::new(dt("2026-10-14T09:30")));
        let mut s = open_at(&data, &clock);
        s.add_task(INBOX, input("x")).unwrap();
        let b = "壊れ";

        assert!(is_corrupt(s.view(b)));
        assert!(is_corrupt(s.add_task(b, input("x"))));
        assert!(is_corrupt(s.update_task(b, 1, TaskPatch::default())));
        assert!(is_corrupt(s.complete_task(b, 1, true)));
        assert!(is_corrupt(s.delete_task(b, 1)));
        assert!(is_corrupt(s.add_section(b, "s")));
        assert!(is_corrupt(s.rename_section(b, "s", "t")));
        assert!(is_corrupt(s.reorder_sections(b, &[])));
        assert!(is_corrupt(s.reorder_tasks(b, None, &[])));
        assert!(is_corrupt(s.move_task(b, 1, INBOX, None)));
        assert!(is_corrupt(s.move_task(INBOX, 1, b, None)));
        assert!(is_corrupt(s.save(b)));
        // A missing task in a loaded project stays NotFound.
        assert!(matches!(
            s.complete_task(INBOX, 99, true),
            Err(AppError::NotFound { .. })
        ));
    }

    #[test]
    fn move_task_adds_assignees_to_target() {
        let mut e = env();
        e.store.create_project("A", "c").unwrap();
        e.store.create_project("B", "c").unwrap();
        e.store.add_task("A", input("親")).unwrap();
        e.store.add_task("A", child_of("子", 1)).unwrap();
        let patch = TaskPatch {
            assignee: Some("佐藤".into()),
            ..Default::default()
        };
        e.store.update_task("A", 2, patch).unwrap();
        e.store.move_task("A", 1, "B", None).unwrap();
        e.store.save("B").unwrap();

        let b = read_project_book(&e.data().join("B.xlsx")).unwrap();
        let me = e.store.settings().display_name;
        assert!(
            b.assignees.contains(&"佐藤".to_string()),
            "{:?}",
            b.assignees
        );
        assert_eq!(b.assignees.iter().filter(|a| **a == me).count(), 1);
    }

    fn ymd(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    fn hm(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    #[test]
    fn completing_a_recurring_task_moves_the_due_date() {
        let mut e = env(); // clock = 2026-10-14 (Wednesday) 09:30
        let mut i = input("ゴミ出し");
        i.due = Some(ymd(2026, 10, 13)); // a Tuesday
        i.due_time = Some(hm(8, 0));
        i.rrule = Some("FREQ=WEEKLY;BYDAY=TU".into());
        let v = e.store.add_task(INBOX, i).unwrap();
        let no = v.tasks[0].no;
        assert_eq!(v.tasks[0].reminders, vec!["-0m".to_string()]); // default reminder
        let v = e.store.complete_task(INBOX, no, true).unwrap();
        let t = &v.tasks[0];
        assert_eq!(t.progress, 0);
        assert_eq!(t.completed_at, None);
        assert_eq!(t.due, Some(ymd(2026, 10, 20)));
        assert_eq!(t.due_time, Some(hm(8, 0)));
        assert_eq!(t.rrule_label.as_deref(), Some("毎週火曜"));
        assert!(v.warnings.is_empty());
        assert_eq!(e.store.dirty_projects(), vec![INBOX.to_string()]);
    }

    #[test]
    fn completion_based_recurrence_counts_from_today() {
        let mut e = env();
        let mut i = input("水やり");
        i.due = Some(ymd(2026, 10, 1));
        i.rrule = Some("FREQ=DAILY;INTERVAL=3;X-FROM=COMPLETED".into());
        let v = e.store.add_task(INBOX, i).unwrap();
        let v = e.store.complete_task(INBOX, v.tasks[0].no, true).unwrap();
        assert_eq!(v.tasks[0].due, Some(ymd(2026, 10, 17)));
    }

    #[test]
    fn unreadable_rrule_completes_normally_with_a_warning() {
        let mut e = env();
        let mut i = input("x");
        i.rrule = Some("FREQ=SOMETIMES".into());
        let v = e.store.add_task(INBOX, i).unwrap();
        let v = e.store.complete_task(INBOX, v.tasks[0].no, true).unwrap();
        assert_eq!(v.tasks[0].progress, 100);
        assert_eq!(v.warnings.len(), 1);
        assert!(v.warnings[0].contains("FREQ=SOMETIMES"));
        // The label falls back to the raw string.
        assert_eq!(v.tasks[0].rrule_label.as_deref(), Some("FREQ=SOMETIMES"));
    }

    #[test]
    fn exhausted_recurrence_is_removed() {
        let mut e = env();
        let mut i = input("最後");
        i.due = Some(ymd(2026, 10, 13));
        i.rrule = Some("FREQ=DAILY;COUNT=1".into());
        let v = e.store.add_task(INBOX, i).unwrap();
        let v = e.store.complete_task(INBOX, v.tasks[0].no, true).unwrap();
        assert_eq!(v.tasks[0].progress, 100);
        assert_eq!(v.tasks[0].rrule, None);
        assert_eq!(v.tasks[0].rrule_label, None);
    }

    #[test]
    fn reopening_a_task_does_not_touch_the_recurrence() {
        let mut e = env();
        let mut i = input("z");
        i.due = Some(ymd(2026, 10, 13));
        i.rrule = Some("FREQ=DAILY;COUNT=1".into());
        let v = e.store.add_task(INBOX, i).unwrap();
        let no = v.tasks[0].no;
        e.store.complete_task(INBOX, no, true).unwrap();
        let v = e.store.complete_task(INBOX, no, false).unwrap();
        assert_eq!(v.tasks[0].progress, 0);
        assert_eq!(v.tasks[0].due, Some(ymd(2026, 10, 13)));
    }

    #[test]
    fn default_reminder_only_when_a_time_is_set_and_none_exist() {
        let mut e = env();
        let mut i = input("時刻なし");
        i.due = Some(ymd(2026, 10, 13));
        let v = e.store.add_task(INBOX, i).unwrap();
        let no = v.tasks[0].no;
        assert!(v.tasks[0].reminders.is_empty());
        let v = e
            .store
            .update_task(
                INBOX,
                no,
                TaskPatch {
                    due_time: Some(Some(hm(10, 0))),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(v.tasks[0].reminders, vec!["-0m".to_string()]);
        // Already has one: untouched when the time changes again.
        let v = e
            .store
            .update_task(
                INBOX,
                no,
                TaskPatch {
                    reminders: Some(vec!["-30m".into()]),
                    ..Default::default()
                },
            )
            .unwrap();
        let v2 = e
            .store
            .update_task(
                INBOX,
                no,
                TaskPatch {
                    due_time: Some(Some(hm(11, 0))),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(v2.tasks[0].reminders, v.tasks[0].reminders);
        // Setting 「なし」 disables it.
        let mut s = e.store.settings();
        s.default_reminder = None;
        e.store.update_settings(s).unwrap();
        let mut i = input("なし設定");
        i.due = Some(ymd(2026, 10, 13));
        i.due_time = Some(hm(10, 0));
        let v = e.store.add_task(INBOX, i).unwrap();
        assert!(v.tasks[1].reminders.is_empty());
    }

    #[test]
    fn a_patch_that_sets_reminders_wins_over_the_default() {
        let mut e = env();
        let mut i = input("a");
        i.due = Some(ymd(2026, 10, 13));
        let v = e.store.add_task(INBOX, i).unwrap();
        let v = e
            .store
            .update_task(
                INBOX,
                v.tasks[0].no,
                TaskPatch {
                    due_time: Some(Some(hm(10, 0))),
                    reminders: Some(vec![]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(v.tasks[0].reminders.is_empty());
    }

    #[test]
    fn recurring_completion_drops_absolute_reminders() {
        let mut e = env();
        let mut i = input("y");
        i.due = Some(ymd(2026, 10, 13));
        i.due_time = Some(hm(8, 0));
        i.rrule = Some("FREQ=DAILY".into());
        i.reminders = vec!["-30m".into(), "2026-10-13T07:00".into()];
        let v = e.store.add_task(INBOX, i).unwrap();
        let v = e.store.complete_task(INBOX, v.tasks[0].no, true).unwrap();
        assert_eq!(v.tasks[0].reminders, vec!["-30m".to_string()]);
    }

    #[test]
    fn update_settings_validates_the_new_keys() {
        let mut e = env();
        let mut s = e.store.settings();
        s.default_reminder = Some("-5m".into());
        assert!(e.store.update_settings(s.clone()).is_err());
        s.default_reminder = Some("2026-10-13T07:00".into());
        assert!(e.store.update_settings(s.clone()).is_err());
        s.default_reminder = Some(" -30m ".into());
        s.notify_time = hm(8, 15);
        s.keep_in_tray = false;
        s.notifications = false;
        let back = e.store.update_settings(s.clone()).unwrap();
        s.default_reminder = Some("-30m".into()); // stored trimmed
        assert_eq!(back, s);
    }

    #[test]
    fn rrule_label_is_not_written_to_the_workbook() {
        let mut e = env();
        let mut i = input("w");
        i.rrule = Some("FREQ=DAILY".into());
        let v = e.store.add_task(INBOX, i).unwrap();
        assert!(v.tasks[0].rrule_label.is_some());
        assert!(e.store.all_tasks()[0].rrule_label.is_some());
        e.store.save(INBOX).unwrap();
        let again = e.reopen();
        let t = again.view(INBOX).unwrap().tasks.remove(0);
        assert_eq!(t.rrule.as_deref(), Some("FREQ=DAILY"));
        assert!(t.rrule_label.is_some()); // recomputed from rrule on view
    }

    // ---- sync helpers (Phase 4) ----

    #[test]
    fn conflict_copies_are_not_adopted() {
        let e = env();
        std::fs::copy(
            e.data().join("受信トレイ.xlsx"),
            e.data().join("受信トレイ (競合 2026-10-16 0930).xlsx"),
        )
        .unwrap();
        let again = e.reopen();
        assert_eq!(again.summaries().len(), 1);
        assert_eq!(file_key("a (競合 2026-10-16 0930).xlsx"), None);
    }

    #[test]
    fn file_key_maps_names_to_store_keys() {
        assert_eq!(file_key("仕事.xlsx").as_deref(), Some("仕事"));
        assert_eq!(file_key(COMMON_FILE).as_deref(), Some(COMMON_KEY));
        for name in [
            "~$a.xlsx",
            ".powertodo-1.tmp",
            "a.txt",
            "sub/a.xlsx",
            "a\\b.xlsx",
        ] {
            assert_eq!(file_key(name), None, "{name}");
        }
    }

    #[test]
    fn write_downloaded_is_recorded_as_our_own_write() {
        let mut e = env();
        e.store.create_project("仕事", DEFAULT_COLOR).unwrap();
        let other = env();
        let bytes = std::fs::read(other.data().join("受信トレイ.xlsx")).unwrap();
        e.store.write_downloaded("仕事.xlsx", &bytes).unwrap();
        assert_eq!(std::fs::read(e.data().join("仕事.xlsx")).unwrap(), bytes);
        assert!(!e.store.changed_on_disk("仕事"));
        // Only the exact file name of a store file is written.
        assert!(e.store.write_downloaded("仕事.XLSX", &bytes).is_err());
        assert!(e.store.write_downloaded("a.txt", &bytes).is_err());
        assert!(e.store.write_downloaded("../x.xlsx", &bytes).is_err());
    }

    #[test]
    fn keep_copy_before_sync_copies_into_archive() {
        let e = env();
        let original = std::fs::read(e.data().join("受信トレイ.xlsx")).unwrap();
        let at = dt("2026-10-16T09:30");
        let first = e
            .store
            .keep_copy_before_sync("受信トレイ.xlsx", at)
            .unwrap();
        let second = e
            .store
            .keep_copy_before_sync("受信トレイ.xlsx", at)
            .unwrap();
        assert_eq!(
            first,
            e.data()
                .join("archive/受信トレイ (同期前 2026-10-16 0930).xlsx")
        );
        assert_eq!(
            second,
            e.data()
                .join("archive/受信トレイ (同期前 2026-10-16 0930-2).xlsx")
        );
        assert_eq!(std::fs::read(&first).unwrap(), original);
        // The file itself stays.
        assert!(e.data().join("受信トレイ.xlsx").exists());
        let common = e.store.keep_copy_before_sync(COMMON_FILE, at).unwrap();
        assert!(common.ends_with("archive/_PowerToDo (同期前 2026-10-16 0930).xlsx"));
    }

    #[test]
    fn archive_synced_moves_listed_and_unlisted_files() {
        let mut e = env();
        e.store.create_project("仕事", DEFAULT_COLOR).unwrap();
        e.store.archive_synced("仕事.xlsx").unwrap();
        assert!(!e.data().join("仕事.xlsx").exists());
        assert!(e.data().join("archive/仕事 (20261014-0930).xlsx").exists());
        assert!(e.store.summaries().iter().all(|p| p.name != "仕事"));
        // A file the store does not list (it appeared after opening) is just moved.
        std::fs::copy(e.data().join("受信トレイ.xlsx"), e.data().join("外.xlsx")).unwrap();
        e.store.archive_synced("外.xlsx").unwrap();
        assert!(!e.data().join("外.xlsx").exists());
        assert!(e.data().join("archive/外 (20261014-0930).xlsx").exists());
        assert!(e.store.archive_synced("受信トレイ.xlsx").is_err());
        assert!(e.store.archive_synced(COMMON_FILE).is_err());
    }
}
