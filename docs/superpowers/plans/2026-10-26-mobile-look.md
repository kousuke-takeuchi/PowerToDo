# iPhone look (④) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the iPhone screens look and move like the Todoist iPhone app. This covers:
- the four bottom tabs and the 閲覧 tab, which replaces the drawer;
- the large title that moves into the top bar on scroll;
- the glass bars and buttons;
- rows, checkboxes, subtasks and headers;
- the sheet frame and its motion;
- the quick add card;
- the undo toast;
- the dark theme;
- `design.pen`.

The desktop does not change.

**Architecture:**
- Plan A of the spec: shared components keep one set of props and branch on `variant="mobile"` / `mobile`.
  - `TaskRow` and `SectionHeader` become thin wrappers. The desktop body is renamed and left byte-for-byte as it is. The iPhone body is new (`MobileTaskRow`, `MobileSectionHeader`).
  - `Checkbox`, `SidebarItem`, `ProjectItem` and `WeekStrip` change only their mobile values.
- iPhone-only parts are rewritten: `MobileShell`, `MobileHeader`, `TabBar`, `BottomSheet`, the sheets, `MobileQuickAddSheet`, and a new `MobileToast`.
- The drawer goes. Its content moves to a new `MobileBrowse`.
- The logic is pure and tested with `node --test`:
  - glass fallback;
  - title collapse;
  - navigation;
  - row props;
  - day headings;
  - sheet motion;
  - undo.
- `design.pen` is edited at the end through the Pencil MCP, and the owner saves it.

**Tech Stack:** React 19, TypeScript 6, `motion` 14.2.0 (`motion/react`: `useMotionValue`, `useTransform`, `useDragControls`, spring transitions), lucide-react 1.56.0, Tailwind 4 (a few classes), Storybook 10, Tauri 2 (iOS build through TestFlight), Pencil MCP (`mcp__pencil__*`).

**Spec:** `docs/superpowers/specs/2026-10-26-mobile-look-design.md`. Research (measured sizes and motion, §9 and "Motion"): `docs/research/2026-10-26-todoist-iphone.md`.

**Prerequisite:**
- Merge the spec PR (`feature/spec-mobile-look`) and this plan's PR first.
- Start `feature/mobile-look` from origin/main after that, in its own worktree (other sessions share the main checkout).
- Run `npm ci` in the new worktree (worktrees have no `node_modules`).

## Global Constraints

- iPhone only:
  - Desktop rendering (`Main`, desktop views, the `variant="desktop"` / non-`mobile` branches) must not change.
  - Task 1 takes desktop baseline screenshots, and Task 9 compares them.
- All sizes are CSS px at 390 wide, equal to the measured pt:
  - Tab bar: one glass pill, 28 from the left and right, 58 high, 23 above the screen's bottom edge. Each tab is an icon (22) over a 10 label. The selected tab gets a grey rounded ground (`var(--color-bg-hover)`) with red icon and label (`var(--color-accent)`). The 今日 icon shows today's day number.
  - Add button: a red circle (`var(--color-accent)`), 62 across, with a white `+` (26). It sits 18 from the right, 10 above the tab bar (bottom 91), with `var(--shadow-fab)`. It never hides on scroll.
  - Large title: 34 bold (line 41), with 12 grey 「n 件のタスク」 under it (line 16). The small title is 17 bold, centered in the top bar, with an 11 count line.
  - Screen side padding: 15.
  - Checkbox: 22 across, ring 2. P1-3 get the ring color plus a 10 % fill of it; P4 is a grey ring with no fill.
  - Task title: 16, one line with an ellipsis. Text starts at 49 (12 after the checkbox). The description is 13 grey, one line. The meta line is 12.
  - Row height: 63 with a second line, 48 for a title only.
  - Separators: a hairline (`var(--color-border)`) from x 49 to the right padding, none under the checkbox.
  - Subtask indent: 34 per level, so the child checkbox sits under the parent's text.
  - Section and day headers: 15 bold, no line, 36 above (16 for the first header under the title).
  - Sheets: top corners 16, grabber 36×4, title 17 bold centered. A round glass × sits at the left; sheets that need a decision get a red round ✓ at the right. Content sits in white cards (radius 16) on a grey ground.
  - Quick add: a card above the keyboard (radius 24, 10 from the sides), name field 20, red round send button 36.
  - Toast: a card above the tab bar (left 10, right 90, bottom 91) that stays 3 s.
- Motion:
  - All of it goes through `useMotionTiming()`'s `reduced` flag; with `prefers-reduced-motion` it does not move.
  - Sheet open: a critically damped spring, `ω = 24.4`. It covers 70 % in 0.1 s, settles by about 0.37 s and never overshoots.
  - Sheet close: 0.13 s ease-in.
  - A large sheet pulled to full height: 0.2 s, decelerating.
  - The sheet under another sheet scales to 0.95 and dims.
  - The scrim fades with the sheet.
  - The title collapse follows the scroll position (no timer).
  - Subtask expand / collapse switches at once.
  - A completed row stays 0.25 s (`LEAVE_DELAY_MS`), then leaves in 0.1 s.
- Glass:
  - Light: white at 0.7 opacity, blur 20, a thin light edge.
  - Dark: the dark grey `#333333` at 0.7, same blur.
  - Without `backdrop-filter` it falls back to an opaque color.
- Japanese UI strings (exact):
  - Tabs: 「受信トレイ」「今日」「近日」「閲覧」.
  - Browse: 「閲覧」「マイプロジェクト」「ラベル」「検索」「設定」.
  - 「n 件のタスク」, 「期限切れ」, 「再スケジュール」, 「元に戻す」.
  - Day headers: 「10月26日 · 今日 · 月曜日」 / 「10月27日 · 明日 · 火曜日」 / 「10月30日 · 金曜日」.
  - Month line: 「2026年10月」.
  - Toasts: 「今日 にスケジュールしました」, 「日付を削除しました」, 「<project> に移動しました」, 「n 件のタスクを完了しました」.
  - Project menu: 「名前を変更」「削除」「本当に削除」「キャンセル」.
- Colors come from tokens only. The only fixed color is white on accent or success (as today). The quick add's keyboard mock keeps its story-only colors.
- Icons stay lucide-react. No Todoist logo, icon assets or name in the UI.
- Dark theme: `html[data-theme="dark"]` values from `src/styles/tokens.css`. On iPhone it follows the system appearance (Task 1). Desktop does not set it.
- The owner's Todoist screenshots and recording show personal tasks. Never commit them or attach them to the PR. Write only the measured numbers.
- Node tests:
  - Run them with `npm run test:web`.
  - Tests import with `.ts` extensions.
  - Modules tested under node must not use extensionless relative value imports (`import type` is fine; `.ts` value imports are fine, since `allowImportingTsExtensions` is on).
- Stories check: `npm run build-storybook`, then `npm run check:stories` must print `missing: none`.
  - Storyboard ids are 5-6 alphanumeric characters.
  - New frames use `pend21`..`pend24` until Task 10.
- `design.pen`:
  - Edit only the worktree copy, through the Pencil MCP, with the worktree file open in Pencil (check `mcp__pencil__get_app_state`).
  - The owner saves with ⌘S.
  - Never touch the main checkout's `design.pen`.
- Do not run the real app. Never print or commit `src-tauri/google-oauth.json`.
- Commits: no `Co-Authored-By` or any AI trailer.
- Story sample data: たろう, 仕事, 買い物 (mock data); no real names.

## Review Focus

1. **iOS bounce and short lists under a large title.** Pulling down past the top gives a negative `scrollTop`; a fast fling gives one far past the title. The title must stay fully large or fully small, never inverted or half-faded. Test: `titleProgress_clamps_bounce_and_overshoot` (Task 2).
2. **Undo of a move to another project.** `move_task` renumbers the task in the target, so undo must move the task with its new number back to its old project and section. Test: `undo_move_targets_the_new_number` (Task 8). MobileMain takes the number from `movedRootNo(out.to.tasks, 1)`, whose fallback is already tested in `movedRoot.test.ts`.
3. **A second action inside the toast's 3 s.**
   - Completions in a row share one toast with the count, and undo reopens all of them.
   - A date change after a completion replaces the toast, and undo then undoes only the date.
   - Test: `push_merges_completions_and_replaces_other_kinds` (Task 8).
4. **閲覧 tapped again inside a pushed screen, or the open project renamed or deleted.**
   - Re-tapping 閲覧 returns to its root.
   - Other tabs keep the 閲覧 stack.
   - A rename keeps the screen open under the new name; a delete returns to the root.
   - Tests: `tab_retap_pops_browse_to_root`, `other_tabs_keep_the_browse_stack`, `renamed_and_removed_follow_the_project` (Task 3).
5. **Reduce Motion on.** Sheets, the quick add card and the toast appear and leave at once, with no slide or spring. Test: `sheetTransition_reduced_is_instant` (Task 6). Tasks 7 and 8 use `sheetTransition` for their motion.

## Rulings on spec gaps

The spec is silent or ambiguous on these points; the plan decides as follows. Add these rows to the spec's decision log in the implementation PR.

- **Header 「…」 (§3.4).** On iPhone the header's 「…」 has no handler today, so there is no iPhone 「その他」 menu yet.
  - The pill shows 「…」 only on non-inbox project screens. It opens a sheet with the desktop 「その他」 items, 「名前を変更」 and 「削除」, and asks inside the sheet before deleting.
  - Other screens show no right pill until ⑤ adds 「表示」. The 閲覧 tab shows 検索 and 設定 there.
- **Section 「…」 (§4.3).** iPhone has no section menu, so ④ does not show it; ②③ adds both.
- **Subtask indent (§4.2).** The indent is 34 per level, so the child checkbox sits exactly under the parent's text at x 49. The spec's "約 40" is approximate, and 34 follows from the measured 15 + 22 + 12.
- **Tab bar bottom (§3.1).** 23 is measured from the screen's bottom edge, as in the research screenshots. It is not 23 above the 34 safe-area inset.
- **Quick add suggestions (§5.3).**
  - No `#` / `!!` suggestion list exists today, and `!!` is not PowerToDo syntax (priority is `p1`).
  - The floating card above shows the existing parsed tokens and reminders. No new picker is built.
  - The project chip inserts `#`.
- **Dark mode (§6).** The app never sets `data-theme`. On iPhone it now follows the system appearance; desktop is unchanged.
- **Sheets that need a decision (§5.1).** Only `TextSheet` (name, memo, subtask, project rename) gets the ✓; the other sheets apply on tap. The large detent (85 % → full) is used by the move sheet.
- **Toast (§5.4).** It is a separate `MobileToast`, so the desktop `Toast` is byte-identical. It sits left 10, right 90 (the add button stays visible), bottom 91. It covers completion (rows and the task screen), date changes (sheet, task screen, 再スケジュール of all overdue) and moves.
- **Overdue chevron (§4.3).** The chevron is part of the red 「再スケジュール」 button, which opens the date sheet. It is not a collapse arrow.
- **Header sync.** The sync icon leaves the header. Sync state shows only on 閲覧's sync row and in the banners, and pull-to-refresh stays.
- **Headers and titles.**
  - Today's day section uses 「10月13日 · 今日 · 火曜日」, like Upcoming.
  - iPhone section headers drop their counts.
  - 閲覧 and ラベル use a large title. Search, settings and Upcoming use the small centered title.
- **Names.** The research's 「インボックス」 and 「リスケジュール」 are Todoist's words; PowerToDo keeps 「受信トレイ」 and 「再スケジュール」 (spec §1).

---

### Task 1: Tokens, `Glass`, and the iPhone theme

**Files:**
- Modify: `src/styles/tokens.css`, `src/styles/index.css`
- Create: `src/components/glass.ts`, `src/components/glass.test.ts`, `src/components/Glass.tsx`, `src/app/useSystemTheme.ts`
- Modify: `src/app/MobileMain.tsx` (one call)

**Interfaces:**
- Produces:

```ts
// src/components/glass.ts
export const GLASS_BLUR = 20;
export function backdropSupported(css: { supports(property: string, value: string): boolean } | undefined): boolean;
export function glassStyle(supported: boolean): React.CSSProperties;
// src/components/Glass.tsx
export type GlassProps = React.HTMLAttributes<HTMLDivElement> & { radius: number };
export function Glass(props: GlassProps): JSX.Element;
// src/app/useSystemTheme.ts
export function useSystemTheme(): void; // iPhone: <html data-theme> follows prefers-color-scheme
```

- CSS tokens (light / dark):
  - `--color-glass`, `--color-glass-edge`, `--color-glass-solid`
  - `--shadow-glass`
  - `--color-sheet-bg`, `--color-sheet-card`
- CSS class: `.sheet-card` (hairlines between the rows of a sheet card).

- [ ] **Step 1: Take the desktop baseline (before any change)**

The helpers live in the controller's scratchpad, `SP=/private/tmp/claude-502/-Users-ktakeuchi-Documents-AOGU/d2253c28-745b-4661-9a05-32aec0df385e/scratchpad`.
- `$SP/shot.sh <story-id> <out.png> [w] [h] [port]` takes a headless Chrome screenshot of one story.
- If it is missing, create it with this content and `chmod +x`:

```bash
#!/bin/bash
# shot.sh <story-id> <out.png> [width] [height] [port]
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --user-data-dir=/private/tmp/claude-502/-Users-ktakeuchi-Documents-AOGU/d2253c28-745b-4661-9a05-32aec0df385e/scratchpad/chrome-prof --force-device-scale-factor=${6:-1} --window-size=${3:-1512},${4:-940} --virtual-time-budget=6000 --screenshot=$2 "http://localhost:${5:-6108}/iframe.html?id=$1&viewMode=story" >/dev/null 2>&1
```

Run:

```bash
SP=/private/tmp/claude-502/-Users-ktakeuchi-Documents-AOGU/d2253c28-745b-4661-9a05-32aec0df385e/scratchpad
npm run build-storybook >/dev/null 2>&1
node -e 'const j=require("./storybook-static/index.json");for(const e of Object.values(j.entries))if(e.type==="story"&&/^Screens\/(Desktop|Dark)$/.test(e.title))console.log(e.id)' > $SP/look-ids.txt
mkdir -p $SP/look-base
(cd storybook-static && python3 -m http.server 6108 >/dev/null 2>&1 &) ; sleep 1
while read id; do "$SP/shot.sh" "$id" "$SP/look-base/$id.png" 1512 940 6108; done < $SP/look-ids.txt
ls $SP/look-base | wc -l
```

Expected: one PNG per id in `look-ids.txt`. Leave the server running for this task or stop it (`pkill -f "http.server 6108"`). Task 9 compares against these files.

- [ ] **Step 2: Write the failing test** (`src/components/glass.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { backdropSupported, glassStyle, GLASS_BLUR } from "./glass.ts";

test("glass_blurs_when_supported", () => {
  const s = glassStyle(true);
  assert.equal(GLASS_BLUR, 20);
  assert.equal(s.background, "var(--color-glass)");
  assert.match(String(s.backdropFilter), /blur\(20px\)/);
  assert.equal(s.WebkitBackdropFilter, s.backdropFilter);
});

test("glass_falls_back_to_opaque", () => {
  const s = glassStyle(false);
  assert.equal(s.background, "var(--color-glass-solid)");
  assert.equal(s.backdropFilter, undefined);
  assert.equal(s.WebkitBackdropFilter, undefined);
});

test("backdrop_support_checks_both_spellings", () => {
  const only = (prop: string) => ({ supports: (p: string) => p === prop });
  assert.equal(backdropSupported(only("backdrop-filter")), true);
  assert.equal(backdropSupported(only("-webkit-backdrop-filter")), true);
  assert.equal(backdropSupported(only("color")), false);
  assert.equal(backdropSupported(undefined), false);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:web 2>&1 | grep -E "ERR_MODULE_NOT_FOUND|^ℹ fail" | head -3`
Expected: `glass.ts` not found.

- [ ] **Step 4: Implement**

`src/components/glass.ts`:

```ts
import type { CSSProperties } from "react";

/** Spec ④ iPhone §3.6: the blur behind the floating bars and round buttons. */
export const GLASS_BLUR = 20;

type Supports = { supports(property: string, value: string): boolean };

/** Whether the WebView can blur what is behind an element (WKWebView knows only the -webkit- spelling on older iOS). */
export function backdropSupported(css: Supports | undefined): boolean {
  if (!css) return false;
  const v = `blur(${GLASS_BLUR}px)`;
  return css.supports("backdrop-filter", v) || css.supports("-webkit-backdrop-filter", v);
}

/** Translucent ground + blur + a thin light edge; without backdrop-filter an opaque ground (spec ④ iPhone §3.6). */
export function glassStyle(supported: boolean): CSSProperties {
  const edge = "inset 0 0 0 0.5px var(--color-glass-edge), var(--shadow-glass)";
  if (!supported) return { background: "var(--color-glass-solid)", boxShadow: edge };
  const filter = `blur(${GLASS_BLUR}px) saturate(180%)`;
  return { background: "var(--color-glass)", backdropFilter: filter, WebkitBackdropFilter: filter, boxShadow: edge };
}
```

`src/components/Glass.tsx`:

```tsx
import type React from "react";
import { backdropSupported, glassStyle } from "./glass";

const SUPPORTED = typeof CSS !== "undefined" && backdropSupported(CSS);

export type GlassProps = React.HTMLAttributes<HTMLDivElement> & { radius: number };

/** iOS 26 "glass" (spec ④ iPhone §3.6): the tab bar, the top bar's right buttons, the sheets' ×. */
export function Glass({ radius, style, children, ...rest }: GlassProps) {
  return (
    <div {...rest} style={{ borderRadius: radius, ...glassStyle(SUPPORTED), ...style }}>
      {children}
    </div>
  );
}
```

`src/app/useSystemTheme.ts`:

```ts
import { useEffect } from "react";

/**
 * iPhone (spec ④ iPhone §6): follow the system appearance by setting <html data-theme>, live.
 * The app has no theme setting; desktop does not call this, so desktop is unchanged.
 */
export function useSystemTheme(): void {
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const apply = () => document.documentElement.setAttribute("data-theme", mq.matches ? "dark" : "light");
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      document.documentElement.removeAttribute("data-theme");
    };
  }, []);
}
```

`src/styles/tokens.css`:

Add these to `:root`, after `--color-scrim`:

```css
  --color-glass: #FFFFFFB3; /* iPhone: tab bar, top-right pill, sheet × (white at 0.7) */
  --color-glass-edge: #FFFFFF99;
  --color-glass-solid: #FFFFFF; /* when backdrop-filter is not supported */
  --shadow-glass: 0 4px 16px #0000001F;
  --color-sheet-bg: #F2EFED; /* iPhone sheets: the grey ground */
  --color-sheet-card: #FFFFFF; /* iPhone sheets: cards; quick add; toast */
```

Add these to `html[data-theme="dark"]`. They reuse the dark theme's own greys: bg `#1E1E1E`, bg-sidebar `#282828`, bg-hover `#333333`.

```css
  --color-glass: #333333B3;
  --color-glass-edge: #FFFFFF1F;
  --color-glass-solid: #333333;
  --color-sheet-bg: #1E1E1E;
  --color-sheet-card: #282828;
```

Append to `src/styles/index.css`:

```css
/* iPhone sheets (spec ④ iPhone §5.1): rows inside a card are split by hairlines. */
.sheet-card > * + * { box-shadow: inset 0 0.5px 0 var(--color-border); }
```

In `src/app/MobileMain.tsx`:
- Add `import { useSystemTheme } from "./useSystemTheme";`.
- Call `useSystemTheme();` as the first line of `MobileMain`.

- [ ] **Step 5: Run the tests and the build**

Run: `npm run test:web 2>&1 | grep -E "^ℹ (pass|fail)"; npm run build 2>&1 | grep -E "error|built in" | head -3`
Expected: `ℹ fail 0`; built.

- [ ] **Step 6: Commit**

```bash
git add src/styles src/components/glass.ts src/components/glass.test.ts src/components/Glass.tsx src/app/useSystemTheme.ts src/app/MobileMain.tsx
git commit -m "feat(ios): glass, sheet tokens, and the system theme on iPhone"
```

---

### Task 2: Top bar and large title

**Files:**
- Create: `src/components/largeTitle.ts`, `src/components/largeTitle.test.ts`
- Rewrite: `src/components/MobileHeader.tsx`
- Modify:
  - `src/views/mobile/MobileShell.tsx`
  - `src/views/mobile/MobileProjectView.tsx`, `MobileToday.tsx`, `MobileUpcoming.tsx`, `MobileLabels.tsx`, `MobileSearch.tsx`, `MobileSettings.tsx`, `MobileTaskDetail.tsx`
  - `src/app/MobileMain.tsx`
  - `src/stories/screens/Mobile.stories.tsx`, `design/storyboard.md`

**Interfaces:**
- Consumes: `Glass` (Task 1).
- Produces:

```ts
// src/components/largeTitle.ts
export const LARGE_TITLE_HEIGHT = 57; // 41 (34 bold) + 16 (12 count line)
export function titleProgress(scrollTop: number, distance?: number): number; // 0..1
export type TitleLook = { largeOpacity: number; largeScale: number; smallOpacity: number };
export function titleLook(p: number): TitleLook;
// src/components/MobileHeader.tsx
export type HeaderAction = { icon: React.ComponentType<{ size?: number }>; label: string; onClick?: () => void };
export type MobileHeaderProps = {
  title: string; subtitle?: string; progress?: MotionValue<number>;
  onBack?: () => void; onMenu?: () => void; // onMenu is removed in Task 3
  actions?: HeaderAction[]; breadcrumb?: React.ReactNode; safeArea?: boolean;
};
// MobileShell props add:
//   title?: string; subtitle?: string; largeTitle?: boolean; actions?: HeaderAction[];
//   onBack?: () => void; onMenu?: () => void; initialScrollTop?: number;
//   header?: React.ReactNode becomes optional (custom bar, M-03 only).
// MobileProjectView props add: onProjectMenu?: () => void (the 「…」 pill). Removes: sync, onSync.
// MobileToday / MobileUpcoming / MobileLabels / MobileLabelDetail / MobileSearch: remove sync, onSync.
// MobileSettings: remove headerSync, onHeaderSync.
```

- DOM hooks for checks:
  - `data-scroll-body` on the shell's scrolling element;
  - `data-large-title` on the large title;
  - `data-small-title` on the bar's small title.

- [ ] **Step 1: Write the failing test** (`src/components/largeTitle.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { LARGE_TITLE_HEIGHT, titleLook, titleProgress } from "./largeTitle.ts";

test("titleProgress_follows_the_scroll", () => {
  assert.equal(LARGE_TITLE_HEIGHT, 57);
  assert.equal(titleProgress(0), 0);
  assert.equal(titleProgress(28.5), 0.5);
  assert.equal(titleProgress(LARGE_TITLE_HEIGHT), 1);
});

test("titleProgress_clamps_bounce_and_overshoot", () => {
  assert.equal(titleProgress(-40), 0); // iOS bounce at the top
  assert.equal(titleProgress(500), 1);
  assert.equal(titleProgress(Number.NaN), 0);
});

test("titleLook_ends_and_middle", () => {
  assert.deepEqual(titleLook(0), { largeOpacity: 1, largeScale: 1, smallOpacity: 0 });
  assert.deepEqual(titleLook(1), { largeOpacity: 0, largeScale: 0.9, smallOpacity: 1 });
  assert.equal(titleLook(0.5).smallOpacity, 0); // the two titles never show at once
  assert.equal(titleLook(2).largeOpacity, 0);
  assert.equal(titleLook(-1).smallOpacity, 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web 2>&1 | grep -E "ERR_MODULE_NOT_FOUND" | head -1`
Expected: `largeTitle.ts` not found.

- [ ] **Step 3: Implement `largeTitle.ts`**

```ts
/** Spec ④ iPhone §3.3: the large title (34 bold, line 41) and its count line (12, line 16). Scrolling this far finishes the move into the bar. */
export const LARGE_TITLE_HEIGHT = 57;

/** Scroll position -> how far the title has moved into the bar (0..1). iOS bounce gives negative values; they count as 0. */
export function titleProgress(scrollTop: number, distance: number = LARGE_TITLE_HEIGHT): number {
  if (!Number.isFinite(scrollTop) || distance <= 0) return scrollTop > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, scrollTop / distance));
}

export type TitleLook = { largeOpacity: number; largeScale: number; smallOpacity: number };

/** The large title shrinks to 0.9 and fades out; the small one fades in over the second half, so they never read at once. */
export function titleLook(p: number): TitleLook {
  const q = Math.min(1, Math.max(0, p));
  return { largeOpacity: 1 - q, largeScale: 1 - 0.1 * q, smallOpacity: Math.max(0, 2 * q - 1) };
}
```

Run: `npm run test:web 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 4: Rewrite `MobileHeader.tsx`**

The header has no sync icon any more. Spec §3.4: sync moves to the 閲覧 tab's sync row, and pull-to-refresh stays.

```tsx
import type React from "react";
import { ChevronLeft, Menu } from "lucide-react";
import { motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { Button } from "./Button";
import { Glass } from "./Glass";
import { titleLook } from "./largeTitle";

export type HeaderAction = { icon: React.ComponentType<{ size?: number }>; label: string; onClick?: () => void };

export type MobileHeaderProps = {
  title: string;
  /** Under the small title (11): 「n 件のタスク」. */
  subtitle?: string;
  /** 0..1 from the list's scroll (screens with a large title). Omitted: the small title shows at once. */
  progress?: MotionValue<number>;
  onBack?: () => void;
  /** Hamburger for the drawer. Removed with the drawer in Task 3. */
  onMenu?: () => void;
  /** Buttons in the glass pill at the right (spec ④ iPhone §3.4). */
  actions?: HeaderAction[];
  /** Replaces the small title, left-aligned (M-03's breadcrumb). `title` becomes its aria-label. */
  breadcrumb?: React.ReactNode;
  /** The top gap is the notch's safe area instead of the picture's 47 status bar. */
  safeArea?: boolean;
};

const actionButton: React.CSSProperties = {
  width: 44,
  height: 44,
  display: "grid",
  placeItems: "center",
  padding: 0,
  border: 0,
  background: "none",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

/** iPhone top bar (spec ④ iPhone §3.3-3.4): back (or menu), the small centered title, the glass pill of actions. */
export function MobileHeader({ title, subtitle, progress, onBack, onMenu, actions, breadcrumb, safeArea }: MobileHeaderProps) {
  const one = useMotionValue(1);
  const smallOpacity = useTransform(progress ?? one, (p) => titleLook(p).smallOpacity);
  return (
    <header style={{ flex: "0 0 auto", background: "var(--color-bg)", fontFamily: "var(--font-body)" }}>
      <div aria-hidden style={{ height: safeArea ? "env(safe-area-inset-top)" : 47 }} />
      <div style={{ position: "relative", height: 52, display: "flex", alignItems: "center", gap: 8, padding: "0 15px" }}>
        {onBack ? (
          <Button variant="icon" icon={ChevronLeft} ariaLabel="戻る" onClick={onBack} />
        ) : onMenu ? (
          <Button variant="icon" icon={Menu} ariaLabel="メニュー" onClick={onMenu} />
        ) : null}
        {breadcrumb ? (
          <div aria-label={title} style={{ flex: 1, minWidth: 0 }}>
            {breadcrumb}
          </div>
        ) : (
          <>
            <motion.div
              data-small-title=""
              aria-hidden={progress ? true : undefined}
              style={{
                position: "absolute",
                left: 72,
                right: 72,
                top: 0,
                bottom: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                opacity: smallOpacity,
                pointerEvents: "none",
              }}
            >
              <div
                role={progress ? undefined : "heading"}
                aria-level={progress ? undefined : 1}
                style={{ maxWidth: "100%", fontSize: 17, lineHeight: "22px", fontWeight: 700, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {title}
              </div>
              {subtitle && <div style={{ fontSize: 11, lineHeight: "13px", color: "var(--color-text-secondary)" }}>{subtitle}</div>}
            </motion.div>
            <div style={{ flex: 1 }} />
          </>
        )}
        {actions && actions.length > 0 && (
          <Glass radius={22} style={{ display: "flex", alignItems: "center", height: 44, padding: "0 2px", flex: "0 0 auto" }}>
            {actions.map((a) => (
              <button key={a.label} type="button" aria-label={a.label} onClick={a.onClick} style={actionButton}>
                <a.icon size={20} />
              </button>
            ))}
          </Glass>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 5: `MobileShell`: title props, large title, scroll progress**

In `src/views/mobile/MobileShell.tsx`:
- Keep the tab bar and FAB code as it is (Task 3 replaces it).
- Change the type and the top of the component, and replace the body block.

```tsx
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { usePullToRefresh } from "../../app/useGestures";
import { MobileHeader, type HeaderAction } from "../../components/MobileHeader";
import { PullIndicator } from "../../components/PullIndicator";
import { TabBar } from "../../components/TabBar";
import type { TabBarProps } from "../../components/TabBar";
import { titleLook, titleProgress } from "../../components/largeTitle";

export type MobileShellProps = {
  /** A custom top bar (M-03's breadcrumb). Without it the shell draws MobileHeader from title / subtitle / actions / onBack. */
  header?: React.ReactNode;
  title?: string;
  /** 「n 件のタスク」 under the large title and under the small title. */
  subtitle?: string;
  /** Spec ④ iPhone §3.3: a large title at the top of the list that moves into the bar as the list scrolls. */
  largeTitle?: boolean;
  actions?: HeaderAction[];
  onBack?: () => void;
  /** Hamburger (removed with the drawer in Task 3). */
  onMenu?: () => void;
  /** Stories: start scrolled by this many px (M-04b). */
  initialScrollTop?: number;
  children: React.ReactNode;
  tab?: TabBarProps["active"] | "none";
  onTabChange?: TabBarProps["onChange"];
  fab?: boolean;
  onFab?: () => void;
  overlay?: React.ReactNode;
  fill?: boolean;
  banner?: React.ReactNode;
  onRefresh?: () => Promise<void>;
  refreshing?: boolean;
};

function LargeTitle({ title, subtitle, progress }: { title: string; subtitle?: string; progress: MotionValue<number> }) {
  const opacity = useTransform(progress, (p) => titleLook(p).largeOpacity);
  const scale = useTransform(progress, (p) => titleLook(p).largeScale);
  return (
    <motion.div data-large-title="" style={{ flex: "0 0 auto", padding: "0 15px 8px", opacity, scale, transformOrigin: "0% 100%" }}>
      <h1 style={{ margin: 0, fontSize: 34, lineHeight: "41px", fontWeight: 700, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {title}
      </h1>
      {subtitle && <div style={{ fontSize: 12, lineHeight: "16px", color: "var(--color-text-secondary)" }}>{subtitle}</div>}
    </motion.div>
  );
}
```

Inside `MobileShell` (destructure the new props too):

```tsx
  const pulling = usePullToRefresh(onRefresh);
  const withPull = onRefresh !== undefined || forceRefreshing !== undefined;
  const progress = useMotionValue(titleProgress(initialScrollTop ?? 0));
  const scrollEl = useRef<HTMLDivElement | null>(null);
  const setBody = (el: HTMLDivElement | null) => {
    scrollEl.current = el;
    pulling.ref(el);
  };
  useLayoutEffect(() => {
    if (initialScrollTop && scrollEl.current) scrollEl.current.scrollTop = initialScrollTop;
  }, [initialScrollTop]);
```

Render, replacing `{header}` and the body block (both the `withPull` branch and the plain branch):

```tsx
      {header ??
        (title !== undefined && (
          <MobileHeader title={title} subtitle={subtitle} progress={largeTitle ? progress : undefined} actions={actions} onBack={onBack} onMenu={onMenu} safeArea={fill} />
        ))}
      {banner && <div style={{ flex: "0 0 auto", maxHeight: "40%", overflowY: "auto" }}>{banner}</div>}
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {withPull && <PullIndicator pull={pulling.pull} refreshing={forceRefreshing ?? pulling.refreshing} />}
        <div
          ref={setBody}
          data-scroll-body=""
          onScroll={largeTitle ? (e) => progress.set(titleProgress(e.currentTarget.scrollTop)) : undefined}
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", overscrollBehaviorY: "contain", WebkitOverflowScrolling: "touch" }}
        >
          {largeTitle && title !== undefined && <LargeTitle title={title} subtitle={subtitle} progress={progress} />}
          {children}
        </div>
      </div>
```

Notes:
- The body now scrolls in the 390×844 picture too, so stories can drive the collapse over CDP.
- Drop the old `bodyStyle` constant.
- The `usePullToRefresh` callback ref is harmless when `onRefresh` is undefined (its effect returns early).

- [ ] **Step 6: Screens pass titles instead of headers**

Each screen drops `header={<MobileHeader … />}` and its `sync` / `onSync` props, and passes these to `MobileShell`:

| Screen | Shell props |
| --- | --- |
| `MobileProjectView` | `title={title ?? project}` `subtitle={`${openCount} 件のタスク`}` `largeTitle` `onMenu={onMenu ?? (() => setOverlay("drawer"))}` `actions={onProjectMenu ? [{ icon: Ellipsis, label: "その他", onClick: onProjectMenu }] : undefined}`; `const openCount = mine.filter((t) => t.progress !== 100).length` (the same count as desktop `ProjectView`) |
| `MobileToday` | `title="今日"` `subtitle={`${overdue.length + todays.length} 件のタスク`}` `largeTitle` `onMenu={onMenu}`; delete the 12 px date / count line under the header |
| `MobileUpcoming` | `title="近日"` (small title from the start, spec §3.3) `onMenu={onMenu}` |
| `MobileLabels` | `title="ラベル"` `largeTitle` `onMenu={onMenu}` |
| `MobileLabelDetail` | `title={`@${label}`}` `subtitle={`${tasks.length} 件のタスク`}` `largeTitle` `onMenu={onMenu}` |
| `MobileSearch` | `title="検索"` `onMenu={onMenu}` |
| `MobileSettings` | `title="設定"` `onBack={onBack}`; remove the `headerSync` / `onHeaderSync` props and their docs |
| `MobileTaskDetail` | keeps `header={<MobileHeader title="タスク詳細" safeArea={fill} onBack={onBack} breadcrumb={…} />}` (`showBack` is gone; `onBack` shows the back button) |

In `MobileMain`:
- `frame()` becomes `<MobileShell fill title={title} onMenu={header.onMenu} tab={tab} onTabChange={goTab} banner={banner} overlay={layers}>`.
- The detail loading shell becomes `<MobileShell fill title="タスク詳細" onBack={() => setDetail(null)} banner={banner} overlay={layers}>`.
- The settings render drops `headerSync` / `onHeaderSync`.
- `header` becomes `{ fill: true as const, onMenu: () => setDrawer(true), onFab: openQuickAdd, onTabChange: goTab }`.
- Remove the `MobileHeader` import.
- `headerSync` stays: Task 3 hands it to the 閲覧 tab's sync row.

Stories in `Mobile.stories.tsx`:
- Remove `sync` / `onSync` / `headerSync` / `onHeaderSync` props.
- Give `M01` `onProjectMenu={() => undefined}` so the pill shows.

- [ ] **Step 7: M-04b story and storyboard row**

In `Mobile.stories.tsx`:

```tsx
import { LARGE_TITLE_HEIGHT } from "../../components/largeTitle";
// …
// M-04b: M-04 scrolled by the large title's height: the title sits small in the bar (spec ④ iPhone §3.3).
export const M04b: Story = {
  name: "M-04b 今日 (見出しが縮んだところ)",
  render: () => (
    <MobileToday
      overdue={[]}
      todays={tasks.filter((t) => t.parentNo === undefined && t.progress !== 100).map((t) => ({ ...t, due: TODAY }))}
      today={TODAY}
      initialScrollTop={LARGE_TITLE_HEIGHT}
    />
  ),
};
```

Give `MobileToday` a story-only `initialScrollTop?: number` prop that it passes to `MobileShell`.

In `design/storyboard.md`:
- Under the M-04 row, add `| M-04b | M-04b 今日 (見出しが縮んだところ) | pend21 | 390x844 | 6 |`.
- Add the transition `| M-04 | 一覧を上へスクロール | M-04b | 大きな見出しが上の帯の中央へ (スクロール量に合わせて) |`.

- [ ] **Step 8: Checks, CDP, commit**

Run: `npm run build 2>&1 | grep -E "error|built in" | head -3; npm run test:web 2>&1 | grep -E "^ℹ fail"; npm run build-storybook >/dev/null 2>&1; npm run check:stories 2>&1 | grep missing`
Expected: built; `ℹ fail 0`; `missing: none`.

Drive the collapse over CDP at 390×844:
- Make a mobile copy of the driver once:

```bash
SP=/private/tmp/claude-502/-Users-ktakeuchi-Documents-AOGU/d2253c28-745b-4661-9a05-32aec0df385e/scratchpad
sed -e 's/--window-size=1512,940/--window-size=390,844/' -e 's/width: 1512, height: 940/width: 390, height: 844/' $SP/cdp/drive.mjs > $SP/cdp/drive-m.mjs
sid() { node -e 'const j=require("./storybook-static/index.json");const e=Object.values(j.entries).find(e=>e.type==="story"&&e.name===process.argv[1]);console.log(e?e.id:"")' "$1"; }
(cd storybook-static && python3 -m http.server 6108 >/dev/null 2>&1 &) ; sleep 1
```

- Steps file `$SP/cdp/m04.json`:

```json
[
  { "wait": 1500, "name": "top", "eval": "(() => ({ large: getComputedStyle(document.querySelector('[data-large-title]')).opacity, small: getComputedStyle(document.querySelector('[data-small-title]')).opacity }))()", "shot": "m04-top" },
  { "wait": 100, "name": "scroll", "eval": "(() => { const b = document.querySelector('[data-scroll-body]'); b.scrollTop = 57; return b.scrollTop; })()" },
  { "wait": 300, "name": "after", "eval": "(() => ({ large: getComputedStyle(document.querySelector('[data-large-title]')).opacity, small: getComputedStyle(document.querySelector('[data-small-title]')).opacity }))()", "shot": "m04-scrolled" },
  { "wait": 100, "name": "back", "eval": "(() => { const b = document.querySelector('[data-scroll-body]'); b.scrollTop = 0; return b.scrollTop; })()" },
  { "wait": 300, "name": "restored", "eval": "(() => ({ large: getComputedStyle(document.querySelector('[data-large-title]')).opacity, small: getComputedStyle(document.querySelector('[data-small-title]')).opacity }))()" }
]
```

Run: `mkdir -p $SP/m04 && node $SP/cdp/drive-m.mjs "http://localhost:6108/iframe.html?id=$(sid 'M-04b 今日 (見出しが縮んだところ)')&viewMode=story" $SP/m04 $SP/cdp/m04.json`

Expected:
- `top` (M-04b starts scrolled): large `0`, small `1`.
- `after`: the same.
- `restored`: large `1`, small `0`.

Also look at `m04-scrolled.png`: 「今日」 is 17 bold in the bar's center with 「n 件のタスク」 under it.

```bash
git add src design/storyboard.md
git commit -m "feat(ios): top bar with the large title that moves into it on scroll"
```

---

### Task 3: Tabs, the 閲覧 tab, navigation (drawer removed)

**Files:**
- Create: `src/app/mobileNav.ts`, `src/app/mobileNav.test.ts`, `src/views/mobile/MobileBrowse.tsx`, `src/views/mobile/ProjectMenuSheet.tsx`
- Rewrite: `src/components/TabBar.tsx`, `src/components/TabBar.stories.tsx`
- Modify:
  - `src/views/mobile/MobileShell.tsx` (tab bar, FAB, bottom space)
  - `src/components/ProjectItem.tsx`, `src/components/SidebarItem.tsx` (mobile values only)
  - `src/components/MobileHeader.tsx` (drop `onMenu`)
  - `src/views/mobile/MobileProjectView.tsx`, `MobileToday.tsx`, `MobileUpcoming.tsx`, `MobileLabels.tsx`, `MobileSearch.tsx`, `MobileSettings.tsx`
  - `src/app/MobileMain.tsx`
  - `src/stories/screens/Mobile.stories.tsx`, `design/storyboard.md`
- Delete: `src/views/mobile/Drawer.tsx`

**Interfaces:**
- Consumes: `Glass` (Task 1); `HeaderAction`, the `MobileShell` title props (Task 2).
- Produces:

```ts
// src/app/mobileNav.ts
export type MobileTab = "inbox" | "today" | "upcoming" | "browse";
export type BrowseScreen =
  | { kind: "project"; name: string } | { kind: "labels" } | { kind: "label"; name: string }
  | { kind: "search" } | { kind: "settings" };
export type MobileNav = { tab: MobileTab; browse: BrowseScreen[] };
export type NavAction =
  | { type: "tab"; tab: MobileTab } | { type: "push"; screen: BrowseScreen } | { type: "back" }
  | { type: "renamed"; from: string; to: string } | { type: "removed"; project: string };
export type Screen = { kind: "inbox" } | { kind: "today" } | { kind: "upcoming" } | { kind: "browse" } | BrowseScreen;
export const INITIAL_NAV: MobileNav;
export function reduceNav(s: MobileNav, a: NavAction): MobileNav;
export function screenOf(s: MobileNav): Screen;
export function crossNavOf(s: MobileNav): { kind: "inbox" | "today" | "upcoming" | "labels" | "project" | "label"; name?: string };
export function projectOf(s: MobileNav, inbox: string): string;
// src/components/TabBar.tsx
export const TAB_BAR: { side: 28; height: 58; bottom: 23 };
export type TabBarProps = { active?: MobileTab; onChange?: (t: MobileTab) => void; day?: number };
// MobileShell: tab?: MobileTab (the "none" value is gone); new today?: string (the 今日 icon's number).
// MobileBrowse props: see Step 5.
// ProjectMenuSheet: { project: string; onRename: () => void; onDelete: () => void; onClose: () => void }
// MobileProjectView: tab?: MobileTab (default "inbox"); onBack?: () => void; onMenu removed; initialOverlay: "none" | "quickAdd".
```

- [ ] **Step 1: Write the failing test** (`src/app/mobileNav.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { INITIAL_NAV, crossNavOf, projectOf, reduceNav, screenOf } from "./mobileNav.ts";

const go = (...actions: Parameters<typeof reduceNav>[1][]) => actions.reduce(reduceNav, INITIAL_NAV);

test("starts_on_the_inbox", () => {
  assert.deepEqual(screenOf(INITIAL_NAV), { kind: "inbox" });
  assert.equal(projectOf(INITIAL_NAV, "受信トレイ"), "受信トレイ");
});

test("push_and_back", () => {
  const s = go({ type: "tab", tab: "browse" }, { type: "push", screen: { kind: "labels" } }, { type: "push", screen: { kind: "label", name: "急ぎ" } });
  assert.deepEqual(screenOf(s), { kind: "label", name: "急ぎ" });
  assert.deepEqual(crossNavOf(s), { kind: "label", name: "急ぎ" });
  assert.deepEqual(screenOf(reduceNav(s, { type: "back" })), { kind: "labels" });
  assert.deepEqual(screenOf(go({ type: "tab", tab: "browse" }, { type: "back" })), { kind: "browse" });
});

test("tab_retap_pops_browse_to_root", () => {
  const s = go({ type: "push", screen: { kind: "project", name: "仕事" } }, { type: "tab", tab: "browse" });
  assert.deepEqual(screenOf(s), { kind: "browse" });
});

test("other_tabs_keep_the_browse_stack", () => {
  const s = go({ type: "push", screen: { kind: "project", name: "仕事" } }, { type: "tab", tab: "today" });
  assert.deepEqual(screenOf(s), { kind: "today" });
  assert.equal(projectOf(s, "受信トレイ"), "受信トレイ");
  const back = reduceNav(s, { type: "tab", tab: "browse" });
  assert.deepEqual(screenOf(back), { kind: "project", name: "仕事" });
  assert.equal(projectOf(back, "受信トレイ"), "仕事");
});

test("renamed_and_removed_follow_the_project", () => {
  const s = go({ type: "push", screen: { kind: "project", name: "仕事" } });
  assert.deepEqual(screenOf(reduceNav(s, { type: "renamed", from: "仕事", to: "業務" })), { kind: "project", name: "業務" });
  assert.deepEqual(screenOf(reduceNav(s, { type: "removed", project: "仕事" })), { kind: "browse" });
  assert.deepEqual(reduceNav(s, { type: "removed", project: "買い物" }), s);
});

test("cross_nav_of_each_tab", () => {
  assert.deepEqual(crossNavOf(go({ type: "tab", tab: "today" })), { kind: "today" });
  assert.deepEqual(crossNavOf(go({ type: "tab", tab: "upcoming" })), { kind: "upcoming" });
  assert.deepEqual(crossNavOf(go({ type: "push", screen: { kind: "search" } })), { kind: "inbox" });
  assert.deepEqual(crossNavOf(go({ type: "push", screen: { kind: "labels" } })), { kind: "labels" });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web 2>&1 | grep -E "ERR_MODULE_NOT_FOUND" | head -1`
Expected: `mobileNav.ts` not found.

- [ ] **Step 3: Implement `mobileNav.ts`**

```ts
/** Spec ④ iPhone §3.1-3.2: four tabs, and inside 閲覧 a stack of screens (project, labels, label, search, settings). Pure. */
export type MobileTab = "inbox" | "today" | "upcoming" | "browse";
export type BrowseScreen =
  | { kind: "project"; name: string }
  | { kind: "labels" }
  | { kind: "label"; name: string }
  | { kind: "search" }
  | { kind: "settings" };
export type MobileNav = { tab: MobileTab; browse: BrowseScreen[] };
export type NavAction =
  | { type: "tab"; tab: MobileTab }
  | { type: "push"; screen: BrowseScreen }
  | { type: "back" }
  | { type: "renamed"; from: string; to: string }
  | { type: "removed"; project: string };
export type Screen = { kind: "inbox" } | { kind: "today" } | { kind: "upcoming" } | { kind: "browse" } | BrowseScreen;

export const INITIAL_NAV: MobileNav = { tab: "inbox", browse: [] };

export function reduceNav(s: MobileNav, a: NavAction): MobileNav {
  switch (a.type) {
    case "tab":
      // Tapping 閲覧 again goes back to its root (iOS). Other tabs keep the 閲覧 stack for when the user comes back.
      if (a.tab === "browse" && s.tab === "browse") return { tab: "browse", browse: [] };
      return { ...s, tab: a.tab };
    case "push":
      return { tab: "browse", browse: [...(s.tab === "browse" ? s.browse : []), a.screen] };
    case "back":
      return { ...s, browse: s.browse.slice(0, -1) };
    case "renamed":
      return { ...s, browse: s.browse.map((x) => (x.kind === "project" && x.name === a.from ? { kind: "project", name: a.to } : x)) };
    case "removed": {
      const i = s.browse.findIndex((x) => x.kind === "project" && x.name === a.project);
      return i < 0 ? s : { ...s, browse: s.browse.slice(0, i) };
    }
  }
}

export function screenOf(s: MobileNav): Screen {
  if (s.tab !== "browse") return { kind: s.tab };
  return s.browse[s.browse.length - 1] ?? { kind: "browse" };
}

/** The source of the cross views (`useCrossViews`' nav, the Sidebar `active` shape). Screens without one read the inbox. */
export function crossNavOf(s: MobileNav): { kind: "inbox" | "today" | "upcoming" | "labels" | "project" | "label"; name?: string } {
  const sc = screenOf(s);
  switch (sc.kind) {
    case "today":
    case "upcoming":
    case "labels":
      return { kind: sc.kind };
    case "project":
    case "label":
      return { kind: sc.kind, name: sc.name };
    default:
      return { kind: "inbox" };
  }
}

/** The project the list shows and quick add adds to: the open project, else the inbox. */
export function projectOf(s: MobileNav, inbox: string): string {
  const sc = screenOf(s);
  return sc.kind === "project" ? sc.name : inbox;
}
```

Run: `npm run test:web 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 4: Rewrite `TabBar.tsx`, and the tab bar / FAB in `MobileShell`**

`src/components/TabBar.tsx`:

```tsx
import type React from "react";
import { Calendar, CalendarDays, Inbox, LayoutGrid } from "lucide-react";
import type { MobileTab } from "../app/mobileNav";
import { Glass } from "./Glass";

/** Spec ④ iPhone §3.1: one floating glass pill, 28 from the sides, 58 high, 23 above the screen's bottom edge. */
export const TAB_BAR = { side: 28, height: 58, bottom: 23 } as const;

export type TabBarProps = {
  active?: MobileTab;
  onChange?: (t: MobileTab) => void;
  /** The day of the month on the 今日 icon. */
  day?: number;
};

function TodayIcon({ day }: { day: number }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", width: 22, height: 22 }}>
      <Calendar size={22} />
      <span aria-hidden style={{ position: "absolute", left: 0, right: 0, top: 9, textAlign: "center", fontSize: 9, lineHeight: "11px", fontWeight: 700 }}>
        {day}
      </span>
    </span>
  );
}

const tabs: { id: MobileTab; label: string; Icon?: React.ComponentType<{ size?: number }> }[] = [
  { id: "inbox", label: "受信トレイ", Icon: Inbox },
  { id: "today", label: "今日" },
  { id: "upcoming", label: "近日", Icon: CalendarDays },
  { id: "browse", label: "閲覧", Icon: LayoutGrid },
];

/** The tab pill. The caller places it (MobileShell: absolute, TAB_BAR from the edges). Stateless (active + onChange). */
export function TabBar({ active, onChange, day = new Date().getDate() }: TabBarProps) {
  return (
    <Glass
      role="navigation"
      aria-label="タブ"
      radius={TAB_BAR.height / 2}
      style={{ height: TAB_BAR.height, boxSizing: "border-box", display: "flex", alignItems: "stretch", padding: 4, fontFamily: "var(--font-body)" }}
    >
      {tabs.map(({ id, label, Icon }) => {
        const on = id === active;
        return (
          <button
            key={id}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => onChange?.(id)}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              padding: 0,
              border: 0,
              borderRadius: (TAB_BAR.height - 8) / 2,
              background: on ? "var(--color-bg-hover)" : "none",
              fontFamily: "var(--font-body)",
              color: on ? "var(--color-accent)" : "var(--color-text-primary)",
              cursor: "pointer",
            }}
          >
            {Icon ? <Icon size={22} /> : <TodayIcon day={day} />}
            <span style={{ fontSize: 10, lineHeight: "12px", whiteSpace: "nowrap" }}>{label}</span>
          </button>
        );
      })}
    </Glass>
  );
}
```

`TabBar.stories.tsx`:
- `Variants` shows `active` = `"inbox"`, `"today"`, `"upcoming"`, `"browse"` and none, each inside a 390-wide box with `padding: "16px 28px"`, with `day={26}`.
- `Playground` uses `useState<MobileTab | undefined>("today")`.

`MobileShell`:
- Remove the `cur` / `setCur` state (stories pass `tab` directly), and the `useEffect` / `useState` imports it leaves unused (`tsc` flags them).
- `tab?: MobileTab`; drop `"none"`.
- Add `today?: string` and drop `onMenu`.
- Replace the old tab-bar block and the FAB block with:

```tsx
      {tab !== undefined && (
        <div style={{ position: "absolute", left: TAB_BAR.side, right: TAB_BAR.side, bottom: TAB_BAR.bottom, zIndex: 1 }}>
          <TabBar active={tab} onChange={onTabChange} day={today ? Number(today.slice(8, 10)) : undefined} />
        </div>
      )}
      {fab && (
        <button
          type="button"
          aria-label="タスクを追加"
          onClick={onFab}
          style={{
            position: "absolute",
            right: 18,
            bottom: TAB_BAR.bottom + TAB_BAR.height + 10,
            zIndex: 2,
            width: 62,
            height: 62,
            display: "grid",
            placeItems: "center",
            padding: 0,
            border: 0,
            borderRadius: 31,
            background: "var(--color-accent)",
            boxShadow: "var(--shadow-fab)",
            color: "#FFFFFF", // white on accent
            cursor: "pointer",
          }}
        >
          <Plus size={26} />
        </button>
      )}
```

Inside the scroll body, after `{children}`, add a spacer so the last rows clear the floating bar and button:

```tsx
          {tab !== undefined && <div aria-hidden style={{ flex: "0 0 auto", height: TAB_BAR.bottom + TAB_BAR.height + 62 + 24 }} />}
```

Without a tab bar (M-03), keep the bottom safe area as the screens do today.

`MobileHeader`: delete `onMenu` (prop, doc and the `Menu` button branch). `MobileShell` stops passing it.

- [ ] **Step 5: `MobileBrowse`, the Browse look of `ProjectItem` / `SidebarItem`, `ProjectMenuSheet`**

`ProjectItem` (mobile values only; the desktop values stay):
- `padding: mobile ? "11px 0" : "7px 10px"`
- `borderRadius: mobile ? 0 : 6`
- The icon is the `Hash` for both (delete the mobile dot branch).
- The label is `fontSize: mobile ? 16 : 14`, `lineHeight: mobile ? "22px" : "20px"`.
- Update the `mobile` doc comment to "iPhone 閲覧 tab: full-width rows, 16 text, colored #".

`SidebarItem` (mobile values only):
- `padding: mobile ? "11px 0" : "7px 10px"`
- `borderRadius: mobile ? 0 : 6`
- The label is `fontSize: mobile ? 16 : 14`, `lineHeight: mobile ? "22px" : "20px"`.

`src/views/mobile/MobileBrowse.tsx`:

```tsx
import type React from "react";
import { Search, Settings, Tag } from "lucide-react";
import type { MobileTab } from "../../app/mobileNav";
import { ProjectItem } from "../../components/ProjectItem";
import { SidebarItem } from "../../components/SidebarItem";
import { SyncStatus, type SyncState } from "../../components/SyncStatus";
import type { Counts } from "../../mock/data";
import type { Project } from "../../types/model";
import { MobileShell } from "./MobileShell";

export type MobileBrowseProps = {
  projects: Project[];
  counts: Counts;
  syncState: SyncState;
  lastSyncedAt?: string;
  syncOffText?: string;
  syncErrorText?: string;
  /** The sync row (spec ④ iPhone §3.2): sync now, or open the sync settings when a sync cannot fix it (the caller decides). */
  onSync?: () => void;
  onOpenProject?: (name: string) => void;
  onOpenLabels?: () => void;
  onSearch?: () => void;
  onSettings?: () => void;
  fill?: boolean;
  today?: string;
  banner?: React.ReactNode;
  overlay?: React.ReactNode;
  onTabChange?: (t: MobileTab) => void;
  onFab?: () => void;
};

/** M-06 閲覧 (spec ④ iPhone §3.2): sync row, 「マイプロジェクト」 (inbox excluded: it has a tab), 「ラベル」. Search and settings in the top pill. */
export function MobileBrowse(p: MobileBrowseProps) {
  return (
    <MobileShell
      fill={p.fill}
      today={p.today}
      banner={p.banner}
      overlay={p.overlay}
      title="閲覧"
      largeTitle
      actions={[
        { icon: Search, label: "検索", onClick: p.onSearch },
        { icon: Settings, label: "設定", onClick: p.onSettings },
      ]}
      tab="browse"
      onTabChange={p.onTabChange}
      fab
      onFab={p.onFab}
    >
      <div style={{ padding: "0 15px" }}>
        <div style={{ padding: "8px 0" }}>
          <SyncStatus state={p.syncState} lastSyncedAt={p.lastSyncedAt} onClick={p.onSync} offText={p.syncOffText} errorText={p.syncErrorText} />
        </div>
        <h2 style={{ margin: "16px 0 4px", fontSize: 15, lineHeight: "20px", fontWeight: 700, color: "var(--color-text-primary)" }}>マイプロジェクト</h2>
        {p.projects
          .filter((x) => !x.inbox)
          .map((x) => (
            <ProjectItem mobile key={x.name} color={x.color} label={x.name} count={p.counts[x.name]} onClick={() => p.onOpenProject?.(x.name)} />
          ))}
        <div style={{ height: 16 }} />
        <SidebarItem mobile icon={Tag} label="ラベル" onClick={p.onOpenLabels} />
      </div>
    </MobileShell>
  );
}
```

`src/views/mobile/ProjectMenuSheet.tsx`: the desktop 「その他」 menu items for a project, in a sheet. Delete asks inside the sheet, like `TaskMenuSheet`.

```tsx
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { SheetRow } from "./BottomSheet";

export type ProjectMenuSheetProps = { project: string; onRename: () => void; onDelete: () => void; onClose: () => void };

/** The 「…」 of a project's top bar (spec ④ iPhone §3.4): the desktop 「その他」 items 「名前を変更」 / 「削除」. */
export function ProjectMenuSheet({ project, onRename, onDelete, onClose }: ProjectMenuSheetProps) {
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <div role="group" aria-label="削除の確認" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <div style={{ fontSize: 14, lineHeight: "20px", color: "var(--color-text-secondary)" }}>プロジェクト「{project}」を削除します (archive フォルダに移動)。</div>
        <SheetRow
          icon={<Trash2 size={18} />}
          label="本当に削除"
          danger
          onClick={() => {
            onDelete();
            onClose();
          }}
        />
        <SheetRow label="キャンセル" onClick={() => setConfirm(false)} />
      </div>
    );
  }
  return (
    <div role="group" aria-label="プロジェクトの操作" style={{ display: "flex", flexDirection: "column" }}>
      <SheetRow icon={<Pencil size={18} />} label="名前を変更" onClick={onRename} />
      <SheetRow icon={<Trash2 size={18} />} label="削除" danger onClick={() => setConfirm(true)} />
    </div>
  );
}
```

- [ ] **Step 6: Screens drop the drawer and the hamburger**

- `MobileProjectView`:
  - Remove the `Drawer` import and the `"drawer"` overlay (`initialOverlay?: "none" | "quickAdd"`).
  - Remove `onMenu`; add `onBack?: () => void` (passed to the shell) and `today` to the shell.
  - `tab?: MobileTab` defaults to `"inbox"`.
- `MobileToday`, `MobileUpcoming`, `MobileLabels`, `MobileLabelDetail`, `MobileSearch`: remove `onMenu`; pass `today` to the shell.
- Tabs:
  - `MobileLabels` and `MobileLabelDetail` use `tab="browse"` and take `onBack`.
  - `MobileSearch` uses `tab="browse"` and takes `onBack`.
  - `MobileSettings` uses `tab="browse"` (was `"none"`).
- Each `onTabChange` type becomes `(t: MobileTab) => void`.
- Delete `src/views/mobile/Drawer.tsx`.

- [ ] **Step 7: `MobileMain` on the new navigation**

Imports:
- Remove `Drawer`, `MobileHeader` (if still there) and `type TabBarProps`.
- Add:

```ts
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { INITIAL_NAV, crossNavOf, projectOf, reduceNav, screenOf, type BrowseScreen, type MobileTab } from "./mobileNav";
import { MobileBrowse } from "../views/mobile/MobileBrowse";
import { ProjectMenuSheet } from "../views/mobile/ProjectMenuSheet";
import { TextSheet } from "../views/mobile/TextSheet";
```

- Delete the `Nav` and `Tab` type aliases.

State: replace the `tab`, `nav`, `drawer` and `settingsOpen` states with:

```ts
  // 画面: 下のタブと「閲覧」の中の画面の積み重ね (spec ④ iPhone §3.1-3.2)。起動直後は受信トレイ。
  const [nav, dispatchNav] = useReducer(reduceNav, INITIAL_NAV);
  const screen = screenOf(nav);
  const settingsOpen = screen.kind === "settings";
  const goTab = (id: MobileTab) => dispatchNav({ type: "tab", tab: id });
  const push = (s: BrowseScreen) => dispatchNav({ type: "push", screen: s });
  const back = () => dispatchNav({ type: "back" });
  // プロジェクトの「…」(名前を変更 / 削除)
  const [projectSheet, setProjectSheet] = useState<"menu" | "rename" | null>(null);
```

Then:
- `headerSync`: `if (syncNeedsSettings) push({ kind: "settings" }); else if (syncState !== "syncing") void sync.syncNow(true);`
- `const viewNav = crossNavOf(nav);`
- `const listProject = screen.kind === "inbox" || screen.kind === "project";`
- `const navCurrent = projectOf(nav, app.inbox);`
- `useSearch(screen.kind === "search")`
- Delete the old `goTab` and `navigateTo`.
- In `openTaskAt`, delete `setDrawer(false)` and `setSettingsOpen(false)`. The detail renders over settings, as before.
- Delete the now-unused `syncNow` constant, and `displayName` from the `useSummaries` destructuring. `tsc` flags them; `loadDisplayName` stays.
- `header` becomes `{ fill: true as const, onFab: openQuickAdd, onTabChange: goTab, today }`.

Project actions (after `moveTask`):

```ts
  const renameProject = async (name: string) => {
    const from = navCurrent;
    try {
      const r = await api.renameProject(from, name);
      dispatchNav({ type: "renamed", from, to: r.name });
      await refreshSummaries();
    } catch (e) {
      showError(e);
    } finally {
      void ext.refresh(); // held projects are held again under the new name (as desktop)
    }
  };
  const deleteProject = async () => {
    const name = navCurrent;
    try {
      await api.deleteProject(name);
      dispatchNav({ type: "removed", project: name });
      await refreshSummaries();
    } catch (e) {
      showError(e);
    } finally {
      void ext.refresh();
    }
  };
```

Layers:
- Delete the `drawer && <Drawer …/>` block.
- After the reminder `BottomSheet`, add:

```tsx
      <BottomSheet fill open={projectSheet !== null} title={projectSheet === "rename" ? "名前を変更" : navCurrent} onClose={() => setProjectSheet(null)}>
        {projectSheet === "menu" && (
          <ProjectMenuSheet project={navCurrent} onRename={() => setProjectSheet("rename")} onDelete={() => void deleteProject()} onClose={() => setProjectSheet(null)} />
        )}
        {projectSheet === "rename" && (
          <TextSheet
            label="プロジェクト名"
            value={navCurrent}
            onSave={(v) => {
              const t = v.trim();
              if (t && t !== navCurrent) void renameProject(t);
            }}
            onClose={() => setProjectSheet(null)}
          />
        )}
      </BottomSheet>
```

`frame()`: `<MobileShell fill title={title} onBack={nav.tab === "browse" && nav.browse.length > 0 ? back : undefined} tab={nav.tab} onTabChange={goTab} today={today} banner={banner} overlay={layers}>`.

Settings: `if (settingsOpen && !detail)` renders `MobileSettings` with `onBack={back}` and `onTabChange={goTab}` (the rest as now).

Body: replace everything from `// ---- 本文 ----` to the end of the function with:

```tsx
  // ---- 本文 ----
  if (screen.kind === "today") {
    const d = todayData.data;
    if (todayData.error) return frame("今日", todayData.error, "danger");
    if (!d) return frame("今日", "読み込み中…");
    return (
      <MobileToday
        live
        {...header}
        banner={banner}
        onRefresh={pullRefresh}
        overdue={d.overdue}
        todays={d.today}
        onToggleDone={(t, done) => void cross.toggleDone(t, done)}
        onOpenTask={openCross}
        onReschedule={() => setSheet({ kind: "reschedule" })}
        {...rowOps}
        overlay={layers}
      />
    );
  }
  if (screen.kind === "upcoming") {
    const d = lastUpcoming.current;
    if (upcomingData.error) return frame("近日", upcomingData.error, "danger");
    if (!d) return frame("近日", "読み込み中…");
    return (
      <MobileUpcoming
        live
        {...header}
        banner={banner}
        onRefresh={pullRefresh}
        tasks={d.days.flatMap((g) => g.tasks)}
        onToggleDone={(t, done) => void cross.toggleDone(t, done)}
        onOpenTask={openCross}
        onExtend={() => setUpDays((n) => Math.min(91, n + 7))}
        {...rowOps}
        overlay={layers}
      />
    );
  }
  if (screen.kind === "browse") {
    return (
      <MobileBrowse
        {...header}
        banner={banner}
        overlay={layers}
        projects={summaries}
        counts={counts}
        syncState={syncState}
        lastSyncedAt={formatSynced(syncStatus?.lastSynced)}
        syncOffText="同期オフ"
        syncErrorText={syncErrorText(syncStatus, syncClickable)}
        onSync={syncState === "off" ? () => push({ kind: "settings" }) : headerSync}
        onOpenProject={(name) => push({ kind: "project", name })}
        onOpenLabels={() => push({ kind: "labels" })}
        onSearch={() => push({ kind: "search" })}
        onSettings={() => push({ kind: "settings" })}
      />
    );
  }
  if (screen.kind === "search") {
    return (
      <MobileSearch
        {...header}
        banner={banner}
        onBack={back}
        query={search.query}
        onChangeQuery={search.setQuery}
        includeDone={search.includeDone}
        onToggleIncludeDone={search.toggleIncludeDone}
        hits={search.hits}
        busy={search.busy}
        onOpenHit={(h: SearchHit) => openCross(h.task)}
        onToggleDone={(h, done) => void cross.toggleDone(h.task, done).then(() => search.refresh())}
        overlay={layers}
      />
    );
  }
  if (screen.kind === "labels") {
    const d = labelsData.data;
    if (labelsData.error) return frame("ラベル", labelsData.error, "danger");
    if (!d) return frame("ラベル", "読み込み中…");
    return <MobileLabels {...header} banner={banner} onBack={back} labels={d.labels} counts={d.counts} onOpenLabel={(name) => push({ kind: "label", name })} overlay={layers} />;
  }
  if (screen.kind === "label") {
    const d = labelData.data;
    if (labelData.error) return frame(`@${screen.name}`, labelData.error, "danger");
    if (!d || !labelName) return frame(`@${screen.name}`, "読み込み中…");
    return (
      <MobileLabelDetail
        {...header}
        banner={banner}
        onBack={back}
        label={d.label.name}
        tasks={d.tasks}
        onToggleDone={(t, done) => void cross.toggleDone(t, done)}
        onOpenTask={openCross}
        overlay={layers}
      />
    );
  }
  // 受信トレイ (タブ) / プロジェクト (閲覧から)
  const title = current === app.inbox ? "受信トレイ" : current;
  if (p.error) return frame(title, p.error, "danger", () => void p.reload().catch(() => undefined));
  if (!view) return frame(title, "読み込み中…");
  return (
    <MobileProjectView
      key={current}
      live
      {...header}
      banner={banner}
      onRefresh={pullRefresh}
      tab={nav.tab}
      onBack={screen.kind === "project" ? back : undefined}
      onProjectMenu={screen.kind === "project" ? () => setProjectSheet("menu") : undefined}
      title={title}
      project={current}
      tasks={view.tasks}
      sections={view.sections}
      projects={summaries}
      onToggleDone={(t, done) => void p.completeTask(t.no, done)}
      onOpenTask={(t) => setDetail({ project: current, no: t.no })}
      {...rowOps}
      overlay={layers}
    />
  );
```

`header` carries `today`. The screens that already take `today` keep it, and the others now accept it for the tab icon.

- [ ] **Step 8: Stories and storyboard**

`Mobile.stories.tsx`:
- `M06` becomes

```tsx
export const M06: Story = {
  name: "M-06 閲覧",
  render: () => <MobileBrowse projects={projects} counts={counts} syncState="synced" lastSyncedAt="2 分前" today={TODAY} />,
};
```

  Import `counts` from mock data and `MobileBrowse`.
- The other stories drop `initialOverlay="drawer"` and pass `today={TODAY}` where the screen takes it.

`design/storyboard.md`:
- The M-06 row's name cell becomes `M-06 閲覧` (id `QzGhM` stays; Task 10 redraws that frame).
- Replace `| M-01 | ハンバーガー | M-06 | ドロワー |` with `| M-01 | 下のタブ「閲覧」 | M-06 | 閲覧タブ (ドロワーは無い) |`.
- Replace `| M-06 | 設定アイコン | M-07 | |` with `| M-06 | 上の帯の「設定」 | M-07 | 戻るで M-06 |`.
- Replace `| M-06 | 項目タップ (今日 / 近日 / プロジェクト) | M-04 / M-05 / M-01 | |` with `| M-06 | プロジェクトの行 | M-01 | 戻るで M-06 |`.
- Add:
  - `| M-06 | 「ラベル」の行 | (ラベルの一覧) | 戻るで M-06 |`
  - `| M-06 | 上の帯の「検索」 | (検索) | 戻るで M-06 |`
  - `| M-06 | 同期の行 | (なし) | 今すぐ同期。同期先が無いときは M-07 |`
  - `| M-01 | 上の帯の「…」 | (メニューのシート) | 名前を変更 / 削除。受信トレイには出ない |`

- [ ] **Step 9: Checks, screenshots, commit**

Run the Task 2 checks (build, `test:web`, `build-storybook`, `check:stories`).

Take screenshots at 390×844 (`$SP/shot.sh "$(sid 'M-06 閲覧')" $SP/m06.png 390 844`, the same for M-01 and M-04). Check:
- the pill is 28 from each side and 23 from the bottom;
- the add button is 62 across, 18 from the right, just above the pill;
- the 今日 icon shows 13 (mock `TODAY` is 2026-10-13).

```bash
git add -A src design/storyboard.md
git commit -m "feat(ios): four tabs, the 閲覧 tab and its screens; the drawer is gone"
```

---

### Task 4: Rows, checkbox, subtasks, completion delay

**Files:**
- Create: `src/components/MobileTaskRow.tsx`, `src/views/mobile/rowProps.ts`, `src/views/mobile/rowProps.test.ts`
- Modify:
  - `src/components/TaskRow.tsx` (wrapper only), `src/components/Checkbox.tsx`
  - `src/views/mobile/MobileProjectView.tsx`, `MobileToday.tsx`, `MobileUpcoming.tsx`, `MobileLabels.tsx` (`MobileLabelDetail`), `MobileSearch.tsx`
  - `src/app/MobileMain.tsx`, `src/stories/screens/Mobile.stories.tsx`

**Interfaces:**
- Consumes: `MobileShell` (Tasks 2-3); `useLeaving` and `LEAVE_DELAY_MS` from `src/views/crossList.tsx`; `useCommentCounts` from `src/app/useComments.ts`.
- Produces:

```ts
// TaskRowProps adds:  projectIsInbox?: boolean  // iPhone: an inbox icon after the project instead of #
// src/components/MobileTaskRow.tsx
export const MOBILE_ROW: { checkbox: 22; gap: 12; indent: 34; oneLine: 48; twoLine: 63 };
export function MobileTaskRow(p: TaskRowProps): JSX.Element; // root carries data-mobile-row
// Checkbox: size?: 18 | 20 | 22  (22: iPhone rows; 20 stays only for MobileTaskDetail until Task 9)
// src/views/mobile/rowProps.ts
export type RowContext = { today: string; inbox?: string; colors?: Record<string, string>; comments?: Record<string, number> };
export function mobileRowProps(t: Task, c: RowContext, show?: { date?: boolean; project?: boolean }):
  Pick<TaskRowProps, "title" | "description" | "priority" | "date" | "recurring" | "commentCount" | "project" | "projectColor" | "projectIsInbox">;
// Screens add: rowContext?: Omit<RowContext, "today">
```

- [ ] **Step 1: Write the failing test** (`src/views/mobile/rowProps.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mobileRowProps } from "./rowProps.ts";
import type { Task } from "../../types/model.ts";

const t = (p: Partial<Task>): Task => ({
  no: 1, project: "仕事", category: null, title: "週報を書く", assignee: "たろう", priority: 2, progress: 0,
  labels: [], reminders: [], order: 0, createdAt: "2026-10-01T09:00", ...p,
});
const ctx = { today: "2026-10-13", inbox: "受信トレイ", colors: { 仕事: "var(--color-priority-3)" }, comments: { "仕事/1": 2 } };

test("meta_line_parts", () => {
  const r = mobileRowProps(t({ due: "2026-10-12", rrule: "FREQ=DAILY", note: "一行目\n二行目" }), ctx, { project: true });
  assert.equal(r.description, "一行目");
  assert.deepEqual(r.date, { label: "昨日", tone: "danger" });
  assert.equal(r.recurring, true);
  assert.equal(r.commentCount, 2);
  assert.equal(r.project, "仕事");
  assert.equal(r.projectColor, "var(--color-priority-3)");
  assert.equal(r.projectIsInbox, undefined);
});

test("inbox_rows_show_the_inbox", () => {
  const r = mobileRowProps(t({ project: "受信トレイ" }), ctx, { project: true });
  assert.equal(r.project, "受信トレイ");
  assert.equal(r.projectIsInbox, true);
  assert.equal(r.projectColor, undefined);
});

test("hidden_parts_stay_off", () => {
  const r = mobileRowProps(t({ due: "2026-10-13" }), ctx, { date: false });
  assert.equal(r.date, undefined);
  assert.equal(r.project, undefined);
  assert.equal(r.commentCount, 2);
  assert.equal(mobileRowProps(t({ no: 9 }), ctx).commentCount, undefined);
  assert.equal(mobileRowProps(t({ note: "" }), ctx).description, undefined);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web 2>&1 | grep -E "ERR_MODULE_NOT_FOUND" | head -1`
Expected: `rowProps.ts` not found.

- [ ] **Step 3: Implement `rowProps.ts`**

```ts
import type { TaskRowProps } from "../../components/TaskRow";
import type { Task } from "../../types/model";
import { dateLabel } from "../../mock/data.ts";

export type RowContext = { today: string; inbox?: string; colors?: Record<string, string>; comments?: Record<string, number> };

/** Spec ④ iPhone §4.1: what an iPhone row shows. `show.project` on cross views (Today, Upcoming, label, search), not on a project's own list. */
export function mobileRowProps(
  t: Task,
  c: RowContext,
  show: { date?: boolean; project?: boolean } = {},
): Pick<TaskRowProps, "title" | "description" | "priority" | "date" | "recurring" | "commentCount" | "project" | "projectColor" | "projectIsInbox"> {
  const inbox = c.inbox !== undefined && t.project === c.inbox;
  return {
    title: t.title,
    description: t.note?.split("\n")[0] || undefined,
    priority: t.priority,
    date: show.date === false ? undefined : dateLabel(t.due, c.today),
    recurring: t.rrule ? true : undefined,
    commentCount: c.comments?.[`${t.project}/${t.no}`] || undefined,
    project: show.project ? (inbox ? "受信トレイ" : t.project) : undefined,
    projectColor: show.project && !inbox ? c.colors?.[t.project] : undefined,
    projectIsInbox: show.project && inbox ? true : undefined,
  };
}
```

`mock/data.ts` has only type imports, so the `.ts` value import works under node. Add `projectIsInbox?: boolean` to `TaskRowProps` (doc: "iPhone: the project is the inbox: an inbox icon instead of #") before running.

Run: `npm run test:web 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 4: `MobileTaskRow` and the `TaskRow` wrapper**

`src/components/TaskRow.tsx`:
- Rename `export function TaskRow(p: TaskRowProps)` to `function DesktopTaskRow(p: TaskRowProps)`. Change nothing else in it; its `mobile` constant is now always false.
- Add:

```tsx
import { MobileTaskRow } from "./MobileTaskRow";

/** Desktop and iPhone rows share the props; the iPhone draws MobileTaskRow (spec ④ iPhone §4.1). */
export function TaskRow(p: TaskRowProps) {
  return p.variant === "mobile" ? <MobileTaskRow {...p} /> : <DesktopTaskRow {...p} />;
}
```

`src/components/MobileTaskRow.tsx`:

```tsx
import type React from "react";
import { ChevronDown, ChevronRight, Hash, Inbox, ListTree, MessageSquare, Repeat } from "lucide-react";
import { Checkbox } from "./Checkbox";
import { DateChip } from "./DateChip";
import type { TaskRowProps } from "./TaskRow";

/** Spec ④ iPhone §4.1-4.2. The list pads 15 at both sides; the text starts 12 after the 22 checkbox (x 49); a child's checkbox sits under its parent's text. */
export const MOBILE_ROW = { checkbox: 22, gap: 12, indent: 34, oneLine: 48, twoLine: 63 } as const;

const oneLine: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const meta: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  fontSize: 12,
  lineHeight: "17px",
  color: "var(--color-text-secondary)",
  flex: "0 0 auto",
};

export function MobileTaskRow(p: TaskRowProps) {
  const sub = p.subtasks;
  const hasMeta = !!(p.date || p.recurring || sub || p.commentCount || p.project);
  const twoOrMore = hasMeta || !!p.description;
  return (
    <div
      data-mobile-row=""
      aria-current={p.focused ? "true" : undefined}
      onClick={p.onClick}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: MOBILE_ROW.gap,
        boxSizing: "border-box",
        // 2 lines: 11 + 22 + 2 + 17 + 11 = 63; 1 line: 13 + 22 + 13 = 48
        padding: twoOrMore ? "11px 0" : "13px 0",
        marginLeft: (p.indent ?? 0) * MOBILE_ROW.indent,
        background: p.focused ? "var(--color-bg-hover)" : undefined,
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ display: "flex", flex: "0 0 auto" }} onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={p.done} priority={p.priority} onChange={() => p.onToggleDone?.()} size={22} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ ...oneLine, flex: 1, minWidth: 0, fontSize: 16, lineHeight: "22px", color: p.done ? "var(--color-text-muted)" : "var(--color-text-primary)" }}>{p.title}</div>
          {sub && (
            // Spec ④ iPhone §4.2: a chevron at the right of the title line; switches at once (no motion).
            <button
              type="button"
              aria-label={sub.expanded ? "サブタスクを折りたたむ" : "サブタスクを展開"}
              aria-expanded={sub.expanded}
              onClick={(e) => {
                e.stopPropagation();
                p.onToggleExpand?.();
              }}
              style={{ display: "grid", placeItems: "center", width: 44, height: 44, margin: "-11px -11px -11px 0", padding: 0, border: 0, background: "none", color: "var(--color-text-secondary)", cursor: "pointer", flex: "0 0 auto" }}
            >
              {sub.expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </button>
          )}
        </div>
        {p.description && <div style={{ ...oneLine, fontSize: 13, lineHeight: "18px", color: "var(--color-text-secondary)" }}>{p.description}</div>}
        {hasMeta && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {sub && (
              <span style={meta}>
                <ListTree size={12} aria-hidden />
                {sub.done}/{sub.total}
              </span>
            )}
            {p.date && <DateChip label={p.date.label} tone={p.date.tone} />}
            {p.recurring && (
              <span role="img" aria-label="繰り返し" style={meta}>
                <Repeat size={12} />
              </span>
            )}
            {p.commentCount ? (
              <span style={meta} aria-label={`コメント ${p.commentCount} 件`}>
                <MessageSquare size={12} aria-hidden />
                {p.commentCount}
              </span>
            ) : null}
            {p.project && (
              <span style={{ ...meta, flex: "1 1 auto", minWidth: 0, justifyContent: "flex-end", marginLeft: "auto" }}>
                <span style={oneLine}>{p.project}</span>
                {p.projectIsInbox ? <Inbox size={12} aria-hidden /> : <Hash size={12} color={p.projectColor ?? "var(--color-text-muted)"} aria-hidden />}
              </span>
            )}
          </div>
        )}
      </div>
      {/* Hairline from the text's left edge to the right padding; none under the checkbox */}
      <span aria-hidden style={{ position: "absolute", left: MOBILE_ROW.checkbox + MOBILE_ROW.gap, right: 0, bottom: 0, height: 0.5, background: "var(--color-border)" }} />
    </div>
  );
}
```

`Checkbox.tsx`: `size?: 18 | 20 | 22`. Replace the ring and fill lines; the desktop (18) values are unchanged:

```tsx
  // Desktop 18 and iPhone rows 22 (Todoist): a 2 px ring and, for priority 1-3, a 10 % fill of its color. 20 (iPhone task screen until Task 9): 1.5 px, no fill.
  const ring = size === 20 ? 1.5 : 2;
  const tint = size !== 20 && !checked && priority < 4;
```

Then use `border: `${ring}px solid ${color}`` and `background: tint ? `color-mix(in srgb, ${priorityVar[priority]} 10%, transparent)` : "transparent"`. The `desktop` const stays for the hover preview.

- [ ] **Step 5: Screens use `mobileRowProps`, 15 side padding, instant subtasks, the 0.25 s leave**

Every list container in `src/views/mobile/*.tsx` changes `padding: "0 16px"` to `padding: "0 15px"` (`grep -n '"0 16px"' src/views/mobile/*.tsx`).

`MobileProjectView`:
- Add the prop `rowContext?: Omit<RowContext, "today">`.
- Remove `priorityOf`.
- Rows use `{...mobileRowProps(t, { today, ...rowContext })}` (no project on its own list).
- Drop `AnimatePresence` / `Collapse` around subtasks: `{open && (<>…kids…<div style={{ marginLeft: MOBILE_ROW.indent }}><AddTaskRow … /></div></>)}`.
- Completion leaves like the desktop:

```tsx
  const leave = useLeaving(tasks);
  const isDone = (t: Task) => (live ? t.progress === 100 || leave.isLeaving(t) : local.isDone(t));
  const toggle = (t: Task, group = "", index = 0) => {
    if (!live) return local.toggle(t);
    const next = !isDone(t);
    if (next) leave.begin(t, group, index);
    else leave.cancel(t);
    onToggleDone?.(t, next);
  };
  /** One list (the unsectioned rows, or a section): completed rows stay LEAVE_DELAY_MS, then leave in 0.1 s. */
  const list = (group: string, rows: Task[]) => {
    const items = (live ? leave.merge(group, rows) : rows).map((t, i) => {
      const el = renderRow(t, group, i);
      return live ? (
        <Collapse key={t.no} duration={0.1}>
          {el}
        </Collapse>
      ) : (
        el
      );
    });
    return live ? <AnimatePresence initial={false}>{items}</AnimatePresence> : items;
  };
```

  - `renderRow(t, group, index)` calls `toggle(t, group, index)` from the checkbox and from the swipe (`swipeable` gets the same `onComplete`).
  - The groups are `"s:"` for the unsectioned rows and `` `s:${s.name}` `` per section: `{unsectioned.map(renderRow)}` becomes `{list("s:", unsectioned)}`, and each section's `{rows.map(renderRow)}` becomes `{list(`s:${s.name}`, rows)}`.
  - Import `useLeaving` from `../crossList`.
- `MobileToday`:
  - groups `"overdue"` / `"today"`, rows `mobileRowProps(t, ctx, { project: true, date: group === "overdue" })`;
  - the same `useLeaving` pattern.
- `MobileUpcoming`:
  - group = the day, rows `mobileRowProps(t, ctx, { project: true, date: false })`;
  - the same pattern.
- `MobileLabelDetail`: group `"label"`, rows `mobileRowProps(t, ctx, { project: true })`, the same pattern.
- `MobileSearch`: rows `mobileRowProps(h.task, ctx, { project: true })`; no leave (the search refreshes).

`MobileMain`:
- Add the imports `useMemo`, `useCommentCounts` (from `./useComments`) and `type RowContext`.
- Compute:

```ts
  const commentCounts = useCommentCounts(summaries.map((s) => s.name));
  const rowContext = useMemo<Omit<RowContext, "today">>(
    () => ({ inbox: app.inbox, colors: Object.fromEntries(summaries.map((s) => [s.name, s.color])), comments: commentCounts }),
    [app.inbox, summaries, commentCounts],
  );
```

- Pass `rowContext={rowContext}` to `MobileProjectView`, `MobileToday`, `MobileUpcoming`, `MobileLabelDetail`, `MobileSearch`.

- [ ] **Step 6: A long-title story and the row checks**

Add a story that is not on the storyboard:

```tsx
export const M01Long: Story = {
  name: "M-01 長い名前 (fill)",
  render: () => {
    const Live = () => {
      const { list, toggle } = useTasks([...shopping, { ...shopping[1], no: 90, title: LONG_TITLE, category: "今週", order: 9 }]);
      return <MobileProjectView live fill project="買い物" tasks={list} sections={sections} today={TODAY} onToggleDone={toggle} />;
    };
    return <Live />;
  },
};
```

Import `LONG_TITLE` from mock data.

Run the Task 2 checks. Then drive `M-01 長い名前 (fill)` and `M-01b サブタスク展開` with `drive-m.mjs` and one eval step:

```json
[{ "wait": 1500, "name": "rows", "eval": "[...document.querySelectorAll('[data-mobile-row]')].map(e => { const r = e.getBoundingClientRect(); const c = e.querySelector('[role=checkbox]').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.height), Math.round(c.left), Math.round(c.width), e.scrollWidth <= e.clientWidth]; })", "shot": "rows" }]
```

Expected:
- every row has height 48 or 63;
- the checkbox is 22 wide at left 15;
- a subtask row's checkbox is at left 49;
- no row is wider than its box (the long title ends in "…").

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat(ios): Todoist-like rows (22 checkbox, meta line, 63/48), instant subtasks, 0.25 s leave"
```

---

### Task 5: Section and day headers, the overdue line, Upcoming's month line

**Files:**
- Create: `src/views/mobile/mobileDates.ts`, `src/views/mobile/mobileDates.test.ts`, `src/views/mobile/MobileWeekNav.tsx`
- Modify:
  - `src/components/SectionHeader.tsx` (wrapper only), `src/views/WeekStrip.tsx` (mobile values only)
  - `src/views/mobile/MobileProjectView.tsx`, `MobileToday.tsx`, `MobileUpcoming.tsx`

**Interfaces:**
- Produces:

```ts
// src/views/mobile/mobileDates.ts
export function dayHeading(ymd: string, today: string): string;  // 「10月26日 · 今日 · 月曜日」
export function monthLabel(ymd: string): string;                  // 「2026年10月」
export function monthWeeks(ymd: string): string[][];              // Monday-first weeks covering the month
// SectionHeaderProps adds: tight?: boolean  // iPhone: 16 above instead of 36 (the first header under the title)
// MobileWeekNav: { today: string; onSelect?: (ymd: string) => void; initialOpen?: boolean }
```

- [ ] **Step 1: Write the failing test** (`src/views/mobile/mobileDates.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayHeading, monthLabel, monthWeeks } from "./mobileDates.ts";

test("day_headings", () => {
  assert.equal(dayHeading("2026-10-26", "2026-10-26"), "10月26日 · 今日 · 月曜日");
  assert.equal(dayHeading("2026-10-27", "2026-10-26"), "10月27日 · 明日 · 火曜日");
  assert.equal(dayHeading("2026-10-30", "2026-10-26"), "10月30日 · 金曜日");
});

test("month_label", () => {
  assert.equal(monthLabel("2026-10-26"), "2026年10月");
});

test("month_weeks_start_on_monday", () => {
  const w = monthWeeks("2026-10-26"); // 10-01 is a Thursday
  assert.equal(w.length, 5);
  assert.equal(w[0][0], "2026-09-28");
  assert.equal(w[4][6], "2026-11-01");
  const feb = monthWeeks("2027-02-10"); // 2027-02-01 is a Monday, 28 days
  assert.equal(feb.length, 4);
  assert.equal(feb[0][0], "2027-02-01");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web 2>&1 | grep -E "ERR_MODULE_NOT_FOUND" | head -1`
Expected: `mobileDates.ts` not found.

- [ ] **Step 3: Implement `mobileDates.ts`**

```ts
import { addDays, daysBetween, monthDay, weekdayIndex, weekdayLong } from "../../mock/data.ts";

/** Spec ④ iPhone §4.3: 「10月26日 · 今日 · 月曜日」; tomorrow 「· 明日 ·」; other days 「10月30日 · 金曜日」. */
export function dayHeading(ymd: string, today: string): string {
  const d = daysBetween(ymd, today);
  const rel = d === 0 ? "今日 · " : d === 1 ? "明日 · " : "";
  return `${monthDay(ymd)} · ${rel}${weekdayLong(ymd)}`;
}

/** Upcoming's month line (spec ④ iPhone §3.3): 「2026年10月」. */
export function monthLabel(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return `${y}年${m}月`;
}

/** Monday-first weeks covering the month of `ymd` (days of the next / previous month fill the edges). */
export function monthWeeks(ymd: string): string[][] {
  const first = `${ymd.slice(0, 7)}-01`;
  const [y, m] = ymd.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (weekdayIndex(first) + 6) % 7; // Monday = 0
  const rows = Math.ceil((offset + days) / 7);
  const start = addDays(first, -offset);
  return Array.from({ length: rows }, (_, r) => Array.from({ length: 7 }, (_, c) => addDays(start, r * 7 + c)));
}
```

Run: `npm run test:web 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 4: `SectionHeader` wrapper and the iPhone header**

In `src/components/SectionHeader.tsx`:
- Rename `export function SectionHeader(…)` to `function DesktopSectionHeader(…)`; change nothing else in it.
- Add `tight?: boolean` to `SectionHeaderProps` (doc: "iPhone: 16 above instead of 36, for the first header under the title").
- Update the `mobile` doc to "iPhone (spec ④ iPhone §4.3): 15 bold, no line, 36 above".
- Add:

```tsx
/** Spec ④ iPhone §4.3: 15 bold, no line, 36 above. `trailing` holds the overdue 「再スケジュール」. */
function MobileSectionHeader({ title, count, trailing, tight }: SectionHeaderProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: `${tight ? 16 : 36}px 0 6px`, fontFamily: "var(--font-body)" }}>
      <h2 style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 15, lineHeight: "20px", fontWeight: 700, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {title}
      </h2>
      {count !== undefined && <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" }}>{count}</span>}
      {trailing}
    </div>
  );
}

export function SectionHeader(props: SectionHeaderProps) {
  return props.mobile ? <MobileSectionHeader {...props} /> : <DesktopSectionHeader {...props} />;
}
```

- [ ] **Step 5: Today, Upcoming and project screens**

`MobileProjectView`:
- Sections render `<SectionHeader mobile title={s.name} tight={i === 0 && unsectioned.length === 0} />` (no count).
- No 「…」 on section headers: iPhone has no section menu yet; ②③ adds both.

`MobileToday`:

```tsx
        {(!live || overdue.length > 0) && (
          <section>
            <SectionHeader
              mobile
              tight
              title="期限切れ"
              trailing={
                <button
                  type="button"
                  onClick={onReschedule}
                  style={{ display: "inline-flex", alignItems: "center", gap: 2, minHeight: 32, padding: 0, border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 15, lineHeight: "20px", color: "var(--color-accent)", cursor: "pointer" }}
                >
                  再スケジュール
                  <ChevronRight size={16} aria-hidden />
                </button>
              }
            />
            {/* overdue rows (Task 4) */}
          </section>
        )}
        <section>
          <SectionHeader mobile tight={live && overdue.length === 0} title={dayHeading(today, today)} />
          {/* today rows (Task 4) */}
        </section>
```

The separate 「再スケジュール」 line goes away (spec §4.3).

`MobileUpcoming`:
- Delete the local `dayTitle`; headers use `dayHeading(ymd, today)`.
- Replace the `<WeekStrip …>` with `<MobileWeekNav today={today} onSelect={…the same scroll handler…} />`.

`src/views/WeekStrip.tsx` (mobile values only):
- `boxShadow: mobile ? undefined : "inset 0 -1px 0 var(--color-border)"` (the grabber sits under the iPhone strip).

`src/views/mobile/MobileWeekNav.tsx`:

```tsx
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import { WeekStrip } from "../WeekStrip";
import { monthLabel, monthWeeks } from "./mobileDates";

const HEAD = ["月", "火", "水", "木", "金", "土", "日"] as const;

/** Spec ④ iPhone §3.3: 「2026年10月 >」, the week strip, and a grabber under it; pulling the grabber down (or tapping it, or the month line) opens the month grid. */
export function MobileWeekNav({ today, onSelect, initialOpen = false }: { today: string; onSelect?: (ymd: string) => void; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const pick = (ymd: string) => {
    onSelect?.(ymd);
    setOpen(false);
  };
  return (
    <div style={{ fontFamily: "var(--font-body)" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "4px 0", border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 15, lineHeight: "20px", fontWeight: 600, color: "var(--color-text-primary)", cursor: "pointer" }}
      >
        {monthLabel(today)}
        <ChevronRight size={16} aria-hidden style={{ transform: open ? "rotate(90deg)" : undefined }} />
      </button>
      {open ? (
        <div role="grid" aria-label={monthLabel(today)} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 0" }}>
          <div role="row" style={{ display: "flex" }}>
            {HEAD.map((h) => (
              <span key={h} role="columnheader" style={{ flex: 1, textAlign: "center", fontSize: 10, lineHeight: "14px", color: "var(--color-text-secondary)" }}>
                {h}
              </span>
            ))}
          </div>
          {monthWeeks(today).map((week) => (
            <div role="row" key={week[0]} style={{ display: "flex" }}>
              {week.map((ymd) => {
                const inMonth = ymd.slice(0, 7) === today.slice(0, 7);
                const isToday = ymd === today;
                return (
                  <button
                    key={ymd}
                    type="button"
                    role="gridcell"
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => pick(ymd)}
                    style={{ flex: 1, height: 36, padding: 0, border: 0, borderRadius: 8, background: isToday ? "var(--color-accent-soft)" : "none", fontFamily: "var(--font-body)", fontSize: 15, fontWeight: isToday ? 700 : 400, color: isToday ? "var(--color-accent)" : inMonth ? "var(--color-text-primary)" : "var(--color-text-muted)", cursor: "pointer" }}
                  >
                    {Number(ymd.slice(8, 10))}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <WeekStrip variant="mobile" start={today} today={today} onSelect={onSelect} />
      )}
      <motion.div
        role="button"
        tabIndex={0}
        aria-label={open ? "月の表を閉じる" : "月の表を開く"}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.2}
        onDragEnd={(_, info) => {
          if (info.offset.y > 24) setOpen(true);
          else if (info.offset.y < -24) setOpen(false);
        }}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((v) => !v);
        }}
        style={{ display: "flex", justifyContent: "center", padding: "6px 0 10px", touchAction: "none", cursor: "grab" }}
      >
        <span style={{ width: 36, height: 4, borderRadius: 2, background: "var(--color-border)" }} />
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 6: Checks, screenshots, commit**

Run the Task 2 checks.

Screenshot M-04, M-05 and M-01 at 390×844. Check:
- 「期限切れ」 and the red 「再スケジュール ›」 sit on one line;
- the today header reads 「10月13日 · 今日 · 火曜日」;
- the headers are 15 bold with no line;
- M-05 shows 「2026年10月 ›」, the strip and the grabber.

In M-05, click the grabber (drive step `{ "click": "[aria-label=\"月の表を開く\"]", "wait": 400, "shot": "m05-month" }`) and check that the month grid opens.

Also screenshot the desktop D-05 and diff it against the Task 1 baseline (`cmp`). `WeekStrip`'s desktop branch must be unchanged.

```bash
git add src
git commit -m "feat(ios): 15 bold headers, overdue line with 再スケジュール, day headings, Upcoming month line and grid"
```

---

### Task 6: Sheet frame and motion

**Files:**
- Create: `src/views/mobile/sheetMotion.ts`, `src/views/mobile/sheetMotion.test.ts`
- Rewrite: `src/views/mobile/BottomSheet.tsx`
- Modify:
  - `src/views/mobile/TextSheet.tsx`, `DateSheet.tsx`, `PrioritySheet.tsx`, `MoveSheet.tsx`, `TaskMenuSheet.tsx`, `ReminderSheet.tsx`, `LabelSheet.tsx`, `ProjectMenuSheet.tsx`, `MobileTaskDetail.tsx`
  - `src/app/MobileMain.tsx`, `src/stories/screens/Mobile.stories.tsx`, `design/storyboard.md`

**Interfaces:**
- Consumes: `Glass`, `--color-sheet-bg`, `--color-sheet-card`, `.sheet-card` (Task 1).
- Produces:

```ts
// src/views/mobile/sheetMotion.ts
export const SHEET_OMEGA = 24.4;
export function springProgress(t: number, omega?: number): number;
export const EASE_IN: readonly [0.4, 0, 1, 1];
export const EASE_OUT: readonly [0.2, 0, 0, 1];
export type SheetPhase = "open" | "close" | "detent";
export type SheetTransition =
  | { type: "spring"; stiffness: number; damping: number; mass: 1 }
  | { duration: number; ease: readonly [number, number, number, number] };
export function sheetTransition(phase: SheetPhase, reduced: boolean): SheetTransition;
export const COVERED_SCALE = 0.95;
export type Detent = "auto" | "large" | "full";
export function sheetDragEnd(detent: Detent, offsetY: number, velocityY: number): "close" | Detent;
// BottomSheet props add: confirmForm?: string; size?: "auto" | "large"; covered?: boolean
// BottomSheet.tsx also exports: SheetCard({ children }), SheetRow (restyled, same props)
// TextSheet: formId?: string (default TEXT_SHEET_FORM); export const TEXT_SHEET_FORM = "text-sheet"; no footer buttons
```

- [ ] **Step 1: Write the failing test** (`src/views/mobile/sheetMotion.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHEET_OMEGA, sheetDragEnd, sheetTransition, springProgress } from "./sheetMotion.ts";

test("open_spring_covers_70_percent_in_0_1_s", () => {
  const p = springProgress(0.1);
  assert.ok(p > 0.69 && p < 0.71, String(p));
});

test("open_spring_settles_by_0_37_s_without_overshoot", () => {
  assert.ok(springProgress(0.37) > 0.998);
  let prev = 0;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const p = springProgress(t);
    assert.ok(p >= prev - 1e-12 && p <= 1, `t=${t} p=${p}`);
    prev = p;
  }
});

test("sheetTransition_values", () => {
  assert.deepEqual(sheetTransition("open", false), { type: "spring", stiffness: SHEET_OMEGA ** 2, damping: 2 * SHEET_OMEGA, mass: 1 });
  assert.deepEqual(sheetTransition("close", false), { duration: 0.13, ease: [0.4, 0, 1, 1] });
  assert.deepEqual(sheetTransition("detent", false), { duration: 0.2, ease: [0.2, 0, 0, 1] });
});

test("sheetTransition_reduced_is_instant", () => {
  for (const phase of ["open", "close", "detent"] as const) {
    assert.deepEqual(sheetTransition(phase, true), { duration: 0, ease: [0.2, 0, 0, 1] });
  }
});

test("sheetDragEnd_rules", () => {
  assert.equal(sheetDragEnd("auto", 120, 0), "close");
  assert.equal(sheetDragEnd("auto", 20, 900), "close");
  assert.equal(sheetDragEnd("auto", 40, 100), "auto");
  assert.equal(sheetDragEnd("large", -80, 0), "full");
  assert.equal(sheetDragEnd("large", 120, 0), "close");
  assert.equal(sheetDragEnd("large", 10, 0), "large");
  assert.equal(sheetDragEnd("full", 150, 0), "large");
  assert.equal(sheetDragEnd("full", -50, 0), "full");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web 2>&1 | grep -E "ERR_MODULE_NOT_FOUND" | head -1`
Expected: `sheetMotion.ts` not found.

- [ ] **Step 3: Implement `sheetMotion.ts`**

```ts
/**
 * Spec ④ iPhone §5.2, measured from the owner's recording: a sheet opens in about 0.37 s, 70 % of the way in the first
 * 0.1 s, with no overshoot. That is a critically damped spring (damping ratio 1): x(t) = 1 - (1 + ωt)e^(-ωt), and
 * (1 + 2.44)e^(-2.44) = 0.30 gives ω = 24.4 rad/s (stiffness ω², damping 2ω, mass 1). Pure, tested with node.
 */
export const SHEET_OMEGA = 24.4;

export function springProgress(t: number, omega: number = SHEET_OMEGA): number {
  return 1 - (1 + omega * t) * Math.exp(-omega * t);
}

export const EASE_IN = [0.4, 0, 1, 1] as const;
/** The same curve as motion.tsx's EASE (fast deceleration). */
export const EASE_OUT = [0.2, 0, 0, 1] as const;

export type SheetPhase = "open" | "close" | "detent";
export type SheetTransition =
  | { type: "spring"; stiffness: number; damping: number; mass: 1 }
  | { duration: number; ease: readonly [number, number, number, number] };

/** open: the spring; close: 0.13 s ease-in (× or swipe); detent (85 % <-> full, the dim of a covered sheet): 0.2 s decelerating. Reduce Motion: instant. */
export function sheetTransition(phase: SheetPhase, reduced: boolean): SheetTransition {
  if (reduced) return { duration: 0, ease: EASE_OUT };
  if (phase === "open") return { type: "spring", stiffness: SHEET_OMEGA ** 2, damping: 2 * SHEET_OMEGA, mass: 1 };
  if (phase === "close") return { duration: 0.13, ease: EASE_IN };
  return { duration: 0.2, ease: EASE_OUT };
}

/** The sheet under another sheet (spec ④ iPhone §5.2). */
export const COVERED_SCALE = 0.95;

export type Detent = "auto" | "large" | "full";

/** Where a sheet goes when the finger lets go of its header. Positive y is down (px, px/s). */
export function sheetDragEnd(detent: Detent, offsetY: number, velocityY: number): "close" | Detent {
  const down = offsetY > 100 || velocityY > 600;
  const up = offsetY < -60 || velocityY < -600;
  if (detent === "full") return down ? "large" : "full";
  if (detent === "large") return up ? "full" : down ? "close" : "large";
  return down ? "close" : "auto";
}
```

Run: `npm run test:web 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 4: Rewrite `BottomSheet.tsx`**

```tsx
import type React from "react";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { AnimatePresence, motion, useDragControls, useIsPresent } from "motion/react";
import { useEscLayer } from "../../app/layers";
import { Glass } from "../../components/Glass";
import { useMotionTiming } from "../../motion";
import { COVERED_SCALE, sheetDragEnd, sheetTransition, type Detent, type SheetPhase } from "./sheetMotion";
import { useKeyboardInset } from "./useKeyboardInset";

export type BottomSheetProps = {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Device: lift the sheet by the keyboard's height. */
  fill?: boolean;
  /** A form id: shows the red ✓ at the top right, which submits that form (sheets that need a decision: TextSheet). */
  confirmForm?: string;
  /** "large": opens at 85 % and pulls up to full height (spec ④ iPhone §5.2). Default: as tall as its content, at most 85 %. */
  size?: "auto" | "large";
  /** Another sheet is open over this one: shrink to 0.95 and dim. */
  covered?: boolean;
};

const round: React.CSSProperties = { width: 36, height: 36, display: "grid", placeItems: "center", padding: 0, border: 0, borderRadius: 18, cursor: "pointer", flex: "0 0 auto" };

function Sheet({ title, onClose, children, fill, confirmForm, size = "auto", covered }: Omit<BottomSheetProps, "open">) {
  const inset = useKeyboardInset(!!fill);
  // While closing, leave the Esc layer (do not take the Esc of the layer below)
  useEscLayer(useIsPresent(), onClose);
  const { reduced } = useMotionTiming();
  const controls = useDragControls();
  const [detent, setDetent] = useState<Detent>(size === "large" ? "large" : "auto");
  const [phase, setPhase] = useState<SheetPhase>("open");
  const open = sheetTransition("open", reduced);
  const close = sheetTransition("close", reduced);
  const y = detent === "large" ? "15%" : 0;
  return (
    <motion.div
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: open }}
      exit={{ opacity: 0, transition: close }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        background: "var(--color-scrim)",
        pointerEvents: "auto",
        fontFamily: "var(--font-body)",
        paddingBottom: inset > 0 ? inset : undefined,
        boxSizing: "border-box",
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "シート"}
        drag="y"
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: detent === "large" ? 0.6 : 0.05, bottom: 1 }}
        onDragEnd={(_, info) => {
          const out = sheetDragEnd(detent, info.offset.y, info.velocity.y);
          if (out === "close") onClose();
          else {
            setPhase("detent");
            setDetent(out);
          }
        }}
        initial={{ y: reduced ? y : "100%" }}
        animate={{ y, scale: covered ? COVERED_SCALE : 1, transition: sheetTransition(phase, reduced) }}
        exit={{ y: reduced ? y : "100%", transition: close }}
        style={{
          position: "relative",
          boxSizing: "border-box",
          height: size === "large" ? "calc(100% - 8px)" : undefined,
          maxHeight: size === "large" ? undefined : "85%",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-sheet-bg)",
          color: "var(--color-text-primary)",
          borderRadius: "16px 16px 0 0",
          flex: "0 0 auto",
          transformOrigin: "50% 0%",
        }}
      >
        {/* Grabber + title row: the drag handle (the content may scroll, so it does not start drags) */}
        <div onPointerDown={(e) => controls.start(e)} style={{ flex: "0 0 auto", touchAction: "none", padding: "6px 15px 8px" }}>
          <div aria-hidden style={{ margin: "0 auto 6px", width: 36, height: 4, borderRadius: 2, background: "var(--color-border)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Glass radius={18} style={{ flex: "0 0 auto" }}>
              <button type="button" aria-label="閉じる" onClick={onClose} style={{ ...round, background: "none", color: "var(--color-text-primary)" }}>
                <X size={18} />
              </button>
            </Glass>
            <div style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 17, lineHeight: "22px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
            {confirmForm ? (
              <button type="submit" form={confirmForm} aria-label="決定" style={{ ...round, background: "var(--color-accent)", color: "#FFFFFF" /* white on accent */ }}>
                <Check size={18} />
              </button>
            ) : (
              <span aria-hidden style={{ width: 36, flex: "0 0 auto" }} />
            )}
          </div>
        </div>
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: `4px 15px ${inset > 0 ? "12px" : "calc(16px + env(safe-area-inset-bottom))"}`,
          }}
        >
          {children}
        </div>
        <motion.div
          aria-hidden
          initial={false}
          animate={{ opacity: covered ? 1 : 0 }}
          transition={sheetTransition("detent", reduced)}
          style={{ position: "absolute", inset: 0, borderRadius: "16px 16px 0 0", background: "var(--color-scrim)", pointerEvents: covered ? "auto" : "none" }}
        />
      </motion.div>
    </motion.div>
  );
}

/**
 * Spec ④ iPhone §5.1-5.2: a sheet from the bottom. It has a grabber, a glass ×, the title and an optional ✓, with content as cards on grey.
 * It opens with a no-bounce spring, closes in 0.13 s, and the header drags it (down closes; "large" pulls up to full).
 * The content can be swapped while open (menu -> date). Already open on the first render: no motion.
 */
export function BottomSheet({ open, ...rest }: BottomSheetProps) {
  return <AnimatePresence initial={false}>{open && <Sheet key="sheet" {...rest} />}</AnimatePresence>;
}

/** A white card on the sheet's grey ground (spec ④ iPhone §5.1). Rows inside get hairlines (`.sheet-card`). */
export function SheetCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="sheet-card" style={{ background: "var(--color-sheet-card)", borderRadius: 16, overflow: "hidden", flex: "0 0 auto" }}>
      {children}
    </div>
  );
}
```

Keep `SheetRow`'s props. Change its style to a card row:
- `minHeight: 48`, `padding: "0 16px"`, `borderRadius: 0`;
- `fontSize: 16`, `lineHeight: "22px"`;
- `background: selected ? "var(--color-bg-hover)" : "transparent"`;
- drop the hover class.

- [ ] **Step 5: Sheets in cards; `TextSheet` confirms with ✓**

Wrap each sheet's rows in `<SheetCard>`:
- `PrioritySheet`, `ReminderSheet`, `LabelSheet`, `TaskMenuSheet` (both views), `ProjectMenuSheet` (both views): one card around the rows. The confirm text stays above the card as plain 14 px secondary text.
- `DateSheet`: one card around the five rows and 「カレンダーから選ぶ」. When the calendar is open, a second card holds the `DatePicker` with `padding: 8`.
- `MoveSheet`:
  - a heading, then a card, per group;
  - the heading style is `{ padding: "8px 4px 4px", fontSize: 13, lineHeight: "18px", fontWeight: 600, color: "var(--color-text-secondary)" }`.
- `MobileTaskDetail`: the recurrence picker goes in a card. The delete confirm keeps its text and buttons, inside a card with `padding: 16`.

`TextSheet`:

```tsx
export const TEXT_SHEET_FORM = "text-sheet";
// props add: formId?: string
// body:
  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <SheetCard>
        {multiline ? (
          <textarea aria-label={label} value={draft} placeholder={placeholder} autoFocus rows={5} onChange={(e) => setDraft(e.target.value)} style={{ ...style, resize: "none" }} />
        ) : (
          <input
            aria-label={label}
            value={draft}
            placeholder={placeholder}
            autoFocus
            enterKeyHint="done"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault(); // no implicit form submit: the Enter that confirms IME conversion must not save
              if (!e.nativeEvent.isComposing && e.keyCode !== 229) save();
            }}
            style={style}
          />
        )}
      </SheetCard>
    </form>
  );
```

`style` loses its border and radius: `{ boxSizing: "border-box", width: "100%", padding: "12px 16px", border: 0, outline: "none", background: "transparent", fontFamily: "var(--font-body)", fontSize: 16, lineHeight: "24px", color: "var(--color-text-primary)" }`. The `キャンセル` / `保存` buttons go: × cancels and ✓ saves.

Callers pass `confirmForm={TEXT_SHEET_FORM}` while a `TextSheet` is shown:
- `MobileTaskDetail`: `confirmForm={sheet === "title" || sheet === "note" || sheet === "subtask" ? TEXT_SHEET_FORM : undefined}`;
- `MobileMain`'s project sheet: `confirmForm={projectSheet === "rename" ? TEXT_SHEET_FORM : undefined}`.

`MobileMain`:
- The row sheet passes `size={sheet?.kind === "move" ? "large" : "auto"}`.
- The quick add reminder sheet is unchanged here (Task 7 covers the card under it).

- [ ] **Step 6: M-09 story, storyboard row**

In `Mobile.stories.tsx`, replace `M01DateSheet` with:

```tsx
export const M09: Story = {
  name: "M-09 日付のシート",
  render: () => <LiveWithSheet kind="date" />,
};
```

In `design/storyboard.md`:
- Add `| M-09 | M-09 日付のシート | pend23 | 390x844 | 6 |` after the M-07 row.
- Replace `| M-01 | 行を左スワイプ | 日付シート | Phase 6 で作る画面。pen にはまだ無い |` with `| M-01 | 行を左スワイプ | M-09 | 下から約 0.37 秒で開く。× / 下に払うと約 0.13 秒で閉じる |`.

- [ ] **Step 7: Checks, CDP timing, commit**

Run the Task 2 checks.

Measure the open motion on `Views/Mobile/BottomSheet` 「開いた状態」 (`sid '開いた状態'`):
- close it with ×;
- reopen it with 「もう一度開く」;
- sample the dialog's top edge every frame:

```json
[
  { "wait": 1200, "click": "[aria-label=\"閉じる\"]" },
  { "wait": 600, "name": "open", "eval": "new Promise(r => { [...document.querySelectorAll('button')].find(b => b.textContent === 'もう一度開く').click(); const t0 = performance.now(); const out = []; const tick = () => { const d = document.querySelector('[role=dialog]'); if (d) out.push([Math.round(performance.now() - t0), Math.round(d.getBoundingClientRect().top)]); if (performance.now() - t0 < 600) requestAnimationFrame(tick); else r(out); }; requestAnimationFrame(tick); })" }
]
```

Expected:
- From the first sample to the last, the top moves monotonically up (no value above the final top + 1).
- About 70 % of the way is done by 100 ms (±20 ms).
- It is within 1 px of the final top by about 370 ms.

Repeat with Reduce Motion: add `await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });` to a copy of the driver before `Page.navigate`. Expected: the first sample already has the final top.

```bash
git add src design/storyboard.md
git commit -m "feat(ios): sheet frame (glass ×, ✓, cards) with the measured spring, fast close, drag and large detent"
```

---

### Task 7: Quick add card

**Files:**
- Modify: `src/views/mobile/MobileQuickAddSheet.tsx`, `src/app/quickAddInsert.ts`, `src/app/quickAddInsert.test.ts`, `src/app/MobileMain.tsx`

**Interfaces:**
- Consumes: `sheetTransition`, `COVERED_SCALE` (Task 6).
- Produces:
  - `InsertKind` adds `"project"` (inserts `#`).
  - `MobileQuickAddSheetProps` adds `projectName?: string` and `covered?: boolean`.

- [ ] **Step 1: Write the failing test** (append to `src/app/quickAddInsert.test.ts`)

```ts
test("the project chip inserts #", () => {
  assert.equal(insertToken("牛乳", "project"), "牛乳 #");
  assert.equal(insertToken("", "project"), "#");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web 2>&1 | grep -E "^ℹ fail"`
Expected: `ℹ fail 1` (`INSERT_WORDS.project` is undefined, so the result is `"牛乳 undefined"`).

- [ ] **Step 3: Implement the insert word**

In `quickAddInsert.ts`:
- `export type InsertKind = "date" | "priority" | "label" | "project";`
- `INSERT_WORDS` adds `project: "#"`.
- Update the doc line: the project word works like the label, so the user types the name after it.

Run: `npm run test:web 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 4: The card**

Rewrite the render of `MobileQuickAddSheet` (keep `ToolbarIcon`, the props, `submit`, `insert` and the Esc layer):

```tsx
  const { reduced } = useMotionTiming();
  const open = sheetTransition("open", reduced);
  const close = sheetTransition("close", reduced);
  const [more, setMore] = useState(false);
  const tokenText = (kind: NonNullable<QuickAddToken["kind"]>) => tokens.find((t) => t.kind === kind)?.text.trim();
  const dateTok = tokenText("date");
  const prioNo = /^p([1-4])$/i.exec(tokenText("priority") ?? "")?.[1];
  const projTok = tokenText("project")?.replace(/^#/, "");
  const parsed = tokens.filter((t) => t.kind);
  const card: React.CSSProperties = { boxSizing: "border-box", margin: "0 10px", background: "var(--color-sheet-card)", boxShadow: "var(--shadow-popover)" };
  return (
    <motion.div
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: open }}
      exit={{ opacity: 0, transition: close }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        background: "var(--color-scrim)",
        pointerEvents: "auto",
        fontFamily: "var(--font-body)",
        // Device: float 10 above the keyboard (or above the home indicator when the keyboard is down)
        paddingBottom: fill ? (inset > 0 ? inset + 10 : "calc(env(safe-area-inset-bottom) + 10px)") : 10,
        boxSizing: "border-box",
      }}
    >
      <motion.div
        initial={{ y: reduced ? 0 : "120%" }}
        animate={{ y: 0, scale: covered ? COVERED_SCALE : 1, transition: open }}
        exit={{ y: reduced ? 0 : "120%", transition: close }}
        style={{ display: "flex", flexDirection: "column", gap: 8, transformOrigin: "50% 100%" }}
      >
        {live && (parsed.length > 0 || reminders.length > 0) && (
          // Spec ④ iPhone §5.3: what the text was read as, in a card floating above (the existing parsed tokens and reminders)
          <div role="group" aria-label="解釈" style={{ ...card, borderRadius: 16, padding: "8px 12px", display: "flex", flexWrap: "wrap", gap: 4, fontSize: 13, lineHeight: "19px" }}>
            {parsed.map((t, i) => (
              <span key={i} style={{ padding: "1px 6px", borderRadius: 4, background: "var(--color-bg-hover)", color: tokenColor[t.kind!] }}>
                {t.text}
              </span>
            ))}
            {reminders.map((c) => (
              <span key={c} style={{ padding: "1px 6px", borderRadius: 4, background: "var(--color-bg-hover)", color: "var(--color-text-secondary)" }}>
                {reminderLabel(c)}
              </span>
            ))}
          </div>
        )}
        <div role="dialog" aria-modal="true" aria-label="クイック追加" style={{ ...card, position: "relative", borderRadius: 24, padding: "14px 14px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
          {/* live: the <input> as before with fontSize 20, lineHeight "26px", height 26; picture: the token line with fontSize 20 and the 説明 input as before */}
          {live && error && (
            <div role="alert" style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-danger)" }}>
              {error}
            </div>
          )}
          {more && (
            <div style={{ display: "flex", gap: 4 }}>
              <ToolbarIcon icon={Tag} label="ラベル" size={ts} onClick={live ? () => insert("label") : undefined} />
              <ToolbarIcon icon={Bell} label="リマインダー" size={ts} color={reminders.length > 0 ? "var(--color-success)" : undefined} onClick={onPickReminder} />
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Chip label="その他の項目" pressed={more} onClick={() => setMore((v) => !v)}>
              <Plus size={16} />
            </Chip>
            <Chip label="日付" onClick={live ? () => insert("date") : undefined} color={dateTok === "今日" ? "var(--color-success)" : dateTok ? "var(--color-text-primary)" : undefined}>
              <Calendar size={16} />
              <span style={ellipsis}>{dateTok ?? "日付"}</span>
            </Chip>
            <Chip label="優先度" onClick={live ? () => insert("priority") : undefined} color={prioNo ? "var(--color-text-primary)" : undefined}>
              <Flag size={16} color={prioNo ? `var(--color-priority-${prioNo})` : undefined} />
              {prioNo ? `P${prioNo}` : "優先度"}
            </Chip>
            <Chip label="プロジェクト" onClick={live ? () => insert("project") : undefined}>
              <Hash size={16} />
              <span style={ellipsis}>{projTok ?? projectName ?? "受信トレイ"}</span>
            </Chip>
            <div style={{ flex: 1 }} />
            {/* the send button exactly as before (36, red circle, ArrowUp 18) */}
          </div>
          <motion.div
            aria-hidden
            initial={false}
            animate={{ opacity: covered ? 1 : 0 }}
            transition={sheetTransition("detent", reduced)}
            style={{ position: "absolute", inset: 0, borderRadius: 24, background: "var(--color-scrim)", pointerEvents: covered ? "auto" : "none" }}
          />
        </div>
      </motion.div>
      {/* the picture-only keyboard area (291) as before, with the same initial / animate / exit as the card */}
    </motion.div>
  );
```

The "as before" comments mark JSX that stays as it is in the current file (the `<input>`, the picture-mode token line and 説明 input, the send button, the keyboard mock). Move those blocks into place, changing only the sizes named here.

Add above the component:

```tsx
const ellipsis: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

/** A chip of the quick add's bottom row (spec ④ iPhone §5.3). Pressing it keeps the keyboard up. */
function Chip({ label, onClick, color = "var(--color-text-secondary)", pressed, children }: { label: string; onClick?: () => void; color?: string; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 32, maxWidth: 110, padding: "0 8px", border: "1px solid var(--color-border)", borderRadius: 8, background: pressed ? "var(--color-bg-hover)" : "none", fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "18px", color, whiteSpace: "nowrap", overflow: "hidden", cursor: "pointer", flex: "0 0 auto" }}
    >
      {children}
    </button>
  );
}
```

Imports:
- Add `useState`, `Hash`, `Plus` and `sheetTransition`, `COVERED_SCALE` (from `./sheetMotion`).
- Drop `Folder`.
- The old `slide` object goes away.

`MobileMain`:
- Pass `projectName={qaProject === app.inbox ? "受信トレイ" : qaProject}` (take `qaProject` from `useQuickAdd`; it is `parsed?.project ?? current`).
- Pass `covered={qaReminderSheet}`.

- [ ] **Step 5: Checks, screenshots, commit**

Run the Task 2 checks.

Screenshot M-02 and 「M-02 入力中 (ツールバーで日付を足した)」 at 390×844. Check:
- the card has 10 at each side and radius 24;
- the name is 20;
- the chips read ＋ / 明日 / 優先度 / 買い物 (or 受信トレイ);
- the parsed card floats above;
- the send button is 36 red.

```bash
git add src
git commit -m "feat(ios): quick add as a floating card with chips, parsed tokens above, project chip"
```

---

### Task 8: Undo toast on iPhone

**Files:**
- Create: `src/app/mobileUndo.ts`, `src/app/mobileUndo.test.ts`, `src/components/MobileToast.tsx`
- Modify: `src/app/MobileMain.tsx`, `src/stories/screens/Mobile.stories.tsx`, `design/storyboard.md`

**Interfaces:**
- Consumes: `merge`, `toastText`, `undoOf`, `completedOf`, `type Completed` from `src/app/completionToast.ts`; `sheetTransition` (Task 6); `movedRootNo` from `src/app/drag/movedRoot.ts`; `TAB_BAR` (Task 3).
- Produces:

```ts
// src/app/mobileUndo.ts
export type DateEntry = { project: string; no: number; before: { due: string | null; dueTime: string | null } };
export type MobileUndo =
  | { kind: "complete"; entries: Completed[] }
  | { kind: "date"; entries: DateEntry[]; label: string | null }
  | { kind: "move"; to: { project: string; no: number }; back: { project: string; section: string | null }; toName: string };
export type UndoStep =
  | { op: "complete"; project: string; no: number; done: false }
  | { op: "update"; project: string; no: number; patch: { due: string | null; dueTime: string | null; reminders?: string[]; rrule?: string } }
  | { op: "move"; project: string; no: number; toProject: string; toSection: string | null };
export function pushUndo(cur: MobileUndo | null, next: MobileUndo): MobileUndo;
export function undoText(u: MobileUndo): string;
export function undoSteps(u: MobileUndo): UndoStep[];
// src/components/MobileToast.tsx
export const MOBILE_TOAST_MS = 3000;
export function MobileToast(p: { text: string; id: number; actionLabel?: string; onAction: () => void; onClose: () => void }): JSX.Element;
```

- [ ] **Step 1: Write the failing test** (`src/app/mobileUndo.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pushUndo, undoSteps, undoText, type MobileUndo } from "./mobileUndo.ts";
import { completedOf } from "./completionToast.ts";

const done = (project: string, no: number): MobileUndo => ({ kind: "complete", entries: [{ project, no }] });

test("push_merges_completions_and_replaces_other_kinds", () => {
  const two = pushUndo(done("仕事", 1), done("買い物", 4));
  assert.equal(undoText(two), "2 件のタスクを完了しました");
  assert.deepEqual(undoSteps(two).map((s) => `${s.op}:${s.project}/${s.no}`), ["complete:仕事/1", "complete:買い物/4"]);
  const date: MobileUndo = { kind: "date", entries: [{ project: "仕事", no: 2, before: { due: null, dueTime: null } }], label: "今日" };
  const replaced = pushUndo(two, date);
  assert.equal(replaced, date);
  assert.equal(undoSteps(replaced).length, 1);
  assert.equal(pushUndo(date, done("仕事", 1)).kind, "complete");
});

test("date_text_and_undo_restore_the_old_date", () => {
  const u: MobileUndo = { kind: "date", entries: [{ project: "仕事", no: 2, before: { due: "2026-10-20", dueTime: "09:00" } }], label: "今日" };
  assert.equal(undoText(u), "今日 にスケジュールしました");
  assert.deepEqual(undoSteps(u), [{ op: "update", project: "仕事", no: 2, patch: { due: "2026-10-20", dueTime: "09:00" } }]);
  assert.equal(undoText({ ...u, label: null }), "日付を削除しました");
});

test("bulk_reschedule_text", () => {
  const e = (no: number) => ({ project: "仕事", no, before: { due: "2026-10-10", dueTime: null } });
  assert.equal(undoText({ kind: "date", entries: [e(1), e(2)], label: "明日" }), "2 件のタスクを 明日 にスケジュールしました");
  assert.equal(undoText({ kind: "date", entries: [e(1), e(2)], label: null }), "2 件のタスクの日付を削除しました");
});

test("undo_move_targets_the_new_number", () => {
  const u: MobileUndo = { kind: "move", to: { project: "買い物", no: 21 }, back: { project: "仕事", section: "今週" }, toName: "買い物" };
  assert.equal(undoText(u), "買い物 に移動しました");
  assert.deepEqual(undoSteps(u), [{ op: "move", project: "買い物", no: 21, toProject: "仕事", toSection: "今週" }]);
});

test("complete_undo_of_a_recurring_task_reopens_then_restores", () => {
  const c = completedOf({ project: "仕事", no: 3, rrule: "FREQ=WEEKLY", due: "2026-10-13", dueTime: "09:00", reminders: ["-30m"] });
  assert.deepEqual(undoSteps({ kind: "complete", entries: [c] }), [
    { op: "complete", project: "仕事", no: 3, done: false },
    { op: "update", project: "仕事", no: 3, patch: { due: "2026-10-13", dueTime: "09:00", reminders: ["-30m"], rrule: "FREQ=WEEKLY" } },
  ]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:web 2>&1 | grep -E "ERR_MODULE_NOT_FOUND" | head -1`
Expected: `mobileUndo.ts` not found.

- [ ] **Step 3: Implement `mobileUndo.ts`**

```ts
import { merge, toastText, undoOf, type Completed } from "./completionToast.ts";

/** Spec ④ iPhone §5.4: the toast after completing, changing a date, or moving; 「元に戻す」 puts the previous state back. Pure. */
export type DateEntry = { project: string; no: number; before: { due: string | null; dueTime: string | null } };
export type MobileUndo =
  | { kind: "complete"; entries: Completed[] }
  | { kind: "date"; entries: DateEntry[]; label: string | null }
  | { kind: "move"; to: { project: string; no: number }; back: { project: string; section: string | null }; toName: string };
export type UndoStep =
  | { op: "complete"; project: string; no: number; done: false }
  | { op: "update"; project: string; no: number; patch: { due: string | null; dueTime: string | null; reminders?: string[]; rrule?: string } }
  | { op: "move"; project: string; no: number; toProject: string; toSection: string | null };

/** Completions in a row share one toast (as desktop); anything else replaces it, and undo then covers only the newest. */
export function pushUndo(cur: MobileUndo | null, next: MobileUndo): MobileUndo {
  if (cur?.kind !== "complete" || next.kind !== "complete") return next;
  let state = { entries: cur.entries };
  for (const c of next.entries) state = merge(state, c);
  return { kind: "complete", entries: state.entries };
}

export function undoText(u: MobileUndo): string {
  switch (u.kind) {
    case "complete":
      return toastText({ entries: u.entries });
    case "date": {
      const n = u.entries.length;
      if (u.label) return n > 1 ? `${n} 件のタスクを ${u.label} にスケジュールしました` : `${u.label} にスケジュールしました`;
      return n > 1 ? `${n} 件のタスクの日付を削除しました` : "日付を削除しました";
    }
    case "move":
      return `${u.toName} に移動しました`;
  }
}

export function undoSteps(u: MobileUndo): UndoStep[] {
  switch (u.kind) {
    case "complete":
      return u.entries.flatMap((c): UndoStep[] => {
        const x = undoOf(c);
        const reopen: UndoStep = { op: "complete", project: x.project, no: x.no, done: false };
        return x.kind === "restore" ? [reopen, { op: "update", project: x.project, no: x.no, patch: x.patch }] : [reopen];
      });
    case "date":
      return u.entries.map((e) => ({ op: "update", project: e.project, no: e.no, patch: { due: e.before.due, dueTime: e.before.dueTime } }));
    case "move":
      // move_task renumbers the task in the target: `to.no` is its number there (MobileMain reads it from the result).
      return [{ op: "move", project: u.to.project, no: u.to.no, toProject: u.back.project, toSection: u.back.section }];
  }
}
```

Run: `npm run test:web 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

- [ ] **Step 4: `MobileToast`**

```tsx
import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Undo2 } from "lucide-react";
import { useMotionTiming } from "../motion";
import { sheetTransition } from "../views/mobile/sheetMotion";
import { TAB_BAR } from "./TabBar";

/** Spec ④ iPhone §5.4: the toast stays 3 s. */
export const MOBILE_TOAST_MS = 3000;

/**
 * A white card just above the tab bar (left of the add button), rising from below. 「元に戻す」 (red, with its icon) is on
 * top, the description under it. Put it inside AnimatePresence. A new `id` restarts the timer. Desktop keeps `Toast`.
 */
export function MobileToast({ text, id, actionLabel = "元に戻す", onAction, onClose }: { text: string; id: number; actionLabel?: string; onAction: () => void; onClose: () => void }) {
  const { reduced } = useMotionTiming();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const t = window.setTimeout(() => close.current(), MOBILE_TOAST_MS);
    return () => window.clearTimeout(t);
  }, [id]);
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: reduced ? 0 : 24 }}
      animate={{ opacity: 1, y: 0, transition: sheetTransition("open", reduced) }}
      exit={{ opacity: 0, y: reduced ? 0 : 24, transition: sheetTransition("close", reduced) }}
      style={{
        position: "absolute",
        left: 10,
        right: 18 + 62 + 10,
        bottom: TAB_BAR.bottom + TAB_BAR.height + 10,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "10px 14px",
        borderRadius: 16,
        background: "var(--color-sheet-card)",
        boxShadow: "var(--shadow-popover)",
        fontFamily: "var(--font-body)",
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        onClick={onAction}
        style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, minHeight: 28, padding: 0, border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 15, lineHeight: "20px", fontWeight: 600, color: "var(--color-accent)", cursor: "pointer" }}
      >
        <Undo2 size={16} aria-hidden />
        {actionLabel}
      </button>
      <div style={{ fontSize: 13, lineHeight: "18px", color: "var(--color-text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</div>
    </motion.div>
  );
}
```

- [ ] **Step 5: Wire it in `MobileMain`**

Add the imports `MobileToast`, `pushUndo`, `undoSteps`, `undoText`, `type MobileUndo`, `completedOf`, `movedRootNo` and `dateLabel` (from `../mock/data`). Then:

```ts
  // Spec ④ iPhone §5.4: the toast with 「元に戻す」 after completing, changing a date, or moving.
  const [undo, setUndo] = useState<{ u: MobileUndo; id: number } | null>(null);
  const undoId = useRef(0);
  const offer = (u: MobileUndo) => setUndo((cur) => ({ u: pushUndo(cur?.u ?? null, u), id: ++undoId.current }));
  const onScreen = (project: string) => (listProject || !!detail) && project === current;
  const runUndo = async (u: MobileUndo) => {
    setUndo(null);
    try {
      for (const s of undoSteps(u)) {
        if (s.op === "complete") await (onScreen(s.project) ? p.completeTask(s.no, false) : cross.setDone(s.project, s.no, false));
        else if (s.op === "update") await (onScreen(s.project) ? p.updateTask(s.no, s.patch) : api.updateTask(s.project, s.no, s.patch));
        else await api.moveTask(s.project, s.no, s.toProject, s.toSection);
      }
    } catch (e) {
      showError(e);
    }
    if (listProject || detail) void p.reload().catch(() => undefined);
    refreshAll();
    void refreshSummaries();
  };
  const offerDate = (entries: { project: string; no: number; due?: string; dueTime?: string }[], date: string | null) =>
    offer({ kind: "date", entries: entries.map((t) => ({ project: t.project, no: t.no, before: { due: t.due ?? null, dueTime: t.dueTime ?? null } })), label: date ? (dateLabel(date, today)?.label ?? date) : null });
```

Hooks into the existing handlers. Each runs only after success, with the task as it was before the call:
- `setDue(t, date)`: both `p.updateTask` and `cross.setDue` resolve `true` on success (`mutate` in `useProject.ts`, `wrap` in `useCrossView.ts`). Write both branches as `void (…).then((ok) => ok && offerDate([t], date ?? null))`.
- `moveTask(t, toProject, toSection)`:

```ts
    try {
      const out = await api.moveTask(t.project, t.no, toProject, toSection);
      // Same project: only the section changes. Another project renumbers the subtree; its root is the highest parentless No.
      const no = toProject === t.project ? t.no : movedRootNo(out.to.tasks, 1);
      if (no !== undefined) offer({ kind: "move", to: { project: toProject, no }, back: { project: t.project, section: t.category }, toName: toProject === app.inbox ? "受信トレイ" : toProject });
    } catch (e) {
      showError(e);
    }
```

- The reschedule sheet: `if (v.date) { const before = todayData.data?.overdue ?? []; void api.rescheduleOverdue(today, v.date).then(() => offerDate(before, v.date!), showError).finally(refreshAll); }`.
- Completions with `done === true`, offered on success as `offer({ kind: "complete", entries: [completedOf(t)] })`:
  - `MobileProjectView onToggleDone`: `void p.completeTask(t.no, done).then((ok) => ok && done && offer(…))`;
  - the cross views' `cross.toggleDone(t, done).then((ok) => ok && done && offer(…))` (Today, Upcoming, label, search);
  - the detail's `onToggleDone` and `onToggleSubtask`.
- The detail's `onChange(patch)`: when `"due" in patch`, `offerDate([openTask], patch.due ?? null)` after `p.updateTask` resolves `true`.

Render in `layers`, as the last child of the `AnimatePresence` that holds the quick add:

```tsx
        {undo && <MobileToast key="undo" id={undo.id} text={undoText(undo.u)} onAction={() => void runUndo(undo.u)} onClose={() => setUndo(null)} />}
```

- [ ] **Step 6: M-08 story, storyboard row**

```tsx
export const M08: Story = {
  name: "M-08 お知らせ",
  render: () => (
    <MobileToday
      overdue={byNo(9, 10)}
      todays={[...byNo(8, 11), { ...byNo(12)[0], title: "ゴミ出し" }]}
      today={TODAY}
      overlay={<MobileToast id={1} text="今日 にスケジュールしました" onAction={() => undefined} onClose={() => undefined} />}
    />
  ),
};
```

The 3 s timer calls the no-op `onClose`, so the toast stays in the story.

In `design/storyboard.md`:
- Add `| M-08 | M-08 お知らせ | pend22 | 390x844 | 6 |`.
- Add the transitions:
  - `| M-09 | 日付を選ぶ | M-08 | 「今日 にスケジュールしました」と「元に戻す」。3 秒で消える |`
  - `| M-01 | 行を完了 | M-08 | 「1 件のタスクを完了しました」。続けて完了すると件数が増える |`
  - `| M-08 | 「元に戻す」 | M-01 | 前の状態に戻る |`

- [ ] **Step 7: Checks, commit**

Run the Task 2 checks. Screenshot M-08 at 390×844. Check:
- the card sits above the pill, left of the add button, with 「元に戻す」 in red on top;
- the add button stays visible.

```bash
git add src design/storyboard.md
git commit -m "feat(ios): undo toast after complete, date change and move"
```

---

### Task 9: Task screen interim restyle, dark pass, measurements, desktop unchanged

**Files:**
- Modify: `src/views/mobile/MobileTaskDetail.tsx`, `src/components/Checkbox.tsx`, `src/stories/screens/Mobile.stories.tsx`, `design/storyboard.md`
- Possibly modify: any iPhone file the dark pass or the measurements flag (values only)

**Interfaces:**
- Consumes: everything above.
- Produces: `Checkbox` `size?: 18 | 22` (20 removed).

- [ ] **Step 1: Task screen (spec §5.5, until ① makes it a sheet)**

`MobileTaskDetail`:
- The content padding goes from `"8px 16px"` to `"8px 15px"`, and the comment bar from `"8px 16px"` to `"8px 15px"`.
- Checkbox `size={22}`.
- Title: `fontSize: 19, lineHeight: "25px", fontWeight: 700`.
- Note: `fontSize: 13, lineHeight: "18px"`.
- `Prop` rows: `padding: "13px 0"`, name `fontSize: 15`, value `fontSize: 16, lineHeight: "22px"`. With the 22 line, a row is 48 tall.
- 「サブタスク n/m」 heading: `fontSize: 15, lineHeight: "20px", fontWeight: 700, paddingTop: 16`.
- Subtask rows: `<TaskRow variant="mobile" {...mobileRowProps(t, { today })} done={…} onToggleDone={…} />`.

`Checkbox`:
- `size?: 18 | 22`, `const ring = 2`, `const tint = !checked && priority < 4`.
- Desktop 18 keeps the same values.
- Update the doc comment.

- [ ] **Step 2: Dark pass**

Run: `grep -nE "#[0-9A-Fa-f]{3,8}\b" src/views/mobile/*.tsx src/components/{MobileHeader,MobileTaskRow,TabBar,Glass,MobileToast}.tsx | grep -v stories`

Expected: only `#FFFFFF` on accent or success (FAB, ✓, send, swipe panels) and the quick add's keyboard mock. Replace anything else with a token.

Add the story, and the storyboard row `| M-10 | M-10 ダークモードの今日 | pend24 | 390x844 | 6 |`:

```tsx
export const M10: Story = {
  name: "M-10 ダークモードの今日",
  globals: { theme: "dark", viewport: { value: "mobile", isRotated: false } },
  render: () => <MobileToday overdue={byNo(9, 10)} todays={[...byNo(8, 11), { ...byNo(12)[0], title: "ゴミ出し" }]} today={TODAY} />,
};
```

Screenshot in dark, at 390×844:
- M-10;
- M-01, M-06 and M-09 with `&globals=theme:dark` (`$SP/shot.sh "$(sid 'M-01 プロジェクト')&globals=theme:dark" $SP/m01-dark.png 390 844`).

Check:
- text reads on all of them;
- the glass pill is dark grey and translucent;
- sheet cards (`#282828`) stand off the sheet ground (`#1E1E1E`);
- the toast card is dark.

- [ ] **Step 3: Measure against the research (±2)**

Drive M-01, M-01b and M-04 with `drive-m.mjs`, using this eval step (one per story):

```json
[{ "wait": 1500, "name": "geometry", "eval": "(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(innerHeight - b.bottom), Math.round(b.width), Math.round(b.height)]; }; const h1 = document.querySelector('[data-large-title] h1'); return { tab: r('[aria-label=\"タブ\"]'), fab: r('button[aria-label=\"タスクを追加\"]'), title: h1 && getComputedStyle(h1).fontSize, titleLeft: h1 && Math.round(h1.getBoundingClientRect().left), check: r('[data-mobile-row] [role=checkbox]'), rows: [...document.querySelectorAll('[data-mobile-row]')].map((e) => [Math.round(e.getBoundingClientRect().height), Math.round(e.querySelector('[role=checkbox]').getBoundingClientRect().left)]) }; })()" }]
```

Expected:

| Item | Expected value |
| --- | --- |
| `tab` | `[28, 23, 334, 58]` (left, gap to the bottom, width, height) |
| `fab` | width and height 62, right edge 18 from the screen edge (`390 - left - 62 = 18`), bottom gap 91 |
| `title` | `"34px"`, with `titleLeft` 15 |
| `check` | width 22, left 15 |
| `rows` | heights 48 or 63; the subtask rows in M-01b have their checkbox at left 49 |

Fix any value that is more than 2 off in the owning component, and re-measure. Record the final numbers for the PR body.

- [ ] **Step 4: Desktop unchanged**

```bash
SP=/private/tmp/claude-502/-Users-ktakeuchi-Documents-AOGU/d2253c28-745b-4661-9a05-32aec0df385e/scratchpad
npm run build-storybook >/dev/null 2>&1
(cd storybook-static && python3 -m http.server 6108 >/dev/null 2>&1 &) ; sleep 1
mkdir -p $SP/look-after
while read id; do "$SP/shot.sh" "$id" "$SP/look-after/$id.png" 1512 940 6108; cmp -s "$SP/look-base/$id.png" "$SP/look-after/$id.png" || echo "DIFF $id"; done < $SP/look-ids.txt
pkill -f "http.server 6108"
```

Expected: no `DIFF` lines.

If one appears:
- Open both PNGs (Read tool) and find the cause. A desktop branch or a shared token must not have changed.
- Fix it, unless the difference is only anti-aliasing noise that a re-run of the baseline shot also shows.
- Report what you found.

- [ ] **Step 5: Checks, commit**

Run the Task 2 checks.

```bash
git add src design/storyboard.md
git commit -m "feat(ios): task screen sizes, dark theme story, measured against the research"
```

---

### Task 10: design.pen and storyboard

**Files:**
- Modify: `design.pen` (worktree copy only), `design/storyboard.md`

This task needs the owner: Pencil writes into the file open in Pencil, and the owner saves.

- [ ] **Step 1: Open the right file**

- Ask the owner to open `<worktree>/design.pen` in Pencil.
- Call `mcp__pencil__get_app_state` and check that the active editor's path is the worktree's `design.pen`.
- If it is not, stop and ask. Never write while the main checkout's `design.pen` is active.
- Note the main checkout's state first: `git -C /Users/ktakeuchi/Documents/PowerToDo status --short design.pen`.

- [ ] **Step 2: Read the skill and style**

Call `mcp__pencil__read_skill` (the Pencil MCP requires it before editing) and `mcp__pencil__get_style`.

- [ ] **Step 3: Redraw and add the iPhone frames (390×844)**

Redraw with `mcp__pencil__execute`, using the Storybook screenshots from Tasks 2-9 as the reference:
- M-01 (u1DRR), M-01b (SLv3p), M-02 (hHXHf), M-03 (Miab5), M-04 (T4oUXk), M-05 (rm64j), M-07 (iCpsH).
- M-06 (QzGhM): rename the node to 「M-06 閲覧」 and redraw it as the 閲覧 tab (the drawer is gone).

The look to draw:
- the glass tab pill (28 / 58 / 23) with 受信トレイ / 今日 / 近日 / 閲覧;
- the 62 add button;
- the large title 34 with 「n 件のタスク」;
- the top-right glass pill;
- rows with the 22 checkbox, the meta line with the project at the right, and the 49 hairline;
- 15 bold headers;
- the overdue line with 再スケジュール;
- Upcoming's month line and grabber;
- the quick add card;
- the task screen's 19 title.

Add new frames next to them:
- M-04b 今日 (見出しが縮んだところ)
- M-08 お知らせ
- M-09 日付のシート
- M-10 ダークモードの今日 (dark tokens)

Take a screenshot of each frame in a separate execute call and compare it with the Storybook screenshot of the same screen.

- [ ] **Step 4: Storyboard ids and prose**

In `design/storyboard.md`:
- Replace `pend21` (M-04b), `pend22` (M-08), `pend23` (M-09) and `pend24` (M-10) with the new node ids.
- Update the count line: 「画面は全部で 49 枚 (デスクトップ 37 枚 = 通常 34 枚 + ダーク 3 枚、モバイル 12 枚)」.
- In 「### モバイル M-01〜M-07」, rewrite the bullets that name the hamburger, the drawer, the header sync icon and the count badge:
  - 「M-01 操作: 下のタブ / 追加ボタン / 行タップ / 右スワイプ完了 / 左スワイプ日付 (M-09) / 上の帯の「…」」
  - 「M-01b 操作: 親行の右端のシェブロンで展開・折りたたみ (すぐ切り替わる)。子行は親の文字の左端にそろう (34)」
  - 「M-06 閲覧: 同期の行 (押すと今すぐ同期) / マイプロジェクト / ラベル。上の帯に検索と設定」
  - Delete 「ヘッダ右の同期アイコン …」. Sync is on M-06, and pull-to-refresh stays.

- [ ] **Step 5: Check stories; the owner saves; commit**

Run: `npm run build-storybook >/dev/null 2>&1; npm run check:stories 2>&1 | grep missing`
Expected: `missing: none`.

- Ask the owner to press ⌘S in Pencil.
- Then check that `git status --short design.pen` shows it modified in the worktree, and that the main checkout's `git -C /Users/ktakeuchi/Documents/PowerToDo status --short design.pen` is unchanged from Step 1.

```bash
git add design.pen design/storyboard.md
git commit -m "design: iPhone screens in the Todoist-like look (tabs, 閲覧, sheets, toast, dark)"
```

---

## Manual checklist (for the PR body)

Check on the owner's iPhone through TestFlight:

- [ ] Notch and home indicator:
  - the top bar starts under the status bar;
  - the tab pill sits 23 above the bottom edge without covering the home indicator's gesture area;
  - nothing hides under either.
- [ ] Tabs:
  - 受信トレイ / 今日 / 近日 / 閲覧; the selected tab has a grey ground with red icon and label;
  - the 今日 icon shows today's date, and the next day after the app comes back from the background;
  - there is no hamburger.
- [ ] 閲覧:
  - the sync row syncs now (and opens 設定 when sync is off);
  - projects show a colored # and counts; 「ラベル」 opens the label list;
  - the top pill opens 検索 and 設定, and back returns;
  - tapping 閲覧 again returns to its root; other tabs keep where you were in 閲覧.
- [ ] Large title:
  - scrolling moves 「今日」 / the project name into the bar's center with the count;
  - scrolling back restores it;
  - the iOS bounce at the top does not flicker it.
- [ ] Project 「…」:
  - 名前を変更 (✓ saves, × cancels), and the screen keeps the new name;
  - 削除 → 本当に削除 returns to 閲覧;
  - the inbox shows no 「…」.
- [ ] Rows:
  - priority rings with a light fill;
  - the meta line (subtasks 0/2, date colors, repeat, comments, project at the right);
  - long titles end in 「…」;
  - subtask chevron opens at once; children line up under the parent's text.
- [ ] Completing a row keeps it for about 0.25 s, then it leaves, and the toast shows 「1 件のタスクを完了しました」. A second completion makes it 「2 件」, and 元に戻す reopens both.
- [ ] Sheets:
  - they open in about 0.37 s with no bounce and close fast with × or a swipe down on the header;
  - the content of the date sheet scrolls without closing it;
  - the move sheet opens at 85 % and pulls up to full.
- [ ] The date change toast: 「今日 にスケジュールしました」 → 元に戻す puts the old date back. The same works after 再スケジュール (all overdue tasks) and after a move to another project (it comes back to its section).
- [ ] Quick add:
  - the card floats just above the keyboard and follows it as the keyboard shows and hides;
  - 20 pt text, no zoom;
  - the Japanese IME's Enter does not send;
  - the chips insert 明日 / p1 / #, and ＋ shows ラベル and リマインダー;
  - with the reminder sheet open, the card shrinks and dims.
- [ ] Glass: the blur looks right over the list, and scrolling stays smooth (no stutter) with the tab pill over moving rows.
- [ ] Dark mode: switch the system appearance while the app is open; all screens, sheets, the toast and the glass follow.
- [ ] Reduce Motion (設定 → アクセシビリティ → 動作): sheets, quick add and the toast appear without sliding.
- [ ] Mac: the desktop app looks as before (D-01, D-04, the toast, the dark theme).
- [ ] Measured numbers from Task 9 (tab pill, add button, title, checkbox, rows, indent) listed here.
