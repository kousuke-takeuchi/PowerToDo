import { test } from "node:test";
import assert from "node:assert/strict";
import { dueWithTime } from "./dueLabel.ts";

test("a time earlier today is red once it has passed", () => {
  assert.deepEqual(dueWithTime({ due: "2026-10-13", dueTime: "09:00" }, "2026-10-13", true, "09:01"), { label: "今日 9:00", tone: "danger" });
  assert.deepEqual(dueWithTime({ due: "2026-10-13", dueTime: "09:00" }, "2026-10-13", true, "09:00"), { label: "今日 9:00", tone: "success" });
  assert.deepEqual(dueWithTime({ due: "2026-10-13", dueTime: "15:00" }, "2026-10-13", true, "09:01"), { label: "今日 15:00", tone: "success" });
});
test("the time alone (Today's group) turns red too", () => {
  assert.deepEqual(dueWithTime({ due: "2026-10-13", dueTime: "09:00" }, "2026-10-13", false, "12:00"), { label: "9:00", tone: "danger" });
});
test("tomorrow's and a date without a time are unchanged", () => {
  assert.equal(dueWithTime({ due: "2026-10-14", dueTime: "07:00" }, "2026-10-13", true, "23:00")?.tone, "success");
  assert.equal(dueWithTime({ due: "2026-10-13" }, "2026-10-13", true, "23:00")?.tone, "success");
});
