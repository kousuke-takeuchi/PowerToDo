import type { Meta, StoryObj } from "@storybook/react-vite";
import { TODAY, counts, filters, labelCounts, labels, projects, sections, tasks } from "../../mock/data";
import { AppShell } from "../../views/AppShell";
import { FixBanner } from "../../views/FixBanner";
import { LabelDetailView } from "../../views/LabelDetailView";
import { LabelsView } from "../../views/LabelsView";
import { ProjectView } from "../../views/ProjectView";
import type { ProjectViewProps } from "../../views/ProjectView";
import { Sidebar } from "../../views/Sidebar";
import type { SidebarProps } from "../../views/Sidebar";
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
// D-11c (要修正行) と D-13 は件数バッジとシェブロンを出さない (pen どおり)。
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
