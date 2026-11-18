import { useLayoutEffect, type RefObject } from "react";
import { fitPopover } from "./popoverFit";

/**
 * Keeps the absolutely positioned popover `ref` inside the window (spec ② §7): after it opens, on content changes
 * and on window resize it measures the popover, shifts it up with `translate` (the entrance animation owns
 * `transform`) and, if it is still too tall, caps `max-height` so a PopoverShell scrolls its middle.
 * The popover must be a flex column so its shell can shrink.
 */
export function useFitPopover(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const fit = () => {
      const parent = el.offsetParent;
      if (!parent) return;
      el.style.maxHeight = "";
      el.style.translate = "";
      const top = parent.getBoundingClientRect().top + parent.clientTop + el.offsetTop;
      const { shift, maxHeight } = fitPopover(top, el.offsetHeight, window.innerHeight);
      if (maxHeight !== null) el.style.maxHeight = `${maxHeight}px`;
      if (shift !== 0) el.style.translate = `0 ${shift}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", fit);
      ro?.disconnect();
    };
  }, [ref, active]);
}
