import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, metaOf, noteEdit, payload, target, type DocMeta } from "./docSaves.ts";
import type { Doc } from "../types/model.ts";

const doc = (id: string, updated: string, over: Partial<Doc> = {}): Doc => ({
  id,
  project: "仕事",
  title: "計画",
  section: null,
  created: "2026-11-28T10:00:00+09:00",
  updated,
  author: "たろう",
  files: [],
  body: "本文\n",
  ...over,
});

test("a save of the current rev goes to the document with its latest base", () => {
  const metas = new Map<string, DocMeta>([["a", metaOf(doc("a", "t1"), 1)]]);
  assert.deepEqual(target(metas.get("a"), "a", 1), { id: "a", base: "t1" });
  apply(metas, "a", 1, "a", { kind: "written", ...doc("a", "t2") });
  assert.deepEqual(target(metas.get("a"), "a", 1), { id: "a", base: "t2" });
});

test("after a conflict, the old editor's queued saves go to the copy, not over the reloaded document", () => {
  const metas = new Map<string, DocMeta>([["a", metaOf(doc("a", "t1"), 1)]]);
  const out = apply(metas, "a", 1, "a", { kind: "conflict", doc: doc("a", "t5", { body: "外の変更\n" }), copy: doc("c", "t6", { body: "画面\n" }) });
  assert.equal(out.kind, "conflict");
  // The screen shows the reloaded document with a new rev.
  metas.set("a", { ...metaOf((out as { show: Doc }).show, 2), moved: metas.get("a")!.moved });
  // A save the old editor (rev 1) still had queued:
  assert.deepEqual(target(metas.get("a"), "a", 1), { id: "c", base: "t6" });
  // It is written to the copy; the next one from rev 1 follows it there.
  apply(metas, "a", 1, "c", { kind: "written", ...doc("c", "t7") });
  assert.deepEqual(target(metas.get("a"), "a", 1), { id: "c", base: "t7" });
  // The new editor saves to the document itself.
  assert.deepEqual(target(metas.get("a"), "a", 2), { id: "a", base: "t5" });
});

test("a document deleted elsewhere: the old editor's queued saves follow its copy", () => {
  const metas = new Map<string, DocMeta>([["a", metaOf(doc("a", "t1"), 1)]]);
  const out = apply(metas, "a", 1, "a", { kind: "recreated", copy: doc("c", "t2") });
  assert.equal(out.kind, "recreated");
  assert.deepEqual(target(metas.get("a"), "a", 1), { id: "c", base: "t2" });
});

test("every save carries the last known title, body and section", () => {
  const m = metaOf(doc("a", "t1", { section: "在庫アプリ" }), 1);
  noteEdit(m, 1, { title: "新しい題名", body: "書いた\n" });
  assert.deepEqual(payload(m, { files: [] }), { title: "新しい題名", body: "書いた\n", section: "在庫アプリ", files: [] });
  // An edit of an old rev does not change what the current editor's saves carry.
  noteEdit(m, 0, { body: "古い\n" });
  assert.equal(m.body, "書いた\n");
});

test("a document being deleted drops later saves; an unknown one too", () => {
  const m = metaOf(doc("a", "t1"), 1);
  m.deleting = true;
  assert.equal(target(m, "a", 1), null);
  assert.equal(target(undefined, "a", 1), null);
});
