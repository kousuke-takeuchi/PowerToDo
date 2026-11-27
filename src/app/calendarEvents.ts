import type { CalEvent, ProjectEvents } from "../types/model";

/** An event with the project it is shown for and its calendar's color (what a row needs). */
export type ShownEvent = CalEvent & { project: string; color: string };

/** All the events of a day, from the projects that have a calendar: all-day first, then by start time. `only`: one project. */
export function eventsOn(map: Record<string, ProjectEvents>, date: string, only?: string): ShownEvent[] {
  const out: ShownEvent[] = [];
  for (const [project, pe] of Object.entries(map)) {
    if (only !== undefined && project !== only) continue;
    for (const e of pe.events) if (e.date === date) out.push({ ...e, project, color: pe.color });
  }
  return out.sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.title.localeCompare(b.title, "ja"));
}

/** The days (ascending) on which a project has events. */
export function eventDays(map: Record<string, ProjectEvents>, only?: string): string[] {
  const days = new Set<string>();
  for (const [project, pe] of Object.entries(map)) if (only === undefined || project === only) for (const e of pe.events) days.add(e.date);
  return [...days].sort();
}

/** "終日", or "10:00-11:30" like Todoist's calendar rows; a start alone is just "10:00". */
export function eventTimeLabel(e: Pick<CalEvent, "allDay" | "startTime" | "endTime">): string {
  if (e.allDay || !e.startTime) return "終日";
  const t = (s: string) => `${Number(s.slice(0, 2))}:${s.slice(3, 5)}`;
  return e.endTime && e.endTime !== e.startTime ? `${t(e.startTime)}-${t(e.endTime)}` : t(e.startTime);
}

/** The projects that need the user's attention: a login this device lacks, or a failed fetch. */
export function calendarProblems(map: Record<string, ProjectEvents>): { project: string; text: string }[] {
  return Object.entries(map).flatMap(([project, pe]) =>
    pe.needsLogin ? [{ project, text: `「${project}」のカレンダーにはログインが必要です` }] : pe.error ? [{ project, text: `「${project}」のカレンダー: ${pe.error}` }] : [],
  );
}
