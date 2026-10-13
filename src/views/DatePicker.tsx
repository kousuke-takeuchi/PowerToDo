import type React from "react";
import { useState } from "react";
import { Ban, Calendar, CalendarPlus, ChevronLeft, ChevronRight, Circle, Clock3, Repeat, Sofa, Sun } from "lucide-react";
import { TextField } from "../components/TextField";
import { TODAY, addDays, dateLabel, weekdayIndex, weekdayShort } from "../mock/data";
import { PopRow, PopoverShell } from "./PopoverShell";

export type DatePickerProps = {
  value?: string;
  time?: string;
  onChange?: (v: { date?: string; time?: string }) => void;
  onOpenRecurrence?: () => void;
  /** 繰り返し行に出す現在値 (既定 "毎週土曜")。 */
  recurrenceLabel?: string;
};

const WEEKDAY_HEAD = ["月", "火", "水", "木", "金", "土", "日"] as const;

const small = (color: string, weight: number = 400): React.CSSProperties => ({ fontSize: 13, lineHeight: "19px", color, fontWeight: weight });
const valueStyle: React.CSSProperties = { fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" };

const pad = (n: number) => String(n).padStart(2, "0");
const monthStart = (ymd: string) => `${ymd.slice(0, 7)}-01`;
const daysInMonth = (ymd: string) => {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
/** 月曜始まりのグリッド (5 or 6 週)。 */
function weeksOf(ymd: string): string[][] {
  const first = monthStart(ymd);
  const offset = (weekdayIndex(first) + 6) % 7; // 月=0
  const rows = Math.ceil((offset + daysInMonth(ymd)) / 7);
  const start = addDays(first, -offset);
  return Array.from({ length: rows }, (_, r) => Array.from({ length: 7 }, (_, c) => addDays(start, r * 7 + c)));
}
const shiftMonth = (ymd: string, delta: number) => {
  const [y, m] = ymd.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}-01`;
};

/** D-07: 日付ポップオーバーの中身。選択状態は内部で持ち、onChange で通知する。 */
export function DatePicker({ value, time = "15:00", onChange, onOpenRecurrence, recurrenceLabel = "毎週土曜" }: DatePickerProps) {
  const [date, setDate] = useState<string | undefined>(value);
  const [typed, setTyped] = useState<string | null>(null);
  const [month, setMonth] = useState(monthStart(value ?? TODAY));

  const select = (d: string | undefined) => {
    setDate(d);
    setTyped(null);
    if (d) setMonth(monthStart(d));
    onChange?.({ date: d, time });
  };

  const derived = date ? `${dateLabel(date)?.label ?? date} ${time}` : "";
  const nextSaturday = addDays(TODAY, (6 - weekdayIndex(TODAY) + 7) % 7 || 7);
  const nextMonday = addDays(TODAY, ((1 - weekdayIndex(TODAY) + 7) % 7) || 7);
  const picks: { key: string; icon: React.ReactNode; color: string; label: string; value: string; date?: string }[] = [
    { key: "today", icon: <Calendar size={16} />, color: "var(--color-success)", label: "今日", value: weekdayShort(TODAY), date: TODAY },
    { key: "tomorrow", icon: <Sun size={16} />, color: "var(--color-priority-2)", label: "明日", value: weekdayShort(addDays(TODAY, 1)), date: addDays(TODAY, 1) },
    { key: "weekend", icon: <Sofa size={16} />, color: "var(--color-priority-3)", label: "今週末", value: weekdayShort(nextSaturday), date: nextSaturday },
    {
      key: "nextweek",
      icon: <CalendarPlus size={16} />,
      color: "var(--color-priority-3)",
      label: "来週",
      value: `${weekdayShort(nextMonday)} ${Number(nextMonday.slice(5, 7))}/${Number(nextMonday.slice(8))}`,
      date: nextMonday,
    },
    { key: "none", icon: <Ban size={16} />, color: "var(--color-text-secondary)", label: "日付なし", value: "", date: undefined },
  ];

  const [y, m] = month.split("-").map(Number);
  const navBtn: React.CSSProperties = { display: "inline-flex", padding: 0, border: 0, background: "none", color: "var(--color-text-secondary)", cursor: "pointer" };

  return (
    <PopoverShell label="日付">
      <TextField value={typed ?? derived} placeholder="日付を入力" onChange={setTyped} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        {picks.map((p) => (
          <PopRow key={p.key} icon={p.icon} iconColor={p.color} onClick={() => select(p.date)} ariaLabel={p.label}>
            <span style={{ ...small("var(--color-text-primary)"), flex: 1 }}>{p.label}</span>
            <span style={valueStyle}>{p.value}</span>
          </PopRow>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={small("var(--color-text-primary)", 600)}>{`${y}年${m}月`}</span>
          <span style={{ display: "flex", gap: 2 }}>
            <button type="button" aria-label="前の月" style={navBtn} onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft size={14} />
            </button>
            <button type="button" aria-label="今月" style={navBtn} onClick={() => setMonth(monthStart(TODAY))}>
              <Circle size={14} />
            </button>
            <button type="button" aria-label="次の月" style={navBtn} onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight size={14} />
            </button>
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {WEEKDAY_HEAD.map((w) => (
            <span key={w} style={{ width: 40, textAlign: "center", fontSize: 11, lineHeight: "16px", color: "var(--color-text-muted)" }}>
              {w}
            </span>
          ))}
        </div>
        {weeksOf(month).map((week) => (
          <div key={week[0]} style={{ display: "flex", justifyContent: "space-between" }}>
            {week.map((d) => {
              const inMonth = d.slice(0, 7) === month.slice(0, 7);
              const selected = d === date;
              const today = d === TODAY;
              return (
                <button
                  key={d}
                  type="button"
                  aria-label={d}
                  aria-pressed={selected}
                  onClick={() => select(d)}
                  className={selected ? undefined : "bg-transparent hover:bg-[var(--color-bg-hover)]"}
                  style={{
                    width: 40,
                    height: 32,
                    padding: 0,
                    border: 0,
                    borderRadius: 16,
                    background: selected ? "var(--color-accent)" : undefined,
                    fontFamily: "var(--font-body)",
                    fontSize: 13,
                    lineHeight: "19px",
                    fontWeight: today && !selected ? 700 : 400,
                    color: selected ? "#FFFFFF" : today ? "var(--color-accent)" : inMonth ? "var(--color-text-primary)" : "var(--color-text-muted)",
                    cursor: "pointer",
                  }}
                >
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <PopRow icon={<Clock3 size={16} />} borderTop>
        <span style={{ ...small("var(--color-text-primary)"), flex: 1 }}>時刻</span>
        <span style={small("var(--color-text-primary)")}>{time}</span>
      </PopRow>
      <PopRow icon={<Repeat size={16} />} onClick={onOpenRecurrence}>
        <span style={{ ...small("var(--color-text-primary)"), flex: 1 }}>繰り返し</span>
        <span style={small("var(--color-text-primary)")}>{recurrenceLabel}</span>
        <span style={{ display: "inline-flex", color: "var(--color-text-muted)" }}>
          <ChevronRight size={14} />
        </span>
      </PopRow>
    </PopoverShell>
  );
}
