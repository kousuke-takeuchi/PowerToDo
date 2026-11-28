/**
 * The saving rules of open documents (spec 2026-11-28 §1, 同期の競合). No React, no Tauri; tested with node.
 *
 * Every editor that shows a document has a `rev`. Saves carry the rev of the editor that made them. When a save comes
 * back as a conflict (or the document was deleted elsewhere), the screen may show another document with a new rev;
 * saves that the old editor still had queued then go to the copy that was made for its text, never to the reloaded
 * document with its new base (that would write the old screen text over the other side's change).
 *
 * All saves of one controller run one after another, whatever document they were queued for, so two saves that end
 * up writing the same file (an old editor's save moved to a copy, and the copy's own editor) never overlap, and each
 * one sends the `updated` the save before it got back (`bases`, one per document actually written).
 */
import type { AttachmentInfo, Doc, DocEdit, Saved } from "../types/model";

/** What an editor last sent (or is about to): every save carries it, so a copy made for a deleted document keeps it. */
export type Known = { title: string; body: string; section: string | null; files: AttachmentInfo[] };

export type DocMeta = Known & {
  /** The rev of the editor that shows this document now. */
  rev: number;
  /** Saves of an older rev go to the copy made for that rev, with what that editor last sent. */
  moved: Record<number, Known & { id: string }>;
  /** Being deleted: later saves are not sent. */
  deleting?: boolean;
  /** A save was not sent while deleting; a failed delete sends the text once. */
  dropped?: boolean;
};

export type DocState = {
  metas: Map<string, DocMeta>;
  /** The latest `updated` known for each document id (read, or returned by a save). */
  bases: Map<string, string>;
};

export function metaOf(d: Doc, rev: number): DocMeta {
  return { rev, title: d.title, body: d.body, section: d.section, files: d.files, moved: {} };
}

const known = (k: Known): Known => ({ title: k.title, body: k.body, section: k.section, files: k.files });

/** Where a save of `rev` for document `id` goes, with which base; `null` does not send it. */
export function target(s: DocState, id: string, rev: number): { id: string; base: string } | null {
  const m = s.metas.get(id);
  if (!m || m.deleting) return null;
  const to = m.moved[rev]?.id ?? id;
  const base = s.bases.get(to);
  return base === undefined ? null : { id: to, base };
}

/**
 * What a save sends: its editor's last known title, body, section and files, with the edit on top. A copy rebuilt
 * for a document deleted elsewhere is made from the edit alone, so the files must travel with every save.
 */
export function payload(m: DocMeta, rev: number, edit: DocEdit): DocEdit {
  const k = m.moved[rev] ?? m;
  return { title: k.title, body: k.body, section: k.section, files: k.files, ...edit };
}

/** Remembers the text a save is about to send: the current rev's in the meta, a moved rev's with its copy. */
export function noteEdit(m: DocMeta, rev: number, edit: DocEdit): void {
  const k: Known | undefined = m.moved[rev] ?? (rev === m.rev ? m : undefined);
  if (!k) return;
  if (edit.title !== undefined) k.title = edit.title;
  if (edit.body !== undefined) k.body = edit.body;
  if (edit.section !== undefined) k.section = edit.section;
  if (edit.files !== undefined) k.files = edit.files;
}

export type Outcome =
  | { kind: "written"; doc: Doc }
  /** `from`: the document the save was written to (`id`, or a copy it had moved to). */
  | { kind: "conflict"; from: string; show: Doc; copy: Doc }
  | { kind: "recreated"; from: string; show: Doc };

/**
 * Applies the answer to a save of `rev` for document `id` (sent to `sent`, which is `id` or a copy it moved to).
 * Updates the state and says what happened. A screen that shows `from` shows `show` with a new rev (`open`).
 */
export function apply(s: DocState, id: string, rev: number, sent: string, r: Saved): Outcome {
  const m = s.metas.get(id);
  const moveTo = (copy: Doc) => {
    if (m) m.moved[rev] = { id: copy.id, ...known(m.moved[rev] ?? m) };
    s.bases.set(copy.id, copy.updated);
  };
  if (r.kind === "written") {
    const doc: Doc = r;
    s.bases.set(sent, doc.updated);
    if (m && sent === id && rev === m.rev) {
      m.section = doc.section;
      m.files = doc.files;
    }
    return { kind: "written", doc };
  }
  if (r.kind === "conflict") {
    s.bases.set(sent, r.doc.updated);
    moveTo(r.copy);
    return { kind: "conflict", from: sent, show: r.doc, copy: r.copy };
  }
  moveTo(r.copy);
  if (m) m.deleting = false;
  return { kind: "recreated", from: sent, show: r.copy };
}

export type SaveFn = (project: string, id: string, base: string, edit: DocEdit) => Promise<Saved>;

/** A screen that shows documents. */
export type DocView = {
  /** A save of `from` came back as a conflict or found it deleted: if the screen still shows `from`, it shows `shown` (`open`). */
  moved: (from: string, shown: Doc) => void;
  /** A save of the shown document `id` was written. */
  written: (id: string, doc: Doc) => void;
};

export type DocSaves = ReturnType<typeof createDocSaves>;

const messageOf = (e: unknown) => String((e as { message?: unknown } | null)?.message ?? e);
const titleOf = (t: string) => (t === "" ? "無題" : t);

/** The saves of one project's documents. `io` is read at each use, so its functions may be replaced. */
export function createDocSaves(project: string, io: { saveDoc: SaveFn; notice: (text: string) => void; reload: () => void }) {
  const s: DocState = { metas: new Map(), bases: new Map() };
  const views = new Set<DocView>();
  let tail: Promise<void> = Promise.resolve();
  let revs = 0;

  const run = async (id: string, rev: number, edit: DocEdit) => {
    const m = s.metas.get(id);
    if (!m) return;
    noteEdit(m, rev, edit);
    const to = target(s, id, rev);
    if (!to) {
      if (m.deleting && rev === m.rev) m.dropped = true;
      return;
    }
    let r: Saved;
    try {
      r = await io.saveDoc(project, to.id, to.base, payload(m, rev, edit));
    } catch (e) {
      io.notice(`保存できませんでした: ${messageOf(e)}`);
      return;
    }
    // Applied before this promise resolves: the next queued save reads it at once.
    const out = apply(s, id, rev, to.id, r);
    if (out.kind === "written") {
      if (to.id === id) views.forEach((v) => v.written(id, out.doc));
      return;
    }
    io.notice(
      out.kind === "conflict"
        ? `ほかの場所で変更されていたため、「${titleOf(out.copy.title)}」として残しました`
        : `この文書はほかの場所で削除されていたため、「${titleOf(out.show.title)}」として残しました`,
    );
    views.forEach((v) => v.moved(out.from, out.show));
    io.reload();
  };

  /** Queues a save of document `id` made by the editor with `rev`. */
  const save = (id: string, rev: number, edit: DocEdit): Promise<void> => {
    const p = tail.then(() => run(id, rev, edit));
    tail = p.catch(() => undefined);
    return p;
  };

  /** Resolves when every save queued so far (and any queued while waiting) has finished. Read a document after it. */
  const settled = async (): Promise<void> => {
    let t: Promise<void>;
    do {
      t = tail;
      await t;
    } while (t !== tail);
  };

  return {
    /** Starts showing `d`: its saves from now on carry the returned rev. */
    open(d: Doc): number {
      const rev = ++revs;
      const old = s.metas.get(d.id);
      s.metas.set(d.id, { ...metaOf(d, rev), moved: old?.moved ?? {} });
      s.bases.set(d.id, d.updated);
      return rev;
    },
    save,
    settled,
    /** The current rev and last known state of `id`. */
    meta: (id: string): DocMeta | undefined => s.metas.get(id),
    /** Deleting `id`: waits for the saves, then does not send any that come later. */
    async beginDelete(id: string): Promise<void> {
      await settled();
      const m = s.metas.get(id);
      if (m) m.deleting = true;
    },
    /** The delete failed: saves are sent again, and text typed while it ran is sent once. */
    deleteFailed(id: string): Promise<void> {
      const m = s.metas.get(id);
      if (!m) return Promise.resolve();
      m.deleting = false;
      if (!m.dropped) return Promise.resolve();
      m.dropped = false;
      return save(id, m.rev, known(m));
    },
    forget(id: string): void {
      s.metas.delete(id);
    },
    /** Adds a screen; returns its removal. */
    listen(v: DocView): () => void {
      views.add(v);
      return () => void views.delete(v);
    },
  };
}
