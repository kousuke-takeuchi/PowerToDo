import type React from "react";
import { Check } from "lucide-react";

export type OsNotificationProps = { title: string; sub: string };

/*
 * D-08b: OS 通知のモック (1440x900 の暗い背景 + 右上のバナー 360)。
 * OS 側の見た目をなぞるだけなので、アプリのトークンではなく pen と同じ固定色を使う
 * (hex を直接書いてよいのはこのコンポーネントだけ。ダークでも同じ色のまま)。
 */
const BG = "#2B2F3A";
const BANNER_BG = "#F5F5F7EE";
const TEXT_APP = "#6E6E73";
const TEXT_TITLE = "#1D1D1F";
const TEXT_SUB = "#3A3A3C";
const BTN_BG = "#FFFFFF";

const actionButton: React.CSSProperties = {
  padding: "4px 10px",
  border: 0,
  borderRadius: 6,
  background: BTN_BG,
  color: TEXT_TITLE,
  fontFamily: "var(--font-body)",
  fontSize: 12,
  lineHeight: "17px",
  cursor: "pointer",
};

export function OsNotification({ title, sub }: OsNotificationProps) {
  return (
    <div
      style={{
        width: 1440,
        height: 900,
        boxSizing: "border-box",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        background: BG,
        fontFamily: "var(--font-body)",
      }}
    >
      <div
        role="alert"
        style={{
          width: 360,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "12px 14px",
          background: BANNER_BG,
          borderRadius: 14,
          boxShadow: "0 6px 20px #00000044",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 40,
            height: 40,
            flex: "0 0 auto",
            display: "grid",
            placeItems: "center",
            borderRadius: 10,
            background: "var(--color-accent)",
            color: "#FFFFFF",
          }}
        >
          <Check size={22} />
        </span>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 11, lineHeight: "16px", color: TEXT_APP }}>PowerToDo · 今</span>
          <span style={{ fontSize: 13, lineHeight: "19px", fontWeight: 600, color: TEXT_TITLE }}>{title}</span>
          <span style={{ fontSize: 12, lineHeight: "17px", color: TEXT_SUB }}>{sub}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button type="button" style={actionButton}>
            完了
          </button>
          <button type="button" style={actionButton}>
            後で
          </button>
        </div>
      </div>
    </div>
  );
}
