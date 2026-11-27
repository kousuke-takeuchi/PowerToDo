import type React from "react";
import { useState } from "react";
import { Ban, Calendar, CalendarPlus, CalendarSearch, Clock3, Sofa, Sun } from "lucide-react";
import { TODAY, weekdayShort } from "../../mock/data";
import { DatePicker } from "../DatePicker";
import { TimeSelect } from "../../components/TimeSelect";
import { quickDates } from "../quickDates";
import { SheetCard, SheetRow } from "./BottomSheet";

export type DateSheetProps = {
  value?: string;
  time?: string;
  today?: string;
  onChange: (v: { date?: string; time?: string }) => void;
  onClose: () => void;
  /** 日付だけ選ばせる (期限切れの再スケジュール): 「日付なし」を出さず、DatePicker は dateOnly。 */
  dateOnly?: boolean;
};

/**
 * 日付のシートの中身 (BottomSheet の children)。今日 / 明日 / 今週末 / 来週 / 日付なし の 5 つは押すと選んで閉じ、
 * 「カレンダーから選ぶ」でデスクトップと同じ DatePicker を開く (日付を変えたら閉じる)。選んだ時刻は残す。
 */
export function DateSheet({ value, time, today = TODAY, onChange, onClose, dateOnly }: DateSheetProps) {
  const [calendar, setCalendar] = useState(false);
  const pick = (date: string | undefined) => {
    onChange(time && date ? { date, time } : { date });
    onClose();
  };
  const q = quickDates(today);
  const rows: { key: string; icon: React.ReactNode; color: string; label: string; date?: string }[] = [
    { key: "today", icon: <Calendar size={18} />, color: "var(--color-success)", label: "今日", date: today },
    { key: "tomorrow", icon: <Sun size={18} />, color: "var(--color-priority-2)", label: "明日", date: q.tomorrow },
    { key: "weekend", icon: <Sofa size={18} />, color: "var(--color-priority-3)", label: "今週末", date: q.weekend },
    { key: "nextweek", icon: <CalendarPlus size={18} />, color: "var(--color-priority-3)", label: "来週", date: q.nextWeek },
    ...(dateOnly ? [] : [{ key: "none", icon: <Ban size={18} />, color: "var(--color-text-secondary)", label: "日付なし", date: undefined }]),
  ];
  return (
    <>
      <SheetCard label="日付">
      {rows.map((r) => (
        <SheetRow
          key={r.key}
          icon={r.icon}
          iconColor={r.color}
          label={r.label}
          value={r.date ? weekdayShort(r.date) : undefined}
          selected={r.date === undefined ? value === undefined : r.date === value}
          onClick={() => pick(r.date)}
        />
      ))}
      {!calendar && <SheetRow icon={<CalendarSearch size={18} />} label="カレンダーから選ぶ" onClick={() => setCalendar(true)} />}
      </SheetCard>
      {!dateOnly && (
        // Spec 2026-11-24: the time, with the iPhone's own wheel (input type=time). A time without a date is for today.
        <SheetCard label="時刻">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minHeight: 48, padding: "0 16px", fontSize: 16, lineHeight: "22px", color: "var(--color-text-primary)" }}>
            <span style={{ display: "inline-flex", color: "var(--color-text-secondary)" }}>
              <Clock3 size={18} />
            </span>
            <span style={{ flex: 1 }}>時刻</span>
            <TimeSelect value={time} size={16} height={36} onChange={(t) => onChange(t ? { date: value ?? today, time: t } : { date: value })} />
          </div>
        </SheetCard>
      )}
      {calendar && (
        <SheetCard>
        <div style={{ display: "flex", justifyContent: "center", padding: 8 }}>
          <DatePicker
            value={value}
            time={time}
            today={today}
            dateOnly={dateOnly}
            hideQuickPicks
            hideTimeRepeat
            onChange={(v) => {
              if (dateOnly && !v.date) return;
              onChange(v);
              if (v.date !== value) onClose();
            }}
          />
        </div>
        </SheetCard>
      )}
    </>
  );
}
