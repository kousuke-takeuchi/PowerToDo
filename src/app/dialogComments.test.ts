import { test } from "node:test";
import assert from "node:assert/strict";
import { dialogCommentsReducer, initialDialogComments } from "./dialogComments.ts";
import type { Comment } from "../types/model.ts";

const c = (id: string, text: string): Comment => ({ id, at: "2026-10-25T21:04:00+09:00", author: "たろう", text, edited: false });

test("a_new_task_starts_empty_until_its_comments_come", () => {
  let s = dialogCommentsReducer(initialDialogComments, { type: "show", key: "仕事/1" });
  s = dialogCommentsReducer(s, { type: "loaded", key: "仕事/1", comments: [c("a", "A")] });
  s = dialogCommentsReducer(s, { type: "show", key: "仕事/2" });
  assert.deepEqual(s.comments, []);
  assert.equal(s.failed, false);
});

test("a_reply_for_another_task_is_ignored", () => {
  let s = dialogCommentsReducer(initialDialogComments, { type: "show", key: "仕事/2" });
  s = dialogCommentsReducer(s, { type: "loaded", key: "仕事/1", comments: [c("a", "A")] });
  assert.deepEqual(s.comments, []);
  s = dialogCommentsReducer(s, { type: "failed", key: "仕事/1" });
  assert.equal(s.failed, false);
});

test("a_failed_load_is_shown_until_a_load_works", () => {
  let s = dialogCommentsReducer(initialDialogComments, { type: "show", key: "仕事/1" });
  s = dialogCommentsReducer(s, { type: "failed", key: "仕事/1" });
  assert.equal(s.failed, true);
  s = dialogCommentsReducer(s, { type: "loaded", key: "仕事/1", comments: [c("a", "A")] });
  assert.equal(s.failed, false);
  assert.equal(s.comments.length, 1);
});

test("showing_the_same_task_again_keeps_its_comments", () => {
  let s = dialogCommentsReducer(initialDialogComments, { type: "show", key: "仕事/1" });
  s = dialogCommentsReducer(s, { type: "loaded", key: "仕事/1", comments: [c("a", "A")] });
  s = dialogCommentsReducer(s, { type: "show", key: "仕事/1" });
  assert.equal(s.comments.length, 1);
});
