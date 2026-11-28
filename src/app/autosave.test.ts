import { test } from "node:test";
import assert from "node:assert/strict";
import { createAutosave } from "./autosave.ts";

function fakeTimers() {
  let next = 1;
  const pending = new Map<number, () => void>();
  return {
    set: (fn: () => void) => { const id = next++; pending.set(id, fn); return id; },
    clear: (id: number | undefined) => { if (id !== undefined) pending.delete(id); },
    fire: () => { const fns = [...pending.values()]; pending.clear(); fns.forEach((f) => f()); },
    count: () => pending.size,
  };
}

test("typing saves once after the pause", () => {
  const t = fakeTimers(); let saves = 0;
  const a = createAutosave(() => saves++, 1000, t);
  a.touch(); a.touch(); a.touch();
  assert.equal(t.count(), 1);
  t.fire();
  assert.equal(saves, 1);
});

test("leaving before the pause saves at once, and only once", () => {
  const t = fakeTimers(); let saves = 0;
  const a = createAutosave(() => saves++, 1000, t);
  a.touch();
  a.flush();
  assert.equal(saves, 1);
  t.fire();
  assert.equal(saves, 1);
});

test("flush with nothing typed does not save", () => {
  const t = fakeTimers(); let saves = 0;
  createAutosave(() => saves++, 1000, t).flush();
  assert.equal(saves, 0);
});

test("cancel drops a pending save", () => {
  const t = fakeTimers(); let saves = 0;
  const a = createAutosave(() => saves++, 1000, t);
  a.touch(); a.cancel(); t.fire(); a.flush();
  assert.equal(saves, 0);
});
