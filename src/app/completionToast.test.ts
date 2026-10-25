import { test } from "node:test";
import assert from "node:assert/strict";
import { completedOf, merge, toastText, undoOf } from "./completionToast.ts";

test("merge_counts_and_keeps_every_entry", () => {
  let s = merge(null, { project: "仕事", no: 1 });
  assert.equal(toastText(s), "1 件のタスクを完了しました");
  s = merge(s, { project: "買い物", no: 4 });
  assert.equal(toastText(s), "2 件のタスクを完了しました");
  assert.deepEqual(s.entries.map((e) => `${e.project}/${e.no}`), ["仕事/1", "買い物/4"]);
});

test("merge_same_task_twice_keeps_one", () => {
  const s = merge(merge(null, { project: "仕事", no: 1 }), { project: "仕事", no: 1 });
  assert.equal(s.entries.length, 1);
});

test("undoOf_plain_completes_false", () => {
  assert.deepEqual(undoOf({ project: "買い物", no: 4 }), { kind: "complete", project: "買い物", no: 4, done: false });
});

test("undoOf_recurring_restores_the_date", () => {
  const c = completedOf({ project: "仕事", no: 2, rrule: "FREQ=WEEKLY", due: "2026-10-25", dueTime: "09:00", reminders: ["-0m"] });
  assert.deepEqual(undoOf(c), {
    kind: "update",
    project: "仕事",
    no: 2,
    patch: { due: "2026-10-25", dueTime: "09:00", reminders: ["-0m"] },
  });
});

test("completedOf_plain_has_no_before", () => {
  assert.equal(completedOf({ project: "仕事", no: 3, reminders: [] }).before, undefined);
});
