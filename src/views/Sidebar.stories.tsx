import type { Meta, StoryObj } from "@storybook/react-vite";
import { counts } from "../mock/data";
import { Sidebar } from "./Sidebar";

const projects = [
  { name: "受信トレイ", color: "var(--color-text-muted)", order: 0, favorite: false, inbox: true },
  { name: "仕事", color: "var(--color-priority-3)", order: 1, favorite: true, inbox: false },
  { name: "買い物", color: "var(--color-success)", order: 2, favorite: false, inbox: false },
  { name: "去年の旅行", color: "var(--color-priority-2)", order: 3, favorite: false, inbox: false, archived: true },
  { name: "引っ越し", color: "var(--color-priority-4)", order: 4, favorite: false, inbox: false, archived: true },
];

const meta = {
  title: "Views/Sidebar",
  component: Sidebar,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ width: 280, height: 720 }}>
        <Story />
      </div>
    ),
  ],
  args: { active: { kind: "project", name: "仕事" }, counts, projects, syncState: "synced", lastSyncedAt: "09:41" },
} satisfies Meta<typeof Sidebar>;
export default meta;
type Story = StoryObj<typeof meta>;

/** 末尾に折りたたんだ「アーカイブ済み (2)」。 */
export const アーカイブ済み_折りたたみ: Story = {};
export const アーカイブ済み_開いた: Story = { args: { initialArchivedOpen: true } };
/** アーカイブ済みを開いているとき: その欄が開いて選択される。 */
export const アーカイブ済みを表示中: Story = { args: { active: { kind: "project", name: "引っ越し" } } };
