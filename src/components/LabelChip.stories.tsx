import type { Meta, StoryObj } from "@storybook/react-vite";
import { LabelChip } from "./LabelChip";

const meta = { title: "Components/LabelChip", component: LabelChip } satisfies Meta<typeof LabelChip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  args: { name: "買い物" },
  render: () => (
    <div style={{ display: "flex", gap: 24, alignItems: "center", padding: 24 }}>
      <LabelChip name="買い物" />
      <LabelChip name="仕事" />
      <LabelChip name="家" />
    </div>
  ),
};

export const Playground: Story = {
  args: { name: "買い物" },
  decorators: [(Story) => <div style={{ padding: 24 }}><Story /></div>],
};
