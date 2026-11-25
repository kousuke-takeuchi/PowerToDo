import { test } from "node:test";
import assert from "node:assert/strict";
import type { RowBox } from "../../app/drag/dropTarget.ts";
import { beforeKeyOf, liftMoved, mobileDrop, reordered, sectionAt } from "./mobileReorder.ts";

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

// Today / Upcoming (cross lists): keys are project/no, a header per day.
const cross: RowBox[] = [
  { kind: "header", section: "2026-11-24", top: 0, bottom: 40 },
  { kind: "task", key: "a/1", no: 1, depth: 0, parent: null, section: "2026-11-24", top: 40, bottom: 88 },
  { kind: "task", key: "b/1", no: 1, depth: 0, parent: null, section: "2026-11-24", top: 88, bottom: 136 },
  { kind: "header", section: "2026-11-25", top: 136, bottom: 176 },
  { kind: "task", key: "a/2", no: 2, depth: 0, parent: null, section: "2026-11-25", top: 176, bottom: 224 },
];

test("beforeKeyOf: the next task row after the gap, skipping the dragged one, stopping at a header", () => {
  assert.equal(beforeKeyOf(cross, { kind: "between", index: 1, depth: 0, y: 40, x: 0 }, "b/1"), "a/1");
  assert.equal(beforeKeyOf(cross, { kind: "between", index: 2, depth: 0, y: 88, x: 0 }, "b/1"), null);
  assert.equal(beforeKeyOf(cross, { kind: "between", index: 3, depth: 0, y: 136, x: 0 }, "a/1"), null);
});
test("sectionAt: the group of the gap (the header above it)", () => {
  assert.equal(sectionAt(cross, { kind: "between", index: 5, depth: 0, y: 224, x: 0 }), "2026-11-25");
  assert.equal(sectionAt(cross, { kind: "between", index: 1, depth: 0, y: 40, x: 0 }), "2026-11-24");
});
test("reordered: moves the key before another, or to the end", () => {
  assert.deepEqual(reordered(["a/1", "b/1", "c/1"], "c/1", "a/1"), ["c/1", "a/1", "b/1"]);
  assert.deepEqual(reordered(["a/1", "b/1", "c/1"], "a/1", null), ["b/1", "c/1", "a/1"]);
});
