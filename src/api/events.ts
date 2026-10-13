import { listen } from "@tauri-apps/api/event";
import type { SaveStatus } from "../types/model";

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

/** `project-changed` carries `{ name }`; the callback gets the name. */
export function onProjectChanged(cb: (name: string) => void): () => void {
  return subscribe<{ name: string }>("project-changed", (p) => cb(p.name));
}
