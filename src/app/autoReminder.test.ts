import { test } from "node:test";
import assert from "node:assert/strict";
import { remindersWithTime } from "./autoReminder.ts";

test("a time with no reminders adds 時刻ちょうど", () => {
  assert.deepEqual(remindersWithTime([], "10:00"), ["-0m"]);
});
test("existing reminders are kept as they are", () => {
  assert.equal(remindersWithTime(["-30m"], "10:00"), undefined);
});
test("no time adds nothing", () => {
  assert.equal(remindersWithTime([], null), undefined);
  assert.equal(remindersWithTime([], undefined), undefined);
});
