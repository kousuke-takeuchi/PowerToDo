# Desktop look (Todoist-like layout, density, motion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the desktop screens' layout, density and motion close to the Todoist desktop app (spec ④), keeping PowerToDo's colors and icons, and update `design.pen` and Storybook to match.

**Architecture:** Mostly presentational changes in existing components (`TaskRow`, `Checkbox`, `SectionHeader`, `SidebarItem`, `ProjectItem`, `Sidebar`, `HeaderActions`, `AppShell`). Two pieces of logic are pure and tested with `node --test`:
- `src/app/shellLayout.ts`: wide or narrow by window width.
- `src/app/completionToast.ts`: merging completions into one toast and deciding how each undo is done.

A new `TopBar` and `Toast` component are wired in `Main`. `design.pen` is edited through the Pencil MCP at the end, with the owner saving it.

**Tech Stack:** React 19, TypeScript, motion 14, Tailwind 4 (a few classes), lucide-react, Storybook 10, Tauri 2.12.3 (`tauri.conf.json`), Pencil MCP (`mcp__pencil__*`).

**Spec:** `docs/superpowers/specs/2026-10-25-desktop-look-design.md` (PR #44). Research: `docs/research/2026-10-25-todoist-desktop-look-and-motion.md`.

**Prerequisite:** Merge #44 first. Start the implementation branch from origin/main after that.

## Global Constraints

- Desktop only. `variant="mobile"` rendering of `TaskRow`, `MobileMain` and `src/views/mobile/*` must look and behave exactly as before.
- Colors stay the current tokens (`src/styles/tokens.css`). Icons stay lucide-react. No Todoist logo, icon assets or name in the UI.
- Font: `--font-body: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Segoe UI", "Yu Gothic UI", "Noto Sans JP", system-ui, sans-serif`.
- Sizes from the spec:
  - Row height: about 43 for 1 line, about 59 for 2 lines.
  - Checkbox: 18 across, 2 border.
  - Indent: 28 per level.
  - Sidebar: 280 wide. Center column: at most 800 wide.
  - Page title: 26 bold.
- Motion must go through `useMotionTiming()` so `prefers-reduced-motion` gives instant changes.
  - Instant (no motion): hover reveal, and section/subtask collapse.
  - Sidebar hide/show: about 0.3 s.
  - Completion: the row stays about 0.25 s before it leaves, then leaves in about 0.1 s.
  - Narrow-window drawer: about 0.2 s.
- Narrow layout below 750 px window width. `tauri.conf.json` `minWidth` becomes 400.
- Dark theme (`html[data-theme="dark"]`) must stay readable: use tokens, never fixed colors (white on accent excepted, as today).
- The verification screenshots of Todoist show the owner's data. Never commit them or attach them to the PR. Write only the measured numbers.
- `design.pen`:
  - Edit only the worktree's copy.
  - The main checkout's `design.pen` has uncommitted changes; never touch it.
  - Pencil MCP writes into the file open in Pencil, so check `get_app_state` first. The owner saves with ⌘S.
- Commits: no `Co-Authored-By` or any AI trailer.
- Sample data in stories: たろう, 仕事, 買い物; no real names.

## Review Focus

1. **Undo of a recurring task.** Completing it moves `due` to the next date (it never becomes done). Undo must put back the previous `due`, `dueTime` and `reminders`, not call `completeTask(false)`. Test: `undoOf_recurring_restores_the_date` (Task 7).
2. **Several completions inside the toast's life.** One toast with the count, and undo puts back all of them. Test: `merge_counts_and_keeps_every_entry` (Task 7).
3. **Window exactly 750 px.** It is wide (the spec says hide below 750). Test: `layoutFor_boundary` (Task 6).
4. **Keyboard focus without hover.** The row's buttons and the handle must still show on the focused row (today `focused` shows the actions). Check in the D-01 story with focus (Task 3 step).
5. **A task completed in a cross view whose project is not loaded.** Undo goes through `api.*` with the task's own project, then refreshes. Test: `undoOf_plain_completes_false` asserts the project/no used (Task 7).

---

### Task 1: Font, title and header subtitle

**Files:**
- Modify: `src/styles/tokens.css` (`--font-body`)
- Modify: `src/views/HeaderActions.tsx` (`titleStyle`, `TitleGroup`)
- Modify: `src/views/TodayView.tsx`, `src/views/LabelDetailView.tsx` (subtitle text)

**Interfaces:**
- Produces: `TitleGroup({ title, subtitle })` renders the subtitle on its own line under the title, with a `CircleCheck` icon (lucide, 14) before it.

- [ ] **Step 1: Change the font token**

In `src/styles/tokens.css`, replace the `--font-body` line with:

```css
  --font-body: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Segoe UI", "Yu Gothic UI", "Noto Sans JP", system-ui, sans-serif;
```

- [ ] **Step 2: Title 26 and the subtitle under it**

In `src/views/HeaderActions.tsx`:

```tsx
export const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 26,
  lineHeight: "36px",
  fontWeight: 700,
  color: "var(--color-text-primary)",
};

const subtitleStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  fontSize: 13,
  lineHeight: "19px",
  color: "var(--color-text-secondary)",
};

/** Title, and under it the subtitle with a check icon (Todoist: 「✓ 6 件のタスク」). */
export function TitleGroup({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <h1 style={titleStyle}>{title}</h1>
      <span style={subtitleStyle}>
        <CircleCheck size={14} aria-hidden />
        {subtitle}
      </span>
    </div>
  );
}
```

Add `CircleCheck` to the lucide import.

- [ ] **Step 3: Subtitle texts**

- `TodayView.tsx`: `subtitle={`${total} 件のタスク`}`. The date moves to the section names: `今日 · ${monthDay(today)}` becomes `${monthDay(today)} · 今日 · ${weekdayLong(today)}`. Show that section header always, also when there is no overdue group; its `count` is dropped.
- `LabelDetailView.tsx`: `subtitle={`${list.length} 件のタスク`}`.
- `ProjectView.tsx` and `UpcomingView.tsx` build their own `<h1 style={titleStyle}>`. Leave the title there, and add the same subtitle line under it (`N 件のタスク`, open tasks of the view) using a new exported `Subtitle({ text })` from `HeaderActions.tsx` that `TitleGroup` also uses.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exits 0 (tsc and vite build).

- [ ] **Step 5: Commit**

```bash
git add src/styles/tokens.css src/views/HeaderActions.tsx src/views/TodayView.tsx src/views/LabelDetailView.tsx src/views/ProjectView.tsx src/views/UpcomingView.tsx
git commit -m "style(desktop): system font, larger title, task count under it"
```

---

### Task 2: Checkbox

**Files:**
- Modify: `src/components/Checkbox.tsx`

**Interfaces:**
- Produces: `CheckboxProps.size?: 18 | 20` (default 18). Mobile callers that relied on 20 must pass `size={20}`. Find them with `grep -rn "<Checkbox" src/views/mobile src/components`.

- [ ] **Step 1: Size, border and tint**

In `Checkbox`:
- `size = 18` default; widen the prop type to `18 | 20`.
- `border: \`2px solid ${color}\``.
- Background when not checked and priority 1-3: `color-mix(in srgb, ${priorityVar[priority]} 10%, transparent)`. Priority 4: `transparent`.
- The check path scales with the box: use `viewBox="0 0 12 12"` with `width={size * 0.6}` and `height={size * 0.6}`.

- [ ] **Step 2: Hover preview**

Wrap the svg so that, when not checked, a grey check is shown on hover with no transition:
- Add `className="group/check"` to the button.
- Render a second `<svg>` (same path, stroke `var(--color-text-muted)`, strokeWidth 2) with `className="opacity-0 group-hover/check:opacity-100"`.
- Render it only when `!checked`. The motion path stays for the checked state.

- [ ] **Step 3: Pass `size={20}` in mobile callers**

Every `<Checkbox` under `src/views/mobile/` and the mobile branch of `TaskRow` (`variant === "mobile"`) gets `size={20}`.

- [ ] **Step 4: Build and look**

Run: `npm run build`
Expected: exit 0.

Run Storybook (`npm run storybook -- -p 6107 --ci --no-open`) and open `components-checkbox--*` and `screens-desktop--d-01`. Expected: 18 px circles, tinted P1-P3, grey check on hover, mobile stories unchanged (`screens-mobile--m-01`).

- [ ] **Step 5: Commit**

```bash
git add src/components/Checkbox.tsx src/components/TaskRow.tsx src/views/mobile
git commit -m "style(desktop): Todoist-like checkbox (18 px, tinted priority, hover preview)"
```

---

### Task 3: Task row

**Files:**
- Modify: `src/components/TaskRow.tsx`
- Modify: `src/views/crossList.tsx` (pass section for the right-hand project label)

**Interfaces:**
- Consumes: `Checkbox` (Task 2).
- Produces:
  - `TaskRowProps.project?: string` keeps its meaning (the project name). New `TaskRowProps.section?: string` and `TaskRowProps.projectColor?: string` (a CSS color var).
  - Desktop: they render right-aligned on the meta line as `project / section` and a colored `Hash` icon.

- [ ] **Step 1: Desktop metrics**

In `TaskRow` (desktop branch only, keep mobile values):
- `indentPx = (p.indent ?? 0) * (mobile ? 24 : 28)`.
- Row padding `8px 0`. The title stays at `fontSize: 14, lineHeight: "20px"`. Meta line gap 2.
- Target heights: 43 for 1 line, 59 for 2 lines. If Hiragino's line box differs, change only the padding to hit them, and note the values.
- Hover background:
  - Desktop has none. Remove `bg-[var(--color-bg-hover)]` from the desktop focused className.
  - Focus is shown as a ring instead: `boxShadow: "inset 0 0 0 1px var(--color-border), inset 0 -1px 0 var(--color-border)"` with `borderRadius: 6`.
  - Mobile keeps today's focus style.

- [ ] **Step 2: Right-aligned project on the meta line (desktop)**

Desktop meta line:

```tsx
<div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
  {/* date, recurring, labels, more, subtasks as today (without the project span) */}
  {!mobile && p.project && (
    <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, lineHeight: "17px", color: "var(--color-text-secondary)" }}>
      {p.section ? `${p.project} / ${p.section}` : p.project}
      <Hash size={12} color={p.projectColor ?? "var(--color-text-muted)"} aria-hidden />
    </span>
  )}
</div>
```

Mobile keeps the project span where it is today. The meta line must render when only `project` is set (it does today).

- [ ] **Step 3: Hover handle and instant actions**

- Add, desktop only, a 6-dot handle absolutely placed 29 px left of the checkbox, vertically centered on the first line:
  - Icon: lucide `GripVertical` 16, `var(--color-text-muted)`.
  - `className="opacity-0 group-hover:opacity-100"`, also visible when `focused`.
  - `aria-hidden`. Clicks pass to nothing yet (③ adds dragging).
- The subtask chevron (`left: -24`) and the handle would overlap. Move the chevron to `left: -48` when the handle is shown? No: Todoist puts the chevron where the handle is and shows the handle only on hover. Keep the chevron at `left: -24`, put the handle at `left: -40`, and check in D-01b that they do not overlap.
- Action buttons:
  - Remove the opacity `transition`, so they appear instantly.
  - Order: 編集, 日付, コメント, その他 (as today).
  - Put the action group on the first line: `alignSelf: "flex-start"`.
- Chevron: drop the motion rotate. Render `ChevronDown` when expanded and `ChevronRight` when collapsed, so it switches instantly.

- [ ] **Step 4: Cross views pass project, section and color**

In `src/views/crossList.tsx` (`useCrossRows`), where `project={t.project}` is passed, also pass:
- `section={t.category ?? undefined}`
- `projectColor`: look up the project color from the projects list. Add `projects?: Project[]` to the hook's props if it is not there. `Main` passes `projects` from `useSummaries`.

- [ ] **Step 5: Build and look**

Run: `npm run build`
Expected: exit 0.

In Storybook check:
- `screens-desktop--d-04` (today): project on the right with `#`.
- `--d-01b` (subtasks): indent 28; chevron and handle do not overlap on hover.
- `--d-01` with a focused row (`D01Interactive`, arrow keys): ring, actions visible.
- `screens-mobile--m-01`: unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/TaskRow.tsx src/views/crossList.tsx src/app/Main.tsx
git commit -m "style(desktop): Todoist-like task row (density, right-aligned project, hover handle)"
```

---

### Task 4: Section header and instant collapse

**Files:**
- Modify: `src/components/SectionHeader.tsx`
- Modify: `src/views/TodayView.tsx` (reschedule in the header)
- Modify: `src/views/ProjectView.tsx` (collapse without motion on desktop)

- [ ] **Step 1: Chevron outside the column, instant**

In `SectionHeader`:
- Replace the motion rotate with `collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />`.
- Place the chevron absolutely at `left: -28` of the row (`rowStyle` gets `position: "relative"`). The title then starts at the column's left edge, like task titles.
- Remove `useMotionTiming` and `motion` imports if unused.

- [ ] **Step 2: Reschedule on the same line**

In `TodayView`:
- Pass `trailing={<RescheduleButton today={today} onReschedule={onReschedule} />}` to the 期限切れ `SectionHeader`.
- Delete the separate `div` with `justifyContent: "flex-end"`.
- `rescheduleButton` style: accent color, 13 px, bold.

- [ ] **Step 3: Collapse without motion (desktop)**

In `ProjectView`:
- The section body and the subtask block use `Collapse` (`duration` 0.2).
- Desktop passes `duration={0}`, so open/close is instant. Use the `variant`/mobile flag the view already has; if none, add `instantCollapse?: boolean` to ProjectView props, and Main passes `true`.
- Mobile views keep their motion.
- Keep the row enter/leave `Collapse` (the one with `enterY={-8} exitX={-24}`) for adding and completing; Task 7 changes its timing.

- [ ] **Step 4: Build and look**

Run: `npm run build`
Expected: exit 0.

In Storybook `--d-04`: 再スケジュール on the 期限切れ line. In `--d-01`: section chevron left of the column; collapse is instant.

- [ ] **Step 5: Commit**

```bash
git add src/components/SectionHeader.tsx src/views/TodayView.tsx src/views/ProjectView.tsx src/app/Main.tsx
git commit -m "style(desktop): section headers like Todoist, instant collapse"
```

---

### Task 5: Sidebar

**Files:**
- Modify: `src/components/SidebarItem.tsx`, `src/components/ProjectItem.tsx`, `src/views/Sidebar.tsx`

- [ ] **Step 1: Active style and item height**

`SidebarItem` and `ProjectItem`:
- `padding: "7px 10px"` (about 34 high with the 20 px line).
- When `active`:
  - `background: "var(--color-accent-soft)"`.
  - Label, icon and count: `color: "var(--color-accent)"`, label `fontWeight: 600`.
- Hover (not active): `var(--color-bg-hover)` as today.

- [ ] **Step 2: Projects with a colored `#`**

In `ProjectItem`, replace the 10 px dot with `<Hash size={18} color={color} aria-hidden />` (lucide `Hash`).

- [ ] **Step 3: Add task button**

In `Sidebar`, the 「タスクを追加」 button:
- Icon: a 24 px filled circle `var(--color-accent)` with a white `Plus` 16 inside. Build it as a span with `borderRadius: 12`.
- Label: accent, 14, `fontWeight: 600`.
- Drop `CirclePlus` if no longer used.

- [ ] **Step 4: Build and look**

Run: `npm run build`
Expected: exit 0.

In Storybook `--d-01`, `--d-04` and the dark stories (`screens-dark--*`): active item light red with red text, `#` icons, filled add button.

- [ ] **Step 5: Commit**

```bash
git add src/components/SidebarItem.tsx src/components/ProjectItem.tsx src/views/Sidebar.tsx
git commit -m "style(desktop): sidebar active style, project hash icons, filled add button"
```

---

### Task 6: Top bar, sidebar hide/show, narrow window

**Files:**
- Create: `src/app/shellLayout.ts`, `src/app/shellLayout.test.ts`
- Create: `src/views/TopBar.tsx`
- Modify: `src/app/hooks.ts` (`useShellWidth`), `src/views/AppShell.tsx`, `src/views/Sidebar.tsx`, `src/views/HeaderActions.tsx`, `src/app/Main.tsx`, `src-tauri/tauri.conf.json`

**Interfaces:**
- Produces:
  - `export const NARROW_BELOW = 750;`
  - `export function layoutFor(innerWidth: number): "wide" | "narrow"`
  - `useShellWidth(): 1440 | 960` keeps its return type: `"wide"` maps to 1440 and `"narrow"` to 960. Existing callers and stories keep working; 960 now means the narrow layout without the rail.
  - `TopBar({ left, right })`: a 48 px bar at the top of `main`, outside the 800 column, full width with 16 px side padding.
  - `SidebarProps.onClose?: () => void` wires the existing 「サイドバーを閉じる」 button.

- [ ] **Step 1: Write the failing test** (`src/app/shellLayout.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutFor, NARROW_BELOW } from "./shellLayout.ts";

test("layoutFor_boundary", () => {
  assert.equal(NARROW_BELOW, 750);
  assert.equal(layoutFor(749), "narrow");
  assert.equal(layoutFor(750), "wide");
  assert.equal(layoutFor(1440), "wide");
  assert.equal(layoutFor(400), "narrow");
});
```

Check how `src/app/gestures.test.ts` imports its module (with or without `.ts`) and copy that style.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:web`
Expected: FAIL (module `./shellLayout` not found).

- [ ] **Step 3: Implement**

```ts
/** Spec ④ §7: below this window width the sidebar is hidden and opens over the page. */
export const NARROW_BELOW = 750;

export function layoutFor(innerWidth: number): "wide" | "narrow" {
  return innerWidth < NARROW_BELOW ? "narrow" : "wide";
}
```

In `src/app/hooks.ts`, `useShellWidth` uses `layoutFor(window.innerWidth) === "narrow" ? 960 : 1440` and its doc comment says so.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:web`
Expected: all pass, including `layoutFor_boundary`.

- [ ] **Step 5: AppShell**

`AppShell`:
- New props: `topBar?: React.ReactNode` and `sidebarHidden?: boolean`.
- Wide:
  - The `aside` animates `width` 280 ↔ 0 with `t(0.3)` (motion), with `overflow: hidden` while moving.
  - `main` is centered as today, so the column moves together with it.
  - `topBar` renders first inside `main`, above the banner.
- Width 960 (narrow):
  - No `SidebarRail`. Keep the file; the stories that use it go in Task 8.
  - `main` is full width, with column padding `16px`.

- [ ] **Step 6: TopBar and header actions**

- `TopBar.tsx`: `display: flex; justifyContent: space-between; alignItems: center; height: 48; padding: "0 16px"`.
- `HeaderActions`:
  - Becomes the right side of the top bar: 「表示」 and 「…」 only.
  - 「並び替え」 moves into a new 「表示」 menu with one item, 「並び替え」, that does what it does today. Today it has no handler, so the item is shown disabled. Note this in the ledger.
- `PageHeader`:
  - Renders only its children (the title group).
  - Pages pass their `onMenu` to Main through a callback (`onHeaderMenu`). Main then renders `HeaderActions` in the top bar.
  - If the extra plumbing is larger than about 40 lines, keep `PageHeader` rendering `HeaderActions`, but place it with `position: absolute; top: 0; right: 16px` relative to `main`. Record a ruling.
- Left side of the top bar:
  - When the sidebar is hidden (wide and closed, or narrow), a `PanelLeftOpen` button.
  - Back/forward: Main has no navigation history today, so do not render them (spec: 「無ければ出さない」).

- [ ] **Step 7: Main wiring**

- State `sidebarClosed` (wide).
- `Sidebar onClose` sets it to true. The top bar's open button sets it to false when wide, and opens the drawer when narrow.
- The drawer:
  - Condition becomes `width === 960 && drawer` (it already is).
  - Timings: scrim `t(0.15)`, sidebar slide `t(0.2)` (spec).
- `useEscLayer` stays.

- [ ] **Step 8: Minimum window width**

In `src-tauri/tauri.conf.json` set `"minWidth": 400`.

Check, in Storybook at 400 px wide (`?viewMode=story` with the browser narrowed) and in `npm run tauri dev` if available, that these do not overflow horizontally:
- Quick add (`QuickAddDialog`), search (`SearchDialog`), settings (`SettingsDialog` or the settings panes).

Where a dialog has a fixed `width`, change it to `width: "min(<old>px, calc(100vw - 32px))"`.

- [ ] **Step 9: Build**

Run: `npm run build && npm run test:web`
Expected: both exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/app/shellLayout.ts src/app/shellLayout.test.ts src/app/hooks.ts src/views/TopBar.tsx src/views/AppShell.tsx src/views/Sidebar.tsx src/views/HeaderActions.tsx src/app/Main.tsx src-tauri/tauri.conf.json src/views
git commit -m "feat(desktop): top bar, sidebar hide/show, narrow layout below 750, min width 400"
```

---

### Task 7: Completion timing and the undo toast

**Files:**
- Create: `src/app/completionToast.ts`, `src/app/completionToast.test.ts`
- Create: `src/components/Toast.tsx`
- Modify: `src/views/ProjectView.tsx`, `src/views/crossList.tsx` (`LEAVE_DELAY_MS`), `src/app/Main.tsx`, `src/app/useRowShortcuts.ts`

**Interfaces:**
- Produces (`completionToast.ts`):

```ts
export type Completed = {
  project: string;
  no: number;
  /** Set when the task repeats: what its date was before completing (complete_task moved it on). */
  before?: { due: string | null; dueTime: string | null; reminders: string[] };
};
export type ToastState = { entries: Completed[] };
export function merge(state: ToastState | null, c: Completed): ToastState;
export function toastText(state: ToastState): string; // "1 件のタスクを完了しました"
export type Undo =
  | { kind: "complete"; project: string; no: number; done: false }
  | { kind: "update"; project: string; no: number; patch: { due: string | null; dueTime: string | null; reminders: string[] } };
export function undoOf(c: Completed): Undo;
export function completedOf(t: { project: string; no: number; rrule?: string; due?: string; dueTime?: string; reminders: string[] }): Completed;
```

- [ ] **Step 1: Write the failing tests** (`src/app/completionToast.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { completedOf, merge, toastText, undoOf } from "./completionToast.ts";

test("merge_counts_and_keeps_every_entry", () => {
  let s = merge(null, { project: "仕事", no: 1 });
  assert.equal(toastText(s), "1 件のタスクを完了しました");
  s = merge(s, { project: "買い物", no: 4 });
  assert.equal(toastText(s), "2 件のタスクを完了しました");
  assert.deepEqual(s.entries.map((e) => `${e.project}/${e.no}`), ["仕事/1", "買い物/4"]);
});

test("merge_same_task_twice_keeps_one", () => {
  const s = merge(merge(null, { project: "仕事", no: 1 }), { project: "仕事", no: 1 });
  assert.equal(s.entries.length, 1);
});

test("undoOf_plain_completes_false", () => {
  assert.deepEqual(undoOf({ project: "買い物", no: 4 }), { kind: "complete", project: "買い物", no: 4, done: false });
});

test("undoOf_recurring_restores_the_date", () => {
  const c = completedOf({ project: "仕事", no: 2, rrule: "FREQ=WEEKLY", due: "2026-10-25", dueTime: "09:00", reminders: ["-0m"] });
  assert.deepEqual(undoOf(c), {
    kind: "update",
    project: "仕事",
    no: 2,
    patch: { due: "2026-10-25", dueTime: "09:00", reminders: ["-0m"] },
  });
});

test("completedOf_plain_has_no_before", () => {
  assert.equal(completedOf({ project: "仕事", no: 3, reminders: [] }).before, undefined);
});
```

Check the `Task` type's field names in `src/types/model.ts` (`rrule`, `due`, `dueTime`, `reminders`) before writing; adapt the test if they differ.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:web`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `completionToast.ts`**

```ts
export type Completed = {
  project: string;
  no: number;
  before?: { due: string | null; dueTime: string | null; reminders: string[] };
};
export type ToastState = { entries: Completed[] };

/** Adds a completion to the toast (one toast for completions in a row; the same task once). */
export function merge(state: ToastState | null, c: Completed): ToastState {
  const entries = (state?.entries ?? []).filter((e) => !(e.project === c.project && e.no === c.no));
  return { entries: [...entries, c] };
}

export function toastText(state: ToastState): string {
  return `${state.entries.length} 件のタスクを完了しました`;
}

export type Undo =
  | { kind: "complete"; project: string; no: number; done: false }
  | { kind: "update"; project: string; no: number; patch: { due: string | null; dueTime: string | null; reminders: string[] } };

/** A repeating task never becomes done: complete_task moved its date on, so undo puts the old date back. */
export function undoOf(c: Completed): Undo {
  if (c.before) return { kind: "update", project: c.project, no: c.no, patch: { ...c.before } };
  return { kind: "complete", project: c.project, no: c.no, done: false };
}

export function completedOf(t: { project: string; no: number; rrule?: string; due?: string; dueTime?: string; reminders: string[] }): Completed {
  if (!t.rrule) return { project: t.project, no: t.no };
  return { project: t.project, no: t.no, before: { due: t.due ?? null, dueTime: t.dueTime ?? null, reminders: [...t.reminders] } };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:web`
Expected: all pass.

- [ ] **Step 5: Toast component**

`src/components/Toast.tsx`:
- Fixed at bottom 16, left 16, inside the app (`position: absolute` in the AppShell overlay).
- Style:
  - Background `var(--color-text-primary)`, text `var(--color-bg)` (inverted, works in dark).
  - Radius 8, `var(--shadow-popover)`, padding `10px 12px`, 13 px.
- Content: text, then an 「元に戻す」 button (accent-soft text color, bold), then an `X` icon button.
- Props: `{ text: string; onUndo: () => void; onClose: () => void }`.
- Enter and leave: opacity and y 8, `t(0.15)`.
- Auto close after 5000 ms, paused while hovered: `onMouseEnter` clears the timer, `onMouseLeave` restarts it.

- [ ] **Step 6: Main wiring**

- State `toast: ToastState | null`.
- One function `completed(t: Task)` that runs `setToast((s) => merge(s, completedOf(t)))`.
- Call it after a successful completion with `done === true` in every path:
  - `ProjectView onToggleDone` (Main line with `p.completeTask(t.no, done)`)
  - `cross.toggleDone` callers (Today, Upcoming, Label views)
  - The detail panel's `onToggleDone`
  - The search dialog's `onToggleDone`
  - The `e` shortcut in `useRowShortcuts` (pass a callback in)
  - The reminder banner's `complete`
- Use the task as it was **before** the call (for `before`).
- `onUndo`:
  - For each entry, `undoOf(e)`, then call `api.completeTask(project, no, false)` or `api.updateTask(project, no, patch)` in order.
  - Then `p.reload()` if it is the open project, and `cross.refresh`/`refreshAll`.
  - Close the toast. A failure goes through the existing error banner (`showError`).
- Render `<Toast>` in `overlay` when `toast` is set.

- [ ] **Step 7: Leave timing**

Set `LEAVE_DELAY_MS = 250` in `src/views/ProjectView.tsx` and `src/views/crossList.tsx`.

The row's leaving `Collapse` (`exitX={-24}`) gets `duration={0.1}` and `exitX={0}`: the row disappears and the rows below close up in 0.1 s. Todoist does not slide the row.

- [ ] **Step 8: Build and test**

Run: `npm run build && npm run test:web`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/app/completionToast.ts src/app/completionToast.test.ts src/components/Toast.tsx src/views/ProjectView.tsx src/views/crossList.tsx src/app/Main.tsx src/app/useRowShortcuts.ts
git commit -m "feat(desktop): completion leaves after 0.25 s with an undo toast"
```

---

### Task 8: Storybook

**Files:**
- Modify: `src/stories/screens/Desktop.stories.tsx`, `src/stories/screens/Dark.stories.tsx` (if they reference the rail or old header)
- Modify: `design/storyboard.md`

- [ ] **Step 1: New and replaced stories**

- `D01Hover`: D-01 with the second row in the hover state. Pass `showActions` and a new `TaskRowProps.showHandle` (default false), which forces the handle visible for stories.
- `D14Toast`: D-04 with `<Toast text="2 件のタスクを完了しました" …>` in the overlay.
- `D13` (960): replace with `D13a` (window 700, narrow, drawer open) and `D13b` (window 400, narrow, closed).
  - `AppShell` width prop accepts only 1440/960/390.
  - Add `widthPx?: number`, which overrides the pixel width for stories while keeping the 960 layout.
- `check:stories`: update `design/storyboard.md`'s screen table (names D-01h, D-13a, D-13b, D-14), so `npm run check:stories` passes.

- [ ] **Step 2: Build Storybook and check**

Run: `npm run build-storybook && npm run check:stories`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/stories design/storyboard.md src/components/TaskRow.tsx src/views/AppShell.tsx
git commit -m "chore(stories): hover row, completion toast, narrow 700/400 screens"
```

---

### Task 9: Measure against Todoist

**Files:**
- Modify: none (numbers go into the ledger and the PR body)

- [ ] **Step 1: Screenshots**

PowerToDo:
- Run Storybook on port 6107.
- Use headless Chrome at window 1512×940, device scale factor 1, on `screens-desktop--d-04` and `--d-01`:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1512,940 --virtual-time-budget=6000 --screenshot=<scratchpad>/pt-d-04.png "http://localhost:6107/iframe.html?id=screens-desktop--d-04&viewMode=story"
```

Todoist:
- Use the numbers in `docs/research/2026-10-25-todoist-desktop-look-and-motion.md`.
- If the owner's Todoist is open, take new screenshots of the Today view at window width 1512 with `screencapture`. Keep them in the scratchpad only.

- [ ] **Step 2: Compare**

Measure in both:
- Sidebar width
- Column left edge and width
- 1-line and 2-line row heights
- Checkbox diameter
- Indent

Expected: each within ±2 pt of Todoist.

Where one is off, adjust the value in the owning component (Task 1-5 files), rebuild, and measure again. Record the final numbers in the ledger.

- [ ] **Step 3: Commit (only if values changed)**

```bash
git add src
git commit -m "style(desktop): match measured Todoist sizes"
```

---

### Task 10: design.pen

**Files:**
- Modify: `design.pen` (worktree copy only), `design/storyboard.md`

This task needs the owner. Pencil writes into the open file, and the owner saves.

- [ ] **Step 1: Open the right file**

- Ask the owner to open `<worktree>/design.pen` in Pencil.
- Then call `mcp__pencil__get_app_state` and check that the active editor's path is the worktree's `design.pen`.
- If it is not, stop and ask. Never write while the main checkout's `design.pen` is active.

- [ ] **Step 2: Read the skill and style**

Call:
- `mcp__pencil__read_skill` (as the Pencil MCP instructions require before editing)
- `mcp__pencil__get_style`

- [ ] **Step 3: Update screens**

With `mcp__pencil__execute`, update these screens to the new look:
- D-01, D-01b, D-01c, D-04, D-05, D-06, D-06b, and the dark copies of these.

Changes:
- Font family token
- Title 26 with the subtitle under it
- Checkbox 18 with a tinted fill
- Meta line with the project right-aligned
- Section header chevron outside the column, 再スケジュール on the same line
- Sidebar: active item light red with red text, `#` icons, filled add button
- Top bar with 表示 and …

Add screens, and add them to `design/storyboard.md` with their node ids:
- D-01h (hover row: handle, actions, grey check)
- D-14 (completion toast)
- D-13a (700, drawer open)
- D-13b (400)

Replace D-13 (960).

- [ ] **Step 4: Owner saves**

- Ask the owner to press ⌘S in Pencil.
- Then check `git status` shows `design.pen` modified in the worktree, and not in the main checkout (`git -C <main checkout> status --short design.pen` unchanged from before).

- [ ] **Step 5: Commit**

```bash
git add design.pen design/storyboard.md
git commit -m "design: update desktop screens to the Todoist-like look"
```

---

## PR checklist (manual, from the spec)

- Mac: today, project and upcoming at 1512 match the measured sizes (numbers in the PR)
- Hover shows the handle, the actions and the grey check at once
- Section and subtask collapse switch instantly
- Complete → leaves after about 0.25 s → toast → 元に戻す restores. Two completions in a row → 「2 件」. A repeating task: undo puts the old date back
- Window at 700: the sidebar is hidden, and the top-bar button opens it over the page; Esc closes it
- Window at 400: list, quick add, search and settings do not overflow
- Wide: the sidebar's close button hides it with a slide; the top-bar button brings it back
- Dark theme and reduced motion look right
- Windows: the font is Yu Gothic UI
