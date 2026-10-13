import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { TabBar } from "./TabBar";
import type { TabBarProps } from "./TabBar";

const meta = { title: "Components/TabBar", component: TabBar } satisfies Meta<typeof TabBar>;
export default meta;
type Story = StoryObj<typeof meta>;

// 4 つの選択状態 + 選択なし (TabBar は状態を持たないので、ここは固定表示)。
export const Variants: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24, width: 390 }}>
      <TabBar active="today" />
      <TabBar active="upcoming" />
      <TabBar active="search" />
      <TabBar active="list" />
      <TabBar />
    </div>
  ),
};

function PlaygroundTabBar() {
  const [active, setActive] = useState<TabBarProps["active"]>("today");
  return (
    <div style={{ padding: 24, width: 390 }}>
      <TabBar active={active} onChange={setActive} />
    </div>
  );
}

// タップで選択が動く (選択中のタブは Story 側で持つ)。
export const Playground: Story = {
  render: () => <PlaygroundTabBar />,
};
