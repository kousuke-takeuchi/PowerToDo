import type { Task, TaskInput, TaskPatch } from "../types/model";

/** What the inline editor edits (spec ② §3). `note` is "" when there is none. */
export type EditorValue = {
  title: string;
  note: string;
  due?: string;
  dueTime?: string;
  priority: 1 | 2 | 3 | 4;
  labels: string[];
  reminders: string[];
  rrule?: string;
  project: string;
  section: string | null;
};

export function editorValueOf(t: Task): EditorValue {
  return {
    title: t.title,
    note: t.note ?? "",
    due: t.due,
    dueTime: t.dueTime,
    priority: t.priority,
    labels: [...t.labels],
    reminders: [...t.reminders],
    rrule: t.rrule,
    project: t.project,
    section: t.category,
  };
}

export function blankValue(project: string, section: string | null, defaults: Partial<EditorValue> = {}): EditorValue {
  return { title: "", note: "", priority: 4, labels: [], reminders: [], project, section, ...defaults };
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function changed(a: EditorValue, b: EditorValue): boolean {
  return (
    a.title !== b.title ||
    a.note !== b.note ||
    a.due !== b.due ||
    a.dueTime !== b.dueTime ||
    a.priority !== b.priority ||
    !same(a.labels, b.labels) ||
    !same(a.reminders, b.reminders) ||
    a.rrule !== b.rrule ||
    a.project !== b.project ||
    a.section !== b.section
  );
}

export function toInput(v: EditorValue, parentNo?: number): TaskInput {
  const note = v.note.trim();
  return {
    title: v.title.trim(),
    section: v.section,
    priority: v.priority,
    due: v.due ?? null,
    dueTime: v.dueTime ?? null,
    note: note === "" ? null : note,
    labels: v.labels,
    parentNo: parentNo ?? null,
    rrule: v.rrule ?? null,
    reminders: v.reminders,
  };
}

/** The fields that changed, `null` to clear. Project and section are not here: they move the task (`moveOf`). */
export function toPatch(before: EditorValue, after: EditorValue): TaskPatch {
  const p: TaskPatch = {};
  if (after.title.trim() !== before.title) p.title = after.title.trim();
  if (after.note.trim() !== before.note) p.note = after.note.trim() === "" ? null : after.note.trim();
  if (after.due !== before.due) p.due = after.due ?? null;
  if (after.dueTime !== before.dueTime) p.dueTime = after.dueTime ?? null;
  if (after.priority !== before.priority) p.priority = after.priority;
  if (!same(after.labels, before.labels)) p.labels = after.labels;
  if (!same(after.reminders, before.reminders)) p.reminders = after.reminders;
  if (after.rrule !== before.rrule) p.rrule = after.rrule ?? null;
  return p;
}

export function moveOf(before: EditorValue, after: EditorValue): { project: string; section: string | null } | null {
  return before.project === after.project && before.section === after.section ? null : { project: after.project, section: after.section };
}

/**
 * Enter in the name, ⌘Enter / Ctrl+Enter in the description; never during IME composition (the same check as
 * `isImeKey` in app/keys.ts: WebKit sends the committing Enter with keyCode 229).
 */
export function submitKey(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; isComposing?: boolean; keyCode?: number },
  field: "title" | "note",
): "submit" | null {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return null;
  if (field === "title") return e.shiftKey ? null : "submit";
  return e.metaKey || e.ctrlKey ? "submit" : null;
}
