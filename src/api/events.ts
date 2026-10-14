import { listen } from "@tauri-apps/api/event";
import type { ChangeReason, ProjectsChanged, SaveStatus } from "../types/model";

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

/**
 * `projects-changed` (project list or labels changed as a whole, e.g. a label rename that touched several projects).
 * `commonReloaded` is true only when the common workbook was re-read from its file in that batch.
 */
export function onProjectsChanged(cb: (p: ProjectsChanged) => void): () => void {
  return subscribe<ProjectsChanged>("projects-changed", (p) => cb({ commonReloaded: p?.commonReloaded === true }));
}

/** `external-change`: a file changed on disk while the project had unsaved edits (it is now held). `project` may be "_common". */
export function onExternalChange(cb: (project: string) => void): () => void {
  return subscribe<{ project: string }>("external-change", (p) => cb(p.project));
}

/**
 * `external-read-failed`: `project` ("_common" included) changed on disk but could not be read (Excel mid-save, a broken file).
 * The in-memory book is kept; the next change event reads it again.
 */
export function onExternalReadFailed(cb: (project: string, message: string) => void): () => void {
  return subscribe<{ project: string; message: string }>("external-read-failed", (p) => cb(p.project, p.message));
}

/** `exit-blocked`: the app was asked to quit while these projects ("_common" included) are held. */
export function onExitBlocked(cb: (projects: string[]) => void): () => void {
  return subscribe<string[]>("exit-blocked", cb);
}

/** `watch-failed`: the data-folder watcher could not start (the payload is the reason). */
export function onWatchFailed(cb: (message: string) => void): () => void {
  return subscribe<string>("watch-failed", cb);
}
