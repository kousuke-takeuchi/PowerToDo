import { test } from "node:test";
import assert from "node:assert/strict";
import { dragKey, metaRowAction } from "./keys.ts";

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

test("drag_key_maps_alt_arrows_and_ctrl_brackets", () => {
  const e = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}, code = "") => ({ ...k(key, mods), code });
  assert.equal(dragKey(e("ArrowUp", { altKey: true })), "up");
  assert.equal(dragKey(e("ArrowDown", { altKey: true })), "down");
  assert.equal(dragKey(e("ArrowUp", { altKey: true, shiftKey: true })), null);
  assert.equal(dragKey(e("ArrowUp", { altKey: true, metaKey: true })), null);
  assert.equal(dragKey(e("ArrowUp")), null);
  assert.equal(dragKey(e("]", { ctrlKey: true })), "indent");
  assert.equal(dragKey(e("[", { ctrlKey: true })), "outdent");
  assert.equal(dragKey(e("x", { ctrlKey: true }, "BracketRight")), "indent");
  assert.equal(dragKey(e("x", { ctrlKey: true }, "BracketLeft")), "outdent");
  // JIS: the physical `[` key reports code BracketRight, `]` reports Backslash; `key` wins over `code`.
  assert.equal(dragKey(e("[", { ctrlKey: true }, "BracketRight")), "outdent");
  assert.equal(dragKey(e("]", { ctrlKey: true }, "Backslash")), "indent");
  assert.equal(dragKey(e("]")), null);
  assert.equal(dragKey(e("]", { ctrlKey: true, altKey: true })), null);
  assert.equal(dragKey(e("]", { metaKey: true })), null);
  assert.equal(dragKey(e("a", { altKey: true })), null);
});
