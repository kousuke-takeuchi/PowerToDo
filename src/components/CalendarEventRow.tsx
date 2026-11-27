import { useContext } from "react";
import { CalendarDays } from "lucide-react";
import { OpenCalendarEventContext } from "../app/CalendarEventContext";
import { eventTimeLabel, type ShownEvent } from "../app/calendarEvents";

export type CalendarEventRowProps = {
  event: ShownEvent;
  variant?: "desktop" | "mobile";
  /** Show the project's name at the right (cross lists). */
  showProject?: boolean;
};

/**
 * A Google Calendar event in a list (spec 2026-11-27). Display only: no checkbox, nothing opens. A small calendar icon in the
 * calendar's color takes the checkbox's place; the time ("10:00-11:30", "終日") is the second line like a task's date.
 */
export function CalendarEventRow({ event, variant = "desktop", showProject }: CalendarEventRowProps) {
  const mobile = variant === "mobile";
  // Tapping opens the detail (spec 2026-11-27) when the app provides it.
  const open = useContext(OpenCalendarEventContext);
  return (
    <div
      data-calendar-event=""
      role={open ? "button" : undefined}
      tabIndex={open ? 0 : undefined}
      aria-label={open ? `予定: ${event.title}` : undefined}
      onClick={open ? () => open(event) : undefined}
      onKeyDown={open ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(event)) : undefined}
      style={{ display: "flex", alignItems: "flex-start", gap: mobile ? 12 : 10, padding: mobile ? "10px 0" : "8px 0", boxShadow: "inset 0 -1px 0 var(--color-border)", fontFamily: "var(--font-body)", cursor: open ? "pointer" : undefined }}
    >
      <span style={{ display: "inline-flex", width: mobile ? 22 : 18, height: mobile ? 22 : 18, alignItems: "center", justifyContent: "center", color: event.color || "var(--color-text-secondary)", flex: "0 0 auto", marginTop: 1 }}>
        <CalendarDays size={mobile ? 20 : 16} aria-hidden />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: mobile ? 16 : 14, lineHeight: mobile ? "22px" : "20px", color: "var(--color-text-primary)", overflowWrap: "anywhere" }}>{event.title}</div>
        <div style={{ fontSize: mobile ? 12 : 12, lineHeight: "18px", color: "var(--color-text-secondary)", overflowWrap: "anywhere" }}>
          {eventTimeLabel(event)}
          {event.location ? ` · ${event.location}` : ""}
        </div>
      </div>
      {showProject && <span style={{ flex: "0 0 auto", fontSize: 12, lineHeight: "20px", color: "var(--color-text-secondary)", maxWidth: "35%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.project}</span>}
    </div>
  );
}
