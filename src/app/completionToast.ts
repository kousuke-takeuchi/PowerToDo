/**
 * The toast after completing tasks (spec ④ §5): completions in a row share one toast, and 「元に戻す」 undoes each.
 * Pure, so it is tested with node --test.
 */
export type Completed = {
  project: string;
  no: number;
  before?: { due: string | null; dueTime: string | null; reminders: string[] };
};
export type ToastState = { entries: Completed[] };

/** Adds a completion to the toast (one toast for completions in a row; the same task once). */
export function merge(state: ToastState | null, c: Completed): ToastState {
  const entries = (state?.entries ?? []).filter((e) => !(e.project === c.project && e.no === c.no));
  return { entries: [...entries, c] };
}

export function toastText(state: ToastState): string {
  return `${state.entries.length} 件のタスクを完了しました`;
}

export type Undo =
  | { kind: "complete"; project: string; no: number; done: false }
  | { kind: "update"; project: string; no: number; patch: { due: string | null; dueTime: string | null; reminders: string[] } };

/** A repeating task never becomes done: complete_task moved its date on, so undo puts the old date back. */
export function undoOf(c: Completed): Undo {
  if (c.before) return { kind: "update", project: c.project, no: c.no, patch: { ...c.before } };
  return { kind: "complete", project: c.project, no: c.no, done: false };
}

export function completedOf(t: { project: string; no: number; rrule?: string; due?: string; dueTime?: string; reminders: string[] }): Completed {
  if (!t.rrule) return { project: t.project, no: t.no };
  return { project: t.project, no: t.no, before: { due: t.due ?? null, dueTime: t.dueTime ?? null, reminders: [...t.reminders] } };
}
