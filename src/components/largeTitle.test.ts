import { test } from "node:test";
import assert from "node:assert/strict";
import { LARGE_TITLE_HEIGHT, titleLook, titleProgress } from "./largeTitle.ts";

test("titleProgress_follows_the_scroll", () => {
  assert.equal(LARGE_TITLE_HEIGHT, 57);
  assert.equal(titleProgress(0), 0);
  assert.equal(titleProgress(28.5), 0.5);
  assert.equal(titleProgress(LARGE_TITLE_HEIGHT), 1);
});

test("titleProgress_clamps_bounce_and_overshoot", () => {
  assert.equal(titleProgress(-40), 0); // iOS bounce at the top
  assert.equal(titleProgress(500), 1);
  assert.equal(titleProgress(Number.NaN), 0);
});

test("titleLook_ends_and_middle", () => {
  assert.deepEqual(titleLook(0), { largeOpacity: 1, largeScale: 1, smallOpacity: 0 });
  assert.deepEqual(titleLook(1), { largeOpacity: 0, largeScale: 0.9, smallOpacity: 1 });
  assert.equal(titleLook(0.5).smallOpacity, 0); // the two titles never show at once
  assert.equal(titleLook(2).largeOpacity, 0);
  assert.equal(titleLook(-1).smallOpacity, 0);
});
