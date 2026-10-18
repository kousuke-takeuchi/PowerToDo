import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { googleLoggedIn, googleLoggedOut, googleUnavailable, nasUnconnected, syncStatuses, tailnets } from "../mock/sync";
import { Onboarding } from "./Onboarding";
import type { SyncPaneProps } from "./SyncPane";

// 実アプリの初回起動 step 2 (src/app/OnboardingSync.tsx) と同じ props で、Tauri を呼ばずに描く
const live: SyncPaneProps = {
  settings: { ...nasUnconnected, backend: "none" },
  status: syncStatuses.off,
  tailnet: tailnets.stopped,
  onChangeBackend: fn(),
  onLogin: fn(),
  onOpenLoginUrl: fn(),
  onRetry: fn(),
  onReset: fn(),
  onCheck: fn(async () => false),
  onGoogleLogin: fn(async () => false),
  onGoogleCancel: fn(),
};

const meta = {
  title: "Views/Onboarding",
  parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const step2 = (over: Partial<SyncPaneProps>): Story => ({
  render: () => <Onboarding step={2} fill syncPane={{ ...live, ...over }} onSyncDone={fn()} onSkip={fn()} />,
});

export const 実データ_同期しない: Story = step2({});
export const 実データ_NAS_ログイン前: Story = step2({ settings: nasUnconnected });
export const 実データ_NAS_起動中: Story = step2({ settings: nasUnconnected, tailnet: tailnets.starting, tailnetSecs: 12 });
export const 実データ_NAS_確かめるに失敗: Story = step2({ settings: nasUnconnected, tailnet: tailnets.running, checkError: "NAS が tailnet にありません" });
export const 実データ_Google_未ログイン: Story = step2({ settings: googleLoggedOut });
export const 実データ_Google_ブラウザの待ち: Story = step2({ settings: googleLoggedOut, busy: "googleLogin" });
export const 実データ_Google_ログイン済み: Story = step2({ settings: googleLoggedIn, status: syncStatuses.synced });
export const 実データ_Google_このビルドでは使えない: Story = step2({ settings: { ...googleUnavailable, backend: "none" } });
