import { computeDrop, type Drop, type RowBox } from "../../app/drag/dropTarget.ts";

type Dragged = Parameters<typeof computeDrop>[3];

/**
 * Spec 2026-11-22 reorder: the desktop drop (spec ③ §3.1-3.3) without "onto". A finger covers the row, so the middle
 * half of a row is read as the nearer gap; nesting comes only from moving the finger right (one level per 28 px).
 */
export function mobileDrop(rows: RowBox[], p: { x: number; y: number }, startX: number, d: Dragged, left: number): Drop | null {
  const drop = computeDrop(rows, p, startX, d, left);
  if (drop?.kind !== "onto") return drop;
  const r = rows.find((x) => x.kind === "task" && x.key === drop.key);
  if (!r) return null;
  const y = p.y < (r.top + r.bottom) / 2 ? r.top : r.bottom - 0.5;
  // Exactly on the row's edge is outside the middle half, so computeDrop returns a gap there.
  return computeDrop(rows, { x: p.x, y }, startX, d, left);
}

/** After the long press: moved this far, it is a drag; less (finger wobble), releasing opens the menu. */
export function liftMoved(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= 8;
}
