import { useEffect, useState } from "react";

/** Local calendar date as YYYY-MM-DD. */
export function localYmd(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's local date. Re-read when the window regains focus, so a window left open overnight rolls over. */
export function useToday(): string {
  const [today, setToday] = useState(() => localYmd());
  useEffect(() => {
    const refresh = () => setToday(localYmd());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return today;
}

/** AppShell layout for the window: the 1440 layout (sidebar 280) from 1100 px, else the 960 layout (icon rail). */
export function useShellWidth(): 1440 | 960 {
  const pick = () => (window.innerWidth < 1100 ? 960 : 1440);
  const [width, setWidth] = useState<1440 | 960>(pick);
  useEffect(() => {
    const onResize = () => setWidth(pick());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}
