import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { MobileTab } from "../app/mobileNav";
import { TabBar } from "./TabBar";

const meta = { title: "Components/TabBar", component: TabBar } satisfies Meta<typeof TabBar>;
export default meta;
type Story = StoryObj<typeof meta>;

// 4 つの選択状態 + 選択なし (TabBar は状態を持たないので、ここは固定表示)。
export const Variants: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, width: 390 }}>
      {(["inbox", "today", "upcoming", "browse", undefined] as const).map((a) => (
        <div key={a ?? "none"} style={{ padding: "16px 28px" }}>
          <TabBar active={a} day={26} />
        </div>
      ))}
    </div>
  ),
};

function PlaygroundTabBar() {
  const [active, setActive] = useState<MobileTab | undefined>("today");
  return (
    <div style={{ padding: "24px 28px", width: 390 }}>
      <TabBar active={active} onChange={setActive} day={26} />
    </div>
  );
}

// タップで選択が動く (選択中のタブは Story 側で持つ)。
export const Playground: Story = {
  render: () => <PlaygroundTabBar />,
};
