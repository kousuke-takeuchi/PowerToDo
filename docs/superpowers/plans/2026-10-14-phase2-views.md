# Phase 2 (ビュー・検索・キーボード・外部変更の監視・CI) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 のアプリに、プロジェクト横断のビュー (今日 / 近日 / ラベル)、検索、キーボード操作、Excel 側の変更の自動取り込み、GitHub Actions の CI を足す。

**Architecture:** 横断ビューと検索の抽出は Rust の `domain` (純関数) に置き、`ProjectStore::all_tasks()` の結果を渡して command が返す。UI は結果を表示し、操作は Phase 1 の command をそのまま使って `project-changed` イベントで再取得する。外部変更は `notify` で監視し、書き込み直後の `(len, mtime)` の記録と比べて自分の書き込みを除く。

**Tech Stack:** Rust 2024 (Tauri 2, chrono, serde, notify 8.2, unicode-normalization 0.1), React 19 + TypeScript, motion 14.2, Storybook 10, GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-10-14-phase2-views-design.md` (以下「仕様」)。全体設計 `2026-10-13-powertodo-overall-design.md`、Phase 1 仕様 `2026-10-14-phase1-core-design.md` も参照。

## Global Constraints

- ブランチ `feature/phase2-views` を `feature/ui-animations` (PR #17) から `--no-track` で切る。worktree は `.worktrees/phase2`。push は `git push origin feature/phase2-views:refs/heads/feature/phase2-views`。PR の base は `main`、本文に「#17 を先にマージ」と書く
- コミットメッセージに `Co-Authored-By` などの AI 帰属を付けない
- `domain` は I/O なし。`store` はファイル全体の読み書き。`commands` はロジックを持たない (Phase 1 仕様 §2)
- 新しい依存は `notify = "8.2"` と `unicode-normalization = "0.1"` だけ (`notify-debouncer-full` は入れない)。npm の依存は増やさない
- 色は CSS 変数 (`var(--color-…)`) だけ。`src/components` はデータの state を持たない
- 既存の Storybook 40 画面は初回描画の DOM を変えない。`npm run check:stories` が通る (追加 Story は「extra」で良い)
- すべてのアニメーションは `useMotionTiming()` (`src/motion.tsx`) を通し、`prefers-reduced-motion` で止まる
- 文言は日本語。サンプルに実在の名前やメールを使わない (`たろう`、`user@example.com`)
- 各タスクの終わりに `cargo test --manifest-path src-tauri/Cargo.toml` (Rust を触ったとき) と `npx tsc --noEmit` (TS を触ったとき) を通す。Task 13 で全部まとめて確認する

## Review Focus

仕様が明示していないが、使う人に当たりやすいもの。各行のテストは所有タスクに入れてある。

1. 空白だけの検索語: 結果は空で、全件は返さない (Task 2 `search_ignores_blank_query`)
2. 読み込めていないプロジェクトがあるときの一括操作 (`reschedule_overdue`、`rename_label`): 他のプロジェクトは書き換わり、エラーにならない (Task 3 `reschedule_skips_failed_projects`)
3. Excel のロックファイル `~$受信トレイ.xlsx` と自分の一時ファイルのイベントは無視する (Task 9 `classify_ignores_lock_and_temp_files`)
4. ラベルの改名先が既存の名前と同じ (大文字小文字だけ違う場合も含む) なら `invalid` (Task 3 `rename_label_rejects_existing_name`)
5. 近日の `days` が 0 や 92 のとき、`invalid` を返して落ちない (Task 4 `upcoming_view_rejects_out_of_range_days`)

---

### Task 0: ブランチと worktree

**Files:** なし (git だけ)

- [ ] **Step 1: worktree を作る**

```bash
cd /Users/ktakeuchi/Documents/PowerToDo
git fetch origin
git worktree add --no-track -b feature/phase2-views .worktrees/phase2 feature/ui-animations
cd .worktrees/phase2 && npm ci && cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: `git log --oneline -1` が `feature/ui-animations` の先頭 (`docs: record animation decisions …`) を指す。`cargo build` が通る。

---

### Task 1: `domain/views.rs` — 今日 / 近日 / ラベル詳細の抽出

**Files:**
- Create: `src-tauri/src/domain/views.rs`
- Modify: `src-tauri/src/domain/mod.rs` (`pub mod views;` を足す)

**Interfaces:**
- Produces:
  - `pub struct TodayView { pub overdue: Vec<Task>, pub today: Vec<Task> }` (Serialize, camelCase)
  - `pub fn today_view(tasks: &[Task], today: NaiveDate) -> TodayView`
  - `pub struct DayGroup { pub date: NaiveDate, pub tasks: Vec<Task> }` (Serialize; `date` は `serde_date` で `YYYY-MM-DD`)
  - `pub fn upcoming(tasks: &[Task], from: NaiveDate, days: u32) -> Vec<DayGroup>` (`days` 個のグループ、タスクの無い日も入る)
  - `pub fn label_tasks(tasks: &[Task], label: &str) -> Vec<Task>`
  - `pub fn today_count(tasks: &[Task], today: NaiveDate) -> u32`
  - `pub fn label_counts(tasks: &[Task]) -> BTreeMap<String, u32>` (未完了タスクのラベルごとの件数)

- [ ] **Step 1: テストを書く**

`src-tauri/src/domain/views.rs` を作り、末尾に:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Priority;
    use chrono::NaiveDateTime;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn task(no: u32, project: &str, due: Option<&str>, priority: u8, progress: u8, parent: Option<u32>) -> Task {
        Task {
            no,
            project: project.into(),
            category: None,
            title: format!("t{no}"),
            assignee: String::new(),
            priority: Priority(priority),
            progress,
            start: None,
            due: due.map(d),
            due_time: None,
            days: None,
            note: None,
            parent_no: parent,
            labels: vec![],
            rrule: None,
            reminders: vec![],
            order: 0,
            created_at: NaiveDateTime::default(),
            completed_at: None,
            extra: Default::default(),
        }
    }

    #[test]
    fn today_splits_overdue_and_today_and_sorts() {
        let tasks = vec![
            task(1, "a", Some("2026-10-13"), 4, 0, None),   // today, p4
            task(2, "a", Some("2026-10-13"), 1, 0, None),   // today, p1 -> first in today
            task(3, "b", Some("2026-10-10"), 3, 0, None),   // overdue
            task(4, "b", Some("2026-10-01"), 4, 0, None),   // overdue, oldest -> first
            task(5, "b", Some("2026-10-10"), 1, 0, None),   // overdue same day, p1 before p3
            task(6, "a", Some("2026-10-13"), 1, 100, None), // done: hidden
            task(7, "a", Some("2026-10-13"), 1, 0, Some(1)), // subtask: hidden
            task(8, "a", Some("2026-10-14"), 1, 0, None),   // tomorrow: hidden
            task(9, "a", None, 1, 0, None),                 // no due: hidden
        ];
        let v = today_view(&tasks, d("2026-10-13"));
        assert_eq!(v.overdue.iter().map(|t| t.no).collect::<Vec<_>>(), vec![4, 5, 3]);
        assert_eq!(v.today.iter().map(|t| t.no).collect::<Vec<_>>(), vec![2, 1]);
        assert_eq!(today_count(&tasks, d("2026-10-13")), 5);
    }

    #[test]
    fn upcoming_groups_every_day_even_empty_and_excludes_overdue() {
        let tasks = vec![
            task(1, "a", Some("2026-10-13"), 4, 0, None),
            task(2, "a", Some("2026-10-15"), 1, 0, None),
            task(3, "a", Some("2026-10-15"), 3, 0, None),
            task(4, "a", Some("2026-10-12"), 1, 0, None), // overdue: not shown
            task(5, "a", Some("2026-10-20"), 1, 0, None), // outside 7 days
        ];
        let g = upcoming(&tasks, d("2026-10-13"), 7);
        assert_eq!(g.len(), 7);
        assert_eq!(g[0].date, d("2026-10-13"));
        assert_eq!(g[0].tasks.iter().map(|t| t.no).collect::<Vec<_>>(), vec![1]);
        assert!(g[1].tasks.is_empty());
        assert_eq!(g[2].tasks.iter().map(|t| t.no).collect::<Vec<_>>(), vec![2, 3]);
        assert_eq!(g[6].date, d("2026-10-19"));
        assert!(g.iter().all(|day| day.tasks.iter().all(|t| t.no != 4 && t.no != 5)));
    }

    #[test]
    fn label_tasks_are_flat_and_sorted_by_due_then_priority() {
        let mut a = task(1, "a", None, 2, 0, None);
        a.labels = vec!["食品".into()];
        let mut b = task(2, "b", Some("2026-10-20"), 4, 0, Some(1));
        b.labels = vec!["食品".into()]; // subtask: included
        let mut c = task(3, "b", Some("2026-10-15"), 4, 0, None);
        c.labels = vec!["食品".into(), "急ぎ".into()];
        let mut done = task(4, "b", Some("2026-10-15"), 4, 100, None);
        done.labels = vec!["食品".into()];
        let other = task(5, "b", Some("2026-10-15"), 4, 0, None);
        let tasks = vec![a, b, c, done, other];
        let got = label_tasks(&tasks, "食品");
        assert_eq!(got.iter().map(|t| t.no).collect::<Vec<_>>(), vec![3, 2, 1]);
        let counts = label_counts(&tasks);
        assert_eq!(counts["食品"], 3);
        assert_eq!(counts["急ぎ"], 1);
    }
}
```

- [ ] **Step 2: 失敗を確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml views`
Expected: コンパイルエラー (`today_view` が無い)。

- [ ] **Step 3: 実装**

`src-tauri/src/domain/views.rs` の先頭:

```rust
//! Cross-project views (今日 / 近日 / ラベル詳細). Pure: they take every loaded task and return
//! the ones to show, in display order. No I/O, no clock (the caller passes `today`).

use std::collections::BTreeMap;

use chrono::{Days, NaiveDate};
use serde::Serialize;

use super::model::{Task, serde_date};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayView {
    pub overdue: Vec<Task>,
    pub today: Vec<Task>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayGroup {
    #[serde(with = "serde_date")]
    pub date: NaiveDate,
    pub tasks: Vec<Task>,
}

/// Unfinished and not a subtask: what the cross-project lists show (仕様 §3.1, §3.2).
fn open_top_level(t: &Task) -> bool {
    t.parent_no.is_none() && t.progress < 100
}

/// Due date (None last), then priority (1 first), then No.
fn by_due_priority_no(a: &Task, b: &Task) -> std::cmp::Ordering {
    let key = |t: &Task| (t.due.is_none(), t.due, u8::from(t.priority), t.no);
    key(a).cmp(&key(b))
}

fn by_priority_no(a: &Task, b: &Task) -> std::cmp::Ordering {
    (u8::from(a.priority), a.no).cmp(&(u8::from(b.priority), b.no))
}

pub fn today_view(tasks: &[Task], today: NaiveDate) -> TodayView {
    let mut overdue: Vec<Task> = tasks
        .iter()
        .filter(|t| open_top_level(t) && t.due.is_some_and(|d| d < today))
        .cloned()
        .collect();
    overdue.sort_by(by_due_priority_no);
    let mut todays: Vec<Task> = tasks
        .iter()
        .filter(|t| open_top_level(t) && t.due == Some(today))
        .cloned()
        .collect();
    todays.sort_by(by_priority_no);
    TodayView {
        overdue,
        today: todays,
    }
}

pub fn today_count(tasks: &[Task], today: NaiveDate) -> u32 {
    tasks
        .iter()
        .filter(|t| open_top_level(t) && t.due.is_some_and(|d| d <= today))
        .count() as u32
}

/// `days` groups starting at `from`; days without tasks are included (the view shows an add row).
pub fn upcoming(tasks: &[Task], from: NaiveDate, days: u32) -> Vec<DayGroup> {
    (0..days)
        .filter_map(|i| from.checked_add_days(Days::new(i as u64)))
        .map(|date| {
            let mut day: Vec<Task> = tasks
                .iter()
                .filter(|t| open_top_level(t) && t.due == Some(date))
                .cloned()
                .collect();
            day.sort_by(by_priority_no);
            DayGroup { date, tasks: day }
        })
        .collect()
}

/// Every unfinished task (subtasks too, flat) carrying `label`.
pub fn label_tasks(tasks: &[Task], label: &str) -> Vec<Task> {
    let mut out: Vec<Task> = tasks
        .iter()
        .filter(|t| t.progress < 100 && t.labels.iter().any(|l| l == label))
        .cloned()
        .collect();
    out.sort_by(by_due_priority_no);
    out
}

/// Unfinished tasks per label name (subtasks included).
pub fn label_counts(tasks: &[Task]) -> BTreeMap<String, u32> {
    let mut counts = BTreeMap::new();
    for t in tasks.iter().filter(|t| t.progress < 100) {
        for l in &t.labels {
            *counts.entry(l.clone()).or_insert(0) += 1;
        }
    }
    counts
}
```

`src-tauri/src/domain/mod.rs` に `pub mod views;` を足す (アルファベット順で `quick_add` の後)。`serde_date` が `pub` でなければ `model.rs` のマクロ呼び出しで `pub mod serde_date` になっていることを確認し、必要なら `pub(crate)` にする。

- [ ] **Step 4: テストを通す**

Run: `cargo test --manifest-path src-tauri/Cargo.toml views`
Expected: 3 tests PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/domain/views.rs src-tauri/src/domain/mod.rs
git commit -m "feat(domain): cross-project views (today, upcoming, label)"
```

---

### Task 2: `domain/search.rs` — 検索の正規化と一致

**Files:**
- Create: `src-tauri/src/domain/search.rs`
- Modify: `src-tauri/src/domain/mod.rs`, `src-tauri/Cargo.toml` (`unicode-normalization = "0.1"`)

**Interfaces:**
- Produces:
  - `pub fn normalize(s: &str) -> String` (NFKC → 小文字 → カタカナをひらがなに)
  - `pub enum Matched { Title, Note, Label }` (Serialize, snake_case)
  - `pub struct Hit { pub task: Task, pub matched: Matched }` (Serialize)
  - `pub fn search(tasks: &[Task], query: &str, include_done: bool, limit: usize) -> Vec<Hit>`

- [ ] **Step 1: 依存を足す**

`src-tauri/Cargo.toml` の `[dependencies]` に `unicode-normalization = "0.1"` を足す。`cargo build --manifest-path src-tauri/Cargo.toml` で解決できることを確認。

- [ ] **Step 2: テストを書く**

`src-tauri/src/domain/search.rs` の末尾:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Priority;
    use chrono::{NaiveDate, NaiveDateTime};

    fn task(no: u32, title: &str, note: Option<&str>, labels: &[&str], due: Option<&str>, progress: u8) -> Task {
        Task {
            no,
            project: "p".into(),
            category: None,
            title: title.into(),
            assignee: String::new(),
            priority: Priority(4),
            progress,
            start: None,
            due: due.map(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()),
            due_time: None,
            days: None,
            note: note.map(Into::into),
            parent_no: None,
            labels: labels.iter().map(|s| s.to_string()).collect(),
            rrule: None,
            reminders: vec![],
            order: 0,
            created_at: NaiveDateTime::default(),
            completed_at: None,
            extra: Default::default(),
        }
    }

    #[test]
    fn normalize_folds_width_case_and_kana() {
        assert_eq!(normalize("Ｍｉｌｋ"), "milk");
        assert_eq!(normalize("ギュウニュウ"), "ぎゅうにゅう");
        assert_eq!(normalize("ｶﾞ"), "が"); // half-width katakana + voiced mark -> NFKC "ガ" -> hiragana
        assert_eq!(normalize("コーヒー"), "こーひー"); // long mark kept
    }

    #[test]
    fn search_matches_title_note_label_in_that_order() {
        let tasks = vec![
            task(1, "買い物リスト", Some("牛乳"), &[], None, 0),
            task(2, "牛乳を買う", None, &[], Some("2026-10-20"), 0),
            task(3, "朝食", None, &["牛乳"], None, 0),
            task(4, "ぎゅうにゅう (完了)", None, &[], None, 100),
            task(5, "パン", None, &[], None, 0),
        ];
        let hits = search(&tasks, "ギュウニュウ", false, 50);
        assert_eq!(hits.iter().map(|h| h.task.no).collect::<Vec<_>>(), vec![2, 1, 3]);
        assert!(matches!(hits[0].matched, Matched::Title));
        assert!(matches!(hits[1].matched, Matched::Note));
        assert!(matches!(hits[2].matched, Matched::Label));
        let with_done = search(&tasks, "牛乳", true, 50);
        assert_eq!(with_done.iter().map(|h| h.task.no).collect::<Vec<_>>(), vec![2, 4, 1, 3]);
    }

    #[test]
    fn search_requires_every_word() {
        let tasks = vec![
            task(1, "牛乳と卵を買う", None, &[], None, 0),
            task(2, "牛乳 1L", None, &[], None, 0),
        ];
        let hits = search(&tasks, "牛乳　卵", false, 50); // full-width space separates words
        assert_eq!(hits.iter().map(|h| h.task.no).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn search_ignores_blank_query_and_respects_limit() {
        let tasks: Vec<Task> = (1..=5).map(|i| task(i, "同じ名前", None, &[], None, 0)).collect();
        assert!(search(&tasks, "   ", false, 50).is_empty());
        assert!(search(&tasks, "", false, 50).is_empty());
        assert_eq!(search(&tasks, "同じ", false, 3).len(), 3);
    }
}
```

- [ ] **Step 3: 失敗を確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml search`
Expected: コンパイルエラー。

- [ ] **Step 4: 実装**

```rust
//! Search over every task (仕様 §3.4). Pure. Matching is on a normalized form so that width,
//! case and katakana / hiragana differences do not matter.

use serde::Serialize;
use unicode_normalization::UnicodeNormalization;

use super::model::Task;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Matched {
    Title,
    Note,
    Label,
}

#[derive(Debug, Clone, Serialize)]
pub struct Hit {
    pub task: Task,
    pub matched: Matched,
}

/// NFKC (full-width -> ASCII, half-width katakana -> full-width), lower case, katakana -> hiragana.
/// The long sound mark (ー) and everything else stay as they are.
pub fn normalize(s: &str) -> String {
    s.nfkc()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            '\u{30A1}'..='\u{30F6}' => char::from_u32(c as u32 - 0x60).unwrap_or(c),
            _ => c,
        })
        .collect()
}

/// Words are separated by any whitespace (NFKC turns a full-width space into a plain one).
fn words(query: &str) -> Vec<String> {
    normalize(query)
        .split_whitespace()
        .map(str::to_string)
        .collect()
}

fn where_matched(t: &Task, words: &[String]) -> Option<Matched> {
    let title = normalize(&t.title);
    let note = t.note.as_deref().map(normalize).unwrap_or_default();
    let labels: Vec<String> = t.labels.iter().map(|l| normalize(l)).collect();
    let in_title = words.iter().all(|w| title.contains(w.as_str()));
    let in_note = !note.is_empty() && words.iter().all(|w| note.contains(w.as_str()));
    let in_labels = words
        .iter()
        .all(|w| labels.iter().any(|l| l.contains(w.as_str())));
    if in_title {
        Some(Matched::Title)
    } else if in_note {
        Some(Matched::Note)
    } else if in_labels {
        Some(Matched::Label)
    } else {
        None
    }
}

/// Every word must appear in one field (title, note or a label). Ordered: title hits, then
/// note, then label; inside a group by due date (none last), then No. At most `limit` hits.
pub fn search(tasks: &[Task], query: &str, include_done: bool, limit: usize) -> Vec<Hit> {
    let words = words(query);
    if words.is_empty() {
        return Vec::new();
    }
    let mut hits: Vec<Hit> = tasks
        .iter()
        .filter(|t| include_done || t.progress < 100)
        .filter_map(|t| {
            where_matched(t, &words).map(|matched| Hit {
                task: t.clone(),
                matched,
            })
        })
        .collect();
    hits.sort_by(|a, b| {
        let key = |h: &Hit| (h.matched, h.task.due.is_none(), h.task.due, h.task.no);
        key(a).cmp(&key(b))
    });
    hits.truncate(limit);
    hits
}
```

`domain/mod.rs` に `pub mod search;` を足す。

- [ ] **Step 5: テストを通す**

Run: `cargo test --manifest-path src-tauri/Cargo.toml search`
Expected: 4 tests PASS。`normalize("ｶﾞ")` が `"が"` にならないなら、NFKC の結果 (`ガ`) が U+30AB + 結合濁点か合成済み U+30AC かを `println!` で確かめ、合成済みになるよう `.nfkc()` の後に `.nfc()` を通す。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/domain/search.rs src-tauri/src/domain/mod.rs
git commit -m "feat(domain): task search with kana/width/case folding"
```

---

### Task 3: store — `all_tasks`、ラベル操作、`reschedule_overdue` (`store/labels.rs` に分離)

**Files:**
- Create: `src-tauri/src/store/labels.rs` (`impl ProjectStore` の第 2 ブロック)
- Modify: `src-tauri/src/store/project_store.rs` (`all_tasks`、`loaded_names`、`pub(super)` の可視性)、`src-tauri/src/store/mod.rs` (`pub mod labels;`)

**Interfaces:**
- Consumes: `ProjectStore { common: CommonBook, books: BTreeMap<String, LoadedProject>, dirty, common_dirty }`、`LoadedProject::{Ok, Failed}`、`DEFAULT_COLOR`、`invalid()`
- Produces (すべて `impl ProjectStore`):
  - `pub fn all_tasks(&self) -> Vec<Task>` (読み込めたプロジェクトのタスクを連結、プロジェクトの並び順)
  - `pub fn labels_union(&self) -> Vec<Label>` (シート ∪ タスクの名前。シートの並び、その後名前順。既定色 `DEFAULT_COLOR`)
  - `pub fn add_label(&mut self, name: &str, color: &str) -> AppResult<Label>`
  - `pub fn update_label_color(&mut self, name: &str, color: &str) -> AppResult<Label>`
  - `pub fn rename_label(&mut self, name: &str, new_name: &str) -> AppResult<(Label, Vec<String>)>` (変わったプロジェクト名)
  - `pub fn delete_label(&mut self, name: &str) -> AppResult<Vec<String>>`
  - `pub fn reschedule_overdue(&mut self, today: NaiveDate, due: NaiveDate) -> AppResult<Vec<String>>`
  - `pub fn label_by_name(&self, name: &str) -> Label` (シートに無ければ既定色・末尾の order)

- [ ] **Step 1: テストを書く**

`src-tauri/src/store/labels.rs` を作り、末尾にテスト。既存の store テストがどう `ProjectStore` を作っているか (`project_store.rs` の `mod tests` の `open_temp` 相当のヘルパー) を読んで、同じ方法で開く。以下は `tempfile::tempdir()` と `ProjectStore::open(Paths::new(dir), || NaiveDateTime::default(), true)` を使う前提:

```rust
#[cfg(test)]
mod tests {
    use super::super::paths::Paths;
    use super::super::project_store::ProjectStore;
    use crate::domain::{TaskInput, TaskPatch};
    use chrono::{NaiveDate, NaiveDateTime};

    fn clock() -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 10, 13).unwrap().and_hms_opt(9, 0, 0).unwrap()
    }

    fn store() -> (tempfile::TempDir, ProjectStore) {
        let dir = tempfile::tempdir().unwrap();
        let mut s = ProjectStore::open(Paths::new(dir.path()), clock, true).unwrap();
        s.create_project("仕事", "var(--color-success)").unwrap();
        (dir, s)
    }

    fn input(title: &str, labels: &[&str], due: Option<NaiveDate>) -> TaskInput {
        TaskInput {
            title: title.into(),
            section: None,
            priority: None,
            due,
            due_time: None,
            note: None,
            labels: labels.iter().map(|s| s.to_string()).collect(),
            parent_no: None,
        }
    }

    #[test]
    fn labels_union_adds_names_only_used_by_tasks() {
        let (_d, mut s) = store();
        s.add_label("食品", "var(--color-success)").unwrap();
        s.add_task("受信トレイ", input("a", &["食品", "急ぎ"], None)).unwrap();
        let names: Vec<String> = s.labels_union().into_iter().map(|l| l.name).collect();
        assert_eq!(names, vec!["食品", "急ぎ"]);
        assert_eq!(s.label_by_name("急ぎ").color, "var(--color-text-muted)");
    }

    #[test]
    fn rename_label_rewrites_every_project_and_reports_them() {
        let (_d, mut s) = store();
        s.add_label("食品", "var(--color-success)").unwrap();
        s.add_task("受信トレイ", input("a", &["食品"], None)).unwrap();
        s.add_task("仕事", input("b", &["食品", "急ぎ"], None)).unwrap();
        s.add_task("仕事", input("c", &["急ぎ"], None)).unwrap();
        s.save("受信トレイ").unwrap();
        s.save("仕事").unwrap();
        let (label, changed) = s.rename_label("食品", "食べ物").unwrap();
        assert_eq!(label.name, "食べ物");
        assert_eq!(changed, vec!["仕事", "受信トレイ"]);
        assert_eq!(s.dirty_projects(), vec!["仕事", "受信トレイ"]);
        let b = &s.view("仕事").unwrap().tasks[0];
        assert_eq!(b.labels, vec!["食べ物", "急ぎ"]);
        assert!(s.labels_union().iter().all(|l| l.name != "食品"));
    }

    #[test]
    fn rename_label_rejects_existing_name() {
        let (_d, mut s) = store();
        s.add_label("食品", "var(--color-success)").unwrap();
        s.add_label("Food", "var(--color-success)").unwrap();
        assert!(matches!(s.rename_label("食品", "food"), Err(crate::error::AppError::Invalid { .. })));
        assert!(matches!(s.rename_label("食品", " "), Err(crate::error::AppError::Invalid { .. })));
        assert!(matches!(s.add_label("食品", "x"), Err(crate::error::AppError::Invalid { .. })));
    }

    #[test]
    fn delete_label_strips_it_from_tasks() {
        let (_d, mut s) = store();
        s.add_task("仕事", input("b", &["食品", "急ぎ"], None)).unwrap();
        s.save("仕事").unwrap();
        let changed = s.delete_label("食品").unwrap();
        assert_eq!(changed, vec!["仕事"]);
        assert_eq!(s.view("仕事").unwrap().tasks[0].labels, vec!["急ぎ"]);
    }

    #[test]
    fn reschedule_overdue_moves_only_overdue_open_top_level_and_keeps_time() {
        let (_d, mut s) = store();
        let d = |y, m, dd| NaiveDate::from_ymd_opt(y, m, dd).unwrap();
        s.add_task("受信トレイ", input("old", &[], Some(d(2026, 10, 1)))).unwrap();
        let v = s.add_task("仕事", input("old-timed", &[], Some(d(2026, 10, 5)))).unwrap();
        let no = v.tasks[0].no;
        s.update_task("仕事", no, TaskPatch { due_time: Some(Some(chrono::NaiveTime::from_hms_opt(15, 0, 0).unwrap())), ..Default::default() }).unwrap();
        s.add_task("仕事", input("today", &[], Some(d(2026, 10, 13)))).unwrap();
        s.save("受信トレイ").unwrap();
        s.save("仕事").unwrap();
        let changed = s.reschedule_overdue(d(2026, 10, 13), d(2026, 10, 14)).unwrap();
        assert_eq!(changed, vec!["仕事", "受信トレイ"]);
        let tasks = s.all_tasks();
        let timed = tasks.iter().find(|t| t.title == "old-timed").unwrap();
        assert_eq!(timed.due, Some(d(2026, 10, 14)));
        assert_eq!(timed.due_time.map(|t| t.format("%H:%M").to_string()), Some("15:00".into()));
        assert_eq!(tasks.iter().find(|t| t.title == "today").unwrap().due, Some(d(2026, 10, 13)));
    }

    #[test]
    fn reschedule_skips_failed_projects() {
        let (dir, mut s) = store();
        let d = |y, m, dd| NaiveDate::from_ymd_opt(y, m, dd).unwrap();
        s.add_task("受信トレイ", input("old", &[], Some(d(2026, 10, 1)))).unwrap();
        s.save("受信トレイ").unwrap();
        std::fs::write(dir.path().join("仕事.xlsx"), b"not an xlsx").unwrap();
        s.reload_discarding("仕事").unwrap_err();
        let changed = s.reschedule_overdue(d(2026, 10, 13), d(2026, 10, 14)).unwrap();
        assert_eq!(changed, vec!["受信トレイ"]);
    }
}
```

`TaskPatch` が `Default` を実装していなければ `#[derive(Default)]` を `model.rs` の `TaskPatch` に足す (全フィールドが `Option` なので安全)。

- [ ] **Step 2: 失敗を確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml labels`
Expected: コンパイルエラー。

- [ ] **Step 3: `project_store.rs` に土台を足す**

`project_store.rs` の `impl ProjectStore` に (`labels()` の近く):

```rust
    /// Tasks of every project that loaded, in project order (仕様 §2). Failed projects are left out.
    pub fn all_tasks(&self) -> Vec<Task> {
        self.summaries()
            .iter()
            .filter_map(|p| match self.books.get(&p.name) {
                Some(LoadedProject::Ok(b)) => Some(b.tasks.iter().cloned()),
                _ => None,
            })
            .flatten()
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
```

同じファイルで、`labels.rs` から触るものの可視性を `pub(super)` にする: フィールド `common`, `books`, `dirty`, `common_dirty` (構造体定義で `pub(super) common: CommonBook,` のように)、`const DEFAULT_COLOR`, `fn invalid`。`LoadedProject` は既に `pub`。

- [ ] **Step 4: `labels.rs` を実装**

```rust
//! Label management and bulk edits that span every project (仕様 §3.3, §3.1). Second `impl`
//! block of [`ProjectStore`]; split out of `project_store.rs` to keep that file readable.

use chrono::NaiveDate;

use super::project_store::{DEFAULT_COLOR, LoadedProject, ProjectStore, invalid};
use crate::domain::Label;
use crate::error::AppResult;

fn clean_label_name(name: &str) -> AppResult<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(invalid("ラベル名が空です"));
    }
    if n.contains(['@', ',', '、']) {
        return Err(invalid("ラベル名に @ , 、 は使えません"));
    }
    Ok(n.to_string())
}

fn same_name(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

impl ProjectStore {
    /// Labels from the common workbook (sheet order) followed by names that only appear on
    /// tasks (name order, default color).
    pub fn labels_union(&self) -> Vec<Label> {
        let mut out = self.labels();
        let mut extra: Vec<String> = self
            .all_tasks()
            .into_iter()
            .flat_map(|t| t.labels)
            .filter(|n| !out.iter().any(|l| &l.name == n))
            .collect();
        extra.sort();
        extra.dedup();
        let base = out.iter().map(|l| l.order + 1).max().unwrap_or(0);
        for (i, name) in extra.into_iter().enumerate() {
            out.push(Label {
                name,
                color: DEFAULT_COLOR.into(),
                order: base + i as u32,
            });
        }
        out
    }

    pub fn label_by_name(&self, name: &str) -> Label {
        self.labels_union()
            .into_iter()
            .find(|l| l.name == name)
            .unwrap_or_else(|| Label {
                name: name.to_string(),
                color: DEFAULT_COLOR.into(),
                order: self.common.labels.len() as u32,
            })
    }

    fn sheet_label_mut(&mut self, name: &str) -> Option<&mut Label> {
        self.common.labels.iter_mut().find(|l| l.name == name)
    }

    /// Adds a sheet row for `name` if it has none (a name that so far only lived on tasks).
    fn ensure_sheet_label(&mut self, name: &str) -> Label {
        if let Some(l) = self.sheet_label_mut(name) {
            return l.clone();
        }
        let label = Label {
            name: name.to_string(),
            color: DEFAULT_COLOR.into(),
            order: self.common.labels.iter().map(|l| l.order + 1).max().unwrap_or(0),
        };
        self.common.labels.push(label.clone());
        self.common_dirty = true;
        label
    }

    pub fn add_label(&mut self, name: &str, color: &str) -> AppResult<Label> {
        let name = clean_label_name(name)?;
        if self.labels_union().iter().any(|l| same_name(&l.name, &name)) {
            return Err(invalid(format!("ラベル「{name}」は既にあります")));
        }
        let mut label = self.ensure_sheet_label(&name);
        label.color = color.to_string();
        if let Some(l) = self.sheet_label_mut(&name) {
            l.color = color.to_string();
        }
        self.common_dirty = true;
        Ok(label)
    }

    pub fn update_label_color(&mut self, name: &str, color: &str) -> AppResult<Label> {
        let name = clean_label_name(name)?;
        self.ensure_sheet_label(&name);
        let l = self.sheet_label_mut(&name).expect("just ensured");
        l.color = color.to_string();
        let out = l.clone();
        self.common_dirty = true;
        Ok(out)
    }

    /// Applies `f` to every loaded project's tasks; returns the names of the projects where
    /// `f` changed something (they are marked dirty). Failed projects are skipped.
    fn edit_all_projects(&mut self, mut f: impl FnMut(&mut crate::domain::Task) -> bool) -> Vec<String> {
        let mut changed = Vec::new();
        for name in self.loaded_names() {
            let Some(LoadedProject::Ok(book)) = self.books.get_mut(&name) else {
                continue;
            };
            let mut touched = false;
            for t in &mut book.tasks {
                touched |= f(t);
            }
            if touched {
                self.dirty.insert(name.clone());
                changed.push(name);
            }
        }
        changed.sort();
        changed
    }

    pub fn rename_label(&mut self, name: &str, new_name: &str) -> AppResult<(Label, Vec<String>)> {
        let new_name = clean_label_name(new_name)?;
        if new_name != name && self.labels_union().iter().any(|l| same_name(&l.name, &new_name)) {
            return Err(invalid(format!("ラベル「{new_name}」は既にあります")));
        }
        self.ensure_sheet_label(name);
        let l = self.sheet_label_mut(name).expect("just ensured");
        l.name = new_name.clone();
        let label = l.clone();
        self.common_dirty = true;
        let changed = self.edit_all_projects(|t| {
            let mut hit = false;
            for l in &mut t.labels {
                if l == name {
                    *l = new_name.clone();
                    hit = true;
                }
            }
            hit
        });
        Ok((label, changed))
    }

    pub fn delete_label(&mut self, name: &str) -> AppResult<Vec<String>> {
        let before = self.common.labels.len();
        self.common.labels.retain(|l| l.name != name);
        if self.common.labels.len() != before {
            self.common_dirty = true;
        }
        Ok(self.edit_all_projects(|t| {
            let before = t.labels.len();
            t.labels.retain(|l| l != name);
            t.labels.len() != before
        }))
    }

    /// Every unfinished top-level task due before `today` gets `due` (time kept). 仕様 §3.1.
    pub fn reschedule_overdue(&mut self, today: NaiveDate, due: NaiveDate) -> AppResult<Vec<String>> {
        Ok(self.edit_all_projects(|t| {
            let overdue = t.parent_no.is_none() && t.progress < 100 && t.due.is_some_and(|d| d < today);
            if overdue {
                t.due = Some(due);
            }
            overdue
        }))
    }
}
```

注意: Phase 1 の `update_task` は `due` が変わると `days` (営業日数) を再計算している (`recompute_days`)。`reschedule_overdue` でも変わったプロジェクトに対して同じ再計算を呼ぶ: `edit_all_projects` の `if touched` の中で `recompute_days(book, &holidays)` を呼ぶ (`holidays` は事前に `self.common.holidays.clone()` しておく。`recompute_days` は `project_store.rs` の自由関数なので `pub(super)` にする)。

`src-tauri/src/store/mod.rs` に `pub mod labels;` を足す。

- [ ] **Step 5: テストを通す**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 新規 6 件を含め全部 PASS (Phase 1 の 123 件も)。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/store
git commit -m "feat(store): label management, reschedule_overdue, all_tasks"
```

---

### Task 4: command と TS 型 (横断ビュー・ラベル・検索・件数)

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` (登録)
- Modify: `src/types/model.ts`, `src/api/client.ts`, `src/api/events.ts`

**Interfaces:**
- Consumes: Task 1〜3 の関数
- Produces (command。引数は camelCase):
  - `today_view { today: "YYYY-MM-DD" } -> TodayView`
  - `upcoming_view { from, days } -> { days: DayGroup[] }`
  - `label_view { label } -> { label: Label, tasks: Task[] }`
  - `labels -> { labels: Label[], counts: Record<string, number> }`
  - `add_label { name, color } -> Label`, `update_label { name, color } -> Label`
  - `rename_label { name, newName } -> { label: Label, changedProjects: string[] }`
  - `delete_label { name } -> { changedProjects: string[] }`
  - `reschedule_overdue { today, due } -> { changedProjects: string[] }`
  - `search { query, includeDone, limit } -> { hits: { task, matched }[] }`
  - `counts { today } -> { today: number, labels: Record<string, number> }`
  - イベント `project-changed { name, reason: "bulk" | "external" | "move" }`
  - TS: `api.todayView(today)`, `api.upcomingView(from, days)`, `api.labelView(label)`, `api.labels()`, `api.addLabel`, `api.updateLabel`, `api.renameLabel`, `api.deleteLabel`, `api.rescheduleOverdue(today, due)`, `api.search(query, includeDone, limit)`, `api.counts(today)`; `onProjectChanged(cb: (name: string, reason: ChangeReason) => void)`

- [ ] **Step 1: Rust のテストを書く (command の純関数部分)**

`commands/mod.rs` の既存 `mod tests` (無ければ作る) に:

```rust
    #[test]
    fn upcoming_view_rejects_out_of_range_days() {
        assert!(matches!(check_days(0), Err(AppError::Invalid { .. })));
        assert!(matches!(check_days(92), Err(AppError::Invalid { .. })));
        assert_eq!(check_days(91).unwrap(), 91);
    }

    #[test]
    fn parse_ymd_rejects_garbage() {
        assert!(matches!(parse_ymd("2026-13-01"), Err(AppError::Invalid { .. })));
        assert_eq!(parse_ymd("2026-10-13").unwrap(), NaiveDate::from_ymd_opt(2026, 10, 13).unwrap());
    }
```

- [ ] **Step 2: 失敗を確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml commands`
Expected: コンパイルエラー。

- [ ] **Step 3: Rust 実装**

`commands/mod.rs` の DTO 群の近くに:

```rust
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

fn emit_changed(app: &AppHandle, names: &[String], reason: ChangeReason) {
    for name in names {
        let _ = app.emit("project-changed", ProjectChanged { name: name.clone(), reason });
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
```

既存の `move_task` の `app.emit("project-changed", ProjectChanged { name })` は `ProjectChanged { name, reason: ChangeReason::Move }` に直す。use に `std::collections::BTreeMap`、`crate::domain::views::{self, DayGroup}`、`crate::domain::search::{self, Hit}`、`crate::domain::{Label, Task}` を足す。

command 本体 (「commands: cross-project views」の節を `quick_add` の前に作る):

```rust
// ---- commands: cross-project views (仕様 §3, §4) ----

#[tauri::command]
pub async fn today_view(today: String, state: State<'_, AppState>) -> AppResult<views::TodayView> {
    let today = parse_ymd(&today)?;
    with_store(state.inner(), |s| Ok(views::today_view(&s.all_tasks(), today)))
}

#[tauri::command]
pub async fn upcoming_view(from: String, days: u32, state: State<'_, AppState>) -> AppResult<UpcomingDto> {
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
pub async fn add_label(name: String, color: String, app: AppHandle, state: State<'_, AppState>) -> AppResult<Label> {
    mutate(&app, state.inner(), &[], true, |s| s.add_label(&name, &color))
}

#[tauri::command]
pub async fn update_label(name: String, color: String, app: AppHandle, state: State<'_, AppState>) -> AppResult<Label> {
    mutate(&app, state.inner(), &[], true, |s| s.update_label_color(&name, &color))
}

#[tauri::command]
pub async fn rename_label(name: String, new_name: String, app: AppHandle, state: State<'_, AppState>) -> AppResult<LabelRenamed> {
    let (label, changed) = mutate(&app, state.inner(), &[], true, |s| s.rename_label(&name, &new_name))?;
    for p in &changed {
        state.saver.schedule(app.clone(), p.clone());
    }
    emit_changed(&app, &changed, ChangeReason::Bulk);
    Ok(LabelRenamed { label, changed_projects: changed })
}

#[tauri::command]
pub async fn delete_label(name: String, app: AppHandle, state: State<'_, AppState>) -> AppResult<ChangedProjects> {
    let changed = mutate(&app, state.inner(), &[], true, |s| s.delete_label(&name))?;
    for p in &changed {
        state.saver.schedule(app.clone(), p.clone());
    }
    emit_changed(&app, &changed, ChangeReason::Bulk);
    Ok(ChangedProjects { changed_projects: changed })
}

#[tauri::command]
pub async fn reschedule_overdue(today: String, due: String, app: AppHandle, state: State<'_, AppState>) -> AppResult<ChangedProjects> {
    let today = parse_ymd(&today)?;
    let due = parse_ymd(&due)?;
    let changed = mutate(&app, state.inner(), &[], false, |s| s.reschedule_overdue(today, due))?;
    for p in &changed {
        state.saver.schedule(app.clone(), p.clone());
    }
    emit_changed(&app, &changed, ChangeReason::Bulk);
    Ok(ChangedProjects { changed_projects: changed })
}

#[tauri::command]
pub async fn search(query: String, include_done: bool, limit: Option<usize>, state: State<'_, AppState>) -> AppResult<SearchDto> {
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
```

`lib.rs` の `generate_handler!` に 11 個を足す: `today_view, upcoming_view, label_view, labels, add_label, update_label, rename_label, delete_label, reschedule_overdue, search, counts`。

- [ ] **Step 4: Rust テストとビルド**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS。

- [ ] **Step 5: TS の型と API**

`src/types/model.ts` の末尾に:

```ts
// ---- Phase 2 ----
export interface TodayViewDto { overdue: Task[]; today: Task[]; }
export interface DayGroup { date: string; tasks: Task[]; }
export interface UpcomingDto { days: DayGroup[]; }
export interface LabelViewDto { label: Label; tasks: Task[]; }
export interface LabelsDto { labels: Label[]; counts: Record<string, number>; }
export interface LabelRenamed { label: Label; changedProjects: string[]; }
export interface ChangedProjects { changedProjects: string[]; }
export type Matched = "title" | "note" | "label";
export interface SearchHit { task: Task; matched: Matched; }
export interface SearchDto { hits: SearchHit[]; }
export interface CountsDto { today: number; labels: Record<string, number>; }
export type ChangeReason = "bulk" | "external" | "move";
```

`src/api/client.ts` の `api` に:

```ts
  // ---- Phase 2: cross-project views, labels, search ----
  todayView: (today: string) => invoke<TodayViewDto>("today_view", { today }),
  upcomingView: (from: string, days: number) => invoke<UpcomingDto>("upcoming_view", { from, days }),
  labelView: (label: string) => invoke<LabelViewDto>("label_view", { label }),
  labels: () => invoke<LabelsDto>("labels"),
  addLabel: (name: string, color: string) => invoke<Label>("add_label", { name, color }),
  updateLabel: (name: string, color: string) => invoke<Label>("update_label", { name, color }),
  renameLabel: (name: string, newName: string) => invoke<LabelRenamed>("rename_label", { name, newName }),
  deleteLabel: (name: string) => invoke<ChangedProjects>("delete_label", { name }),
  rescheduleOverdue: (today: string, due: string) => invoke<ChangedProjects>("reschedule_overdue", { today, due }),
  search: (query: string, includeDone: boolean, limit = 50) => invoke<SearchDto>("search", { query, includeDone, limit }),
  counts: (today: string) => invoke<CountsDto>("counts", { today }),
```

`src/api/events.ts` の `onProjectChanged` を:

```ts
/** `project-changed` carries `{ name, reason }`. */
export function onProjectChanged(cb: (name: string, reason: ChangeReason) => void): () => void {
  return subscribe<{ name: string; reason: ChangeReason }>("project-changed", (p) => cb(p.name, p.reason));
}
```

`useProject.ts` の購読 (`onProjectChanged((n) => …)`) はシグネチャ上そのまま動く (第 2 引数を無視)。

- [ ] **Step 6: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src/types/model.ts src/api/client.ts src/api/events.ts
git commit -m "feat(commands): cross-project views, labels, search, counts"
```

---

### Task 5: UI — `useCrossView`、今日 / 近日 / ラベル詳細を実データに接続

**Files:**
- Create: `src/app/useCrossView.ts`, `src/app/dates.ts`
- Modify: `src/views/TodayView.tsx`, `src/views/UpcomingView.tsx`, `src/views/LabelDetailView.tsx`, `src/app/Main.tsx`, `src/views/Sidebar.tsx` (nav 型に `label`)

**Interfaces:**
- Consumes: Task 4 の `api.*`、`onProjectChanged`、`onSaveStatus`、Phase 1 の `api.completeTask / updateTask / deleteTask / addTask`
- Produces:
  - `useCrossView<T>(fetch: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; refresh: () => void }` — `project-changed` / `projects-changed` / `save-status: saved` で再取得。連続する再取得は 1 回にまとめる
  - `useCrossActions(refresh, onError)`: `{ toggleDone(t, done), setPriority(t, p), setDue(t, due|null), remove(t), addToInbox(input) }` — 対応する Phase 1 command を `t.project` に対して呼び、成功・失敗どちらでも `refresh()`
  - `src/app/dates.ts`: `addDays(ymd, n)`, `monthStart(ymd)`, `ymdLabel`… は `src/mock/data.ts` の `addDays` / `monthDay` / `weekdayLong` を再 export するだけ (app コードから mock を直接 import しないため)
  - 各 View の追加 props (全部 optional、Storybook は従来どおり): `TodayView { onToggleDone?, onOpenTask?, onAddTask?(title), onReschedule?(due), hiddenProjects?: string[] }`; `UpcomingView { days?: DayGroup[], onExtend?(), onToggleDone?, onOpenTask?, onAddTask?(date, title), onJumpMonth?(ymd), onJumpToday?() }`; `LabelDetailView { today?, onToggleDone?, onOpenTask?, onAddTask?(title) }`
  - `Nav` (Sidebar `active`) に `{ kind: "label"; name: string }` を足す。`isActive("labels")` は `kind === "labels" || kind === "label"`

- [ ] **Step 1: `useCrossView.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api/client";
import { onProjectChanged, onProjectsChanged, onSaveStatus } from "../api/events";
import type { Task, TaskInput } from "../types/model";

/**
 * One cross-project view (今日 / 近日 / ラベル詳細). `fetch` is re-run when `deps` change, when any project changes
 * (`project-changed`, `projects-changed`, a finished save), and on `refresh()`. Overlapping requests are coalesced:
 * while one is in flight, further triggers mark it stale and one more fetch runs after it. Late responses are dropped.
 */
export function useCrossView<T>(fetch: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);
  const inFlight = useRef(false);
  const stale = useRef(false);
  const fetchRef = useRef(fetch);
  fetchRef.current = fetch;

  const run = useCallback(async () => {
    if (inFlight.current) {
      stale.current = true;
      return;
    }
    inFlight.current = true;
    const g = gen.current;
    try {
      const v = await fetchRef.current();
      if (g === gen.current) {
        setData(v);
        setError(null);
      }
    } catch (e) {
      if (g === gen.current) setError(errorMessage(e));
    } finally {
      inFlight.current = false;
      if (stale.current) {
        stale.current = false;
        void run();
      }
    }
  }, []);

  useEffect(() => {
    gen.current += 1;
    setData(null);
    setError(null);
    void run();
    return () => {
      gen.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => onProjectChanged(() => void run()), [run]);
  useEffect(() => onProjectsChanged(() => void run()), [run]);
  useEffect(() => onSaveStatus((s) => s.state === "saved" && void run()), [run]);

  return { data, error, refresh: run };
}

/** Task operations from a cross-project list: each calls the Phase 1 command for `t.project`, then refreshes. */
export function useCrossActions(refresh: () => void, onError: (e: unknown) => void, inbox: string) {
  const wrap = useCallback(
    async (call: () => Promise<unknown>) => {
      try {
        await call();
      } catch (e) {
        onError(e);
      } finally {
        refresh();
      }
    },
    [refresh, onError],
  );
  return {
    toggleDone: (t: Task, done: boolean) => wrap(() => api.completeTask(t.project, t.no, done)),
    setPriority: (t: Task, priority: 1 | 2 | 3 | 4) => wrap(() => api.updateTask(t.project, t.no, { priority })),
    setDue: (t: Task, due: string | null) => wrap(() => api.updateTask(t.project, t.no, { due, dueTime: due ? undefined : null })),
    remove: (t: Task) => wrap(() => api.deleteTask(t.project, t.no)),
    addToInbox: (input: TaskInput) => wrap(() => api.addTask(inbox, input)),
  };
}
```

`src/api/events.ts` に `onProjectsChanged(cb: () => void)` を足す (`subscribe<Record<string, never>>("projects-changed", () => cb())`)。Rust 側の emit は Task 9 で入るが、購読だけ先に用意する。

- [ ] **Step 2: `TodayView` に props を足す**

`TodayViewProps` を:

```ts
export type TodayViewProps = {
  tasks: Task[];
  today: string;
  hideOverdue?: boolean;
  // ---- 実アプリ用 (全部 optional。無ければ Storybook と同じ見た目だけの挙動) ----
  /** 渡すとチェックはこれを呼ぶ。完了状態は task.progress から決まる (完了直後 400ms は行を残す)。 */
  onToggleDone?: (t: Task, done: boolean) => void;
  onOpenTask?: (t: Task) => void;
  /** 渡すと「タスクを追加」行がインライン入力を開く。受信トレイに期限 = today で追加する。 */
  onAddTask?: (title: string) => void;
  /** 渡すと「再スケジュール」が日付ピッカーを開き、選んだ日でこれを呼ぶ。 */
  onReschedule?: (due: string) => void;
  /** 読み込めなかったプロジェクト名。1 行の注記を出す (仕様 §7)。 */
  hiddenProjects?: string[];
  /** 行フォーカス (Task 8)。 */
  focusedKey?: string;
};
```

実装の変更点:
- `const { isDone, toggle } = useDone();` は `onToggleDone` が無いときだけ使う: `const done = (t: Task) => (onToggleDone ? t.progress === 100 || leaving.has(key(t)) : isDone(t))`。`leaving` と 400ms の退場は `ProjectView` の `LEAVE_DELAY_MS` と同じ仕組み (`useState<Set<string>>`、キーは `${t.project}/${t.no}`、`window.setTimeout` を unmount で `clearTimeout`)
- 行は `<AnimatePresence initial={false}>` + `<Collapse key={key(t)}>` (`src/motion.tsx` の `Collapse`。`ProjectView` の行と同じ) で包む
- 「再スケジュール」ボタン: `onReschedule` があるとき `useState<boolean>` でポップオーバーを開き、`<DatePicker today={today} value={today} onChange={(v) => { if (v.date) { onReschedule(v.date); setOpen(false); } }} />` を `position: absolute; right: 0; top: 100%; zIndex: 10` の `motion.div` (`y: 8 → 0`、`t(0.15)`) で出す。`useEscLayer(open, () => setOpen(false))` と外側クリックで閉じる (`HeaderActions.tsx` の `MoreMenu` と同じ `mousedown` 判定)
- `AddTaskRow`: `onAddTask` があるとき `ProjectView` と同じ `SubtaskForm` のインライン入力を出す (`ProjectView` の「タスクを追加」の実装をそのまま写す: `const [adding, setAdding] = useState(false)`、`SubtaskForm` に `onSubmit={(title) => { onAddTask(title); setAdding(false); }}` `onCancel={() => setAdding(false)}`、`initialTitle=""`)
- `hiddenProjects` があり空でなければ、PageHeader の下に `<div style={{ fontSize: 13, color: "var(--color-text-secondary)", padding: "4px 0" }}>「{names.join("」「")}」は読み込めていません (サイドバーから開いて確認)</div>`
- `TaskRow` に `onClick={onOpenTask ? () => onOpenTask(t) : undefined}` と `focused={focusedKey === key(t)}` (Task 8 で TaskRow に `focused` が入るまでは渡さない)

- [ ] **Step 3: `UpcomingView` に props を足す**

```ts
export type UpcomingViewProps = {
  tasks: Task[];
  today: string;
  // ---- 実アプリ用 ----
  /** 渡すとこのグループ (Rust の upcoming_view) をそのまま表示し、tasks は使わない。 */
  days?: DayGroup[];
  /** 「さらに 7 日」。渡さないとボタンは出ない。 */
  onExtend?: () => void;
  /** 月セレクトで月を選んだ (その月の 1 日の YYYY-MM-DD)。「今日」は today を渡す。 */
  onJumpTo?: (from: string) => void;
  onToggleDone?: (t: Task, done: boolean) => void;
  onOpenTask?: (t: Task) => void;
  /** 各日の「タスクを追加」。受信トレイにその日を期限として追加する。 */
  onAddTask?: (date: string, title: string) => void;
  hiddenProjects?: string[];
  focusedKey?: string;
};
```

実装:
- `groups` は `days` があれば `days.map((d) => d.date)`、無ければ従来の 4 日。各日の rows は `days` があればそのグループの `tasks`、無ければ従来のフィルタ
- 月セレクト: `onJumpTo` があるとき、ボタンで `useState` のメニューを開く (`role="menu"`、`MoreMenu` と同じ外観)。項目: 「今日」(`onJumpTo(today)`)、続けて今月から 12 か月 (`YYYY年M月`、`onJumpTo(monthStart)`。今月は `today` を渡す)。`addDays` / 月計算は `src/app/dates.ts` の `monthStart(ymd, offsetMonths)` を使う:

```ts
export function monthStart(ymd: string, offsetMonths: number): string {
  const [y, m] = ymd.split("-").map(Number);
  const d = new Date(y, m - 1 + offsetMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
```

- `WeekStrip` の `start` は `days?.[0]?.date ?? today`。`onSelect={(ymd) => document.getElementById(`day-${ymd}`)?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" })}`。各 `<section id={`day-${ymd}`}>`
- 末尾に `onExtend` があれば `<Button variant="secondary" onClick={onExtend}>さらに 7 日</Button>` (中央寄せ、`padding: var(--space-4) 0`)。`days.length >= 91` なら出さない
- 行・追加行・400ms 退場は TodayView と同じ

- [ ] **Step 4: `LabelDetailView` に props を足す**

```ts
export type LabelDetailViewProps = {
  label: string;
  tasks: Task[];
  today?: string;
  onToggleDone?: (t: Task, done: boolean) => void;
  onOpenTask?: (t: Task) => void;
  /** 受信トレイにこのラベルを付けて追加する。 */
  onAddTask?: (title: string) => void;
  hiddenProjects?: string[];
  focusedKey?: string;
};
```

`onToggleDone` があるときはフィルタをしない (Rust が絞っている) 。無いときは従来どおり。`dateLabel(t.due, today ?? TODAY)`。

- [ ] **Step 5: `Sidebar` の nav 型**

`SidebarProps["active"]` を `{ kind: "inbox" | "today" | "upcoming" | "labels" | "project" | "label"; name?: string }` に。`isActive("labels")` の判定に `kind === "label"` を含める。`onSearch?: () => void` を足し、「検索」の `SidebarItem` に `onClick={onSearch}` を渡す (Task 7 で使う)。

- [ ] **Step 6: `Main.tsx` の配線**

- `placeholder` を消し、`nav.kind` ごとに body を分ける。`today` / `upcoming` / `labels` / `label` のとき `useProject` は受信トレイを読み続ける (`current = app.inbox`) ので従来の `p` はそのまま使える
- 今日:

```tsx
const todayData = useCrossView(() => api.todayView(today), [nav.kind === "today", today]);
const cross = useCrossActions(() => { todayData.refresh(); upcomingData.refresh(); labelData.refresh(); void refreshSummaries(); }, showError, app.inbox);
```

`nav.kind !== "today"` のときは fetch しないよう、`useCrossView` の `fetch` を `nav.kind === "today" ? () => api.todayView(today) : () => Promise.resolve(null)` にする (同様に他 2 つ)。
  body: `<TodayView tasks={[...d.overdue, ...d.today]} today={today} hideOverdue={d.overdue.length === 0} onToggleDone={cross.toggleDone} onOpenTask={openCross} onAddTask={(title) => void cross.addToInbox({ title, due: today })} onReschedule={(due) => void api.rescheduleOverdue(today, due).then(() => todayData.refresh()).catch(showError)} hiddenProjects={failed} />`。`failed = summaries.filter((s) => s.loadError).map((s) => s.name)`
- 近日: `const [upFrom, setUpFrom] = useState(today); const [upDays, setUpDays] = useState(7);` 、`useCrossView(() => api.upcomingView(upFrom, upDays), [nav.kind === "upcoming", upFrom, upDays])`。`onExtend={() => setUpDays((d) => Math.min(91, d + 7))}`、`onJumpTo={(from) => { setUpFrom(from); setUpDays(7); }}`、`onAddTask={(date, title) => void cross.addToInbox({ title, due: date })}`。nav が `upcoming` から離れたら `upFrom` を `today` に戻す
- ラベル詳細 (`nav.kind === "label"`): `useCrossView(() => api.labelView(nav.name), [nav.kind === "label", nav.name])`、`onAddTask={(title) => void cross.addToInbox({ title, labels: [nav.name] })}`
- 横断ビューからタスクを開く: `openCross = (t: Task) => navigate({ kind: "project", name: t.project }) ` のあと `setOpenNo(t.no)` (navigate は `setOpenNo(null)` するので、`navigate` の後に呼ぶ。`useProject` が読み終わるまで `openTask` は undefined でパネルは出ない。読み終わると出る)
- サイドバーの件数: `const countsData = useCrossView(() => api.counts(today), [today]);` → `counts.today = countsData.data?.today ?? 0`。`refreshSummaries` 内でも `countsData.refresh()` を呼ぶ
- `labels` ビューは Task 6 までは従来のプレースホルダのまま

- [ ] **Step 7: 確認**

Run: `npx tsc --noEmit && npm run build && npm run build-storybook && npm run check:stories`
Expected: すべて成功、`missing: none`。

手動: `npm run tauri dev` で起動し、受信トレイに期限 = 今日と期限切れのタスクを作る → 「今日」に出る、件数が合う。「再スケジュール」で明日を選ぶと期限切れが消える。「近日」で「さらに 7 日」が増え、月セレクトで翌月の 1 日から表示。横断ビューでチェックすると 400ms 後に消え、Excel ファイルに反映。

- [ ] **Step 8: Commit**

```bash
git add src/app src/views/TodayView.tsx src/views/UpcomingView.tsx src/views/LabelDetailView.tsx src/views/Sidebar.tsx src/api/events.ts
git commit -m "feat(ui): today, upcoming and label views on real data"
```

---

### Task 6: UI — ラベル一覧の管理 (追加 / 改名 / 色 / 削除)

**Files:**
- Modify: `src/views/LabelsView.tsx`, `src/app/Main.tsx`
- Create: `src/views/LabelMenu.tsx`

**Interfaces:**
- Consumes: `api.labels / addLabel / updateLabel / renameLabel / deleteLabel`, `confirmAction`, `InlineEdit` (Phase 1 の `src/views/InlineEdit.tsx`。props を読んで使う)
- Produces: `LabelsViewProps` の追加 props (optional): `onOpenLabel?(name)`, `onAddLabel?(name)`, `onRenameLabel?(name, newName)`, `onChangeColor?(name, color)`, `onDeleteLabel?(name)`, `onAddFilter?()`, `palette?: string[]`

- [ ] **Step 1: `LabelMenu.tsx`**

ラベル行の右端「その他」(Ellipsis) のポップオーバー。`HeaderActions.tsx` の `MoreMenu` を基に、項目「名前を変更」「色」(パレットの丸 5 個を横並び、`aria-label` に CSS 変数名)、「削除」(danger)。props: `{ palette: string[]; color: string; onRename(): void; onColor(c: string): void; onDelete(): void }`。`useEscLayer` と外側クリックで閉じる。ホバー時のみ表示 (`TaskRow` の操作アイコンと同じ `opacity` 120ms、`:focus-within` では常に表示)。

- [ ] **Step 2: `LabelsView` の変更**

- `Item` に `onClick`, `trailing?: React.ReactNode` (メニュー) を足す。ラベルの `Item` は `onClick={() => onOpenLabel?.(l.name)}`
- 「ラベル」グループの「+」: `onAddLabel` があれば入力欄 (Sidebar のプロジェクト追加と同じ `InlineEdit`、placeholder「ラベル名」、Enter で `onAddLabel(name)`、Esc で閉じる) を一覧の先頭に出す
- 改名: メニューの「名前を変更」でその行を `InlineEdit` にし、確定で `onRenameLabel(name, newName)`
- 「フィルター」グループの「+」: `onAddFilter` があれば呼ぶ (Main は `setFlash({ text: "フィルターは Phase 5 で実装します", tone: "info" })`)
- `counts` は従来どおり props。Storybook の既定値は変えない

- [ ] **Step 3: `Main.tsx` の配線**

```tsx
const labelsData = useCrossView(() => api.labels(), [nav.kind === "labels"]);
…
body = (
  <LabelsView
    labels={labelsData.data?.labels ?? []}
    filters={[]}
    counts={labelsData.data?.counts}
    palette={PALETTE}
    onOpenLabel={(name) => navigate({ kind: "label", name })}
    onAddLabel={(name) => void api.addLabel(name, PALETTE[(labelsData.data?.labels.length ?? 0) % PALETTE.length]).then(labelsData.refresh).catch(showError)}
    onRenameLabel={(name, newName) => void api.renameLabel(name, newName).then(labelsData.refresh).catch(showError)}
    onChangeColor={(name, color) => void api.updateLabel(name, color).then(labelsData.refresh).catch(showError)}
    onDeleteLabel={(name) => void deleteLabel(name)}
    onAddFilter={() => setFlash({ text: "フィルターは Phase 5 で実装します", tone: "info" })}
  />
);
```

`deleteLabel`: `confirmAction(`ラベル「${name}」を削除します。付いているタスクからも外れます。`, { title: "ラベルの削除", okLabel: "削除" })` が true なら `api.deleteLabel(name)` → `labelsData.refresh()`。

- [ ] **Step 4: 確認**

Run: `npx tsc --noEmit && npm run build-storybook && npm run check:stories`
手動: ラベルを追加 → `_PowerToDo.xlsx` のラベルシートに行が増える。タスクに `@食品` を付けて改名 → 両プロジェクトの「ラベル」列が変わる。削除 → 外れる。

- [ ] **Step 5: Commit**

```bash
git add src/views/LabelsView.tsx src/views/LabelMenu.tsx src/app/Main.tsx
git commit -m "feat(ui): label management (add, rename, color, delete)"
```

---

### Task 7: UI — 検索ダイアログ

**Files:**
- Create: `src/views/SearchDialog.tsx`, `src/app/useSearch.ts`
- Modify: `src/app/Main.tsx`, `src/views/Sidebar.tsx` (`onSearch` は Task 5 で追加済み), `src/views/AppShell.tsx` は変更なし (rail の `"search"` を Main で受ける)

**Interfaces:**
- Consumes: `api.search`, `QuickAddDialog` の外観 (スクリム、320→640 幅、`motion` の scale/fade。`QuickAddDialog.tsx` の `open` 時のラッパーを読んで同じ値を使う), `TaskRow`, `useEscLayer`, `isImeKey`
- Produces:
  - `SearchDialogProps = { open: boolean; query: string; onChangeQuery(q): void; includeDone: boolean; onToggleIncludeDone(): void; hits: SearchHit[]; selected: number; onSelect(i): void; onOpen(hit): void; onToggleDone(hit, done): void; onClose(): void; today: string; busy?: boolean }`
  - `useSearch(open: boolean)`: `{ query, setQuery, includeDone, toggleIncludeDone, hits, busy }` — 150ms デバウンスで `api.search(query, includeDone, 50)`、閉じたらリセット、古い応答は捨てる

- [ ] **Step 1: `useSearch.ts`**

```ts
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { SearchHit } from "../types/model";

/** Search state for the dialog: debounced (150 ms) `search` calls; stale responses are dropped; reset on close. */
export function useSearch(open: boolean) {
  const [query, setQuery] = useState("");
  const [includeDone, setIncludeDone] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setIncludeDone(false);
      setHits([]);
      setBusy(false);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!query.trim()) {
      setHits([]);
      setBusy(false);
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    const id = window.setTimeout(() => {
      api
        .search(query, includeDone, 50)
        .then((r) => {
          if (mine === seq.current) setHits(r.hits);
        })
        .catch(() => {
          if (mine === seq.current) setHits([]);
        })
        .finally(() => {
          if (mine === seq.current) setBusy(false);
        });
    }, 150);
    return () => window.clearTimeout(id);
  }, [open, query, includeDone]);

  return { query, setQuery, includeDone, toggleIncludeDone: () => setIncludeDone((v) => !v), hits, busy, refresh: () => setQuery((q) => q) };
}
```

`refresh` はチェック後に結果を取り直すためのもの: `setQuery((q) => q)` では effect が走らないので、代わりに `const [tick, setTick] = useState(0)` を deps に足し `refresh: () => setTick((t) => t + 1)` とする。

- [ ] **Step 2: `SearchDialog.tsx`**

- `QuickAddDialog` と同じスクリム + カード (`motion.div` `initial={{ opacity: 0, scale: 0.96, y: -8 }}`、`t(0.18)`、`AnimatePresence`)。カード幅 640、`maxHeight: 70vh`、結果は縦スクロール
- 上段: 検索アイコン + `<input placeholder="タスクを検索" autoFocus>` + トグル (`Segmented` コンポーネント: 「未完了」「完了を含む」)
- 中段: `hits.map((h, i) => <TaskRow key={`${h.task.project}/${h.task.no}`} title={h.task.title} done={h.task.progress === 100} priority={h.task.priority} project={h.task.project} date={dateLabel(h.task.due, today)} labels={h.task.labels} focused={i === selected} onClick={() => onOpen(h)} onToggleDone={() => onToggleDone(h, h.task.progress !== 100)} />)`。`matched === "note"` のときは `description={h.task.note}` を渡す (TaskRow の既存 prop)
- 空のとき: 入力前は「名前・備考・ラベルを検索します」、結果 0 は「見つかりません」(muted、中央)
- キー: `onKeyDown` で `ArrowDown` / `ArrowUp` は `onSelect` を ±1 (範囲内に clamp)、`Enter` (IME 以外) は `onOpen(hits[selected])`。`useEscLayer(open, onClose)`。`selected` が変わったら `scrollIntoView({ block: "nearest" })`
- `role="dialog" aria-label="検索"`、結果リストは `role="listbox"`、行は `aria-selected`

- [ ] **Step 3: `Main.tsx` の配線**

- `const [searchOpen, setSearchOpen] = useState(false); const search = useSearch(searchOpen); const [searchSel, setSearchSel] = useState(0);` 。`hits` が変わったら `setSearchSel(0)`
- 開く: Sidebar `onSearch`、rail の `"search"`、キー `Cmd/Ctrl+K` と `/` (Task 8 の shortcuts に移すまでは Phase 1 の `q` ハンドラの隣に `if ((e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) …) { e.preventDefault(); setSearchOpen(true); }` を足す)
- `onOpen={(h) => { setSearchOpen(false); openCross(h.task); }}`、`onToggleDone={(h, done) => void api.completeTask(h.task.project, h.task.no, done).then(search.refresh).catch(showError)}`
- overlay に `<SearchDialog … />` を `QuickAddDialog` の次に置く

- [ ] **Step 4: Story**

`src/views/SearchDialog.stories.tsx` (title `Views/SearchDialog`): `open` で `hits` にモック 3 件 (mock の `tasks` から `matched` を付ける)、`selected={1}`。`npm run check:stories` は `Screens/*` だけ数えるので影響なし。

- [ ] **Step 5: 確認**

Run: `npx tsc --noEmit && npm run build && npm run build-storybook && npm run check:stories`
手動: `Cmd+K` → 「ぎゅうにゅう」で「牛乳」が出ない、「ギュウニュウ」で出る。`↓` `Enter` でプロジェクトに移動して詳細が開く。

- [ ] **Step 6: Commit**

```bash
git add src/views/SearchDialog.tsx src/views/SearchDialog.stories.tsx src/app/useSearch.ts src/app/Main.tsx
git commit -m "feat(ui): search dialog (Cmd/Ctrl+K)"
```

---

### Task 8: キーボード操作 (`shortcuts.ts`、行フォーカス、設定の「キーボード」ペイン)

**Files:**
- Create: `src/app/shortcuts.ts`, `src/app/useRowFocus.ts`
- Modify: `src/components/TaskRow.tsx` (`focused?: boolean`), `src/views/ProjectView.tsx`, `src/views/TodayView.tsx`, `src/views/UpcomingView.tsx`, `src/views/LabelDetailView.tsx`, `src/app/Main.tsx`, `src/views/SettingsPanes.tsx` (`KeyboardPane`), `src/views/SettingsDialog.tsx` (ペインの表示)

**Interfaces:**
- Produces:
  - `shortcuts.ts`: `isTypingTarget(e: KeyboardEvent): boolean` (INPUT / TEXTAREA / SELECT / contentEditable / `isImeKey`)、`useShortcuts(handlers: { quickAdd(); search(); goToday(); goUpcoming(); goInbox(); goLabels(); row: RowHandlers | null; enabled: boolean })`。`g` のあと 1 秒以内の `t/u/i/l` を解釈 (`useRef<number>` に `g` の時刻)
  - `RowHandlers = { up(); down(); open(); toggleDone(); remove(); setPriority(p: 1|2|3|4); dueToday(); dueTomorrow(); expand(); collapse(); clear() }`
  - `useRowFocus(keys: string[])`: `{ focusedKey: string | null; move(delta: -1 | 1); clear(); set(key) }` — `keys` は表示順の行キー (`${project}/${no}`)。行が消えたら次の行 (`keys` の変化を `useEffect` で見て、無くなったキーの位置に clamp)
  - `TaskRow.focused?: boolean` → `box-shadow: inset 2px 0 0 var(--color-accent)` + ホバー背景と同じ `background`
  - 各リスト view の props に `focusedKey?: string`、`onVisibleKeys?(keys: string[])` (表示順の行キーを親に通知。`useEffect` で変化時だけ呼ぶ)

- [ ] **Step 1: `shortcuts.ts`**

```ts
import { useEffect, useRef } from "react";
import { isImeKey } from "./keys";

export function isTypingTarget(e: KeyboardEvent): boolean {
  if (isImeKey(e)) return true;
  const t = e.target instanceof HTMLElement ? e.target : null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

export type RowHandlers = {
  up: () => void;
  down: () => void;
  open: () => void;
  toggleDone: () => void;
  remove: () => void;
  setPriority: (p: 1 | 2 | 3 | 4) => void;
  dueToday: () => void;
  dueTomorrow: () => void;
  expand: () => void;
  collapse: () => void;
  clear: () => void;
};

export type ShortcutHandlers = {
  quickAdd: () => void;
  search: () => void;
  goToday: () => void;
  goUpcoming: () => void;
  goInbox: () => void;
  goLabels: () => void;
  /** null while no list is on screen. */
  row: RowHandlers | null;
  /** false while a dialog is open (its own keys win). */
  enabled: boolean;
};

const G_TIMEOUT_MS = 1000;

/** One window keydown listener for every shortcut in 仕様 §6. Handlers may change every render. */
export function useShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  const gAt = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = ref.current;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (h.enabled) h.search();
        return;
      }
      if (!h.enabled || isTypingTarget(e) || meta || e.altKey) return;
      const key = e.key;
      const now = Date.now();
      if (now - gAt.current < G_TIMEOUT_MS) {
        gAt.current = 0;
        const go = { t: h.goToday, u: h.goUpcoming, i: h.goInbox, l: h.goLabels }[key.toLowerCase()];
        if (go) {
          e.preventDefault();
          go();
          return;
        }
      }
      const r = h.row;
      const act: Record<string, (() => void) | undefined> = {
        q: h.quickAdd,
        "/": h.search,
        g: () => {
          gAt.current = now;
        },
        ArrowUp: r?.up,
        ArrowDown: r?.down,
        Enter: r?.open,
        e: r?.toggleDone,
        Delete: r?.remove,
        Backspace: r?.remove,
        "1": () => r?.setPriority(1),
        "2": () => r?.setPriority(2),
        "3": () => r?.setPriority(3),
        "4": () => r?.setPriority(4),
        t: r?.dueToday,
        m: r?.dueTomorrow,
        ArrowRight: r?.expand,
        ArrowLeft: r?.collapse,
      };
      const fn = act[key] ?? act[key.toLowerCase()];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
```

`Esc` は `layers.ts` のまま。レイヤーが無いときの「行フォーカスを外す」は `layers.ts` に `setFallback(fn)` を足して、スタックが空のとき `fallback` を呼ぶ (`pushLayer` と同じファイルに `let fallback: (() => void) | null = null; export function setEscFallback(fn) { fallback = fn; }`、`onKeyDown` で `if (!top) { fallback?.(); return; }`。リスナーは `fallback` が設定されている間も登録しておく: `setEscFallback` で `addEventListener`、`null` で `removeEventListener` (スタックが空のときだけ))。

- [ ] **Step 2: `useRowFocus.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";

/** Keyboard focus over a list of row keys (display order). When the focused row disappears, focus moves to the row now at its index. */
export function useRowFocus(keys: string[]) {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const lastIndex = useRef(-1);

  useEffect(() => {
    if (focusedKey === null) return;
    const i = keys.indexOf(focusedKey);
    if (i >= 0) {
      lastIndex.current = i;
      return;
    }
    if (keys.length === 0) {
      setFocusedKey(null);
      return;
    }
    setFocusedKey(keys[Math.min(lastIndex.current, keys.length - 1)]);
  }, [keys, focusedKey]);

  const move = useCallback(
    (delta: -1 | 1) => {
      if (keys.length === 0) return;
      const i = focusedKey === null ? (delta === 1 ? 0 : keys.length - 1) : Math.max(0, Math.min(keys.length - 1, keys.indexOf(focusedKey) + delta));
      setFocusedKey(keys[i]);
    },
    [keys, focusedKey],
  );

  const clear = useCallback(() => setFocusedKey(null), []);
  return { focusedKey, move, clear, set: setFocusedKey };
}
```

- [ ] **Step 3: `TaskRow.focused`**

`TaskRowProps` に `focused?: boolean`。ルート要素に `aria-current={focused ? "true" : undefined}` と、`focused` のとき `boxShadow: "inset 2px 0 0 var(--color-accent)"` と `background: "var(--color-bg-hover)"` (既存のホバー用クラスがあれば `className` に追加する形で、インライン `background` で hover クラスを潰さない。Phase 0.5 で「インライン background がホバーを潰す」問題があったので、`focused` は `className` に `bg-[var(--color-bg-hover)]` を足す)。`focused` のとき操作アイコンも表示 (ホバーと同じ)。

- [ ] **Step 4: 各 view に `focusedKey` / `onVisibleKeys`**

`ProjectView`: 表示順 (セクション順 → 未完了 → 展開中のサブタスク → 完了 (表示中のとき)) のキー配列を `useMemo` で作り、`useEffect(() => onVisibleKeys?.(keys), [keys])`。行に `focused={focusedKey === key}`。`→` / `←` 用に `onExpandKey?(key)` / `onCollapseKey?(key)` を足す (既存の expanded state をキーで操作する関数を公開する。`ProjectView` は `expanded: Set<number>` を持っているので、`useImperativeHandle` は使わず、props `expandedOverride?` にしない。代わりに `onVisibleKeys` と同様に `onExpandApi?(api: { expand(no), collapse(no) })` を `useEffect` で 1 回渡す)。
`TodayView` / `UpcomingView` / `LabelDetailView`: 同じく `keys` を通知、`focused` を渡す。

- [ ] **Step 5: `Main.tsx` の配線**

```tsx
const [visibleKeys, setVisibleKeys] = useState<string[]>([]);
const focus = useRowFocus(visibleKeys);
const focusedTask = useMemo(() => findTaskByKey(focus.focusedKey), [focus.focusedKey, view, todayData.data, upcomingData.data, labelData.data]);
```

`findTaskByKey`: 今の nav に応じて `view.tasks` / `todayData` / `upcomingData.days[].tasks` / `labelData.tasks` から `${project}/${no}` が一致する Task を返す。

```tsx
const row: RowHandlers | null = visibleKeys.length
  ? {
      up: () => focus.move(-1),
      down: () => focus.move(1),
      open: () => focusedTask && openAny(focusedTask),
      toggleDone: () => focusedTask && void actOn(focusedTask, (t) => api.completeTask(t.project, t.no, t.progress !== 100)),
      remove: () => focusedTask && void deleteAny(focusedTask),
      setPriority: (p) => focusedTask && void actOn(focusedTask, (t) => api.updateTask(t.project, t.no, { priority: p })),
      dueToday: () => focusedTask && void actOn(focusedTask, (t) => api.updateTask(t.project, t.no, { due: today })),
      dueTomorrow: () => focusedTask && void actOn(focusedTask, (t) => api.updateTask(t.project, t.no, { due: addDays(today, 1) })),
      expand: () => focusedTask && expandApi?.expand(focusedTask.no),
      collapse: () => focusedTask && expandApi?.collapse(focusedTask.no),
      clear: focus.clear,
    }
  : null;
useShortcuts({ quickAdd: openQuickAdd, search: () => setSearchOpen(true), goToday: () => navigate({ kind: "today" }), goUpcoming: () => navigate({ kind: "upcoming" }), goInbox: () => navigate({ kind: "inbox" }), goLabels: () => navigate({ kind: "labels" }), row, enabled: !qa.open && !searchOpen && !settingsOpen });
```

- `actOn(t, call)`: `nav.kind === "project"` なら `p.*` (useProject) 経由で view が更新されるので、`t.project === current` のときは `p.completeTask(t.no, …)` 等を使い、それ以外は `api.*` を呼んでから `cross` の refresh を呼ぶ
- `deleteAny`: `confirmAction(`「${t.title}」を削除します。`, { title: "タスクの削除", okLabel: "削除" })` → 削除
- `openAny`: `t.project === current` なら `setOpenNo(t.no)`、違えば `openCross(t)`
- 行クリックで詳細を開いたらその行を `focus.set(key)`。`navigate` で `focus.clear()`
- Phase 1 の `q` 用 `useEffect` と Task 7 で足した `Cmd+K` の仮ハンドラは削除し、`useShortcuts` に一本化
- `setEscFallback(focus.clear)` を `useEffect` で登録 (unmount で `null`)

- [ ] **Step 6: 設定の「キーボード」ペイン**

`SettingsPanes.tsx` に `KeyboardPane` (表: キー / 動作。仕様 §6 の表をそのまま。`<kbd>` 風の小さな枠: `border: 1px solid var(--color-border); borderRadius: 4; padding: 0 6px; fontFamily: var(--font-mono, monospace); fontSize: 12`)。`SettingsDialog` のペイン一覧に既存の `"keyboard"` 項目があればそれに `KeyboardPane` を表示する。Storybook の D-09 系が「キーボード」を初期表示しないことを確認 (初期ペインは変えない)。

- [ ] **Step 7: 確認**

Run: `npx tsc --noEmit && npm run build && npm run build-storybook && npm run check:stories`
手動: `↓` で 1 行目にフォーカス枠、`e` で完了、`1` で p1、`t` で今日、`Delete` で確認ダイアログ、`g t` で今日ビュー、`/` で検索、入力欄にいるときは無効、`Esc` でフォーカス解除。

- [ ] **Step 8: Commit**

```bash
git add src/app src/components/TaskRow.tsx src/views
git commit -m "feat(ui): keyboard shortcuts and row focus"
```

---

### Task 9: 外部変更の監視 (Rust: `store/external.rs`、`store/watcher.rs`、command、イベント)

**Files:**
- Create: `src-tauri/src/store/external.rs`, `src-tauri/src/store/watcher.rs`
- Modify: `src-tauri/Cargo.toml` (`notify = "8.2"`), `src-tauri/src/store/mod.rs`, `src-tauri/src/store/project_store.rs` (`last_written` の記録、`held` 集合), `src-tauri/src/commands/mod.rs` (監視の開始・付け替え、イベント、`resolve_external_change`, `quit`), `src-tauri/src/commands/saver.rs` (`cancel(key)`), `src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `store::external`: `pub struct Fingerprint { pub len: u64, pub mtime: Option<SystemTime> }`, `pub fn fingerprint(path: &Path) -> Option<Fingerprint>`, `pub enum FileKind { Project(String), Common, Ignore }`, `pub fn classify_path(paths: &Paths, path: &Path) -> FileKind`, `pub enum Verdict { OwnWrite, Changed, Removed }`, `pub fn verdict(recorded: Option<&Fingerprint>, current: Option<Fingerprint>) -> Verdict`
  - `ProjectStore`: `pub fn record_written(&mut self, key: &str, path: &Path)` (save / save_common / create / rename の直後に呼ぶ), `pub fn recorded(&self, key: &str) -> Option<&Fingerprint>`, `pub fn is_held(&self, name: &str) -> bool`, `pub fn hold(&mut self, name: &str)`, `pub fn release(&mut self, name: &str)`, `pub fn held_projects(&self) -> Vec<String>`, `pub fn mark_missing(&mut self, name: &str)`, `pub fn adopt_new_file(&mut self, name: &str) -> AppResult<ProjectSummary>`, `pub fn reload_common(&mut self) -> AppResult<()>`
  - `store::watcher`: `pub struct Watcher` (`notify::RecommendedWatcher` + デバウンススレッド), `pub fn start(dir: &Path, on_paths: impl Fn(Vec<PathBuf>) + Send + 'static) -> AppResult<Watcher>` (500ms デバウンス、パスで重複排除), `Drop` で停止
  - `Saver::cancel(&self, key: &str)`, `Saver::is_pending(&self, key: &str) -> bool`
  - イベント: `external-change { project }` (`"_common"` も), `projects-changed {}`, `project-changed { reason: "external" }`
  - command: `resolve_external_change { project, action: "reload" | "overwrite" } -> ProjectView | null` (`_common` のときは null), `held_projects -> string[]`, `quit`
  - 終了: `RunEvent::ExitRequested` で `held_projects` が空でなければ `api.prevent_exit()` して `exit-blocked { projects }` を emit。UI が解決して `quit` を呼ぶ

- [ ] **Step 1: 純関数のテスト (`external.rs`)**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, UNIX_EPOCH};

    fn paths() -> Paths {
        Paths::new("/data")
    }

    #[test]
    fn classify_ignores_lock_and_temp_files() {
        let p = paths();
        assert!(matches!(classify_path(&p, Path::new("/data/~$受信トレイ.xlsx")), FileKind::Ignore));
        assert!(matches!(classify_path(&p, Path::new("/data/.~lock.受信トレイ.xlsx#")), FileKind::Ignore));
        assert!(matches!(classify_path(&p, Path::new("/data/.受信トレイ.xlsx.tmp1234")), FileKind::Ignore));
        assert!(matches!(classify_path(&p, Path::new("/data/memo.txt")), FileKind::Ignore));
        assert!(matches!(classify_path(&p, Path::new("/data/archive/x.xlsx")), FileKind::Ignore));
        assert!(matches!(classify_path(&p, Path::new("/data/_PowerToDo.xlsx")), FileKind::Common));
        match classify_path(&p, Path::new("/data/仕事.xlsx")) {
            FileKind::Project(n) => assert_eq!(n, "仕事"),
            _ => panic!(),
        }
    }

    #[test]
    fn verdict_tells_own_write_from_external_change() {
        let t0 = UNIX_EPOCH + Duration::from_secs(1_000);
        let rec = Fingerprint { len: 10, mtime: Some(t0) };
        assert!(matches!(verdict(Some(&rec), Some(Fingerprint { len: 10, mtime: Some(t0) })), Verdict::OwnWrite));
        assert!(matches!(verdict(Some(&rec), Some(Fingerprint { len: 11, mtime: Some(t0) })), Verdict::Changed));
        assert!(matches!(verdict(Some(&rec), Some(Fingerprint { len: 10, mtime: Some(t0 + Duration::from_secs(2)) })), Verdict::Changed));
        assert!(matches!(verdict(None, Some(Fingerprint { len: 10, mtime: Some(t0) })), Verdict::Changed));
        assert!(matches!(verdict(Some(&rec), None), Verdict::Removed));
    }
}
```

`Paths` の実際のテンポラリ名規則は `paths::write_atomic` を読んで合わせる (先頭 `.` か、拡張子 `.tmp…`)。`adoptable_stem` (`project_store.rs`) と同じ判定を `classify_path` から再利用する (`pub(super)` にして呼ぶ)。

- [ ] **Step 2: 失敗を確認**

Run: `cargo test --manifest-path src-tauri/Cargo.toml external`
Expected: コンパイルエラー。

- [ ] **Step 3: `external.rs` の実装**

```rust
//! Telling an external edit (Excel saved the file) from our own write-back (仕様 §5.1).

use std::path::Path;
use std::time::SystemTime;

use super::common_book::COMMON_FILE;
use super::paths::Paths;
use super::project_store::adoptable_stem;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fingerprint {
    pub len: u64,
    pub mtime: Option<SystemTime>,
}

pub fn fingerprint(path: &Path) -> Option<Fingerprint> {
    let m = std::fs::metadata(path).ok()?;
    Some(Fingerprint {
        len: m.len(),
        mtime: m.modified().ok(),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileKind {
    Project(String),
    Common,
    Ignore,
}

/// Only files directly in the data folder count; lock files, temp files, other extensions and
/// `archive/` are ignored.
pub fn classify_path(paths: &Paths, path: &Path) -> FileKind {
    if path.parent() != Some(paths.data_dir.as_path()) {
        return FileKind::Ignore;
    }
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return FileKind::Ignore;
    };
    if name == COMMON_FILE {
        return FileKind::Common;
    }
    match adoptable_stem(path) {
        Some(stem) => FileKind::Project(stem),
        None => FileKind::Ignore,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    OwnWrite,
    Changed,
    Removed,
}

pub fn verdict(recorded: Option<&Fingerprint>, current: Option<Fingerprint>) -> Verdict {
    match (recorded, current) {
        (_, None) => Verdict::Removed,
        (Some(r), Some(c)) if *r == c => Verdict::OwnWrite,
        _ => Verdict::Changed,
    }
}
```

`project_store.rs`: フィールド `last_written: BTreeMap<String, Fingerprint>` と `held: BTreeSet<String>` を足し、`open` で空に初期化。`save()` 成功直後に `self.record_written(name, &path)`、`save_common()` 成功直後に `self.record_written(COMMON_KEY 相当の "_common", &self.paths.common())`、`create_project` / `rename_project` でファイルを書いた直後にも記録。`load_from_disk` 成功直後にも記録 (読んだ直後のファイルは「自分が知っている状態」)。`adoptable_stem` を `pub(super)`。追加メソッド:

```rust
    pub fn record_written(&mut self, key: &str, path: &Path) {
        match super::external::fingerprint(path) {
            Some(f) => {
                self.last_written.insert(key.to_string(), f);
            }
            None => {
                self.last_written.remove(key);
            }
        }
    }
    pub fn recorded(&self, key: &str) -> Option<&super::external::Fingerprint> {
        self.last_written.get(key)
    }
    pub fn is_held(&self, name: &str) -> bool { self.held.contains(name) }
    pub fn hold(&mut self, name: &str) { self.held.insert(name.to_string()); }
    pub fn release(&mut self, name: &str) { self.held.remove(name); }
    pub fn held_projects(&self) -> Vec<String> { self.held.iter().cloned().collect() }

    /// The file disappeared under us (deleted or moved to archive by hand).
    pub fn mark_missing(&mut self, name: &str) {
        if self.books.contains_key(name) {
            self.dirty.remove(name);
            self.books.insert(name.to_string(), LoadedProject::Failed("ファイルが見つかりません".into()));
        }
    }

    /// A new `<name>.xlsx` appeared: list it in the common workbook and load it.
    pub fn adopt_new_file(&mut self, name: &str) -> AppResult<ProjectSummary> {
        if !self.common.projects.iter().any(|p| p.name == name) {
            let order = self.next_project_order();
            self.common.projects.push(Project { name: name.into(), color: DEFAULT_COLOR.into(), order, favorite: false, inbox: false });
            self.common_dirty = true;
        }
        let loaded = self.load_from_disk(name);
        self.books.insert(name.to_string(), loaded);
        let p = self.common.projects.iter().find(|p| p.name == name).cloned().expect("just inserted");
        Ok(self.summary(&p))
    }

    /// Re-reads the common workbook (labels, colors, holidays, settings). Projects listed in the
    /// file but not loaded are loaded; projects loaded but not listed are kept and re-listed.
    pub fn reload_common(&mut self) -> AppResult<()> {
        let fresh = read_common_book(&self.paths.common())?;
        let known: Vec<Project> = self.common.projects.iter().filter(|p| !fresh.projects.iter().any(|f| f.name == p.name)).cloned().collect();
        self.common = fresh;
        if !known.is_empty() {
            self.common.projects.extend(known);
            self.common_dirty = true;
        }
        self.adopt_unlisted();
        let names: Vec<String> = self.common.projects.iter().map(|p| p.name.clone()).filter(|n| !self.books.contains_key(n)).collect();
        for name in names {
            let loaded = self.load_from_disk(&name);
            self.books.insert(name, loaded);
        }
        let holidays = self.common.holidays.clone();
        for b in self.books.values_mut() {
            if let LoadedProject::Ok(book) = b {
                recompute_days(book, &holidays);
            }
        }
        self.record_written("_common", &self.paths.common());
        Ok(())
    }
```

`store/mod.rs` に `pub mod external; pub mod watcher;`。

- [ ] **Step 4: `watcher.rs`**

```rust
//! Watches the data folder with `notify` and hands over batches of changed paths after a quiet
//! period (仕様 §5.1: 500 ms, de-duplicated by path). Event kinds are not interpreted; the
//! receiver looks at the files' current state.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher as _};

use crate::error::{AppError, AppResult};

pub const QUIET: Duration = Duration::from_millis(500);

pub struct Watcher {
    _inner: RecommendedWatcher,
    stop: mpsc::Sender<()>,
}

impl Drop for Watcher {
    fn drop(&mut self) {
        let _ = self.stop.send(());
    }
}

pub fn start(dir: &Path, on_paths: impl Fn(Vec<PathBuf>) + Send + 'static) -> AppResult<Watcher> {
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let mut inner = RecommendedWatcher::new(tx, notify::Config::default()).map_err(|e| AppError::Io {
        message: format!("ファイル監視を開始できません: {e}"),
    })?;
    inner
        .watch(dir, RecursiveMode::NonRecursive)
        .map_err(|e| AppError::Io {
            message: format!("ファイル監視を開始できません: {e}"),
        })?;
    std::thread::Builder::new()
        .name("powertodo-watch".into())
        .spawn(move || debounce_loop(rx, stop_rx, on_paths))
        .map_err(|e| AppError::Io {
            message: e.to_string(),
        })?;
    Ok(Watcher {
        _inner: inner,
        stop: stop_tx,
    })
}

fn debounce_loop(
    rx: mpsc::Receiver<notify::Result<notify::Event>>,
    stop: mpsc::Receiver<()>,
    on_paths: impl Fn(Vec<PathBuf>),
) {
    let mut pending: BTreeSet<PathBuf> = BTreeSet::new();
    let mut deadline: Option<Instant> = None;
    loop {
        if stop.try_recv().is_ok() {
            return;
        }
        let wait = deadline
            .map(|d| d.saturating_duration_since(Instant::now()))
            .unwrap_or(Duration::from_millis(250));
        match rx.recv_timeout(wait) {
            Ok(Ok(ev)) => {
                pending.extend(ev.paths);
                deadline = Some(Instant::now() + QUIET);
            }
            Ok(Err(_)) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
        if let Some(d) = deadline
            && Instant::now() >= d
            && !pending.is_empty()
        {
            on_paths(std::mem::take(&mut pending).into_iter().collect());
            deadline = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn batches_are_delivered_after_quiet_period() {
        let dir = tempfile::tempdir().unwrap();
        let got: Arc<Mutex<Vec<Vec<PathBuf>>>> = Arc::default();
        let sink = got.clone();
        let _w = start(dir.path(), move |paths| sink.lock().unwrap().push(paths)).unwrap();
        std::thread::sleep(Duration::from_millis(200)); // let the OS watcher settle
        let file = dir.path().join("仕事.xlsx");
        std::fs::write(&file, b"a").unwrap();
        std::fs::write(&file, b"ab").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while got.lock().unwrap().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        let batches = got.lock().unwrap().clone();
        assert_eq!(batches.len(), 1, "two quick writes make one batch: {batches:?}");
        assert!(batches[0].iter().any(|p| p.file_name() == file.file_name()));
    }
}
```

このテストが CI の 3 OS で不安定なら `#[cfg_attr(not(target_os = "macos"), ignore)]` を付ける (仕様 §9)。

- [ ] **Step 5: `Saver::cancel` / `is_pending`**

`saver.rs`:

```rust
    /// Drops the pending timer for `key` (nothing is written until something schedules it again).
    pub fn cancel(&self, key: &str) {
        if let Some(h) = self.lock_pending().remove(key) {
            h.abort();
        }
    }

    pub fn is_pending(&self, key: &str) -> bool {
        self.lock_pending().get(key).is_some_and(|h| !h.is_finished())
    }
```

テスト (既存の `mod tests` のスタイルで): `schedule_with` → `cancel` → 時間を進めても `FakeSink` に保存が来ない。

- [ ] **Step 6: command 側の統合**

`AppState` に `watcher: Mutex<Option<Watcher>>` と `saving: Mutex<BTreeSet<String>>` (保存中のキー) を足す。`TauriSink::save` の前後で `saving` に出し入れする。

```rust
/// Starts (or restarts) watching the store's data folder. Called after `startup` / `switch_data_dir`.
fn start_watching(app: &AppHandle, state: &AppState) {
    let dir = match state.lock_store().as_ref() {
        Some(s) => s.paths().data_dir.clone(),
        None => {
            *state.watcher.lock().unwrap_or_else(|e| e.into_inner()) = None;
            return;
        }
    };
    let handle = app.clone();
    match crate::store::watcher::start(&dir, move |paths| handle_fs_batch(&handle, paths)) {
        Ok(w) => *state.watcher.lock().unwrap_or_else(|e| e.into_inner()) = Some(w),
        Err(e) => {
            eprintln!("watch failed: {e}");
            let _ = app.emit("watch-failed", e.to_string());
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalChange {
    project: String,
}

/// One debounced batch of changed paths (any thread). Decides per file what to do (仕様 §5.2).
fn handle_fs_batch(app: &AppHandle, paths: Vec<PathBuf>) {
    use crate::store::external::{FileKind, Verdict, classify_path, fingerprint, verdict};
    let state = app.state::<AppState>();
    let mut guard = state.lock_store();
    let Some(store) = guard.as_mut() else { return };
    let mut projects_changed = false;
    for path in paths {
        match classify_path(store.paths(), &path) {
            FileKind::Ignore => {}
            FileKind::Common => match verdict(store.recorded(COMMON_KEY), fingerprint(&path)) {
                Verdict::OwnWrite => {}
                Verdict::Removed => {}
                Verdict::Changed => {
                    if store.common_dirty() || state.saver.is_pending(COMMON_KEY) {
                        let _ = app.emit("external-change", ExternalChange { project: COMMON_KEY.into() });
                    } else if let Err(e) = store.reload_common() {
                        let _ = app.emit("save-status", SaveStatus { project: COMMON_KEY.into(), state: saver::SaveState::Error, message: Some(format!("Excel の変更を読み込めません: {e}")) });
                    } else {
                        projects_changed = true;
                    }
                }
            },
            FileKind::Project(name) => {
                let known = store.summaries().iter().any(|p| p.name == name);
                match verdict(store.recorded(&name), fingerprint(&path)) {
                    Verdict::OwnWrite => {}
                    Verdict::Removed if known => {
                        store.mark_missing(&name);
                        projects_changed = true;
                    }
                    Verdict::Removed => {}
                    Verdict::Changed if !known => {
                        if store.adopt_new_file(&name).is_ok() {
                            projects_changed = true;
                        }
                    }
                    Verdict::Changed => {
                        let busy = store.dirty_projects().contains(&name) || state.saver.is_pending(&name) || state.is_saving(&name);
                        if store.is_held(&name) {
                            // already waiting for the user's choice
                        } else if busy {
                            state.saver.cancel(&name);
                            store.hold(&name);
                            let _ = app.emit("external-change", ExternalChange { project: name.clone() });
                        } else {
                            match store.reload_discarding(&name) {
                                Ok(_) => emit_changed(app, &[name.clone()], ChangeReason::External),
                                Err(e) => {
                                    let _ = app.emit("save-status", SaveStatus { project: name.clone(), state: saver::SaveState::Error, message: Some(format!("Excel の変更を読み込めません: {e}")) });
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if projects_changed {
        let _ = app.emit("projects-changed", serde_json::json!({}));
    }
}
```

`state.is_saving(name)` は `saving` 集合の参照。`TauriSink::save` は保存中のキーを `saving` に入れる。

注意: `handle_fs_batch` は `notify` のスレッドから呼ばれ、`lock_store()` を取る。保存 (`TauriSink::save`) もロックを取るので、保存中の書き込みイベントは保存が終わってから判定され、`record_written` が済んでいるので `OwnWrite` になる。

command:

```rust
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolveAction {
    Reload,
    Overwrite,
}

/// The banner's choice for a project (or `_common`) that changed on disk while it had unsaved
/// edits (仕様 §5.3). `reload` drops ours; `overwrite` writes ours now.
#[tauri::command]
pub async fn resolve_external_change(project: String, action: ResolveAction, app: AppHandle, state: State<'_, AppState>) -> AppResult<Option<ProjectView>> {
    let is_common = project == COMMON_KEY;
    let view = with_store(state.inner(), |s| {
        s.release(&project);
        match (action, is_common) {
            (ResolveAction::Reload, true) => s.reload_common().map(|_| None),
            (ResolveAction::Reload, false) => s.reload_discarding(&project).map(Some),
            (ResolveAction::Overwrite, true) => Ok(None),
            (ResolveAction::Overwrite, false) => s.view(&project).map(Some),
        }
    })?;
    if matches!(action, ResolveAction::Overwrite) {
        let sink = Arc::new(TauriSink { app: app.clone() });
        state.saver.save_now(sink, &project).await?;
    }
    if is_common {
        let _ = app.emit("projects-changed", serde_json::json!({}));
    } else {
        emit_changed(&app, &[project], ChangeReason::External);
    }
    Ok(view)
}

#[tauri::command]
pub async fn held_projects(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    with_store(state.inner(), |s| Ok(s.held_projects()))
}

#[tauri::command]
pub async fn quit(app: AppHandle) {
    app.exit(0);
}
```

`TauriSink::save` は `store.is_held(key)` のとき何も書かずに `Ok(())` を返す (帯が出ている間は保存しない)。`flush_all` も held を飛ばす。

`app_state` / `set_data_dir` の末尾で `start_watching(&app, state.inner())`。`switch_data_dir` の前に `watcher` を `None` にする。

`lib.rs`: `generate_handler!` に `resolve_external_change, held_projects, quit` を足す。`app.run` のクロージャ:

```rust
    app.run(|handle, event| match event {
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            // `quit` command exits with code 0 after the user chose; do not block that.
            if code.is_none()
                && let Some(state) = handle.try_state::<AppState>()
            {
                let held = state.lock_store_pub().as_ref().map(|s| s.held_projects()).unwrap_or_default();
                if !held.is_empty() {
                    api.prevent_exit();
                    let _ = handle.emit("exit-blocked", held);
                }
            }
        }
        tauri::RunEvent::Exit => {
            if let Some(state) = handle.try_state::<AppState>() {
                state.flush_all();
            }
        }
        _ => {}
    });
```

`lock_store` は private なので `pub fn held_projects(&self) -> Vec<String>` を `AppState` に足して使う。`ExitRequested` の `code` フィールドは Tauri 2 の `RunEvent::ExitRequested { api, code, .. }` (`code: Option<i32>`、`app.exit(0)` 由来は `Some(0)`)。コンパイルで確認する。

- [ ] **Step 7: 統合テスト (`external.rs` の `mod tests` に追加)**

```rust
    #[test]
    fn external_write_is_detected_and_own_write_is_not() {
        use super::super::paths::Paths;
        use super::super::project_store::ProjectStore;
        use chrono::NaiveDateTime;
        let dir = tempfile::tempdir().unwrap();
        let mut s = ProjectStore::open(Paths::new(dir.path()), NaiveDateTime::default, true).unwrap();
        let path = dir.path().join("受信トレイ.xlsx");
        // our own write
        s.add_task("受信トレイ", crate::domain::TaskInput { title: "a".into(), section: None, priority: None, due: None, due_time: None, note: None, labels: vec![], parent_no: None }).unwrap();
        s.save("受信トレイ").unwrap();
        assert_eq!(verdict(s.recorded("受信トレイ"), fingerprint(&path)), Verdict::OwnWrite);
        // an external program rewrites the file
        std::thread::sleep(std::time::Duration::from_millis(20));
        let mut bytes = std::fs::read(&path).unwrap();
        bytes.push(0); // a longer file is a different fingerprint even on coarse mtime filesystems
        std::fs::write(&path, bytes).unwrap();
        assert_eq!(verdict(s.recorded("受信トレイ"), fingerprint(&path)), Verdict::Changed);
        assert_eq!(verdict(s.recorded("受信トレイ"), fingerprint(&dir.path().join("none.xlsx"))), Verdict::Removed);
    }
```

- [ ] **Step 8: 全テストとビルド**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add src-tauri
git commit -m "feat(store): watch the data folder and tell external edits from own writes"
```

---

### Task 10: UI — 外部変更の帯と終了時の確認

**Files:**
- Create: `src/views/ExternalChangeBanner.tsx`, `src/app/useExternalChanges.ts`
- Modify: `src/api/client.ts`, `src/api/events.ts`, `src/types/model.ts`, `src/app/Main.tsx`, `src/app/App.tsx` (exit-blocked の処理は Main でよい)

**Interfaces:**
- Consumes: `external-change { project }`, `exit-blocked: string[]`, `watch-failed: string`, `api.resolveExternalChange(project, action)`, `api.heldProjects()`, `api.quit()`
- Produces:
  - `ExternalChangeBanner { fileName: string; onReload(); onOverwrite() }` (FixBanner と同じ帯。文言は仕様 §5.3)
  - `useExternalChanges()`: `{ held: string[]; resolve(project, action) }` — 起動時に `api.heldProjects()`、`external-change` で追加、`resolve` 後に削除。`exit-blocked` を受けたら `confirmAction` を 1 回出し、「上書きして終了」なら全件 `overwrite`、「捨てて終了」なら全件 `reload`、キャンセルなら何もしない。その後 `api.quit()`

- [ ] **Step 1: API とイベント**

`client.ts`: `resolveExternalChange: (project: string, action: "reload" | "overwrite") => invoke<ProjectView | null>("resolve_external_change", { project, action })`, `heldProjects: () => invoke<string[]>("held_projects")`, `quit: () => invoke<void>("quit")`。
`events.ts`: `onExternalChange(cb: (project: string) => void)`, `onExitBlocked(cb: (projects: string[]) => void)`, `onWatchFailed(cb: (message: string) => void)`。

- [ ] **Step 2: `ExternalChangeBanner.tsx`**

FixBanner を基に。文言: `「${fileName}」が Excel など別のアプリで変更されました。このアプリの未保存の変更があります。`。ボタン: 「ファイルを読み込む」(secondary) → `onReload`、「このアプリの内容で上書き」(primary) → `onOverwrite`。`fileName` は `_common` のとき「共通設定 (_PowerToDo.xlsx)」、それ以外は `${project}.xlsx`。Story `Views/ExternalChangeBanner`。

- [ ] **Step 3: `useExternalChanges.ts`**

```ts
export function useExternalChanges(onError: (e: unknown) => void) {
  const [held, setHeld] = useState<string[]>([]);
  useEffect(() => {
    api.heldProjects().then(setHeld).catch(() => undefined);
  }, []);
  useEffect(() => onExternalChange((p) => setHeld((h) => (h.includes(p) ? h : [...h, p]))), []);

  const resolve = useCallback(
    async (project: string, action: "reload" | "overwrite") => {
      const ok = await confirmAction(
        action === "reload" ? "このアプリでの変更は失われます。ファイルの内容を読み込みますか？" : "ファイル側の変更は失われます。このアプリの内容で上書きしますか？",
        { title: "外部での変更", okLabel: action === "reload" ? "ファイルを読み込む" : "上書きする" },
      ).catch(() => false);
      if (!ok) return;
      try {
        await api.resolveExternalChange(project, action);
        setHeld((h) => h.filter((p) => p !== project));
      } catch (e) {
        onError(e);
      }
    },
    [onError],
  );

  useEffect(
    () =>
      onExitBlocked(async (projects) => {
        const ok = await confirmAction(
          `${projects.map((p) => `「${p}」`).join("")}に、Excel での変更とこのアプリでの未保存の変更の両方があります。このアプリの内容で上書きして終了しますか？ (キャンセル = 終了しない)`,
          { title: "終了", okLabel: "上書きして終了", cancelLabel: "終了しない" },
        ).catch(() => false);
        if (!ok) return;
        for (const p of projects) await api.resolveExternalChange(p, "overwrite").catch(onError);
        await api.quit();
      }),
    [onError],
  );
  return { held, resolve };
}
```

`ask` はボタンが 2 つしか無いので、仕様の「上書きして終了 / 捨てて終了」は「上書きして終了 / 終了しない」にする (捨てたい人は帯から「ファイルを読み込む」を押してから終了する)。仕様 §5.3 と決定ログに追記する (Task 13)。

- [ ] **Step 4: `Main.tsx`**

- `const ext = useExternalChanges(showError);` 。banner の `AnimatePresence` に `ext.held.map((p) => <Collapse key={`ext-${p}`} …><ExternalChangeBanner fileName={p === "_common" ? "共通設定 (_PowerToDo.xlsx)" : `${p}.xlsx`} onReload={() => void ext.resolve(p, "reload")} onOverwrite={() => void ext.resolve(p, "overwrite")} /></Collapse>)`
- `onProjectChanged((name, reason) => reason === "external" && setFlash({ text: `「${name}」の Excel での変更を取り込みました`, tone: "info" }))`
- `onProjectsChanged(() => { void refreshSummaries(); loadDisplayName(); })`
- `onWatchFailed((m) => setFlash({ text: `ファイルの変更監視を開始できません (${m})。Excel で直した内容は再読み込みで取り込めます`, tone: "error" }))`
- `useProject` も `projects-changed` で読み直す (現在のプロジェクトが消えたかもしれない): `useEffect(() => onProjectsChanged(() => void load(() => api.getProject(name), true)), [name, load])` を `useProject.ts` に足す

- [ ] **Step 5: 確認**

Run: `npx tsc --noEmit && npm run build && npm run build-storybook && npm run check:stories`
手動 (アプリ): (a) アプリでタスクを作って 2 秒待つ → Excel (または `cp`) で `受信トレイ.xlsx` を別の内容で上書き → 2 秒以内に画面が変わり「取り込みました」。(b) アプリでタスク名を編集して 1 秒以内にファイルを外から上書き → 帯が出て、保存されない (`ls -l` の mtime が動かない)。「このアプリの内容で上書き」→ 保存される。(c) 帯が出た状態で Cmd+Q → 確認ダイアログ。(d) `仕事.xlsx` を `archive/` に移す → サイドバーに読み込みエラー。(e) `新規.xlsx` をコピーで作る → サイドバーに増える。

- [ ] **Step 6: Commit**

```bash
git add src/views/ExternalChangeBanner.tsx src/views/ExternalChangeBanner.stories.tsx src/app src/api src/types/model.ts
git commit -m "feat(ui): external change banner and exit confirmation"
```

---

### Task 11: Storybook — 操作できる Story の追加

**Files:**
- Modify: `src/stories/screens/Desktop.stories.tsx`

- [ ] **Step 1: `D-04 今日 (操作)`**

`D-01 追加と完了 (操作)` と同じ方式 (Story 内に `useState` のモック)。`TodayView` に `onToggleDone` (400ms 後に一覧から外す)、`onAddTask` (`no` を採番して今日の期限で追加)、`onReschedule` (期限切れ全件の `due` を選んだ日に)、`onOpenTask` (何もしない) を渡す。`hiddenProjects={["読書"]}` で注記も見せる。

- [ ] **Step 2: `D-05 近日 (操作)`**

`days` をモックから組み立て (`addDays` で 7 日)、`onExtend` で 7 日増やす、`onJumpTo` で `from` を変える。

- [ ] **Step 3: 確認**

Run: `npm run build-storybook && npm run check:stories`
Expected: `missing: none`、`extra:` に新しい 2 件 (と Phase 1 の 1 件)。既存 D-04 / D-05 / D-06 / D-06b の初回描画が変わっていないことをブラウザで目視 (期限切れ 2 件 + 今日 3 件、近日 4 グループ、ラベル 4 件)。

- [ ] **Step 4: Commit**

```bash
git add src/stories/screens/Desktop.stories.tsx
git commit -m "docs(storybook): interactive today and upcoming stories"
```

---

### Task 12: CI (GitHub Actions)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run build
      - run: npm run build-storybook
      - run: npm run check:stories

  rust:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - name: Tauri system dependencies (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - run: cargo test --manifest-path src-tauri/Cargo.toml
      - run: cargo build --manifest-path src-tauri/Cargo.toml
```

`node-version` はローカルの `node --version` のメジャーに合わせる (22 でなければ直す)。`dtolnay/rust-toolchain@stable` は Rust 2024 edition に必要な 1.85 以上を入れる。`Cargo.toml` に `rust-version` があればそれ以上になることを確認。

- [ ] **Step 2: ローカルで同じ手順を通す**

Run: `npm ci && npx tsc --noEmit && npm run build && npm run build-storybook && npm run check:stories && cargo test --manifest-path src-tauri/Cargo.toml && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: 成功。

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: web checks and cargo test/build on ubuntu, windows, macos"
```

push 後に PR の Checks で 3 OS が緑になることを確認する。Windows で `cargo test` が失敗したら (パス区切り、ロック判定)、失敗箇所を直す。それが大きければ `continue-on-error` は使わず、原因を PR 本文に書いて次の PR で直す。

---

### Task 13: ドキュメントと最終確認

**Files:**
- Modify: `README.md` (ショートカット表、外部変更の説明), `docs/superpowers/specs/2026-10-14-phase2-views-design.md` (§5.3 の終了確認を「上書きして終了 / 終了しない」に。決定ログに実装中の決定を追記), `design/storyboard.md` (D-04 / D-05 の確認観点に「操作」Story を追記)

- [ ] **Step 1: README**

「操作」節にキーボードの表 (仕様 §6)。「Excel で直したとき」節: 自動で取り込む、未保存の変更があるときは帯で選ぶ、ロックファイルは無視。

- [ ] **Step 2: 仕様の決定ログに追記**

| 2026-10-xx | 終了時の確認は「上書きして終了 / 終了しない」の 2 択 | `ask` はボタン 2 つ。捨てたい人は帯の「ファイルを読み込む」を押してから終了する |
他に実装中に決めたこと (保存中フラグ `saving`、`load_from_disk` 直後の記録、ラベル名に `@ , 、` を禁止、など) も 1 行ずつ。

- [ ] **Step 3: 最終確認**

```bash
npx tsc --noEmit && npm run build && npm run build-storybook && npm run check:stories
cargo test --manifest-path src-tauri/Cargo.toml && cargo build --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --debug --bundles app
```

アプリで仕様 §1 の成功基準を 1 つずつ確認し、結果を PR 本文の手動チェックリストに書く (できなかった項目はそのまま「未確認」と書く)。

- [ ] **Step 4: Commit と push**

```bash
git add README.md docs design
git commit -m "docs: Phase 2 shortcuts, external changes, decisions"
git push origin feature/phase2-views:refs/heads/feature/phase2-views
```

PR: base `main`、タイトル `feat: Phase 2 (今日 / 近日 / ラベル・検索・キーボード・外部変更の監視・CI)`、本文の先頭に「#17 を先にマージしてください」。手動チェックリストと「未確認」を明記。末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。

---

## Self-Review (作成時に実施)

- 仕様 §3.1 今日 → Task 1, 4, 5。§3.2 近日 → Task 1, 4, 5 (さらに 7 日、月セレクト、週ストリップのスクロール)。§3.3 ラベル → Task 3, 4, 6。§3.4 検索 → Task 2, 4, 7。§3.5 nav と件数 → Task 4, 5。§4 command と `useCrossView` → Task 4, 5。§5 監視 → Task 9, 10 (判定表の全行: 変更 / dirty / 消えた / 現れた / 共通 / 読み直し失敗)。§6 キーボード → Task 8。§7 エラー処理 → Task 5 (`hiddenProjects`)、9 (`watch-failed`、読み直し失敗の帯)。§8 CI → Task 12。§9 テスト → 各タスクのテスト + Task 11。
- 仕様との差: 終了確認を 2 択にした (Task 10, 13 に記載)。`notify` のイベント種別を見ない方針は仕様どおり。
- 名前の一貫性: `all_tasks` / `labels_union` / `label_by_name` / `reschedule_overdue` / `record_written` / `recorded` / `hold` / `release` / `held_projects` / `useCrossView` / `useCrossActions` / `useRowFocus` / `useShortcuts` / `RowHandlers` / `focusedKey` / `onVisibleKeys` は各タスクで同じ綴り。イベント名 `project-changed` / `projects-changed` / `external-change` / `exit-blocked` / `watch-failed`。
- Review Focus 5 項目はそれぞれ Task 2 / 3 / 9 / 3 / 4 のテストに入っている。
