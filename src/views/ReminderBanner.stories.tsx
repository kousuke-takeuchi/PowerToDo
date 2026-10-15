import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { ReminderItem } from "../types/model";
import { ReminderBanner } from "./ReminderBanner";

const items: ReminderItem[] = [
  { project: "受信トレイ", no: 12, title: "見積書を送る", code: "-10m", at: "2026-10-15T14:50", due: "2026-10-15", dueTime: "15:00" },
  { project: "週次ミーティング", no: 3, title: "資料を共有する", code: "-1d", at: "2026-10-15T09:00", due: "2026-10-16", dueTime: null },
  { project: "買い物", no: 7, title: "電池を買う", code: "-0m", at: "2026-10-15T09:00", due: null, dueTime: null },
];

const meta = {
  title: "Views/ReminderBanner",
  component: ReminderBanner,
  parameters: { layout: "fullscreen" },
  args: {
    items: items.slice(0, 1),
    today: "2026-10-15",
    notifyTime: "09:00",
    onDone: fn(),
    onSnooze: fn(),
    onOpen: fn(),
    onDismiss: fn(),
    onDismissAll: fn(),
  },
} satisfies Meta<typeof ReminderBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {};

export const Three: Story = { args: { items } };
