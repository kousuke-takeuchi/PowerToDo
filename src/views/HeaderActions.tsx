import type React from "react";
import { ArrowUpDown, Ellipsis, LayoutList } from "lucide-react";

const smallButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  padding: "4px 8px",
  border: 0,
  borderRadius: 6,
  fontFamily: "var(--font-body)",
  fontSize: 13,
  lineHeight: "19px",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

function HeaderAction({ icon: Icon, label }: { icon: React.ComponentType<{ size?: number }>; label?: string }) {
  return (
    <button type="button" aria-label={label ?? "その他"} className="bg-transparent hover:bg-[var(--color-bg-hover)]" style={smallButton}>
      <Icon size={16} />
      {label}
    </button>
  );
}

/** 画面ヘッダー右の 表示 / 並び替え / その他 (pen の HeaderActions)。 */
export function HeaderActions() {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-1)" }}>
      <HeaderAction icon={LayoutList} label="表示" />
      <HeaderAction icon={ArrowUpDown} label="並び替え" />
      <HeaderAction icon={Ellipsis} />
    </div>
  );
}

/** 画面ヘッダー (pen の Header): 左に children (タイトル群)、右に HeaderActions。 */
export function PageHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "var(--font-body)" }}>
      {children}
      <HeaderActions />
    </div>
  );
}

export const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 24,
  lineHeight: "35px",
  fontWeight: 700,
  color: "var(--color-text-primary)",
};

const subtitleStyle: React.CSSProperties = { fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" };

/** Title + Subtitle を下揃え (pen の TitleGroup, gap 12)。 */
export function TitleGroup({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
      <h1 style={titleStyle}>{title}</h1>
      <span style={subtitleStyle}>{subtitle}</span>
    </div>
  );
}
