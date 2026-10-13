import type { Meta, StoryObj } from "@storybook/react-vite";
import { D01, D03, D04 } from "./Desktop.stories";

// ダーク: Desktop の D-01 / D-03 / D-04 と同じ構成を、Story 単位の globals でテーマ dark に固定して出す。
// テーマは .storybook/preview.ts の decorator が globals.theme を <html data-theme> に反映する。
const meta = {
  title: "Screens/Dark",
  parameters: { layout: "fullscreen" },
  globals: { theme: "dark" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const D01Dark: Story = { ...D01, name: "D-01 プロジェクト (ダーク)" };
export const D03Dark: Story = { ...D03, name: "D-03 タスク詳細 (ダーク)" };
export const D04Dark: Story = { ...D04, name: "D-04 今日 (ダーク)" };
