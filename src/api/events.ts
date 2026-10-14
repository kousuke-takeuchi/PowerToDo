import { listen } from "@tauri-apps/api/event";
import type { ChangeReason, SaveStatus } from "../types/model";

/**
 * `listen` is async; the returned function unsubscribes even if it is called before the
 * subscription finished (the late UnlistenFn is invoked as soon as it arrives).
 */
function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  let cancelled = false;
  let unlisten: (() => void) | undefined;
  listen<T>(event, (e) => cb(e.payload))
    .then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    })
    .catch((err) => console.error(`listen(${event}) failed`, err));
  return () => {
    cancelled = true;
    unlisten?.();
    unlisten = undefined;
  };
}

export function onSaveStatus(cb: (s: SaveStatus) => void): () => void {
  return subscribe<SaveStatus>("save-status", cb);
}

/** `project-changed` carries `{ name, reason }`. */
export function onProjectChanged(cb: (name: string, reason: ChangeReason) => void): () => void {
  return subscribe<{ name: string; reason: ChangeReason }>("project-changed", (p) => cb(p.name, p.reason));
}

/** `projects-changed` (project list or labels changed as a whole, e.g. a label rename that touched several projects). */
export function onProjectsChanged(cb: () => void): () => void {
  return subscribe<Record<string, never>>("projects-changed", () => cb());
}
