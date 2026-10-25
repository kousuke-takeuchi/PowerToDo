import { test } from "node:test";
import assert from "node:assert/strict";
import { afterRemoval, dialogTarget, neighbors, parseKey } from "./dialogNav.ts";

const keys = ["仕事/1", "仕事/3", "買い物/2"];

test("neighbors_in_the_middle", () => {
  assert.deepEqual(neighbors(keys, "仕事/3"), { prev: "仕事/1", next: "買い物/2" });
});

test("neighbors_at_the_ends", () => {
  assert.deepEqual(neighbors(keys, "仕事/1"), { prev: undefined, next: "仕事/3" });
  assert.deepEqual(neighbors(keys, "買い物/2"), { prev: "仕事/3", next: undefined });
});

test("neighbors_of_a_key_not_shown", () => {
  assert.deepEqual(neighbors(keys, "読書/9"), { prev: undefined, next: undefined });
});

test("afterRemoval_prefers_next_then_prev", () => {
  assert.equal(afterRemoval(keys, "仕事/3"), "買い物/2");
  assert.equal(afterRemoval(keys, "買い物/2"), "仕事/3");
  assert.equal(afterRemoval(["仕事/1"], "仕事/1"), null);
});

test("dialogTarget_chooses_the_source", () => {
  assert.equal(dialogTarget(null, "仕事", true), "none");
  assert.equal(dialogTarget({ project: "仕事", no: 1 }, "仕事", true), "current");
  assert.equal(dialogTarget({ project: "仕事", no: 1 }, "仕事", false), "other");
  assert.equal(dialogTarget({ project: "買い物", no: 1 }, "仕事", true), "other");
});

test("parseKey_splits_at_the_last_slash", () => {
  assert.deepEqual(parseKey("a/b/12"), { project: "a/b", no: 12 });
});
