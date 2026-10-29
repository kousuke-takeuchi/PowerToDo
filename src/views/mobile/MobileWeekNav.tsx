import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import { WeekStrip } from "../WeekStrip";
import { monthLabel, monthWeeks } from "./mobileDates";

const HEAD = ["月", "火", "水", "木", "金", "土", "日"] as const;

/** Spec ④ iPhone §3.3: 「2026年10月 >」, the week strip, and a grabber under it; pulling the grabber down (or tapping it, or the month line) opens the month grid. */
export function MobileWeekNav({ today, onSelect }: { today: string; onSelect?: (ymd: string) => void }) {
  const [open, setOpen] = useState(false);
  const pick = (ymd: string) => {
    onSelect?.(ymd);
    setOpen(false);
  };
  return (
    <div style={{ fontFamily: "var(--font-body)" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "4px 0", border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 15, lineHeight: "20px", fontWeight: 600, color: "var(--color-text-primary)", cursor: "pointer" }}
      >
        {monthLabel(today)}
        <ChevronRight size={16} aria-hidden style={{ transform: open ? "rotate(90deg)" : undefined }} />
      </button>
      {open ? (
        <div role="grid" aria-label={monthLabel(today)} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 0" }}>
          <div role="row" style={{ display: "flex" }}>
            {HEAD.map((h) => (
              <span key={h} role="columnheader" style={{ flex: 1, textAlign: "center", fontSize: 10, lineHeight: "14px", color: "var(--color-text-secondary)" }}>
                {h}
              </span>
            ))}
          </div>
          {monthWeeks(today).map((week) => (
            <div role="row" key={week[0]} style={{ display: "flex" }}>
              {week.map((ymd) => {
                const inMonth = ymd.slice(0, 7) === today.slice(0, 7);
                const isToday = ymd === today;
                return (
                  <button
                    key={ymd}
                    type="button"
                    role="gridcell"
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => pick(ymd)}
                    style={{ flex: 1, height: 36, padding: 0, border: 0, borderRadius: 8, background: isToday ? "var(--color-accent-soft)" : "none", fontFamily: "var(--font-body)", fontSize: 15, fontWeight: isToday ? 700 : 400, color: isToday ? "var(--color-accent)" : inMonth ? "var(--color-text-primary)" : "var(--color-text-muted)", cursor: "pointer" }}
                  >
                    {Number(ymd.slice(8, 10))}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <WeekStrip variant="mobile" start={today} today={today} onSelect={onSelect} />
      )}
      <motion.div
        role="button"
        tabIndex={0}
        aria-label={open ? "月の表を閉じる" : "月の表を開く"}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.2}
        onDragEnd={(_, info) => {
          if (info.offset.y > 24) setOpen(true);
          else if (info.offset.y < -24) setOpen(false);
        }}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((v) => !v);
        }}
        style={{ display: "flex", justifyContent: "center", padding: "6px 0 10px", touchAction: "none", cursor: "grab" }}
      >
        <span style={{ width: 36, height: 4, borderRadius: 2, background: "var(--color-border)" }} />
      </motion.div>
    </div>
  );
}
