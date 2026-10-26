# Todoist iPhone app: layout reference (research, 2026-10-26)

Purpose: guide the "look" redesign of a Todoist-like iPhone app. Layout and density only. Web research only; no screenshots were available. Items marked **[inferred]** are not stated by a source; items marked **[unconfirmed]** were seen only in a weak or third-party source.

## 1. Navigation

- Bottom tab bar on iPhone and Android, up to 5 tabs. Defaults: Inbox, Today, Upcoming, Browse (Team tab added for team members). Browse is the bottom-right tab. Source: https://www.todoist.com/help/articles/customize-the-todoist-navigation-bar-L4qpkI0xj
- The bar is user-customizable: add a default view (Inbox, Today, Upcoming, Search, Filters & Labels), a project, filter, or label as a tab; reorder with drag handles; down to a minimum of 3 tabs; saved per device. A view placed on the bar is removed from the Browse menu. Long-press the bar then "Edit Tab Bar". Same source.
- Search is an optional tab, not a default one (listed under add options). Same source. A 2024 third-party critique saw a bar of Inbox, Search, Browse on the Today screen, which is consistent with a customized bar. https://ixd.prattsi.org/2024/01/design-critique-todoist-ios-app/
- Drawer/sidebar: iPad uses a sidebar and has no tab bar (same help source). On iPhone, older Todoist material describes a three-line menu at top left that holds Today/Upcoming (https://www.todoist.com/inspiration/todoist-upcoming-view, an older launch post); current iPhone navigation is the tab bar. **[inferred]** The drawer is superseded by the tab bar on iPhone.
- Projects, filters, labels live under Browse; Browse top-right has a gear icon leading to settings including Navigation. Source: customize-navigation-bar article above. Browse content detail (Favorites, My Projects list) is not in fetched sources **[unconfirmed]**.
- Top bar: Today heading uses the largest font on the screen with the current date below it (large-title style). Source: Pratt critique (3rd party, Jan 2024). Per-screen top bar contents otherwise not documented. A three-dot menu at top right opens View options (see section 6).
- Add button: large orange circle with a plus, the most visible element on Today; subtle haptic on tap; opens Add Task. Source: Pratt critique. Position (bottom-right floating) is **[inferred]** from the critique's "most visible" wording and common pattern; not stated.
- Dynamic Add button: on iOS the add button can be touched and dragged to a spot in a list to create a task, sub-task (drop below parent, nudge right) or section (drag toward a section icon at bottom-left). Works only in list layout with no sort/group. Source: https://www.todoist.com/help/articles/use-the-dynamic-add-button-in-todoist-ysybl2M1
- App icon long-press quick actions: Add Task, Today, Upcoming; badge shows today's task count. Source: Pratt critique.

## 2. Task list rows

- Circle on the left to complete; tasks in a user-ordered list. Source: Pratt critique. Priority-colored circle: well known Todoist behavior (P1 red, P2 orange, P3 blue, P4 plain) but not stated in the fetched sources **[unconfirmed]**.
- Labels can appear on the row as categories (Pratt critique). Row meta line contents (date, project, comment count, subtask count), separators, row height, density: not stated in any fetched source **[unconfirmed]**.
- Sections: list layout supports sections and sub-tasks in projects (Dynamic Add article).
- Today overdue block: the official Today article does not describe it (https://www.todoist.com/help/articles/plan-your-day-with-the-todoist-today-view-UVUXaiSs). A user blog reports an "Overdue" header with a reschedule control and a collapse arrow on iOS **[unconfirmed, single third-party]**: https://blog.vghaisas.com/til-todoist-overdue/
- Upcoming: a vertical list of tasks divided by day, with empty days shown (drag-and-drop rescheduling); a "Week Navigator" strip at the top lets you hop between days in a week, swipe left on the top bar for the next week; month picker from top left; a small dot under a date marks days with tasks; "Today" button top right to return. Source (older launch post, may not reflect current look): https://www.todoist.com/inspiration/todoist-upcoming-view and https://www.imore.com/productivity-app-todoist-adds-new-upcoming-view-feature
- Upcoming does not offer board layout on iOS. Source: https://todoist.com/help/articles/how-to-use-board-view

## 3. Task view (iPhone)

- Opened by tapping a task. Contents top to bottom: task name (tap to edit) with breadcrumb of project/section (tappable), date below the breadcrumb (tap for date/time/duration), then chips: Description, Assignee (shared), Priority, Reminder, Labels, Deadline and Location (paid), Move to. Then a Sub-tasks section (view/add/edit/reorder) and a Comment field (comment, notify, attach file). Top-right task menu: Edit, Duplicate, Copy Link, Show/Hide Completed Sub-tasks, View activity, Delete. Recurring tasks add Complete & Reset Sub-tasks and Complete Forever. Source: https://todoist.com/help/articles/360007288380
- Full screen vs bottom sheet: not stated. Presentation as a sheet/modal **[unconfirmed]**. Comments sit in the same scroll below sub-tasks (order inferred from the article's listing order **[inferred]**).

## 4. Quick add sheet

- Add Task screen has fields for task name, description, date, priority, and an orange arrow submit button; a small toast appears at the top after saving. Source: Pratt critique (Jan 2024).
- Natural language syntax for dates, labels, priority, reminders, projects; iOS 26.4.17 (2026-04-20) added "!" in the task field to add a reminder. Sources: https://get.todoist.help/hc/en-us/articles/115001745265-Use-Task-Quick-Add-in-Todoist (title only, page returned 403) and the iOS release history via https://scout.appaloosa.io/apps/ios/com.todoist.ios/history (search snippet).
- Chip row contents (date, priority, labels, reminders, project selector at bottom): consistent with the task view chips above **[inferred]**; exact order not confirmed.
- Also available outside the app: widgets, Control Center / Lock Screen / Action Button controls on iOS 18+. Source: https://todoist.com/help/articles/use-todoist-controls-on-ios-XZDxdz9y4 (snippet).

## 5. Swipe, long press, reorder

- Swipe actions are configurable (Browse, gear, General, Swipe actions). iOS options: Complete, Schedule, Reminders, Delete. Defaults not stated in the help article. Source: https://www.todoist.com/help/articles/how-to-change-your-swipe-actions-D5DQOQz6 (default of Complete one way and Schedule the other is commonly seen **[unconfirmed]**).
- Long press on a task (list layout only): context menu with Select Task, Schedule, Move to, Priority, Duplicate, Copy Link, Delete (red, last); shared projects add Assign, Complete Forever. Light haptic and row tint on press (Pratt critique). Source: https://todoist.com/help/articles/360013727120
- Reorder: the context menu can pop up when you try to drag; workaround is to hold and nudge right to dismiss the menu, then drag. Same source. Pratt critique calls dragging finicky. Indent on iPhone: via Dynamic Add placement for new sub-tasks (nudge right); indenting existing tasks is not documented in fetched sources **[unconfirmed]**.

## 6. View options

- Three-dot icon top right, then View: choose List, Board, or Calendar (Calendar/Board availability by plan; Calendar Pro/Business). Source: https://todoist.com/help/articles/how-to-use-board-view
- Board layout exists on iPhone (two-finger drag selection added to iOS board in May 2026 per https://releasebot.io/updates/todoist, snippet), except in Upcoming.
- Sort, group, filter menus exist ("sort or group by project or date" in the Today article above); their exact placement in the iOS menu is not confirmed **[unconfirmed]**. Sorting or grouping disables drag-to-reorder and Dynamic Add.

## 7. Motion

- Haptic bump on add button tap and on long-press menu (Pratt critique). Release note for Android v8586 mentions "delightful animations" with the new bottom bar (https://www.apkmirror.com/apk/doist/todoist/todoist-v8586-release/); no iOS completion-animation or sheet-transition description found **[unconfirmed]**.

## 8. Gaps for owner iPhone screenshots

1. Exact default tab bar on the current build (is Search present; icons only or icon+label; tab bar height; selected tint).
2. Is the add button floating bottom-right above the tab bar, its size, and whether it hides on scroll.
3. Today screen: large-title size, date subtitle, top-bar icons (left and right), and how the Overdue block looks (header text, "Reschedule" action, collapse arrow, count).
4. Task row anatomy: checkbox size and priority fill (ring vs filled tint), title font size/weight, description lines (count, truncation), meta line contents and order (date icon+text, labels, project name, comment count, sub-task count "0/3"), separator style and inset, row height in points.
5. Section header style (font, collapse chevron, count, add-section affordance) and indent for sub-tasks.
6. Upcoming: week navigator appearance (day letters + numbers, selected style, dot), month picker trigger, how overdue appears, empty-day rows.
7. Task view: full-screen or bottom sheet, grab handle or close button, chip row style (scroll or wrap), where Sub-tasks and Comments appear, bottom comment bar fixed or inline.
8. Quick add: sheet height, keyboard accessory chips (date, priority, label, reminder, project selector), where the project selector and submit arrow sit, inline natural-language token highlighting.
9. Swipe action defaults (left and right), colors and icons, full-swipe behavior.
10. Browse screen layout (Favorites, My Projects with counts and colored hashes, Labels, Filters, gear).
11. Completion animation (checkbox fill, row collapse, undo toast position and duration) and sheet transitions.
12. Dark mode and themes: background/elevation colors, whether list is grouped inset cards or flat.
13. View menu contents on iPhone (order of Layout, Sort, Group, Filter, Completed tasks) and whether board shows columns paged or scrolled.

## 9. Measured from the owner's screenshots (2026-10-26)

Source: 14 screenshots and one 41 s screen recording from the owner's iPhone (1125x2436 px, 3x, so 375x812 pt), Todoist iOS on iOS 26. Task names in the shots are the owner's and are not recorded here. Values are in points, measured from pixels; text sizes are estimated from glyph heights and are approximate (±1 pt).

### Look of the system (iOS 26)
- Bars float as rounded "glass" pills: the tab bar and the top-right button group are translucent pills over the content, not edge-to-edge bars.
- Tab bar: one pill about 320 wide and 58 high, about 28 from the screen sides and about 23 above the bottom. Four tabs: インボックス, 今日, 近日予定, 閲覧. Each tab is an icon over a 10 pt label. The selected tab has a grey rounded highlight behind it and red icon and label; the 今日 icon shows the day number.
- Top right: a pill holding two buttons (a list/view icon and "…"). The project and Today screens show no back button there.
- Add button: a red circle about 62 across, about 18 from the right edge, sitting just above the tab bar. It stays visible over the list.

### Screen titles
- Large title at the top left, about 34 pt bold (今日, インボックス), with a 12 pt grey line under it (「7 件のタスク」).
- When the list scrolls, the title moves into the center of the top bar at about 17 pt bold with the count line under it at 11 pt (seen in the recording).
- Upcoming (近日予定) uses a centered 17 pt title at once, with a month line (「2026年10月 >」) and a week strip below it. The strip opens into a month grid by pulling down (a grabber under the strip).

### Rows
- Side padding 15. Checkbox 22 across with a 2 pt ring; the text starts at 49 (12 after the checkbox).
- Priority 1, 2 and 3 color the ring (red, orange, blue) and fill it with a light tint of the same color. Priority 4 is a grey ring with no fill.
- Title about 16 pt regular, one line. The description, when present, is one grey line of about 13 pt under the title.
- Meta line about 12 pt under the title: subtask count (branch icon + 「0/2」), date (calendar icon + date, red when overdue, green for today), recurring icon, comment count (bubble icon + number). The project name sits on the right of the meta line, grey, followed by a `#` (colored for colored projects) or the inbox icon.
- Row pitch: 63 for a row with a meta line, 48 for a title-only row. Hairline separators start under the text (x 49) and run to the right padding; there is no separator under the checkbox.
- Subtasks are indented so their checkbox lines up with the parent's text (about 40 in). A parent with subtasks shows a chevron on the right of the title line.

### Section headers
- About 15 pt bold, no line, with space above (about 36 between the last row and the header).
- Today's overdue header: 「期限切れ」 on the left, 「リスケジュール」 in red and a chevron on the right, on the same line.
- Project section headers carry a "…" on the right.
- Upcoming day headers: 「10月26日 · 今日 · 月曜日」 style, 15 pt bold.

### Sheets and menus
- Task view: a sheet from the bottom with a grabber, opening at about 85% height and pulling up to full height. Background is a warm light grey; content sits on white rounded cards (radius about 16): a card with the checkbox and title (about 19 pt semibold), description, project and date rows, then a horizontal row of chip buttons (説明, 優先度, リマインダー, ラベル, 期限, 位置情報, …に移動する) that scrolls sideways. Below: 「サブタスク 0/1」 with a chevron and a card of subtask rows plus 「サブタスクを追加」; 「コメント 1」 with a card showing the latest comment and 「すべて表示」 in red. A comment field pill is pinned at the bottom.
- Close is a round "×" button top left; "…" is a round button top right.
- Comments open as their own sheet (title 「コメント」, the task name under it), with each comment as name + time + text and a "…", and an input card above the keyboard with an attach button and a red round send button.
- Quick add: a white rounded card (radius about 24) floating above the keyboard, not attached to the screen bottom. Name input about 20 pt; chips below (＋, 今日 in green, 優先度, project) and a red round send button on the right. Typing `#` or `!!` opens a floating suggestion card above it (projects tree, priorities with flag colors).
- Date sheet: grabber, × and a ✓ round button, a date field, quick choices (明日, 今週の後半, 今週末, 来週, 日付なし) with the weekday on the right, a week strip, then 時間 and 繰り返し rows.
- 表示 (view options) is a full sheet with grouped white cards on grey: レイアウト (two phone pictograms), 完了したタスク switch, 並び替え, フィルター rows with values and chevrons, and a red round ✓ to apply.
- Long press on a row: the row lifts as a white card with a shadow, the rest dims, and a rounded menu opens below or above it: タスクを選択 / スケジュール, …に移動する, 期限, 優先度 / タスクを複製, タスクのリンクをコピー / タスクを削除 (red). Moving the finger instead drags the lifted row to reorder (recording).
- タスクを選択 enters a selection mode: the top bar shows 「n 件のタスクを選択中」 and すべて選択, rows show filled red checks, and a pill toolbar at the bottom holds date, move, label, priority and "…".
- After scheduling from the sheet, a toast card at the bottom says 「今日 にスケジュールしました」 with 「元に戻す」.

### Not covered by the shots
- The 閲覧 tab, the dark theme, and swipe actions were not captured.

### Motion (measured from the recording)

The recording runs at up to 60 fps (variable). Times are from the first frame that moves to the frame where it settles, ±17 ms. Positions are the sheet's top edge in points (812 = off screen).

- Task sheet opens: slides up from off screen to its 85% stop (top at 295) in about 0.37 s. It covers 70% of the way in 0.1 s and then slows down with no overshoot, like an iOS spring with no bounce. The list behind dims at the same time.
- Sheet closes (× or swipe down): slides down and off screen in about 0.13 s, speeding up as it goes (ease-in). The dim fades with it.
- Sheet pulled to full height: the top moves from 295 to about 60 over about 0.2 s, decelerating.
- A second sheet over the first (date sheet) opens the same way, in about 0.37 s; the sheet below shrinks back slightly and dims. It closes in about 0.1 s.
- Move sheet after a menu: the menu fades first (about 0.1 s), then the sheet rises from the bottom to the top (51) in about 0.43 s, decelerating.
- Long press: after about 0.4 s of holding, the row lifts as a white card with a soft shadow and the rest of the screen dims. The menu grows out from the row (scale and fade) in about 0.2 s with a slight overshoot that settles by about 0.3 s.
- Dragging a lifted row: the card follows the finger; the other rows do not move. A red line with a dot at the left marks where the row will land, the same as the desktop drag. On release the card settles into place.
- Selection mode: the top bar changes to 「n 件のタスクを選択中」 and the tab bar is replaced by the action pill in about 0.3 s (fade and slide).
- Scheduling from a sheet: the sheet closes, and a toast card rises at the bottom with 「元に戻す」; it stays about 3 s.
- Large title: scrolling the list moves the title into the top bar (the title shrinks and fades while the small centered title fades in), tied to the scroll position, not to a timer.
