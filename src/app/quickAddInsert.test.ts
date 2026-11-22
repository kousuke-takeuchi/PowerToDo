import { test } from "node:test";
import assert from "node:assert/strict";
import { dateWords, insertToken, projectWord, replaceWords } from "./quickAddInsert.ts";
import type { Span } from "../types/model.ts";

test("an empty field gets the bare word", () => {
  assert.equal(insertToken("", "date"), "明日");
  assert.equal(insertToken("", "priority"), "p1");
});
test("a space is added between the title and the word", () => {
  assert.equal(insertToken("牛乳", "date"), "牛乳 明日");
  assert.equal(insertToken("牛乳 明日", "priority"), "牛乳 明日 p1");
});
test("no second space after trailing whitespace (ASCII or ideographic)", () => {
  assert.equal(insertToken("牛乳 ", "label"), "牛乳 @");
  assert.equal(insertToken("牛乳　", "label"), "牛乳　@");
});
test("the project chip inserts #", () => {
  assert.equal(insertToken("牛乳", "project"), "牛乳 #");
  assert.equal(insertToken("", "project"), "#");
});

const span = (start: number, end: number, kind: Span["kind"]): Span => ({ start, end, kind });

test("replaceWords drops the words of the given kinds and appends the new ones", () => {
  // 牛乳 明日 10:00 p2
  const spans = [span(3, 5, "date"), span(6, 11, "time"), span(12, 14, "priority")];
  assert.equal(replaceWords("牛乳 明日 10:00 p2", spans, ["date", "time"], ["今日"]), "牛乳 p2 今日");
  assert.equal(replaceWords("牛乳 明日 10:00 p2", spans, ["priority"], []), "牛乳 明日 10:00");
});
test("replaceWords counts offsets in code points, not UTF-16 units", () => {
  // 🍞 is one code point but two UTF-16 units
  assert.equal(replaceWords("🍞 p1", [span(2, 4, "priority")], ["priority"], ["p3"]), "🍞 p3");
});
test("replaceWords with no matching span only appends", () => {
  assert.equal(replaceWords("牛乳", [], ["date"], ["明日"]), "牛乳 明日");
  assert.equal(replaceWords("", [], ["date"], ["明日"]), "明日");
});
test("replaceWords keeps the words of other kinds in place", () => {
  assert.equal(replaceWords("牛乳 @食品 #買い物", [span(3, 6, "label"), span(7, 11, "project")], ["label"], ["@急ぎ"]), "牛乳 #買い物 @急ぎ");
});

test("dateWords: today and tomorrow by name, other days as M/D in this year", () => {
  assert.equal(dateWords("2026-11-22", undefined, "2026-11-22").join(" "), "今日");
  assert.equal(dateWords("2026-11-23", undefined, "2026-11-22").join(" "), "明日");
  assert.equal(dateWords("2026-12-05", undefined, "2026-11-22").join(" "), "12/5");
  assert.equal(dateWords("2027-01-04", undefined, "2026-11-22").join(" "), "2027/1/4");
});
test("dateWords puts the time after the date", () => {
  assert.equal(dateWords("2026-11-23", "09:30", "2026-11-22").join(" "), "明日 9:30");
});
test("dateWords without a date is empty", () => {
  assert.deepEqual(dateWords(undefined, "09:30", "2026-11-22"), []);
});

test("projectWord quotes names with spaces", () => {
  assert.equal(projectWord("買い物"), "#買い物");
  assert.equal(projectWord("家の 用事"), '#"家の 用事"');
});
