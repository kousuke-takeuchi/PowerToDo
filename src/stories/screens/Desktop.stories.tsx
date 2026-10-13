import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { TODAY, comments, counts, filters, labelCounts, labels, projects, sections, tasks } from "../../mock/data";
import { AppShell } from "../../views/AppShell";
import { BoardView } from "../../views/BoardView";
import { ConflictBanner } from "../../views/ConflictBanner";
import { FixBanner } from "../../views/FixBanner";
import { LabelDetailView } from "../../views/LabelDetailView";
import { LabelsView } from "../../views/LabelsView";
import { Onboarding } from "../../views/Onboarding";
import { OsNotification } from "../../views/OsNotification";
import { ProjectView } from "../../views/ProjectView";
import { QuickAddDialog } from "../../views/QuickAddDialog";
import type { ProjectViewProps } from "../../views/ProjectView";
import { SettingsDialog } from "../../views/SettingsDialog";
import type { SyncTarget } from "../../views/SettingsDialog";
import { Sidebar } from "../../views/Sidebar";
import type { SidebarProps } from "../../views/Sidebar";
import { SyncSamples } from "../../views/SyncSamples";
import { TaskDetailPanel } from "../../views/TaskDetailPanel";
import type { TaskDetailPanelProps } from "../../views/TaskDetailPanel";
import type { SyncState } from "../../components/SyncStatus";
import { TodayView } from "../../views/TodayView";
import { UpcomingView } from "../../views/UpcomingView";

const meta = {
  title: "Screens/Desktop",
  parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

// pen の「買い物」プロジェクトは 今週 に 2 件 (牛乳と卵を買う / 洗剤の詰め替え)。
// mock の「食パンを買う」(no 8) は D-04 今日 用なので、プロジェクト画面の Story からは外す。
const shopping = tasks.filter((t) => t.no !== 8);
// D-11c / D-13 に加え、D-01 系以外の「買い物」背景 (D-02 / D-03 / D-07 / D-08 / D-09 系) も、pen は件数バッジとシェブロンを出さない (pen どおり)。
const shoppingFlat = shopping.filter((t) => t.parentNo === undefined);

const sidebar = (
  <Sidebar active={{ kind: "project", name: "買い物" }} counts={counts} projects={projects} syncState="synced" lastSyncedAt="09:41" />
);

function Screen({ width, banner, ...view }: Partial<ProjectViewProps> & { width?: 1440 | 960; banner?: React.ReactNode }) {
  return (
    <AppShell width={width} sidebar={sidebar} syncState="synced" banner={banner}>
      <ProjectView project="買い物" tasks={shopping} sections={sections} {...view} />
    </AppShell>
  );
}

export const D01: Story = {
  name: "D-01 プロジェクト",
  render: () => <Screen showLongTitleRow />,
};

export const D01b: Story = {
  name: "D-01b サブタスク展開",
  render: () => <Screen initialExpanded={[1, 5]} />,
};

export const D01c: Story = {
  name: "D-01c サブタスク追加フォーム",
  render: () => <Screen initialExpanded={[1, 5]} initialFormParent={1} />,
};

// D-02: D-01 の上にクイック追加ダイアログ。キャンセル / scrim / Esc で閉じ、サイドバーの「タスクを追加」で開き直す。
const quickAddTokens = [
  { text: "牛乳と卵を買う " },
  { text: "明日", kind: "date" as const },
  { text: "p1", kind: "priority" as const },
  { text: "#買い物", kind: "project" as const },
  { text: "@食品", kind: "label" as const },
];

const shoppingColor = projects.find((p) => p.name === "買い物")?.color;

function QuickAddScreen() {
  const [open, setOpen] = useState(true);
  return (
    <AppShell
      sidebar={
        <Sidebar
          active={{ kind: "project", name: "買い物" }}
          counts={counts}
          projects={projects}
          syncState="synced"
          lastSyncedAt="09:41"
          onAddTask={() => setOpen(true)}
        />
      }
      syncState="synced"
      overlay={
        open ? (
          <QuickAddDialog
            open
            tokens={quickAddTokens}
            project="買い物"
            projectColor={shoppingColor}
            section="今週"
            onClose={() => setOpen(false)}
          />
        ) : undefined
      }
    >
      <ProjectView project="買い物" tasks={shoppingFlat} sections={sections} />
    </AppShell>
  );
}

export const D02: Story = {
  name: "D-02 クイック追加",
  render: () => <QuickAddScreen />,
};

export const D10: Story = {
  name: "D-10 ボード",
  render: () => (
    <AppShell sidebar={sidebar} syncState="synced" fullWidth>
      <BoardView project="買い物" tasks={shopping} sections={sections} dragging={1} />
    </AppShell>
  ),
};

export const D11a: Story = {
  name: "D-11a 空のプロジェクト",
  render: () => <Screen state="empty" />,
};

export const D11b: Story = {
  name: "D-11b 読み込みエラー",
  render: () => <Screen state="error" />,
};

export const D11c: Story = {
  name: "D-11c 要修正行",
  render: () => (
    <AppShell sidebar={sidebar} syncState="synced" banner={<FixBanner />}>
      <ProjectView project="買い物" tasks={shoppingFlat} sections={sections} state="invalid" />
    </AppShell>
  ),
};

export const D13: Story = {
  name: "D-13 最小ウィンドウ 960x600",
  globals: { viewport: { value: "min", isRotated: false } },
  render: () => (
    <AppShell width={960} sidebar={sidebar} syncState="synced">
      <ProjectView project="買い物" tasks={shoppingFlat} sections={sections} showActions />
    </AppShell>
  ),
};

function navShell(active: SidebarProps["active"], children: React.ReactNode, todayCount: number = counts.today) {
  return (
    <AppShell
      sidebar={<Sidebar active={active} counts={{ ...counts, today: todayCount }} projects={projects} syncState="synced" lastSyncedAt="09:41" />}
      syncState="synced"
    >
      {children}
    </AppShell>
  );
}

// pen の今日 / 近日 / ラベル詳細は mock の一部のタスクだけを見せている (pen に合わせて Story 側で絞る)。
// 15 調味料の補充 (D-06b 用) / 13 粗大ごみ / 12 ゴミ出し (D-05 では出ない) を外す。
const withoutNo = (...nos: number[]) => tasks.filter((t) => !nos.includes(t.no));

export const D04: Story = {
  name: "D-04 今日",
  render: () => navShell({ kind: "today" }, <TodayView tasks={withoutNo(15)} today={TODAY} />),
};

export const D04b: Story = {
  name: "D-04 今日 (期限切れなし)",
  render: () => navShell({ kind: "today" }, <TodayView tasks={withoutNo(15)} today={TODAY} hideOverdue />, 3),
};

export const D05: Story = {
  name: "D-05 近日",
  render: () => navShell({ kind: "upcoming" }, <UpcomingView tasks={withoutNo(12, 13, 15)} today={TODAY} />),
};

export const D06: Story = {
  name: "D-06 フィルターとラベル",
  render: () => navShell({ kind: "labels" }, <LabelsView labels={labels} filters={filters} counts={labelCounts} />),
};

export const D06b: Story = {
  name: "D-06b ラベル詳細",
  render: () => navShell({ kind: "labels" }, <LabelDetailView label="食品" tasks={tasks} />),
};

// D-03 系: pen の詳細パネルは「牛乳と卵を買う」。mock の task 1 に pen 固有の説明文とラベル 2 つを足して渡す
// (D-01 の行は mock のまま。パネルだけ pen に合わせる)。
const detailTask = {
  ...tasks[0],
  note: "近所のスーパーで。卵は 10 個入り。ポイントカードを忘れない。",
  labels: ["食品", "急ぎ"],
};
const detailProject = projects.find((p) => p.name === "買い物")!;

function DetailScreen({ initialPopover }: { initialPopover?: TaskDetailPanelProps["initialPopover"] }) {
  // 行をクリックするとその行のパネルを開く (pen の詳細は 1 番の行のものだけなので、他の行は mock のまま)。
  const [openNo, setOpenNo] = useState<number | null>(detailTask.no);
  const shown = openNo === null ? undefined : openNo === detailTask.no ? detailTask : tasks.find((t) => t.no === openNo);
  return (
    <AppShell
      sidebar={sidebar}
      syncState="synced"
      panel={
        shown ? (
          <TaskDetailPanel
            key={shown.no}
            task={shown}
            subtasks={tasks.filter((t) => t.parentNo === shown.no)}
            project={detailProject}
            section={shown.category ?? undefined}
            comments={comments}
            initialPopover={shown.no === detailTask.no ? initialPopover : undefined}
            onClose={() => setOpenNo(null)}
          />
        ) : undefined
      }
    >
      <ProjectView project="買い物" tasks={shoppingFlat} sections={sections} onOpenTask={(t) => setOpenNo(t.no)} />
    </AppShell>
  );
}

export const D03: Story = {
  name: "D-03 タスク詳細",
  render: () => <DetailScreen />,
};

export const D07: Story = {
  name: "D-07 日付ピッカー",
  render: () => <DetailScreen initialPopover="date" />,
};

export const D07b: Story = {
  name: "D-07b 繰り返し設定",
  render: () => <DetailScreen initialPopover="recurrence" />,
};

export const D08: Story = {
  name: "D-08 リマインダー",
  render: () => <DetailScreen initialPopover="reminder" />,
};

export const D08b: Story = {
  name: "D-08b OS 通知",
  parameters: { layout: "fullscreen" },
  render: () => <OsNotification title="牛乳と卵を買う" sub="15:00 · 買い物" />,
};

// D-09 系: D-01 の上に設定ダイアログ。同期先セグメントで本文が切り替わり、ログイン / 接続 / ログアウト / 切断で接続状態が動く。
// scrim クリック / Esc で閉じ、サイドバーのアカウントで開き直す。サイドバー最下部の同期状態は pen に合わせて Story ごとに渡す。
function SettingsScreen({ initialTarget, connected, syncState, lastSyncedAt }: { initialTarget: SyncTarget; connected?: boolean; syncState: SyncState; lastSyncedAt?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <AppShell
      sidebar={
        <Sidebar
          active={{ kind: "project", name: "買い物" }}
          counts={counts}
          projects={projects}
          syncState={syncState}
          lastSyncedAt={lastSyncedAt}
          onOpenSettings={() => setOpen(true)}
        />
      }
      syncState={syncState}
      overlay={open ? <SettingsDialog open initialTarget={initialTarget} connected={connected} onClose={() => setOpen(false)} /> : undefined}
    >
      <ProjectView project="買い物" tasks={shoppingFlat} sections={sections} />
    </AppShell>
  );
}

export const D09: Story = {
  name: "D-09 設定",
  render: () => <SettingsScreen initialTarget="google" syncState="off" />,
};

export const D09c: Story = {
  name: "D-09c 設定 (接続済み)",
  render: () => <SettingsScreen initialTarget="google" connected syncState="synced" lastSyncedAt="09:41" />,
};

export const D09e: Story = {
  name: "D-09e 設定 (NAS 未接続)",
  render: () => <SettingsScreen initialTarget="nas" syncState="off" />,
};

export const D09f: Story = {
  name: "D-09f 設定 (NAS 接続済み)",
  render: () => <SettingsScreen initialTarget="nas" connected syncState="synced" lastSyncedAt="09:41" />,
};

function ConflictScreen() {
  const [shown, setShown] = useState(true);
  return (
    <AppShell
      sidebar={<Sidebar active={{ kind: "project", name: "買い物" }} counts={counts} projects={projects} syncState="error" />}
      syncState="error"
      banner={shown ? <ConflictBanner fileName="買い物.xlsx" conflictName="買い物 (競合 2026-10-13 0941).xlsx" onClose={() => setShown(false)} /> : undefined}
    >
      <ProjectView project="買い物" tasks={shoppingFlat} sections={sections} />
    </AppShell>
  );
}

export const D09b: Story = {
  name: "D-09b 競合バナー",
  render: () => <ConflictScreen />,
};

export const D09d: Story = {
  name: "D-09d 同期状態一覧",
  render: () => <SyncSamples />,
};

export const D12: Story = {
  name: "D-12 初回起動",
  render: () => <Onboarding step={1} />,
};

export const D12b: Story = {
  name: "D-12b 初回起動 (Google 接続)",
  render: () => <Onboarding step={2} target="google" />,
};

export const D12c: Story = {
  name: "D-12c 初回起動 (受信トレイ)",
  render: () => <Onboarding step={3} />,
};

export const D12d: Story = {
  name: "D-12d 初回起動 (NAS)",
  render: () => <Onboarding step={2} target="nas" />,
};
