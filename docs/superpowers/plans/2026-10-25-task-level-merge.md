# Task-level merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When both sides of a synced workbook changed, merge them task by task against the content of the last sync, so two devices adding or editing different tasks no longer produce a conflict copy.

**Architecture:** A new `sync/base.rs` keeps, per file, the bytes both sides agreed on at the last sync (`<app data>/sync-base/<name>`), written whenever a sync record is written. A new pure module `sync/merge.rs` merges base / local / remote (`ProjectBook` by No., `CommonBook` by name, name lists as sets) and returns the merged xlsx bytes plus the renumbered task Nos. The engine's `Run::conflict` tries the merge first and falls back to today's conflict copy when it cannot merge.

**Tech Stack:** Rust 2024, Tauri 2.12.3, calamine / rust_xlsxwriter (through the existing `read_project_book` / `write_project_book` / `read_common_book` / `write_common_book`), tokio tests with `MemoryBackend`.

**Spec:** `docs/superpowers/specs/2026-10-25-task-level-merge-design.md` (PR #40)

**Prerequisite:** Start the implementation branch from origin/main after #40 (spec) and #41 (resident sync, which also edits `sync/engine.rs`) are merged. Anchors below are function names and quoted code, not line numbers.

## Global Constraints

- Same field changed on both sides: the newer side wins. Newer = the `keep` side of `Action::Conflict` (local file mtime vs remote modified, seconds; remote on a tie). The merge does not read clocks.
- Delete vs edit: keep the edit.
- Colliding new Nos: the remote No. stays; the local task gets `max(merged Nos, base Nos, high_water) + 1`, then upward. Local-side `親No.` pointing at a moved No. follows it.
- Cannot merge (no base, base hash differs from the record's `local_hash`, any side unreadable, any `invalid_rows` / `invalid_cells` / `unparsed_holidays`): today's conflict copy, unchanged.
- First sync of a file (no record): today's behaviour (conflict copy, remote kept).
- A merge makes no conflict copy and calls no `SyncHost::conflict`. It is reported in `SyncReport.merged`.
- The base lives in the app data dir, never in the data folder, never uploaded.
- Rust: `cargo fmt`, `cargo clippy --all-targets` clean, `cargo test --lib` green. Never build with `-v`/`-vv`. Never print or commit `src-tauri/google-oauth.json` / `google-oauth-ios.plist`.
- Commits: no `Co-Authored-By` or any AI trailer.
- Sample data: たろう, 仕事, 牛乳; no real names or addresses.

## Review Focus

1. A merge whose upload fails (precondition, offline) after the local file was replaced: the next run must merge again from the old base and lose nothing. Test: `merge_upload_refused_merges_again_next_run` (Task 5).
2. A renumbered task that had fired reminders on this PC: its records move to the new No., so the remote task now holding the old No. still notifies. Test: `fired_records_follow_a_renumbered_task` (Task 5) and `renumber_task_moves_records` (Task 5).
3. A task whose カテゴリ was deleted from the section list on the other side: the section comes back, the task is not lost. Test: `category_still_used_comes_back` (Task 2).
4. Two inbox projects after a common-workbook merge: only the newer side's inbox stays. Test: `one_inbox_after_merge` (Task 3).
5. A stale base file (written, then the record changed without it, e.g. an older app version or a crash between writes): never used. Test: `base_with_another_hash_is_not_used` (Task 1).

---

### Task 1: The base store

**Files:**
- Create: `src-tauri/src/sync/base.rs`
- Modify: `src-tauri/src/sync/mod.rs` (add `pub mod base;`)
- Modify: `src-tauri/src/sync/engine.rs` (`Run::record`, `Run::forget`, `reset_records`, step (7) Done)
- Test: in `base.rs` and `engine.rs` tests

**Interfaces:**
- Produces:
  - `pub struct BaseStore { dir: PathBuf }`
  - `BaseStore::new(app_data_dir: &Path) -> BaseStore` (dir = `app_data_dir/sync-base`)
  - `BaseStore::keep(&self, name: &str, data_dir: &Path, hash: &str)`: copies `data_dir/name` when its SHA-256 is `hash`, otherwise removes the base. Never fails (prints to stderr).
  - `BaseStore::get(&self, name: &str, hash: &str) -> Option<Vec<u8>>`: the bytes when their SHA-256 is `hash`.
  - `BaseStore::remove(&self, name: &str)`, `BaseStore::clear(&self)`, `BaseStore::retain(&self, names: &BTreeSet<String>)`
  - `SyncEngine::base(&self) -> BaseStore`

- [ ] **Step 1: Write the failing tests** (`src-tauri/src/sync/base.rs`, with an empty `impl` so it compiles to failures, or write the tests first and let compile errors be the RED)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::sha256_hex;

    fn dirs() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let app = tmp.path().join("app");
        let data = tmp.path().join("data");
        fs::create_dir_all(&data).unwrap();
        (tmp, app, data)
    }

    #[test]
    fn keeps_the_file_with_the_recorded_hash() {
        let (_t, app, data) = dirs();
        fs::write(data.join("仕事.xlsx"), b"one").unwrap();
        let base = BaseStore::new(&app);
        base.keep("仕事.xlsx", &data, &sha256_hex(b"one"));
        assert_eq!(base.get("仕事.xlsx", &sha256_hex(b"one")), Some(b"one".to_vec()));
    }

    #[test]
    fn base_with_another_hash_is_not_used() {
        let (_t, app, data) = dirs();
        fs::write(data.join("仕事.xlsx"), b"one").unwrap();
        let base = BaseStore::new(&app);
        base.keep("仕事.xlsx", &data, &sha256_hex(b"one"));
        assert_eq!(base.get("仕事.xlsx", &sha256_hex(b"two")), None);
    }

    #[test]
    fn a_file_that_moved_on_removes_the_base() {
        let (_t, app, data) = dirs();
        let base = BaseStore::new(&app);
        fs::write(data.join("仕事.xlsx"), b"one").unwrap();
        base.keep("仕事.xlsx", &data, &sha256_hex(b"one"));
        fs::write(data.join("仕事.xlsx"), b"two").unwrap();
        base.keep("仕事.xlsx", &data, &sha256_hex(b"one"));
        assert_eq!(base.get("仕事.xlsx", &sha256_hex(b"one")), None);
    }

    #[test]
    fn retain_and_clear() {
        let (_t, app, data) = dirs();
        let base = BaseStore::new(&app);
        for n in ["a.xlsx", "b.xlsx"] {
            fs::write(data.join(n), n.as_bytes()).unwrap();
            base.keep(n, &data, &sha256_hex(n.as_bytes()));
        }
        base.retain(&BTreeSet::from(["a.xlsx".to_string()]));
        assert!(base.get("a.xlsx", &sha256_hex(b"a.xlsx")).is_some());
        assert!(base.get("b.xlsx", &sha256_hex(b"b.xlsx")).is_none());
        base.clear();
        assert!(base.get("a.xlsx", &sha256_hex(b"a.xlsx")).is_none());
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test --lib sync::base`
Expected: compile errors (`BaseStore` not found) or FAIL.

- [ ] **Step 3: Implement `base.rs`**

```rust
//! The base of a merge (task-level merge spec section 2): per synced file, the content both
//! sides agreed on at the last sync. Kept in the app data dir next to `sync.json`, never in the
//! data folder and never uploaded. A base is only used when its SHA-256 is the record's
//! `local_hash`, so a stale one is harmless.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::store::paths::write_atomic;
use crate::sync::sha256_hex;

#[derive(Debug, Clone)]
pub struct BaseStore {
    dir: PathBuf,
}

impl BaseStore {
    pub const DIR: &'static str = "sync-base";

    pub fn new(app_data_dir: &Path) -> Self {
        BaseStore {
            dir: app_data_dir.join(Self::DIR),
        }
    }

    /// Takes `data_dir/name` as the base when its content is `hash` (what the record says both
    /// sides hold); otherwise drops the base. Failures only lose the base (the next conflict of
    /// this file then makes a conflict copy).
    pub fn keep(&self, name: &str, data_dir: &Path, hash: &str) {
        match fs::read(data_dir.join(name)) {
            Ok(bytes) if sha256_hex(&bytes) == hash => {
                if let Err(e) = fs::create_dir_all(&self.dir)
                    .map_err(crate::error::AppError::from)
                    .and_then(|()| write_atomic(&self.dir.join(name), &bytes))
                {
                    eprintln!("could not keep the sync base of {name}: {e}");
                    self.remove(name);
                }
            }
            _ => self.remove(name),
        }
    }

    pub fn get(&self, name: &str, hash: &str) -> Option<Vec<u8>> {
        let bytes = fs::read(self.dir.join(name)).ok()?;
        (sha256_hex(&bytes) == hash).then_some(bytes)
    }

    pub fn remove(&self, name: &str) {
        match fs::remove_file(self.dir.join(name)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => eprintln!("could not remove the sync base of {name}: {e}"),
        }
    }

    /// Drops the bases of files without a record.
    pub fn retain(&self, names: &BTreeSet<String>) {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return;
        };
        for e in entries.flatten() {
            let Ok(name) = e.file_name().into_string() else {
                continue;
            };
            if !names.contains(&name) {
                self.remove(&name);
            }
        }
    }

    pub fn clear(&self) {
        match fs::remove_dir_all(&self.dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => eprintln!("could not remove {}: {e}", self.dir.display()),
        }
    }
}
```

Check `write_atomic`'s signature in `store/paths.rs` before use (it is what `sync/state.rs` uses to write `sync.json`); adapt the call (`&[u8]` vs `&str`) to it. Add `pub mod base;` to `sync/mod.rs`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src-tauri && cargo test --lib sync::base`
Expected: 4 passed.

- [ ] **Step 5: Engine test: the base follows the record** (`engine.rs` tests, next to `two_pcs_round_trip`)

```rust
    #[tokio::test]
    async fn the_base_follows_the_records() {
        let remote = backend();
        let (a, _b) = two_pcs(&remote).await;
        let base = BaseStore::new(&a.app);
        for (name, rec) in a.records() {
            assert_eq!(
                base.get(&name, &rec.local_hash),
                Some(a.file(&name)),
                "{name}"
            );
        }
        a.engine.reset_records();
        assert!(base.get(INBOX_FILE, &sha256_hex(&a.file(INBOX_FILE))).is_none());
    }
```

Run: `cd src-tauri && cargo test --lib sync::engine::tests::the_base_follows_the_records`
Expected: FAIL (no base written).

- [ ] **Step 6: Wire the engine**

- `SyncEngine`: `pub fn base(&self) -> BaseStore { BaseStore::new(&self.shared.app_data_dir) }`
- `Run::record`: after inserting the `FileRecord`, before `self.done.insert`: `self.engine.base().keep(name, &self.data_dir, &local_hash);` (clone `local_hash` for the record first).
- `Run::forget`: `self.engine.base().remove(name);`
- `reset_records`: after removing `sync.json`: `BaseStore::new(&self.shared.app_data_dir).clear();`
- Step (7) Done, after `save_state` succeeds: `self.base().retain(&state.files.keys().cloned().collect());`

Run: `cd src-tauri && cargo test --lib sync::`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/sync/base.rs src-tauri/src/sync/mod.rs src-tauri/src/sync/engine.rs
git commit -m "feat(sync): keep the content of the last sync as a merge base"
```

---

### Task 2: Merging a project workbook (pure)

**Files:**
- Create: `src-tauri/src/sync/merge.rs`
- Modify: `src-tauri/src/sync/mod.rs` (add `pub mod merge;`)

**Interfaces:**
- Consumes: `Side` (`sync/mod.rs`), `ProjectBook` (`store/project_book.rs`), `Task` (`domain/model.rs`)
- Produces:
  - `pub fn pick<T: PartialEq + Clone>(base: &T, local: &T, remote: &T, newer: Side) -> T`
  - `pub fn merge_names(base: &[String], local: &[String], remote: &[String], newer: Side) -> Vec<String>`
  - `pub struct ProjectMerge { pub book: ProjectBook, pub renumbered: Vec<(u32, u32)> }`
  - `pub fn merge_project(base: &ProjectBook, local: &ProjectBook, remote: &ProjectBook, newer: Side, high_water: u32) -> ProjectMerge`

- [ ] **Step 1: Write the failing tests** (bottom of `merge.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::model::Priority;
    use chrono::NaiveDateTime;

    fn task(no: u32, title: &str) -> Task {
        Task {
            no,
            project: "仕事".into(),
            category: None,
            title: title.into(),
            assignee: String::new(),
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
            order: no,
            created_at: NaiveDateTime::default(),
            completed_at: None,
            extra: Default::default(),
        }
    }

    fn book(tasks: Vec<Task>) -> ProjectBook {
        ProjectBook {
            project: "仕事".into(),
            tasks,
            ..Default::default()
        }
    }

    fn titles(b: &ProjectBook) -> Vec<(u32, String)> {
        b.tasks.iter().map(|t| (t.no, t.title.clone())).collect()
    }

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn pick_takes_the_one_change_or_the_newer() {
        assert_eq!(pick(&1, &1, &2, Side::Local), 2);
        assert_eq!(pick(&1, &3, &1, Side::Remote), 3);
        assert_eq!(pick(&1, &4, &4, Side::Remote), 4);
        assert_eq!(pick(&1, &3, &4, Side::Local), 3);
        assert_eq!(pick(&1, &3, &4, Side::Remote), 4);
    }

    #[test]
    fn names_merge_as_a_set_in_the_newer_order() {
        let b = s(&["A", "B", "C"]);
        // local removed B and added L; remote added R and reordered.
        let got = merge_names(&b, &s(&["A", "C", "L"]), &s(&["C", "A", "B", "R"]), Side::Remote);
        assert_eq!(got, s(&["C", "A", "R", "L"]));
    }

    #[test]
    fn adds_on_both_sides_are_kept() {
        let b = book(vec![task(1, "牛乳")]);
        let l = book(vec![task(1, "牛乳"), task(2, "パン")]);
        let r = book(vec![task(1, "牛乳"), task(3, "卵")]);
        let m = merge_project(&b, &l, &r, Side::Remote, 2);
        assert_eq!(
            titles(&m.book),
            [(1, "牛乳".into()), (2, "パン".into()), (3, "卵".into())]
        );
        assert!(m.renumbered.is_empty());
    }

    #[test]
    fn different_tasks_edited_on_each_side() {
        let b = book(vec![task(1, "牛乳"), task(2, "パン")]);
        let l = book(vec![task(1, "牛乳を2本"), task(2, "パン")]);
        let r = book(vec![task(1, "牛乳"), task(2, "食パン")]);
        let m = merge_project(&b, &l, &r, Side::Remote, 2);
        assert_eq!(titles(&m.book), [(1, "牛乳を2本".into()), (2, "食パン".into())]);
    }

    #[test]
    fn same_field_takes_the_newer_other_fields_both() {
        let b = book(vec![task(1, "牛乳")]);
        let mut lt = task(1, "牛乳 (L)");
        lt.note = Some("スーパーで".into());
        let rt = task(1, "牛乳 (R)");
        let m = merge_project(&b, &book(vec![lt]), &book(vec![rt]), Side::Local, 1);
        assert_eq!(m.book.tasks[0].title, "牛乳 (L)");
        assert_eq!(m.book.tasks[0].note.as_deref(), Some("スーパーで"));
        let m2 = merge_project(&b, &book(vec![task(1, "L")]), &book(vec![task(1, "R")]), Side::Remote, 1);
        assert_eq!(m2.book.tasks[0].title, "R");
    }

    #[test]
    fn progress_and_completed_at_go_together() {
        let b = book(vec![task(1, "牛乳")]);
        let mut lt = task(1, "牛乳");
        lt.progress = 100;
        lt.completed_at = Some(NaiveDateTime::default() + chrono::Duration::hours(1));
        let mut rt = task(1, "牛乳");
        rt.progress = 50;
        let m = merge_project(&b, &book(vec![lt.clone()]), &book(vec![rt]), Side::Local, 1);
        assert_eq!((m.book.tasks[0].progress, m.book.tasks[0].completed_at), (100, lt.completed_at));
    }

    #[test]
    fn delete_vs_edit_keeps_the_edit() {
        let b = book(vec![task(1, "牛乳")]);
        let m = merge_project(&b, &book(vec![]), &book(vec![task(1, "牛乳を2本")]), Side::Local, 1);
        assert_eq!(titles(&m.book), [(1, "牛乳を2本".into())]);
        let m = merge_project(&b, &book(vec![task(1, "牛乳を2本")]), &book(vec![]), Side::Remote, 1);
        assert_eq!(titles(&m.book), [(1, "牛乳を2本".into())]);
    }

    #[test]
    fn delete_of_an_untouched_task_is_followed() {
        let b = book(vec![task(1, "牛乳"), task(2, "パン")]);
        let m = merge_project(&b, &book(vec![task(2, "パン")]), &b, Side::Remote, 2);
        assert_eq!(titles(&m.book), [(2, "パン".into())]);
    }

    #[test]
    fn colliding_new_numbers_move_the_local_task_and_its_children() {
        let b = book(vec![task(1, "牛乳")]);
        let mut child = task(3, "Lの子");
        child.parent_no = Some(2);
        let l = book(vec![task(1, "牛乳"), task(2, "Lの親"), child]);
        let r = book(vec![task(1, "牛乳"), task(2, "R")]);
        let m = merge_project(&b, &l, &r, Side::Remote, 3);
        let by_title = |t: &str| m.book.tasks.iter().find(|x| x.title == t).unwrap().clone();
        assert_eq!(by_title("R").no, 2);
        assert_eq!(by_title("Lの親").no, 4, "max(merged 3, high_water 3) + 1");
        assert_eq!(by_title("Lの子").no, 3);
        assert_eq!(by_title("Lの子").parent_no, Some(4));
        assert_eq!(m.renumbered, [(2, 4)]);
    }

    #[test]
    fn the_same_new_task_on_both_sides_is_one() {
        let b = book(vec![]);
        let l = book(vec![task(1, "牛乳")]);
        let m = merge_project(&b, &l, &l, Side::Remote, 1);
        assert_eq!(titles(&m.book), [(1, "牛乳".into())]);
        assert!(m.renumbered.is_empty());
    }

    #[test]
    fn category_still_used_comes_back() {
        let mut b = book(vec![task(1, "牛乳")]);
        b.sections = s(&["買い物"]);
        let mut l = b.clone();
        l.sections = vec![];
        let mut r = b.clone();
        r.tasks[0].category = Some("買い物".into());
        let m = merge_project(&b, &l, &r, Side::Local, 1);
        assert_eq!(m.book.sections, s(&["買い物"]));
    }

    #[test]
    fn rows_are_in_order_then_no() {
        let b = book(vec![]);
        let mut x = task(1, "x");
        x.order = 5;
        let mut y = task(2, "y");
        y.order = 1;
        let m = merge_project(&b, &book(vec![x]), &book(vec![y]), Side::Remote, 2);
        assert_eq!(titles(&m.book), [(2, "y".into()), (1, "x".into())]);
    }
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test --lib sync::merge`
Expected: compile errors (functions not defined).

- [ ] **Step 3: Implement**

```rust
//! Task-level merge (task-level merge spec section 4): base (the content of the last sync),
//! local and remote are compared and merged. Pure: no files, no clock. `newer` is the side whose
//! file is newer (the `keep` of `Action::Conflict`); it wins a field both sides changed.

use std::collections::{BTreeMap, BTreeSet};

use crate::domain::model::Task;
use crate::store::project_book::ProjectBook;
use crate::sync::Side;

/// The change of one side, or the value both changed to, or the newer side's.
pub fn pick<T: PartialEq + Clone>(base: &T, local: &T, remote: &T, newer: Side) -> T {
    if local == remote || remote == base {
        local.clone()
    } else if local == base {
        remote.clone()
    } else {
        match newer {
            Side::Local => local.clone(),
            Side::Remote => remote.clone(),
        }
    }
}

/// Names (sections, assignees, columns) merged as a set: a name added on one side is added, a
/// name removed on one side is removed. Ordered as the newer side, then the other side's own.
pub fn merge_names(base: &[String], local: &[String], remote: &[String], newer: Side) -> Vec<String> {
    let has = |v: &[String], n: &String| v.contains(n);
    let keep = |n: &String| {
        let (b, l, r) = (has(base, n), has(local, n), has(remote, n));
        (l && r) || (l && !b) || (r && !b)
    };
    let (first, second) = match newer {
        Side::Local => (local, remote),
        Side::Remote => (remote, local),
    };
    let mut out: Vec<String> = Vec::new();
    for n in first.iter().chain(second) {
        if keep(n) && !out.contains(n) {
            out.push(n.clone());
        }
    }
    out
}

/// Unknown-column cells: per key, a missing cell is `None`.
fn merge_extra(
    base: &BTreeMap<String, String>,
    local: &BTreeMap<String, String>,
    remote: &BTreeMap<String, String>,
    newer: Side,
) -> BTreeMap<String, String> {
    let keys: BTreeSet<&String> = base.keys().chain(local.keys()).chain(remote.keys()).collect();
    keys.into_iter()
        .filter_map(|k| {
            pick(&base.get(k), &local.get(k), &remote.get(k), newer).map(|v| (k.clone(), v.clone()))
        })
        .collect()
}

/// One task both sides still have.
fn merge_task(b: &Task, l: &Task, r: &Task, newer: Side) -> Task {
    let (progress, completed_at) = pick(
        &(b.progress, b.completed_at),
        &(l.progress, l.completed_at),
        &(r.progress, r.completed_at),
        newer,
    );
    Task {
        no: l.no,
        project: pick(&b.project, &l.project, &r.project, newer),
        category: pick(&b.category, &l.category, &r.category, newer),
        title: pick(&b.title, &l.title, &r.title, newer),
        assignee: pick(&b.assignee, &l.assignee, &r.assignee, newer),
        priority: pick(&b.priority, &l.priority, &r.priority, newer),
        progress,
        start: pick(&b.start, &l.start, &r.start, newer),
        due: pick(&b.due, &l.due, &r.due, newer),
        due_time: pick(&b.due_time, &l.due_time, &r.due_time, newer),
        days: pick(&b.days, &l.days, &r.days, newer),
        note: pick(&b.note, &l.note, &r.note, newer),
        parent_no: pick(&b.parent_no, &l.parent_no, &r.parent_no, newer),
        labels: pick(&b.labels, &l.labels, &r.labels, newer),
        rrule: pick(&b.rrule, &l.rrule, &r.rrule, newer),
        rrule_label: None,
        reminders: pick(&b.reminders, &l.reminders, &r.reminders, newer),
        order: pick(&b.order, &l.order, &r.order, newer),
        created_at: pick(&b.created_at, &l.created_at, &r.created_at, newer),
        completed_at,
        extra: merge_extra(&b.extra, &l.extra, &r.extra, newer),
    }
}

pub struct ProjectMerge {
    pub book: ProjectBook,
    /// (old No., new No.) of local tasks moved because the remote added a task with that No.
    pub renumbered: Vec<(u32, u32)>,
}

/// The three must have no `invalid_rows` / `invalid_cells` (the caller checks: those rows are
/// never rewritten by the app). `high_water`: the highest No. this PC handed out for the project.
pub fn merge_project(
    base: &ProjectBook,
    local: &ProjectBook,
    remote: &ProjectBook,
    newer: Side,
    high_water: u32,
) -> ProjectMerge {
    let by_no = |b: &ProjectBook| -> BTreeMap<u32, Task> {
        b.tasks.iter().map(|t| (t.no, t.clone())).collect()
    };
    let (bm, lm, rm) = (by_no(base), by_no(local), by_no(remote));
    let nos: BTreeSet<u32> = bm.keys().chain(lm.keys()).chain(rm.keys()).copied().collect();
    let mut tasks: Vec<Task> = Vec::new();
    let mut moved: Vec<Task> = Vec::new();
    for no in nos {
        match (bm.get(&no), lm.get(&no), rm.get(&no)) {
            (None, Some(l), None) => tasks.push(l.clone()),
            (None, None, Some(r)) => tasks.push(r.clone()),
            (None, Some(l), Some(r)) if l == r => tasks.push(l.clone()),
            (None, Some(l), Some(r)) => {
                tasks.push(r.clone());
                moved.push(l.clone());
            }
            (Some(b), None, Some(r)) if r != b => tasks.push(r.clone()),
            (Some(b), Some(l), None) if l != b => tasks.push(l.clone()),
            (Some(b), Some(l), Some(r)) => tasks.push(merge_task(b, l, r, newer)),
            _ => {} // deleted on one side and untouched on the other, or on both
        }
    }
    let mut next = tasks
        .iter()
        .map(|t| t.no)
        .chain(bm.keys().copied())
        .chain(moved.iter().map(|t| t.no))
        .chain(std::iter::once(high_water))
        .max()
        .unwrap_or(0);
    let mut renumbered = Vec::new();
    for mut t in moved {
        next += 1;
        renumbered.push((t.no, next));
        t.no = next;
        tasks.push(t);
    }
    // Local tasks that point at a moved No. meant the local task.
    for (from, to) in &renumbered {
        for t in tasks.iter_mut() {
            let local_points = lm.get(&t.no).or_else(|| {
                renumbered.iter().find(|(_, n)| *n == t.no).and_then(|(o, _)| lm.get(o))
            });
            let remote_points = rm.get(&t.no).is_some_and(|r| r.parent_no == Some(*from))
                && !renumbered.iter().any(|(_, n)| *n == t.no);
            if t.parent_no == Some(*from)
                && local_points.is_some_and(|l| l.parent_no == Some(*from))
                && !remote_points
            {
                t.parent_no = Some(*to);
            }
        }
    }
    tasks.sort_by_key(|t| (t.order, t.no));

    let mut sections = merge_names(&base.sections, &local.sections, &remote.sections, newer);
    for t in &tasks {
        if let Some(c) = &t.category
            && !sections.contains(c)
        {
            sections.push(c.clone());
        }
    }
    ProjectMerge {
        book: ProjectBook {
            project: pick(&base.project, &local.project, &remote.project, newer),
            sections,
            assignees: merge_names(&base.assignees, &local.assignees, &remote.assignees, newer),
            tasks,
            invalid_rows: Vec::new(),
            unknown_columns: merge_names(
                &base.unknown_columns,
                &local.unknown_columns,
                &remote.unknown_columns,
                newer,
            ),
            invalid_cells: BTreeMap::new(),
        },
        renumbered,
    }
}
```

Note on the `next` computation: the moved tasks' own Nos are already counted through the remote task with the same No., so `.chain(moved…)` changes nothing but keeps the intent readable. If clippy flags the nested closure in the parent fix-up, extract it into `fn meant_local(...)`; keep the behaviour of the test.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src-tauri && cargo test --lib sync::merge`
Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sync/merge.rs src-tauri/src/sync/mod.rs
git commit -m "feat(sync): merge a project workbook task by task"
```

---

### Task 3: Merging the common workbook (pure)

**Files:**
- Modify: `src-tauri/src/sync/merge.rs`

**Interfaces:**
- Consumes: `pick`, `merge_names`, `merge_extra` (Task 2); `CommonBook`, `Settings` (`store/common_book.rs`); `Project`, `Label` (`domain/model.rs`)
- Produces: `pub fn merge_common(base: &CommonBook, local: &CommonBook, remote: &CommonBook, newer: Side) -> CommonBook` (callers check `unparsed_holidays` is empty on all three)

- [ ] **Step 1: Write the failing tests** (add to `merge.rs` tests)

```rust
    use crate::domain::model::{Label, Project};
    use crate::store::common_book::CommonBook;

    fn project(name: &str, inbox: bool) -> Project {
        Project {
            name: name.into(),
            color: "var(--color-text-muted)".into(),
            order: 0,
            favorite: false,
            inbox,
        }
    }

    fn common(projects: Vec<Project>) -> CommonBook {
        CommonBook {
            projects,
            ..CommonBook::new_default()
        }
    }

    fn names_of(c: &CommonBook) -> Vec<String> {
        c.projects.iter().map(|p| p.name.clone()).collect()
    }

    #[test]
    fn projects_added_on_both_sides_are_kept() {
        let b = common(vec![project("受信トレイ", true)]);
        let l = common(vec![project("受信トレイ", true), project("仕事", false)]);
        let r = common(vec![project("受信トレイ", true), project("家", false)]);
        let m = merge_common(&b, &l, &r, Side::Remote);
        assert_eq!(names_of(&m), s(&["受信トレイ", "家", "仕事"]));
    }

    #[test]
    fn project_fields_merge_one_by_one() {
        let b = common(vec![project("仕事", false)]);
        let mut lp = project("仕事", false);
        lp.favorite = true;
        let mut rp = project("仕事", false);
        rp.color = "red".into();
        let m = merge_common(&b, &common(vec![lp]), &common(vec![rp]), Side::Local);
        assert!(m.projects[0].favorite);
        assert_eq!(m.projects[0].color, "red");
    }

    #[test]
    fn one_inbox_after_merge() {
        let b = common(vec![project("受信トレイ", true), project("仕事", false)]);
        let l = common(vec![project("受信トレイ", false), project("仕事", true)]);
        let r = common(vec![project("受信トレイ", false), project("仕事", false), project("家", true)]);
        let m = merge_common(&b, &l, &r, Side::Remote);
        let inboxes: Vec<&str> =
            m.projects.iter().filter(|p| p.inbox).map(|p| p.name.as_str()).collect();
        assert_eq!(inboxes, ["家"], "the newer side's inbox");
    }

    #[test]
    fn labels_holidays_and_settings() {
        let mut b = CommonBook::new_default();
        b.labels = vec![Label { name: "急ぎ".into(), color: "red".into(), order: 0 }];
        let mut l = b.clone();
        l.labels.push(Label { name: "家".into(), color: "blue".into(), order: 1 });
        l.holidays = vec![chrono::NaiveDate::from_ymd_opt(2026, 11, 3).unwrap()];
        l.settings.display_name = "たろう".into();
        let mut r = b.clone();
        r.settings.keep_in_tray = !b.settings.keep_in_tray;
        let m = merge_common(&b, &l, &r, Side::Remote);
        let labels: Vec<&str> = m.labels.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(labels, ["急ぎ", "家"]);
        assert_eq!(m.holidays, l.holidays);
        assert_eq!(m.settings.display_name, "たろう");
        assert_eq!(m.settings.keep_in_tray, r.settings.keep_in_tray);
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test --lib sync::merge`
Expected: compile error (`merge_common` not defined).

- [ ] **Step 3: Implement**

```rust
use crate::domain::model::{Label, Project};
use crate::store::common_book::{CommonBook, Settings};

/// Rows keyed by name (projects, labels): the table of spec 4.1, `merge_row` for rows both
/// sides kept. Ordered as `merge_names` orders the names.
fn merge_rows<T: PartialEq + Clone>(
    base: &[T],
    local: &[T],
    remote: &[T],
    newer: Side,
    name: impl Fn(&T) -> &str,
    merge_row: impl Fn(&T, &T, &T) -> T,
) -> Vec<T> {
    let find = |v: &[T], n: &str| v.iter().find(|x| name(x) == n).cloned();
    let names = |v: &[T]| v.iter().map(|x| name(x).to_string()).collect::<Vec<_>>();
    let mut all = merge_names(&names(base), &names(local), &names(remote), newer);
    // A row deleted on one side but edited on the other comes back (edit wins).
    for v in [local, remote] {
        for x in v {
            let n = name(x);
            if !all.iter().any(|a| a == n)
                && find(base, n).is_some_and(|b| b != *x)
            {
                all.push(n.to_string());
            }
        }
    }
    all.into_iter()
        .filter_map(|n| match (find(base, &n), find(local, &n), find(remote, &n)) {
            (Some(b), Some(l), Some(r)) => Some(merge_row(&b, &l, &r)),
            (_, Some(l), None) => Some(l),
            (_, None, Some(r)) => Some(r),
            (None, Some(l), Some(r)) => Some(match newer {
                Side::Local => l,
                Side::Remote => r,
            }),
            _ => None,
        })
        .collect()
}

fn merge_settings(b: &Settings, l: &Settings, r: &Settings, newer: Side) -> Settings {
    Settings {
        display_name: pick(&b.display_name, &l.display_name, &r.display_name, newer),
        week_start: pick(&b.week_start, &l.week_start, &r.week_start, newer),
        timezone: pick(&b.timezone, &l.timezone, &r.timezone, newer),
        default_reminder: pick(&b.default_reminder, &l.default_reminder, &r.default_reminder, newer),
        notify_time: pick(&b.notify_time, &l.notify_time, &r.notify_time, newer),
        keep_in_tray: pick(&b.keep_in_tray, &l.keep_in_tray, &r.keep_in_tray, newer),
        notifications: pick(&b.notifications, &l.notifications, &r.notifications, newer),
    }
}

/// Keyed pairs (extra settings, per-name extra cells): per key, a missing pair is `None`.
fn merge_pairs(
    base: &[(String, String)],
    local: &[(String, String)],
    remote: &[(String, String)],
    newer: Side,
) -> Vec<(String, String)> {
    let map = |v: &[(String, String)]| v.iter().cloned().collect::<BTreeMap<_, _>>();
    let keys = merge_names(
        &base.iter().map(|p| p.0.clone()).collect::<Vec<_>>(),
        &local.iter().map(|p| p.0.clone()).collect::<Vec<_>>(),
        &remote.iter().map(|p| p.0.clone()).collect::<Vec<_>>(),
        newer,
    );
    let merged = merge_extra(&map(base), &map(local), &map(remote), newer);
    keys.into_iter()
        .filter_map(|k| merged.get(&k).map(|v| (k.clone(), v.clone())))
        .collect()
}

fn merge_extra_by_name(
    base: &BTreeMap<String, BTreeMap<String, String>>,
    local: &BTreeMap<String, BTreeMap<String, String>>,
    remote: &BTreeMap<String, BTreeMap<String, String>>,
    newer: Side,
) -> BTreeMap<String, BTreeMap<String, String>> {
    let empty = BTreeMap::new();
    let names: BTreeSet<&String> = base.keys().chain(local.keys()).chain(remote.keys()).collect();
    names
        .into_iter()
        .map(|n| {
            let get = |m: &BTreeMap<String, BTreeMap<String, String>>| m.get(n).unwrap_or(&empty).clone();
            (n.clone(), merge_extra(&get(base), &get(local), &get(remote), newer))
        })
        .filter(|(_, v)| !v.is_empty())
        .collect()
}

pub fn merge_common(base: &CommonBook, local: &CommonBook, remote: &CommonBook, newer: Side) -> CommonBook {
    let mut projects = merge_rows(
        &base.projects,
        &local.projects,
        &remote.projects,
        newer,
        |p: &Project| p.name.as_str(),
        |b, l, r| Project {
            name: l.name.clone(),
            color: pick(&b.color, &l.color, &r.color, newer),
            order: pick(&b.order, &l.order, &r.order, newer),
            favorite: pick(&b.favorite, &l.favorite, &r.favorite, newer),
            inbox: pick(&b.inbox, &l.inbox, &r.inbox, newer),
        },
    );
    if projects.iter().filter(|p| p.inbox).count() > 1 {
        let newer_book = match newer {
            Side::Local => local,
            Side::Remote => remote,
        };
        let keep = newer_book
            .projects
            .iter()
            .find(|p| p.inbox)
            .map(|p| p.name.clone());
        for p in projects.iter_mut() {
            p.inbox = Some(&p.name) == keep.as_ref();
        }
    }
    let labels = merge_rows(
        &base.labels,
        &local.labels,
        &remote.labels,
        newer,
        |x: &Label| x.name.as_str(),
        |b, l, r| Label {
            name: l.name.clone(),
            color: pick(&b.color, &l.color, &r.color, newer),
            order: pick(&b.order, &l.order, &r.order, newer),
        },
    );
    let day = |v: &[chrono::NaiveDate]| v.iter().map(|d| d.to_string()).collect::<Vec<_>>();
    let mut holidays: Vec<chrono::NaiveDate> =
        merge_names(&day(&base.holidays), &day(&local.holidays), &day(&remote.holidays), newer)
            .iter()
            .filter_map(|d| d.parse().ok())
            .collect();
    holidays.sort();
    holidays.dedup();
    let holiday_names = {
        let to = |m: &BTreeMap<chrono::NaiveDate, String>| {
            m.iter().map(|(d, n)| (d.to_string(), n.clone())).collect::<BTreeMap<_, _>>()
        };
        merge_extra(&to(&base.holiday_names), &to(&local.holiday_names), &to(&remote.holiday_names), newer)
            .into_iter()
            .filter_map(|(d, n)| d.parse().ok().map(|d| (d, n)))
            .filter(|(d, _)| holidays.contains(d))
            .collect()
    };
    CommonBook {
        projects,
        labels,
        holidays,
        holiday_names,
        unparsed_holidays: Vec::new(),
        settings: merge_settings(&base.settings, &local.settings, &remote.settings, newer),
        extra_settings: merge_pairs(&base.extra_settings, &local.extra_settings, &remote.extra_settings, newer),
        project_columns: merge_names(&base.project_columns, &local.project_columns, &remote.project_columns, newer),
        project_extra: merge_extra_by_name(&base.project_extra, &local.project_extra, &remote.project_extra, newer),
        label_columns: merge_names(&base.label_columns, &local.label_columns, &remote.label_columns, newer),
        label_extra: merge_extra_by_name(&base.label_extra, &local.label_extra, &remote.label_extra, newer),
    }
}
```

If `CommonBook` has fields beyond those listed in this plan when the branch starts (check `store/common_book.rs`), the struct literal fails to compile: merge each new field with `pick` (scalar) or `merge_names` (list) and add a case to `labels_holidays_and_settings`. Same for new `Settings` fields in `merge_settings`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd src-tauri && cargo test --lib sync::merge`
Expected: 16 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sync/merge.rs
git commit -m "feat(sync): merge the common workbook by name"
```

---

### Task 4: Merging xlsx bytes

**Files:**
- Modify: `src-tauri/src/sync/merge.rs`

**Interfaces:**
- Consumes: `merge_project`, `merge_common`; `read_project_book`, `write_project_book`, `read_common_book`, `write_common_book`, `COMMON_FILE`
- Produces:
  - `pub struct Merged { pub bytes: Vec<u8>, pub renumbered: Vec<(u32, u32)> }`
  - `pub fn merge_files(name: &str, base: &[u8], local: &[u8], remote: &[u8], newer: Side, high_water: u32, holidays: &[NaiveDate], today: NaiveDate) -> Result<Merged, String>` (`Err` = why it cannot merge, for stderr)

- [ ] **Step 1: Write the failing tests**

```rust
    use crate::store::project_book::{read_project_book, write_project_book};

    fn xlsx(b: &ProjectBook) -> Vec<u8> {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("仕事.xlsx");
        write_project_book(&p, b, chrono::NaiveDate::default(), &[]).unwrap();
        std::fs::read(&p).unwrap()
    }

    fn read(bytes: &[u8]) -> ProjectBook {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("仕事.xlsx");
        std::fs::write(&p, bytes).unwrap();
        read_project_book(&p).unwrap()
    }

    #[test]
    fn merges_project_files() {
        let b = book(vec![task(1, "牛乳")]);
        let l = book(vec![task(1, "牛乳"), task(2, "パン")]);
        let r = book(vec![task(1, "牛乳"), task(3, "卵")]);
        let m = merge_files("仕事.xlsx", &xlsx(&b), &xlsx(&l), &xlsx(&r), Side::Remote, 2, &[], chrono::NaiveDate::default()).unwrap();
        let got: Vec<String> = read(&m.bytes).tasks.into_iter().map(|t| t.title).collect();
        assert_eq!(got, ["牛乳", "パン", "卵"]);
    }

    #[test]
    fn unreadable_or_invalid_rows_do_not_merge() {
        let b = xlsx(&book(vec![task(1, "牛乳")]));
        assert!(merge_files("仕事.xlsx", &b, b"not xlsx", &b, Side::Remote, 1, &[], chrono::NaiveDate::default()).is_err());
        let mut bad = book(vec![task(1, "牛乳")]);
        bad.invalid_rows.push(crate::domain::model::InvalidRow {
            row: 3,
            no: None,
            column: "開始".into(),
            value: "あした".into(),
            message: "日付ではありません".into(),
        });
        // Written invalid rows are kept verbatim through `invalid_cells`; build the bytes with a
        // text in a date cell instead if `write_project_book` does not round-trip `invalid_rows`.
        let bad = xlsx(&bad);
        if !read(&bad).invalid_rows.is_empty() {
            assert!(merge_files("仕事.xlsx", &b, &bad, &b, Side::Remote, 1, &[], chrono::NaiveDate::default()).is_err());
        }
    }

    #[test]
    fn merges_the_common_file() {
        let tmp = tempfile::tempdir().unwrap();
        let bytes = |c: &CommonBook| {
            let p = tmp.path().join("_PowerToDo.xlsx");
            crate::store::common_book::write_common_book(&p, c).unwrap();
            std::fs::read(&p).unwrap()
        };
        let b = common(vec![project("受信トレイ", true)]);
        let l = common(vec![project("受信トレイ", true), project("仕事", false)]);
        let r = common(vec![project("受信トレイ", true), project("家", false)]);
        let m = merge_files("_PowerToDo.xlsx", &bytes(&b), &bytes(&l), &bytes(&r), Side::Remote, 0, &[], chrono::NaiveDate::default()).unwrap();
        let p = tmp.path().join("out.xlsx");
        std::fs::write(&p, &m.bytes).unwrap();
        let got = crate::store::common_book::read_common_book(&p).unwrap();
        assert_eq!(names_of(&got).len(), 3);
    }
```

The invalid-row case must really exercise the check: before writing the step, read how `project_book.rs` tests build a row with a broken cell (search `invalid_rows` in its tests) and build the bytes that way, so the `if` above is removed and the assertion always runs.

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test --lib sync::merge`
Expected: compile error (`merge_files` not defined).

- [ ] **Step 3: Implement**

```rust
use std::path::Path;

use chrono::NaiveDate;

use crate::store::common_book::{COMMON_FILE, read_common_book, write_common_book};
use crate::store::project_book::{read_project_book, write_project_book};

pub struct Merged {
    pub bytes: Vec<u8>,
    pub renumbered: Vec<(u32, u32)>,
}

/// Merges the three contents of `name`. `Err` when one cannot be read or holds rows the app
/// never rewrites (spec section 5); the caller then makes a conflict copy.
#[allow(clippy::too_many_arguments)]
pub fn merge_files(
    name: &str,
    base: &[u8],
    local: &[u8],
    remote: &[u8],
    newer: Side,
    high_water: u32,
    holidays: &[NaiveDate],
    today: NaiveDate,
) -> Result<Merged, String> {
    let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let put = |tag: &str, bytes: &[u8]| -> Result<std::path::PathBuf, String> {
        let p = tmp.path().join(format!("{tag}.xlsx"));
        std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
        Ok(p)
    };
    let paths = [put("base", base)?, put("local", local)?, put("remote", remote)?];
    let out = tmp.path().join("merged.xlsx");
    let renumbered = if name == COMMON_FILE {
        let [b, l, r] = read3(&paths, |p: &Path| read_common_book(p).map_err(|e| e.to_string()))?;
        if [&b, &l, &r].iter().any(|c| !c.unparsed_holidays.is_empty()) {
            return Err("祝日に日付でない行がある".into());
        }
        write_common_book(&out, &merge_common(&b, &l, &r, newer)).map_err(|e| e.to_string())?;
        Vec::new()
    } else {
        let [b, l, r] = read3(&paths, |p: &Path| read_project_book(p).map_err(|e| e.to_string()))?;
        if [&b, &l, &r]
            .iter()
            .any(|x| !x.invalid_rows.is_empty() || !x.invalid_cells.is_empty())
        {
            return Err("要修正の行がある".into());
        }
        let m = merge_project(&b, &l, &r, newer, high_water);
        write_project_book(&out, &m.book, today, holidays).map_err(|e| e.to_string())?;
        m.renumbered
    };
    let bytes = std::fs::read(&out).map_err(|e| e.to_string())?;
    Ok(Merged { bytes, renumbered })
}

fn read3<T>(
    paths: &[std::path::PathBuf; 3],
    read: impl Fn(&Path) -> Result<T, String>,
) -> Result<[T; 3], String> {
    Ok([read(&paths[0])?, read(&paths[1])?, read(&paths[2])?])
}
```

Check the exact export path of `COMMON_FILE` (`sync/mod.rs` imports it from `crate::store::common_book::COMMON_FILE`) and whether `write_project_book` needs `today` (it is `_today`, unused; pass it anyway).

- [ ] **Step 4: Run to verify they pass**

Run: `cd src-tauri && cargo test --lib sync::merge`
Expected: 19 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sync/merge.rs
git commit -m "feat(sync): merge xlsx contents, refuse unreadable or invalid rows"
```

---

### Task 5: The engine merges instead of copying

**Files:**
- Modify: `src-tauri/src/sync/engine.rs` (`SyncReport`, `SyncHost`, `Run::conflict`, tests `Host`/`Event`/`idle`, `two_pcs_conflict`, `conflict_with_the_newer_local_side_keeps_local`)
- Modify: `src-tauri/src/store/project_store.rs` (`high_water`, `holidays` accessors)
- Modify: `src-tauri/src/store/fired.rs` (`renumber_task`)
- Modify: `src-tauri/src/commands/mod.rs` (`TauriSyncHost::tasks_renumbered`)

**Interfaces:**
- Consumes: `BaseStore` (Task 1), `merge_files`, `Merged` (Task 4)
- Produces:
  - `SyncReport.merged: Vec<String>`
  - `SyncHost::tasks_renumbered(&self, project: &str, moves: &[(u32, u32)])` (default: nothing)
  - `ProjectStore::high_water(&self, name: &str) -> u32`, `ProjectStore::holidays(&self) -> Vec<NaiveDate>`
  - `Fired::renumber_task(&mut self, project: &str, from: u32, to: u32)`

- [ ] **Step 1: Write the failing tests**

`fired.rs` tests:

```rust
    #[test]
    fn renumber_task_moves_records() {
        let mut f = Fired::default();
        let at = NaiveDateTime::default();
        f.mark(&ReminderKey { project: "仕事".into(), no: 2, code: "-0m".into() }, at);
        f.renumber_task("仕事", 2, 4);
        assert!(!f.contains(&ReminderKey { project: "仕事".into(), no: 2, code: "-0m".into() }, at));
        assert!(f.contains(&ReminderKey { project: "仕事".into(), no: 4, code: "-0m".into() }, at));
    }
```

`engine.rs` tests: replace `two_pcs_conflict` and `conflict_with_the_newer_local_side_keeps_local` (they now merge) with the tests below, and add fallback tests that remove the base. Add `Event::Renumbered(String, Vec<(u32, u32)>)` and implement `tasks_renumbered` on the test `Host` to push it; add `&& r.merged.is_empty()` to `idle`.

```rust
    #[tokio::test]
    async fn two_pcs_adding_to_the_inbox_merge() {
        let remote = backend_at("2100-01-01T00:00:00");
        let (a, b) = two_pcs(&remote).await;
        a.add(INBOX, "Aの変更");
        b.add(INBOX, "Bの変更");
        assert_eq!(a.sync().await.uploaded, [INBOX_FILE]);
        let r = b.sync().await;
        assert_eq!(r.merged, [INBOX_FILE]);
        assert!(r.conflicts.is_empty());
        assert!(!b.events().iter().any(|e| matches!(e, Event::Conflict(..))));
        assert_eq!(sorted(b.titles(INBOX)), sorted(names(&["牛乳を買う", "Aの変更", "Bの変更"])));
        assert_eq!(b.file(INBOX_FILE), remote.get(INBOX_FILE).unwrap());
        // Both added No. 2: A's (remote) keeps it, B's moved.
        let moved = b.events().into_iter().find_map(|e| match e {
            Event::Renumbered(p, m) => Some((p, m)),
            _ => None,
        });
        assert_eq!(moved, Some((INBOX.to_string(), vec![(2, 3)])));
        assert_eq!(a.sync().await.downloaded, [INBOX_FILE]);
        assert_eq!(sorted(a.titles(INBOX)), sorted(names(&["牛乳を買う", "Aの変更", "Bの変更"])));
        assert!(idle(&b.sync().await));
        assert!(futures_names(&remote).iter().all(|n| !n.contains("競合")));
    }

    #[tokio::test]
    async fn two_pcs_editing_different_tasks_merge() {
        let remote = backend();
        let (a, b) = two_pcs(&remote).await;
        a.add(INBOX, "パン");
        a.sync().await;
        b.sync().await;
        a.with(|s| {
            s.update_task(INBOX, 1, edit_title("牛乳を2本")).unwrap();
            s.save(INBOX).unwrap();
        });
        b.with(|s| {
            s.update_task(INBOX, 2, edit_title("食パン")).unwrap();
            s.save(INBOX).unwrap();
        });
        a.sync().await;
        assert_eq!(b.sync().await.merged, [INBOX_FILE]);
        assert_eq!(b.titles(INBOX), ["牛乳を2本", "食パン"]);
    }

    #[tokio::test]
    async fn without_a_base_a_conflict_copy_is_made() {
        let remote = backend_at("2100-01-01T00:00:00");
        let (a, b) = two_pcs(&remote).await;
        a.add(INBOX, "Aの変更");
        b.add(INBOX, "Bの変更");
        a.sync().await;
        b.engine.base().remove(INBOX_FILE);
        let r = b.sync().await;
        assert!(r.merged.is_empty());
        assert_eq!(r.conflicts.len(), 1);
        assert_eq!(b.titles(INBOX), ["牛乳を買う", "Aの変更"]);
    }

    #[tokio::test]
    async fn merge_upload_refused_merges_again_next_run() {
        let remote = backend_at("2100-01-01T00:00:00");
        let (a, b) = two_pcs(&remote).await;
        a.add(INBOX, "Aの変更");
        b.add(INBOX, "Bの変更");
        a.sync().await;
        remote.fail_upload_once(Failure::Precondition);
        let r = b.sync().await;
        assert!(r.merged.is_empty(), "{r:?}");
        let r = b.sync().await;
        assert_eq!(r.merged, [INBOX_FILE], "{r:?}");
        assert_eq!(sorted(b.titles(INBOX)), sorted(names(&["牛乳を買う", "Aの変更", "Bの変更"])));
    }
```

Helpers to check or add before writing these:
- `edit_title(title) -> <the update input type of ProjectStore::update_task>`: read `update_task`'s signature in `project_store.rs` and build the smallest input that only changes the title.
- `futures_names(&remote)`: already used by existing tests (#41's `two_pcs` tests); reuse it.
- `remote.fail_upload_once(Failure::Precondition)`: read `MemoryBackend` in `sync/backend.rs`. If only `fail_list` exists, add `fail_upload_once` in the same style (a one-shot failure for the next `upload`) and a `Failure::Precondition` variant mapping to `BackendError::Precondition` if missing.

A test of fired records through the real host is not possible in `engine.rs` (the test `Host` has no `Fired`). Cover the host side in `commands/mod.rs` tests if that file already tests `TauriSyncHost` methods; otherwise `renumber_task_moves_records` plus the `Event::Renumbered` assertion together cover the chain (name the gap in the PR body). The Review Focus test `fired_records_follow_a_renumbered_task` is that pair.

- [ ] **Step 2: Run to verify they fail**

Run: `cd src-tauri && cargo test --lib sync::engine store::fired`
Expected: compile errors (`merged`, `renumber_task`, `Event::Renumbered` missing), then FAILs.

- [ ] **Step 3: Implement**

`fired.rs`:

```rust
    /// Moves the records of a task that got a new No. in a sync merge (its old No. now belongs
    /// to another device's task, whose reminders must still fire).
    pub fn renumber_task(&mut self, project: &str, from: u32, to: u32) {
        self.forget_task(project, to);
        for e in self.entries.iter_mut().filter(|e| e.project == project && e.no == from) {
            e.no = to;
        }
        for i in self.pending.iter_mut().filter(|i| i.project == project && i.no == from) {
            i.no = to;
        }
    }
```

`project_store.rs`:

```rust
    /// The highest No. this session handed out for `name` (never reused).
    pub fn high_water(&self, name: &str) -> u32 {
        self.high_water.get(name).copied().unwrap_or(0)
    }

    pub fn holidays(&self) -> Vec<NaiveDate> {
        self.common.holidays.clone()
    }
```

`engine.rs`:
- `SyncReport`: `pub merged: Vec<String>,` (doc: "Both sides changed and were merged task by task (no conflict copy).")
- `SyncHost`: `fn tasks_renumbered(&self, _project: &str, _moves: &[(u32, u32)]) {}` with doc "A sync merge gave local tasks new Nos (fired reminders follow them)."
- `Run::conflict`, right after the `if remote_hash == planned { … }` block and before `let first_sync`:

```rust
        if let Some(merged) = self.try_merge(name, &key, &planned, &local_bytes, &remote_bytes, keep) {
            let staged = stage(&self.data_dir, name, &merged.bytes)?;
            self.write_local(name, staged, Some(&planned), false)?;
            if !merged.renumbered.is_empty() && name != COMMON_FILE {
                self.host.tasks_renumbered(&key, &merged.renumbered);
            }
            let hash = sha256_hex(&merged.bytes);
            let uploaded = self.backend.upload(name, Some(&remote), merged.bytes).await?;
            self.record(name, &uploaded, hash)?;
            self.report.merged.push(name.to_string());
            return Ok(());
        }
```

- new `Run::try_merge`:

```rust
    /// Spec section 3: a merge needs this file's record, a base with the record's hash, and
    /// three readable contents. `None` falls back to the conflict copy.
    fn try_merge(
        &self,
        name: &str,
        key: &str,
        planned: &str,
        local: &[u8],
        remote: &[u8],
        newer: Side,
    ) -> Option<Merged> {
        let record = self.records.get(name)?;
        let base = self.engine.base().get(name, &record.local_hash)?;
        let (high_water, holidays) = {
            let guard = self.host.lock_store();
            let store = guard.as_ref()?;
            if store.load_failed(key) {
                return None;
            }
            (store.high_water(key), store.holidays())
        };
        let _ = planned;
        match merge_files(name, &base, local, remote, newer, high_water, &holidays, self.engine.now().date()) {
            Ok(m) => Some(m),
            Err(why) => {
                eprintln!("{name}: not merged, making a conflict copy: {why}");
                None
            }
        }
    }
```

Drop the unused `planned` parameter if it stays unused (it is listed so the reviewer sees the merge path keeps the `planned` check of `conflict`, which runs before `try_merge`). Check what `key_of(name)` returns for `_PowerToDo.xlsx` and pass the matching key to `load_failed` / `high_water` (for the common file `high_water` is unused).

- `write_local` already reloads the project and calls `projects_reloaded` / `project_list_changed`.
- If the upload fails (`?`), the local file is merged but the record is the old one: the next run sees both sides changed again and merges from the same base (Review Focus 1).

`commands/mod.rs`, in `impl SyncHost for TauriSyncHost`:

```rust
    fn tasks_renumbered(&self, project: &str, moves: &[(u32, u32)]) {
        let state = self.app.state::<AppState>();
        state.update_fired(|f| {
            for (from, to) in moves {
                f.renumber_task(project, *from, *to);
            }
        });
    }
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd src-tauri && cargo test --lib`
Expected: all pass. Existing tests that asserted a conflict copy for two PCs that both changed a file after a first sync now merge: rewrite each to the merge outcome, or remove the base first (as in `without_a_base_a_conflict_copy_is_made`) when the test is about the conflict copy itself. List every test changed this way in the ledger.

Run: `cd src-tauri && cargo clippy --all-targets && cargo fmt --check`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src
git commit -m "feat(sync): merge both-side changes task by task instead of a conflict copy"
```

---

### Task 6: Docs

**Files:**
- Modify: `README.md` (sync section: what happens when both sides changed)
- Modify: `docs/superpowers/specs/2026-10-25-task-level-merge-design.md` §7 (rows for rulings made during the implementation)

- [ ] **Step 1: README**

In the sync section, where conflicts are described, replace the sentence about conflict copies with:

```
- 両方で変えたとき: 前回の同期のときの中身と比べて、タスクごとに合わせる。別々のタスクの追加や編集は両方とも残る。同じタスクの同じ項目を両方で変えたときは、ファイルが新しい方の値になる。両方で同じ番号のタスクを足したときは、この端末で足した方に新しい番号を振る
- 合わせられないとき (更新して最初の同期、ファイルが読めない、「要修正」の行がある): これまでどおり新しい方を残し、もう片方を「(競合 日付 時刻)」の付いたコピーにする
```

Read the README's sync section first and keep its wording style; adapt the bullets to the surrounding list.

- [ ] **Step 2: Commit**

```bash
git add README.md docs/superpowers/specs/2026-10-25-task-level-merge-design.md
git commit -m "docs: task-level merge"
```

- [ ] **Step 3: Manual checklist for the PR body**

- Mac and Windows add different tasks to the same inbox, both sync: no conflict copy, both tasks on both
- iPhone and PC: same
- Same task renamed on both: the newer one stays
- After updating the app, the first conflict still makes a conflict copy (no base yet), the second merges
