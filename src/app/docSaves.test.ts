import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, createDocSaves, metaOf, noteEdit, payload, target, type DocState, type SaveFn } from "./docSaves.ts";
import type { Doc, DocEdit, Saved } from "../types/model.ts";

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

const stateWith = (d: Doc, rev: number): DocState => ({ metas: new Map([[d.id, metaOf(d, rev)]]), bases: new Map([[d.id, d.updated]]) });

test("a save of the current rev goes to the document with its latest base", () => {
  const s = stateWith(doc("a", "t1"), 1);
  assert.deepEqual(target(s, "a", 1), { id: "a", base: "t1" });
  apply(s, "a", 1, "a", { kind: "written", ...doc("a", "t2") });
  assert.deepEqual(target(s, "a", 1), { id: "a", base: "t2" });
});

test("after a conflict, the old editor's queued saves go to the copy, not over the reloaded document", () => {
  const s = stateWith(doc("a", "t1"), 1);
  const out = apply(s, "a", 1, "a", { kind: "conflict", doc: doc("a", "t5", { body: "外の変更\n" }), copy: doc("c", "t6", { body: "画面\n" }) });
  assert.equal(out.kind, "conflict");
  assert.equal(out.kind !== "written" && out.from, "a");
  // The screen shows the reloaded document with a new rev.
  s.metas.set("a", { ...metaOf(out.kind !== "written" ? out.show : doc("a", "t5"), 2), moved: s.metas.get("a")!.moved });
  // A save the old editor (rev 1) still had queued:
  assert.deepEqual(target(s, "a", 1), { id: "c", base: "t6" });
  // It is written to the copy; the next one from rev 1 follows it there.
  apply(s, "a", 1, "c", { kind: "written", ...doc("c", "t7") });
  assert.deepEqual(target(s, "a", 1), { id: "c", base: "t7" });
  // The new editor saves to the document itself.
  assert.deepEqual(target(s, "a", 2), { id: "a", base: "t5" });
});

test("a document deleted elsewhere: the old editor's queued saves follow its copy", () => {
  const s = stateWith(doc("a", "t1"), 1);
  const out = apply(s, "a", 1, "a", { kind: "recreated", copy: doc("c", "t2") });
  assert.equal(out.kind, "recreated");
  assert.deepEqual(target(s, "a", 1), { id: "c", base: "t2" });
});

test("every save carries the last known title, body and section", () => {
  const s = stateWith(doc("a", "t1", { section: "在庫アプリ" }), 1);
  const m = s.metas.get("a")!;
  noteEdit(m, 1, { title: "新しい題名", body: "書いた\n" });
  assert.deepEqual(payload(m, 1, { files: [] }), { title: "新しい題名", body: "書いた\n", section: "在庫アプリ", files: [] });
  // An edit of an old rev does not change what the current editor's saves carry.
  noteEdit(m, 0, { body: "古い\n" });
  assert.equal(m.body, "書いた\n");
});

test("a moved save carries its own editor's section, not the reloaded document's", () => {
  const s = stateWith(doc("a", "t1", { section: "画面のセクション" }), 1);
  noteEdit(s.metas.get("a")!, 1, { body: "画面\n" });
  const out = apply(s, "a", 1, "a", { kind: "conflict", doc: doc("a", "t5", { section: "外のセクション" }), copy: doc("c", "t6") });
  s.metas.set("a", { ...metaOf(out.kind !== "written" ? out.show : doc("a", "t5"), 2), moved: s.metas.get("a")!.moved });
  const m = s.metas.get("a")!;
  assert.equal(payload(m, 1, { body: "続き\n" }).section, "画面のセクション");
  assert.equal(payload(m, 2, { body: "新しい画面\n" }).section, "外のセクション");
});

test("a document being deleted drops later saves; an unknown one too", () => {
  const s = stateWith(doc("a", "t1"), 1);
  s.metas.get("a")!.deleting = true;
  assert.equal(target(s, "a", 1), null);
  assert.equal(target(s, "b", 1), null);
});

/** A fake store with the Rust `save` rules: base compared with `updated`, a gone file becomes a copy of the edit. */
function fakeStore(docs: Doc[], clock: () => string) {
  const files = new Map(docs.map((d) => [d.id, d]));
  const writes: { id: string; edit: DocEdit }[] = [];
  let n = 0;
  const saveDoc: SaveFn = async (_project, id, base, edit) => {
    await new Promise((r) => setTimeout(r, 1));
    writes.push({ id, edit });
    const cur = files.get(id);
    const now = clock();
    if (!cur) {
      const copy = doc(`copy${++n}`, now, { title: `${edit.title ?? ""} (競合)`, body: edit.body ?? "", section: edit.section ?? null });
      files.set(copy.id, copy);
      return { kind: "recreated", copy } satisfies Saved;
    }
    const next: Doc = { ...cur, ...edit, updated: now } as Doc;
    if (cur.updated !== base) {
      const copy = { ...next, id: `copy${++n}`, title: `${next.title} (競合)` };
      files.set(copy.id, copy);
      return { kind: "conflict", doc: cur, copy } satisfies Saved;
    }
    files.set(id, next);
    return { kind: "written", ...next } satisfies Saved;
  };
  return { files, writes, saveDoc };
}

let tick = 0;
const seconds = () => `t${++tick}`;

/** A controller with one view that shows what it is told (the desktop pane on that document). */
function harness(docs: Doc[], clock: () => string = seconds) {
  const store = fakeStore(docs, clock);
  const notices: string[] = [];
  const saves = createDocSaves("仕事", { saveDoc: store.saveDoc, notice: (t) => notices.push(t), reload: () => undefined });
  const screen = { id: "", rev: 0 };
  const openDoc = (d: Doc) => {
    screen.id = d.id;
    screen.rev = saves.open(d);
  };
  const moved: string[] = [];
  saves.listen({
    moved: (from, shown) => {
      moved.push(from);
      if (screen.id === from) openDoc(shown);
    },
    written: () => undefined,
  });
  return { store, notices, saves, screen, openDoc, moved };
}

test("deleted elsewhere: the old editor's queued saves and the new editor's saves of the copy stay in one line", async () => {
  const h = harness([doc("a", "t0")]);
  h.openDoc(doc("a", "t0"));
  h.store.files.delete("a");
  const old = h.screen.rev;
  const p1 = h.saves.save("a", old, { title: "計画", body: "一\n" });
  // The old editor saves again before the first answer (its unmount flush).
  const p2 = h.saves.save("a", old, { title: "計画", body: "一二\n" });
  await p1;
  // The screen shows the copy with a new rev; its editor saves while the old save is still queued.
  assert.equal(h.screen.id, "copy1");
  const p3 = h.saves.save("copy1", h.screen.rev, { title: "計画", body: "一二三\n" });
  await Promise.all([p2, p3]);
  assert.deepEqual(
    h.store.writes.map((w) => w.id),
    ["a", "copy1", "copy1"],
  );
  // No second copy: the new editor's save had the base the old one returned.
  assert.equal(h.store.files.size, 1);
  assert.equal(h.store.files.get("copy1")!.body, "一二三\n");
});

test("same-second writes: the copy's editor still waits for the old editor's save to it", async () => {
  // Every write in the same second (the Rust store compares to the second).
  const h = harness([doc("a", "t0")], () => "same");
  h.openDoc(doc("a", "t0"));
  h.store.files.delete("a");
  const old = h.screen.rev;
  const p1 = h.saves.save("a", old, { title: "計画", body: "古い画面\n" });
  const p2 = h.saves.save("a", old, { title: "計画", body: "古い画面の続き\n" });
  await p1;
  const p3 = h.saves.save("copy1", h.screen.rev, { title: "計画", body: "新しい画面\n" });
  await Promise.all([p2, p3]);
  // The last write is the newest text, in the order the user typed it.
  assert.equal(h.store.files.get("copy1")!.body, "新しい画面\n");
  assert.deepEqual(h.store.writes.map((w) => w.edit.body), ["古い画面\n", "古い画面の続き\n", "新しい画面\n"]);
});

test("settled waits for saves that go to a document under another id", async () => {
  const h = harness([doc("a", "t0")]);
  h.openDoc(doc("a", "t0"));
  h.store.files.delete("a");
  const old = h.screen.rev;
  // The user is elsewhere when the answer comes back: the screen does not move.
  h.screen.id = "b";
  void h.saves.save("a", old, { title: "計画", body: "一\n" });
  void h.saves.save("a", old, { title: "計画", body: "一二\n" });
  // Opening the copy from the list waits for both, so the read sees the last text.
  await h.saves.settled();
  assert.equal(h.store.files.get("copy1")!.body, "一二\n");
  assert.deepEqual(h.moved, ["a"]);
  assert.equal(h.screen.id, "b");
});

test("a conflict does not move a screen that shows another document; the user is told", async () => {
  const h = harness([doc("a", "t0"), doc("b", "t0")]);
  h.openDoc(doc("a", "t0"));
  const revA = h.screen.rev;
  h.store.files.set("a", doc("a", "t9", { body: "外\n" }));
  const p = h.saves.save("a", revA, { title: "計画", body: "画面\n" });
  h.openDoc(doc("b", "t0"));
  await p;
  assert.equal(h.screen.id, "b");
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0], /ほかの場所で変更されていた/);
});

test("a delete that fails re-sends the text typed while it ran", async () => {
  const h = harness([doc("a", "t0")]);
  h.openDoc(doc("a", "t0"));
  const rev = h.screen.rev;
  await h.saves.beginDelete("a");
  await h.saves.save("a", rev, { title: "計画", body: "削除中に書いた\n" });
  assert.equal(h.store.writes.length, 0);
  await h.saves.deleteFailed("a");
  assert.equal(h.store.files.get("a")!.body, "削除中に書いた\n");
  // Nothing more to send: a second failure does not write again.
  await h.saves.beginDelete("a");
  await h.saves.deleteFailed("a");
  assert.equal(h.store.writes.length, 1);
});
