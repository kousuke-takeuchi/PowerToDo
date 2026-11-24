import assert from "node:assert/strict";
import { test } from "node:test";
import { fitPopover } from "./popoverFit.ts";

test("a popover that fits stays where it is", () => {
  assert.deepEqual(fitPopover(100, 300, 800), { shift: 0, maxHeight: null });
  assert.deepEqual(fitPopover(100, 692, 800), { shift: 0, maxHeight: null }); // bottom exactly 8px above the edge
});

test("one that overflows the bottom moves up to leave 8px", () => {
  assert.deepEqual(fitPopover(600, 300, 800), { shift: -108, maxHeight: null });
});

test("one taller than the window is capped and pinned 8px from the top", () => {
  assert.deepEqual(fitPopover(300, 900, 800), { shift: -292, maxHeight: 784 });
});

test("a short one above the window is left alone; a tall one is pulled down to the margin and capped", () => {
  assert.deepEqual(fitPopover(-50, 300, 800), { shift: 0, maxHeight: null });
  assert.deepEqual(fitPopover(-50, 900, 800), { shift: 58, maxHeight: 784 });
});

test("inside a clipping box (the task dialog), it fits that box, not the window", () => {
  // Box from 120 to 760: a 600 px popover at 400 moves up to 152 (8 below the box's top would be 128; 760 - 8 - 600 = 152).
  assert.deepEqual(fitPopover(400, 600, 760, 120), { shift: -248, maxHeight: null });
  // Taller than the box: pinned 8 below its top and capped to the room left.
  assert.deepEqual(fitPopover(400, 900, 760, 120), { shift: -272, maxHeight: 624 });
});
