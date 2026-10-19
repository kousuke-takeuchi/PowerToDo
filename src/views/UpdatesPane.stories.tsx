import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { UpdatesPane } from "./UpdatesPane";

const meta = {
  title: "Views/UpdatesPane",
  component: UpdatesPane,
  parameters: { layout: "centered" },
  args: {
    status: { currentVersion: "0.1.0", support: "supported", autoCheck: true },
    onToggleAutoCheck: fn(),
    onCheck: fn(),
    onOpenReleasePage: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ width: 440, padding: 20, background: "var(--color-bg)", fontFamily: "var(--font-body)", color: "var(--color-text-primary)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UpdatesPane>;
export default meta;
type Story = StoryObj<typeof meta>;

export const 自動更新できる: Story = {};
export const 確認中: Story = { args: { checking: true } };
export const 最新です: Story = { args: { upToDate: true } };
export const 確認失敗: Story = { args: { error: "更新を確かめられませんでした (ネットワークを確かめてください)" } };
export const 開発版: Story = { args: { status: { currentVersion: "0.1.0", support: "dev", autoCheck: true } } };
export const 手動: Story = { args: { status: { currentVersion: "0.1.0", support: "manual", autoCheck: true } } };
