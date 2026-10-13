import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskRow } from "./TaskRow";
import type { TaskRowProps } from "./TaskRow";

const meta = {
  title: "Components/TaskRow",
  component: TaskRow,
  decorators: [(Story) => <div style={{ width: 864, padding: "0 32px", boxSizing: "border-box" }}><Story /></div>],
} satisfies Meta<typeof TaskRow>;
export default meta;
type Story = StoryObj<typeof meta>;

const base: TaskRowProps = {
  title: "牛乳と卵を買う",
  description: "近所のスーパーで、卵は 10 個入り",
  done: false,
  priority: 4,
  date: { label: "今日", tone: "success" },
  labels: ["買い物"],
  moreCount: 2,
  project: "受信トレイ",
};

export const Normal: Story = { name: "通常", args: base };
export const Done: Story = { name: "完了", args: { ...base, done: true, date: { label: "今日", tone: "muted" } } };
export const Overdue: Story = { name: "期限切れ", args: { ...base, priority: 1, date: { label: "昨日", tone: "danger" } } };
export const WithSubtasksCollapsed: Story = {
  name: "サブタスクあり (折りたたみ)",
  args: { ...base, subtasks: { done: 1, total: 3, expanded: false } },
};
export const Expanded: Story = {
  name: "展開 + 子 2 行 + 孫 1 行",
  args: base,
  render: () => (
    <div>
      <TaskRow {...base} title="旅行の準備" description={undefined} labels={undefined} moreCount={undefined} project={undefined} priority={2} subtasks={{ done: 1, total: 3, expanded: true }} />
      <TaskRow {...base} title="航空券を予約する" description={undefined} labels={undefined} moreCount={undefined} project={undefined} indent={1} priority={2} done subtasks={{ done: 0, total: 1, expanded: true }} />
      <TaskRow {...base} title="座席を選ぶ" description={undefined} labels={undefined} moreCount={undefined} project={undefined} indent={2} priority={2} date={undefined} />
      <TaskRow {...base} title="ホテルを探す" description={undefined} labels={undefined} moreCount={undefined} project={undefined} indent={1} priority={2} />
    </div>
  ),
};
export const LongTitle: Story = {
  name: "長文",
  args: {
    ...base,
    title: "来月の家族旅行に向けて、航空券とホテルの予約、現地での移動手段の確認、持ち物リストの作成、旅行保険の加入手続きをまとめて進める",
    showActions: true,
  },
};
export const Mobile: Story = {
  name: "モバイル",
  args: { ...base, variant: "mobile", subtasks: { done: 1, total: 3, expanded: false } },
  decorators: [(Story) => <div style={{ width: 358, padding: 0 }}><Story /></div>],
};

export const Playground: Story = {
  args: { ...base, showActions: false },
  argTypes: {
    priority: { control: "inline-radio", options: [1, 2, 3, 4] },
    variant: { control: "inline-radio", options: ["desktop", "mobile"] },
    indent: { control: "inline-radio", options: [0, 1, 2] },
  },
};
