import type React from "react";
import { CalendarCheck, CalendarDays, List, Search } from "lucide-react";

export type TabBarProps = {
  active?: "today" | "upcoming" | "search" | "list";
  onChange?: (t: NonNullable<TabBarProps["active"]>) => void;
}; // 56 + ホームインジケータ 34

const tabs: { id: NonNullable<TabBarProps["active"]>; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "today", label: "今日", Icon: CalendarCheck },
  { id: "upcoming", label: "近日", Icon: CalendarDays },
  { id: "search", label: "検索", Icon: Search },
  { id: "list", label: "一覧", Icon: List },
];

/** モバイルの下部タブ (pen の TabBar: Tabs 56 + HomeIndicator 34、上に 1px の線)。 */
export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav
      aria-label="タブ"
      style={{
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-bg)",
        boxShadow: "inset 0 1px 0 var(--color-border)", // pen の stroke は内側 (高さに加算しない)
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ height: 56, display: "flex", justifyContent: "space-around", alignItems: "center" }}>
        {tabs.map(({ id, label, Icon }) => {
          const on = id === active;
          return (
            <button
              key={id}
              type="button"
              aria-current={on ? "page" : undefined}
              onClick={() => onChange?.(id)}
              style={{
                width: 80,
                height: 38,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                padding: 0,
                border: 0,
                background: "none",
                fontFamily: "var(--font-body)",
                color: on ? "var(--color-accent)" : "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >
              <Icon size={22} />
              <span style={{ fontSize: 10, lineHeight: "14px" }}>{label}</span>
            </button>
          );
        })}
      </div>
      <div aria-hidden style={{ height: 34, display: "flex", justifyContent: "center", alignItems: "center" }}>
        <div style={{ width: 134, height: 5, borderRadius: 3, background: "var(--color-text-primary)" }} />
      </div>
    </nav>
  );
}
