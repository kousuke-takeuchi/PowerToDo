import { test } from "node:test";
import assert from "node:assert/strict";
import { dayHeading, monthLabel, monthWeeks } from "./mobileDates.ts";

test("day_headings", () => {
  assert.equal(dayHeading("2026-10-26", "2026-10-26"), "10月26日 · 今日 · 月曜日");
  assert.equal(dayHeading("2026-10-27", "2026-10-26"), "10月27日 · 明日 · 火曜日");
  assert.equal(dayHeading("2026-10-30", "2026-10-26"), "10月30日 · 金曜日");
});

test("month_label", () => {
  assert.equal(monthLabel("2026-10-26"), "2026年10月");
});

test("month_weeks_start_on_monday", () => {
  const w = monthWeeks("2026-10-26"); // 10-01 is a Thursday
  assert.equal(w.length, 5);
  assert.equal(w[0][0], "2026-09-28");
  assert.equal(w[4][6], "2026-11-01");
  const feb = monthWeeks("2027-02-10"); // 2027-02-01 is a Monday, 28 days
  assert.equal(feb.length, 4);
  assert.equal(feb[0][0], "2027-02-01");
});
