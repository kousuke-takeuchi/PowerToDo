import { test } from "node:test";
import assert from "node:assert/strict";
import { minuteChoices, nextRoundTime, timeOf } from "./timeChoices.ts";

test("a new time starts at the next round time after now", () => {
  assert.equal(nextRoundTime("09:45"), "10:00");
  assert.equal(nextRoundTime("09:10"), "09:30");
  assert.equal(nextRoundTime("09:30"), "10:00", "exactly on a round time: the next one");
  assert.equal(nextRoundTime("00:00"), "00:30");
});
test("late in the evening it stays on the same day", () => {
  assert.equal(nextRoundTime("23:30"), "23:55");
  assert.equal(nextRoundTime("23:59"), "23:55");
});
test("minutes are offered every five, and an odd minute already set stays selectable", () => {
  assert.deepEqual(minuteChoices().slice(0, 4), [0, 5, 10, 15]);
  assert.equal(minuteChoices().length, 12);
  assert.ok(minuteChoices(3).includes(3));
  assert.deepEqual(minuteChoices(3).slice(0, 3), [0, 3, 5]);
});
test("timeOf pads", () => {
  assert.equal(timeOf(9, 5), "09:05");
});
