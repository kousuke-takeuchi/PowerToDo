export type Screen = "project" | "today" | "upcoming" | "label";
export type SortKey = "manual" | "name" | "date" | "added" | "priority";
export type GroupKey = "none" | "date" | "added" | "priority" | "label" | "project";
export type DateFilter = "all" | "today" | "week" | "7d" | "month" | "30d" | "none";
export type CreatedFilter = "all" | "today" | "7d" | "30d";
export type ViewOptions = {
  layout: "list" | "board";
  done: boolean;
  group: GroupKey;
  sort: SortKey;
  dir: "asc" | "desc";
  date: DateFilter;
  created: CreatedFilter;
  prio: "all" | 1 | 2 | 3 | 4;
};

export const naturalDir = (sort: SortKey): "asc" | "desc" => (sort === "added" ? "desc" : "asc");
/** Changing the sort resets the direction to that sort's natural one. */
export const withSort = (o: ViewOptions, sort: SortKey): ViewOptions => ({ ...o, sort, dir: naturalDir(sort) });
export const DEFAULTS: ViewOptions = { layout: "list", done: false, group: "none", sort: "manual", dir: "asc", date: "all", created: "all", prio: "all" };

const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined => (allowed as readonly string[]).includes(v ?? "") ? (v as T) : undefined;

export function parseView(text: string | undefined): ViewOptions {
  const m = new Map((text ?? "").split(";").map((p) => p.split("=") as [string, string]).filter((p) => p.length === 2));
  const sort = pick(m.get("sort"), ["manual", "name", "date", "added", "priority"] as const) ?? "manual";
  const prio = m.get("prio");
  return {
    layout: pick(m.get("layout"), ["list", "board"] as const) ?? "list",
    done: m.get("done") === "1",
    group: pick(m.get("group"), ["none", "date", "added", "priority", "label", "project"] as const) ?? "none",
    sort,
    dir: pick(m.get("dir"), ["asc", "desc"] as const) ?? naturalDir(sort),
    date: pick(m.get("date"), ["all", "today", "week", "7d", "month", "30d", "none"] as const) ?? "all",
    created: pick(m.get("created"), ["all", "today", "7d", "30d"] as const) ?? "all",
    prio: prio === "1" || prio === "2" || prio === "3" || prio === "4" ? (Number(prio) as 1 | 2 | 3 | 4) : "all",
  };
}

export function formatView(o: ViewOptions): string {
  const parts: string[] = [];
  if (o.layout !== "list") parts.push(`layout=${o.layout}`);
  if (o.done) parts.push("done=1");
  if (o.group !== "none") parts.push(`group=${o.group}`);
  if (o.sort !== "manual") parts.push(`sort=${o.sort}`);
  if (o.sort !== "manual" && o.dir !== naturalDir(o.sort)) parts.push(`dir=${o.dir}`);
  if (o.date !== "all") parts.push(`date=${o.date}`);
  if (o.created !== "all") parts.push(`created=${o.created}`);
  if (o.prio !== "all") parts.push(`prio=${o.prio}`);
  return parts.join(";");
}

export const isDefault = (o: ViewOptions) => formatView(o) === "";

export function viewKey(screen: Screen, name?: string): string {
  if (screen === "project") return `表示:プロジェクト:${name}`;
  if (screen === "label") return `表示:ラベル:${name}`;
  return screen === "today" ? "表示:今日" : "表示:近日";
}

export const ALLOWED: Record<Screen, { layout: boolean; done: boolean; groups: GroupKey[]; filters: ("date" | "created" | "prio")[] }> = {
  project: { layout: true, done: true, groups: ["none", "date", "added", "priority", "label"], filters: ["date", "created", "prio"] },
  today: { layout: false, done: false, groups: ["none", "priority", "label", "project"], filters: ["prio"] },
  upcoming: { layout: false, done: false, groups: ["none"], filters: ["prio"] },
  label: { layout: false, done: true, groups: ["none", "date", "priority", "project"], filters: ["date", "prio"] },
};

export function sanitize(screen: Screen, o: ViewOptions): ViewOptions {
  const a = ALLOWED[screen];
  return {
    ...o,
    layout: a.layout ? o.layout : "list",
    done: a.done ? o.done : false,
    group: a.groups.includes(o.group) ? o.group : "none",
    date: a.filters.includes("date") ? o.date : "all",
    created: a.filters.includes("created") ? o.created : "all",
    prio: a.filters.includes("prio") ? o.prio : "all",
  };
}
