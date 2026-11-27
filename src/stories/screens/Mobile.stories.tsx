import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Banners } from "../../app/Banners";
import { SaveBanner } from "../../app/SaveBanner";
import { googleLoggedIn, nasConnected, syncStatuses, tailnets } from "../../mock/sync";
import { LONG_TITLE, TODAY, counts, projects, sections, tasks } from "../../mock/data";
import { MobileBrowse } from "../../views/mobile/MobileBrowse";
import { MobileProjectView } from "../../views/mobile/MobileProjectView";
import { MobileSettings } from "../../views/mobile/MobileSettings";
import { MobileTaskDetail } from "../../views/mobile/MobileTaskDetail";
import { MobileToday } from "../../views/mobile/MobileToday";
import type { Task } from "../../types/model";
import { MobileUpcoming } from "../../views/mobile/MobileUpcoming";
import { BottomSheet } from "../../views/mobile/BottomSheet";
import { DateSheet } from "../../views/mobile/DateSheet";
import { MobileQuickAddSheet } from "../../views/mobile/MobileQuickAddSheet";
import { SheetFrame } from "../../views/mobile/SheetFrame";
import { LARGE_TITLE_HEIGHT } from "../../components/largeTitle";
import { insertToken } from "../../app/quickAddInsert";
import { MobileToast } from "../../components/MobileToast";
import { TaskMenuSheet } from "../../views/mobile/TaskMenuSheet";
import { MobileDrawer, MobileMenuContext } from "../../views/mobile/MobileDrawer";
import { ViewSheet } from "../../views/mobile/ViewSheet";
import { DEFAULTS, type ViewOptions } from "../../app/view/viewOptions";
import { CalendarSheet } from "../../views/mobile/CalendarSheet";
import { calendarEvents, chooserStub } from "../../mock/calendar";
import { CalendarEventDetail } from "../../components/CalendarEventDetail";
import { DetailSheet } from "../../views/mobile/DetailSheet";

// 幅 390x844。ビューポートは .storybook/preview.ts の viewport.options の "mobile" を、Story 単位の globals で選ぶ
// (Storybook 10 の viewport は parameters.viewport.defaultViewport ではなく globals.viewport.value)。
const meta = {
  title: "Screens/Mobile",
  parameters: { layout: "fullscreen" },
  globals: { viewport: { value: "mobile", isRotated: false } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

// pen の「買い物」プロジェクトは 今週 に 2 件。mock の「食パンを買う」(no 8) は M-04 今日 / M-05 近日 用なので、プロジェクト画面からは外す。
const shopping = tasks.filter((t) => t.no !== 8);
const byNo = (...nos: number[]) => nos.map((n) => tasks.find((t) => t.no === n)!);

export const M01: Story = {
  name: "M-01 プロジェクト",
  render: () => <MobileProjectView tab="browse" project="買い物" tasks={shopping} sections={sections} swipeTitle="食パン" onProjectMenu={() => undefined} />,
};

export const M01b: Story = {
  name: "M-01b サブタスク展開",
  render: () => <MobileProjectView tab="browse" project="買い物" tasks={shopping} sections={sections} initialExpanded={[1]} />,
};

// M-02 は M-01 の上に層を重ねたもの。FAB で開き直せて、scrim をタップすると M-01 に戻る。
export const M02: Story = {
  name: "M-02 クイック追加",
  render: () => <MobileProjectView tab="browse" project="買い物" tasks={shopping} sections={sections} initialOverlay="quickAdd" swipeTitle="食パン" />,
};

export const M03: Story = {
  name: "M-03 タスク詳細",
  render: () => (
    <MobileTaskDetail
      // pen の M-03 は ラベル 2 件 / リマインダー 30 分前 / 説明の末尾に「。」
      task={{ ...tasks[0], labels: ["食品", "急ぎ"], reminders: ["-30m"], note: "近所のスーパーで。卵は 10 個入り。" }}
      subtasks={byNo(4, 5, 7)}
      project={projects.find((p) => p.name === "買い物")!}
      section="今週"
    />
  ),
};

export const M04: Story = {
  name: "M-04 今日",
  render: () => (
    // pen の「ゴミ出し」は括弧書きなし
    <MobileToday overdue={byNo(9, 10)} todays={[...byNo(8, 11), { ...byNo(12)[0], title: "ゴミ出し" }]} today={TODAY} />
  ),
};

export const M10: Story = {
  name: "M-10 ダークモードの今日",
  globals: { theme: "dark", viewport: { value: "mobile", isRotated: false } },
  render: () => <MobileToday overdue={byNo(9, 10)} todays={[...byNo(8, 11), { ...byNo(12)[0], title: "ゴミ出し" }]} today={TODAY} />,
};

// M-04b: M-04 scrolled by the large title's height: the title sits small in the bar (spec ④ iPhone §3.3).
// Extra overdue rows give the body more than LARGE_TITLE_HEIGHT of scroll room.
export const M04b: Story = {
  name: "M-04b 今日 (見出しが縮んだところ)",
  render: () => (
    <MobileToday
      overdue={[...byNo(9, 10), ...byNo(9, 10, 9, 10, 9, 10).map((t, i) => ({ ...t, no: 900 + i }))]}
      todays={[...byNo(8, 11), { ...byNo(12)[0], title: "ゴミ出し" }]}
      today={TODAY}
      initialScrollTop={LARGE_TITLE_HEIGHT}
    />
  ),
};

export const M05: Story = {
  name: "M-05 近日",
  render: () => (
    // pen の 10月16日 の行は「読書会の課題本」
    <MobileUpcoming tasks={[...byNo(8, 11, 1), { ...byNo(14)[0], title: "読書会の課題本" }]} today={TODAY} />
  ),
};

export const M06: Story = {
  name: "M-06 閲覧",
  render: () => <MobileBrowse projects={projects} counts={counts} syncState="synced" lastSyncedAt="2 分前" today={TODAY} />,
};

export const M07: Story = {
  name: "M-07 設定",
  render: () => <MobileSettings today={TODAY} />,
};

// ---- Phase 6: 実データ (live) で動かす画面。チェックは task.progress を書き換えて呼び出し側が持つ。fill は実機と同じ 100dvh / セーフエリア ----
function useTasks(initial: Task[]) {
  const [list, setList] = useState(initial);
  const toggle = (t: Task, done: boolean) => setList((cur) => cur.map((x) => (x.no === t.no ? { ...x, progress: done ? 100 : 0 } : x)));
  return { list, toggle };
}

function LiveProject() {
  const { list, toggle } = useTasks(shopping);
  return <MobileProjectView live fill tab="browse" project="買い物" tasks={list} sections={sections} today={TODAY} onToggleDone={toggle} onProjectMenu={() => undefined} onAddTask={() => undefined} />;
}

export const M01Live: Story = {
  name: "M-01 データ入り (fill)",
  render: () => <LiveProject />,
};

function LiveTodayNoOverdue() {
  const { list, toggle } = useTasks([...byNo(8, 11), { ...byNo(12)[0], title: "ゴミ出し" }]);
  return <MobileToday live fill overdue={[]} todays={list} today={TODAY} onToggleDone={toggle} />;
}

// Spec 2026-11-22: long press lifts a row; moving it shows the drop line, releasing moves it (here: logged only).
export const M01Reorder: Story = {
  name: "M-01 長押しで並び替え (fill)",
  render: () => {
    const Live = () => {
      const { list, toggle } = useTasks(shopping);
      return (
        <MobileProjectView
          live
          fill
          tab="browse"
          project="買い物"
          tasks={list}
          sections={sections}
          today={TODAY}
          onToggleDone={toggle}
          onSwipeDate={() => undefined}
          onTaskMenu={() => console.log("menu")}
          onReorder={(no, to) => console.log("reorder", no, JSON.stringify(to))}
          onAddTask={() => undefined}
        />
      );
    };
    return <Live />;
  },
};

// Spec 2026-11-24: Today's group reorders by long press (logged only); overdue rows keep the menu.
export const M04Reorder: Story = {
  name: "M-04 長押しで並び替え (fill)",
  render: () => (
    <MobileToday
      live
      fill
      overdue={byNo(9, 10)}
      todays={[...byNo(8, 11), { ...byNo(12)[0], title: "ゴミ出し" }]}
      today={TODAY}
      onSwipeDate={() => undefined}
      onTaskMenu={() => console.log("menu")}
      onReorderToday={(keys) => console.log("today", keys.join(","))}
    />
  ),
};

export const M04NoOverdue: Story = {
  name: "M-04 期限切れなし",
  render: () => <LiveTodayNoOverdue />,
};

// Not on the storyboard: a long title ends in an ellipsis, rows are 48 / 63 / 82 high.
export const M01Long: Story = {
  name: "M-01 長い名前 (fill)",
  render: () => {
    const Live = () => {
      const { list, toggle } = useTasks([...shopping, { ...shopping[1], no: 90, title: LONG_TITLE, category: "今週", order: 9 }]);
      return <MobileProjectView live fill tab="browse" project="買い物" tasks={list} sections={sections} today={TODAY} onToggleDone={toggle} />;
    };
    return <Live />;
  },
};

// 残る帯 (保存失敗) は header の下に流れ、一覧はその分だけ下がる (上の行が隠れない)
export const M01Banner: Story = {
  name: "M-01 帯つき (fill)",
  render: () => {
    const Live = () => {
      const { list, toggle } = useTasks(shopping);
      return (
        <MobileProjectView
          live
          fill
          tab="browse"
          project="買い物"
          tasks={list}
          sections={sections}
          today={TODAY}
          onToggleDone={toggle}
          banner={<SaveBanner message="保存できませんでした" onRetry={() => undefined} />}
        />
      );
    };
    return <Live />;
  },
};

// ---- Phase 6 Task 10: 長押しメニューと日付のシート (実データの画面に重ねた状態) ----
function LiveWithSheet({ kind }: { kind: "menu" | "date" }) {
  const { list, toggle } = useTasks(shopping);
  const task = shopping[0];
  const close = () => undefined;
  return (
    <MobileProjectView
      live
      fill
      tab="browse"
      project="買い物"
      tasks={list}
      sections={sections}
      today={TODAY}
      onToggleDone={toggle}
      onSwipeDate={() => undefined}
      onTaskMenu={() => undefined}
      overlay={
        <BottomSheet open title={kind === "menu" ? task.title : "日付"} onClose={close}>
          {kind === "menu" ? (
            <TaskMenuSheet task={task} onDate={close} onPriority={close} onMove={close} onDelete={close} onClose={close} />
          ) : (
            <DateSheet value={task.due} time={task.dueTime} today={TODAY} onChange={close} onClose={close} />
          )}
        </BottomSheet>
      }
    />
  );
}

export const M01Menu: Story = {
  name: "M-01 長押しメニュー (fill)",
  render: () => <LiveWithSheet kind="menu" />,
};

export const M09: Story = {
  name: "M-09 日付のシート",
  render: () => <LiveWithSheet kind="date" />,
};

// ---- Task 11: 入力中のクイック追加 / 編集できる詳細 ----
function TypingQuickAdd() {
  const [text, setText] = useState("牛乳");
  // 実機は parse_quick_add の結果から作る。Story は「明日」だけ日付として色を付ける。
  const i = text.indexOf("明日");
  const tokens = i < 0 ? [{ text }] : [{ text: text.slice(0, i) }, { text: "明日", kind: "date" as const }, ...(text.slice(i + 2) ? [{ text: text.slice(i + 2) }] : [])];
  return (
    <SheetFrame>
      <MobileQuickAddSheet tokens={tokens} text={text} onTextChange={setText} onSubmit={() => undefined} onInsert={(k) => setText(insertToken(text, k))} />
    </SheetFrame>
  );
}

export const M02Typing: Story = {
  name: "M-02 入力中 (ツールバーで日付を足した)",
  render: () => <TypingQuickAdd />,
};

// 長い日付とプロジェクト名: 日付・プロジェクトのチップが縮んで省略され、送信ボタンはカードの内側に残る (375 / 390 幅)。
export const M02LongChips: Story = {
  name: "M-02 長い日付とプロジェクト名",
  render: () => (
    <SheetFrame>
      <MobileQuickAddSheet
        tokens={[{ text: "牛乳 " }, { text: "来週の月曜日", kind: "date" }, { text: " " }, { text: "#とても長いプロジェクトの名前", kind: "project" }]}
        text="牛乳 来週の月曜日 #とても長いプロジェクトの名前"
        onTextChange={() => undefined}
        onSubmit={() => undefined}
      />
    </SheetFrame>
  ),
};

// The date chip opens the date list over the card (spec 2026-11-22 §1). Picking rewrites the date word in the field.
export const M02DatePicker: Story = {
  name: "M-02 日付のチップで一覧を開いた",
  render: () => (
    <SheetFrame>
      <MobileQuickAddSheet tokens={[{ text: "牛乳 " }, { text: "明日", kind: "date" }]} text="牛乳 明日" onTextChange={() => undefined} onSubmit={() => undefined} covered />
      <BottomSheet open title="日付" onClose={() => undefined}>
        <DateSheet value="2026-10-15" today={TODAY} onChange={() => undefined} onClose={() => undefined} />
      </BottomSheet>
    </SheetFrame>
  ),
};

// Not on the storyboard: a long task name wraps in the detail like in the list.
export const M03LongTitle: Story = {
  name: "M-03 長いタスク名",
  render: () => (
    <MobileTaskDetail
      task={{ ...tasks[0], title: LONG_TITLE + LONG_TITLE }}
      subtasks={[]}
      project={projects.find((p) => p.name === "買い物")!}
      section="今週"
    />
  ),
};

// Spec 2026-11-28: the task detail is a popup over the list (it was a full screen).
export const M03Popup: Story = {
  name: "M-03 タスク詳細 (ポップアップ)",
  render: () => (
    <MobileProjectView
      live
      fill
      tab="browse"
      project="買い物"
      tasks={shopping}
      sections={sections}
      today={TODAY}
      overlay={
        <DetailSheet open onClose={() => undefined}>
          <MobileTaskDetail
            popup
            live
            fill
            today={TODAY}
            task={{ ...tasks[0], labels: ["食品", "急ぎ"], reminders: ["-30m"], note: "近所のスーパーで。卵は 10 個入り。" }}
            subtasks={byNo(4, 5, 7)}
            project={projects.find((p) => p.name === "買い物")!}
            section="今週"
            onBack={() => undefined}
            onChange={() => undefined}
            onAddSubtask={() => undefined}
            onAddComment={async () => true}
          />
        </DetailSheet>
      }
    />
  ),
};

export const M03DateSheet: Story = {
  name: "M-03 日付のシートを開いた",
  render: () => (
    <MobileTaskDetail
      task={{ ...tasks[0], labels: ["食品", "急ぎ"], reminders: ["-30m"], note: "近所のスーパーで。卵は 10 個入り。" }}
      subtasks={byNo(4, 5, 7)}
      project={projects.find((p) => p.name === "買い物")!}
      section="今週"
      onChange={() => undefined}
      initialSheet="date"
    />
  ),
};

// Not on the storyboard: many subtasks scroll above the comment bar, so 「サブタスクを追加」 can be scrolled into view and pressed.
export const M03ManySubtasks: Story = {
  name: "M-03 サブタスクが多い (fill)",
  render: () => (
    <MobileTaskDetail
      live
      fill
      task={{ ...tasks[0], labels: ["食品", "急ぎ"], reminders: ["-30m"], note: "近所のスーパーで。卵は 10 個入り。" }}
      subtasks={[...byNo(4, 5, 7), ...byNo(4, 5, 7, 4, 5).map((t, i) => ({ ...t, no: 950 + i, order: 10 + i }))]}
      project={projects.find((p) => p.name === "買い物")!}
      section="今週"
      today={TODAY}
      onChange={() => undefined}
      onAddSubtask={() => undefined}
      onAddComment={async () => true}
      onMove={() => undefined}
      projects={projects.map((p) => ({ ...p, taskCount: 0 }))}
      sections={sections}
    />
  ),
};

// ---- Phase 6 Task 12: 設定 (同期 / 通知 / 表示名 / ファイル)、同期の帯、引っ張って更新 ----
const noop = () => undefined;
const syncPane = {
  settings: nasConnected,
  status: syncStatuses.synced,
  tailnet: tailnets.running,
  onChangeBackend: noop,
  onSyncNow: noop,
  onDisconnect: noop,
};
const dataDirHint = "「ファイル」アプリの「このiPhone内 → PowerToDo」にあります。Excel で直した内容は、アプリに戻ると反映されます";

function LiveSettings({ permission }: { permission: "granted" | "denied" | "prompt" }) {
  const [enabled, setEnabled] = useState(true);
  const [name, setName] = useState("たろう");
  return (
    <MobileSettings today={TODAY}
      sync={syncPane}
      notifications={{ enabled, permission }}
      onToggleNotifications={setEnabled}
      onRequestPermission={noop}
      displayName={name}
      onDisplayName={async (v) => {
        setName(v);
        return true;
      }}
      dataDirHint={dataDirHint}
      onBack={noop}
    />
  );
}

export const M07Nas: Story = {
  name: "M-07 NAS 接続済み",
  render: () => <LiveSettings permission="granted" />,
};

export const M07Denied: Story = {
  name: "M-07 通知が拒否されている",
  render: () => <LiveSettings permission="denied" />,
};

export const M07Google: Story = {
  name: "M-07 Google Drive 接続済み",
  render: () => (
    <MobileSettings today={TODAY}
      sync={{ ...syncPane, settings: googleLoggedIn, status: syncStatuses.googleAuthRejected, tailnet: null, onGoogleLogin: async () => true }}
      notifications={{ enabled: true, permission: "prompt" }}
      onRequestPermission={noop}
      dataDirHint={dataDirHint}
      onBack={noop}
    />
  ),
};

export const M01Conflict: Story = {
  name: "M-01 競合の帯",
  render: () => {
    const Live = () => {
      const { list, toggle } = useTasks(shopping);
      return (
        <MobileProjectView
          live
          fill
          tab="browse"
          project="買い物"
          tasks={list}
          sections={sections}
          today={TODAY}
          onToggleDone={toggle}
          banner={
            <Banners
              narrow
              reminders={{ items: [], today: TODAY, onDone: noop, onSnooze: noop, onOpen: noop, onDismiss: noop, onDismissAll: noop }}
              saveErrors={{}}
              onRetrySave={noop}
              readFailures={{ failures: {}, dismiss: noop } as never}
              held={[]}
              heldFileName={(p) => `${p}.xlsx`}
              onResolve={noop}
              invalidCount={0}
              onReveal={noop}
              onReload={noop}
              notice={null}
              onClearNotice={noop}
              flash={null}
              onClearFlash={noop}
              sync={{
                conflicts: [{ file: "買い物.xlsx", conflictFile: "買い物 (競合 iPhone 2026-10-20 09-41).xlsx" }],
                onOpenConflict: noop,
                onDismissConflict: noop,
              }}
            />
          }
        />
      );
    };
    return <Live />;
  },
};

export const M01Refreshing: Story = {
  name: "M-01 引っ張って更新中",
  render: () => {
    const Live = () => {
      const { list, toggle } = useTasks(shopping);
      return (
        <MobileProjectView live fill tab="browse" project="買い物" tasks={list} sections={sections} today={TODAY} onToggleDone={toggle} refreshing />
      );
    };
    return <Live />;
  },
};

// M-11 (spec 2026-11-22 §4): the menu button at the top left of a tab screen opens the drawer. An item closes it.
function DrawerOpen() {
  const [open, setOpen] = useState(true);
  return (
    <MobileMenuContext.Provider value={() => setOpen(true)}>
      <MobileToday
        overdue={byNo(9, 10)}
        todays={[...byNo(8, 11), { ...byNo(12)[0], title: "ゴミ出し" }]}
        today={TODAY}
        overlay={
          <MobileDrawer
            open={open}
            onClose={() => setOpen(false)}
            displayName="たろう"
            projects={projects}
            counts={counts}
            active={{ kind: "today" }}
            syncState="synced"
            lastSyncedAt="2 分前"
            onGo={() => setOpen(false)}
          />
        }
      />
    </MobileMenuContext.Provider>
  );
}

export const M11: Story = {
  name: "M-11 メニュー (ドロワー)",
  render: () => <DrawerOpen />,
};

// Spec 2026-11-24: the 「…」 at the top right of Today opens the 表示 sheet (sort / direction / group / priority filter).
function TodayWithViewSheet({ initial, open = true }: { initial: ViewOptions; open?: boolean }) {
  const [view, setView] = useState(initial);
  const [shown, setShown] = useState(open);
  return (
    <MobileToday
      live
      fill
      overdue={byNo(9, 10)}
      todays={[...byNo(8, 11), { ...byNo(12)[0], title: "ゴミ出し" }]}
      today={TODAY}
      view={view}
      arrangeCtx={{ today: TODAY, weekStart: "mon", labelOrder: [], projectOrder: projects.map((p) => p.name) }}
      onViewMenu={() => setShown(true)}
      overlay={
        <BottomSheet open={shown} size="large" title="表示" onClose={() => setShown(false)}>
          <ViewSheet screen="today" options={view} onChange={setView} />
        </BottomSheet>
      }
    />
  );
}

export const M12: Story = {
  name: "M-12 今日の表示のシート",
  render: () => <TodayWithViewSheet initial={{ ...DEFAULTS, sort: "time" }} />,
};

export const M12Grouped: Story = {
  name: "M-12 今日をプロジェクトでグループ",
  render: () => <TodayWithViewSheet initial={{ ...DEFAULTS, group: "project", sort: "priority" }} open={false} />,
};

// Spec 2026-11-27: a project shows its Google calendar's events above the tasks (display only).
export const M13: Story = {
  name: "M-13 Google カレンダーの予定 (プロジェクト)",
  render: () => <MobileProjectView live fill tab="browse" project="買い物" tasks={shopping} sections={sections} today={TODAY} events={calendarEvents} onProjectMenu={() => undefined} />,
};

export const M13Login: Story = {
  name: "M-13 カレンダーにログインが必要",
  render: () => <MobileProjectView live fill tab="browse" project="買い物" tasks={shopping} sections={sections} today={TODAY} calendarNote="このカレンダーにはログインが必要です (設定の Google カレンダー)" />,
};

export const M13Today: Story = {
  name: "M-13 今日の予定",
  render: () => <MobileToday live fill overdue={byNo(9, 10)} todays={[...byNo(8, 11), { ...byNo(12)[0], title: "ゴミ出し" }]} today={TODAY} events={calendarEvents.filter((e) => e.date === TODAY)} />,
};

// Tapping an event opens its detail (spec 2026-11-27): the date and time, the place, the notes and two links.
export const M15: Story = {
  name: "M-15 Google カレンダーの予定の詳細",
  render: () => (
    <MobileProjectView
      live
      fill
      tab="browse"
      project="買い物"
      tasks={shopping}
      sections={sections}
      today={TODAY}
      events={calendarEvents}
      overlay={
        <BottomSheet open size="large" title="予定" onClose={() => undefined}>
          <CalendarEventDetail event={calendarEvents[1]} today={TODAY} />
        </BottomSheet>
      }
    />
  ),
};

export const M14: Story = {
  name: "M-14 Google カレンダーを選ぶ (アカウント)",
  render: () => (
    <MobileProjectView
      live
      fill
      tab="browse"
      project="買い物"
      tasks={shopping}
      sections={sections}
      today={TODAY}
      overlay={
        <BottomSheet open size="large" title="Google カレンダー" onClose={() => undefined}>
          <CalendarSheet chooser={chooserStub(null)} />
        </BottomSheet>
      }
    />
  ),
};

export const M14Calendars: Story = {
  name: "M-14 Google カレンダーを選ぶ (カレンダー)",
  render: () => (
    <MobileProjectView
      live
      fill
      tab="browse"
      project="買い物"
      tasks={shopping}
      sections={sections}
      today={TODAY}
      overlay={
        <BottomSheet open size="large" title="Google カレンダー" onClose={() => undefined}>
          <CalendarSheet chooser={chooserStub("me@example.com")} />
        </BottomSheet>
      }
    />
  ),
};

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
