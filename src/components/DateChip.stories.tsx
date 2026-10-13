import type { Meta, StoryObj } from "@storybook/react-vite";
import { DateChip } from "./DateChip";

const meta = { title: "Components/DateChip", component: DateChip } satisfies Meta<typeof DateChip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  args: { label: "今日" },
  render: () => (
    <div style={{ display: "flex", gap: 24, alignItems: "center", padding: 24 }}>
      <DateChip label="今日" tone="success" />
      <DateChip label="昨日" tone="danger" />
      <DateChip label="10/20" tone="muted" />
    </div>
  ),
};

export const Playground: Story = {
  args: { label: "今日", tone: "success" },
  argTypes: { tone: { control: "inline-radio", options: ["success", "danger", "muted"] } },
  decorators: [(Story) => <div style={{ padding: 24 }}><Story /></div>],
};
