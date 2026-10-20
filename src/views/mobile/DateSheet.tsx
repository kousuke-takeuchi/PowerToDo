import type React from "react";
import { useState } from "react";
import { Ban, Calendar, CalendarPlus, CalendarSearch, Sofa, Sun } from "lucide-react";
import { TODAY, addDays, weekdayIndex, weekdayShort } from "../../mock/data";
import { DatePicker } from "../DatePicker";
import { SheetRow } from "./BottomSheet";

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
 * 日付のシートの中身 (BottomSheet の children)。今日 / 明日 / 次の週末 / 来週 / 日付なし の 5 つは押すと選んで閉じ、
 * 「カレンダーから選ぶ」でデスクトップと同じ DatePicker を開く (日付を変えたら閉じる)。選んだ時刻は残す。
 */
export function DateSheet({ value, time, today = TODAY, onChange, onClose, dateOnly }: DateSheetProps) {
  const [calendar, setCalendar] = useState(false);
  const pick = (date: string | undefined) => {
    onChange(time && date ? { date, time } : { date });
    onClose();
  };
  const nextSaturday = addDays(today, (6 - weekdayIndex(today) + 7) % 7 || 7);
  const nextMonday = addDays(today, ((1 - weekdayIndex(today) + 7) % 7) || 7);
  const rows: { key: string; icon: React.ReactNode; color: string; label: string; date?: string }[] = [
    { key: "today", icon: <Calendar size={18} />, color: "var(--color-success)", label: "今日", date: today },
    { key: "tomorrow", icon: <Sun size={18} />, color: "var(--color-priority-2)", label: "明日", date: addDays(today, 1) },
    { key: "weekend", icon: <Sofa size={18} />, color: "var(--color-priority-3)", label: "次の週末", date: nextSaturday },
    { key: "nextweek", icon: <CalendarPlus size={18} />, color: "var(--color-priority-3)", label: "来週", date: nextMonday },
    ...(dateOnly ? [] : [{ key: "none", icon: <Ban size={18} />, color: "var(--color-text-secondary)", label: "日付なし", date: undefined }]),
  ];
  return (
    <div role="group" aria-label="日付" style={{ display: "flex", flexDirection: "column" }}>
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
      {calendar ? (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: "var(--space-2)" }}>
          <DatePicker
            value={value}
            time={time}
            today={today}
            dateOnly={dateOnly}
            onChange={(v) => {
              if (dateOnly && !v.date) return;
              onChange(v);
              if (v.date !== value) onClose();
            }}
          />
        </div>
      ) : (
        <SheetRow icon={<CalendarSearch size={18} />} label="カレンダーから選ぶ" onClick={() => setCalendar(true)} />
      )}
    </div>
  );
}
