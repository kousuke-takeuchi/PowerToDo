import type { Placement, Task } from "../../types/model";

const siblingsOf = (tasks: Task[], t: Task) =>
  tasks.filter((x) => x.category === t.category && x.parentNo === t.parentNo).sort((a, b) => a.order - b.order || a.no - b.no);
const at = (t: Task, before: number | null, parent = t.parentNo ?? null): Placement => ({ section: t.category, parent, before });
const depthOf = (tasks: Task[], t: Task): number => (t.parentNo === undefined ? 0 : 1 + depthOf(tasks, tasks.find((x) => x.no === t.parentNo)!));
const heightOf = (tasks: Task[], no: number): number =>
  Math.max(0, ...tasks.filter((x) => x.parentNo === no).map((c) => 1 + heightOf(tasks, c.no)));

/** ⌥↑ / ⌥↓ (spec ③ §7): one place up / down among the siblings. Null at the ends. */
export function siblingMove(tasks: Task[], no: number, dir: -1 | 1): Placement | null {
  const t = tasks.find((x) => x.no === no);
  if (!t) return null;
  const s = siblingsOf(tasks, t);
  const i = s.findIndex((x) => x.no === no);
  const j = i + dir;
  if (j < 0 || j >= s.length) return null;
  // Up: before the one above. Down: before the one after the next (or at the end).
  return at(t, dir < 0 ? s[j].no : (s[j + 1]?.no ?? null));
}

/** Ctrl+] : the last subtask of the sibling above. Null at the top or past three levels. */
export function indentMove(tasks: Task[], no: number): Placement | null {
  const t = tasks.find((x) => x.no === no);
  if (!t) return null;
  const s = siblingsOf(tasks, t);
  const above = s[s.findIndex((x) => x.no === no) - 1];
  if (!above || depthOf(tasks, above) + 1 + heightOf(tasks, no) > 2) return null;
  return at(t, null, above.no);
}

/** Ctrl+[ : right after the parent, among the parent's siblings. Null at the top level. */
export function outdentMove(tasks: Task[], no: number): Placement | null {
  const t = tasks.find((x) => x.no === no);
  const parent = t && tasks.find((x) => x.no === t.parentNo);
  if (!t || !parent) return null;
  const s = siblingsOf(tasks, parent);
  const next = s[s.findIndex((x) => x.no === parent.no) + 1];
  return at(parent, next?.no ?? null, parent.parentNo ?? null);
}
