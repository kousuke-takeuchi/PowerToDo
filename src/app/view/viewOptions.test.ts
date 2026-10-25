import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, formatView, isDefault, mergePending, naturalDir, parseView, sanitize, viewKey, withSort } from "./viewOptions.ts";

test("defaults_write_nothing_and_unknown_parts_are_ignored", () => {
  assert.equal(formatView(DEFAULTS), "");
  assert.ok(isDefault(parseView("")));
  assert.deepEqual(parseView("sort=name;color=red;group=weird"), { ...DEFAULTS, sort: "name", dir: "asc" });
});

test("round_trip_and_natural_direction", () => {
  const o = { ...DEFAULTS, layout: "board" as const, done: true, group: "label" as const, sort: "added" as const, dir: naturalDir("added"), date: "7d" as const, prio: 2 as const };
  assert.equal(formatView(o), "layout=board;done=1;group=label;sort=added;date=7d;prio=2");
  assert.deepEqual(parseView(formatView(o)), o);
  assert.equal(formatView({ ...o, dir: "asc" }), "layout=board;done=1;group=label;sort=added;dir=asc;date=7d;prio=2");
});

test("keys_and_per_screen_options", () => {
  assert.equal(viewKey("project", "仕事"), "表示:プロジェクト:仕事");
  assert.equal(viewKey("today"), "表示:今日");
  assert.equal(viewKey("upcoming"), "表示:近日");
  assert.equal(viewKey("label", "急ぎ"), "表示:ラベル:急ぎ");
  const s = sanitize("upcoming", { ...DEFAULTS, layout: "board", group: "label", done: true, date: "7d", prio: 1 });
  assert.deepEqual(s, { ...DEFAULTS, prio: 1 });
});

test("withSort resets the direction to the natural one of the new sort", () => {
  const desc = { ...DEFAULTS, sort: "name" as const, dir: "desc" as const };
  assert.equal(withSort(desc, "added").dir, "desc");
  assert.equal(withSort(desc, "date").dir, "asc");
  assert.equal(withSort(desc, "priority").sort, "priority");
});

test("pending_writes_win_over_a_fresh_load_until_they_settle", () => {
  const loaded = { "表示:今日": "group=label", "表示:近日": "sort=name", "表示:ラベル:x": "prio=1" };
  const pending = new Map([
    ["表示:今日", "group=priority"], // changed, not yet saved
    ["表示:近日", ""], // reset to defaults, row not yet removed
    ["表示:プロジェクト:a", "layout=board"], // new row, not yet saved
  ]);
  assert.deepEqual(mergePending(loaded, pending), {
    "表示:今日": "group=priority",
    "表示:ラベル:x": "prio=1",
    "表示:プロジェクト:a": "layout=board",
  });
  assert.deepEqual(loaded["表示:近日"], "sort=name", "the loaded rows are not changed");
  assert.deepEqual(mergePending(loaded, new Map()), loaded);
});
