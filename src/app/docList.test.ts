import { test } from "node:test";
import assert from "node:assert/strict";
import { rowLine, shortStamp } from "./docList.ts";

test("shortStamp drops the year and the seconds, and the zero before the month and day", () => {
  assert.equal(shortStamp("2026-11-08T09:05:30"), "11/8 09:05");
  assert.equal(shortStamp("nonsense"), "nonsense");
});

test("rowLine names the section, or the whole project", () => {
  assert.equal(rowLine({ section: "設計", updated: "2026-11-28T09:00:00", author: "たろう" }), "設計 · 11/28 09:00 · たろう");
  assert.equal(rowLine({ section: null, updated: "2026-11-28T09:00:00", author: "" }), "プロジェクト全体 · 11/28 09:00");
});
