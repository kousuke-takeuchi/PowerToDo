import type { Task } from "../../types/model";
import type { ViewOptions } from "./viewOptions";

export type ArrangedRow = { key: string; task: Task };
export type ArrangedGroup = { key: string; title: string; rows: ArrangedRow[] };
export type ArrangeCtx = { today: string; weekStart: "mon" | "sun"; labelOrder: string[]; projectOrder: string[] };

const DAY = 86_400_000;
const num = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / DAY;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const dayTitle = (d: string) => `${+d.slice(5, 7)}月${+d.slice(8, 10)}日 · ${WEEKDAYS[new Date(num(d) * DAY).getUTCDay()]}曜日`;

function dateOk(t: Task, f: ViewOptions["date"], c: ArrangeCtx): boolean {
  if (f === "all") return true;
  if (f === "none") return !t.due;
  if (!t.due) return false;
  const d = num(t.due), today = num(c.today);
  const dow = new Date(today * DAY).getUTCDay();
  const weekFirst = today - ((dow - (c.weekStart === "mon" ? 1 : 0) + 7) % 7);
  switch (f) {
    case "today": return d === today;
    case "week": return d >= weekFirst && d < weekFirst + 7;
    case "7d": return d >= today && d < today + 7;
    case "30d": return d >= today && d < today + 30;
    case "month": return t.due.slice(0, 7) === c.today.slice(0, 7);
  }
  return true;
}

function createdOk(t: Task, f: ViewOptions["created"], c: ArrangeCtx): boolean {
  if (f === "all") return true;
  const d = num(t.createdAt.slice(0, 10)), today = num(c.today);
  return f === "today" ? d === today : d > today - (f === "7d" ? 7 : 30);
}

function compare(a: Task, b: Task, o: ViewOptions): number {
  const sign = o.dir === "asc" ? 1 : -1;
  switch (o.sort) {
    case "name": return sign * a.title.localeCompare(b.title, "ja");
    case "date":
      if (!a.due || !b.due) return a.due ? -1 : b.due ? 1 : 0; // no date last either way
      return sign * (num(a.due) - num(b.due));
    case "added": return sign * a.createdAt.localeCompare(b.createdAt);
    case "priority": return sign * (a.priority - b.priority);
    default: return 0;
  }
}

/** Spec ⑤ §3: filters, then sort (stable: ties keep the input = manual order), then groups. Top-level tasks only. */
export function arrange(tasks: Task[], o: ViewOptions, c: ArrangeCtx): { groups: ArrangedGroup[]; hidden: number } {
  const top = tasks.filter((t) => t.parentNo === undefined);
  const done = top.filter((t) => t.progress === 100);
  const open = top.filter((t) => t.progress !== 100);
  const keep = (t: Task) => dateOk(t, o.date, c) && createdOk(t, o.created, c) && (o.prio === "all" || t.priority === o.prio);
  const shown = open.filter(keep);
  const hidden = open.length - shown.length;
  const sorted = [...shown].sort((a, b) => compare(a, b, o));
  const row = (g: string, t: Task): ArrangedRow => ({ key: `${g}/${t.project}/${t.no}`, task: t });
  const groups: ArrangedGroup[] = [];
  const add = (key: string, title: string, list: Task[]) => { if (list.length) groups.push({ key, title, rows: list.map((t) => row(key, t)) }); };

  if (o.group === "none") add("all", "", sorted);
  else if (o.group === "priority") for (const p of [1, 2, 3, 4]) add(`p${p}`, `優先度 ${p}`, sorted.filter((t) => t.priority === p));
  else if (o.group === "label") {
    for (const l of c.labelOrder) add(`l:${l}`, l, sorted.filter((t) => t.labels.includes(l)));
    const known = new Set(c.labelOrder);
    for (const l of [...new Set(sorted.flatMap((t) => t.labels))].filter((l) => !known.has(l))) add(`l:${l}`, l, sorted.filter((t) => t.labels.includes(l)));
    add("l:", "ラベルなし", sorted.filter((t) => t.labels.length === 0));
  } else if (o.group === "project") {
    const names = [...c.projectOrder, ...new Set(sorted.map((t) => t.project).filter((p) => !c.projectOrder.includes(p)))];
    for (const p of names) add(`p:${p}`, p, sorted.filter((t) => t.project === p));
  } else if (o.group === "date") {
    const today = num(c.today);
    add("d:over", "期限切れ", sorted.filter((t) => t.due && num(t.due) < today));
    const dates = [...new Set(sorted.filter((t) => t.due && num(t.due) >= today).map((t) => t.due!))].sort();
    for (const d of dates) add(`d:${d}`, num(d) === today ? "今日" : num(d) === today + 1 ? "明日" : dayTitle(d), sorted.filter((t) => t.due === d));
    add("d:none", "日付なし", sorted.filter((t) => !t.due));
  } else if (o.group === "added") {
    const today = num(c.today);
    const dates = [...new Set(sorted.map((t) => t.createdAt.slice(0, 10)))].sort().reverse();
    for (const d of dates) add(`a:${d}`, num(d) === today ? "今日" : num(d) === today - 1 ? "昨日" : dayTitle(d), sorted.filter((t) => t.createdAt.startsWith(d)));
  }
  if (o.done) add("done", "完了", done.filter(keep));
  return { groups, hidden };
}

/** The `ArrangedRow.key`s that are the first row of their task (`project/no`) across the groups. Only these carry `data-row`. */
export function firstOccurrences(groups: ArrangedGroup[]): Set<string> {
  const seen = new Set<string>();
  const first = new Set<string>();
  for (const g of groups)
    for (const r of g.rows) {
      const id = `${r.task.project}/${r.task.no}`;
      if (seen.has(id)) continue;
      seen.add(id);
      first.add(r.key);
    }
  return first;
}

/** Cross-list screens (Today / Upcoming / a label) show subtasks as flat rows: arrange them like top-level tasks, return the originals. */
export function arrangeFlat(tasks: Task[], o: ViewOptions, c: ArrangeCtx): { groups: ArrangedGroup[]; hidden: number } {
  const orig = new Map(tasks.map((x) => [`${x.project}/${x.no}`, x]));
  const r = arrange(tasks.map((x) => (x.parentNo === undefined ? x : { ...x, parentNo: undefined })), o, c);
  return { hidden: r.hidden, groups: r.groups.map((g) => ({ ...g, rows: g.rows.map((x) => ({ ...x, task: orig.get(`${x.task.project}/${x.task.no}`)! })) })) };
}
