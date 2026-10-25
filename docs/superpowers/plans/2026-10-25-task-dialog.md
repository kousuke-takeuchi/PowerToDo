# Task dialog (①a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the right-hand task detail panel with a centered dialog that opens from any view without leaving it, moves to the previous / next task, and can change the task's project / section and labels.

**Architecture:**
- The panel's content (`TaskDetailPanel`, 465 lines) is reshaped into `TaskDialog`: a centered modal with a header, a left column (check, title, description, subtasks) and a right column (property rows and their pickers).
- `Main` stops navigating to the task's project to open it. It keeps `dialog: { project, no } | null` and reads the task through `useProject`: the current one when the task is in the open project, otherwise a second, enabled-on-demand instance.
- Previous / next comes from the visible row order (`visibleKeys`) through a small pure function.
- Comments are not part of this plan (①b, its own plan).

**Tech Stack:** React 19, TypeScript, motion 14, lucide-react, Storybook 10, Pencil MCP for `design.pen`.

**Spec:** `docs/superpowers/specs/2026-10-25-task-dialog-and-comments-design.md` (PR #47), §1, §2, §7.

**Prerequisite:**
- Merge #46 (④ look) and #47 (spec) first.
- Start the implementation branch from origin/main after that. Line numbers below refer to the #46 tree; anchor on the quoted code.

## Global Constraints

- Desktop only. iPhone (`MobileMain`, `src/views/mobile/*`, `MobileTaskDetail`) is unchanged.
- Dialog size:
  - Width `min(864px, calc(100vw - 32px))`, height `min(820px, calc(100vh - 64px))`, centered.
  - Radius 12, `var(--shadow-dialog)`.
  - Backdrop `var(--color-scrim)`.
- Motion: opening about 0.1 s (opacity, no scale), closing about 0.08 s. Moving to the previous / next task swaps the content at once. Go through `useMotionTiming()`, so reduced motion means instant.
- Header 48 px with a bottom border. Right column about 260 px wide on `var(--color-bg-sidebar)`.
- Below 750 px (`layoutFor(...) === "narrow"` from `src/app/shellLayout.ts`), the right column goes under the left one.
- Keys while the dialog is open:
  - `k` previous, `j` next.
  - Esc closes the top layer first (pickers), then the dialog.
  - Keys do nothing while typing or during IME composition (`isTypingTarget`, `isImeKey`).
- After closing, row focus returns to the row that was focused or opened.
- Completing, deleting or moving the task inside the dialog moves to the next task. If there is none, the dialog closes.
- No comment input in this plan. The existing mock comment list is removed from the real app's dialog. It stays only in stories that pass `comments`.
- `design.pen`:
  - The owner opens the worktree copy, and its path is checked with `mcp__pencil__get_app_state`.
  - The owner saves with ⌘S.
  - Never write the main checkout's copy.
- Commits: no `Co-Authored-By` or any AI trailer.

## Review Focus

1. **A task in another project opened from Today.** Editing it in the dialog updates that project's file (not the open project's) and the Today list refreshes. Covered by the manual check, and by `dialogTarget` (Task 1) choosing the right source.
2. **Moving the task to another project from the dialog.** The task gets a new No. in the target. The dialog must either follow it (same task, new key) or go to the next one. The spec says next or close; check that no stale `{project, no}` points at a different task.
3. **j / k at the ends.** No wrap; the arrow is disabled. Test: `neighbors_at_the_ends` (Task 1).
4. **The open task disappears** (deleted elsewhere, sync removed it). The dialog closes and does not show another task with that No. Covered in Task 3 Step 5.
5. **Esc order with a picker open.** The picker closes first, then the dialog (existing `useEscLayer` stacking).

---

### Task 1: Previous / next and the dialog's data source (pure)

**Files:**
- Create: `src/app/dialogNav.ts`, `src/app/dialogNav.test.ts`

**Interfaces:**
- Produces:
  - `neighbors(keys: string[], key: string): { prev?: string; next?: string }`
  - `afterRemoval(keys: string[], key: string): string | null` (the key to show after the current task leaves: the next one, else the previous one, else null)
  - `dialogTarget(dialog: { project: string; no: number } | null, current: string, projectScreen: boolean): "none" | "current" | "other"`
  - `parseKey(key: string): { project: string; no: number }`. It is the inverse of `taskKey` (`${project}/${no}`) and splits at the **last** `/`.

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { afterRemoval, dialogTarget, neighbors, parseKey } from "./dialogNav.ts";

const keys = ["仕事/1", "仕事/3", "買い物/2"];

test("neighbors_in_the_middle", () => {
  assert.deepEqual(neighbors(keys, "仕事/3"), { prev: "仕事/1", next: "買い物/2" });
});

test("neighbors_at_the_ends", () => {
  assert.deepEqual(neighbors(keys, "仕事/1"), { prev: undefined, next: "仕事/3" });
  assert.deepEqual(neighbors(keys, "買い物/2"), { prev: "仕事/3", next: undefined });
});

test("neighbors_of_a_key_not_shown", () => {
  assert.deepEqual(neighbors(keys, "読書/9"), { prev: undefined, next: undefined });
});

test("afterRemoval_prefers_next_then_prev", () => {
  assert.equal(afterRemoval(keys, "仕事/3"), "買い物/2");
  assert.equal(afterRemoval(keys, "買い物/2"), "仕事/3");
  assert.equal(afterRemoval(["仕事/1"], "仕事/1"), null);
});

test("dialogTarget_chooses_the_source", () => {
  assert.equal(dialogTarget(null, "仕事", true), "none");
  assert.equal(dialogTarget({ project: "仕事", no: 1 }, "仕事", true), "current");
  assert.equal(dialogTarget({ project: "仕事", no: 1 }, "仕事", false), "other");
  assert.equal(dialogTarget({ project: "買い物", no: 1 }, "仕事", true), "other");
});

test("parseKey_splits_at_the_last_slash", () => {
  assert.deepEqual(parseKey("a/b/12"), { project: "a/b", no: 12 });
});
```

`dialogTarget(..., projectScreen=false)` is "other": on Today the `current` project's `useProject` may still hold a view, but `Main` only trusts it on the project screen.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:web`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
/** Spec ① §2.5: previous / next follow the order of the rows on screen (row focus keys, `taskKey`). */
export function neighbors(keys: string[], key: string): { prev?: string; next?: string } {
  const i = keys.indexOf(key);
  if (i < 0) return { prev: undefined, next: undefined };
  return { prev: keys[i - 1], next: keys[i + 1] };
}

/** The task to show after the current one left the list (completed, deleted, moved): next, else previous. */
export function afterRemoval(keys: string[], key: string): string | null {
  const { prev, next } = neighbors(keys, key);
  return next ?? prev ?? null;
}

/** Which `useProject` holds the dialog's task: the open project's (only on its own screen) or a second one. */
export function dialogTarget(
  dialog: { project: string; no: number } | null,
  current: string,
  projectScreen: boolean,
): "none" | "current" | "other" {
  if (!dialog) return "none";
  return projectScreen && dialog.project === current ? "current" : "other";
}

/** Inverse of `taskKey` (`${project}/${no}`); a project name may contain "/". */
export function parseKey(key: string): { project: string; no: number } {
  const i = key.lastIndexOf("/");
  return { project: key.slice(0, i), no: Number(key.slice(i + 1)) };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:web`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/dialogNav.ts src/app/dialogNav.test.ts
git commit -m "feat(dialog): previous / next and data source helpers"
```

---

### Task 2: TaskDialog (layout and the existing editors)

**Files:**
- Create: `src/views/TaskDialog.tsx`
- Modify: `src/views/TaskDetailPanel.tsx`. Export `PropRow`, `PRIORITIES` and the popover pieces the dialog reuses. The panel component itself is deleted in Task 4, once nothing uses it.

**Interfaces:**
- Produces:

```ts
export type TaskDialogProps = TaskDetailPanelProps & {
  /** "プロジェクト / セクション" in the header; clicking it calls this. */
  onOpenProject?: () => void;
  onPrev?: () => void; // undefined = arrow disabled
  onNext?: () => void;
  /** Width class from `layoutFor`: "narrow" stacks the columns. */
  layout?: "wide" | "narrow";
  /** Task 3 fills these. */
  projects?: { name: string; sections: string[] }[];
  onMove?: (toProject: string, toSection: string | null) => void;
  allLabels?: string[];
};
export function TaskDialog(p: TaskDialogProps): JSX.Element;
```

- [ ] **Step 1: Read `TaskDetailPanel.tsx` in full**

Note every piece of state and every editor: title and description drafts, popover state and anchor, date / recurrence / reminder / priority pickers, subtasks with the add form, delete confirmation, Esc layers, outside-click close.

The dialog keeps all of it. Only the layout changes.

- [ ] **Step 2: Build `TaskDialog`**

- Overlay:
  - A full-window backdrop (`position: fixed; inset: 0; background: var(--color-scrim)`).
  - Clicking the backdrop itself calls `onClose`.
  - Wrapped by the caller in `AnimatePresence`.
  - Backdrop and dialog fade: `t(0.1)` in, `t(0.08)` out.
- Dialog box: the sizes from Global Constraints, `display: grid`.
  - Wide: `gridTemplateRows: "48px 1fr"` and `gridTemplateColumns: "1fr 260px"`.
  - Narrow: a single column with the right column after the left.
- Header (spans both columns):
  - Left: `Folder` icon and `${project.name}${section ? " / " + section : ""}` as a button calling `onOpenProject`.
  - Right:
    - `ChevronUp` (`onPrev`, disabled when undefined, `aria-label="前のタスク"`)
    - `ChevronDown` (`onNext`, `aria-label="次のタスク"`)
    - `Ellipsis` menu with one item 「削除」 (the existing delete confirmation)
    - `X` (`onClose`)
- Left column (scrolls):
  - Checkbox 18 and the title input (fontSize 20, bold).
  - Description textarea (placeholder 「説明」).
  - The subtasks block as in the panel.
- Right column (`var(--color-bg-sidebar)`, padding 16, scrolls): rows separated by `var(--color-border)`.
  - プロジェクト (Task 3 makes it a picker; here it shows the value)
  - 日付
  - 優先度
  - ラベル (Task 3)
  - リマインダー
  - 繰り返し
- Pickers:
  - Positioned under the clicked row inside the right column, using the panel's `anchorTop` logic. The anchor is now the right column, so set `position: relative` on it.
  - On narrow layout, anchor under the row in the single column.
- Esc layers: keep the panel's two layers (dialog, then picker).
- Key handler while open: `k` / `j` call `onPrev` / `onNext` unless `isTypingTarget(e.target)` or `isImeKey(e)`.
  - Use the existing `src/app/keys.ts` helpers.
  - Register it on `window` in an effect that depends on `onPrev` / `onNext`.
- Focus: on open, focus the dialog container (`tabIndex={-1}`) so Esc and j/k work without a click.

- [ ] **Step 3: Storybook story**

In `src/stories/screens/Desktop.stories.tsx`, replace the D-03 story (タスク詳細):
- Render the D-01 screen with `<TaskDialog ... />` in `overlay`.
- Use the same task the panel story used, and keep `comments` (mock) for the look.
- Add `D03Narrow`, name 「D-03b タスク詳細 (狭いウィンドウ)」, at width 700 with `layout="narrow"`.
- Do the same for the dark story (`screens-dark--d-03-dark`).

- [ ] **Step 4: Build and look**

Run: `npm run build && npm run test:web`
Expected: exit 0.

Screenshot `screens-desktop--d-03` at 1512×940 and `--d-03-b` at 700×600 with headless Chrome (the command in `docs/superpowers/plans/2026-10-25-desktop-look.md` Task 9). Check:
- Centered dialog with header, two columns, scrim.
- Narrow stacks the columns.
- No overflow.

- [ ] **Step 5: Commit**

```bash
git add src/views/TaskDialog.tsx src/views/TaskDetailPanel.tsx src/stories
git commit -m "feat(dialog): centered task dialog with the existing editors"
```

---

### Task 3: Project / section and label pickers

**Files:**
- Modify: `src/views/TaskDialog.tsx`
- Create: `src/views/ProjectPicker.tsx`, `src/views/LabelPicker.tsx`

**Interfaces:**
- Consumes: `projects`, `onMove`, `allLabels`, `onChange` (`labels` patch) from `TaskDialogProps`.
- Produces:
  - `ProjectPicker({ projects, current: { project, section }, onPick(project, section|null), onClose })`
  - `LabelPicker({ labels: string[], selected: string[], onToggle(name), onClose })`

- [ ] **Step 1: ProjectPicker**

- A popover list built with `PopoverShell` / `PopRow`, like the other pickers.
- Each project is shown, and under it its sections, indented 16.
- The current project / section has a check mark.
- A text field at the top filters by name (case-insensitive substring).
- Enter picks the first match.
- Picking calls `onPick` and closes.

- [ ] **Step 2: LabelPicker**

- A popover with a filter field and the label list, each with a checkbox (selected = in `task.labels`).
- Clicking toggles. The popover stays open.
- When the filter text matches no label, a row 「「name」を作成」 adds it to the task.
- Labels are created implicitly by being used. Check how `QuickAdd` adds unknown `%labels` (`src-tauri/src/commands`, `labels`) and follow it.
  - If an unknown label in `TaskPatch.labels` is rejected by Rust, create it first through the existing label command, and record a ruling.

- [ ] **Step 3: Wire into the dialog**

- The プロジェクト row opens `ProjectPicker`. Picking calls `onMove(project, section)`.
- The ラベル row opens `LabelPicker`. Each toggle calls `onChange({ labels: next })`.

- [ ] **Step 4: Build, story, commit**

Add a story `D03Project` with the project picker open.

Run: `npm run build && npm run test:web`
Expected: exit 0.

```bash
git add src/views
git commit -m "feat(dialog): move to another project or section, add or remove labels"
```

---

### Task 4: Main wiring (open anywhere, previous / next, after removal)

**Files:**
- Modify: `src/app/Main.tsx`, `src/app/useRowShortcuts.ts`, `src/app/useProject.ts`, `src/views/AppShell.tsx` (drop `panel`), `src/views/TaskDetailPanel.tsx` (delete the component once unused; keep exported pieces or move them into `TaskDialog.tsx`)

**Interfaces:**
- Consumes: Task 1 helpers, `TaskDialog`.
- Produces:
  - `useProject(name, { enabled?: boolean })`. When `enabled === false`, no load and no listeners; `view` is null.
  - Main state: `dialog: { project: string; no: number } | null`, replacing `openNo`.

- [ ] **Step 1: `useProject` enabled flag**

- Add `enabled?: boolean` (default true) to `UseProjectOptions`.
- When false: skip the initial load and the event listeners, and keep `view` null.
- Read the hook first and gate exactly the effects that load or listen.

- [ ] **Step 2: Second project source**

In `Main`:

```ts
const [dialog, setDialog] = useState<{ project: string; no: number } | null>(null);
const target = dialogTarget(dialog, current, projectScreen);
const other = useProject(target === "other" && dialog ? dialog.project : current, { enabled: target === "other" });
const src = target === "current" ? p : other; // the useProject that holds the dialog's task
const dlgView = target === "none" ? null : src.view;
const dlgTask = dialog && dlgView && dlgView.project.name === dialog.project ? dlgView.tasks.find((t) => t.no === dialog.no) : undefined;
```

After each mutation through `other`, call `refreshAll()`, so Today / Upcoming / labels and the project screen show the change.

- [ ] **Step 3: Open without navigating**

- `openAny` (`useRowShortcuts.ts`) and `openTaskAt` (`Main.tsx`) set `dialog` and `focus.set(taskKey(t))`. They no longer `navigate(...)`.
- Remove `pendingOpen` and its effect. The dialog shows nothing until `dlgTask` exists, and closes if the task is missing after the load (Step 5).
- Reminder notifications that open a task use `openTaskAt` too, so they also open the dialog in place.
- Keep the 「タスクが見つかりません」 flash when the project is gone.

- [ ] **Step 4: Previous / next**

```ts
const key = dialog ? `${dialog.project}/${dialog.no}` : null;
const { prev, next } = key ? neighbors(visibleKeys, key) : {};
const go = (k?: string) => k && (setDialog(parseKey(k)), focus.set(k));
```

Pass `onPrev={prev ? () => go(prev) : undefined}` and `onNext` likewise.

- [ ] **Step 5: After completing, deleting or moving, and a vanished task**

- Completing (`onToggleDone(true)`), deleting and `onMove`: compute `afterRemoval(visibleKeys, key)` **before** the call, then `go(...)` to it or `setDialog(null)`.
  - Completion keeps the undo toast (`completed(t)`) as in #46.
  - For the project screen, leaving tasks stay in `visibleKeys` for `LEAVE_DELAY_MS`, so take the neighbor from the list as it was before the call.
- `onMove`:

```ts
api.moveTask(dialog.project, dialog.no, toProject, toSection)
```

  then `refreshAll()`, and through `p.reload()` when the open project is involved. `MoveOutcome` has `from` / `to` views.
- Vanished: an effect closes the dialog when `dlgView` is loaded for `dialog.project` and has no task with `dialog.no`. It never switches to another task.

- [ ] **Step 6: Closing returns focus**

- `onClose` sets `dialog` to null and leaves `focus` on the key it had.
- Remove `AppShell`'s `panel` prop and its animated aside.
- Render the dialog in `overlay` inside `AnimatePresence`, so it sits above the top bar (`zIndex 20`).

- [ ] **Step 7: Build, test, look**

Run: `npm run build && npm run test:web && npm run build-storybook && npm run check:stories`
Expected: all exit 0.

Then run the app if possible (`npm run tauri dev`). Never with `-v`.
- Open a task from Today: the dialog shows and the view stays Today.
- j / k move.
- Move to another project from the dialog.
- Esc: the picker closes first, then the dialog.

If the app cannot run here, record that in the ledger and leave the checks to the PR checklist.

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "feat(dialog): open tasks in place, previous / next, close or move on after removal"
```

---

### Task 5: design.pen and storyboard

**Files:**
- Modify: `design.pen` (worktree copy), `design/storyboard.md`

- [ ] **Step 1: Owner opens the worktree copy**

Check with `mcp__pencil__get_app_state` that the active editor is the worktree's `design.pen`. Stop if it is not.

- [ ] **Step 2: Redraw D-03 and its dark copy as the dialog**

- Copy D-01 behind a scrim, and draw the dialog in the middle: header, left column, right column with the rows.
- Add D-03b (narrow, 700 wide, stacked).
- Remove the right-hand panel from those frames.
- Use the existing components (Checkbox, TaskRow for subtasks, IconButton) as instances.

- [ ] **Step 3: Storyboard**

Update `design/storyboard.md`:
- The rows for D-03 and the dark D-03 keep their node ids if the frames were redrawn in place.
- Add D-03b with its new id.
- Update the D-03 notes to the dialog.

Run `npm run build-storybook && npm run check:stories`. Expected: missing none.

- [ ] **Step 4: Owner saves (⌘S), then commit**

Check that the main checkout's `design.pen` has none of the new node ids.

```bash
git add design.pen design/storyboard.md
git commit -m "design: task detail as a centered dialog"
```

---

## PR checklist (manual)

- [ ] Today / Upcoming / label / search: clicking a row opens the dialog over the same view
- [ ] ∧ ∨ and k / j move in screen order, with no wrap
- [ ] Esc: closes a picker first, then the dialog; the row stays selected
- [ ] Edit the title, description, date, priority, reminders and repeat of a task from another project while on Today: saved in that project; Today updates
- [ ] Move to another project / section from the dialog: the dialog goes to the next task (or closes); the task is in the new place
- [ ] Add / remove labels, and create a new one
- [ ] Complete inside the dialog: the next task opens; the toast's 元に戻す works
- [ ] Window 700: the columns stack
- [ ] Dark theme and reduced motion
