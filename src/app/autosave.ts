/** Autosave of a document (spec 2026-11-28: 1 s after typing stops, or at once when leaving). Pure. */
type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (id: never) => void };

const browserTimers: Timers = { set: (f, ms) => setTimeout(f, ms), clear: (id) => clearTimeout(id) };

export function createAutosave(save: () => void, delayMs = 1000, timers: Timers = browserTimers) {
  let id: unknown;
  let dirty = false;
  const stop = () => {
    if (id !== undefined) timers.clear(id as never);
    id = undefined;
  };
  const run = () => {
    id = undefined;
    if (!dirty) return;
    dirty = false;
    save();
  };
  return {
    touch() {
      dirty = true;
      stop();
      id = timers.set(run, delayMs);
    },
    flush() {
      stop();
      run();
    },
    cancel() {
      stop();
      dirty = false;
    },
  };
}
