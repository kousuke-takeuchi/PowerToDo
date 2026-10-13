import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextField, type TextFieldProps } from "./TextField";

const meta = { title: "Components/TextField", component: TextField } satisfies Meta<typeof TextField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  args: {},
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24, width: 448 }}>
      <TextField placeholder="タスク名" />
      <TextField value="牛乳を買う" />
      <TextField type="password" value="secret-value" />
      <TextField type="url" value="https://nas.local" readOnly />
    </div>
  ),
};

function Controlled(args: TextFieldProps) {
  const [v, setV] = useState(args.value ?? "");
  return (
    <div style={{ padding: 24, width: 448 }}>
      <TextField {...args} value={v} onChange={setV} />
    </div>
  );
}

export const Playground: Story = {
  args: { placeholder: "タスク名", type: "text", readOnly: false },
  argTypes: { type: { control: "inline-radio", options: ["text", "password", "url"] } },
  render: (args) => <Controlled {...args} />,
};
