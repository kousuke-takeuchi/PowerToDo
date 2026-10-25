import { test } from "node:test";
import assert from "node:assert/strict";
import { indentMove, outdentMove, siblingMove, todayMove } from "./keyMoves.ts";
import type { Task } from "../../types/model.ts";

const t = (no: number, order: number, parentNo?: number, category: string | null = null): Task => ({
  no, order, parentNo, category, project: "p", title: String(no), assignee: "", priority: 4, progress: 0, labels: [], reminders: [], createdAt: "",
});
const none: string[] = [];
const tasks = [t(1, 1), t(2, 2), t(3, 1, 2), t(4, 3)];

test("sibling_moves_swap_with_the_neighbour", () => {
  assert.deepEqual(siblingMove(tasks, 2, -1, none), { section: null, parent: null, before: 1 });
  assert.deepEqual(siblingMove(tasks, 2, 1, none), { section: null, parent: null, before: null });
  assert.equal(siblingMove(tasks, 1, -1, none), null);
  assert.equal(siblingMove(tasks, 4, 1, none), null);
  assert.equal(siblingMove(tasks, 3, 1, none), null);
});

test("indent_goes_under_the_sibling_above_and_outdent_after_the_parent", () => {
  assert.deepEqual(indentMove(tasks, 4, none), { section: null, parent: 2, before: null });
  assert.equal(indentMove(tasks, 1, none), null);
  assert.deepEqual(outdentMove(tasks, 3, none), { section: null, parent: null, before: 4 });
  assert.equal(outdentMove(tasks, 1, none), null);
});

test("completed_top_level_tasks_are_no_siblings", () => {
  const done = { ...t(1, 1), progress: 100 };
  const ts = [done, t(2, 2), t(3, 3)];
  assert.equal(siblingMove(ts, 2, -1, none), null);
  assert.equal(indentMove(ts, 2, none), null);
  assert.deepEqual(siblingMove(ts, 3, -1, none), { section: null, parent: null, before: 2 });
  // A completed top-level task itself does not move by keys.
  assert.equal(siblingMove(ts, 1, 1, none), null);
  assert.equal(indentMove([t(2, 0), done], 1, none), null);
});

test("order_ties_keep_the_array_order", () => {
  const ts = [t(6, 1), t(5, 1)];
  assert.deepEqual(siblingMove(ts, 5, -1, none), { section: null, parent: null, before: 6 });
  assert.equal(siblingMove(ts, 6, -1, none), null);
});

test("a_category_that_is_no_section_counts_as_unsectioned", () => {
  // 2 carries a カテゴリ typed in Excel; the screen shows it among the unsectioned rows.
  const ts = [t(1, 1), t(2, 2, undefined, "迷子"), t(3, 3), t(4, 1, 2, "迷子"), t(5, 1, undefined, "会議")];
  const known = ["会議"];
  assert.deepEqual(siblingMove(ts, 3, -1, known), { section: null, parent: null, before: 2 });
  assert.deepEqual(siblingMove(ts, 2, -1, known), { section: null, parent: null, before: 1 });
  assert.deepEqual(siblingMove(ts, 1, 1, known), { section: null, parent: null, before: 3 });
  assert.equal(siblingMove(ts, 3, 1, known), null);
  assert.deepEqual(indentMove(ts, 3, known), { section: null, parent: 2, before: null });
  assert.deepEqual(indentMove(ts, 2, known), { section: null, parent: 1, before: null });
  assert.deepEqual(outdentMove(ts, 4, known), { section: null, parent: null, before: 3 });
  // A known section stays its own group.
  assert.equal(siblingMove(ts, 5, -1, known), null);
  assert.deepEqual(indentMove(ts, 5, known), null);
});

test("sibling_moves_skip_rows_the_filter_hides", () => {
  // Filter P1: 2 is hidden. A move swaps with the nearest shown sibling, as a drop does.
  const ts = [{ ...t(1, 1), priority: 1 as const }, t(2, 2), { ...t(3, 3), priority: 1 as const }, { ...t(4, 4), priority: 1 as const }];
  const shown = (x: Task) => x.priority === 1;
  assert.deepEqual(siblingMove(ts, 1, 1, none, shown), { section: null, parent: null, before: 4 });
  assert.deepEqual(siblingMove(ts, 3, -1, none, shown), { section: null, parent: null, before: 1 });
  assert.equal(siblingMove(ts, 1, -1, none, shown), null);
  assert.equal(siblingMove(ts, 4, 1, none, shown), null);
});

test("today_moves_skip_rows_the_filter_hides", () => {
  const a = { ...t(1, 1), priority: 1 as const };
  const b = t(2, 2);
  const c = { ...t(3, 3), priority: 1 as const };
  const shown = (x: Task) => x.priority === 1;
  const nos = (l: Task[] | null) => l?.map((x) => x.no) ?? null;
  assert.deepEqual(nos(todayMove([a, b, c], a, 1, shown)), [2, 3, 1]);
  assert.deepEqual(nos(todayMove([a, b, c], c, -1, shown)), [3, 1, 2]);
  assert.equal(todayMove([a, b, c], a, -1, shown), null);
  assert.equal(todayMove([a, b, c], c, 1, shown), null);
  const d = { ...t(4, 4), priority: 1 as const };
  assert.deepEqual(nos(todayMove([a, b, c, d], a, 1, shown)), [2, 3, 1, 4]);
  // Nothing hidden: a plain swap.
  assert.deepEqual(nos(todayMove([a, b, c], a, 1, () => true)), [2, 1, 3]);
});
