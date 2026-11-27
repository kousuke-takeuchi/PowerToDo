import { useState } from "react";
import { CalendarDays, Clock3, ExternalLink, MapPin, Video } from "lucide-react";
import { api, errorMessage } from "../api/client";
import { eventRangeText, type ShownEvent } from "../app/calendarEvents";
import { eventDayTitle } from "./CalendarEventsBlock";

const labelRow = { display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, lineHeight: "20px", color: "var(--color-text-primary)" } as const;
const icon = { display: "inline-flex", color: "var(--color-text-secondary)", flex: "0 0 auto", marginTop: 2 } as const;
const linkButton = { display: "inline-flex", alignItems: "center", gap: 6, minHeight: 36, padding: "0 12px", border: "1px solid var(--color-border)", borderRadius: 8, background: "none", fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-accent)", cursor: "pointer" } as const;

/**
 * The detail of a Google Calendar event (spec 2026-11-27): the title, its calendar, the whole date and time, the place, the notes
 * and two links (the video meeting, the event's page in Google Calendar). Display only: nothing here changes the event.
 */
export function CalendarEventDetail({ event, today }: { event: ShownEvent; today: string }) {
  const [error, setError] = useState<string | null>(null);
  const open = (url: string) => {
    setError(null);
    api.openWebLink(url).catch((e) => setError(errorMessage(e)));
  };
  const dayText = (ymd: string) => eventDayTitle(ymd, today).replace(/ · (今日|明日)/, "");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: "var(--font-body)" }}>
      <div style={{ fontSize: 20, lineHeight: "28px", fontWeight: 700, color: "var(--color-text-primary)", overflowWrap: "anywhere" }}>{event.title}</div>
      <div style={labelRow}>
        <span style={icon}>
          <Clock3 size={16} aria-hidden />
        </span>
        <span>{eventRangeText(event, dayText)}</span>
      </div>
      {event.location && (
        <div style={labelRow}>
          <span style={icon}>
            <MapPin size={16} aria-hidden />
          </span>
          <span style={{ overflowWrap: "anywhere" }}>{event.location}</span>
        </div>
      )}
      <div style={labelRow}>
        <span style={{ ...icon, color: event.color || "var(--color-text-secondary)" }}>
          <CalendarDays size={16} aria-hidden />
        </span>
        <span style={{ overflowWrap: "anywhere" }}>
          {event.calendar || "カレンダー"}
          {event.project ? <span style={{ color: "var(--color-text-secondary)" }}>{` · ${event.project}`}</span> : null}
        </span>
      </div>
      {event.description && <div style={{ fontSize: 14, lineHeight: "21px", color: "var(--color-text-primary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: "10px 12px", borderRadius: 8, background: "var(--color-bg-hover)" }}>{event.description}</div>}
      {(event.meet || event.link) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {event.meet && (
            <button type="button" style={linkButton} onClick={() => open(event.meet!)}>
              <Video size={16} aria-hidden />
              会議に参加
            </button>
          )}
          {event.link && (
            <button type="button" style={linkButton} onClick={() => open(event.link!)}>
              <ExternalLink size={16} aria-hidden />
              Google カレンダーで開く
            </button>
          )}
        </div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-danger)" }}>
          {error}
        </div>
      )}
    </div>
  );
}
