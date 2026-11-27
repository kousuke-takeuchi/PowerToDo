import { test } from "node:test";
import assert from "node:assert/strict";
import { directionBetween, posesFor, UNDER_SHIFT } from "./screenMotion.ts";

const nav = (tab: string, depth = 0) => ({ tab, browse: Array.from({ length: depth }) });

test("another tab fades, a deeper stack pushes, a shallower one pops", () => {
  assert.equal(directionBetween(nav("today"), nav("upcoming")), "fade");
  assert.equal(directionBetween(nav("browse", 0), nav("browse", 1)), "push");
  assert.equal(directionBetween(nav("browse", 2), nav("browse", 1)), "pop");
  assert.equal(directionBetween(nav("browse", 1), nav("browse", 1)), "none");
});
test("the drawer's open from another tab is a tab change: a fade", () => {
  assert.equal(directionBetween(nav("today"), nav("browse", 1)), "fade");
});
test("a push brings the new screen in from the right over the old, a pop the reverse", () => {
  const push = posesFor("push");
  assert.equal(push.enter.x, "100%");
  assert.ok(push.enter.zIndex > push.exit.zIndex);
  assert.equal(push.exit.x, `${-UNDER_SHIFT * 100}%`);
  const pop = posesFor("pop");
  assert.equal(pop.exit.x, "100%");
  assert.ok(pop.exit.zIndex > pop.enter.zIndex);
});
test("a fade does not move; no direction changes nothing", () => {
  assert.equal(posesFor("fade").enter.x, "0%");
  assert.equal(posesFor("fade").enter.opacity, 0);
  assert.deepEqual(posesFor("none").enter, posesFor("none").exit);
});
