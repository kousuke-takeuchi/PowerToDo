import { CalendarEventRow } from "./CalendarEventRow";
import type { ShownEvent } from "../app/calendarEvents";
import { daysBetween, monthDay, weekdayLong } from "../app/dates";

/** "11月30日 · 今日 · 月曜日" as the Upcoming day headings. */
export function eventDayTitle(ymd: string, today: string): string {
  const diff = daysBetween(ymd, today);
  const rel = diff === 0 ? "今日" : diff === 1 ? "明日" : undefined;
  return [monthDay(ymd), rel, weekdayLong(ymd)].filter(Boolean).join(" · ");
}

/**
 * The Google Calendar events of a list (spec 2026-11-27), display only, above the tasks: by day when `byDay`, else just the rows
 * (a day's list that has its own heading). `showProject` adds the project at the right (cross lists).
 */
export function CalendarEventsBlock({ events, today, byDay, showProject }: { events: ShownEvent[]; today: string; byDay?: boolean; showProject?: boolean }) {
  if (events.length === 0) return null;
  if (!byDay) {
    return (
      <div aria-label="予定" style={{ display: "flex", flexDirection: "column", marginBottom: "var(--space-2)" }}>
        {events.map((e) => (
          <CalendarEventRow key={`${e.project}/${e.id}/${e.date}`} event={e} showProject={showProject} />
        ))}
      </div>
    );
  }
  const days = [...new Set(events.map((e) => e.date))].sort();
  return (
    <div aria-label="予定" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
      {days.map((d) => (
        <section key={d}>
          <h3 style={{ margin: "0 0 2px", fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "19px", fontWeight: 700, color: "var(--color-text-primary)" }}>{eventDayTitle(d, today)}</h3>
          {events.filter((e) => e.date === d).map((e) => (
            <CalendarEventRow key={`${e.project}/${e.id}/${e.date}`} event={e} showProject={showProject} />
          ))}
        </section>
      ))}
    </div>
  );
}

