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
