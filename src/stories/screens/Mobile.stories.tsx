import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TODAY, projects, sections, tasks } from "../../mock/data";
import { MobileProjectView } from "../../views/mobile/MobileProjectView";
import { MobileSettings } from "../../views/mobile/MobileSettings";
import { MobileTaskDetail } from "../../views/mobile/MobileTaskDetail";
import { MobileToday } from "../../views/mobile/MobileToday";
import type { Task } from "../../types/model";
import { MobileUpcoming } from "../../views/mobile/MobileUpcoming";

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
  render: () => <MobileProjectView project="買い物" tasks={shopping} sections={sections} swipeTitle="食パン" />,
};

export const M01b: Story = {
  name: "M-01b サブタスク展開",
  render: () => <MobileProjectView project="買い物" tasks={shopping} sections={sections} initialExpanded={[1]} />,
};

// M-02 / M-06 は M-01 の上に層を重ねたもの。FAB / ハンバーガーで開き直せて、scrim をタップすると M-01 に戻る。
export const M02: Story = {
  name: "M-02 クイック追加",
  render: () => <MobileProjectView project="買い物" tasks={shopping} sections={sections} initialOverlay="quickAdd" swipeTitle="食パン" />,
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

export const M05: Story = {
  name: "M-05 近日",
  render: () => (
    // pen の 10月16日 の行は「読書会の課題本」
    <MobileUpcoming tasks={[...byNo(8, 11, 1), { ...byNo(14)[0], title: "読書会の課題本" }]} today={TODAY} />
  ),
};

export const M06: Story = {
  name: "M-06 ドロワー",
  render: () => <MobileProjectView project="買い物" tasks={shopping} sections={sections} initialOverlay="drawer" swipeTitle="食パン" />,
};

export const M07: Story = {
  name: "M-07 設定",
  render: () => <MobileSettings />,
};

// ---- Phase 6: 実データ (live) で動かす画面。チェックは task.progress を書き換えて呼び出し側が持つ。fill は実機と同じ 100dvh / セーフエリア ----
function useTasks(initial: Task[]) {
  const [list, setList] = useState(initial);
  const toggle = (t: Task, done: boolean) => setList((cur) => cur.map((x) => (x.no === t.no ? { ...x, progress: done ? 100 : 0 } : x)));
  return { list, toggle };
}

function LiveProject() {
  const { list, toggle } = useTasks(shopping);
  return <MobileProjectView live fill project="買い物" tasks={list} sections={sections} today={TODAY} onToggleDone={toggle} />;
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
