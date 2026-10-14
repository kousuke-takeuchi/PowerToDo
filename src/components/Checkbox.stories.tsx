import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Checkbox } from "./Checkbox";

const meta = { title: "Components/Checkbox", component: Checkbox } satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  args: { checked: false },
  render: () => (
    <div style={{ display: "flex", gap: 24, padding: 24, flexDirection: "column", alignItems: "flex-start" }}>
      <div style={{ display: "flex", gap: 24 }}>
        {([1, 2, 3, 4] as const).map((p) => (
          <Checkbox key={p} checked={false} priority={p} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 24 }}>
        {([1, 2, 3, 4] as const).map((p) => (
          <Checkbox key={p} checked priority={p} />
        ))}
      </div>
    </div>
  ),
};

export const Playground: Story = {
  args: { checked: false, priority: 4 },
  argTypes: { priority: { control: "inline-radio", options: [1, 2, 3, 4] } },
  decorators: [(Story) => <div style={{ padding: 24 }}><Story /></div>],
};

/** クリックまたはボタンで切り替えて、チェックのアニメーション (リングの膨らみ / 塗り / チェックの描画) を確認する。 */
export const Animated: Story = {
  args: { checked: false, priority: 4 },
  argTypes: { priority: { control: "inline-radio", options: [1, 2, 3, 4] } },
  render: (args) => {
    const [checked, setChecked] = useState(args.checked);
    return (
      <div style={{ display: "flex", gap: 24, padding: 24, alignItems: "center", fontFamily: "var(--font-body)", color: "var(--color-text-primary)" }}>
        <Checkbox {...args} checked={checked} onChange={setChecked} ariaLabel="完了" />
        <button type="button" onClick={() => setChecked((c) => !c)}>
          切り替え
        </button>
        <span style={{ fontSize: 13 }}>{checked ? "完了" : "未完了"}</span>
      </div>
    );
  },
};
