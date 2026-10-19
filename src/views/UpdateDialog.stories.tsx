import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { UpdateDialog } from "./UpdateDialog";

const NOTES = `## 変更点
- 更新の確認とインストールをアプリの中でできるようになりました
- 同期中に更新を始めても、同期が終わってから入れ替えます

## 修正
- 長いタスク名が詳細パネルからはみ出す問題を直しました`;

const meta = {
  title: "Views/UpdateDialog",
  component: UpdateDialog,
  parameters: { layout: "fullscreen" },
  args: { open: true, currentVersion: "0.1.0", version: "0.2.0", notes: NOTES, windows: false, onInstall: fn(), onClose: fn() },
  // 親が位置を持つ要素の中に全面を覆って出る (アプリでは AppShell の overlay)。
  decorators: [
    (Story) => (
      <div style={{ position: "relative", width: 1000, height: 640, background: "var(--color-bg)", fontFamily: "var(--font-body)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UpdateDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const 新しい版: Story = {};
export const 新しい版_Windows: Story = { args: { windows: true } };
export const 同期待ち: Story = { args: { installing: true, progress: { phase: "waitingSync" } } };
export const ダウンロード中: Story = { args: { installing: true, progress: { phase: "downloading", received: 14_200_000, total: 38_000_000 } } };
export const ダウンロード中_総量不明: Story = { args: { installing: true, progress: { phase: "downloading", received: 14_200_000 } } };
export const 入れ替え中: Story = { args: { installing: true, progress: { phase: "installing" } } };
/** Rust の文 (update.rs の MSG_UNSAVED) をそのまま出し、「データはそのままです」を添える。 */
export const 失敗: Story = {
  args: { error: "保存できていない変更があるため、更新を中止しました。保存を確かめてからもう一度お試しください" },
};
/** この文は「データはそのままです」を含むので、重ねて添えない。 */
export const 失敗_ダウンロード: Story = { args: { error: "更新のダウンロードに失敗しました。データはそのままです" } };
