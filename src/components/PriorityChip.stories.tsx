import type { Meta, StoryObj } from "@storybook/react-vite";
import { PriorityChip } from "./PriorityChip";

const meta = { title: "Components/PriorityChip", component: PriorityChip } satisfies Meta<typeof PriorityChip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  args: { priority: 1 },
  render: () => (
    <div style={{ display: "flex", gap: 24, alignItems: "center", padding: 24 }}>
      {([1, 2, 3, 4] as const).map((p) => (
        <PriorityChip key={p} priority={p} />
      ))}
    </div>
  ),
};

export const Playground: Story = {
  args: { priority: 1 },
  argTypes: { priority: { control: "inline-radio", options: [1, 2, 3, 4] } },
  decorators: [(Story) => <div style={{ padding: 24 }}><Story /></div>],
};
