import { useLayoutEffect, type RefObject } from "react";
import { fitPopover } from "./popoverFit";

/** The window, narrowed to the nearest ancestor that clips its overflow (the task dialog's card cuts a popover off). */
function clipRoom(el: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let a = el.parentElement; a; a = a.parentElement) {
    const o = getComputedStyle(a);
    if (o.overflowY !== "visible" || o.overflowX !== "visible") {
      const r = a.getBoundingClientRect();
      top = Math.max(top, r.top);
      bottom = Math.min(bottom, r.bottom);
      break;
    }
  }
  return { top, bottom };
}

/**
 * Keeps the absolutely positioned popover `ref` inside the window (spec ② §7): after it opens, on content changes
 * and on window resize it measures the popover, shifts it up with `translate` (the entrance animation owns
 * `transform`) and, if it is still too tall, caps `max-height` so a PopoverShell scrolls its middle.
 * The popover must be a flex column so its shell can shrink. `content` names what is shown (which picker, where):
 * a change refits even when the box keeps its size (a capped popover swapped for another tall one at a new top).
 */
export function useFitPopover(ref: RefObject<HTMLElement | null>, active: boolean, content?: unknown): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const fit = () => {
      const parent = el.offsetParent;
      if (!parent) return;
      el.style.maxHeight = "";
      el.style.translate = "";
      const top = parent.getBoundingClientRect().top + parent.clientTop + el.offsetTop;
      const room = clipRoom(el);
      const { shift, maxHeight } = fitPopover(top, el.offsetHeight, room.bottom, room.top);
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
  }, [ref, active, content]);
}
