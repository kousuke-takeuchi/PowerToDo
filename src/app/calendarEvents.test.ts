import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarProblems, eventDays, eventTimeLabel, eventsOn } from "./calendarEvents.ts";
import type { ProjectEvents } from "../types/model.ts";

const ev = (id: string, date: string, startTime?: string, endTime?: string, color = "#16a765") => ({ id, title: id, date, startTime, endTime, allDay: startTime === undefined, color, calendar: "c" });
const map: Record<string, ProjectEvents> = {
  仕事: { events: [ev("late", "2026-11-30", "15:00", "16:00"), ev("allday", "2026-11-30"), ev("next", "2026-12-01", "09:00")], needsLogin: false },
  家: { events: [ev("early", "2026-11-30", "08:30", undefined, "#f00")], needsLogin: true },
};

test("a day's events: all-day first, then by time, with the project and color", () => {
  const e = eventsOn(map, "2026-11-30");
  assert.deepEqual(e.map((x) => x.id), ["allday", "early", "late"]);
  assert.deepEqual([e[1].project, e[1].color], ["家", "#f00"]);
});
test("one project only", () => {
  assert.deepEqual(eventsOn(map, "2026-11-30", "仕事").map((x) => x.id), ["allday", "late"]);
});
test("the days with events", () => {
  assert.deepEqual(eventDays(map), ["2026-11-30", "2026-12-01"]);
  assert.deepEqual(eventDays(map, "家"), ["2026-11-30"]);
});
test("time labels", () => {
  assert.equal(eventTimeLabel(ev("a", "d")), "終日");
  assert.equal(eventTimeLabel(ev("a", "d", "09:00", "10:30")), "9:00-10:30");
  assert.equal(eventTimeLabel(ev("a", "d", "09:00")), "9:00");
  assert.equal(eventTimeLabel(ev("a", "d", "09:00", "09:00")), "9:00");
  assert.equal(eventTimeLabel({ ...ev("a", "d", "22:00", "06:00"), endDate: "e" }), "22:00", "over midnight: the start only");
});
test("problems: a missing login and a failed fetch", () => {
  const p = calendarProblems({ ...map, 趣味: { events: [], needsLogin: false, error: "オフラインです" } });
  assert.deepEqual(p.map((x) => x.project), ["家", "趣味"]);
});

import { capEvents, foldProjectEvents } from "./calendarEvents.ts";

test("capEvents: all when few or expanded, else the first three and the rest counted", () => {
  assert.deepEqual(capEvents([1, 2, 3]), { shown: [1, 2, 3], hidden: 0 });
  assert.deepEqual(capEvents([1, 2, 3, 4, 5]), { shown: [1, 2, 3], hidden: 2 });
  assert.deepEqual(capEvents([1, 2, 3, 4, 5], 3, true), { shown: [1, 2, 3, 4, 5], hidden: 0 });
});
test("a folded project shows only today's events (at most three), an open one all of them", () => {
  const e = ["2026-11-30", "2026-11-30", "2026-11-30", "2026-11-30", "2026-12-01", "2026-12-02"].map((d, i) => ({ ...ev(`e${i}`, d, "09:00"), project: "仕事" }));
  const folded = foldProjectEvents(e, "2026-11-30", false);
  assert.deepEqual([folded.shown.length, folded.hidden], [3, 3]);
  assert.deepEqual(foldProjectEvents(e, "2026-11-30", true), { shown: e, hidden: 0 });
  assert.deepEqual(foldProjectEvents(e, "2026-12-09", false), { shown: [], hidden: 6 }, "a day with none: just the header");
});

import { eventRangeText } from "./calendarEvents.ts";

test("the detail's range text", () => {
  const day = (d: string) => `<${d}>`;
  assert.equal(eventRangeText({ ...ev("a", "D", "10:00", "11:30") }, day), "<D> 10:00-11:30");
  assert.equal(eventRangeText({ ...ev("a", "D", "22:00", "06:00"), endDate: "E" }, day), "<D> 22:00 - <E> 6:00");
  assert.equal(eventRangeText({ ...ev("a", "D") }, day), "<D> (終日)");
  assert.equal(eventRangeText({ ...ev("a", "D"), endDate: "E" }, day), "<D> - <E>");
});
