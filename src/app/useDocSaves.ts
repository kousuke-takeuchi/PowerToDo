import { useEffect, useRef } from "react";
import { api } from "../api/client";
import { createDocSaves, type DocSaves, type DocView } from "./docSaves";

type Io = { notice: (text: string) => void; reload: () => void };

/** One controller per project for the whole app run, with the callbacks of the screen that rendered last. */
const registry = new Map<string, { saves: DocSaves; io: Io }>();

/**
 * Saving of open documents (spec 2026-11-28 §1; rules in `docSaves.ts`), shared by the desktop pane and the iPhone
 * screens. Every screen of a project uses the same controller, so a screen opened again (another pane after a project
 * switch, the iPhone document screen pushed again) waits for the saves its predecessor queued when it was left.
 * `view` gets the answers that move the screen (a conflict, a deletion elsewhere) and the written saves.
 */
export function useDocSaves(project: string, on: Io, view: DocView): DocSaves {
  let entry = registry.get(project);
  if (!entry) {
    const io: Io = { ...on };
    const saves = createDocSaves(project, { saveDoc: api.saveDoc, notice: (t) => io.notice(t), reload: () => io.reload() });
    entry = { saves, io };
    registry.set(project, entry);
  }
  Object.assign(entry.io, on);
  const saves = entry.saves;
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => saves.listen({ moved: (from, shown) => viewRef.current.moved(from, shown), written: (id, d) => viewRef.current.written(id, d) }), [saves]);
  return saves;
}
