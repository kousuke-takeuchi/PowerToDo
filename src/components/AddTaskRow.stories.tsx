import type { Meta, StoryObj } from "@storybook/react-vite";
import { AddTaskRow } from "./AddTaskRow";

const meta = {
  title: "Components/AddTaskRow",
  component: AddTaskRow,
  decorators: [(Story) => <div style={{ width: 800, padding: 24 }}><Story /></div>],
} satisfies Meta<typeof AddTaskRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <AddTaskRow />
      <AddTaskRow label="サブタスクを追加" />
    </div>
  ),
};

export const Playground: Story = { args: { label: "タスクを追加" } };
