import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Segmented } from "./Segmented";

const meta = { title: "Components/Segmented", component: Segmented } satisfies Meta<typeof Segmented>;
export default meta;
type Story = StoryObj<typeof meta>;

const two = [
  { value: "due", label: "期限から" },
  { value: "at", label: "日時指定" },
];
const three = [
  { value: "day", label: "日" },
  { value: "week", label: "週" },
  { value: "month", label: "月" },
];

export const Variants: Story = {
  args: { options: two, value: "due" },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24, width: 296 }}>
      <Segmented options={two} value="due" />
      <Segmented options={two} value="at" />
      <Segmented options={three} value="week" />
    </div>
  ),
};

export const Playground: Story = {
  args: { options: three, value: "day" },
  render: (args) => {
    const [v, setV] = useState(args.value);
    return (
      <div style={{ padding: 24, width: 296 }}>
        <Segmented options={args.options} value={v} onChange={setV} />
      </div>
    );
  },
};
