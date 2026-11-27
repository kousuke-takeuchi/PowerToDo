import { X } from "lucide-react";
import { useEscLayer } from "../app/layers";
import type { ShownEvent } from "../app/calendarEvents";
import { CalendarEventDetail } from "../components/CalendarEventDetail";

/** The desktop's detail of a Google Calendar event (spec 2026-11-27): a dialog over the list. Esc or a click outside closes it. */
export function CalendarEventDialog({ event, today, onClose }: { event: ShownEvent; today: string; onClose: () => void }) {
  useEscLayer(true, onClose);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "var(--color-scrim)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 100 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="予定の詳細" style={{ position: "relative", width: 480, maxHeight: "70vh", overflowY: "auto", boxSizing: "border-box", padding: "20px 20px 20px", borderRadius: 10, background: "var(--color-bg)", boxShadow: "var(--shadow-dialog)" }}>
        <button type="button" aria-label="閉じる" onClick={onClose} className="bg-transparent hover:bg-[var(--color-bg-hover)]" style={{ position: "absolute", top: 8, right: 8, width: 32, height: 32, display: "grid", placeItems: "center", border: 0, borderRadius: 6, color: "var(--color-text-secondary)", cursor: "pointer" }}>
          <X size={16} />
        </button>
        <div style={{ paddingRight: 28 }}>
          <CalendarEventDetail event={event} today={today} />
        </div>
      </div>
    </div>
  );
}
