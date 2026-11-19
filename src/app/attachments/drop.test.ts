import { test } from "node:test";
import assert from "node:assert/strict";
import { dragHasFiles, filesOf, pastedName, routeFiles } from "./drop.ts";

test("only_the_composer_sends_files_to_the_comment", () => {
  assert.equal(routeFiles("composer"), "comment");
  assert.equal(routeFiles("description"), "note");
  assert.equal(routeFiles("dialog"), "note");
});

test("files_are_read_from_a_paste_or_a_drop_and_text_gives_none", () => {
  const file = { name: "a.png" } as File;
  assert.deepEqual(filesOf({ files: [file] }), [file]);
  assert.deepEqual(filesOf({ files: [] }), []);
  assert.deepEqual(filesOf(null), []);
});

test("a_drag_of_text_is_not_a_file_drag", () => {
  assert.equal(dragHasFiles({ types: ["Files"] }), true);
  assert.equal(dragHasFiles({ types: ["text/plain"] }), false);
});

test("a_pasted_screenshot_gets_a_dated_name", () => {
  const now = new Date(2026, 10, 18, 9, 5, 7);
  assert.equal(pastedName("image.png", "image/png", now), "画像 20261118-090507.png");
  assert.equal(pastedName("", "image/jpeg", now), "画像 20261118-090507.jpg");
  assert.equal(pastedName("見積.pdf", "application/pdf", now), "見積.pdf");
});
