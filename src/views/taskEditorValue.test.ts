import { test } from "node:test";
import assert from "node:assert/strict";
import { blankValue, changed, editBase, editorValueOf, insertTarget, moveOf, submitKey, toInput, toPatch } from "./taskEditorValue.ts";
import type { Task } from "../types/model.ts";

const task: Task = {
  no: 3, project: "仕事", category: "会議", title: "資料を作る", assignee: "たろう", priority: 2, progress: 0,
  due: "2026-10-26", dueTime: "15:00", note: "表を入れる", labels: ["急ぎ"], reminders: ["-30m"], order: 1, createdAt: "2026-10-25T09:00:00",
};

test("value_of_a_task_round_trips_without_changes", () => {
  const v = editorValueOf(task);
  assert.equal(v.section, "会議");
  assert.equal(changed(v, editorValueOf(task)), false);
  assert.deepEqual(toPatch(v, v), {});
});

test("patch_has_only_the_changed_fields_and_clears_with_null", () => {
  const v = editorValueOf(task);
  const w = { ...v, title: "資料を直す", due: undefined, dueTime: undefined, labels: [] };
  assert.deepEqual(toPatch(v, w), { title: "資料を直す", due: null, dueTime: null, labels: [] });
});

test("project_and_section_go_through_a_move_not_the_patch", () => {
  const v = editorValueOf(task);
  const w = { ...v, project: "買い物", section: null };
  assert.deepEqual(toPatch(v, w), {});
  assert.deepEqual(moveOf(v, w), { project: "買い物", section: null });
  assert.equal(moveOf(v, v), null);
});

test("blank_value_takes_defaults_and_input_trims", () => {
  const v = blankValue("受信トレイ", null, { due: "2026-10-25" });
  assert.equal(v.priority, 4);
  assert.equal(changed(v, blankValue("受信トレイ", null, { due: "2026-10-25" })), false);
  const input = toInput({ ...v, title: "  牛乳を買う ", note: "" }, 7);
  assert.deepEqual(input, { title: "牛乳を買う", section: null, priority: 4, due: "2026-10-25", dueTime: null, note: null, labels: [], parentNo: 7, rrule: null, reminders: [] });
});

test("enter_submits_from_the_title_but_not_while_composing", () => {
  const base = { metaKey: false, ctrlKey: false, shiftKey: false };
  assert.equal(submitKey({ ...base, key: "Enter" }, "title"), "submit");
  assert.equal(submitKey({ ...base, key: "Enter", isComposing: true }, "title"), null);
  assert.equal(submitKey({ ...base, key: "Enter", keyCode: 229 }, "title"), null);
  assert.equal(submitKey({ ...base, key: "Enter" }, "note"), null);
  assert.equal(submitKey({ ...base, key: "Enter", metaKey: true }, "note"), "submit");
});

test("insert_keeps_the_position_only_in_the_anchor_s_place", () => {
  const v = blankValue("仕事", "会議");
  assert.deepEqual(insertTarget(task, v, "after"), { position: { after: 3 }, follow: true });
  assert.deepEqual(insertTarget(task, v, "before"), { position: { before: 3 }, follow: true });
  assert.deepEqual(insertTarget(task, { ...v, project: "買い物", section: null }, "after"), { follow: false });
  assert.deepEqual(insertTarget(task, { ...v, section: null }, "after"), { follow: false });
});

test("edit_base_is_the_value_when_editing_began", () => {
  const first = editBase(null, true, task);
  const synced = { ...task, due: "2026-11-01" };
  assert.equal(editBase(first, true, synced), first);
  assert.equal(editBase(first, true, synced).due, "2026-10-26");
  assert.equal(editBase(first, false, synced), null);
});
