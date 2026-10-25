import { test } from "node:test";
import assert from "node:assert/strict";
import { metaRowAction } from "./keys.ts";

const k = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods,
});

test("cmd_e_edits_and_cmd_backspace_removes", () => {
  assert.equal(metaRowAction(k("e", { metaKey: true })), "edit");
  assert.equal(metaRowAction(k("E", { ctrlKey: true })), "edit");
  assert.equal(metaRowAction(k("Backspace", { metaKey: true })), "remove");
  assert.equal(metaRowAction(k("e")), null);
  assert.equal(metaRowAction(k("e", { metaKey: true, shiftKey: true })), null);
  assert.equal(metaRowAction(k("k", { metaKey: true })), null);
});
