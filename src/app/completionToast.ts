/**
 * The toast after completing tasks (spec ④ §5): completions in a row share one toast, and 「元に戻す」 undoes each.
 * Pure, so it is tested with node --test.
 */
export type Completed = {
  project: string;
  no: number;
  before?: { due: string | null; dueTime: string | null; reminders: string[]; rrule: string };
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

/**
 * `restore`: reopen the task (harmless when it is open), then put the date, reminders and rule back. Completing a
 * repeating task moves its date on; completing its last occurrence (COUNT / UNTIL used up) drops the rule and marks
 * it done, so both steps are needed.
 */
export type Undo =
  | { kind: "complete"; project: string; no: number; done: false }
  | { kind: "restore"; project: string; no: number; patch: { due: string | null; dueTime: string | null; reminders: string[]; rrule: string } };

export function undoOf(c: Completed): Undo {
  if (c.before) return { kind: "restore", project: c.project, no: c.no, patch: { ...c.before } };
  return { kind: "complete", project: c.project, no: c.no, done: false };
}

export function completedOf(t: { project: string; no: number; rrule?: string; due?: string; dueTime?: string; reminders: string[] }): Completed {
  if (!t.rrule) return { project: t.project, no: t.no };
  return { project: t.project, no: t.no, before: { due: t.due ?? null, dueTime: t.dueTime ?? null, reminders: [...t.reminders], rrule: t.rrule } };
}

/** The bottom-left notice: completions in a row share one (with their undo), anything else replaces it (spec ② §6). */
export type Notice = { kind: "done"; state: ToastState } | { kind: "note"; text: string; action: string; id: number };

export function nextNotice(cur: Notice | null, incoming: { done: Completed } | { text: string; action: string; id: number }): Notice {
  if ("done" in incoming) return { kind: "done", state: merge(cur?.kind === "done" ? cur.state : null, incoming.done) };
  return { kind: "note", ...incoming };
}

export function noticeText(n: Notice): string {
  return n.kind === "done" ? toastText(n.state) : n.text;
}
