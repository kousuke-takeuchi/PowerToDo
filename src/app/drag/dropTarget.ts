import type { Placement } from "../../types/model";

export type RowBox =
  | { kind: "task"; key: string; no: number; depth: number; parent: number | null; section: string | null; top: number; bottom: number }
  | { kind: "header"; section: string; top: number; bottom: number }
  | { kind: "slot"; section: string | null; top: number; bottom: number };
export type Drop = { kind: "between"; index: number; depth: number; y: number; x: number } | { kind: "onto"; key: string };

export const LEVEL = 28;
const MAX_DEPTH = 2;
const EDGE = 48;
const MAX_SPEED = 16;

type Dragged = { key: string; depth: number; height: number; subtree: Set<string> };
type TaskBox = Extract<RowBox, { kind: "task" }>;
const isTask = (r: RowBox | undefined): r is TaskBox => r?.kind === "task";

/**
 * Spec ③ §3.1–§3.3. `rows` are the shown rows top to bottom (page coordinates), `startX` where the drag began,
 * `left` the x of level 0. Null: no place (outside the rows, or only the dragged subtree there).
 */
export function computeDrop(rows: RowBox[], p: { x: number; y: number }, startX: number, d: Dragged, left: number): Drop | null {
  const i = rows.findIndex((r) => p.y >= r.top && p.y < r.bottom);
  if (i < 0) return null;
  const r = rows[i];
  const quarter = (r.bottom - r.top) / 4;
  if (isTask(r) && d.subtree.has(r.key)) return null;
  if (isTask(r) && p.y >= r.top + quarter && p.y < r.bottom - quarter && r.depth + 1 + d.height <= MAX_DEPTH) return { kind: "onto", key: r.key };
  // The gap above or below this row (a header's gap is always below it, a slot's above it).
  const below = r.kind === "header" || (r.kind === "task" && p.y >= (r.top + r.bottom) / 2);
  let index = below ? i + 1 : i;
  // Skip the dragged subtree: the gap moves past it.
  const inSubtree = (row: RowBox | undefined) => isTask(row) && d.subtree.has(row.key);
  while (inSubtree(rows[index])) index++;
  let prevIdx = index - 1;
  while (prevIdx >= 0 && inSubtree(rows[prevIdx])) prevIdx--;
  const prev = rows[prevIdx];
  const next = rows[index];
  const maxBy = isTask(prev) ? prev.depth + 1 : 0;
  const max = Math.max(0, Math.min(maxBy, MAX_DEPTH - d.height));
  const min = Math.min(isTask(next) ? next.depth : 0, max);
  const wanted = d.depth + Math.round((p.x - startX) / LEVEL);
  const depth = Math.max(min, Math.min(max, wanted));
  // A level capped below the next row's lands after that deeper run: move the gap (and the line) there.
  while (isTask(rows[index]) && (inSubtree(rows[index]) || (rows[index] as TaskBox).depth > depth)) index++;
  let lastIdx = index - 1;
  while (lastIdx >= 0 && inSubtree(rows[lastIdx])) lastIdx--;
  const y = rows[index] ? rows[index].top : (rows[lastIdx]?.bottom ?? r.bottom);
  return { kind: "between", index, depth, y, x: left + depth * LEVEL };
}

/** Where the dragged row is now, as a placement: its section, parent, and the next sibling after its subtree. */
function currentPlacement(rows: RowBox[], draggedKey: string): Placement | null {
  const i = rows.findIndex((x) => isTask(x) && x.key === draggedKey);
  if (i < 0) return null;
  const me = rows[i] as TaskBox;
  let before: number | null = null;
  for (let k = i + 1; k < rows.length; k++) {
    const r = rows[k];
    if (r.kind !== "task" || r.depth < me.depth) break;
    if (r.depth > me.depth) continue;
    if (r.parent === me.parent) before = r.no;
    break;
  }
  return { section: me.section, parent: me.parent, before };
}

/** The store placement of a drop (spec ③ §8). Null when it would not move anything (spec ③ §2.4). */
export function placementOf(rows: RowBox[], drop: Drop, draggedKey: string): Placement | null {
  const p = placementOfDrop(rows, drop, draggedKey);
  const now = currentPlacement(rows, draggedKey);
  if (p && now && p.section === now.section && p.parent === now.parent && p.before === now.before) return null;
  return p;
}

function placementOfDrop(rows: RowBox[], drop: Drop, draggedKey: string): Placement | null {
  if (drop.kind === "onto") {
    const r = rows.find((x) => isTask(x) && x.key === drop.key) as TaskBox | undefined;
    return r ? { section: r.section, parent: r.no, before: null } : null;
  }
  const { index, depth } = drop;
  // Section: of the nearest row above (a header starts its section), else unsectioned.
  // A list with no header (a board column) starts in its first row's section; a header with "" is the unsectioned area.
  const above = index > 0 ? rows[index - 1].section : (rows[0]?.section ?? null);
  const section = above === "" ? null : above;
  // Parent: the nearest task above at depth - 1 (stopping at the section start).
  let parent: number | null = null;
  if (depth > 0) {
    for (let k = index - 1; k >= 0; k--) {
      const r = rows[k];
      if (r.kind !== "task") break;
      if (r.key === draggedKey) continue;
      if (r.depth === depth - 1) { parent = r.no; break; }
    }
    if (parent === null) return null;
  }
  // Before: the first following task at this depth with this parent, before the level ends.
  let before: number | null = null;
  for (let k = index; k < rows.length; k++) {
    const r = rows[k];
    if (r.kind !== "task") break;
    if (r.key === draggedKey) continue;
    if (r.depth < depth) break;
    if (r.depth === depth && r.parent === parent) { before = r.no; break; }
  }
  return { section, parent, before };
}

/** Pixels per frame to scroll: negative near the top edge, positive near the bottom (spec ③ §2.3). */
export function autoScrollSpeed(y: number, top: number, bottom: number): number {
  if (y < top + EDGE) return -Math.round(MAX_SPEED * Math.min(1, (top + EDGE - y) / EDGE));
  if (y > bottom - EDGE) return Math.round(MAX_SPEED * Math.min(1, (y - (bottom - EDGE)) / EDGE));
  return 0;
}

type Box = { top: number; bottom: number };
const ORDER_MARGIN = 8;

/**
 * Section / project reorder (spec ③ §2.2): the gap index under the pointer and the y of its line.
 * Null when the pointer is outside the list (x outside, or y more than 8 px above / below it): no line, release cancels.
 */
export function orderIndex(items: Box[], list: { left: number; right: number; top: number; bottom: number }, x: number, y: number): { index: number; y: number } | null {
  if (!items.length) return null;
  if (x < list.left || x > list.right) return null;
  if (y < list.top - ORDER_MARGIN || y > list.bottom + ORDER_MARGIN) return null;
  let index = items.findIndex((r) => y < (r.top + r.bottom) / 2);
  if (index < 0) index = items.length;
  return { index, y: index < items.length ? items[index].top : items[items.length - 1].bottom };
}

/** Today drop (spec ③ §2.4): true when `beforeKey` keeps the dragged row where it is (same place does nothing). */
export function todayInPlace(rows: RowBox[], beforeKey: string | null, draggedKey: string): boolean {
  if (beforeKey === draggedKey) return true;
  const i = rows.findIndex((r) => isTask(r) && r.key === draggedKey);
  if (i < 0) return false;
  const next = rows.slice(i + 1).find((r): r is TaskBox => isTask(r) && r.key !== draggedKey);
  return (next?.key ?? null) === beforeKey;
}

/**
 * Sorted board (spec ⑤ §4: 自動の並びのとき 列の間の移動だけ): true when `list` is the column the card was lifted from,
 * which then gives no drop target (no line, release cancels). Other columns still take the card (at their end).
 */
export function ownSortedColumn<T>(list: T, sorted: boolean, from: T | null): boolean {
  return sorted && from !== null && list === from;
}
