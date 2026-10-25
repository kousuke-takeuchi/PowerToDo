import { test } from "node:test";
import assert from "node:assert/strict";
import { autoScrollSpeed, computeDrop, placementOf, type RowBox } from "./dropTarget.ts";

// 40 px rows from y=0: 1, 2 (child of 1), 3, header 会議 at 120, 4 in 会議, slot of 会議, header 空 + slot.
const rows: RowBox[] = [
  { kind: "task", key: "p/1", no: 1, depth: 0, parent: null, section: null, top: 0, bottom: 40 },
  { kind: "task", key: "p/2", no: 2, depth: 1, parent: 1, section: null, top: 40, bottom: 80 },
  { kind: "task", key: "p/3", no: 3, depth: 0, parent: null, section: null, top: 80, bottom: 120 },
  { kind: "header", section: "会議", top: 120, bottom: 160 },
  { kind: "task", key: "p/4", no: 4, depth: 0, parent: null, section: "会議", top: 160, bottom: 200 },
  { kind: "slot", section: "会議", top: 200, bottom: 240 },
  { kind: "header", section: "空", top: 240, bottom: 280 },
  { kind: "slot", section: "空", top: 280, bottom: 320 },
];
const drag3 = { key: "p/3", depth: 0, height: 0, subtree: new Set(["p/3"]) };

test("upper_and_lower_quarters_are_gaps_middle_is_onto", () => {
  assert.deepEqual(computeDrop(rows, { x: 0, y: 5 }, 0, drag3, 0), { kind: "between", index: 0, depth: 0, y: 0, x: 0 });
  assert.deepEqual(computeDrop(rows, { x: 0, y: 20 }, 0, drag3, 0), { kind: "onto", key: "p/1" });
  assert.equal(computeDrop(rows, { x: 0, y: 36 }, 0, drag3, 0)?.kind, "between");
});

test("horizontal_movement_picks_the_level_capped_by_the_row_above", () => {
  // gap between 2 (depth 1) and 3: up to depth 2
  const at = (dx: number) => computeDrop(rows, { x: dx, y: 78 }, 0, drag3, 0);
  assert.equal((at(0) as { depth: number }).depth, 0);
  assert.equal((at(20) as { depth: number }).depth, 1);
  assert.equal((at(60) as { depth: number }).depth, 2);
  assert.equal((at(200) as { depth: number }).depth, 2);
  assert.equal((at(-200) as { depth: number }).depth, 0);
});

test("the_dragged_subtree_is_no_target", () => {
  const drag1 = { key: "p/1", depth: 0, height: 1, subtree: new Set(["p/1", "p/2"]) };
  assert.equal(computeDrop(rows, { x: 0, y: 60 }, 0, drag1, 0), null);
  assert.notEqual(computeDrop(rows, { x: 0, y: 60 }, 0, drag1, 0)?.kind, "onto");
});

test("a_subtree_height_caps_the_level_and_onto", () => {
  const drag4 = { key: "p/4", depth: 0, height: 1, subtree: new Set(["p/4", "p/9"]) };
  // under 2 (depth 1) the max would be 2, but a child below needs room: max 1
  assert.equal((computeDrop(rows, { x: 200, y: 78 }, 0, drag4, 0) as { depth: number }).depth, 1);
  // onto 2 (depth 1) would make depth 2 + child 3: not allowed, falls back to a gap
  assert.equal(computeDrop(rows, { x: 0, y: 60 }, 0, drag4, 0)?.kind, "between");
});

test("outside_the_rows_is_null_and_empty_sections_take_drops", () => {
  assert.equal(computeDrop(rows, { x: 0, y: -10 }, 0, drag3, 0), null);
  assert.equal(computeDrop(rows, { x: 0, y: 400 }, 0, drag3, 0), null);
  const d = computeDrop(rows, { x: 0, y: 285 }, 0, drag3, 0);
  assert.deepEqual(placementOf(rows, d!, "p/3"), { section: "空", parent: null, before: null });
});

test("placement_of_gaps_and_onto", () => {
  // before 1 at the top
  assert.deepEqual(placementOf(rows, { kind: "between", index: 0, depth: 0, y: 0, x: 0 }, "p/3"), { section: null, parent: null, before: 1 });
  // after 2 at depth 1: last child of 1
  assert.deepEqual(placementOf(rows, { kind: "between", index: 2, depth: 1, y: 80, x: 28 }, "p/3"), { section: null, parent: 1, before: null });
  // after 2 at depth 0: before 3
  assert.deepEqual(placementOf(rows, { kind: "between", index: 2, depth: 0, y: 80, x: 0 }, "p/4"), { section: null, parent: null, before: 3 });
  // right after the 会議 header: first in 会議
  assert.deepEqual(placementOf(rows, { kind: "between", index: 4, depth: 0, y: 160, x: 0 }, "p/3"), { section: "会議", parent: null, before: 4 });
  // onto 3
  assert.deepEqual(placementOf(rows, { kind: "onto", key: "p/3" }, "p/1"), { section: null, parent: 3, before: null });
});

test("autoscroll_speeds_up_near_the_edges", () => {
  assert.equal(autoScrollSpeed(300, 0, 600), 0);
  assert.ok(autoScrollSpeed(10, 0, 600) < 0);
  assert.ok(autoScrollSpeed(590, 0, 600) > 0);
  assert.equal(autoScrollSpeed(0, 0, 600), -16);
  assert.equal(autoScrollSpeed(600, 0, 600), 16);
});

// 1(0), 2(1), 5(2), 3(0): a capped level must put the line where the task lands, past the deeper run.
const deep: RowBox[] = [
  { kind: "task", key: "p/1", no: 1, depth: 0, parent: null, section: null, top: 0, bottom: 40 },
  { kind: "task", key: "p/2", no: 2, depth: 1, parent: 1, section: null, top: 40, bottom: 80 },
  { kind: "task", key: "p/5", no: 5, depth: 2, parent: 2, section: null, top: 80, bottom: 120 },
  { kind: "task", key: "p/3", no: 3, depth: 0, parent: null, section: null, top: 120, bottom: 160 },
];

test("a_capped_level_puts_the_line_past_the_deeper_run", () => {
  const h1 = { key: "p/9", depth: 0, height: 1, subtree: new Set(["p/9", "p/10"]) };
  const a = computeDrop(deep, { x: 200, y: 75 }, 0, h1, 0);
  assert.deepEqual(a, { kind: "between", index: 3, depth: 1, y: 120, x: 28 });
  assert.deepEqual(placementOf(deep, a!, "p/9"), { section: null, parent: 1, before: null });
  const h2 = { key: "p/9", depth: 0, height: 2, subtree: new Set(["p/9", "p/10", "p/11"]) };
  const b = computeDrop(deep, { x: 0, y: 35 }, 0, h2, 0);
  assert.deepEqual(b, { kind: "between", index: 3, depth: 0, y: 120, x: 0 });
  assert.deepEqual(placementOf(deep, b!, "p/9"), { section: null, parent: null, before: 3 });
});

test("a_drop_back_in_place_is_null", () => {
  // 1 (with child 2) into the upper half of 3: where it already is.
  const drag1 = { key: "p/1", depth: 0, height: 1, subtree: new Set(["p/1", "p/2"]) };
  const d = computeDrop(rows, { x: 0, y: 85 }, 0, drag1, 0);
  assert.equal(d?.kind, "between");
  assert.equal(placementOf(rows, d!, "p/1"), null);
  // 2 back under 1 as its last child, by gap and by onto.
  assert.equal(placementOf(rows, { kind: "between", index: 2, depth: 1, y: 80, x: 28 }, "p/2"), null);
  assert.equal(placementOf(rows, { kind: "onto", key: "p/1" }, "p/2"), null);
  // 4, last in 会議, dropped above the 会議 slot.
  assert.equal(placementOf(rows, { kind: "between", index: 5, depth: 0, y: 200, x: 0 }, "p/4"), null);
});
