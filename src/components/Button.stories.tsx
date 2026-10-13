import type { Meta, StoryObj } from "@storybook/react-vite";
import { Ellipsis, Plus } from "lucide-react";
import { Button } from "./Button";

const meta = { title: "Components/Button", component: Button } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  args: { children: "保存" },
  render: () => (
    <div style={{ display: "flex", gap: 24, alignItems: "center", padding: 24 }}>
      <Button variant="primary">タスクを追加</Button>
      <Button variant="primary" icon={Plus}>タスクを追加</Button>
      <Button variant="primary" disabled>タスクを追加</Button>
      <Button variant="secondary">キャンセル</Button>
      <Button variant="secondary" disabled>キャンセル</Button>
      <Button variant="icon" icon={Ellipsis} />
    </div>
  ),
};

export const Playground: Story = {
  args: { variant: "primary", children: "タスクを追加", disabled: false },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "secondary", "icon"] },
    icon: { control: false },
  },
  decorators: [(Story) => <div style={{ padding: 24 }}><Story /></div>],
};
