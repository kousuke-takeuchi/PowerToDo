import { useState } from "react";
import { addDays, weekdayShort } from "../mock/data";

export type WeekStripProps = {
  start: string;
  today: string;
  initialSelected?: string;
  onSelect?: (ymd: string) => void;
  /** mobile: M-05 の寸法 (上 4 / 下 8、セル角丸 8、曜日 10 / 日付 15)。 */
  variant?: "desktop" | "mobile";
};

/** 7 日分のセル (幅いっぱいに均等)。今日は accent-soft 背景 + accent の太字、クリックで選択 (見た目だけ)。 */
export function WeekStrip({ start, today, initialSelected, onSelect, variant = "desktop" }: WeekStripProps) {
  const mobile = variant === "mobile";
  const [selected, setSelected] = useState<string | undefined>(initialSelected);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div
      role="group"
      aria-label="週"
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "var(--space-1)",
        padding: mobile ? "4px 0 8px 0" : "0 0 8px 0",
        boxShadow: "inset 0 -1px 0 var(--color-border)",
        fontFamily: "var(--font-body)",
      }}
    >
      {days.map((ymd) => {
        const isToday = ymd === today;
        const isSelected = ymd === selected;
        const day = Number(ymd.split("-")[2]);
        return (
          <button
            key={ymd}
            type="button"
            aria-pressed={isSelected}
            aria-current={isToday ? "date" : undefined}
            onClick={() => {
              setSelected(ymd);
              onSelect?.(ymd);
            }}
            className={isToday ? undefined : "bg-transparent hover:bg-[var(--color-bg-hover)]"}
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              padding: "6px 0",
              border: 0,
              borderRadius: mobile ? 8 : 6,
              background: isToday ? "var(--color-accent-soft)" : undefined,
              boxShadow: isSelected ? "inset 0 0 0 1.5px var(--color-accent)" : undefined,
              fontFamily: "var(--font-body)",
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: mobile ? 10 : 11, lineHeight: mobile ? "14px" : "16px", color: "var(--color-text-secondary)" }}>{weekdayShort(ymd)}</span>
            <span
              style={{
                fontSize: mobile ? 15 : 16,
                lineHeight: mobile ? "22px" : "23px",
                fontWeight: isToday ? 700 : undefined,
                color: isToday ? "var(--color-accent)" : "var(--color-text-primary)",
              }}
            >
              {day}
            </span>
          </button>
        );
      })}
    </div>
  );
}
