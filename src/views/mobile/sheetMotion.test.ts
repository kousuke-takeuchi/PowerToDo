import { test } from "node:test";
import assert from "node:assert/strict";
import { SHEET_OMEGA, sheetDragEnd, sheetTransition, springProgress } from "./sheetMotion.ts";

test("open_spring_covers_70_percent_in_0_1_s", () => {
  const p = springProgress(0.1);
  assert.ok(p > 0.69 && p < 0.71, String(p));
});

test("open_spring_settles_by_0_37_s_without_overshoot", () => {
  assert.ok(springProgress(0.37) > 0.998);
  let prev = 0;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const p = springProgress(t);
    assert.ok(p >= prev - 1e-12 && p <= 1, `t=${t} p=${p}`);
    prev = p;
  }
});

test("sheetTransition_values", () => {
  assert.deepEqual(sheetTransition("open", false), { type: "spring", stiffness: SHEET_OMEGA ** 2, damping: 2 * SHEET_OMEGA, mass: 1 });
  assert.deepEqual(sheetTransition("close", false), { duration: 0.13, ease: [0.4, 0, 1, 1] });
  assert.deepEqual(sheetTransition("detent", false), { duration: 0.2, ease: [0.2, 0, 0, 1] });
});

test("sheetTransition_reduced_is_instant", () => {
  for (const phase of ["open", "close", "detent"] as const) {
    assert.deepEqual(sheetTransition(phase, true), { duration: 0, ease: [0.2, 0, 0, 1] });
  }
});

test("sheetDragEnd_rules", () => {
  assert.equal(sheetDragEnd("auto", 120, 0), "close");
  assert.equal(sheetDragEnd("auto", 20, 900), "close");
  assert.equal(sheetDragEnd("auto", 40, 100), "auto");
  assert.equal(sheetDragEnd("large", -80, 0), "full");
  assert.equal(sheetDragEnd("large", 120, 0), "close");
  assert.equal(sheetDragEnd("large", 10, 0), "large");
  assert.equal(sheetDragEnd("full", 150, 0), "large");
  assert.equal(sheetDragEnd("full", -50, 0), "full");
});
