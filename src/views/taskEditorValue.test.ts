import { test } from "node:test";
import assert from "node:assert/strict";
import { applyParsed, shouldParse, blankValue, changed, editBase, editorValueOf, insertTarget, moveOf, submitKey, toInput, toPatch } from "./taskEditorValue.ts";
import type { QuickAddResult, Task } from "../types/model.ts";

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

const none: QuickAddResult = { title: "牛乳を買う", due: null, dueTime: null, rrule: null, priority: null, project: null, labels: [], spans: [] };

test("applyParsed_without_tokens_only_sets_the_title", () => {
  const v = { ...blankValue("受信トレイ", null), title: "牛乳を買う", due: "2026-10-26", priority: 2 as const, labels: ["a"] };
  assert.deepEqual(applyParsed(v, none), v);
});

test("applyParsed_replaces_only_fields_with_a_token", () => {
  const v = { ...blankValue("受信トレイ", "S"), title: "牛乳を買う 毎週水曜 10:00 p1 @急ぎ", due: "2026-10-26", dueTime: "09:00", priority: 3 as const, labels: ["a"], rrule: "FREQ=DAILY" };
  const r: QuickAddResult = { ...none, due: "2026-11-25", dueTime: "10:00", rrule: "FREQ=WEEKLY;BYDAY=WE", priority: 1, labels: ["急ぎ", "a"] };
  const o = applyParsed(v, r);
  assert.deepEqual([o.title, o.due, o.dueTime, o.rrule, o.priority, o.labels, o.section], ["牛乳を買う", "2026-11-25", "10:00", "FREQ=WEEKLY;BYDAY=WE", 1, ["a", "急ぎ"], "S"]);
});

test("applyParsed_keeps_chip_values_the_text_does_not_mention", () => {
  const v = { ...blankValue("受信トレイ", null), title: "x 明日", due: "2026-10-26", dueTime: "09:00", priority: 2 as const, rrule: "FREQ=DAILY" };
  const o = applyParsed(v, { ...none, title: "x", due: "2026-10-27" });
  assert.deepEqual([o.due, o.dueTime, o.priority, o.rrule], ["2026-10-27", "09:00", 2, "FREQ=DAILY"]);
});

test("applyParsed_moves_to_a_known_project_and_ignores_unknown_ones", () => {
  const v = { ...blankValue("受信トレイ", "S"), title: "x #仕事" };
  const o = applyParsed(v, { ...none, title: "x", project: "仕事" }, ["受信トレイ", "仕事"]);
  assert.deepEqual([o.project, o.section], ["仕事", null]);
  assert.deepEqual(applyParsed(v, { ...none, title: "x", project: "ない" }, ["仕事"]).project, "受信トレイ");
});

test("applyParsed_keeps_a_project_word_it_cannot_move_to_in_the_title", () => {
  // "買う #仕事 明日 p1": a subtask editor (no project list) strips the date and priority but keeps "#仕事".
  const v = { ...blankValue("受信トレイ", null), title: "買う #仕事 明日 p1" };
  const r: QuickAddResult = {
    ...none, title: "買う", project: "仕事", due: "2026-10-27", priority: 1,
    spans: [{ start: 3, end: 6, kind: "project" }, { start: 7, end: 9, kind: "date" }, { start: 10, end: 12, kind: "priority" }],
  };
  const o = applyParsed(v, r);
  assert.deepEqual([o.title, o.project, o.due, o.priority], ["買う #仕事", "受信トレイ", "2026-10-27", 1]);
  assert.equal(applyParsed(v, r, ["受信トレイ", "仕事"]).title, "買う");
});

test("applyParsed_keeps_the_text_when_nothing_would_be_left", () => {
  const v = { ...blankValue("受信トレイ", null), title: "明日" };
  assert.equal(applyParsed(v, { ...none, title: "", due: "2026-10-27" }), v);
});

test("shouldParse_always_when_adding_and_only_for_a_changed_title_when_editing", () => {
  assert.equal(shouldParse("add", "x", ""), true);
  assert.equal(shouldParse("add", "  ", ""), false);
  assert.equal(shouldParse("edit", "資料", "資料"), false);
  assert.equal(shouldParse("edit", "資料 明日", "資料"), true);
});
