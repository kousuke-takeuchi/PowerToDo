import { addDays, weekdayIndex } from "../mock/data.ts";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"] as const;
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const pad = (n: number) => String(n).padStart(2, "0");

/** One month of the date sheet's calendar: `cells` is whole weeks (7 per row), `null` before the 1st and after the last day. */
export type CalendarMonth = { key: string; title: string; cells: (string | null)[] };

/**
 * `count` months from the month of `today` (spec 2026-11-28: Todoist's calendar is one list of months under the week header, not one
 * month at a time). `weekStart` "mon" or "sun" sets the column the 1st falls in.
 */
export function calendarMonths(today: string, count: number, weekStart: "mon" | "sun" = "mon"): CalendarMonth[] {
  const [y0, m0] = today.split("-").map(Number);
  const out: CalendarMonth[] = [];
  for (let i = 0; i < count; i++) {
    const first = new Date(Date.UTC(y0, m0 - 1 + i, 1));
    const y = first.getUTCFullYear();
    const m = first.getUTCMonth() + 1;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = (first.getUTCDay() - (weekStart === "mon" ? 1 : 0) + 7) % 7;
    const cells: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d++) cells.push(`${y}-${pad(m)}-${pad(d)}`);
    while (cells.length % 7 !== 0) cells.push(null);
    out.push({ key: `${y}-${pad(m)}`, title: `${y}年${m}月`, cells });
  }
  return out;
}

/** The weekday labels of the header row, from `weekStart`. */
export const weekHeader = (weekStart: "mon" | "sun" = "mon"): string[] => (weekStart === "mon" ? [...WEEK.slice(1), WEEK[0]] : [...WEEK]);

/** A repeat the 繰り返し row offers: what it says and its RRULE. */
export type RepeatChoice = { key: string; label: string; rrule: string | null };

/** Todoist's 繰り返し menu for a date: なし, 毎日, 毎週<曜日>, 平日毎日 (月 - 金), 毎月 第 N, 毎年 M月D日. 「カスタム」 is left to the task's own 繰り返し. */
export function repeatChoices(date: string): RepeatChoice[] {
  const [, m, d] = date.split("-").map(Number);
  const w = weekdayIndex(date);
  return [
    { key: "none", label: "なし", rrule: null },
    { key: "daily", label: "毎日", rrule: "FREQ=DAILY" },
    { key: "weekly", label: `毎週${WEEK[w]}`, rrule: `FREQ=WEEKLY;BYDAY=${BYDAY[w]}` },
    { key: "weekdays", label: "平日毎日 (月 - 金)", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
    { key: "monthly", label: `毎月 第 ${d}`, rrule: `FREQ=MONTHLY;BYMONTHDAY=${d}` },
    { key: "yearly", label: `毎年 ${m}月${d}日`, rrule: `FREQ=YEARLY;BYMONTH=${m};BYMONTHDAY=${d}` },
  ];
}

/** The quick rows (Todoist: 明日 / 来週 / 今週の後半 / 今週末): 今週の後半 is mid-week (Wednesday) while it is still ahead, else left out. */
export function quickRows(today: string): { key: string; label: string; date: string }[] {
  const w = weekdayIndex(today);
  const tomorrow = addDays(today, 1);
  const weekend = addDays(today, (6 - w + 7) % 7 || 7);
  const nextWeek = addDays(today, ((1 - w + 7) % 7) || 7);
  const midWeek = w >= 1 && w <= 2 ? addDays(today, 3 - w) : null;
  return [
    { key: "tomorrow", label: "明日", date: tomorrow },
    ...(midWeek && midWeek !== tomorrow ? [{ key: "later", label: "今週の後半", date: midWeek }] : []),
    { key: "weekend", label: "今週末", date: weekend },
    { key: "nextweek", label: "来週", date: nextWeek },
  ];
}
