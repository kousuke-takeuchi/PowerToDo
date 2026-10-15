import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { DateTimePane, NotificationsPane } from "./SettingsPanes";
import type { DateTimePaneProps, NotificationsPaneProps } from "./SettingsPanes";

const frame = (node: React.ReactNode) => (
  <div style={{ width: 440, padding: 20, background: "var(--color-bg)", fontFamily: "var(--font-body)", color: "var(--color-text-primary)" }}>{node}</div>
);

const meta = {
  title: "Views/SettingsPanes",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Notifications(initial: Partial<NotificationsPaneProps>) {
  const [enabled, setEnabled] = useState(true);
  const [keepInTray, setKeepInTray] = useState(true);
  return frame(
    <NotificationsPane
      enabled={enabled}
      onToggle={setEnabled}
      permission="granted"
      onRequestPermission={fn()}
      keepInTray={keepInTray}
      onToggleKeepInTray={setKeepInTray}
      {...initial}
    />,
  );
}

export const 通知: Story = { render: () => <Notifications /> };
export const 通知_未許可: Story = { render: () => <Notifications permission="prompt" /> };
export const 通知_トレイを作れない: Story = { render: () => <Notifications trayError="トレイアイコンを作れませんでした: no system tray available" /> };

function DateTime(initial: Partial<DateTimePaneProps>) {
  const [defaultReminder, setDefaultReminder] = useState<string | null>("-0m");
  const [notifyTime, setNotifyTime] = useState("09:00");
  const [weekStart, setWeekStart] = useState<"mon" | "sun">("mon");
  return frame(
    <DateTimePane
      defaultReminder={defaultReminder}
      onChangeDefaultReminder={setDefaultReminder}
      notifyTime={notifyTime}
      onChangeNotifyTime={setNotifyTime}
      weekStart={weekStart}
      onChangeWeekStart={setWeekStart}
      {...initial}
    />,
  );
}

export const 日付と時刻: Story = { render: () => <DateTime /> };
export const 日付と時刻_保存エラー: Story = { render: () => <DateTime error="設定を保存できませんでした" /> };
export const 日付と時刻_一覧にないリマインダー: Story = { render: () => <DateTime defaultReminder="-2h" /> };
export const 日付と時刻_読み込み中: Story = { render: () => <DateTime loading /> };
