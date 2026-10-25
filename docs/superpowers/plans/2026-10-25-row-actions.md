# Row actions (②) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four hover buttons of a task row work: an inline editor in place of the row, a date picker under the date button, comments in the task dialog, and a "..." task menu. The same inline editor replaces every name-only "add task" form.

**Architecture:**
- Rust:
  - `add_task` takes an optional position (before / after a task) and shifts the later siblings' order.
  - A new `duplicate_task` copies a task with its subtasks right below it.
- Frontend:
  - `TaskEditor` is one inline editor (name, description, chips, cancel / submit), used for edit and add.
  - `TaskMenu` is the "..." menu. `DeleteTaskDialog` is the centered delete confirmation.
  - `ActionRow` wraps `TaskRow`. It swaps the row for the editor, opens the menu and the date picker, and inserts the editor above or below. ProjectView and the cross lists render `ActionRow` instead of `TaskRow`.
  - `Main` provides one `RowActions` context, which routes each operation to the open project (`useProject`) or to the API (other projects) and shows the toast.
- Pure logic is kept in `.ts` files with node tests:
  - editor values, patches and the "changed" check;
  - menu placement;
  - the toast merge;
  - the meta shortcuts.

**Tech Stack:** Rust (store, Tauri commands), React 19, TypeScript, motion, lucide-react, Storybook 10, Pencil MCP for `design.pen`.

**Spec:** `docs/superpowers/specs/2026-10-25-row-actions-design.md` (PR #52). Research: `docs/research/2026-10-25-todoist-row-actions.md`.

**Prerequisite:** Merge #52 (spec) and this plan's PR first. Start the implementation branch `feature/row-actions` from origin/main after that. Line numbers below refer to origin/main at 77f5409; anchor on the quoted code.

## Global Constraints

- Desktop only. `MobileMain`, `src/views/mobile/*` and the `variant="mobile"` rows are unchanged.
- Out of scope:
  - dragging (③);
  - date parsing from the title;
  - `QuickAddDialog` (q);
  - the menu items 期限・位置情報・リンク・新しいウインドウ・拡張機能.
- Copy, exactly:
  - Editor placeholders: 「タスク名」「説明」.
  - Discard confirmation: 「保存されていない変更を破棄しますか?」, OK label 「破棄」.
  - Toasts:
    - 「日付を <label> に更新しました」 + 「元に戻す」;
    - 「日付を削除しました」 + 「元に戻す」;
    - 「タスクが <project> に追加されました」 + 「開く」;
    - 「タスクを複製しました」 + 「元に戻す」.
  - Delete dialog:
    - title 「タスクを削除しますか?」;
    - body 「「<title>」を削除します。」, or 「「<title>」とサブタスク <n> 件を削除します。」;
    - buttons 「キャンセル」 / 「削除」.
  - Menu: 「タスクを上に追加」「タスクを下に追加」「編集」「日付」「優先度」「リマインダー…」「移動…」「複製」「削除」. Hints 「⌘E」 and 「⌘⌫」.
- Editor look:
  - Border 1px `var(--color-border-strong)`, radius 10, padding 8px 10px.
  - Name 14px. Description 13px.
  - The submit button is red (`var(--color-accent)`), radius 6: 「↑」 (ArrowUp icon) for add, 「✓」 (Check icon) for edit. It is disabled while the name is blank.
- Keys:
  - Enter submits; IME composition never submits (`isImeKey`). In the description, Enter is a newline and ⌘Enter submits.
  - Esc closes the top popover first (`useEscLayer`), then the editor (it asks only when something changed).
  - Row shortcuts are off while an editor, a menu, a date popover or the delete dialog is open.
- 「上に追加」「下に追加」 appear only on the project screen. On a completed task's menu, only 編集・移動・複製・削除 appear.
- Duplicate copies the task and its subtree right below the original. Comments are not copied.
- `design.pen`: the owner opens the worktree copy, which is checked with `mcp__pencil__get_app_state`, and saves it with ⌘S.
- Never print or commit `src-tauri/google-oauth.json` or `google-oauth-ios.plist`. Do not build with `-v` / `-vv`. Do not run the real app (it would touch the owner's data folder and sync).
- Commit messages have no `Co-Authored-By` or other AI trailer.

## Rulings already taken in this plan (against the spec)

- **Story ids.** Spec §8 names the new screens D-01d…D-01h, but `D-01h 行にマウスを乗せる` already exists. They become:
  - D-01i 行の編集欄
  - D-01j タスクを追加の欄
  - D-01k 「…」のメニュー
  - D-01l 行の日付の選択
  - D-01m 削除の確認
- **Search dialog.** Its result rows stay plain `TaskRow`s with no hover actions. It is a picker list: Enter opens the task, and its rows sit inside a modal.
- **Switching the edited row.** Spec §3.3 says that opening another row's editor asks first when the open one has changes. This plan does not ask: `setEditing(key)` replaces the editor, so unsaved changes in it are dropped. Reaching another row's pencil means leaving the editor with the mouse, which is rare. Cost if wrong: a lost edit. The fix is a dirty flag in the context, checked before `setEditing`.
- **Project picker sections.** In the editor and the menu, the picker lists sections only for the project on screen; other projects are listed by name. This is the same limit as the task dialog (①), because summaries carry no sections.

## Review Focus

1. **Editing a task whose project changes in the editor.** The task must move, keep its No. when it stays in the same project, and the row must leave the screen without an error. Test: `toPatch` leaves `category` out and `moveOf` returns the move (Task 2).
2. **Adding above the first row, or below the last row of a section.** The order must not go below 1 and must not clash with the next section. Test: `add_task_before_the_first_row` (Task 1).
3. **Duplicating a subtask.** The copy must stay under the same parent, right below the original, and not jump to the top level. Test: `duplicate_of_a_subtask_keeps_the_parent` (Task 1).
4. **Enter while composing Japanese in the editor** must not submit. Test: `submitKey` in `taskEditorValue.ts` returns null for an IME key event (Task 2).
5. **A menu opened on a row near the bottom of the window** must open upward and stay inside the window. Test: `placeMenu` (Task 2).

---

### Task 1: Store and commands: insert at a position, duplicate

**Files:**
- Modify: `src-tauri/src/store/project_store.rs` (`add_task` at :976, the tests module at :1743)
- Modify: `src-tauri/src/domain/model.rs` (after `TaskInput` at :227)
- Modify: `src-tauri/src/commands/mod.rs` (`add_task` at :1508, new `duplicate_task` after `delete_task` at :1598)
- Modify: `src-tauri/src/lib.rs` (the command list, `commands::add_task,` at :143)
- Modify: `src/api/client.ts` (:80), `src/types/model.ts` (:21)

**Interfaces:**
- Produces (Rust):
  - `pub enum Position { Before(u32), After(u32) }`. It is serde with `rename_all = "camelCase"` and externally tagged, so JSON is `{"before":3}` / `{"after":3}`.
  - `ProjectStore::add_task_at(&mut self, project: &str, input: TaskInput, position: Option<Position>) -> AppResult<ProjectView>`. `add_task(project, input)` calls it with `None`.
  - `ProjectStore::duplicate_task(&mut self, project: &str, no: u32) -> AppResult<(ProjectView, u32)>`. The `u32` is the copy's No.
  - Command `add_task(project, input, position: Option<Position>)`.
  - Command `duplicate_task(project, no) -> (ProjectView, u32)`.
- Produces (TS):
  - `export type Position = { before: number } | { after: number };`
  - `api.addTask(project, input, position?)`
  - `api.duplicateTask(project, no): Promise<[ProjectView, number]>`

- [ ] **Step 1: Write the failing tests** (in `project_store.rs` tests, after `add_task_numbers_and_saves`)

```rust
    fn titles_in_order(v: &ProjectView, parent: Option<u32>) -> Vec<String> {
        let mut ts: Vec<&Task> = v.tasks.iter().filter(|t| t.parent_no == parent && t.category.is_none()).collect();
        ts.sort_by_key(|t| (t.order, t.no));
        ts.iter().map(|t| t.title.clone()).collect()
    }

    #[test]
    fn add_task_after_and_before_a_row() {
        let mut e = env();
        e.store.add_task(INBOX, input("A")).unwrap();
        e.store.add_task(INBOX, input("B")).unwrap();
        e.store.add_task(INBOX, input("C")).unwrap();
        let v = e.store.add_task_at(INBOX, input("A2"), Some(Position::After(1))).unwrap();
        assert_eq!(titles_in_order(&v, None), ["A", "A2", "B", "C"]);
        let v = e.store.add_task_at(INBOX, input("B0"), Some(Position::Before(2))).unwrap();
        assert_eq!(titles_in_order(&v, None), ["A", "A2", "B0", "B", "C"]);
    }

    #[test]
    fn add_task_before_the_first_row() {
        let mut e = env();
        e.store.add_task(INBOX, input("A")).unwrap();
        let v = e.store.add_task_at(INBOX, input("Z"), Some(Position::Before(1))).unwrap();
        assert_eq!(titles_in_order(&v, None), ["Z", "A"]);
        assert!(v.tasks.iter().all(|t| t.order >= 1));
    }

    #[test]
    fn add_task_next_to_a_subtask_stays_under_its_parent() {
        let mut e = env();
        e.store.add_task(INBOX, input("親")).unwrap();
        e.store.add_task(INBOX, child_of("子1", 1)).unwrap();
        e.store.add_task(INBOX, child_of("子2", 1)).unwrap();
        let v = e
            .store
            .add_task_at(INBOX, child_of("子1b", 1), Some(Position::After(2)))
            .unwrap();
        assert_eq!(titles_in_order(&v, Some(1)), ["子1", "子1b", "子2"]);
    }

    #[test]
    fn add_task_at_another_parent_is_refused() {
        let mut e = env();
        e.store.add_task(INBOX, input("親")).unwrap();
        e.store.add_task(INBOX, child_of("子", 1)).unwrap();
        let err = e.store.add_task_at(INBOX, input("外"), Some(Position::After(2))).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)), "{err:?}");
    }

    #[test]
    fn duplicate_copies_the_subtree_right_below() {
        let mut e = env();
        e.store.add_task(INBOX, input("A")).unwrap();
        e.store.add_task(INBOX, child_of("A-子", 1)).unwrap();
        e.store.add_task(INBOX, input("B")).unwrap();
        let (v, copy) = e.store.duplicate_task(INBOX, 1).unwrap();
        assert_eq!(copy, 4);
        assert_eq!(titles_in_order(&v, None), ["A", "A", "B"]);
        let kids: Vec<&Task> = v.tasks.iter().filter(|t| t.parent_no == Some(copy)).collect();
        assert_eq!(kids.len(), 1);
        assert_eq!(kids[0].title, "A-子");
        assert_eq!(kids[0].no, 5);
    }

    #[test]
    fn duplicate_of_a_subtask_keeps_the_parent() {
        let mut e = env();
        e.store.add_task(INBOX, input("親")).unwrap();
        e.store.add_task(INBOX, child_of("子1", 1)).unwrap();
        e.store.add_task(INBOX, child_of("子2", 1)).unwrap();
        let (v, copy) = e.store.duplicate_task(INBOX, 2).unwrap();
        assert_eq!(task(&v, copy).parent_no, Some(1));
        assert_eq!(titles_in_order(&v, Some(1)), ["子1", "子1", "子2"]);
    }
```

The tests use `INBOX` from `crate::domain`, which the tests module already imports. `Position` comes in through `use super::*` once Step 3 imports it into the store.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd src-tauri && cargo test --lib store::project_store 2>&1 | tail -5`
Expected: compile error, ``cannot find type `Position` `` / `no method named add_task_at`.

- [ ] **Step 3: Implement**

In `src-tauri/src/domain/model.rs`, after `TaskInput`:

```rust
/// Where `add_task` puts the new task: right before or after a sibling (same section and parent).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Position {
    Before(u32),
    After(u32),
}
```

Re-export `Position` from `crate::domain` the way `TaskInput` is re-exported: find `TaskInput` in `src-tauri/src/domain/mod.rs` and add `Position` next to it. Then add `Position` to the store's `use crate::domain::{...}` line.

In `project_store.rs`, rename the body of `add_task` to `add_task_at` and keep `add_task` as a wrapper:

```rust
    pub fn add_task(&mut self, project: &str, input: TaskInput) -> AppResult<ProjectView> {
        self.add_task_at(project, input, None)
    }

    /// `position`: right before / after that task, which must be a sibling (same section and
    /// parent); the later siblings move down one. `None` appends to the section.
    pub fn add_task_at(
        &mut self,
        project: &str,
        input: TaskInput,
        position: Option<Position>,
    ) -> AppResult<ProjectView> {
```

Inside the closure, replace the `let order = ...;` block (:992-998) with:

```rust
            let order = match position {
                None => book
                    .tasks
                    .iter()
                    .filter(|t| t.category == category)
                    .map(|t| t.order)
                    .max()
                    .map_or(1, |m| m.saturating_add(1)),
                Some(pos) => {
                    let anchor_no = match pos {
                        Position::Before(n) | Position::After(n) => n,
                    };
                    let anchor = &book.tasks[find_task(book, anchor_no)?];
                    if anchor.category != category || anchor.parent_no != input.parent_no {
                        return Err(invalid("位置のタスクと同じセクション・親にしか追加できません"));
                    }
                    let at = match pos {
                        Position::Before(_) => anchor.order.max(1),
                        Position::After(_) => anchor.order.saturating_add(1),
                    };
                    make_room(book, &category, input.parent_no, at);
                    at
                }
            };
```

Add next to `subtree`:

```rust
/// Moves the siblings (same section and parent) at `at` or later down one, so `at` is free.
fn make_room(book: &mut ProjectBook, category: &Option<String>, parent: Option<u32>, at: u32) {
    for t in book.tasks.iter_mut() {
        if &t.category == category && t.parent_no == parent && t.order >= at {
            t.order = t.order.saturating_add(1);
        }
    }
}
```

Add after `delete_task`:

```rust
    /// Copies the task and its descendants right below it (spec ② §4.2): new numbers, now as
    /// the creation time, everything else as it is. Comments are not copied. Returns the copy's No.
    pub fn duplicate_task(&mut self, project: &str, no: u32) -> AppResult<(ProjectView, u32)> {
        let mut copy_no = 0;
        self.mutate(project, |book, ctx| {
            let idx = subtree(book, no);
            let originals: Vec<Task> = idx.iter().map(|&i| book.tasks[i].clone()).collect();
            let top = originals.iter().find(|t| t.no == no).cloned().ok_or_else(|| {
                not_found(format!("タスク No.{no} が見つかりません"))
            })?;
            let at = top.order.saturating_add(1);
            make_room(book, &top.category, top.parent_no, at);
            let mut renumber: BTreeMap<u32, u32> = BTreeMap::new();
            // Parents before children, so each child finds its parent's new No.
            let mut queue = vec![top.no];
            while let Some(old) = queue.pop() {
                let src = originals.iter().find(|t| t.no == old).expect("in the subtree");
                let new = next_no_for(book, ctx.high_water);
                renumber.insert(old, new);
                let mut t = src.clone();
                t.no = new;
                t.created_at = ctx.now;
                if old == top.no {
                    t.order = at;
                } else {
                    t.parent_no = t.parent_no.map(|p| renumber[&p]);
                }
                book.tasks.push(t);
                let mut kids: Vec<u32> = originals.iter().filter(|c| c.parent_no == Some(old)).map(|c| c.no).collect();
                kids.sort_unstable_by(|a, b| b.cmp(a));
                queue.extend(kids);
            }
            copy_no = renumber[&top.no];
            Ok(())
        })?;
        Ok((self.view(project)?, copy_no))
    }
```

`next_no_for` sees the tasks already pushed, so the numbers count up. `book.tasks` keeps its book order, and the copies go at the end. The view sorts by `order`, so they show right below the original.

In `commands/mod.rs`, change `add_task` and add `duplicate_task`:

```rust
#[tauri::command]
pub async fn add_task(
    project: String,
    input: TaskInput,
    position: Option<Position>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<ProjectView> {
    mutate(&app, state.inner(), &[&project], false, |s| {
        s.add_task_at(&project, input, position)
    })
}

#[tauri::command]
pub async fn duplicate_task(
    project: String,
    no: u32,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<(ProjectView, u32)> {
    mutate(&app, state.inner(), &[&project], false, |s| {
        s.duplicate_task(&project, no)
    })
}
```

Import `Position` where `TaskInput` is imported in `commands/mod.rs`. Register `commands::duplicate_task,` after `commands::delete_task,` in `lib.rs`.

In `src/types/model.ts`, after `TaskInput`:

```ts
/** Where add_task puts the new task: right before / after a sibling (spec ② §5). */
export type Position = { before: number } | { after: number };
```

In `src/api/client.ts`, replace the `addTask` line and add `duplicateTask` after `deleteTask`:

```ts
  addTask: (project: string, input: TaskInput, position?: Position) => invoke<ProjectView>("add_task", { project, input, position: position ?? null }),
  duplicateTask: (project: string, no: number) => invoke<[ProjectView, number]>("duplicate_task", { project, no }),
```

Import `Position` with the other types. If `src/mock/` has a mock `invoke` table (search for `"add_task"` under `src/mock`), add `duplicate_task` there too: copy the task with `no = max + 1` and return `[view, no]`.

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test --lib store::project_store 2>&1 | tail -3 && cargo clippy --all-targets 2>&1 | grep -E "^(warning|error)" | head`
Expected: `test result: ok`, no clippy lines.

- [ ] **Step 5: Run the whole suite and the web build, then commit**

Run: `cd src-tauri && cargo test --lib 2>&1 | grep "test result" && cd .. && npm run build 2>&1 | tail -2`
Expected: all pass; `built in`.

```bash
git add src-tauri src/api/client.ts src/types/model.ts src/mock
git commit -m "feat(store): add a task before or after another, duplicate a task with its subtasks"
```

---

### Task 2: Pure logic: editor values, menu placement, toast merge, meta keys

**Files:**
- Create: `src/views/taskEditorValue.ts`, `src/views/taskEditorValue.test.ts`
- Create: `src/views/menuPlacement.ts`, `src/views/menuPlacement.test.ts`
- Modify: `src/app/completionToast.ts`, `src/app/completionToast.test.ts`
- Modify: `src/app/shortcuts.ts`; Create: `src/app/shortcuts.test.ts`

**Interfaces:**
- Produces:

```ts
// taskEditorValue.ts
export type EditorValue = {
  title: string; note: string; due?: string; dueTime?: string; priority: 1 | 2 | 3 | 4;
  labels: string[]; reminders: string[]; rrule?: string; project: string; section: string | null;
};
export function editorValueOf(t: Task): EditorValue;
export function blankValue(project: string, section: string | null, defaults?: Partial<EditorValue>): EditorValue;
export function changed(a: EditorValue, b: EditorValue): boolean;
export function toInput(v: EditorValue, parentNo?: number): TaskInput;
export function toPatch(before: EditorValue, after: EditorValue): TaskPatch;
export function moveOf(before: EditorValue, after: EditorValue): { project: string; section: string | null } | null;
export function submitKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; isComposing?: boolean; keyCode?: number }, field: "title" | "note"): "submit" | null;
// menuPlacement.ts
export function placeMenu(anchor: { top: number; bottom: number; right: number }, size: { width: number; height: number }, viewport: { width: number; height: number }): { top: number; left: number };
// completionToast.ts
export type Notice = { kind: "done"; state: ToastState } | { kind: "note"; text: string; action: string; id: number };
export function nextNotice(cur: Notice | null, incoming: { done: Completed } | { text: string; action: string; id: number }): Notice;
export function noticeText(n: Notice): string;
// shortcuts.ts
export function metaRowAction(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): "edit" | "remove" | null;
```

- [ ] **Step 1: Write the failing tests**

`src/views/taskEditorValue.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { blankValue, changed, editorValueOf, moveOf, submitKey, toInput, toPatch } from "./taskEditorValue.ts";
import type { Task } from "../types/model.ts";

const task: Task = {
  no: 3, project: "仕事", category: "会議", title: "資料を作る", assignee: "たろう", priority: 2, progress: 0,
  due: "2026-10-26", dueTime: "15:00", note: "表を入れる", labels: ["急ぎ"], reminders: ["-30m"], order: 1, createdAt: "2026-10-25T09:00:00",
};

test("value_of_a_task_round_trips_without_changes", () => {
  const v = editorValueOf(task);
  assert.equal(v.section, "会議");
  assert.equal(changed(v, editorValueOf(task)), false);
  assert.deepEqual(toPatch(v, v), {});
});

test("patch_has_only_the_changed_fields_and_clears_with_null", () => {
  const v = editorValueOf(task);
  const w = { ...v, title: "資料を直す", due: undefined, dueTime: undefined, labels: [] };
  assert.deepEqual(toPatch(v, w), { title: "資料を直す", due: null, dueTime: null, labels: [] });
});

test("project_and_section_go_through_a_move_not_the_patch", () => {
  const v = editorValueOf(task);
  const w = { ...v, project: "買い物", section: null };
  assert.deepEqual(toPatch(v, w), {});
  assert.deepEqual(moveOf(v, w), { project: "買い物", section: null });
  assert.equal(moveOf(v, v), null);
});

test("blank_value_takes_defaults_and_input_trims", () => {
  const v = blankValue("受信トレイ", null, { due: "2026-10-25" });
  assert.equal(v.priority, 4);
  assert.equal(changed(v, blankValue("受信トレイ", null, { due: "2026-10-25" })), false);
  const input = toInput({ ...v, title: "  牛乳を買う ", note: "" }, 7);
  assert.deepEqual(input, { title: "牛乳を買う", section: null, priority: 4, due: "2026-10-25", dueTime: null, note: null, labels: [], parentNo: 7, rrule: null, reminders: [] });
});

test("enter_submits_from_the_title_but_not_while_composing", () => {
  const base = { metaKey: false, ctrlKey: false, shiftKey: false };
  assert.equal(submitKey({ ...base, key: "Enter" }, "title"), "submit");
  assert.equal(submitKey({ ...base, key: "Enter", isComposing: true }, "title"), null);
  assert.equal(submitKey({ ...base, key: "Enter", keyCode: 229 }, "title"), null);
  assert.equal(submitKey({ ...base, key: "Enter" }, "note"), null);
  assert.equal(submitKey({ ...base, key: "Enter", metaKey: true }, "note"), "submit");
});
```

`src/views/menuPlacement.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeMenu } from "./menuPlacement.ts";

const vp = { width: 1200, height: 800 };
const size = { width: 280, height: 400 };

test("opens_below_right_aligned_when_it_fits", () => {
  assert.deepEqual(placeMenu({ top: 100, bottom: 128, right: 900 }, size, vp), { top: 132, left: 620 });
});

test("opens_above_near_the_bottom", () => {
  assert.deepEqual(placeMenu({ top: 600, bottom: 628, right: 900 }, size, vp), { top: 196, left: 620 });
});

test("stays_inside_the_window_when_neither_fits", () => {
  const p = placeMenu({ top: 300, bottom: 328, right: 200 }, { width: 280, height: 780 }, vp);
  assert.equal(p.left, 8);
  assert.equal(p.top, 8);
});
```

Append to `src/app/completionToast.test.ts`:

```ts
import { nextNotice, noticeText } from "./completionToast.ts";

test("completions_add_up_and_a_note_replaces_them", () => {
  let n = nextNotice(null, { done: { project: "仕事", no: 1 } });
  n = nextNotice(n, { done: { project: "仕事", no: 2 } });
  assert.equal(noticeText(n), "2 件のタスクを完了しました");
  n = nextNotice(n, { text: "タスクを複製しました", action: "元に戻す", id: 1 });
  assert.equal(noticeText(n), "タスクを複製しました");
  n = nextNotice(n, { done: { project: "仕事", no: 3 } });
  assert.equal(noticeText(n), "1 件のタスクを完了しました");
});
```

(Merge this `import` line with the file's existing import from `./completionToast.ts`.)

`src/app/shortcuts.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { metaRowAction } from "./shortcuts.ts";

const k = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods,
});

test("cmd_e_edits_and_cmd_backspace_removes", () => {
  assert.equal(metaRowAction(k("e", { metaKey: true })), "edit");
  assert.equal(metaRowAction(k("E", { ctrlKey: true })), "edit");
  assert.equal(metaRowAction(k("Backspace", { metaKey: true })), "remove");
  assert.equal(metaRowAction(k("e")), null);
  assert.equal(metaRowAction(k("e", { metaKey: true, shiftKey: true })), null);
  assert.equal(metaRowAction(k("k", { metaKey: true })), null);
});
```

If importing `shortcuts.ts` under node fails because of React imports, move `metaRowAction` into `src/app/keys.ts` (it already holds `isImeKey`) and import it from there in both places. Ledger that as a ruling.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:web 2>&1 | grep -E "^ℹ (pass|fail)|ERR_MODULE|SyntaxError" | head`
Expected: `ERR_MODULE_NOT_FOUND` for `taskEditorValue.ts` and `menuPlacement.ts`; missing exports `nextNotice` and `metaRowAction`.

- [ ] **Step 3: Implement**

`src/views/taskEditorValue.ts`:

```ts
import { isImeKey } from "../app/keys";
import type { Task, TaskInput, TaskPatch } from "../types/model";

/** What the inline editor edits (spec ② §3). `note` is "" when there is none. */
export type EditorValue = {
  title: string;
  note: string;
  due?: string;
  dueTime?: string;
  priority: 1 | 2 | 3 | 4;
  labels: string[];
  reminders: string[];
  rrule?: string;
  project: string;
  section: string | null;
};

export function editorValueOf(t: Task): EditorValue {
  return {
    title: t.title,
    note: t.note ?? "",
    due: t.due,
    dueTime: t.dueTime,
    priority: t.priority,
    labels: [...t.labels],
    reminders: [...t.reminders],
    rrule: t.rrule,
    project: t.project,
    section: t.category,
  };
}

export function blankValue(project: string, section: string | null, defaults: Partial<EditorValue> = {}): EditorValue {
  return { title: "", note: "", priority: 4, labels: [], reminders: [], project, section, ...defaults };
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function changed(a: EditorValue, b: EditorValue): boolean {
  return (
    a.title !== b.title || a.note !== b.note || a.due !== b.due || a.dueTime !== b.dueTime || a.priority !== b.priority ||
    !same(a.labels, b.labels) || !same(a.reminders, b.reminders) || a.rrule !== b.rrule || a.project !== b.project || a.section !== b.section
  );
}

export function toInput(v: EditorValue, parentNo?: number): TaskInput {
  const note = v.note.trim();
  return {
    title: v.title.trim(),
    section: v.section,
    priority: v.priority,
    due: v.due ?? null,
    dueTime: v.dueTime ?? null,
    note: note === "" ? null : note,
    labels: v.labels,
    parentNo: parentNo ?? null,
    rrule: v.rrule ?? null,
    reminders: v.reminders,
  };
}

/** The fields that changed, `null` to clear. Project and section are not here: they move the task (`moveOf`). */
export function toPatch(before: EditorValue, after: EditorValue): TaskPatch {
  const p: TaskPatch = {};
  if (after.title.trim() !== before.title) p.title = after.title.trim();
  if (after.note.trim() !== before.note) p.note = after.note.trim() === "" ? null : after.note.trim();
  if (after.due !== before.due) p.due = after.due ?? null;
  if (after.dueTime !== before.dueTime) p.dueTime = after.dueTime ?? null;
  if (after.priority !== before.priority) p.priority = after.priority;
  if (!same(after.labels, before.labels)) p.labels = after.labels;
  if (!same(after.reminders, before.reminders)) p.reminders = after.reminders;
  if (after.rrule !== before.rrule) p.rrule = after.rrule ?? null;
  return p;
}

export function moveOf(before: EditorValue, after: EditorValue): { project: string; section: string | null } | null {
  return before.project === after.project && before.section === after.section ? null : { project: after.project, section: after.section };
}

/** Enter in the name, ⌘Enter / Ctrl+Enter in the description; never while composing (IME). */
export function submitKey(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; isComposing?: boolean; keyCode?: number },
  field: "title" | "note",
): "submit" | null {
  if (e.key !== "Enter" || isImeKey(e as KeyboardEvent)) return null;
  if (field === "title") return e.shiftKey ? null : "submit";
  return e.metaKey || e.ctrlKey ? "submit" : null;
}
```

Check `TaskPatch` in `src/types/model.ts` for a `reminders` field. If it is missing, add `reminders?: string[];` to match Rust `TaskPatch`: open `src-tauri/src/domain/model.rs` after :249 and confirm the field exists there first. Read `isImeKey` in `src/app/keys.ts`. If it reads fields other than `isComposing` / `keyCode`, give `submitKey`'s parameter type those fields too.

`src/views/menuPlacement.ts`:

```ts
const MARGIN = 8;
const GAP = 4;

/** Below the anchor and right-aligned to it; above when it does not fit below; always inside the window. */
export function placeMenu(
  anchor: { top: number; bottom: number; right: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - size.height;
  let top = below + size.height <= viewport.height - MARGIN ? below : above >= MARGIN ? above : MARGIN;
  top = Math.max(MARGIN, Math.min(top, viewport.height - MARGIN - size.height));
  const left = Math.max(MARGIN, Math.min(anchor.right - size.width, viewport.width - MARGIN - size.width));
  return { top, left };
}
```

Check the expected values: below = 128 + 4 = 132, and 132 + 400 = 532 ≤ 792, so top is 132; left = 900 − 280 = 620. Near the bottom: 628 + 4 + 400 > 792, so the menu goes above at 600 − 4 − 400 = 196. Neither fits: top is clamped to 8, and left = max(8, 200 − 280) = 8.

In `src/app/completionToast.ts`, append:

```ts
/** The bottom-left notice: completions in a row share one (with their undo), anything else replaces it (spec ② §6). */
export type Notice = { kind: "done"; state: ToastState } | { kind: "note"; text: string; action: string; id: number };

export function nextNotice(cur: Notice | null, incoming: { done: Completed } | { text: string; action: string; id: number }): Notice {
  if ("done" in incoming) return { kind: "done", state: merge(cur?.kind === "done" ? cur.state : null, incoming.done) };
  return { kind: "note", ...incoming };
}

export function noticeText(n: Notice): string {
  return n.kind === "done" ? toastText(n.state) : n.text;
}
```

In `src/app/shortcuts.ts`, export:

```ts
/** ⌘E / Ctrl+E edits the focused row, ⌘⌫ / Ctrl+Backspace deletes it (spec ② §7). */
export function metaRowAction(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): "edit" | "remove" | null {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return null;
  if (e.key.toLowerCase() === "e") return "edit";
  if (e.key === "Backspace") return "remove";
  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:web 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/views/taskEditorValue.ts src/views/taskEditorValue.test.ts src/views/menuPlacement.ts src/views/menuPlacement.test.ts src/app/completionToast.ts src/app/completionToast.test.ts src/app/shortcuts.ts src/app/shortcuts.test.ts src/types/model.ts
git commit -m "feat: editor values, menu placement, notices and meta keys for row actions"
```

---

### Task 3: `TaskEditor`

**Files:**
- Create: `src/views/TaskEditor.tsx`
- Modify: `src/stories/screens/Desktop.stories.tsx` (add D-01i, D-01j after `D01h` at :61)
- Modify: `src/views/ProjectView.tsx` (story-only props, see Step 3)

**Interfaces:**
- Consumes: `EditorValue`, `changed`, `submitKey` (Task 2); `DatePicker`, `LabelPicker`, `ReminderPicker`, `RecurrencePicker`, `ProjectPicker` (`PickerProject`), `PopoverShell`, `PopRow`; `useEscLayer`; `confirmDiscard` from `src/api/dialogs.ts`; `dateLabel` from `src/mock/data.ts`.
- Produces:

```ts
export type TaskEditorProps = {
  mode: "add" | "edit";
  initial: EditorValue;
  /** Shows the project chip. Left out for subtasks (they stay with the parent). */
  projects?: PickerProject[];
  allLabels: string[];
  today: string;
  /** Resolves true when saved. Add: the editor clears (keeping project, section and the initial defaults). */
  onSubmit: (v: EditorValue) => Promise<boolean>;
  onCancel: () => void;
  /** Stories: open with this popover. */
  initialPopover?: "plus" | "date" | "priority" | "project";
};
export function TaskEditor(props: TaskEditorProps): JSX.Element;
```

- [ ] **Step 1: Write the component**

`src/views/TaskEditor.tsx`:

```tsx
import type React from "react";
import { useRef, useState } from "react";
import { ArrowUp, Bell, Calendar, Check, Flag, Folder, Inbox, Plus, Repeat, Tag, Text, X } from "lucide-react";
import { useEscLayer } from "../app/layers";
import { confirmDiscard } from "../api/dialogs";
import { dateLabel } from "../mock/data";
import { DatePicker } from "./DatePicker";
import { LabelPicker } from "./LabelPicker";
import { PopRow, PopoverShell } from "./PopoverShell";
import { ProjectPicker, type PickerProject } from "./ProjectPicker";
import { RecurrencePicker, recurrenceLabel } from "./RecurrencePicker";
import { ReminderPicker, reminderSummary } from "./ReminderPicker";
import { changed, submitKey, type EditorValue } from "./taskEditorValue";

type Pop = "plus" | "date" | "priority" | "project" | "labels" | "reminders" | "repeat";

const PRIORITY_COLOR: Record<1 | 2 | 3 | 4, string> = {
  1: "var(--color-priority-1)",
  2: "var(--color-priority-2)",
  3: "var(--color-priority-3)",
  4: "var(--color-text-secondary)",
};

const chip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  height: 26,
  padding: "0 8px",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  background: "none",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

const field: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: 0,
  outline: "none",
  background: "none",
  padding: 0,
  fontFamily: "var(--font-body)",
  color: "var(--color-text-primary)",
  resize: "none",
};

/** Spec ② §3: the inline editor of a row, and of every "add task" slot. */
export function TaskEditor({ mode, initial, projects, allLabels, today, onSubmit, onCancel, initialPopover }: TaskEditorProps) {
  const [v, setV] = useState<EditorValue>(initial);
  const [showNote, setShowNote] = useState(initial.note !== "");
  const [pop, setPop] = useState<Pop | null>(initialPopover ?? null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<EditorValue>) => setV((cur) => ({ ...cur, ...patch }));
  const canSubmit = v.title.trim() !== "" && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const ok = await onSubmit(v).finally(() => setBusy(false));
    if (ok && mode === "add") {
      setV({ ...initial, project: v.project, section: v.section });
      setShowNote(initial.note !== "");
      titleRef.current?.focus();
    }
  };
  const cancel = async () => {
    if (changed(initial, v) && !(await confirmDiscard("保存されていない変更を破棄しますか?", "破棄").catch(() => false))) return;
    onCancel();
  };
  useEscLayer(pop !== null, () => setPop(null));
  useEscLayer(pop === null, () => void cancel());

  const due = v.due ? dateLabel(v.due, today) : undefined;
  const popover = (() => {
    switch (pop) {
      case "plus":
        return (
          <PopoverShell label="その他の項目" gap={0}>
            <PopRow icon={<Text size={16} />} onClick={() => { setShowNote(true); setPop(null); }}>説明</PopRow>
            <PopRow icon={<Tag size={16} />} onClick={() => setPop("labels")}>ラベル</PopRow>
            <PopRow icon={<Bell size={16} />} onClick={() => setPop("reminders")}>リマインダー</PopRow>
            <PopRow icon={<Repeat size={16} />} onClick={() => setPop("repeat")}>繰り返し</PopRow>
          </PopoverShell>
        );
      case "date":
        return (
          <DatePicker
            value={v.due}
            time={v.dueTime}
            today={today}
            recurrenceLabel={recurrenceLabel(v.rrule)}
            onOpenRecurrence={() => setPop("repeat")}
            onChange={({ date, time }) => {
              set({ due: date, dueTime: date ? time : undefined });
              setPop(null);
            }}
          />
        );
      case "priority":
        return (
          <PopoverShell label="優先度" gap={0}>
            {([1, 2, 3, 4] as const).map((p) => (
              <PopRow key={p} icon={<Flag size={16} />} iconColor={PRIORITY_COLOR[p]} selected={v.priority === p} onClick={() => { set({ priority: p }); setPop(null); }}>
                {`優先度 ${p}`}
              </PopRow>
            ))}
          </PopoverShell>
        );
      case "project":
        return projects ? (
          <ProjectPicker projects={projects} current={{ project: v.project, section: v.section }} onPick={(project, section) => { set({ project, section }); setPop(null); }} />
        ) : null;
      case "labels":
        return <LabelPicker labels={allLabels} selected={v.labels} onToggle={(name) => set({ labels: v.labels.includes(name) ? v.labels.filter((l) => l !== name) : [...v.labels, name] })} />;
      case "reminders":
        return <ReminderPicker reminders={v.reminders} dueTime={v.dueTime} onChange={(reminders) => set({ reminders })} />;
      case "repeat":
        return <RecurrencePicker value={v.rrule} onChange={(rrule) => { set({ rrule }); setPop(null); }} />;
      default:
        return null;
    }
  })();

  return (
    <div
      role="group"
      aria-label={mode === "add" ? "タスクを追加" : "タスクを編集"}
      style={{ position: "relative", border: "1px solid var(--color-border-strong)", borderRadius: 10, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, background: "var(--color-bg)", margin: "4px 0" }}
    >
      <input
        ref={titleRef}
        autoFocus
        aria-label="タスク名"
        placeholder="タスク名"
        value={v.title}
        onFocus={(e) => mode === "edit" && e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
        onChange={(e) => set({ title: e.target.value })}
        onKeyDown={(e) => {
          if (submitKey(e.nativeEvent, "title")) {
            e.preventDefault();
            void submit();
          }
        }}
        style={{ ...field, fontSize: 14, lineHeight: "20px", fontWeight: 500 }}
      />
      {showNote && (
        <textarea
          aria-label="説明"
          placeholder="説明"
          rows={Math.min(6, Math.max(1, v.note.split("\n").length))}
          value={v.note}
          onChange={(e) => set({ note: e.target.value })}
          onKeyDown={(e) => {
            if (submitKey(e.nativeEvent, "note")) {
              e.preventDefault();
              void submit();
            }
          }}
          style={{ ...field, fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <button type="button" aria-label="その他の項目" style={{ ...chip, padding: "0 5px" }} onClick={() => setPop(pop === "plus" ? null : "plus")}>
          <Plus size={14} />
        </button>
        <button type="button" style={{ ...chip, color: due ? `var(--color-${due.tone === "muted" ? "text-secondary" : due.tone})` : chip.color }} onClick={() => setPop(pop === "date" ? null : "date")}>
          <Calendar size={14} />
          {due ? `${due.label}${v.dueTime ? ` ${v.dueTime}` : ""}` : "日付"}
        </button>
        <button type="button" style={{ ...chip, color: v.priority < 4 ? PRIORITY_COLOR[v.priority] : chip.color }} onClick={() => setPop(pop === "priority" ? null : "priority")}>
          <Flag size={14} />
          {v.priority < 4 ? `P${v.priority}` : "優先度"}
        </button>
        {v.labels.map((l) => (
          <button key={l} type="button" style={chip} onClick={() => setPop("labels")}>
            <Tag size={14} />
            {l}
          </button>
        ))}
        {v.reminders.length > 0 && (
          <button type="button" style={chip} onClick={() => setPop("reminders")}>
            <Bell size={14} />
            {reminderSummary(v.reminders)}
          </button>
        )}
        {v.rrule && (
          <button type="button" style={chip} onClick={() => setPop("repeat")}>
            <Repeat size={14} />
            {recurrenceLabel(v.rrule)}
          </button>
        )}
        {projects && (
          <button type="button" style={chip} onClick={() => setPop(pop === "project" ? null : "project")}>
            {v.project === projects[0]?.name ? <Inbox size={14} /> : <Folder size={14} />}
            {v.section ? `${v.project} / ${v.section}` : v.project}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" aria-label="キャンセル" onClick={() => void cancel()} style={{ ...chip, border: 0, padding: "0 4px" }}>
          <X size={18} />
        </button>
        <button
          type="button"
          aria-label={mode === "add" ? "タスクを追加" : "保存"}
          disabled={!canSubmit}
          onClick={() => void submit()}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, border: 0, borderRadius: 6, background: "var(--color-accent)", color: "#fff", opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "default" }}
        >
          {mode === "add" ? <ArrowUp size={16} /> : <Check size={16} />}
        </button>
      </div>
      {popover && (
        <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 20, marginTop: 4 }} onMouseDown={(e) => e.stopPropagation()}>
          {popover}
        </div>
      )}
    </div>
  );
}
```

Notes for the implementer:
- `PopRow`'s props are `icon`, `iconColor`, `children`, `onClick`, `selected`, `borderTop`, `ariaLabel` (`src/views/PopoverShell.tsx:30`).
- The inbox icon: `summaries` lists the inbox first (`useSummaries`), so `projects[0]` is the inbox. If that order is not guaranteed there, pass `inbox: string` as a prop instead and ledger it.
- If `dateLabel(...).tone` uses other names than `success | danger | muted`, map them the way `DateChip` does (`src/components/DateChip.tsx`).
- `PopoverShell` takes `gap: string`. If `gap={0}` fails the type check, pass `"0"`.

- [ ] **Step 2: Add the stories**

`Screen` in `Desktop.stories.tsx` renders `ProjectView`. Add these props to `ProjectView` (story-only, documented in the props type like `hoverNo`):
- `initialEditNo?: number`
- `initialAddSection?: string | null`

The stories:

```tsx
export const D01i: Story = {
  name: "D-01i 行の編集欄",
  render: () => <Screen initialEditNo={2} />,
};

export const D01j: Story = {
  name: "D-01j タスクを追加の欄",
  render: () => <Screen initialAddSection={null} />,
};
```

Task 5 makes these props render the editor (it owns the editing state). Until then, wire them in `ProjectView` directly:
- `initialEditNo`: render `<TaskEditor mode="edit" initial={editorValueOf(t)} ...>` in place of that row.
- `initialAddSection`: start `addTo` as `{ section: initialAddSection }` and render `TaskEditor` in `addSlot` instead of `SubtaskForm`.

Use `allLabels={[]}`, `today={today}` and `onSubmit={() => Promise.resolve(true)}`.

Add to `design/storyboard.md`, under the `D-01h` row:

```
| D-01i | D-01i 行の編集欄 | (pen id after Task 7) | 1440x900 | 6 |
| D-01j | D-01j タスクを追加の欄 | (pen id after Task 7) | 1440x900 | 6 |
```

Task 7 fills in the ids. `check:stories` compares names, not ids. Confirm this by reading `scripts/check-stories.mjs`. If it does compare ids, add these rows in Task 7 instead and ledger it.

- [ ] **Step 3: Check build, stories and tests**

Run: `npm run build 2>&1 | tail -2; npm run test:web 2>&1 | grep -E "^ℹ fail"; npm run check:stories 2>&1 | grep -E "missing|extra" | head -3`
Expected: built; `ℹ fail 0`; `missing: none`.

- [ ] **Step 4: Look at it**

Start Storybook (`npm run storybook -- --ci -p 6108` in the background) and take screenshots of D-01i and D-01j at 1512×940. Use the headless Chrome command the earlier stages used:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=1512,940 --virtual-time-budget=6000 --screenshot=<out.png> "http://localhost:6108/iframe.html?id=screens-desktop--d-01-i&viewMode=story"
```

Find the story id in Storybook's `index.json` if the guess is wrong. Compare the screenshots with `docs/research/2026-10-25-todoist-row-actions.md` §1 and §3: one bordered box, the name line, the chips row, and × with the red button on the right.

- [ ] **Step 5: Commit**

```bash
git add src/views/TaskEditor.tsx src/views/ProjectView.tsx src/stories/screens/Desktop.stories.tsx design/storyboard.md
git commit -m "feat: inline task editor (name, description, date, priority, labels, reminders, repeat, project)"
```

---

### Task 4: `TaskMenu` and `DeleteTaskDialog`

**Files:**
- Create: `src/views/TaskMenu.tsx`, `src/views/DeleteTaskDialog.tsx`
- Modify: `src/stories/screens/Desktop.stories.tsx`, `design/storyboard.md`

**Interfaces:**
- Consumes: `quickDates` (`src/views/quickDates.ts`), `DatePicker`, `ReminderPicker`, `ProjectPicker`, `useEscLayer`, `Button`.
- Produces:

```ts
export type TaskMenuProps = {
  task: Task;
  today: string;
  /** 上に・下に追加 (project screen only). */
  canInsert: boolean;
  projects: PickerProject[];
  onAddAbove: () => void;
  onAddBelow: () => void;
  onEdit: () => void;
  onDue: (date: string | undefined) => void;
  onPriority: (p: 1 | 2 | 3 | 4) => void;
  onReminders: (r: string[]) => void;
  onMove: (project: string, section: string | null) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
  initialPane?: "main" | "date" | "reminders" | "move";
};
export const TASK_MENU_SIZE: { width: number; height: number }; // { width: 280, height: 460 }
export function TaskMenu(props: TaskMenuProps): JSX.Element;

export function DeleteTaskDialog(props: { title: string; subtasks: number; onCancel: () => void; onConfirm: () => void }): JSX.Element;
export function deleteMessage(title: string, subtasks: number): string;
```

- [ ] **Step 1: Write the failing test for `deleteMessage`**

Create `src/views/deleteMessage.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteMessage } from "./deleteMessage.ts";

test("delete_message_names_the_task_and_its_subtasks", () => {
  assert.equal(deleteMessage("牛乳を買う", 0), "「牛乳を買う」を削除します。");
  assert.equal(deleteMessage("資料を作る", 2), "「資料を作る」とサブタスク 2 件を削除します。");
});
```

Run: `node --test src/views/deleteMessage.test.ts 2>&1 | grep -E "ERR_MODULE|fail"`
Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 2: Implement `deleteMessage` and `DeleteTaskDialog`**

`src/views/deleteMessage.ts`:

```ts
export function deleteMessage(title: string, subtasks: number): string {
  return subtasks > 0 ? `「${title}」とサブタスク ${subtasks} 件を削除します。` : `「${title}」を削除します。`;
}
```

`src/views/DeleteTaskDialog.tsx`:

```tsx
import { useEscLayer } from "../app/layers";
import { Button } from "../components/Button";
import { deleteMessage } from "./deleteMessage";

/** Spec ② §4.3: the one delete confirmation (row menu, keys, task dialog). Enter deletes, Esc cancels. */
export function DeleteTaskDialog({ title, subtasks, onCancel, onConfirm }: { title: string; subtasks: number; onCancel: () => void; onConfirm: () => void }) {
  useEscLayer(true, onCancel);
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--color-scrim)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 100 }}
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        role="alertdialog"
        aria-label="タスクの削除"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onConfirm();
          }
        }}
        ref={(el) => el?.focus()}
        style={{ width: 384, boxSizing: "border-box", padding: "20px 16px 16px", borderRadius: 10, background: "var(--color-bg)", boxShadow: "var(--shadow-dialog)", fontFamily: "var(--font-body)", outline: "none" }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, lineHeight: "22px", color: "var(--color-text-primary)" }}>タスクを削除しますか?</div>
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>{deleteMessage(title, subtasks)}</div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          <Button variant="secondary" onClick={onCancel}>キャンセル</Button>
          <Button onClick={onConfirm}>削除</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `TaskMenu`**

`src/views/TaskMenu.tsx`:

```tsx
import type React from "react";
import { useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, Bell, CalendarDays, Copy, Ellipsis, Flag, FolderInput, Pencil, Sofa, Sun, Trash2 } from "lucide-react";
import { useEscLayer } from "../app/layers";
import type { Task } from "../types/model";
import { DatePicker } from "./DatePicker";
import { ProjectPicker, type PickerProject } from "./ProjectPicker";
import { quickDates } from "./quickDates";
import { ReminderPicker } from "./ReminderPicker";

export const TASK_MENU_SIZE = { width: 280, height: 460 };

const PRIORITY_COLOR = ["var(--color-priority-1)", "var(--color-priority-2)", "var(--color-priority-3)", "var(--color-text-secondary)"];

const item: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "6px 10px", border: 0, borderRadius: 6, background: "none",
  fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)", textAlign: "left", cursor: "pointer",
};
const hint: React.CSSProperties = { marginLeft: "auto", fontSize: 12, color: "var(--color-text-muted)" };
const group: React.CSSProperties = { padding: "4px 10px 2px", fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)" };
const sep = <div role="separator" style={{ height: 1, margin: "4px 0", background: "var(--color-border)" }} />;

/** Spec ② §4: the "..." menu of a row. ↑↓ move between items, Enter presses, Esc closes (a sub pane first). */
export function TaskMenu(p: TaskMenuProps) {
  const [pane, setPane] = useState(p.initialPane ?? "main");
  const ref = useRef<HTMLDivElement>(null);
  useEscLayer(true, () => (pane === "main" ? p.onClose() : setPane("main")));
  const done = p.task.progress === 100;
  const q = quickDates(p.today);
  const run = (fn: () => void) => () => {
    fn();
    p.onClose();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  };
  const shell = (children: React.ReactNode) => (
    <div ref={ref} role="menu" aria-label="タスクのメニュー" onKeyDown={onKeyDown} style={{ width: TASK_MENU_SIZE.width, boxSizing: "border-box", padding: 4, borderRadius: 10, border: "1px solid var(--color-border)", background: "var(--color-bg)", boxShadow: "var(--shadow-popover)" }}>
      {children}
    </div>
  );
  if (pane === "date") return <DatePicker value={p.task.due} time={p.task.dueTime} today={p.today} hideTimeRepeat onChange={({ date }) => run(() => p.onDue(date))()} />;
  if (pane === "reminders") return <ReminderPicker reminders={p.task.reminders} dueTime={p.task.dueTime} onChange={p.onReminders} />;
  if (pane === "move") return <ProjectPicker projects={p.projects} current={{ project: p.task.project, section: p.task.category }} onPick={(project, section) => run(() => p.onMove(project, section))()} />;
  const dateBtn = (label: string, date: string, icon: React.ReactNode) => (
    <button key={label} type="button" role="menuitem" aria-label={label} aria-pressed={p.task.due === date} onClick={run(() => p.onDue(date))}
      style={{ ...item, width: 36, justifyContent: "center", padding: 6, background: p.task.due === date ? "var(--color-bg-hover)" : "none" }}>
      {icon}
    </button>
  );
  return shell(
    <>
      {p.canInsert && (
        <>
          <button type="button" role="menuitem" autoFocus style={item} onClick={run(p.onAddAbove)}><ArrowUpToLine size={16} />タスクを上に追加</button>
          <button type="button" role="menuitem" style={item} onClick={run(p.onAddBelow)}><ArrowDownToLine size={16} />タスクを下に追加</button>
          {sep}
        </>
      )}
      <button type="button" role="menuitem" autoFocus={!p.canInsert} style={item} onClick={run(p.onEdit)}><Pencil size={16} />編集<span style={hint}>⌘E</span></button>
      {!done && (
        <>
          {sep}
          <div style={group}>日付</div>
          <div style={{ display: "flex", gap: 4, padding: "2px 6px" }}>
            {dateBtn("今日", q.today, <CalendarDays size={18} color="var(--color-success)" />)}
            {dateBtn("明日", q.tomorrow, <Sun size={18} color="var(--color-priority-2)" />)}
            {dateBtn("今週末", q.weekend, <Sofa size={18} color="var(--color-priority-3)" />)}
            {dateBtn("来週", q.nextWeek, <CalendarDays size={18} color="var(--color-text-secondary)" />)}
            <button type="button" role="menuitem" aria-label="日付を選ぶ" style={{ ...item, width: 36, justifyContent: "center", padding: 6 }} onClick={() => setPane("date")}><Ellipsis size={18} /></button>
          </div>
          <div style={group}>優先度</div>
          <div style={{ display: "flex", gap: 4, padding: "2px 6px" }}>
            {([1, 2, 3, 4] as const).map((pr) => (
              <button key={pr} type="button" role="menuitem" aria-label={`優先度 ${pr}`} aria-pressed={p.task.priority === pr} onClick={run(() => p.onPriority(pr))}
                style={{ ...item, width: 36, justifyContent: "center", padding: 6, background: p.task.priority === pr ? "var(--color-bg-hover)" : "none" }}>
                <Flag size={18} color={PRIORITY_COLOR[pr - 1]} fill={pr < 4 ? PRIORITY_COLOR[pr - 1] : "none"} />
              </button>
            ))}
          </div>
          {sep}
          <button type="button" role="menuitem" style={item} onClick={() => setPane("reminders")}><Bell size={16} />リマインダー…</button>
        </>
      )}
      {sep}
      <button type="button" role="menuitem" style={item} onClick={() => setPane("move")}><FolderInput size={16} />移動…</button>
      <button type="button" role="menuitem" style={item} onClick={run(p.onDuplicate)}><Copy size={16} />複製</button>
      {sep}
      <button type="button" role="menuitem" style={{ ...item, color: "var(--color-danger)" }} onClick={run(p.onDelete)}><Trash2 size={16} />削除<span style={hint}>⌘⌫</span></button>
    </>,
  );
}
```

Notes for the implementer:
- Check that each lucide icon name exists in the installed version: `node -e "const l=require('lucide-react'); console.log(['ArrowDownToLine','ArrowUpToLine','Sofa','FolderInput','Text'].map(n=>n+':'+!!l[n]).join(' '))"`. Replace a missing one with a close existing icon and ledger it.
- Check that `--shadow-popover` exists in `src/styles` (search for `--shadow-`). Otherwise use the token `PopoverShell` uses.

- [ ] **Step 4: Stories**

Add the story-only `ProjectView` props `initialMenuNo?: number`, `initialDateNo?: number` and `initialDeleteNo?: number`. Until Task 5 wires them through `ActionRow`, render the pieces directly in `renderRow`:
- `initialMenuNo`: `TaskMenu` positioned absolutely under the row's right end, with no-op handlers.
- `initialDateNo`: `DatePicker` under the date button (right: 40).
- `initialDeleteNo`: `DeleteTaskDialog`.

```tsx
export const D01k: Story = { name: "D-01k 「…」のメニュー", render: () => <Screen hoverNo={2} initialMenuNo={2} /> };
export const D01l: Story = { name: "D-01l 行の日付の選択", render: () => <Screen hoverNo={2} initialDateNo={2} /> };
export const D01m: Story = { name: "D-01m 削除の確認", render: () => <Screen initialDeleteNo={1} /> };
```

Add the three storyboard rows the same way as Task 3.

- [ ] **Step 5: Check and commit**

Run: `npm run build 2>&1 | tail -2; npm run test:web 2>&1 | grep -E "^ℹ fail"; npm run check:stories 2>&1 | grep -E "missing" | head -3`
Expected: built; `ℹ fail 0`; `missing: none`.

Take screenshots of D-01k / D-01l / D-01m (same command as Task 3) and compare them with the research doc §4–§6.

```bash
git add src/views/TaskMenu.tsx src/views/DeleteTaskDialog.tsx src/views/deleteMessage.ts src/views/deleteMessage.test.ts src/views/ProjectView.tsx src/stories/screens/Desktop.stories.tsx design/storyboard.md
git commit -m "feat: task menu and the centered delete confirmation"
```

---

### Task 5: Wire the project screen: `RowActions`, `ActionRow`, Main, keys

**Files:**
- Create: `src/app/rowActions.ts` (context and types), `src/views/ActionRow.tsx`
- Modify:
  - `src/components/TaskRow.tsx` (buttons at :238-241)
  - `src/views/ProjectView.tsx` (`renderRow` :203, `addSlot` :347, subtask form :279, the delete confirmation :243)
  - `src/app/Main.tsx`
  - `src/app/useRowShortcuts.ts`
  - `src/app/shortcuts.ts` (`RowHandlers` and the key handler at :58-74)
  - `src/components/Toast.tsx`
  - `src/views/TaskDialog.tsx`, `src/views/CommentsSection.tsx` (focus the comment input)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:

```ts
// src/app/rowActions.ts
export type RowActionsApi = {
  today: string;
  projects: PickerProject[];
  allLabels: string[];
  /** taskKey being edited inline, or null. */
  editing: string | null;
  setEditing: (key: string | null) => void;
  /** Where the add editor sits next to a row: { project, anchorNo, where }. */
  inserting: { project: string; anchorNo: number; where: "before" | "after" } | null;
  setInserting: (i: RowActionsApi["inserting"]) => void;
  /** A row with an open menu or date popover (keys off while set). */
  overlay: string | null;
  setOverlay: (key: string | null) => void;
  save: (t: Task, before: EditorValue, after: EditorValue) => Promise<boolean>;
  /** Resolves the new task's No., or null on failure. */
  add: (v: EditorValue, opts?: { parentNo?: number; position?: Position }) => Promise<number | null>;
  setDue: (t: Task, due: string | undefined) => void;
  setPriority: (t: Task, p: 1 | 2 | 3 | 4) => void;
  setReminders: (t: Task, r: string[]) => void;
  move: (t: Task, project: string, section: string | null) => void;
  duplicate: (t: Task) => void;
  requestDelete: (t: Task) => void;
  openComments: (t: Task) => void;
};
export const RowActions: React.Context<RowActionsApi | null>;
```

`ActionRow` props: `{ task: Task; rowProps: TaskRowProps; canInsert: boolean; subtaskCount: number }`. It renders the row, or the editor in its place, plus the add editor before / after the row when `inserting` points at it.

- [ ] **Step 1: `TaskRow` takes handlers for its buttons**

Add to `TaskRowProps`:

```ts
  /** 鉛筆 (spec ② §2). */
  onEdit?: () => void;
  /** 日付のアイコン. */
  onDate?: () => void;
  /** コメントのアイコン. */
  onComment?: () => void;
```

Replace the three buttons:

```tsx
          <Button variant="icon" icon={Pencil} ariaLabel="編集" onClick={p.onEdit} />
          <Button variant="icon" icon={Calendar} ariaLabel="日付" onClick={p.onDate} />
          <Button variant="icon" icon={MessageSquare} ariaLabel="コメント" onClick={p.onComment} />
```

- [ ] **Step 2: `rowActions.ts` and `ActionRow.tsx`**

`src/app/rowActions.ts`:

```ts
import { createContext } from "react";
import type { Position, Task } from "../types/model";
import type { PickerProject } from "../views/ProjectPicker";
import type { EditorValue } from "../views/taskEditorValue";

export type RowActionsApi = { /* exactly as in Interfaces above */ };

/** Main provides it; rows without it (Storybook) keep the plain row behaviour. */
export const RowActions = createContext<RowActionsApi | null>(null);
```

`src/views/ActionRow.tsx`:

```tsx
import { useContext, useRef, useState } from "react";
import { RowActions } from "../app/rowActions";
import { TaskRow, type TaskRowProps } from "../components/TaskRow";
import type { Task } from "../types/model";
import { taskKey } from "./crossList";
import { DatePicker } from "./DatePicker";
import { placeMenu } from "./menuPlacement";
import { TaskEditor } from "./TaskEditor";
import { TASK_MENU_SIZE, TaskMenu } from "./TaskMenu";
import { blankValue, editorValueOf } from "./taskEditorValue";
import { useOutsideClose } from "./crossList";

/** A task row with its hover actions (spec ② §2–§4). Without the RowActions context it is the plain row. */
export function ActionRow({ task, rowProps, canInsert }: { task: Task; rowProps: TaskRowProps; canInsert: boolean }) {
  const ctx = useContext(RowActions);
  const [open, setOpen] = useState<null | "menu" | "date">(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const key = taskKey(task);
  const close = () => {
    setOpen(null);
    ctx?.setOverlay(null);
  };
  useOutsideClose(box, open !== null, close);
  if (!ctx) return <TaskRow {...rowProps} />;

  const show = (kind: "menu" | "date", width: number, height: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos(placeMenu({ top: r.top, bottom: r.top + 36, right: r.right }, { width, height }, { width: window.innerWidth, height: window.innerHeight }));
    setOpen(kind);
    ctx.setOverlay(key);
  };
  const ins = ctx.inserting;
  const insertHere = (where: "before" | "after") =>
    ins && ins.project === task.project && ins.anchorNo === task.no && ins.where === where ? (
      <TaskEditor
        mode="add"
        initial={blankValue(task.project, task.category)}
        allLabels={ctx.allLabels}
        today={ctx.today}
        projects={task.parentNo === undefined ? ctx.projects : undefined}
        onCancel={() => ctx.setInserting(null)}
        onSubmit={async (v) => {
          const no = await ctx.add(v, { parentNo: task.parentNo, position: where === "before" ? { before: task.no } : { after: task.no } });
          if (no === null) return false;
          // Spec ② §4.1: the editor moves under the task just added.
          ctx.setInserting({ project: task.project, anchorNo: no, where: "after" });
          return true;
        }}
      />
    ) : null;

  const row =
    ctx.editing === key ? (
      <TaskEditor
        mode="edit"
        initial={editorValueOf(task)}
        allLabels={ctx.allLabels}
        today={ctx.today}
        projects={task.parentNo === undefined ? ctx.projects : undefined}
        onCancel={() => ctx.setEditing(null)}
        onSubmit={async (v) => {
          const ok = await ctx.save(task, editorValueOf(task), v);
          if (ok) ctx.setEditing(null);
          return ok;
        }}
      />
    ) : (
      <TaskRow
        {...rowProps}
        showActions={rowProps.showActions || open !== null}
        onEdit={() => ctx.setEditing(key)}
        onDate={() => (open === "date" ? close() : show("date", 320, 420))}
        onComment={() => ctx.openComments(task)}
        onMore={() => (open === "menu" ? close() : show("menu", TASK_MENU_SIZE.width, TASK_MENU_SIZE.height))}
      />
    );

  return (
    <div ref={box} style={{ position: "relative" }}>
      {insertHere("before")}
      {row}
      {insertHere("after")}
      {open && pos && (
        <div style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 40 }}>
          {open === "menu" ? (
            <TaskMenu
              task={task}
              today={ctx.today}
              canInsert={canInsert}
              projects={ctx.projects}
              onClose={close}
              onAddAbove={() => ctx.setInserting({ project: task.project, anchorNo: task.no, where: "before" })}
              onAddBelow={() => ctx.setInserting({ project: task.project, anchorNo: task.no, where: "after" })}
              onEdit={() => ctx.setEditing(key)}
              onDue={(d) => ctx.setDue(task, d)}
              onPriority={(pr) => ctx.setPriority(task, pr)}
              onReminders={(r) => ctx.setReminders(task, r)}
              onMove={(project, section) => ctx.move(task, project, section)}
              onDuplicate={() => ctx.duplicate(task)}
              onDelete={() => ctx.requestDelete(task)}
            />
          ) : (
            <DatePicker
              value={task.due}
              time={task.dueTime}
              today={ctx.today}
              onChange={({ date }) => {
                close();
                ctx.setDue(task, date);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
```

Notes for the implementer:
- `useOutsideClose` and `taskKey` are exported from `src/views/crossList.tsx` (`taskKey` is imported there by `useRowShortcuts.ts`). Merge the two imports into one line.
- The menu's own `useEscLayer` closes the menu. `ActionRow` must also clear `overlay` when the menu closes through Esc. Pass `onClose={close}`; the menu's Esc layer already calls `p.onClose()` on the main pane.
- `DatePicker` has no Esc layer of its own here. Add `useEscLayer(open === "date", close)` in `ActionRow`.

- [ ] **Step 3: ProjectView uses `ActionRow` and `TaskEditor`**

In `renderRow` (:207), keep the `TaskRow` props object and render:

```tsx
    const row = (
      <ActionRow task={t} canInsert rowProps={{ /* the same props object TaskRow got */ }} />
    );
```

- Remove the inline delete confirmation block (:243-272) and the `deleteTarget` state. Change `onMore` so it is passed only without the context (stories): `onMore: onDeleteTask && !rowCtx ? ... : undefined`, where `const rowCtx = useContext(RowActions)`. With the context, `ActionRow` owns `onMore`.
- `addSlot(section)`: when `rowCtx` is set, render the add editor instead of `SubtaskForm`:

```tsx
      return (
        <TaskEditor
          mode="add"
          initial={blankValue(project, section)}
          projects={rowCtx.projects}
          allLabels={rowCtx.allLabels}
          today={rowCtx.today}
          onCancel={() => setAddTo(null)}
          onSubmit={(v) => rowCtx.add(v).then((no) => no !== null)}
        />
      );
```

- The subtask form at :279: with `rowCtx`, render `TaskEditor` with `initial={blankValue(project, t.category)}`, no `projects`, and `onSubmit={(v) => rowCtx.add(v, { parentNo: t.no }).then((no) => no !== null)}`.
- Keep the `SubtaskForm` paths for stories without the context (D-01c), but switch D-01c to the editor by giving the story a static `RowActions` provider. Add a `StoryRowActions` provider in `Desktop.stories.tsx` whose functions are no-ops and whose `add` resolves 99.
- Make the story-only props from Tasks 3–4 (`initialEditNo`, `initialAddSection`, `initialMenuNo`, `initialDateNo`, `initialDeleteNo`) go through the same paths: they seed `editing`, `addTo`, and `ActionRow`'s `open` state (add an `initialOpen?: "menu" | "date"` prop to `ActionRow`). Delete the direct renders added in Tasks 3–4.

- [ ] **Step 4: Main provides `RowActions`, the delete dialog and the toasts**

In `Main.tsx`:

1. Replace the toast state (:218-238):

```tsx
  const [notice, setNotice] = useState<Notice | null>(null);
  const noteId = useRef(0);
  const undoRef = useRef<(() => void) | null>(null);
  const completed = useCallback((t: Task) => setNotice((s) => nextNotice(s, { done: completedOf(t) })), []);
  const note = (text: string, action: string, run: () => void) => {
    undoRef.current = run;
    setNotice((s) => nextNotice(s, { text, action, id: ++noteId.current }));
  };
```

   - `undoToast` takes `notice.state` when `notice.kind === "done"`.
   - The render at :740 becomes:

```tsx
        {notice && (
          <Toast
            key="toast"
            text={noticeText(notice)}
            actionLabel={notice.kind === "done" ? "元に戻す" : notice.action}
            onAction={() => (notice.kind === "done" ? void undoToast(notice.state) : (setNotice(null), undoRef.current?.()))}
            onClose={() => setNotice(null)}
          />
        )}
```

   - In `Toast.tsx`, rename `onUndo` to `onAction` and add `actionLabel: string` (shown in place of the fixed 「元に戻す」). Restart the timer on `text` and on the notice `id`: pass `key={notice.kind === "note" ? notice.id : "done"}`.

2. One routing helper for any task (project screen or not). Put it next to `crossToggle`:

```tsx
  /** Runs a change of task `t` through the open project when it is on screen, else through the API, then refreshes the rest. */
  const onScreen = (project: string) => projectScreen && project === current;
  const patchTask = (t: Task, patch: TaskPatch): Promise<boolean> =>
    onScreen(t.project) ? p.updateTask(t.no, patch) : api.updateTask(t.project, t.no, patch).then(() => (refreshAll(), true), (e) => (showError(e), false));
```

   Check `p.updateTask`'s return type in `useProject.ts` (`mutate`). If it is not `Promise<boolean>`, adapt with `.then(() => true)`, and ledger the change.

3. Build the context value:

```tsx
  const [editing, setEditing] = useState<string | null>(null);
  const [inserting, setInserting] = useState<RowActionsApi["inserting"]>(null);
  const [overlay, setOverlay] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [focusComment, setFocusComment] = useState(false);
  const pickerProjects = useMemo(
    () => summaries.map((s) => ({ name: s.name, sections: view && s.name === view.project.name ? view.sections.map((x) => x.name) : [] })),
    [summaries, view],
  );
  const rowActions: RowActionsApi = {
    today, projects: pickerProjects, allLabels, editing, setEditing, inserting, setInserting, overlay, setOverlay,
    save: async (t, before, after) => {
      const patch = toPatch(before, after);
      if (Object.keys(patch).length && !(await patchTask(t, patch))) return false;
      const mv = moveOf(before, after);
      if (mv) {
        try {
          await api.moveTask(t.project, t.no, mv.project, mv.section);
        } catch (e) {
          showError(e);
          return false;
        }
        refreshAll();
        if (projectScreen) void p.refresh();
      }
      focus.set(`${t.project}/${t.no}`);
      return true;
    },
    add: async (v, opts) => {
      try {
        const out = await api.addTask(v.project, toInput(v, opts?.parentNo), opts?.position);
        const no = Math.max(...out.tasks.map((x) => x.no));
        if (onScreen(v.project)) void p.refresh();
        refreshAll();
        void refreshSummaries();
        note(`タスクが ${v.project} に追加されました`, "開く", () => openCross({ ...out.tasks.find((x) => x.no === no)! }));
        return no;
      } catch (e) {
        showError(e);
        return null;
      }
    },
    setDue: (t, due) => {
      const before = { due: t.due ?? null, dueTime: t.dueTime ?? null };
      void patchTask(t, { due: due ?? null, dueTime: due ? (t.dueTime ?? null) : null }).then((ok) => {
        if (!ok) return;
        const label = due ? (dateLabel(due, today)?.label ?? due) : null;
        note(label ? `日付を ${label} に更新しました` : "日付を削除しました", "元に戻す", () => void patchTask(t, before));
      });
    },
    setPriority: (t, pr) => void patchTask(t, { priority: pr }),
    setReminders: (t, r) => void patchTask(t, { reminders: r }),
    move: (t, project, section) =>
      void api.moveTask(t.project, t.no, project, section).then(() => { refreshAll(); if (projectScreen) void p.refresh(); }, showError),
    duplicate: (t) =>
      void api.duplicateTask(t.project, t.no).then(([, copy]) => {
        if (onScreen(t.project)) void p.refresh();
        refreshAll();
        note("タスクを複製しました", "元に戻す", () => void api.deleteTask(t.project, copy).then(() => { refreshAll(); if (onScreen(t.project)) void p.refresh(); }, showError));
      }, showError),
    requestDelete: (t) => setDeleting(t),
    openComments: (t) => {
      setFocusComment(true);
      openCross(t);
    },
  };
```

   - `allLabels` is loaded only while the dialog is open (:430-438). Load it also while `editing !== null || inserting !== null || addOpen`. Simplest: load it once on mount and on `onLabelsChanged`. Use the existing labels refresh path if there is one (search `labelsData`). Ledger the choice.
   - `projectScreen && view` gives the open project's view. Check the variable names around `focusedTaskPool` (:250).

4. Wrap the content in `<RowActions.Provider value={rowActions}>`, next to `CommentCounts.Provider`.

5. The delete dialog. The task's subtask count comes from the open project's view when the task is on screen, else 0. Cross views do not list subtasks, so this is the same rule as `deleteAny` now.

```tsx
        {deleting && (
          <DeleteTaskDialog
            title={deleting.title}
            subtasks={onScreen(deleting.project) && view ? countDescendants(view.tasks, deleting.no) : 0}
            onCancel={() => setDeleting(null)}
            onConfirm={() => {
              const t = deleting;
              setDeleting(null);
              if (dialog?.project === t.project && dialog.no === t.no) setDialog(null);
              void (onScreen(t.project) ? p.deleteTask(t.no) : cross.remove(t));
            }}
          />
        )}
```

   Add `countDescendants(tasks: Task[], no: number): number` to `src/views/deleteMessage.ts`, with a test in `deleteMessage.test.ts` (a parent with a child and a grandchild gives 2).

6. Comments focus: pass `focusComment` to `TaskDialog` as `focusCommentInput` and reset it on close (`setFocusComment(false)` where `setDialog(null)` closes). In `TaskDialog`, pass it to `CommentsSection` as `autoFocusInput`. In `CommentsSection`, add `autoFocus={autoFocusInput}` to the comment `<textarea aria-label="コメント">` (:151).

7. Route the dialog's delete (:482 `onDelete`) through `setDeleting(dlgTask)`. Keep the "go to the next task" behaviour by doing the `afterRemoval` step in `onConfirm` when the deleted task is the dialog's task: compute `after` before `setDialog(null)` and call `goDialog(after)` once the delete resolves.

8. `useRowShortcuts.deleteAny` calls `setDeleting` instead of `confirmAction`. Pass `requestDelete: (t) => setDeleting(t)` into `useRowShortcuts`, and remove its `confirmAction` import.

9. `enabled` for row keys (:263) adds `&& !editing && !inserting && !overlay && !deleting && !addOpen`. `addOpen` is not tracked yet; the editor's inputs are typing targets (`isTypingTarget`), so this is safe without it. Leave `addOpen` out and ledger it.

- [ ] **Step 5: ⌘E and ⌘⌫**

- In `shortcuts.ts`, add `edit?: () => void` to `RowHandlers`.
- In the key handler, before the `if (e.defaultPrevented || !h.enabled || isTypingTarget(e) || meta || e.altKey) return;` line (:68):

```ts
      const metaAct = metaRowAction(e);
      if (metaAct && h.enabled && !isTypingTarget(e) && h.row?.hasFocus) {
        e.preventDefault();
        if (metaAct === "edit") h.row.edit?.();
        else h.row.remove?.();
        return;
      }
```

- In `useRowShortcuts`, add `edit: () => focusedTask && setEditing(taskKey(focusedTask))`. Pass `setEditing` in from Main.

- [ ] **Step 6: Build, tests, stories**

Run: `npm run build 2>&1 | tail -2; npm run test:web 2>&1 | grep -E "^ℹ (pass|fail)"; npm run check:stories 2>&1 | grep missing`
Expected: built; `ℹ fail 0`; `missing: none`.

Take screenshots of D-01, D-01h, D-01i … D-01m and D-01c, and check that nothing else moved. Compare D-01 and D-01h with the main branch's screenshots: the row height and the hover icons must be unchanged.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat: row actions on the project screen (inline edit, date, comments, menu, add above / below, duplicate, delete)"
```

---

### Task 6: Cross views: Today, Upcoming, labels

**Files:**
- Modify: `src/views/crossList.tsx` (`row` at :155, `AddSlot` at :206), `src/views/TodayView.tsx`, `src/views/UpcomingView.tsx`, `src/views/LabelDetailView.tsx`, `src/app/Main.tsx` (:570, :595, :614)

**Interfaces:**
- Consumes: `RowActions`, `ActionRow`, `TaskEditor`, `blankValue` (Tasks 2–5).
- Produces: `AddSlot({ label?, defaults, onAdd? })`, where `defaults: Partial<EditorValue>` sets the first values.

- [ ] **Step 1: Rows**

In `crossList.tsx` `row`, render:

```tsx
      <ActionRow task={t} canInsert={false} rowProps={{ /* the props TaskRow got */ }} />
```

`ActionRow` without the context is the plain row, so the stories stay as they are.

- [ ] **Step 2: `AddSlot` opens the editor**

```tsx
export function AddSlot({ label, defaults = {}, onAdd }: { label?: string; defaults?: Partial<EditorValue>; onAdd?: (title: string) => void }) {
  const ctx = useContext(RowActions);
  const [adding, setAdding] = useState(false);
  if (ctx && adding) {
    const inbox = ctx.projects[0]?.name ?? "";
    return (
      <TaskEditor
        mode="add"
        initial={blankValue(inbox, null, defaults)}
        projects={ctx.projects}
        allLabels={ctx.allLabels}
        today={ctx.today}
        onCancel={() => setAdding(false)}
        onSubmit={(v) => ctx.add(v).then((no) => no !== null)}
      />
    );
  }
  if (onAdd && adding) {
    /* the existing SubtaskForm branch, unchanged (stories) */
  }
  return <AddTaskRow label={label} onClick={ctx || onAdd ? () => setAdding(true) : undefined} />;
}
```

`ctx.projects[0]` is the inbox (see the Task 3 note). If Task 3 added an `inbox` prop instead, use that.

Pass the defaults:
- `TodayView`: `defaults={{ due: today }}`.
- `UpcomingView`: `defaults={{ due: ymd }}` (:175).
- `LabelDetailView`: `defaults={{ labels: [label] }}`.

Keep their `onAddTask` props for the stories. In Main, keep passing them; with the context they are no longer called.

- [ ] **Step 3: Build, tests, stories, screenshots**

Run: `npm run build 2>&1 | tail -2; npm run test:web 2>&1 | grep -E "^ℹ fail"; npm run check:stories 2>&1 | grep missing`
Expected: built; `ℹ fail 0`; `missing: none`.

Take screenshots of D-04 / D-05 / D-06b and check that they are unchanged.

- [ ] **Step 4: Commit**

```bash
git add src
git commit -m "feat: row actions and the add editor on Today, Upcoming and label views"
```

---

### Task 7: design.pen and storyboard

**Files:**
- Modify: `design.pen` (worktree copy only), `design/storyboard.md`

- [ ] **Step 1: Ask the owner to open the worktree's `design.pen`**

Check with `mcp__pencil__get_app_state` that the active file is `<worktree>/design.pen`. Never write while another file is active.

- [ ] **Step 2: Draw the five screens**

Copy the D-01h frame (KrLo2) five times and name the copies:
- **D-01i 行の編集欄:** row 2 replaced by the editor. Show the name, the description 「数字を確認する」, the chips 「明日」 (orange) and 「P2」, the project chip 「受信トレイ」, × and the red ✓.
- **D-01j タスクを追加の欄:** at the end of the list, the add editor, empty, with the placeholder 「タスク名」, the chips 日付 / 優先度 / 受信トレイ, × and the red ↑ (dimmed).
- **D-01k 「…」のメニュー:** the menu under row 2's "...", with the items of the plan's Global Constraints.
- **D-01l 行の日付の選択:** the date picker under row 2's date icon.
- **D-01m 削除の確認:** the scrim and the centered dialog 「タスクを削除しますか?」.

Use the existing components and variables (`get_style`) and the sample names in the frame (牛乳を買う, 仕事). No real identifiers.

- [ ] **Step 3: Fill the storyboard ids**

Replace `(pen id after Task 7)` with the new frame ids. Add transitions under the D-01 rows:

```
| D-01 | 行の鉛筆 / ⌘E | D-01i | 行がその場で編集欄に変わる |
| D-01 | 「タスクを追加」 | D-01j | 列の末尾が追加の欄に変わる |
| D-01 | 行の「…」 | D-01k | メニュー |
| D-01 | 行の日付のアイコン | D-01l | 日付の選択 |
| D-01k | 削除 / ⌘⌫ | D-01m | 画面中央の確認 |
```

- [ ] **Step 4: Ask the owner to save (⌘S), then commit**

```bash
git add design.pen design/storyboard.md
git commit -m "design: row editor, add editor, task menu, row date picker, delete confirmation"
```

---

## Manual checklist (for the PR body)

- [ ] The pencil and ⌘E turn a row into the editor; Enter saves; Esc cancels (and asks when something changed); Enter during IME composition does nothing
- [ ] Change the project in the editor: the task moves
- [ ] Add at a section's end, as a subtask, and on Today / Upcoming / a label view: the editor stays open and the toast's 「開く」 opens the task
- [ ] The row's date icon: pick 明日 → toast → 元に戻す restores the old date
- [ ] Menu: add above / below (the order is right and the editor follows), date and priority quick picks, reminders, move, duplicate (+ 元に戻す), delete
- [ ] Delete from the menu, the Delete key, ⌘⌫ and the task dialog: all show the centered confirmation
- [ ] A menu on the last row of a full window opens upward
- [ ] Dark theme, window width 700
