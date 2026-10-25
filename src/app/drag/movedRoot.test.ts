import { test } from "node:test";
import assert from "node:assert/strict";
import { movedRootNo } from "./movedRoot.ts";
import type { Task } from "../../types/model.ts";

const t = (no: number, parentNo?: number): Task => ({
  no, order: no, parentNo, category: null, project: "q", title: String(no), assignee: "", priority: 4, progress: 0, labels: [], reminders: [], createdAt: "",
});

test("moved_root_is_the_parentless_task_among_the_new_nos", () => {
  // Target had 1..3; the moved subtree (root + 2 subtasks) got 4, 5, 6 in file order.
  const after = [t(1), t(2), t(3, 2), t(4), t(5, 4), t(6, 5)];
  assert.equal(movedRootNo(after, 3), 4);
  // A single task: the highest No.
  assert.equal(movedRootNo([t(1), t(2)], 1), 2);
  // subtree.size overcounting reaches an existing top-level task: the higher parentless No. (the moved root) wins.
  assert.equal(movedRootNo(after, 5), 4);
  // Undercount: the root falls outside the top Nos; still the highest parentless task.
  assert.equal(movedRootNo(after, 1), 4);
  assert.equal(movedRootNo([], 1), undefined);
});
