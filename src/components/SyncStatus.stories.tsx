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

export const Playground: Story = {
  args: { state: "synced", lastSyncedAt: "09:41", compact: false },
  argTypes: { state: { control: "inline-radio", options: states } },
  decorators: [(Story) => <div style={{ width: 248, padding: 24 }}><Story /></div>],
};
