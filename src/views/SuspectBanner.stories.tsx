import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { SuspectBanner } from "./SuspectBanner";

const meta = {
  title: "Views/SuspectBanner",
  component: SuspectBanner,
  parameters: { layout: "fullscreen" },
  args: { side: "local", target: "NAS", onRecover: fn() },
} satisfies Meta<typeof SuspectBanner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const この_PC_が空に見える: Story = {};
export const NAS_が空に見える: Story = { args: { side: "remote" } };
export const 戻せなかった: Story = { args: { error: "同期の状態が変わったため、実行しませんでした。もう一度確かめてください" } };
export const 戻している: Story = { args: { busy: true } };
