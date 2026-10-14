import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ExternalChangeBanner } from "./ExternalChangeBanner";

const meta = {
  title: "Views/ExternalChangeBanner",
  component: ExternalChangeBanner,
  parameters: { layout: "fullscreen" },
  args: { fileName: "受信トレイ.xlsx", onReload: fn(), onOverwrite: fn() },
} satisfies Meta<typeof ExternalChangeBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Project: Story = {};

export const Common: Story = { args: { fileName: "共通設定 (_PowerToDo.xlsx)" } };
