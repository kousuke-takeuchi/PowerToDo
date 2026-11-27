import type { CalEvent, ProjectEvents } from "../types/model";

/** An event with the project it is shown for and its calendar's color (what a row needs). */
export type ShownEvent = CalEvent & { project: string; color: string; calendar?: string };

/** All the events of a day, from the projects that have a calendar: all-day first, then by start time. `only`: one project. */
export function eventsOn(map: Record<string, ProjectEvents>, date: string, only?: string): ShownEvent[] {
  const out: ShownEvent[] = [];
  for (const [project, pe] of Object.entries(map)) {
    if (only !== undefined && project !== only) continue;
    for (const e of pe.events) if (e.date === date) out.push({ ...e, project });
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

/** How many events of a day show before 「ほか n 件」 (Today, Upcoming, and today's events of a folded project). */
export const DAY_CAP = 3;

/** The first `cap` events, or all when `expanded`; `hidden` is how many 「ほか n 件」 stands for. */
export function capEvents<T>(events: T[], cap = DAY_CAP, expanded = false): { shown: T[]; hidden: number } {
  if (expanded || events.length <= cap) return { shown: events, hidden: 0 };
  return { shown: events.slice(0, cap), hidden: events.length - cap };
}

/**
 * A project's events above its tasks (spec 2026-11-27 addendum): folded, only today's events show (at most `cap`) under a one-line
 * header that counts them all; open, every day shows. `hidden` is how many the folded list leaves out.
 */
export function foldProjectEvents(events: ShownEvent[], today: string, open: boolean, cap = DAY_CAP): { shown: ShownEvent[]; hidden: number } {
  if (open) return { shown: events, hidden: 0 };
  const { shown } = capEvents(events.filter((e) => e.date === today), cap);
  return { shown, hidden: events.length - shown.length };
}
