import { test } from "node:test";
import assert from "node:assert/strict";
import { rowStateAfter } from "./rowState.ts";

test("row_state_drops_what_left_the_screen", () => {
  const s = { editing: "仕事/3", inserting: { project: "仕事", anchorNo: 4, where: "after" as const }, overlay: "仕事/5" };
  assert.deepEqual(rowStateAfter(["仕事/3", "仕事/4", "仕事/5"], s), s);
  assert.deepEqual(rowStateAfter(["仕事/4"], s), { editing: null, inserting: s.inserting, overlay: null });
  assert.deepEqual(rowStateAfter([], s), { editing: null, inserting: null, overlay: null });
});
