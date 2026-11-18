import assert from "node:assert/strict";
import { test } from "node:test";
import { initialMobileNav, initialNav, startKind } from "./startView.ts";

test("Today is the default and the only fallback", () => {
  assert.equal(startKind(undefined), "today");
  assert.equal(startKind("today"), "today");
  assert.equal(startKind("inbox"), "inbox");
});

test("desktop and iPhone start where the setting says", () => {
  assert.deepEqual(initialNav("inbox"), { kind: "inbox" });
  assert.deepEqual(initialNav("today"), { kind: "today" });
  assert.deepEqual(initialMobileNav("inbox"), { tab: "inbox", browse: [] });
  assert.deepEqual(initialMobileNav(undefined), { tab: "today", browse: [] });
});
