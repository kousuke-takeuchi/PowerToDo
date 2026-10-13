import type { Meta, StoryObj } from "@storybook/react-vite";
import { counts, projects, sections, tasks } from "../../mock/data";
import { AppShell } from "../../views/AppShell";
import { FixBanner } from "../../views/FixBanner";
import { ProjectView } from "../../views/ProjectView";
import type { ProjectViewProps } from "../../views/ProjectView";
import { Sidebar } from "../../views/Sidebar";

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
