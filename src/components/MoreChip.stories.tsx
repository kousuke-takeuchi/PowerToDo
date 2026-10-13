import type { Meta, StoryObj } from "@storybook/react-vite";
import { MoreChip } from "./MoreChip";

const meta = { title: "Components/MoreChip", component: MoreChip } satisfies Meta<typeof MoreChip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  args: { count: 2 },
  render: () => (
    <div style={{ display: "flex", gap: 24, alignItems: "center", padding: 24 }}>
      <MoreChip count={1} />
      <MoreChip count={2} />
      <MoreChip count={12} />
    </div>
  ),
};

export const Playground: Story = {
  args: { count: 2 },
  decorators: [(Story) => <div style={{ padding: 24 }}><Story /></div>],
};
