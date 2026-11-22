import { test } from "node:test";
import assert from "node:assert/strict";
import type { RowBox } from "../../app/drag/dropTarget.ts";
import { liftMoved, mobileDrop } from "./mobileReorder.ts";

// Three top-level tasks of 48 px, then a section header and one task in it.
const rows: RowBox[] = [
  { kind: "task", key: "p/1", no: 1, depth: 0, parent: null, section: null, top: 0, bottom: 48 },
  { kind: "task", key: "p/2", no: 2, depth: 0, parent: null, section: null, top: 48, bottom: 96 },
  { kind: "task", key: "p/3", no: 3, depth: 0, parent: null, section: null, top: 96, bottom: 144 },
  { kind: "header", section: "今週", top: 144, bottom: 184 },
  { kind: "task", key: "p/4", no: 4, depth: 0, parent: null, section: "今週", top: 184, bottom: 232 },
];
const dragged = { key: "p/1", depth: 0, height: 0, subtree: new Set(["p/1"]) };

test("the middle of a row is a gap, not a drop onto it (no nesting by accident)", () => {
  // y 70 is inside row 2's middle half: on desktop that nests under 2; on the phone it is the gap above or below.
  const d = mobileDrop(rows, { x: 20, y: 70 }, 20, dragged, 0);
  assert.equal(d?.kind, "between");
});
test("below the middle of a row lands after it", () => {
  const d = mobileDrop(rows, { x: 20, y: 80 }, 20, dragged, 0);
  assert.deepEqual(d && d.kind === "between" ? [d.index, d.depth] : null, [2, 0]);
});
test("above the middle of a row lands before it", () => {
  const d = mobileDrop(rows, { x: 20, y: 110 }, 20, dragged, 0);
  assert.deepEqual(d && d.kind === "between" ? [d.index, d.depth] : null, [2, 0]);
});
test("into another section", () => {
  const d = mobileDrop(rows, { x: 20, y: 220 }, 20, dragged, 0);
  assert.deepEqual(d && d.kind === "between" ? [d.index, d.depth] : null, [5, 0]);
});

test("liftMoved: a few px of finger wobble is still a long press (opens the menu)", () => {
  assert.equal(liftMoved(3, 4), false);
  assert.equal(liftMoved(0, 12), true);
});
