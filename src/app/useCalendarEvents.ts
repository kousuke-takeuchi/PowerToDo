import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { CalendarLink, ProjectEvents } from "../types/model";

const POLL_MS = 5 * 60_000;

/** `YYYY-MM-DD` of `ymd` plus `days`. */
function plusDays(ymd: string, days: number): string {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + days));
  return d.toISOString().slice(0, 10);
}

/**
 * Spec 2026-11-27: the events of every project that has a Google calendar, for `today` to `today + days`.
 * The backend fetches a calendar at most every 5 minutes (unless forced); this re-asks on start, every 5 minutes, and when the app
 * comes back to the front. A failure shows what was fetched before (the backend keeps it) and the reason per project.
 */
export function useCalendarEvents(today: string, days = 91, enabled = true) {
  const [events, setEvents] = useState<Record<string, ProjectEvents>>({});
  const [links, setLinks] = useState<Record<string, CalendarLink>>({});
  const seq = useRef(0);
  const refresh = useCallback(
    async (force = false) => {
      const mine = ++seq.current;
      try {
        const [l, e] = await Promise.all([api.calendarLinks(), api.calendarEvents(today, plusDays(today, days), force)]);
        if (mine !== seq.current) return;
        setLinks(l);
        setEvents(e);
      } catch {
        // Not shown as an error banner: the next pull / focus tries again (the rows keep the earlier events).
      }
    },
    [today, days],
  );
  useEffect(() => {
    if (!enabled) return;
    void refresh(false);
    const id = window.setInterval(() => void refresh(false), POLL_MS);
    const onFocus = () => void refresh(false);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh, enabled]);
  return { events, links, refresh };
}
