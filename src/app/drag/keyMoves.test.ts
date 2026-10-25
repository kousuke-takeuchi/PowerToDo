import { test } from "node:test";
import assert from "node:assert/strict";
import { indentMove, outdentMove, siblingMove } from "./keyMoves.ts";
import type { Task } from "../../types/model.ts";

const t = (no: number, order: number, parentNo?: number, category: string | null = null): Task => ({
  no, order, parentNo, category, project: "p", title: String(no), assignee: "", priority: 4, progress: 0, labels: [], reminders: [], createdAt: "",
});
const tasks = [t(1, 1), t(2, 2), t(3, 1, 2), t(4, 3)];

test("sibling_moves_swap_with_the_neighbour", () => {
  assert.deepEqual(siblingMove(tasks, 2, -1), { section: null, parent: null, before: 1 });
  assert.deepEqual(siblingMove(tasks, 2, 1), { section: null, parent: null, before: null });
  assert.equal(siblingMove(tasks, 1, -1), null);
  assert.equal(siblingMove(tasks, 4, 1), null);
  assert.equal(siblingMove(tasks, 3, 1), null);
});

test("indent_goes_under_the_sibling_above_and_outdent_after_the_parent", () => {
  assert.deepEqual(indentMove(tasks, 4), { section: null, parent: 2, before: null });
  assert.equal(indentMove(tasks, 1), null);
  assert.deepEqual(outdentMove(tasks, 3), { section: null, parent: null, before: 4 });
  assert.equal(outdentMove(tasks, 1), null);
});

test("completed_top_level_tasks_are_no_siblings", () => {
  const done = { ...t(1, 1), progress: 100 };
  const ts = [done, t(2, 2), t(3, 3)];
  assert.equal(siblingMove(ts, 2, -1), null);
  assert.equal(indentMove(ts, 2), null);
  assert.deepEqual(siblingMove(ts, 3, -1), { section: null, parent: null, before: 2 });
  // A completed top-level task itself does not move by keys.
  assert.equal(siblingMove(ts, 1, 1), null);
  assert.equal(indentMove([t(2, 0), done], 1), null);
});

test("order_ties_keep_the_array_order", () => {
  const ts = [t(6, 1), t(5, 1)];
  assert.deepEqual(siblingMove(ts, 5, -1), { section: null, parent: null, before: 6 });
  assert.equal(siblingMove(ts, 6, -1), null);
});
