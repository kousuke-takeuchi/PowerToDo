import { useEffect, useState } from "react";
import { layoutFor } from "./shellLayout";

/** Local calendar date as YYYY-MM-DD. */
export function localYmd(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Today's local date. Rolls over at local midnight (a timer), and is re-read when the window regains focus or
 * becomes visible (timers can fire late after the machine sleeps).
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localYmd());
  useEffect(() => {
    const refresh = () => setToday(localYmd());
    let timer = 0;
    const scheduleMidnight = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      // +1 s so the timer never lands just before midnight.
      timer = window.setTimeout(() => {
        refresh();
        scheduleMidnight();
      }, next.getTime() - now.getTime() + 1000);
    };
    scheduleMidnight();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return today;
}

/** AppShell layout for the window: the 1440 layout (sidebar 280) from 750 px, else the narrow 960 layout (sidebar hidden, opens over the page). */
export function useShellWidth(): 1440 | 960 {
  const pick = () => (layoutFor(window.innerWidth) === "narrow" ? 960 : 1440);
  const [width, setWidth] = useState<1440 | 960>(pick);
  useEffect(() => {
    const onResize = () => setWidth(pick());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}
