// Storybook 用の同期の見本値 (実在しない名前・アドレス)。src/api は呼ばない。
import type { SyncSettingsDto, SyncStatusDto, TailnetStatus } from "../types/model";

export const nasUnconnected: SyncSettingsDto = {
  backend: "nas",
  nasPasswordSet: false,
  passwordPersistent: true,
  googleAvailable: false,
};

export const nasConnected: SyncSettingsDto = {
  backend: "nas",
  nasUrl: "http://nas:5005/PowerToDo/",
  nasUser: "たろう",
  nasPasswordSet: true,
  passwordPersistent: true,
  googleAvailable: false,
};

export const syncStatuses = {
  synced: { state: "synced", lastSynced: "2026-10-16T09:41:00", pending: 0 },
  syncing: { state: "syncing", lastSynced: "2026-10-16T09:41:00", pending: 0 },
  offline: { state: "offline", lastSynced: "2026-10-16T09:41:00", message: "NAS に接続できません (Tailscale が接続済みではありません)", pending: 0 },
  nameClash: {
    state: "error",
    lastSynced: "2026-10-16T09:41:00",
    message:
      "名前が大文字・小文字か見えない文字 (文字の符号化) の違いだけで重なっているため同期していません: P1.xlsx と p1.xlsx。どちらかの名前を変えてください",
    pending: 2,
  },
  authRejected: { state: "error", message: "NAS のユーザー名かパスワードが違います。設定を直して「確かめる」を押してください", pending: 0 },
  suspectLocal: { state: "error", message: "この PC のデータフォルダが空に見えるため同期を止めました", pending: 0, suspect: "local" },
  suspectRemote: { state: "error", message: "同期先が空に見えるため同期を止めました", pending: 0, suspect: "remote" },
  off: { state: "off", pending: 0 },
} satisfies Record<string, SyncStatusDto>;

export const tailnets = {
  stopped: { state: "stopped" },
  needsLogin: { state: "needs_login" },
  needsLoginUrl: { state: "needs_login", loginUrl: "https://login.tailscale.com/a/0123456789" },
  needsApproval: { state: "needs_approval", name: "powertodo-mac" },
  starting: { state: "starting", startedSecs: 8 },
  running: { state: "running", name: "powertodo-mac", ip: "100.64.0.12" },
  failed: { state: "failed", error: "Tailscale のコントロールサーバーに接続できません" },
} satisfies Record<string, TailnetStatus>;
