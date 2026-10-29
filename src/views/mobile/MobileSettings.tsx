import type React from "react";
import { Bell, Calendar, ChevronRight, Cloud, Clock3, Folder, Palette, RefreshCw, User } from "lucide-react";
import { NarrowContext } from "../../components/NarrowContext";
import { Button } from "../../components/Button";
import { Segmented } from "../../components/Segmented";
import type { MobileTab } from "../../app/mobileNav";
import type { NotificationPermission } from "../../types/model";
import { AccountPane, Desc, Row, Section } from "../SettingsPanes";
import type { AccountPaneProps } from "../SettingsPanes";
import { SyncPane } from "../SyncPane";
import type { SyncPaneProps } from "../SyncPane";
import { MobileShell } from "./MobileShell";

type Icon = React.ComponentType<{ size?: number }>;
type Item = { icon: Icon; key: string; value: string };
type Group = { title: string; items: Item[] };

const groups: Group[] = [
  {
    title: "同期",
    items: [
      { icon: Cloud, key: "同期先", value: "Google Drive" },
      { icon: Cloud, key: "Google Drive", value: "接続済み" },
      { icon: RefreshCw, key: "最終同期", value: "09:41" },
      { icon: Folder, key: "Drive フォルダ", value: "PowerToDo/" },
    ],
  },
  {
    title: "通知",
    items: [
      { icon: Bell, key: "リマインダー", value: "許可" },
      { icon: Clock3, key: "既定のリマインダー", value: "期限と同時刻" },
    ],
  },
  {
    title: "外観",
    items: [
      { icon: Palette, key: "テーマ", value: "システム" },
      { icon: Calendar, key: "週の開始", value: "月曜" },
    ],
  },
  { title: "アカウント", items: [{ icon: User, key: "表示名", value: "たろう" }] },
];

/** 「通知が拒否されている」ときの案内 (仕様 §5)。 */
export const NOTIFICATION_DENIED_TEXT = "iPhone の『設定』→ PowerToDo → 通知 で許可してください";
/** 「ファイル」アプリの案内の既定。 */
export const DATA_DIR_HINT = "「ファイル」アプリの「このiPhone内 → PowerToDo」にあります。Excel で直した内容は、アプリに戻ると反映されます";

export type MobileSettingsProps = {
  /** 同期ペインの props (SyncPane をそのまま、縦長の幅 narrow で出す)。 */
  sync?: SyncPaneProps;
  /** 通知。permission は OS の許可 (denied のときは設定アプリへの案内、prompt のときは「通知を許可」)。 */
  notifications?: { enabled: boolean; permission: NotificationPermission; loading?: boolean; busy?: boolean; error?: string | null };
  onToggleNotifications?: (enabled: boolean) => void;
  onRequestPermission?: () => void;
  /** 表示名 (AccountPane と同じ: 保存済みの値と保存)。 */
  displayName?: AccountPaneProps["displayName"];
  onDisplayName?: AccountPaneProps["onSaveDisplayName"];
  displayNameBusy?: boolean;
  displayNameError?: string | null;
  /** 「ファイル」アプリの案内。 */
  dataDirHint?: string;
  /** 実機: 戻る (ヘッダーの左を戻るにする)。省略すると M-07 の絵のままメニュー。 */
  onBack?: () => void;
  fill?: boolean;
  banner?: React.ReactNode;
  overlay?: React.ReactNode;
  onTabChange?: (t: MobileTab) => void;
  today?: string;
};

const ON_OFF = [
  { value: "on", label: "オン" },
  { value: "off", label: "オフ" },
] as const;

/** M-07: 設定。同期 / 通知 / 外観 / アカウントのグループ (行 44)。ヘッダーの同期アイコンは cloud-off (オフラインの例)。タブは選択なし。 */
export function MobileSettings(props: MobileSettingsProps = {}) {
  const { sync, notifications, onToggleNotifications, onRequestPermission, displayName, onDisplayName, displayNameBusy, displayNameError, dataDirHint, onBack, fill, banner, overlay, onTabChange, today } = props;
  // どれかの props があれば実データの画面 (SyncPane などの部品を縦長の幅で並べる)。無ければ Phase 0 の絵のまま。
  const live = !!(sync || notifications || onDisplayName || dataDirHint);
  return (
    <MobileShell
      fill={fill}
      banner={banner}
      overlay={overlay}
      title="設定"
      onBack={onBack}
      tab="browse"
      today={today}
      onTabChange={onTabChange}
    >
      {live ? (
        <NarrowContext.Provider value>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", padding: "var(--space-4) 16px var(--space-6)" }}>
            {sync && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                <SyncPane {...sync} narrow />
              </div>
            )}
            {notifications && (
              <Section label="通知">
                <Segmented
                  options={[...ON_OFF]}
                  value={notifications.enabled ? "on" : "off"}
                  onChange={(v) => !notifications.busy && onToggleNotifications?.(v === "on")}
                  ariaLabel="通知"
                  disabled={notifications.loading}
                />
                <Desc>リマインダーの時刻になると通知を出します。オフでもアプリ内の帯は出ます。</Desc>
                {notifications.permission === "denied" && <div role="status" style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-danger)" }}>{NOTIFICATION_DENIED_TEXT}</div>}
                {notifications.permission === "prompt" && (
                  <Row>
                    <Button variant="secondary" onClick={onRequestPermission}>
                      通知を許可
                    </Button>
                  </Row>
                )}
                {notifications.error && <div role="alert" style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-danger)" }}>{notifications.error}</div>}
              </Section>
            )}
            {onDisplayName && <AccountPane displayName={displayName} onSaveDisplayName={onDisplayName} busy={displayNameBusy} error={displayNameError} />}
            {dataDirHint && (
              <Section label="ファイル">
                <Desc>{dataDirHint}</Desc>
              </Section>
            )}
          </div>
        </NarrowContext.Provider>
      ) : (
      <div style={{ padding: "0 16px" }}>
        {groups.map((g) => (
          <section key={g.title} style={{ paddingTop: 12 }}>
            <h2 style={{ margin: 0, fontSize: 12, lineHeight: "17px", fontWeight: 700, color: "var(--color-text-secondary)" }}>{g.title}</h2>
            {g.items.map(({ icon: Icon, key, value }) => (
              <button
                key={key}
                type="button"
                className="bg-transparent hover:bg-[var(--color-bg-hover)]"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  height: 44,
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  padding: "12px 0",
                  border: 0,
                  boxShadow: "inset 0 -1px 0 var(--color-border)",
                  fontFamily: "var(--font-body)",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ display: "inline-flex", color: "var(--color-text-secondary)", flex: "0 0 auto" }}>
                  <Icon size={18} />
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: "20px", color: "var(--color-text-primary)" }}>{key}</span>
                <span style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>{value}</span>
                <span style={{ display: "inline-flex", color: "var(--color-text-muted)", flex: "0 0 auto" }}>
                  <ChevronRight size={16} />
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>
      )}
    </MobileShell>
  );
}
