import type { Meta, StoryObj } from "@storybook/react-vite";
import { SyncStatus } from "./SyncStatus";
import type { SyncState } from "./SyncStatus";

const meta = { title: "Components/SyncStatus", component: SyncStatus } satisfies Meta<typeof SyncStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

const states: SyncState[] = ["synced", "syncing", "offline", "error", "off"];

export const Variants: Story = {
  args: { state: "synced" },
  render: () => (
    <div style={{ display: "flex", gap: 48, padding: 24 }}>
      <div style={{ width: 248, display: "flex", flexDirection: "column", gap: 4 }}>
        {states.map((s) => (
          <SyncStatus key={s} state={s} lastSyncedAt="09:41" />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {states.map((s) => (
          <SyncStatus key={s} state={s} lastSyncedAt="09:41" compact />
        ))}
      </div>
    </div>
  ),
};

/** 再試行では直らない同期エラー (Main が `errorText` で渡す): 止めている、ログインし直す、クリックできない。 */
export const ErrorTexts: Story = {
  args: { state: "error" },
  render: () => (
    <div style={{ width: 248, display: "flex", flexDirection: "column", gap: 4, padding: 24 }}>
      <SyncStatus state="error" onClick={() => undefined} />
      <SyncStatus state="error" errorText="同期エラー · 同期を止めています" />
      <SyncStatus state="error" errorText="同期エラー · 設定を確かめてください" />
      <SyncStatus state="error" errorText="同期エラー" />
    </div>
  ),
};

/** アプリの更新の準備中 (Main が `pausedText` で渡す): どの状態でも同じ文言で、クリックできない。 */
export const Paused: Story = {
  args: { state: "synced" },
  render: () => (
    <div style={{ width: 248, display: "flex", flexDirection: "column", gap: 4, padding: 24 }}>
      <SyncStatus state="synced" lastSyncedAt="09:41" pausedText="更新の準備中" onClick={() => undefined} />
      <SyncStatus state="syncing" pausedText="更新の準備中" />
    </div>
  ),
};

export const Playground: Story = {
  args: { state: "synced", lastSyncedAt: "09:41", compact: false },
  argTypes: { state: { control: "inline-radio", options: states } },
  decorators: [(Story) => <div style={{ width: 248, padding: 24 }}><Story /></div>],
};
