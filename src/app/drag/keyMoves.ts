import type { Placement, Task } from "../../types/model";

// Completed top-level tasks sit in their own list at the bottom of the screen: they are no siblings (spec ③ §3.1).
const hidden = (t: Task) => t.parentNo === undefined && t.progress === 100;
// A カテゴリ that is none of the project's sections (typed in Excel) shows among the unsectioned rows: it is unsectioned here too.
const sectionOf = (t: Task, sections: readonly string[]) => (t.category !== null && sections.includes(t.category) ? t.category : null);
// Ties in `order` keep the array order, as the screen does (Array.prototype.sort is stable).
const siblingsOf = (tasks: Task[], t: Task, sections: readonly string[]) =>
  tasks
    .filter((x) => sectionOf(x, sections) === sectionOf(t, sections) && x.parentNo === t.parentNo && !hidden(x))
    .sort((a, b) => a.order - b.order);
const at = (t: Task, sections: readonly string[], before: number | null, parent = t.parentNo ?? null): Placement => ({
  section: sectionOf(t, sections),
  parent,
  before,
});
const depthOf = (tasks: Task[], t: Task): number => (t.parentNo === undefined ? 0 : 1 + depthOf(tasks, tasks.find((x) => x.no === t.parentNo)!));
const heightOf = (tasks: Task[], no: number): number =>
  Math.max(0, ...tasks.filter((x) => x.parentNo === no).map((c) => 1 + heightOf(tasks, c.no)));

/**
 * ⌥↑ / ⌥↓ (spec ③ §7): one place up / down among the siblings. Null at the ends. `sections`: the project's section names.
 * `shown`: the rows the 表示 filter leaves on screen (spec ⑤); hidden siblings are skipped, as a drop skips them.
 */
export function siblingMove(
  tasks: Task[],
  no: number,
  dir: -1 | 1,
  sections: readonly string[],
  shown: (t: Task) => boolean = () => true,
): Placement | null {
  const t = tasks.find((x) => x.no === no);
  if (!t || hidden(t)) return null;
  const s = siblingsOf(tasks, t, sections).filter((x) => x.no === no || shown(x));
  const i = s.findIndex((x) => x.no === no);
  const j = i + dir;
  if (j < 0 || j >= s.length) return null;
  // Up: before the one above. Down: before the one after the next (or at the end).
  return at(t, sections, dir < 0 ? s[j].no : (s[j + 1]?.no ?? null));
}

/** Ctrl+] : the last subtask of the sibling above. Null at the top or past three levels. */
export function indentMove(tasks: Task[], no: number, sections: readonly string[]): Placement | null {
  const t = tasks.find((x) => x.no === no);
  if (!t || hidden(t)) return null;
  const s = siblingsOf(tasks, t, sections);
  const above = s[s.findIndex((x) => x.no === no) - 1];
  if (!above || depthOf(tasks, above) + 1 + heightOf(tasks, no) > 2) return null;
  return at(t, sections, null, above.no);
}

/** Ctrl+[ : right after the parent, among the parent's siblings. Null at the top level. */
export function outdentMove(tasks: Task[], no: number, sections: readonly string[]): Placement | null {
  const t = tasks.find((x) => x.no === no);
  const parent = t && tasks.find((x) => x.no === t.parentNo);
  if (!t || !parent) return null;
  const s = siblingsOf(tasks, parent, sections);
  const next = s[s.findIndex((x) => x.no === parent.no) + 1];
  return at(parent, sections, next?.no ?? null, parent.parentNo ?? null);
}

/**
 * ⌥↑ / ⌥↓ on Today: the new order of `list` (the Today group), or null at the ends. Rows the filter hides
 * (`shown` false) are skipped: the task goes before the shown row above, or before the shown row after the next one
 * (else to the end), the same as a drop.
 */
export function todayMove(list: Task[], t: Task, dir: -1 | 1, shown: (t: Task) => boolean): Task[] | null {
  const same = (x: Task) => x.project === t.project && x.no === t.no;
  const s = list.filter((x) => same(x) || shown(x));
  const i = s.findIndex(same);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= s.length) return null;
  const before = dir < 0 ? s[j] : s[j + 1];
  const rest = list.filter((x) => !same(x));
  const at = before ? rest.indexOf(before) : rest.length;
  rest.splice(at, 0, list.find(same)!);
  return rest;
}
