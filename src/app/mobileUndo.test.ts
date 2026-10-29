import { test } from "node:test";
import assert from "node:assert/strict";
import { pushUndo, undoSteps, undoText, type MobileUndo } from "./mobileUndo.ts";
import { completedOf } from "./completionToast.ts";

const done = (project: string, no: number): MobileUndo => ({ kind: "complete", entries: [{ project, no }] });

test("push_merges_completions_and_replaces_other_kinds", () => {
  const two = pushUndo(done("仕事", 1), done("買い物", 4));
  assert.equal(undoText(two), "2 件のタスクを完了しました");
  assert.deepEqual(undoSteps(two).map((s) => `${s.op}:${s.project}/${s.no}`), ["complete:仕事/1", "complete:買い物/4"]);
  const date: MobileUndo = { kind: "date", entries: [{ project: "仕事", no: 2, before: { due: null, dueTime: null } }], label: "今日" };
  const replaced = pushUndo(two, date);
  assert.equal(replaced, date);
  assert.equal(undoSteps(replaced).length, 1);
  assert.equal(pushUndo(date, done("仕事", 1)).kind, "complete");
});

test("date_text_and_undo_restore_the_old_date", () => {
  const u: MobileUndo = { kind: "date", entries: [{ project: "仕事", no: 2, before: { due: "2026-10-20", dueTime: "09:00" } }], label: "今日" };
  assert.equal(undoText(u), "今日 にスケジュールしました");
  assert.deepEqual(undoSteps(u), [{ op: "update", project: "仕事", no: 2, patch: { due: "2026-10-20", dueTime: "09:00" } }]);
  assert.equal(undoText({ ...u, label: null }), "日付を削除しました");
});

test("bulk_reschedule_text", () => {
  const e = (no: number) => ({ project: "仕事", no, before: { due: "2026-10-10", dueTime: null } });
  assert.equal(undoText({ kind: "date", entries: [e(1), e(2)], label: "明日" }), "2 件のタスクを 明日 にスケジュールしました");
  assert.equal(undoText({ kind: "date", entries: [e(1), e(2)], label: null }), "2 件のタスクの日付を削除しました");
});

test("undo_move_targets_the_new_number", () => {
  const u: MobileUndo = { kind: "move", to: { project: "買い物", no: 21 }, back: { project: "仕事", section: "今週" }, toName: "買い物" };
  assert.equal(undoText(u), "買い物 に移動しました");
  assert.deepEqual(undoSteps(u), [{ op: "move", project: "買い物", no: 21, toProject: "仕事", toSection: "今週" }]);
});

test("complete_undo_of_a_recurring_task_reopens_then_restores", () => {
  const c = completedOf({ project: "仕事", no: 3, rrule: "FREQ=WEEKLY", due: "2026-10-13", dueTime: "09:00", reminders: ["-30m"] });
  assert.deepEqual(undoSteps({ kind: "complete", entries: [c] }), [
    { op: "complete", project: "仕事", no: 3, done: false },
    { op: "update", project: "仕事", no: 3, patch: { due: "2026-10-13", dueTime: "09:00", reminders: ["-30m"], rrule: "FREQ=WEEKLY" } },
  ]);
});
