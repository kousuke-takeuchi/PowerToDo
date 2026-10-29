import { useEffect } from "react";

/**
 * iPhone (spec ④ iPhone §6): follow the system appearance by setting <html data-theme>, live.
 * The app has no theme setting; desktop does not call this, so desktop is unchanged.
 */
export function useSystemTheme(): void {
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const root = document.documentElement;
    const previous = root.getAttribute("data-theme");
    const apply = () => root.setAttribute("data-theme", mq.matches ? "dark" : "light");
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      if (previous === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previous);
    };
  }, []);
}
