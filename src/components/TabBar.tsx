import type React from "react";
import { Calendar, CalendarDays, Inbox, LayoutGrid } from "lucide-react";
import type { MobileTab } from "../app/mobileNav";
import { Glass } from "./Glass";

/** Spec ④ iPhone §3.1: one floating glass pill, 28 from the sides, 58 high, 23 above the screen's bottom edge. */
export const TAB_BAR = { side: 28, height: 58, bottom: 23 } as const;

export type TabBarProps = {
  active?: MobileTab;
  onChange?: (t: MobileTab) => void;
  /** The day of the month on the 今日 icon. */
  day?: number;
};

function TodayIcon({ day }: { day: number }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", width: 22, height: 22 }}>
      <Calendar size={22} />
      <span aria-hidden style={{ position: "absolute", left: 0, right: 0, top: 9, textAlign: "center", fontSize: 9, lineHeight: "11px", fontWeight: 700 }}>
        {day}
      </span>
    </span>
  );
}

const tabs: { id: MobileTab; label: string; Icon?: React.ComponentType<{ size?: number }> }[] = [
  { id: "inbox", label: "受信トレイ", Icon: Inbox },
  { id: "today", label: "今日" },
  { id: "upcoming", label: "近日", Icon: CalendarDays },
  { id: "browse", label: "閲覧", Icon: LayoutGrid },
];

/** The tab pill. The caller places it (MobileShell: absolute, TAB_BAR from the edges). Stateless (active + onChange). */
export function TabBar({ active, onChange, day = new Date().getDate() }: TabBarProps) {
  return (
    <Glass
      role="navigation"
      aria-label="タブ"
      radius={TAB_BAR.height / 2}
      style={{ height: TAB_BAR.height, boxSizing: "border-box", display: "flex", alignItems: "stretch", padding: 4, fontFamily: "var(--font-body)" }}
    >
      {tabs.map(({ id, label, Icon }) => {
        const on = id === active;
        return (
          <button
            key={id}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => onChange?.(id)}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              padding: 0,
              border: 0,
              borderRadius: (TAB_BAR.height - 8) / 2,
              background: on ? "var(--color-bg-hover)" : "none",
              fontFamily: "var(--font-body)",
              color: on ? "var(--color-accent)" : "var(--color-text-primary)",
              cursor: "pointer",
            }}
          >
            {Icon ? <Icon size={22} /> : <TodayIcon day={day} />}
            <span style={{ fontSize: 10, lineHeight: "12px", whiteSpace: "nowrap" }}>{label}</span>
          </button>
        );
      })}
    </Glass>
  );
}
