import type { Meta, StoryObj } from "@storybook/react-vite";
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
