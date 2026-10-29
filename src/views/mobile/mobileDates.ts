import { addDays, daysBetween, monthDay, weekdayIndex, weekdayLong } from "../../mock/data.ts";

/**
 * Spec ④ iPhone §4.3: 「10月26日 · 今日 · 月曜日」; tomorrow 「· 明日 ·」; other days 「10月30日 · 金曜日」.
 * Desktop UpcomingView.dayTitle has its own format and must not change.
 */
export function dayHeading(ymd: string, today: string): string {
  const d = daysBetween(ymd, today);
  const rel = d === 0 ? "今日 · " : d === 1 ? "明日 · " : "";
  return `${monthDay(ymd)} · ${rel}${weekdayLong(ymd)}`;
}

/** Upcoming's month line (spec ④ iPhone §3.3): 「2026年10月」. */
export function monthLabel(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return `${y}年${m}月`;
}

/** Monday-first weeks covering the month of `ymd` (days of the next / previous month fill the edges). */
export function monthWeeks(ymd: string): string[][] {
  const first = `${ymd.slice(0, 7)}-01`;
  const [y, m] = ymd.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (weekdayIndex(first) + 6) % 7; // Monday = 0
  const rows = Math.ceil((offset + days) / 7);
  const start = addDays(first, -offset);
  return Array.from({ length: rows }, (_, r) => Array.from({ length: 7 }, (_, c) => addDays(start, r * 7 + c)));
}
