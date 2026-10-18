import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { counts, projects, sections, tasks } from "../mock/data";
import { googleLoggedIn, googleLoggedOut, googleUnavailable, nasConnected, nasUnconnected, syncStatuses, tailnets } from "../mock/sync";
import { AppShell } from "./AppShell";
import { ProjectView } from "./ProjectView";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar } from "./Sidebar";
import { SyncPane } from "./SyncPane";
import type { SyncPaneProps } from "./SyncPane";

const handlers = {
  onChangeBackend: fn(),
  onLogin: fn(),
  onOpenLoginUrl: fn(),
  onRetry: fn(),
  onReset: fn(),
  onLogout: fn(),
  onCheck: fn(async () => false),
  onDisconnect: fn(),
  onSyncNow: fn(),
  onRecover: fn(),
  onOpenGuide: fn(),
  onGoogleLogin: fn(async () => false),
  onGoogleCancel: fn(),
  onGoogleLogout: fn(),
};

const base: SyncPaneProps = { settings: nasUnconnected, status: syncStatuses.off, tailnet: tailnets.stopped, tailnetSecs: 0, ...handlers };

// 設定ダイアログの右側と同じ幅 (760 - 180 - 余白 48)
const frame = (node: React.ReactNode) => (
  <div style={{ width: 532, padding: 24, display: "flex", flexDirection: "column", gap: 16, background: "var(--color-bg)", fontFamily: "var(--font-body)", color: "var(--color-text-primary)" }}>
    {node}
  </div>
);

const meta = {
  title: "Views/SyncPane",
  parameters: { layout: "centered" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const pane = (over: Partial<SyncPaneProps>): Story => ({ render: () => frame(<SyncPane {...base} {...over} />) });

// ---- Synology NAS: 接続前 (D-09e) ----
export const NAS_ログイン前: Story = pane({});
export const NAS_ログインが必要: Story = pane({ tailnet: tailnets.needsLogin });
export const NAS_ブラウザでログイン中: Story = pane({ tailnet: tailnets.needsLoginUrl });
export const NAS_承認待ち: Story = pane({ tailnet: tailnets.needsApproval });
export const NAS_起動中: Story = pane({ tailnet: tailnets.starting, tailnetSecs: 8 });
export const NAS_起動中_30秒超: Story = pane({ tailnet: tailnets.starting, tailnetSecs: 34 });
export const NAS_Tailscale失敗: Story = pane({ tailnet: tailnets.failed });
export const NAS_Tailscale接続済み_確かめる前: Story = pane({ tailnet: tailnets.running, settings: { ...nasUnconnected, nasUrl: "http://nas:5005/PowerToDo/", nasUser: "たろう" } });
export const NAS_確かめるに失敗: Story = pane({
  tailnet: tailnets.running,
  checkError: "NAS のユーザー名かパスワードが違います",
});
export const NAS_確かめている: Story = pane({ tailnet: tailnets.running, busy: "check" });
export const NAS_パスワードを保存できない: Story = pane({ settings: { ...nasUnconnected, passwordPersistent: false } });

// ---- Synology NAS: 接続済み (D-09f) ----
const connected: Partial<SyncPaneProps> = { settings: nasConnected, tailnet: tailnets.running, status: syncStatuses.synced };
export const NAS_接続済み: Story = pane(connected);
export const NAS_接続済み_同期中: Story = pane({ ...connected, status: syncStatuses.syncing });
export const NAS_接続済み_オフライン: Story = pane({ ...connected, status: syncStatuses.offline, tailnet: tailnets.starting, tailnetSecs: 41 });
export const NAS_接続済み_名前の重なり: Story = pane({ ...connected, status: syncStatuses.nameClash });
export const NAS_接続済み_認証エラー: Story = pane({ ...connected, status: syncStatuses.authRejected });
export const NAS_接続済み_パスワードを保存できない: Story = pane({ ...connected, settings: { ...nasConnected, passwordPersistent: false } });
export const NAS_接続済み_同期に失敗: Story = pane({ ...connected, error: "同期を開始できませんでした" });

// ---- 片方が空に見える ----
export const 食い違い_この_PC: Story = pane({ ...connected, status: syncStatuses.suspectLocal });
export const 食い違い_NAS: Story = pane({ ...connected, status: syncStatuses.suspectRemote, recoverError: "同期の状態が変わったため、実行しませんでした。もう一度確かめてください" });

// ---- Google Drive: 未ログイン (D-09) ----
const google: Partial<SyncPaneProps> = { settings: googleLoggedOut, status: syncStatuses.off, tailnet: null };
export const Google_未ログイン: Story = pane(google);
export const Google_ブラウザの待ち: Story = pane({ ...google, busy: "googleLogin" });
export const Google_ログインをキャンセルした: Story = pane({ ...google, googleNote: "ログインをキャンセルしました" });
export const Google_許可しなかった: Story = pane({ ...google, googleNote: "Google でのログインが許可されなかったため、ログインしませんでした" });
export const Google_ログインに失敗: Story = pane({ ...google, error: "ログインがタイムアウトしました。もう一度お試しください" });
export const Google_このビルドでは使えない: Story = pane({ settings: googleUnavailable, status: syncStatuses.off, tailnet: null });

// ---- Google Drive: ログイン済み (D-09c) ----
const googleIn: Partial<SyncPaneProps> = { settings: googleLoggedIn, status: syncStatuses.synced, tailnet: null };
export const Google_ログイン済み: Story = pane(googleIn);
export const Google_ログイン済み_同期中: Story = pane({ ...googleIn, status: syncStatuses.syncing });
export const Google_ログイン済み_オフライン: Story = pane({ ...googleIn, status: { ...syncStatuses.offline, message: "接続できません: Google に接続できません" } });
// 名前の重なりや容量不足は、ログインし直しでは直らない: 「ログインし直す」を出さない
export const Google_ログイン済み_名前の重なり: Story = pane({ ...googleIn, status: syncStatuses.nameClash });
export const Google_ログイン済み_容量不足: Story = pane({ ...googleIn, status: syncStatuses.quotaFull });
export const Google_ログインが無効になった: Story = pane({ ...googleIn, status: syncStatuses.googleAuthRejected });
export const Google_ログインし直している: Story = pane({ ...googleIn, status: syncStatuses.googleAuthRejected, busy: "googleLogin" });
export const Google_ログイン情報を保存できない: Story = pane({ ...googleIn, settings: { ...googleLoggedIn, googleTokenPersistent: false } });
export const Google_ログアウトで取り消せなかった: Story = pane({
  ...google,
  googleNote: "ログアウトしました。ただし Google に接続できず、Google 側のログインは取り消せていません。つながるときに Google アカウントの設定で、PowerToDo のアクセスを取り消してください",
});
export const Google_食い違い_Drive: Story = pane({ ...googleIn, status: syncStatuses.suspectRemote });

// ---- 他の同期先 ----
export const 同期しない: Story = pane({ settings: { ...nasUnconnected, backend: "none" }, status: syncStatuses.off, tailnet: tailnets.stopped });
export const 読み込み中: Story = pane({ settings: null, status: null, tailnet: null });

// ---- 設定ダイアログの中 (高さ・スクロールの確認用) ----
function InDialog(props: Partial<SyncPaneProps>) {
  const [open, setOpen] = useState(true);
  return (
    <AppShell
      sidebar={<Sidebar active={{ kind: "project", name: "買い物" }} counts={counts} projects={projects} syncState="off" onOpenSettings={() => setOpen(true)} />}
      syncState="off"
      overlay={<SettingsDialog open={open} onClose={() => setOpen(false)} syncPane={{ ...base, ...props }} />}
    >
      <ProjectView project="買い物" tasks={tasks.filter((t) => t.no !== 8)} sections={sections} />
    </AppShell>
  );
}
export const ダイアログ内_NAS_ログイン前: Story = { render: () => <InDialog /> };
export const ダイアログ内_NAS_起動中_30秒超: Story = { render: () => <InDialog tailnet={tailnets.starting} tailnetSecs={34} checkError="NAS が tailnet にありません" /> };
export const ダイアログ内_NAS_接続済み: Story = { render: () => <InDialog {...connected} /> };
export const ダイアログ内_Google_未ログイン: Story = { render: () => <InDialog {...google} /> };
export const ダイアログ内_Google_ログイン済み: Story = { render: () => <InDialog {...googleIn} /> };
