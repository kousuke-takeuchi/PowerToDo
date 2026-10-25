import { test } from "node:test";
import assert from "node:assert/strict";
import { completedOf, merge, nextNotice, noticeText, toastText, undoOf } from "./completionToast.ts";

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
    kind: "restore",
    project: "仕事",
    no: 2,
    patch: { due: "2026-10-25", dueTime: "09:00", reminders: ["-0m"], rrule: "FREQ=WEEKLY" },
  });
});

// The last occurrence (COUNT / UNTIL used up): complete_task drops the rule and marks the task done. Undo must reopen
// it and put the rule back, not only the date.
test("undoOf_last_occurrence_reopens_and_restores_the_rule", () => {
  const c = completedOf({ project: "仕事", no: 5, rrule: "FREQ=DAILY;COUNT=1", due: "2026-10-25", reminders: [] });
  const u = undoOf(c);
  assert.equal(u.kind, "restore");
  assert.equal(u.kind === "restore" && u.patch.rrule, "FREQ=DAILY;COUNT=1");
});

test("completedOf_plain_has_no_before", () => {
  assert.equal(completedOf({ project: "仕事", no: 3, reminders: [] }).before, undefined);
});

test("completions_add_up_and_a_note_replaces_them", () => {
  let n = nextNotice(null, { done: { project: "仕事", no: 1 } });
  n = nextNotice(n, { done: { project: "仕事", no: 2 } });
  assert.equal(noticeText(n), "2 件のタスクを完了しました");
  n = nextNotice(n, { text: "タスクを複製しました", action: "元に戻す", id: 1 });
  assert.equal(noticeText(n), "タスクを複製しました");
  n = nextNotice(n, { done: { project: "仕事", no: 3 } });
  assert.equal(noticeText(n), "1 件のタスクを完了しました");
});
