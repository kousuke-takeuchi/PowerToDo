const MARGIN = 8;

/**
 * Keeps a popover inside the window (spec ② §7). `top` is its viewport top, `height` its natural height.
 * It moves up (negative `shift`) until its bottom is MARGIN above the window's bottom, never past MARGIN from the
 * top (a tall one that starts above that is pulled down to it); if it still does not fit, `maxHeight` is the room left so the caller can scroll the middle.
 */
export function fitPopover(top: number, height: number, viewportHeight: number, areaTop = 0): { shift: number; maxHeight: number | null } {
  // `viewportHeight` / `areaTop`: the bottom and top of the room (the window, or a box that clips it such as the task dialog).
  const limit = viewportHeight - MARGIN;
  if (top + height <= limit) return { shift: 0, maxHeight: null };
  const newTop = Math.max(areaTop + MARGIN, limit - height);
  const shift = newTop - top;
  return { shift, maxHeight: newTop + height > limit ? Math.max(0, limit - newTop) : null };
}
