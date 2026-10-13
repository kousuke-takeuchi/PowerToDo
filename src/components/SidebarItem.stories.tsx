import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarDays, Inbox, Sun } from "lucide-react";
import { SidebarItem } from "./SidebarItem";

const meta = {
  title: "Components/SidebarItem",
  component: SidebarItem,
  decorators: [(Story) => <div style={{ width: 248, padding: 24 }}><Story /></div>],
} satisfies Meta<typeof SidebarItem>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  args: { icon: Inbox, label: "受信トレイ" },
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <SidebarItem icon={Inbox} label="受信トレイ" count={12} />
      <SidebarItem icon={Sun} label="今日" count={5} active />
      <SidebarItem icon={CalendarDays} label="近日" />
    </div>
  ),
};

export const Playground: Story = {
  args: { icon: Inbox, label: "受信トレイ", count: 12, active: false },
  argTypes: { icon: { control: false } },
};
