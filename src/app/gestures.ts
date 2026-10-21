// Pure decisions for the touch gestures of the mobile screens (Phase 6 §4). No React, no DOM: the
// handlers measure the movement and ask these functions what it means. Only erasable TypeScript
// syntax here so `node --test` can run it as is.

/** px: the first movement beyond this decides the axis. */
export const AXIS_SLOP = 10;
/** px: a swipe released at or past this distance fires. */
export const SWIPE_TRIGGER = 80;
export const LONG_PRESS_MS = 500;
/** px: moving this far cancels a long press. */
export const LONG_PRESS_SLOP = 8;
/** px: pulled this far at the top of a list and released, the list refreshes. */
export const PULL_TRIGGER = 64;

export type Axis = "x" | "y";

/** The axis of a gesture from its movement so far. null while still inside the slop; a diagonal start counts as vertical (a scroll). */
export function axisLock(dx: number, dy: number): Axis | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) <= AXIS_SLOP) return null;
  return ax > ay ? "x" : "y";
}

/** What a released horizontal movement does: right completes, left opens the date choice. */
export function decideSwipe(axis: Axis | null, dx: number): "none" | "complete" | "date" {
  if (axis !== "x") return "none";
  if (dx >= SWIPE_TRIGGER) return "complete";
  if (dx <= -SWIPE_TRIGGER) return "date";
  return "none";
}

/** Whether a released downward pull refreshes the list: only at the very top, vertical, past the trigger. */
export function decidePull(atTop: boolean, axis: Axis | null, dy: number): boolean {
  return atTop && axis === "y" && dy >= PULL_TRIGGER;
}

/** A long press is given up once the finger has moved LONG_PRESS_SLOP. */
export function longPressCancelled(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= LONG_PRESS_SLOP;
}
