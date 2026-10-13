import type { Meta, StoryObj } from "@storybook/react-vite";
import { Ellipsis } from "lucide-react";
import { Button } from "./Button";
import { SectionHeader } from "./SectionHeader";

const meta = {
  title: "Components/SectionHeader",
  component: SectionHeader,
  decorators: [(Story) => <div style={{ width: 800, padding: 24 }}><Story /></div>],
} satisfies Meta<typeof SectionHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  args: { title: "今週" },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionHeader title="今週" count={3} />
      <SectionHeader title="今週" count={3} collapsed />
      <SectionHeader title="今日" count={5} showChevron={false} />
      <SectionHeader title="今週" count={3} trailing={<Button variant="icon" icon={Ellipsis} ariaLabel="その他" />} />
    </div>
  ),
};

export const Playground: Story = {
  args: { title: "今週", count: 3, collapsed: false, showChevron: true },
  argTypes: { trailing: { control: false } },
};
