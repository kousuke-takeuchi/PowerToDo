import { test } from "node:test";
import assert from "node:assert/strict";
import { insertToken } from "./quickAddInsert.ts";

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
  assert.equal(insertToken("牛乳　", "reminder"), "牛乳　!");
});
