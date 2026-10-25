# View menu (⑤) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the top bar's 「表示」 menu work. It covers:
- layout (list / board);
- completed tasks;
- sort, with direction;
- group;
- filters (date, created date, priority);
- reset.

It applies on the project, Today, Upcoming and label screens. The settings sync through the common book.

**Architecture:**
- Settings are stored as `表示:<screen>` rows in the common book's 設定 sheet. They use the `extra_settings` list that already round-trips and merges per key. Two store calls read and write them, and the rows follow project and label renames and deletions.
- The frontend parses a row into a `ViewOptions` object.
- One pure function `arrange()` turns tasks and options into groups.
- Main provides a `ViewOptionsCtx` context. Each screen reads its options through `useView(key)` and renders `arrange()`'s result. The menu edits the options.
- Reorder dragging (③) is turned off while a non-manual sort or a grouping is on.

**Tech Stack:** Rust (store, Tauri commands), React 19, TypeScript, Storybook 10, Pencil MCP for `design.pen`.

**Spec:** `docs/superpowers/specs/2026-10-25-view-options-design.md` (PR #58). Research: `docs/research/2026-10-25-todoist-view-options.md`.

**Prerequisite:**
- Merge #58 (spec) and this plan's PR first.
- Start `feature/view-options` from origin/main after that. Main already has ③ drag (#57).
- Copy `src-tauri/binaries/powertodo-tailnet-aarch64-apple-darwin` from another worktree into the new one. It is git-ignored, and the build needs it.

## Global Constraints

- Desktop only. `MobileMain` and `src/views/mobile/*` are unchanged.
- Settings row key: exactly `表示:プロジェクト:<name>`, `表示:今日`, `表示:近日` or `表示:ラベル:<name>`.
- Settings row value:
  - `;`-separated `name=value` pairs. The names are `layout`, `done`, `group`, `sort`, `dir`, `date`, `created`, `prio`.
  - A field equal to its default is not written; all-default means no row.
  - Unknown names or values are ignored and read as the default.
- Values:
  - `layout`: `list` | `board`.
  - `done`: `0` | `1`.
  - `group`: `none` | `date` | `added` | `priority` | `label` | `project`.
  - `sort`: `manual` | `name` | `date` | `added` | `priority`.
  - `dir`: `asc` | `desc`.
  - `date`: `all` | `today` | `week` | `7d` | `month` | `30d` | `none`.
  - `created`: `all` | `today` | `7d` | `30d`.
  - `prio`: `all` | `1` | `2` | `3` | `4`.
- Defaults:
  - `layout=list`, `done=0`, `group=none`, `sort=manual`, `prio=all`, `date=all`, `created=all`.
  - `dir` defaults to the natural direction of the sort: name and date ascending; added newest first (`desc`); priority P1 first (`asc` on the 1..4 number).
- Menu labels (Japanese, exact):
  - Headings: 「レイアウト」「リスト」「ボード」「完了したタスク」「並び替え」「グループ」「並び順」「昇順」「降順」「フィルター」「日付」「作成日」「優先度」「リセット」.
  - Sort and group: 「なし」「手動」「名前」「日付」「追加日」「優先度」「ラベル」「プロジェクト」.
  - Date filter: 「すべて」「今日」「今週」「次の 7 日間」「今月」「次の 30 日間」「日付なし」.
  - Created filter: 「過去 7 日間」「過去 30 日間」.
  - Priority filter: 「P1」…「P4」.
- Menu look:
  - Width 260, anchored under the 「表示」 button and right-aligned.
  - Selects are 140 wide.
  - A changed value is shown in `var(--color-accent)` text.
  - The 「表示」 button gets a 6 px `var(--color-accent)` dot when anything differs from the defaults.
- Options per screen (spec §2.3):
  - **Project:** layout, done, sort, group (none / date / added / priority / label), filters date / created / priority.
  - **Today:** sort (manual means the Today order), group (none / priority / label / project), filter priority.
  - **Upcoming:** sort (within each day), filter priority.
  - **Label:** done, sort, group (none / date / priority / project), filters date / priority.
- Hidden-count copy: 「<n> 件を隠しています (フィルター)」.
- Drag-off toast: 「手動の並び (グループなし) に戻すと並べ替えられます」, action 「戻す」.
- Settings changes are saved after a 0.5 s pause (debounced).
- `design.pen`: the owner opens the worktree copy (check `mcp__pencil__get_app_state`) and saves it with ⌘S.
- Never print or commit `src-tauri/google-oauth.json`. No `-v` builds. Do not run the real app.
- No `Co-Authored-By` or AI trailer in commits.
- Node tests import with `.ts` extensions. Modules tested under node must not use extensionless relative value imports (`import type` is fine).

## Review Focus

1. **A task with several labels when grouping by label** must appear under each of its labels. Its row keys must stay unique, so focus, the dialog's previous / next and drag still work. Test: `arrange` keys each grouped row `"<group>/<project>/<no>"` (Task 2), and Task 4 uses that key for React keys.
2. **"This week" with a Sunday week start** must cover Sunday..Saturday. Test: `arrange_week_starts_on_the_setting` (Task 2).
3. **A filter that hides a parent while a subtask matches** must hide both, while a hidden subtask under a shown parent stays visible (spec §3.1). Test: `arrange_filters_by_the_parent` (Task 2).
4. **Renaming a project while another device still writes the old key** must not leave two rows. Test: the Rust rename test checks the old key is gone and the new key holds the value (Task 1). The sync merge's per-key behaviour is existing.
5. **Turning the sort back to manual** must restore the hand-made order exactly, with no renumbering. Test: `arrange` with `sort=manual` keeps the input order (Task 2). Task 4 makes no `move_within` call when the menu changes.

---

### Task 1: Store and commands: `表示:` rows

**Files:**
- Create: `src-tauri/src/store/view_options.rs`
- Modify:
  - `src-tauri/src/store/mod.rs` (add `mod view_options;`, or the store's own module list; follow how `labels.rs` is declared)
  - `src-tauri/src/store/project_store.rs` (`rename_project` :662, `delete_project` :733)
  - `src-tauri/src/store/labels.rs` (`rename_label` :140, `delete_label` :174)
  - `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`
  - `src/api/client.ts`

**Interfaces:**
- Produces (Rust, on `ProjectStore`):
  - `pub fn view_options(&self) -> BTreeMap<String, String>`: every `extra_settings` row whose key starts with `表示:`.
  - `pub fn set_view_option(&mut self, key: &str, value: &str) -> AppResult<()>`:
    - It refuses a key that does not start with `表示:`.
    - An empty `value` removes the row; otherwise it inserts the row or replaces it in place.
    - It sets `common_dirty`.
- Produces (commands):
  - `view_options() -> BTreeMap<String, String>`
  - `set_view_option(key: String, value: String) -> ()`
- Produces (TS):
  - `api.viewOptions(): Promise<Record<string, string>>`
  - `api.setViewOption(key: string, value: string): Promise<void>`

- [ ] **Step 1: Write the failing tests** (in `view_options.rs`, `#[cfg(test)]`; reuse the store test helpers by making them `pub(crate)` in `project_store.rs` tests if needed, or write a small `env()` like theirs)

```rust
    #[test]
    fn view_option_rows_are_set_replaced_and_removed() {
        let mut e = env();
        e.store.set_view_option("表示:今日", "sort=priority").unwrap();
        e.store.set_view_option("表示:今日", "sort=name").unwrap();
        assert_eq!(e.store.view_options()["表示:今日"], "sort=name");
        e.store.set_view_option("表示:今日", "").unwrap();
        assert!(e.store.view_options().is_empty());
        assert!(e.store.set_view_option("表示名", "x").is_err());
    }

    #[test]
    fn view_option_rows_survive_a_save_and_reopen() {
        let mut e = env();
        e.store.set_view_option("表示:近日", "prio=1").unwrap();
        e.store.save_common().unwrap();
        assert_eq!(e.reopen().view_options()["表示:近日"], "prio=1");
    }

    #[test]
    fn view_option_rows_follow_project_and_label_renames_and_deletes() {
        let mut e = env();
        e.store.create_project("仕事", "var(--color-priority-2)").unwrap();
        e.store.set_view_option("表示:プロジェクト:仕事", "group=label").unwrap();
        e.store.rename_project("仕事", "業務").unwrap();
        let v = e.store.view_options();
        assert!(!v.contains_key("表示:プロジェクト:仕事"));
        assert_eq!(v["表示:プロジェクト:業務"], "group=label");
        e.store.delete_project("業務").unwrap();
        assert!(e.store.view_options().is_empty());

        e.store.add_label("急ぎ", "var(--color-text-muted)").unwrap();
        e.store.set_view_option("表示:ラベル:急ぎ", "sort=date").unwrap();
        e.store.rename_label("急ぎ", "至急").unwrap();
        assert_eq!(e.store.view_options()["表示:ラベル:至急"], "sort=date");
        e.store.delete_label("至急").unwrap();
        assert!(e.store.view_options().is_empty());
    }
```

Check these names against the existing store tests and use the real ones: `save_common`, `reopen`, `add_label(name, color)`, `create_project`. Search `project_store.rs` tests and `labels.rs` tests for each.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd src-tauri && cargo test --lib view_options 2>&1 | grep -E "^error|test result" | head`
Expected: compile errors, `no method named set_view_option`.

- [ ] **Step 3: Implement**

`src-tauri/src/store/view_options.rs`:

```rust
//! Spec ⑤ §6: the 「表示」 settings of each screen, as `表示:<screen>` rows of the common book's
//! 設定 sheet (`CommonBook::extra_settings`, which already round-trips and syncs per key).

use std::collections::BTreeMap;

use super::project_store::ProjectStore;
use crate::error::AppResult;

pub const PREFIX: &str = "表示:";
pub const PROJECT: &str = "表示:プロジェクト:";
pub const LABEL: &str = "表示:ラベル:";

impl ProjectStore {
    pub fn view_options(&self) -> BTreeMap<String, String> {
        self.common
            .extra_settings
            .iter()
            .filter(|(k, _)| k.starts_with(PREFIX))
            .cloned()
            .collect()
    }

    /// An empty value removes the row.
    pub fn set_view_option(&mut self, key: &str, value: &str) -> AppResult<()> {
        if !key.starts_with(PREFIX) {
            return Err(crate::error::AppError::invalid(format!("表示の設定のキーではありません: {key}")));
        }
        let rows = &mut self.common.extra_settings;
        match (rows.iter().position(|(k, _)| k == key), value.is_empty()) {
            (Some(i), true) => {
                rows.remove(i);
            }
            (Some(i), false) => rows[i].1 = value.to_string(),
            (None, false) => rows.push((key.to_string(), value.to_string())),
            (None, true) => return Ok(()),
        }
        self.common_dirty = true;
        Ok(())
    }

    /// Moves `<prefix><from>` to `<prefix><to>` (rename), or drops it (`to` = None).
    pub(crate) fn follow_view_option(&mut self, prefix: &str, from: &str, to: Option<&str>) {
        let old = format!("{prefix}{from}");
        let Some(i) = self.common.extra_settings.iter().position(|(k, _)| *k == old) else {
            return;
        };
        match to {
            Some(t) => {
                let new = format!("{prefix}{t}");
                self.common.extra_settings.retain(|(k, _)| *k != new);
                let i = self.common.extra_settings.iter().position(|(k, _)| *k == old).expect("still there");
                self.common.extra_settings[i].0 = new;
            }
            None => {
                self.common.extra_settings.remove(i);
            }
        }
        self.common_dirty = true;
    }
}
```

Notes for the implementer:
- Use the error helper the store already uses (`invalid(...)` in `project_store.rs`). Make it visible to this module, or use the same `AppError` constructor. Match the existing code.
- `common` and `common_dirty` are private fields of `ProjectStore`. Put this `impl` where it can reach them. `labels.rs` already does `impl ProjectStore` with access to them; follow how it gets that access.

Hooks:
- At the success end of `rename_project`, call `self.follow_view_option(view_options::PROJECT, name, Some(new_name))`.
- At the success end of `delete_project`, call `self.follow_view_option(view_options::PROJECT, name, None)`.
- `rename_label` / `delete_label` get the same calls with `view_options::LABEL`.

Commands (after `update_settings`):

```rust
#[tauri::command]
pub async fn view_options(state: State<'_, AppState>) -> AppResult<BTreeMap<String, String>> {
    with_store(state.inner(), |s| Ok(s.view_options()))
}

#[tauri::command]
pub async fn set_view_option(key: String, value: String, app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    mutate(&app, state.inner(), &[], true, |s| s.set_view_option(&key, &value))
}
```

- Register both commands in `lib.rs`.
- In `client.ts`, add `viewOptions: () => invoke<Record<string, string>>("view_options")` and `setViewOption: (key: string, value: string) => invoke<void>("set_view_option", { key, value })`.

- [ ] **Step 4: Run the tests, the suite and clippy**

Run: `cd src-tauri && cargo fmt && cargo test --lib 2>&1 | grep -E "test result|FAILED" && cargo clippy --all-targets 2>&1 | grep -E "^(warning|error)" | head -3; cd .. && npm run build 2>&1 | tail -1`
Expected: ok; no clippy lines; built.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src src/api/client.ts
git commit -m "feat(store): 表示 settings rows in the common book, following renames and deletes"
```

---

### Task 2: Pure logic: `viewOptions.ts` and `arrange.ts`

**Files:**
- Create: `src/app/view/viewOptions.ts`, `src/app/view/viewOptions.test.ts`, `src/app/view/arrange.ts`, `src/app/view/arrange.test.ts`

**Interfaces:**
- Produces:

```ts
// viewOptions.ts
export type Screen = "project" | "today" | "upcoming" | "label";
export type SortKey = "manual" | "name" | "date" | "added" | "priority";
export type GroupKey = "none" | "date" | "added" | "priority" | "label" | "project";
export type DateFilter = "all" | "today" | "week" | "7d" | "month" | "30d" | "none";
export type CreatedFilter = "all" | "today" | "7d" | "30d";
export type ViewOptions = {
  layout: "list" | "board"; done: boolean; group: GroupKey; sort: SortKey; dir: "asc" | "desc";
  date: DateFilter; created: CreatedFilter; prio: "all" | 1 | 2 | 3 | 4;
};
export const DEFAULTS: ViewOptions;
export function naturalDir(sort: SortKey): "asc" | "desc";
export function parseView(text: string | undefined): ViewOptions;
export function formatView(o: ViewOptions): string; // "" when all default
export function isDefault(o: ViewOptions): boolean;
export function viewKey(screen: Screen, name?: string): string; // "表示:プロジェクト:仕事" etc.
export const ALLOWED: Record<Screen, { layout: boolean; done: boolean; groups: GroupKey[]; filters: ("date" | "created" | "prio")[] }>;
export function sanitize(screen: Screen, o: ViewOptions): ViewOptions; // drops options a screen does not offer
// arrange.ts
export type ArrangedRow = { key: string; task: Task };           // key = `${group}/${project}/${no}`
export type ArrangedGroup = { key: string; title: string; rows: ArrangedRow[] };
export function arrange(tasks: Task[], o: ViewOptions, ctx: {
  today: string; weekStart: "mon" | "sun"; labelOrder: string[]; projectOrder: string[];
}): { groups: ArrangedGroup[]; hidden: number };
```

`arrange` sees top-level tasks (`parentNo === undefined`) for filtering, sorting and grouping. Subtasks are the caller's (ProjectView still renders them under their parent). `hidden` counts top-level tasks the filters removed. Completed top-level tasks (`progress === 100`) are dropped unless `o.done`; when kept they go to a final group `{ key: "done", title: "完了" }`. With `group === "none"`, it returns one group `{ key: "all", title: "" }` plus `done` when shown.

- [ ] **Step 1: Write the failing tests**

`viewOptions.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, formatView, isDefault, naturalDir, parseView, sanitize, viewKey } from "./viewOptions.ts";

test("defaults_write_nothing_and_unknown_parts_are_ignored", () => {
  assert.equal(formatView(DEFAULTS), "");
  assert.ok(isDefault(parseView("")));
  assert.deepEqual(parseView("sort=name;color=red;group=weird"), { ...DEFAULTS, sort: "name", dir: "asc" });
});

test("round_trip_and_natural_direction", () => {
  const o = { ...DEFAULTS, layout: "board" as const, done: true, group: "label" as const, sort: "added" as const, dir: naturalDir("added"), date: "7d" as const, prio: 2 as const };
  assert.equal(formatView(o), "layout=board;done=1;group=label;sort=added;date=7d;prio=2");
  assert.deepEqual(parseView(formatView(o)), o);
  assert.equal(formatView({ ...o, dir: "asc" }), "layout=board;done=1;group=label;sort=added;dir=asc;date=7d;prio=2");
});

test("keys_and_per_screen_options", () => {
  assert.equal(viewKey("project", "仕事"), "表示:プロジェクト:仕事");
  assert.equal(viewKey("today"), "表示:今日");
  assert.equal(viewKey("upcoming"), "表示:近日");
  assert.equal(viewKey("label", "急ぎ"), "表示:ラベル:急ぎ");
  const s = sanitize("upcoming", { ...DEFAULTS, layout: "board", group: "label", done: true, date: "7d", prio: 1 });
  assert.deepEqual(s, { ...DEFAULTS, prio: 1 });
});
```

`arrange.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange } from "./arrange.ts";
import { DEFAULTS } from "./viewOptions.ts";
import type { Task } from "../../types/model.ts";

let n = 0;
const t = (p: Partial<Task>): Task => ({
  no: ++n, project: "仕事", category: null, title: `t${n}`, assignee: "", priority: 4, progress: 0,
  labels: [], reminders: [], order: n, createdAt: "2026-10-20T09:00:00", ...p,
});
const ctx = { today: "2026-10-25", weekStart: "mon" as const, labelOrder: ["急ぎ", "家"], projectOrder: ["受信トレイ", "仕事"] };
const titles = (r: ReturnType<typeof arrange>) => r.groups.map((g) => [g.title, g.rows.map((x) => x.task.title)]);

test("manual_keeps_the_input_order", () => {
  const a = t({ title: "b" }), b = t({ title: "a" });
  assert.deepEqual(titles(arrange([a, b], DEFAULTS, ctx)), [["", ["b", "a"]]]);
});

test("sorts_by_name_date_added_priority_with_ties_in_manual_order", () => {
  const x = [t({ title: "い", due: "2026-10-27", priority: 2, createdAt: "2026-10-21T00:00:00" }),
             t({ title: "あ", priority: 1, createdAt: "2026-10-22T00:00:00" }),
             t({ title: "う", due: "2026-10-26", priority: 2, createdAt: "2026-10-20T00:00:00" })];
  const order = (sort: "name" | "date" | "added" | "priority", dir?: "asc" | "desc") =>
    arrange(x, { ...DEFAULTS, sort, dir: dir ?? (sort === "added" ? "desc" : "asc") }, ctx).groups[0].rows.map((r) => r.task.title);
  assert.deepEqual(order("name"), ["あ", "い", "う"]);
  assert.deepEqual(order("date"), ["う", "い", "あ"]);
  assert.deepEqual(order("date", "desc"), ["い", "う", "あ"]); // no date stays last
  assert.deepEqual(order("added"), ["あ", "い", "う"]);
  assert.deepEqual(order("priority"), ["あ", "い", "う"]); // い and う tie at P2: manual order
});

test("groups_by_date_priority_label_project", () => {
  const a = t({ title: "a", due: "2026-10-24", labels: ["家", "急ぎ"] });
  const b = t({ title: "b", due: "2026-10-25", priority: 1, project: "受信トレイ" });
  const c = t({ title: "c" });
  assert.deepEqual(titles(arrange([a, b, c], { ...DEFAULTS, group: "date" }, ctx)), [["期限切れ", ["a"]], ["今日", ["b"]], ["日付なし", ["c"]]]);
  assert.deepEqual(titles(arrange([a, b, c], { ...DEFAULTS, group: "priority" }, ctx)), [["優先度 1", ["b"]], ["優先度 4", ["a", "c"]]]);
  const byLabel = arrange([a, b, c], { ...DEFAULTS, group: "label" }, ctx);
  assert.deepEqual(titles(byLabel), [["急ぎ", ["a"]], ["家", ["a"]], ["ラベルなし", ["b", "c"]]]);
  assert.equal(new Set(byLabel.groups.flatMap((g) => g.rows.map((r) => r.key))).size, 4);
  assert.deepEqual(titles(arrange([a, b, c], { ...DEFAULTS, group: "project" }, ctx)), [["受信トレイ", ["b"]], ["仕事", ["a", "c"]]]);
});

test("arrange_week_starts_on_the_setting", () => {
  // 2026-10-25 is a Sunday.
  const sun = t({ title: "sun", due: "2026-10-25" }), sat = t({ title: "sat", due: "2026-10-31" }), mon = t({ title: "mon", due: "2026-10-26" });
  const week = (weekStart: "mon" | "sun") => arrange([sun, sat, mon], { ...DEFAULTS, date: "week" }, { ...ctx, weekStart }).groups[0].rows.map((r) => r.task.title);
  assert.deepEqual(week("sun"), ["sun", "sat", "mon"]);
  assert.deepEqual(week("mon"), ["sun"]); // Mon 10-19 .. Sun 10-25
});

test("arrange_filters_by_the_parent_and_counts_hidden", () => {
  const p = t({ title: "p", priority: 4 });
  const c = t({ title: "c", priority: 1, parentNo: p.no });
  const q = t({ title: "q", priority: 1 });
  const r = arrange([p, c, q], { ...DEFAULTS, prio: 1 }, ctx);
  assert.deepEqual(titles(r), [["", ["q"]]]);
  assert.equal(r.hidden, 1);
});

test("filters_dates_created_and_done", () => {
  const today = t({ title: "today", due: "2026-10-25" }), later = t({ title: "later", due: "2026-11-30" }), none = t({ title: "none" });
  const old = t({ title: "old", createdAt: "2026-09-01T00:00:00" });
  const done = t({ title: "done", progress: 100 });
  const pick = (o: Partial<typeof DEFAULTS>) => titles(arrange([today, later, none, old, done], { ...DEFAULTS, ...o }, ctx));
  assert.deepEqual(pick({ date: "today" }), [["", ["today"]]]);
  assert.deepEqual(pick({ date: "30d" }), [["", ["today"]]]);
  assert.deepEqual(pick({ date: "none" }), [["", ["none", "old"]]]);
  assert.deepEqual(pick({ created: "7d" }), [["", ["today", "later", "none"]]]);
  assert.deepEqual(pick({ done: true }), [["", ["today", "later", "none", "old"]], ["完了", ["done"]]]);
});
```

These fixtures use `createdAt: "2026-10-20T09:00:00"` for most tasks. Created 7 days back from 10-25 is 10-18 or later, so they count as recent; `old` (09-01) does not.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:web 2>&1 | grep -E "ERR_MODULE_NOT_FOUND" | head -2`
Expected: both modules not found.

- [ ] **Step 3: Implement**

`src/app/view/viewOptions.ts`:

```ts
export type Screen = "project" | "today" | "upcoming" | "label";
export type SortKey = "manual" | "name" | "date" | "added" | "priority";
export type GroupKey = "none" | "date" | "added" | "priority" | "label" | "project";
export type DateFilter = "all" | "today" | "week" | "7d" | "month" | "30d" | "none";
export type CreatedFilter = "all" | "today" | "7d" | "30d";
export type ViewOptions = {
  layout: "list" | "board";
  done: boolean;
  group: GroupKey;
  sort: SortKey;
  dir: "asc" | "desc";
  date: DateFilter;
  created: CreatedFilter;
  prio: "all" | 1 | 2 | 3 | 4;
};

export const naturalDir = (sort: SortKey): "asc" | "desc" => (sort === "added" ? "desc" : "asc");
export const DEFAULTS: ViewOptions = { layout: "list", done: false, group: "none", sort: "manual", dir: "asc", date: "all", created: "all", prio: "all" };

const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined => (allowed as readonly string[]).includes(v ?? "") ? (v as T) : undefined;

export function parseView(text: string | undefined): ViewOptions {
  const m = new Map((text ?? "").split(";").map((p) => p.split("=") as [string, string]).filter((p) => p.length === 2));
  const sort = pick(m.get("sort"), ["manual", "name", "date", "added", "priority"] as const) ?? "manual";
  const prio = m.get("prio");
  return {
    layout: pick(m.get("layout"), ["list", "board"] as const) ?? "list",
    done: m.get("done") === "1",
    group: pick(m.get("group"), ["none", "date", "added", "priority", "label", "project"] as const) ?? "none",
    sort,
    dir: pick(m.get("dir"), ["asc", "desc"] as const) ?? naturalDir(sort),
    date: pick(m.get("date"), ["all", "today", "week", "7d", "month", "30d", "none"] as const) ?? "all",
    created: pick(m.get("created"), ["all", "today", "7d", "30d"] as const) ?? "all",
    prio: prio === "1" || prio === "2" || prio === "3" || prio === "4" ? (Number(prio) as 1 | 2 | 3 | 4) : "all",
  };
}

export function formatView(o: ViewOptions): string {
  const parts: string[] = [];
  if (o.layout !== "list") parts.push(`layout=${o.layout}`);
  if (o.done) parts.push("done=1");
  if (o.group !== "none") parts.push(`group=${o.group}`);
  if (o.sort !== "manual") parts.push(`sort=${o.sort}`);
  if (o.sort !== "manual" && o.dir !== naturalDir(o.sort)) parts.push(`dir=${o.dir}`);
  if (o.date !== "all") parts.push(`date=${o.date}`);
  if (o.created !== "all") parts.push(`created=${o.created}`);
  if (o.prio !== "all") parts.push(`prio=${o.prio}`);
  return parts.join(";");
}

export const isDefault = (o: ViewOptions) => formatView(o) === "";

export function viewKey(screen: Screen, name?: string): string {
  if (screen === "project") return `表示:プロジェクト:${name}`;
  if (screen === "label") return `表示:ラベル:${name}`;
  return screen === "today" ? "表示:今日" : "表示:近日";
}

export const ALLOWED: Record<Screen, { layout: boolean; done: boolean; groups: GroupKey[]; filters: ("date" | "created" | "prio")[] }> = {
  project: { layout: true, done: true, groups: ["none", "date", "added", "priority", "label"], filters: ["date", "created", "prio"] },
  today: { layout: false, done: false, groups: ["none", "priority", "label", "project"], filters: ["prio"] },
  upcoming: { layout: false, done: false, groups: ["none"], filters: ["prio"] },
  label: { layout: false, done: true, groups: ["none", "date", "priority", "project"], filters: ["date", "prio"] },
};

export function sanitize(screen: Screen, o: ViewOptions): ViewOptions {
  const a = ALLOWED[screen];
  return {
    ...o,
    layout: a.layout ? o.layout : "list",
    done: a.done ? o.done : false,
    group: a.groups.includes(o.group) ? o.group : "none",
    date: a.filters.includes("date") ? o.date : "all",
    created: a.filters.includes("created") ? o.created : "all",
    prio: a.filters.includes("prio") ? o.prio : "all",
  };
}
```

`src/app/view/arrange.ts`:

```ts
import type { Task } from "../../types/model";
import type { ViewOptions } from "./viewOptions";

export type ArrangedRow = { key: string; task: Task };
export type ArrangedGroup = { key: string; title: string; rows: ArrangedRow[] };
type Ctx = { today: string; weekStart: "mon" | "sun"; labelOrder: string[]; projectOrder: string[] };

const DAY = 86_400_000;
const num = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / DAY;
const ymd = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const dayTitle = (d: string) => `${+d.slice(5, 7)}月${+d.slice(8, 10)}日 · ${WEEKDAYS[new Date(num(d) * DAY).getUTCDay()]}曜日`;

function dateOk(t: Task, f: ViewOptions["date"], c: Ctx): boolean {
  if (f === "all") return true;
  if (f === "none") return !t.due;
  if (!t.due) return false;
  const d = num(t.due), today = num(c.today);
  const dow = new Date(today * DAY).getUTCDay();
  const weekFirst = today - ((dow - (c.weekStart === "mon" ? 1 : 0) + 7) % 7);
  switch (f) {
    case "today": return d === today;
    case "week": return d >= weekFirst && d < weekFirst + 7;
    case "7d": return d >= today && d < today + 7;
    case "30d": return d >= today && d < today + 30;
    case "month": return t.due.slice(0, 7) === c.today.slice(0, 7);
  }
}

function createdOk(t: Task, f: ViewOptions["created"], c: Ctx): boolean {
  if (f === "all") return true;
  const d = num(t.createdAt.slice(0, 10)), today = num(c.today);
  return f === "today" ? d === today : d > today - (f === "7d" ? 7 : 30);
}

function compare(a: Task, b: Task, o: ViewOptions): number {
  const sign = o.dir === "asc" ? 1 : -1;
  switch (o.sort) {
    case "name": return sign * a.title.localeCompare(b.title, "ja");
    case "date":
      if (!a.due || !b.due) return a.due ? -1 : b.due ? 1 : 0; // no date last either way
      return sign * (num(a.due) - num(b.due));
    case "added": return sign * a.createdAt.localeCompare(b.createdAt);
    case "priority": return sign * (a.priority - b.priority);
    default: return 0;
  }
}

/** Spec ⑤ §3: filters, then sort (stable: ties keep the input = manual order), then groups. Top-level tasks only. */
export function arrange(tasks: Task[], o: ViewOptions, c: Ctx): { groups: ArrangedGroup[]; hidden: number } {
  const top = tasks.filter((t) => t.parentNo === undefined);
  const done = top.filter((t) => t.progress === 100);
  const open = top.filter((t) => t.progress !== 100);
  const keep = (t: Task) => dateOk(t, o.date, c) && createdOk(t, o.created, c) && (o.prio === "all" || t.priority === o.prio);
  const shown = open.filter(keep);
  const hidden = open.length - shown.length;
  const sorted = [...shown].sort((a, b) => compare(a, b, o));
  const row = (g: string, t: Task): ArrangedRow => ({ key: `${g}/${t.project}/${t.no}`, task: t });
  const groups: ArrangedGroup[] = [];
  const add = (key: string, title: string, list: Task[]) => list.length && groups.push({ key, title, rows: list.map((t) => row(key, t)) });

  if (o.group === "none") add("all", "", sorted);
  else if (o.group === "priority") for (const p of [1, 2, 3, 4]) add(`p${p}`, `優先度 ${p}`, sorted.filter((t) => t.priority === p));
  else if (o.group === "label") {
    for (const l of c.labelOrder) add(`l:${l}`, l, sorted.filter((t) => t.labels.includes(l)));
    const known = new Set(c.labelOrder);
    for (const l of [...new Set(sorted.flatMap((t) => t.labels))].filter((l) => !known.has(l))) add(`l:${l}`, l, sorted.filter((t) => t.labels.includes(l)));
    add("l:", "ラベルなし", sorted.filter((t) => t.labels.length === 0));
  } else if (o.group === "project") {
    const names = [...c.projectOrder, ...new Set(sorted.map((t) => t.project).filter((p) => !c.projectOrder.includes(p)))];
    for (const p of names) add(`p:${p}`, p, sorted.filter((t) => t.project === p));
  } else if (o.group === "date") {
    const today = num(c.today);
    add("d:over", "期限切れ", sorted.filter((t) => t.due && num(t.due) < today));
    const dates = [...new Set(sorted.filter((t) => t.due && num(t.due) >= today).map((t) => t.due!))].sort();
    for (const d of dates) add(`d:${d}`, num(d) === today ? "今日" : num(d) === today + 1 ? "明日" : dayTitle(d), sorted.filter((t) => t.due === d));
    add("d:none", "日付なし", sorted.filter((t) => !t.due));
  } else if (o.group === "added") {
    const today = num(c.today);
    const dates = [...new Set(sorted.map((t) => t.createdAt.slice(0, 10)))].sort().reverse();
    for (const d of dates) add(`a:${d}`, num(d) === today ? "今日" : num(d) === today - 1 ? "昨日" : dayTitle(d), sorted.filter((t) => t.createdAt.startsWith(d)));
  }
  if (o.done) add("done", "完了", done);
  return { groups, hidden };
}
```

Notes for the implementer:
- `Array.prototype.sort` is stable, so ties keep the input (manual) order.
- The `ymd` helper may end up unused. Remove it if so.
- If the date group's `dayTitle` differs from the app's existing day titles (`UpcomingView`'s `dayTitle`), use the same format as Upcoming's, but keep this module free of extensionless imports: copy the small formatter.

- [ ] **Step 4: Run the tests**

Run: `npm run test:web 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/view
git commit -m "feat: view options (parse, format, per screen) and arrange (filter, sort, group)"
```

---

### Task 3: The menu, the context, the header

**Files:**
- Create: `src/app/view/ViewOptionsContext.tsx`, `src/views/ViewMenuPanel.tsx`
- Modify: `src/views/HeaderActions.tsx` (`ViewMenu` :126, `HeaderActions` :170, `PageHeader` :180), `src/app/Main.tsx`, `src/stories/screens/Desktop.stories.tsx`, `design/storyboard.md`

**Interfaces:**
- Consumes: `api.viewOptions`, `api.setViewOption` (Task 1); `ViewOptions`, `parseView`, `formatView`, `isDefault`, `sanitize`, `ALLOWED`, `Screen`, `viewKey`, `DEFAULTS` (Task 2).
- Produces:

```ts
// ViewOptionsContext.tsx
export type ViewOptionsApi = { get: (key: string) => ViewOptions; set: (key: string, o: ViewOptions) => void };
export const ViewOptionsCtx: React.Context<ViewOptionsApi | null>;
/** Without a provider (stories), a local state that starts at `initial`. */
export function useView(screen: Screen, name?: string, initial?: ViewOptions): [ViewOptions, (o: ViewOptions) => void];
export function useViewOptionsStore(): ViewOptionsApi; // Main: loads api.viewOptions(), debounced api.setViewOption (0.5 s), reloads on onProjectsChanged
// HeaderActions
PageHeader props add: view?: { screen: Screen; options: ViewOptions; onChange: (o: ViewOptions) => void }
```

- [ ] **Step 1: The context and the store hook**

`ViewOptionsContext.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { onProjectsChanged } from "../../api/events";
import { DEFAULTS, formatView, parseView, sanitize, viewKey, type Screen, type ViewOptions } from "./viewOptions";

export type ViewOptionsApi = { get: (key: string) => ViewOptions; set: (key: string, o: ViewOptions) => void };
export const ViewOptionsCtx = createContext<ViewOptionsApi | null>(null);

const SAVE_DELAY_MS = 500;

/** Main: the 表示 rows of the common book, saved 0.5 s after the last change (spec ⑤ §6). */
export function useViewOptionsStore(): ViewOptionsApi {
  const [rows, setRows] = useState<Record<string, string>>({});
  const pending = useRef(new Map<string, number>());
  const load = useCallback(() => void api.viewOptions().then(setRows, () => undefined), []);
  useEffect(() => {
    load();
    return onProjectsChanged(load);
  }, [load]);
  useEffect(() => () => pending.current.forEach((id) => window.clearTimeout(id)), []);
  const get = useCallback((key: string) => parseView(rows[key]), [rows]);
  const set = useCallback((key: string, o: ViewOptions) => {
    const value = formatView(o);
    setRows((r) => {
      const next = { ...r };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
    window.clearTimeout(pending.current.get(key));
    pending.current.set(key, window.setTimeout(() => {
      pending.current.delete(key);
      void api.setViewOption(key, value).catch(() => undefined);
    }, SAVE_DELAY_MS));
  }, []);
  return { get, set };
}

/** A screen's options (sanitized for that screen); without a provider, local state for stories. */
export function useView(screen: Screen, name?: string, initial: ViewOptions = DEFAULTS): [ViewOptions, (o: ViewOptions) => void] {
  const ctx = useContext(ViewOptionsCtx);
  const [local, setLocal] = useState(initial);
  const key = viewKey(screen, name);
  const value = sanitize(screen, ctx ? ctx.get(key) : local);
  const set = useCallback((o: ViewOptions) => (ctx ? ctx.set(key, sanitize(screen, o)) : setLocal(o)), [ctx, key, screen]);
  return [value, set];
}
```

- Check that `onProjectsChanged` in `src/api/events.ts` fires when the common book reloads after a sync. Search its emitters in Rust (`projects-changed`). If another event covers the common reload (e.g. `common-changed`), use that, and record the choice in the report.
- A failed `setViewOption` is swallowed here, because the next reload corrects the view. If the codebase has a `showError` channel reachable from here, use it instead.

- [ ] **Step 2: The menu panel**

`src/views/ViewMenuPanel.tsx`:
- Props: `{ screen: Screen; options: ViewOptions; onChange: (o: ViewOptions) => void }`.
- It renders spec §2.1 in this order: レイアウト (two big buttons with the `List` / `Kanban` lucide icons, only when `ALLOWED[screen].layout`); 完了したタスク (a switch, when `.done`); a 並び替え heading with グループ (only `ALLOWED[screen].groups`, hidden when that list has one entry), 並び替え, and 並び順 (when sort ≠ manual); a フィルター heading with only the allowed filters; and リセット when `!isDefault(options)`.
- Each select is a button 140 wide that opens a list under it, with 「✓」 on the current value. Use the existing `PopoverShell` / `PopRow` (`src/views/PopoverShell.tsx`) for the lists.
- A value that differs from `DEFAULTS` gets `color: var(--color-accent)`.
- Changing the sort resets `dir` to `naturalDir(sort)`.
- Every change calls `onChange` at once.
- Keep the labels exactly as in the Global Constraints.

- [ ] **Step 3: Header wiring**

In `HeaderActions.tsx`:
- `ViewMenu` takes `view?: { screen; options; onChange }`. When it is set, it renders `ViewMenuPanel` inside its popover instead of the disabled 「並び替え」 item, with a 260 width and the existing outside-click / Esc behaviour. Otherwise it keeps today's disabled item.
- `HeaderAction`'s button shows a 6 px `var(--color-accent)` dot at its top right when `view && !isDefault(view.options)`.
- `HeaderActions` and `PageHeader` pass `view` through.

In `Main.tsx`, wrap the content with `<ViewOptionsCtx.Provider value={viewStore}>`, where `const viewStore = useViewOptionsStore()`.

- [ ] **Step 4: Story**

Add 「D-01s 「表示」メニュー」. It is a `Screen` whose `ProjectView` header opens the menu with `sort=priority, group=label, date=7d`. Give `ProjectView` a story-only `initialViewMenuOpen?: boolean` that opens it, and story-only `initialView?: ViewOptions` passed to `useView` (Task 4 makes ProjectView use `useView`; for this task, wire `PageHeader view` in ProjectView with `useView("project", project, initialView)`).

Add the storyboard row with a placeholder id `pend11`; Task 7 replaces it.

- [ ] **Step 5: Checks and commit**

Run: `npm run build 2>&1 | grep -E "error|built in" | head -3; npm run test:web 2>&1 | grep -E "^ℹ fail"; npm run build-storybook >/dev/null 2>&1; npm run check:stories 2>&1 | grep missing`
Expected: built; `ℹ fail 0`; `missing: none`.

Take a screenshot of D-01s headless (`/private/tmp/claude-502/-Users-ktakeuchi-Documents-AOGU/d2253c28-745b-4661-9a05-32aec0df385e/scratchpad/shot.sh` takes `<story-id> <out.png> [w] [h] [port]`; serve storybook-static on 6108 with `python3 -m http.server`). Compare it with the research doc §1.

```bash
git add src design/storyboard.md
git commit -m "feat: the 表示 menu (layout, done, sort, group, filters, reset) with synced settings"
```

---

### Task 4: Project screen arranged by the options; drag off while sorted

**Files:**
- Modify: `src/views/ProjectView.tsx`, `src/views/ActionRow.tsx` (if the toast needs a hook), `src/app/Main.tsx`, `src/app/useRowShortcuts.ts`, `src/stories/screens/Desktop.stories.tsx`, `design/storyboard.md`

**Interfaces:**
- Consumes: `useView`, `arrange`, `ViewOptions` (Tasks 2-3); ③'s `DragCtx` and the data-* contract; ②'s `note()` toast in Main (through `RowActions` or a new callback).
- Produces: `ProjectView` renders by `arrange`. `ProjectView` exposes `reorderOff: boolean` to the drag (no `data-drop-list`, no handles start a reorder) and to Main's key moves.

- [ ] **Step 1: Arrange**

In `ProjectView`:
- `const [view, setView] = useView("project", project, initialView)`.
- Pass `view={{ screen: "project", options: view, onChange: setView }}` to `PageHeader`.
- `const sorted = view.sort !== "manual" || view.group !== "none"`.
- When `view.group === "none"`:
  - Keep the section rendering.
  - Apply `arrange` per section for filter and sort: call `arrange(tasksOfSection, { ...view, done: false }, ctx)` and render its single group's rows in that order.
  - Completed tasks follow `view.done` instead of the local `showCompleted` state. The existing 「完了したタスクを表示」 toggle calls `setView({ ...view, done: !view.done })`.
- When `view.group !== "none"`:
  - Render `arrange(mineTop, view, ctx).groups` with a `SectionHeader` per group (collapsible, local collapse state keyed by group key, not saved).
  - Each row's subtasks still render under it as today.
  - No 「タスクを追加」 slots inside groups. Keep one at the end, which adds unsectioned.
- When `hidden > 0`, render 「<n> 件を隠しています (フィルター)」 under the page header (13 px, `var(--color-text-secondary)`).
- `ctx` is:
  - `{ today, weekStart, labelOrder, projectOrder }`.
  - Pass `weekStart` and the orders down from Main as new optional props, with defaults `"mon"`, `[]`, `[]` for stories.
  - Main reads `weekStart` from its settings source; search for `weekStart` usage in `src/app`.
  - Main reads the label order from the labels it already loads, and the project order from `summaries`.
- React keys and row keys:
  - Each row's React key and the drag/focus `data-key` stay `${project}/${no}`, because one project has each task once, except in label grouping.
  - In label grouping, use the `ArrangedRow.key` as the React key. Keep `data-key` / focus key `${project}/${no}`, and put `data-row` only on the first occurrence (later occurrences render without `data-row`), so the engine sees each task once.
  - Report what you chose.

- [ ] **Step 2: Drag and keys off while sorted**

- When `sorted`, the list root gets no `data-drop-list` and the section headers no `data-drop-section`.
- The task handle's `onHandlePointerDown` still starts a drag with `view: "project"`, because the sidebar drop must keep working. Since there is no project drop list, only sidebar targets exist.
- Pressing a handle while `sorted` also shows the toast 「手動の並び (グループなし) に戻すと並べ替えられます」 with the action 「戻す」, which calls `setView({ ...view, sort: "manual", dir: "asc", group: "none" })`.
- Show the toast on pointer down only once per press. Route it through a new optional `ProjectView` prop `onReorderLocked?: (restore: () => void) => void`, which Main implements with `note(text, "戻す", restore)`.
- Section handles do not start a drag while `sorted`; they show the same toast.
- `useRowShortcuts.moveKey` on the project screen does nothing while sorted and shows the same toast. Pass `sorted` and the restore callback from Main. Main reads the project view's options through `ViewOptionsCtx.get(viewKey("project", current))`.

- [ ] **Step 3: Write a test for the "first occurrence carries data-row" rule**

Pull the rule into `arrange.ts` as `export function firstOccurrences(groups: ArrangedGroup[]): Set<string>`. It returns the `ArrangedRow.key`s that are the first occurrence of each `project/no`. Test it in `arrange.test.ts` with the label example (a task with two labels: only its first row is in the set). Write the test first and watch it fail.

- [ ] **Step 4: Stories**

Add:
- 「D-01t グループ: 優先度」 (`initialView={{...DEFAULTS, group:"priority"}}`)
- 「D-01u フィルター中」 (`initialView={{...DEFAULTS, prio:1}}`, with mock tasks so that some are hidden)

Add both storyboard rows with ids `pend12` / `pend13`.

- [ ] **Step 5: Checks, CDP and commit**

Run the Task 3 checks.

Then drive the interactive drag story 「D-01 ドラッグ (操作)」 over CDP. The driver is `/private/tmp/claude-502/-Users-ktakeuchi-Documents-AOGU/d2253c28-745b-4661-9a05-32aec0df385e/scratchpad/cdp/drive.mjs`; there are extended copies in that folder. Give that story a view menu, or a story-only `initialView` with `sort: "priority"`, and check:
- a handle press shows no red line;
- the story's `onReorderLocked` was called.

Stop the http server afterwards.

```bash
git add src design/storyboard.md
git commit -m "feat: project screen arranged by the 表示 options; reorder drag and keys off while sorted or grouped"
```

---

### Task 5: Today, Upcoming, labels

**Files:**
- Modify: `src/views/TodayView.tsx`, `src/views/UpcomingView.tsx`, `src/views/LabelDetailView.tsx`, `src/views/crossList.tsx` (if the rows helper needs the arranged order), `src/app/Main.tsx`

**Interfaces:**
- Consumes: `useView`, `arrange` (Tasks 2-3).

- [ ] **Step 1: Today**

- `const [view, setView] = useView("today")`. Pass `PageHeader view`.
- The overdue group keeps its order (spec ③ §6).
- The today group:
  - With `sort === "manual"`, keep the backend's order (the Today order).
  - Otherwise apply `arrange(todays, { ...view, group: "none" }, ctx)`.
- With `view.group !== "none"`, render the today group's tasks in `arrange(todays, view, ctx).groups` sections under the 「今日」 heading. Overdue stays as one block above.
- Today's `data-drop-list="today"` exists only when `sort === "manual" && group === "none"`. Otherwise a handle press shows the drag-off toast (through a new `onReorderLocked` prop, the same as ProjectView).
- The priority filter applies to both overdue and today. Show 「<n> 件を隠しています (フィルター)」 when any are hidden.

- [ ] **Step 2: Upcoming**

- `useView("upcoming")`. Pass `PageHeader view`.
- Each day's rows go through `arrange(rowsOf(ymd), { ...view, group: "none" }, ctx)`, which handles sort and the priority filter.
- `data-drop-day` stays (day drops are not a reorder).

- [ ] **Step 3: Labels**

- `useView("label", label)`. Pass `PageHeader view`.
- Rows go through `arrange(tasks, view, ctx)`; groups render as sections.
- Completed tasks follow `view.done`: show completed tasks with this label when on. Check whether the label view's data includes completed tasks (`labelView` in Rust). If it does not, ledger that `done` has no effect there yet and hide that option for labels, by changing `ALLOWED.label.done` to false and adapting the test.

- [ ] **Step 4: Checks and commit**

Run the Task 3 checks. Take screenshots of D-04 / D-05 / D-06b to confirm they are unchanged with default options.

```bash
git add src
git commit -m "feat: 表示 options on Today, Upcoming and label screens"
```

---

### Task 6: Board layout

**Files:**
- Modify: `src/views/BoardView.tsx`, `src/views/ProjectView.tsx` (layout switch), `src/app/Main.tsx`, `src/stories/screens/Desktop.stories.tsx`

**Interfaces:**
- Consumes: `useView` (Task 3); ②'s `ActionRow` / `RowActions`; ③'s `DragCtx` and the data-* contract.
- Produces: `ProjectView` renders `BoardView` when `view.layout === "board"`.

- [ ] **Step 1: Board on real data**

- Rework `BoardView` to take `{ project, tasks, sections, view, today, onOpenTask, onToggleDone }`.
- Drop the story-only `dragging` prop, or keep it for D-10.
- Columns:
  - 未分類, only when it has tasks;
  - each section in order;
  - 完了, when `view.done`.
- Column width 272, gap 16, horizontal scroll. Header: name and count.
- Each column's cards:
  - `arrange(columnTasks, { ...view, group: "none", done: false }, ctx)`;
  - each card is an `ActionRow` with the same `rowProps` as the list, without indent;
  - a subtask count chip, with no nested subtasks;
  - a 「タスクを追加」 editor (②) at the end of the column, adding to that section.

- [ ] **Step 2: Board drag**

Each column is a drop list:
- `data-drop-list="project" data-level0="0"` on the column body;
- its cards carry `data-row data-row-kind="task" data-key data-no data-depth="0" data-parent="" data-section="<column section or empty>"`;
- a `data-row data-row-kind="slot" data-section=...` wrapper on the column's add row, so an empty column takes drops.

The engine's `find` takes the closest `[data-drop-list]` under the pointer, so each column is its own list. Cards start drags with `view: "project"`, depth 0 and height 0. Onto drops must be off on the board (cards do not nest there): pass the `subtree` as usual, but give the board's drag source `height: 2`, the same trick Today uses.

While `sorted`:
- the column body keeps `data-drop-list`, but its rows get no `data-row` except the slot, so drops land at the column end (spec ⑤ §4);
- placements across columns change the section.

Main's `onDrop` "place" branch already saves through `moveWithin`. Check that the placement section is the column's.

- [ ] **Step 3: Story and checks**

Update 「D-10 ボード」 to the new props, and add 「D-10b ボードのドラッグ中」 using the story-only preview pattern from ③ Task 6 (`dragPreview`). Use storyboard id `pend14` for D-10b; D-10 keeps its id.

Run the Task 3 checks and drive the board in a story over CDP: a card moved to another column changes the section.

```bash
git add src design/storyboard.md
git commit -m "feat: board layout for projects (section columns, drag between columns)"
```

---

### Task 7: design.pen and storyboard

**Files:**
- Modify: `design.pen` (worktree copy), `design/storyboard.md`

- [ ] **Step 1: Ask the owner to open the worktree `design.pen`, and confirm it with `mcp__pencil__get_app_state`**

- [ ] **Step 2: Draw**

- D-01s, D-01t, D-01u: copies of D-01 (NtCIj) or D-01h (KrLo2):
  - D-01s: the menu as an absolute overlay under the 「表示」 button (`layoutPosition: "absolute"`, as D-07's popover);
  - D-01t: group headers 優先度 1..4;
  - D-01u: the hidden-count line.
- Redraw D-10 (g1hRlk) to the ④ look, and add D-10b with a card being dragged between columns (the red line, card and shadow from ③).

Take a screenshot of each frame in a separate execute call.

- [ ] **Step 3: Fill the storyboard ids**

Replace `pend11`..`pend14` with the pen ids. Add transitions:

```
| D-01 | 上の帯の「表示」 | D-01s | メニュー |
| D-01s | グループ: 優先度 | D-01t | 優先度の見出し |
| D-01s | フィルター: 優先度 1 | D-01u | 隠した件数 |
| D-01s | レイアウト: ボード | D-10 | セクションの列 |
| D-10 | カードを別の列へ | D-10b | 列の間のドラッグ |
```

- [ ] **Step 4: Check stories; the owner saves; commit**

Run: `npm run build-storybook >/dev/null 2>&1; npm run check:stories 2>&1 | grep missing`
Expected: `missing: none`.

```bash
git add design.pen design/storyboard.md
git commit -m "design: view menu, priority groups, filtered list, board"
```

---

## Manual checklist (for the PR body)

- [ ] Project:
  - sort by each key and both directions;
  - group by date / added / priority / label (a task with two labels appears twice);
  - filters (date ranges with the week start setting, created, priority) and the hidden count;
  - completed tasks; reset; the dot on 「表示」.
- [ ] The same options on another PC after a sync. A renamed project keeps its options.
- [ ] Sorted or grouped: a handle press shows the toast; 「戻す」 restores manual order exactly. Sidebar drops still work.
- [ ] Board:
  - columns per section; drag within and across columns;
  - while sorted, only across (to the end);
  - add a task in a column.
- [ ] Today: sort and group; manual keeps the Today order and its drag.
- [ ] Upcoming: priority filter and sort within days; day drops.
- [ ] Label view options.
- [ ] Dark theme.
