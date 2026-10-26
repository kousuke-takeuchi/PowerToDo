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
import { TaskMenuSheet } from "../../views/mobile/TaskMenuSheet";

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
  return <MobileProjectView live fill tab="browse" project="買い物" tasks={list} sections={sections} today={TODAY} onToggleDone={toggle} />;
}

export const M01Live: Story = {
  name: "M-01 データ入り (fill)",
  render: () => <LiveProject />,
};

function LiveTodayNoOverdue() {
  const { list, toggle } = useTasks([...byNo(8, 11), { ...byNo(12)[0], title: "ゴミ出し" }]);
  return <MobileToday live fill overdue={[]} todays={list} today={TODAY} onToggleDone={toggle} />;
}

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
