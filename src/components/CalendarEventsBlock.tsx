import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CalendarEventRow } from "./CalendarEventRow";
import { DAY_CAP, capEvents, foldProjectEvents, type ShownEvent } from "../app/calendarEvents";
import { useStoredFlag } from "../app/useStoredFlag";
import { daysBetween, monthDay, weekdayLong } from "../app/dates";

/** "11月30日 · 今日 · 月曜日" as the Upcoming day headings. */
export function eventDayTitle(ymd: string, today: string): string {
  const diff = daysBetween(ymd, today);
  const rel = diff === 0 ? "今日" : diff === 1 ? "明日" : undefined;
  return [monthDay(ymd), rel, weekdayLong(ymd)].filter(Boolean).join(" · ");
}

const moreStyle = { display: "block", width: "100%", minHeight: 36, padding: "4px 0", border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "19px", textAlign: "left", color: "var(--color-text-secondary)", cursor: "pointer" } as const;

/**
 * The Google Calendar events of a list (spec 2026-11-27), display only, above the tasks.
 * - `byDay` (a project): a one-line header that folds. Folded, today's events show (three at most); open, every day shows. Remembered per device.
 * - otherwise (Today, a day of Upcoming): the events of one day, three at most, then 「ほか n 件」 that opens the rest.
 * `showProject` adds the project at the right (cross lists).
 */
export function CalendarEventsBlock({ events, today, byDay, showProject, variant = "desktop" }: { events: ShownEvent[]; today: string; byDay?: boolean; showProject?: boolean; variant?: "desktop" | "mobile" }) {
  const [open, setOpen] = useStoredFlag("powertodo.calendar.open", false);
  const [expanded, setExpanded] = useState(false);
  if (events.length === 0) return null;
  const mobile = variant === "mobile";
  const row = (e: ShownEvent) => <CalendarEventRow key={`${e.project}/${e.id}/${e.date}`} event={e} variant={variant} showProject={showProject} />;
  if (!byDay) {
    const { shown, hidden } = capEvents(events, DAY_CAP, expanded);
    return (
      <div aria-label="予定" style={{ display: "flex", flexDirection: "column", marginBottom: "var(--space-2)" }}>
        {shown.map(row)}
        {hidden > 0 && (
          <button type="button" style={moreStyle} onClick={() => setExpanded(true)}>
            {`ほか ${hidden} 件の予定を表示`}
          </button>
        )}
        {expanded && events.length > DAY_CAP && (
          <button type="button" style={moreStyle} onClick={() => setExpanded(false)}>
            予定を閉じる
          </button>
        )}
      </div>
    );
  }
  const { shown, hidden } = foldProjectEvents(events, today, open);
  const days = [...new Set(shown.map((e) => e.date))].sort();
  return (
    <div aria-label="予定" style={{ display: "flex", flexDirection: "column", marginBottom: "var(--space-3)" }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: 6, minHeight: mobile ? 44 : 32, padding: 0, border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: mobile ? 15 : 13, lineHeight: "20px", fontWeight: 700, color: "var(--color-text-primary)", textAlign: "left", cursor: "pointer" }}
      >
        <span aria-hidden style={{ display: "inline-flex", color: "var(--color-text-secondary)" }}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        {`予定 ${events.length} 件`}
        {!open && hidden > 0 && <span style={{ fontWeight: 400, color: "var(--color-text-secondary)" }}>{`(ほか ${hidden} 件)`}</span>}
      </button>
      {days.map((d) => (
        <section key={d}>
          {open && <h3 style={{ margin: "6px 0 0", fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "19px", fontWeight: 700, color: "var(--color-text-primary)" }}>{eventDayTitle(d, today)}</h3>}
          {shown.filter((e) => e.date === d).map(row)}
        </section>
      ))}
    </div>
  );
}
