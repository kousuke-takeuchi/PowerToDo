import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { HeaderActions } from "./HeaderActions";
import { projectMenuEntries, type ProjectMenuActions } from "./projectMenu";

const actions: ProjectMenuActions = {
  edit: fn(),
  toggleFavorite: fn(),
  addSection: fn(),
  openFile: fn(),
  revealFile: fn(),
  archive: fn(),
  delete: fn(),
};

const meta = {
  title: "Views/HeaderActions",
  component: HeaderActions,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ display: "flex", justifyContent: "flex-end", padding: 16, minHeight: 320 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HeaderActions>;
export default meta;
type Story = StoryObj<typeof meta>;

/** プロジェクトの「…」: 編集 / お気に入り / セクションを追加 / データを管理 › / アーカイブ / 削除。 */
export const プロジェクト: Story = {
  args: { initialMenuOpen: true, onMenu: projectMenuEntries({ inbox: false, favorite: false, os: "macos", actions }) },
};
export const お気に入り済み: Story = {
  args: { initialMenuOpen: true, onMenu: projectMenuEntries({ inbox: false, favorite: true, os: "macos", actions }) },
};
export const 受信トレイ: Story = {
  args: { initialMenuOpen: true, onMenu: projectMenuEntries({ inbox: true, favorite: false, os: "macos", actions }) },
};
export const アーカイブ済み: Story = {
  args: { initialMenuOpen: true, onRestore: fn(), onMenu: projectMenuEntries({ inbox: false, archived: true, favorite: false, os: "windows", actions }) },
};
/** 今日・近日・ラベル: メニューを渡さないので「…」のボタンは出ない。 */
export const 今日_近日_ラベル: Story = {};
