import { useRef } from "react";
import { api } from "../api/client";
import type { Doc, DocEdit } from "../types/model";
import { apply, metaOf, noteEdit, payload, target, type DocMeta } from "./docSaves";

const messageOf = (e: unknown) => String((e as { message?: unknown } | null)?.message ?? e);
const titleOf = (t: string) => (t === "" ? "無題" : t);

/**
 * Saving of open documents (spec 2026-11-28 §1), shared by the desktop pane and the iPhone screen. Saves of one
 * document run one after another; the base each one sends is decided when it runs (`docSaves.ts`), so a save the
 * editor queues right after another one carries the `updated` that one returned.
 */
export function useDocSaves(
  project: string,
  on: {
    /** Show `doc` in an editor with this new rev (a conflict or a deleted document moved the screen). */
    show: (doc: Doc, rev: number) => void;
    /** A save of the shown document was written. */
    written: (id: string, doc: Doc) => void;
    notice: (text: string) => void;
    /** The list changed (a copy was made). */
    reload: () => void;
  },
) {
  const metas = useRef(new Map<string, DocMeta>());
  const queue = useRef(new Map<string, Promise<void>>());
  const revs = useRef(0);
  const onRef = useRef(on);
  onRef.current = on;

  /** Starts showing `d`: its saves from now on carry the returned rev. */
  const open = (d: Doc): number => {
    const rev = ++revs.current;
    const old = metas.current.get(d.id);
    metas.current.set(d.id, { ...metaOf(d, rev), moved: old?.moved ?? {} });
    return rev;
  };

  const run = async (id: string, rev: number, edit: DocEdit) => {
    const m = metas.current.get(id);
    const to = target(m, id, rev);
    if (!m || !to) return;
    noteEdit(m, rev, edit);
    let r;
    try {
      r = await api.saveDoc(project, to.id, to.base, payload(m, edit));
    } catch (e) {
      onRef.current.notice(`保存できませんでした: ${messageOf(e)}`);
      return;
    }
    // Applied before this promise resolves: the next queued save reads it at once.
    const out = apply(metas.current, id, rev, to.id, r);
    if (out.kind === "written") {
      if (to.id === id) onRef.current.written(id, out.doc);
      return;
    }
    const shown = out.show;
    const text =
      out.kind === "conflict"
        ? `ほかの場所で変更されていたため、「${titleOf(out.copy.title)}」として残しました`
        : `この文書はほかの場所で削除されていたため、「${titleOf(shown.title)}」として残しました`;
    onRef.current.notice(text);
    onRef.current.show(shown, open(shown));
    onRef.current.reload();
  };

  /** Queues a save of document `id` made by the editor with `rev`. */
  const save = (id: string, rev: number, edit: DocEdit): Promise<void> => {
    const p = (queue.current.get(id) ?? Promise.resolve()).then(() => run(id, rev, edit));
    queue.current.set(id, p.catch(() => undefined));
    return p;
  };

  /** Resolves when every save queued for `id` so far has finished. */
  const settled = (id: string): Promise<void> => queue.current.get(id) ?? Promise.resolve();

  /** The current rev and last known state of `id`. */
  const metaOfId = (id: string) => metas.current.get(id);

  /** Deleting `id`: waits for its saves, then drops any that come later. */
  const beginDelete = async (id: string) => {
    await settled(id);
    const m = metas.current.get(id);
    if (m) m.deleting = true;
  };
  const forget = (id: string) => metas.current.delete(id);

  return { open, save, settled, meta: metaOfId, beginDelete, forget };
}
