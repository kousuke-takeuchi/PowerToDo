import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange } from "./arrange.ts";
import { DEFAULTS } from "./viewOptions.ts";
import type { Task } from "../../types/model.ts";

let n = 0;
const t = (p: Partial<Task>): Task => ({
  no: ++n, project: "仕事", category: null, title: `t${n}`, assignee: "", priority: 4, progress: 0,
  labels: [], reminders: [], order: n, createdAt: "2026-10-20T09:00:00", ...p,
});
const ctx = { today: "2026-10-25", weekStart: "mon" as const, labelOrder: ["急ぎ", "家"], projectOrder: ["受信トレイ", "仕事"] };
const titles = (r: ReturnType<typeof arrange>) => r.groups.map((g) => [g.title, g.rows.map((x) => x.task.title)]);

test("manual_keeps_the_input_order", () => {
  const a = t({ title: "b" }), b = t({ title: "a" });
  assert.deepEqual(titles(arrange([a, b], DEFAULTS, ctx)), [["", ["b", "a"]]]);
});

test("sorts_by_name_date_added_priority_with_ties_in_manual_order", () => {
  const x = [t({ title: "い", due: "2026-10-27", priority: 2, createdAt: "2026-10-21T00:00:00" }),
             t({ title: "あ", priority: 1, createdAt: "2026-10-22T00:00:00" }),
             t({ title: "う", due: "2026-10-26", priority: 2, createdAt: "2026-10-20T00:00:00" })];
  const order = (sort: "name" | "date" | "added" | "priority", dir?: "asc" | "desc") =>
    arrange(x, { ...DEFAULTS, sort, dir: dir ?? (sort === "added" ? "desc" : "asc") }, ctx).groups[0].rows.map((r) => r.task.title);
  assert.deepEqual(order("name"), ["あ", "い", "う"]);
  assert.deepEqual(order("date"), ["う", "い", "あ"]);
  assert.deepEqual(order("date", "desc"), ["い", "う", "あ"]); // no date stays last
  assert.deepEqual(order("added"), ["あ", "い", "う"]);
  assert.deepEqual(order("priority"), ["あ", "い", "う"]); // い and う tie at P2: manual order
});

test("groups_by_date_priority_label_project", () => {
  const a = t({ title: "a", due: "2026-10-24", labels: ["家", "急ぎ"] });
  const b = t({ title: "b", due: "2026-10-25", priority: 1, project: "受信トレイ" });
  const c = t({ title: "c" });
  assert.deepEqual(titles(arrange([a, b, c], { ...DEFAULTS, group: "date" }, ctx)), [["期限切れ", ["a"]], ["今日", ["b"]], ["日付なし", ["c"]]]);
  assert.deepEqual(titles(arrange([a, b, c], { ...DEFAULTS, group: "priority" }, ctx)), [["優先度 1", ["b"]], ["優先度 4", ["a", "c"]]]);
  const byLabel = arrange([a, b, c], { ...DEFAULTS, group: "label" }, ctx);
  assert.deepEqual(titles(byLabel), [["急ぎ", ["a"]], ["家", ["a"]], ["ラベルなし", ["b", "c"]]]);
  assert.equal(new Set(byLabel.groups.flatMap((g) => g.rows.map((r) => r.key))).size, 4);
  assert.deepEqual(titles(arrange([a, b, c], { ...DEFAULTS, group: "project" }, ctx)), [["受信トレイ", ["b"]], ["仕事", ["a", "c"]]]);
});

test("arrange_week_starts_on_the_setting", () => {
  // 2026-10-25 is a Sunday.
  const sun = t({ title: "sun", due: "2026-10-25" }), sat = t({ title: "sat", due: "2026-10-31" }), mon = t({ title: "mon", due: "2026-10-26" });
  const week = (weekStart: "mon" | "sun") => arrange([sun, sat, mon], { ...DEFAULTS, date: "week" }, { ...ctx, weekStart }).groups[0].rows.map((r) => r.task.title);
  assert.deepEqual(week("sun"), ["sun", "sat", "mon"]);
  assert.deepEqual(week("mon"), ["sun"]); // Mon 10-19 .. Sun 10-25
});

test("arrange_filters_by_the_parent_and_counts_hidden", () => {
  const p = t({ title: "p", priority: 4 });
  const c = t({ title: "c", priority: 1, parentNo: p.no });
  const q = t({ title: "q", priority: 1 });
  const r = arrange([p, c, q], { ...DEFAULTS, prio: 1 }, ctx);
  assert.deepEqual(titles(r), [["", ["q"]]]);
  assert.equal(r.hidden, 1);
});

test("filters_dates_created_and_done", () => {
  const today = t({ title: "today", due: "2026-10-25" }), later = t({ title: "later", due: "2026-11-30" }), none = t({ title: "none" });
  const old = t({ title: "old", createdAt: "2026-09-01T00:00:00" });
  const done = t({ title: "done", progress: 100 });
  const pick = (o: Partial<typeof DEFAULTS>) => titles(arrange([today, later, none, old, done], { ...DEFAULTS, ...o }, ctx));
  assert.deepEqual(pick({ date: "today" }), [["", ["today"]]]);
  assert.deepEqual(pick({ date: "30d" }), [["", ["today"]]]);
  assert.deepEqual(pick({ date: "none" }), [["", ["none", "old"]]]);
  assert.deepEqual(pick({ created: "7d" }), [["", ["today", "later", "none"]]]);
  assert.deepEqual(pick({ done: true }), [["", ["today", "later", "none", "old"]], ["完了", ["done"]]]);
});

test("filters_apply_to_the_done_group_too", () => {
  const open = t({ title: "open", priority: 1 }), openP4 = t({ title: "openP4", priority: 4 });
  const doneP4 = t({ title: "doneP4", priority: 4, progress: 100 }), doneP1 = t({ title: "doneP1", priority: 1, progress: 100 });
  const r = arrange([open, openP4, doneP4, doneP1], { ...DEFAULTS, prio: 1, done: true }, ctx);
  assert.deepEqual(titles(r), [["", ["open"]], ["完了", ["doneP1"]]]);
  assert.equal(r.hidden, 1);
});
