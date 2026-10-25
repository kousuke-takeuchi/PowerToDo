import { test } from "node:test";
import assert from "node:assert/strict";
import { placeMenu } from "./menuPlacement.ts";

const vp = { width: 1200, height: 800 };
const size = { width: 280, height: 400 };

test("opens_below_right_aligned_when_it_fits", () => {
  assert.deepEqual(placeMenu({ top: 100, bottom: 128, right: 900 }, size, vp), { top: 132, left: 620 });
});

test("opens_above_near_the_bottom", () => {
  assert.deepEqual(placeMenu({ top: 600, bottom: 628, right: 900 }, size, vp), { top: 196, left: 620 });
});

test("stays_inside_the_window_when_neither_fits", () => {
  const p = placeMenu({ top: 300, bottom: 328, right: 200 }, { width: 280, height: 780 }, vp);
  assert.equal(p.left, 8);
  assert.equal(p.top, 8);
});
