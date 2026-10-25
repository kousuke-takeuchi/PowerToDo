import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutFor, NARROW_BELOW } from "./shellLayout.ts";

test("layoutFor_boundary", () => {
  assert.equal(NARROW_BELOW, 750);
  assert.equal(layoutFor(749), "narrow");
  assert.equal(layoutFor(750), "wide");
  assert.equal(layoutFor(1440), "wide");
  assert.equal(layoutFor(400), "narrow");
});
