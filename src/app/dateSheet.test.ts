import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarMonths, quickRows, repeatChoices, weekHeader } from "./dateSheet.ts";

test("months are whole weeks with the 1st under its weekday", () => {
  // 2026-11-01 is a Sunday: with a Monday start it is the 7th column.
  const [nov] = calendarMonths("2026-11-27", 2, "mon");
  assert.equal(nov.title, "2026年11月");
  assert.equal(nov.cells.length % 7, 0);
  assert.equal(nov.cells.indexOf("2026-11-01"), 6);
  assert.equal(nov.cells.filter(Boolean).length, 30);
  assert.equal(calendarMonths("2026-11-27", 2, "sun")[0].cells.indexOf("2026-11-01"), 0);
});
test("the months run on across the year end", () => {
  const m = calendarMonths("2026-11-27", 3);
  assert.deepEqual(m.map((x) => x.title), ["2026年11月", "2026年12月", "2027年1月"]);
});
test("the week header starts where the calendar does", () => {
  assert.deepEqual(weekHeader("mon"), ["月", "火", "水", "木", "金", "土", "日"]);
  assert.equal(weekHeader("sun")[0], "日");
});
test("the repeat menu follows the date", () => {
  // 2026-11-27 is a Friday
  const c = repeatChoices("2026-11-27");
  assert.deepEqual(c.map((x) => x.label), ["なし", "毎日", "毎週金", "平日毎日 (月 - 金)", "毎月 第 27", "毎年 11月27日"]);
  assert.equal(c[2].rrule, "FREQ=WEEKLY;BYDAY=FR");
  assert.equal(c[5].rrule, "FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=27");
  assert.equal(c[0].rrule, null);
});
test("quick rows: tomorrow, mid-week while ahead, the weekend, next week", () => {
  // Friday: no mid-week left
  assert.deepEqual(quickRows("2026-11-27").map((r) => [r.label, r.date]), [["明日", "2026-11-28"], ["今週末", "2026-11-28"], ["来週", "2026-11-30"]]);
  // Monday 2026-11-23: mid-week is the Wednesday (Todoist 10/26 Monday: 今週の後半 水)
  const mon = quickRows("2026-11-23");
  assert.deepEqual(mon.map((r) => r.label), ["明日", "今週の後半", "今週末", "来週"]);
  assert.equal(mon[1].date, "2026-11-25");
});
