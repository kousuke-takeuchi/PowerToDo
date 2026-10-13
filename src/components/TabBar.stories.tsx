import type { Meta, StoryObj } from "@storybook/react-vite";
import { TabBar } from "./TabBar";

const meta = { title: "Components/TabBar", component: TabBar } satisfies Meta<typeof TabBar>;
export default meta;
type Story = StoryObj<typeof meta>;

// 4 つの選択状態 + 選択なし。タップで選択が動く (見た目だけ)。
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
