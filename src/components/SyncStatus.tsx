import type React from "react";
import { CircleCheck, CloudOff, LoaderCircle, TriangleAlert } from "lucide-react";

export type SyncState = "syncing" | "synced" | "offline" | "error" | "off";
export type SyncStatusProps = {
  state: SyncState;
  lastSyncedAt?: string;
  compact?: boolean;
  onClick?: () => void;
  /** 補足 (エラーの理由など)。ツールチップに出す。 */
  detail?: string;
  /** 「同期オフ」の文言。既定は「同期オフ · 未ログイン」 (絵コンテ)。 */
  offText?: string;
};

type Def = {
  Icon: React.ComponentType<{ size?: number }>;
  iconColor: string;
  textColor: string;
  text: (t?: string) => string;
  spin?: boolean;
};

const defs: Record<SyncState, Def> = {
  synced: { Icon: CircleCheck, iconColor: "var(--color-success)", textColor: "var(--color-text-secondary)", text: (t) => (t ? `同期済み ${t}` : "同期済み") },
  syncing: { Icon: LoaderCircle, iconColor: "var(--color-text-secondary)", textColor: "var(--color-text-secondary)", text: () => "同期中…", spin: true },
  offline: { Icon: CloudOff, iconColor: "var(--color-text-secondary)", textColor: "var(--color-text-secondary)", text: (t) => (t ? `オフライン · 最終同期 ${t}` : "オフライン") },
  error: { Icon: TriangleAlert, iconColor: "var(--color-danger)", textColor: "var(--color-danger)", text: () => "同期エラー · クリックで再試行" },
  off: { Icon: CloudOff, iconColor: "var(--color-text-muted)", textColor: "var(--color-text-secondary)", text: () => "同期オフ · 未ログイン" },
};

export function SyncStatus({ state, lastSyncedAt, compact, onClick, detail, offText }: SyncStatusProps) {
  const d = defs[state];
  const text = state === "off" && offText ? offText : d.text(lastSyncedAt);
  const icon = (
    <span
      style={{
        display: "inline-flex",
        color: d.iconColor,
        flex: "0 0 auto",
        animation: d.spin ? "spin 1s linear infinite" : undefined,
      }}
    >
      <d.Icon size={compact ? 16 : 14} />
    </span>
  );
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={compact ? text : undefined}
      title={detail ? `${text}\n${detail}` : compact ? text : undefined}
      className="bg-transparent hover:bg-[var(--color-bg-hover)]"
      style={
        compact
          ? {
              width: 32,
              height: 32,
              display: "grid",
              placeItems: "center",
              padding: 0,
              borderRadius: 6,
              border: 0,
              cursor: "pointer",
            }
          : {
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              padding: "6px 10px",
              borderRadius: 6,
              border: 0,
              fontFamily: "var(--font-body)",
              textAlign: "left",
              cursor: "pointer",
            }
      }
    >
      {icon}
      {!compact && <span aria-live="polite" style={{ fontSize: 12, lineHeight: "17px", color: d.textColor }}>{text}</span>}
    </button>
  );
}
