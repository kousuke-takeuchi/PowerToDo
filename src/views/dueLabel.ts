import type { Task } from "../types/model";
import { dateLabel } from "../mock/data.ts";

/** "07:30" as Todoist shows it: 7:30. */
export function timeLabel(time: string): string {
  return `${Number(time.slice(0, 2))}:${time.slice(3, 5)}`;
}

/** Now as HH:MM (the device's clock). */
export function nowTime(d = new Date()): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The date chip with the time after it (明日 7:30). Without the date (Today's group) only the time shows, in the date's color. */
export function dueWithTime(t: Pick<Task, "due" | "dueTime">, today: string, withDate = true, now: string = nowTime()): { label: string; tone: "success" | "danger" | "muted" } | undefined {
  const base = dateLabel(t.due, today);
  if (!base) return undefined;
  // Today's time that has passed is red, like an overdue date.
  const d = t.due === today && t.dueTime && t.dueTime < now ? { ...base, tone: "danger" as const } : base;
  if (!withDate) return t.dueTime ? { label: timeLabel(t.dueTime), tone: d.tone } : undefined;
  return t.dueTime ? { label: `${d.label} ${timeLabel(t.dueTime)}`, tone: d.tone } : d;
}
