import { test } from "node:test";
import assert from "node:assert/strict";
import { axisLock, decidePull, decideSwipe, longPressCancelled, AXIS_SLOP, SWIPE_TRIGGER, PULL_TRIGGER } from "./gestures.ts";

test("axis is undecided inside the slop", () => {
  assert.equal(axisLock(AXIS_SLOP - 1, 0), null);
  assert.equal(axisLock(3, -4), null);
});
test("the first clear movement decides the axis", () => {
  assert.equal(axisLock(AXIS_SLOP + 1, 2), "x");
  assert.equal(axisLock(-2, AXIS_SLOP + 1), "y");
  assert.equal(axisLock(12, 12), "y"); // a diagonal start is a scroll
});
test("a vertical gesture never swipes the row", () => {
  assert.equal(decideSwipe("y", SWIPE_TRIGGER * 2), "none");
});
test("swipe fires only past the trigger, right completes, left dates", () => {
  assert.equal(decideSwipe("x", SWIPE_TRIGGER - 1), "none");
  assert.equal(decideSwipe("x", SWIPE_TRIGGER), "complete");
  assert.equal(decideSwipe("x", -SWIPE_TRIGGER), "date");
  assert.equal(decideSwipe(null, SWIPE_TRIGGER * 2), "none");
});
test("pull to refresh only at the top, vertical, past the trigger", () => {
  assert.equal(decidePull(true, "y", PULL_TRIGGER), true);
  assert.equal(decidePull(false, "y", PULL_TRIGGER * 2), false);
  assert.equal(decidePull(true, "x", PULL_TRIGGER * 2), false);
  assert.equal(decidePull(true, "y", PULL_TRIGGER - 1), false);
});
test("long press is cancelled by movement", () => {
  assert.equal(longPressCancelled(3, 4), false);
  assert.equal(longPressCancelled(0, 9), true);
});
