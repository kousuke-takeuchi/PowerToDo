/**
 * The saving rules of an open document (spec 2026-11-28 §1, 同期の競合). Pure; tested with node.
 *
 * Every editor that shows a document has a `rev`. Saves carry the rev of the editor that made them. When a save comes
 * back as a conflict (or the document was deleted elsewhere), the screen shows another document with a new rev; saves
 * that the old editor still had queued then go to the copy that was made for its text, never to the reloaded
 * document with its new base (that would write the old screen text over the other side's change).
 */
import type { AttachmentInfo, Doc, DocEdit, Saved } from "../types/model";

export type DocMeta = {
  /** The `updated` the next save of the current rev sends as its base. */
  updated: string;
  /** The rev of the editor that shows this document now. */
  rev: number;
  /** The last known text, sent with every save so a copy made for a deleted document keeps it. */
  title: string;
  body: string;
  section: string | null;
  files: AttachmentInfo[];
  /** Saves of an older rev go to the copy made for that rev (id and its latest `updated`). */
  moved: Record<number, { id: string; updated: string }>;
  /** Being deleted: later saves are dropped. */
  deleting?: boolean;
};

export function metaOf(d: Doc, rev: number): DocMeta {
  return { updated: d.updated, rev, title: d.title, body: d.body, section: d.section, files: d.files, moved: {} };
}

/** Where a save of `rev` for document `id` goes, with which base; `null` drops it. */
export function target(m: DocMeta | undefined, id: string, rev: number): { id: string; base: string } | null {
  if (!m || m.deleting) return null;
  const to = m.moved[rev];
  return to ? { id: to.id, base: to.updated } : { id, base: m.updated };
}

/** What a save sends: the last known title, body and section, with the edit on top. */
export function payload(m: DocMeta, edit: DocEdit): DocEdit {
  return { title: m.title, body: m.body, section: m.section, ...edit };
}

/** Remembers the text a save of the current rev is about to send (a later file-only save then carries it). */
export function noteEdit(m: DocMeta, rev: number, edit: DocEdit): void {
  if (rev !== m.rev) return;
  if (edit.title !== undefined) m.title = edit.title;
  if (edit.body !== undefined) m.body = edit.body;
  if (edit.section !== undefined) m.section = edit.section;
  if (edit.files !== undefined) m.files = edit.files;
}

export type Outcome =
  | { kind: "written"; doc: Doc }
  | { kind: "conflict"; show: Doc; copy: Doc }
  | { kind: "recreated"; show: Doc };

/**
 * Applies the answer to a save of `rev` for document `id` (sent to `sent`, which is `id` or a copy it moved to).
 * Updates `metas` and says what the screen does. The caller gives the shown document a new rev (`metaOf`).
 */
export function apply(metas: Map<string, DocMeta>, id: string, rev: number, sent: string, r: Saved): Outcome {
  const m = metas.get(id);
  if (r.kind === "written") {
    const doc: Doc = r;
    if (m && sent !== id) m.moved[rev] = { id: sent, updated: doc.updated };
    else if (m && rev === m.rev) {
      m.updated = doc.updated;
      m.section = doc.section;
      m.files = doc.files;
    } else if (m) m.updated = doc.updated;
    return { kind: "written", doc };
  }
  if (r.kind === "conflict") {
    // The old editor's queued saves go to the copy of its text.
    if (m) {
      m.moved[rev] = { id: r.copy.id, updated: r.copy.updated };
      m.updated = r.doc.updated;
    }
    return { kind: "conflict", show: r.doc, copy: r.copy };
  }
  if (m) {
    m.moved[rev] = { id: r.copy.id, updated: r.copy.updated };
    m.deleting = false;
  }
  return { kind: "recreated", show: r.copy };
}
