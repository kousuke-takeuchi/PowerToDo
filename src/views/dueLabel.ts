import type { Task } from "../types/model";
import { dateLabel } from "../mock/data.ts";

/** "07:30" as Todoist shows it: 7:30. */
export function timeLabel(time: string): string {
  return `${Number(time.slice(0, 2))}:${time.slice(3, 5)}`;
}

/** The date chip with the time after it (明日 7:30). Without the date (Today's group) only the time shows, in the date's color. */
export function dueWithTime(t: Pick<Task, "due" | "dueTime">, today: string, withDate = true): { label: string; tone: "success" | "danger" | "muted" } | undefined {
  const d = dateLabel(t.due, today);
  if (!d) return undefined;
  if (!withDate) return t.dueTime ? { label: timeLabel(t.dueTime), tone: d.tone } : undefined;
  return t.dueTime ? { label: `${d.label} ${timeLabel(t.dueTime)}`, tone: d.tone } : d;
}
