import { test } from "node:test";
import assert from "node:assert/strict";
import { wheelIndex } from "./wheel.ts";

test("the wheel rests on the nearest row", () => {
  assert.equal(wheelIndex(0, 40, 24), 0);
  assert.equal(wheelIndex(79, 40, 24), 2);
  assert.equal(wheelIndex(61, 40, 24), 2);
  assert.equal(wheelIndex(59, 40, 24), 1);
});
test("it never leaves the list (rubber-banding past the ends)", () => {
  assert.equal(wheelIndex(-30, 40, 24), 0);
  assert.equal(wheelIndex(5000, 40, 24), 23);
});
