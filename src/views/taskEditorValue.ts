import type { QuickAddResult, Task, TaskInput, TaskPatch } from "../types/model";

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

/**
 * Spec ② §4.1: an editor opened above / below a task adds right there only while it stays in that task's project
 * and section; moved elsewhere in the editor, the task is appended there and the editor does not follow it.
 */
export function insertTarget(
  anchor: Task,
  v: EditorValue,
  where: "before" | "after",
): { position: { before: number } | { after: number }; follow: true } | { follow: false } {
  if (v.project !== anchor.project || v.section !== anchor.category) return { follow: false };
  return { position: where === "before" ? { before: anchor.no } : { after: anchor.no }, follow: true };
}

/** The value an edit is compared with: the task as it was when editing began (a sync may change it meanwhile). */
export function editBase(cur: EditorValue | null, editing: boolean, task: Task): EditorValue | null {
  if (!editing) return null;
  return cur ?? editorValueOf(task);
}

/**
 * Whether the title is read like quick add. Always when adding; when editing only if the title was changed, so saving
 * another field never strips date words an existing title already contains.
 */
export function shouldParse(mode: "add" | "edit", title: string, initialTitle: string): boolean {
  return title.trim() !== "" && (mode === "add" || title !== initialTitle);
}

/**
 * Merges what quick add read from the title into the editor value (spec §13). A field is replaced only when the text had
 * its token: date (and its time), time, recurrence, priority, `#project`. Labels are added to the chosen ones. The rest of the
 * text is the title; if nothing is left, the value is returned unchanged. `projects`: names the `#project` may match.
 */
export function applyParsed(v: EditorValue, r: QuickAddResult, projects: string[] = []): EditorValue {
  const target = r.project === null ? undefined : (projects.find((n) => n === r.project) ?? projects.find((n) => n.toLowerCase() === r.project!.toLowerCase()));
  // A `#project` the editor cannot move to (a subtask, or a name it does not offer) stays in the title instead of vanishing.
  const title = (r.project !== null && target === undefined ? titleKeepingProject(v.title, r) : r.title).trim();
  if (title === "") return v;
  const out: EditorValue = { ...v, title };
  if (r.due) out.due = r.due;
  if (r.dueTime) out.dueTime = r.dueTime;
  if (r.rrule) out.rrule = r.rrule;
  if (r.priority) out.priority = r.priority;
  for (const l of r.labels) if (!out.labels.includes(l)) out.labels = [...out.labels, l];
  if (target !== undefined && target !== v.project) {
    out.project = target;
    out.section = null;
  }
  return out;
}

/** The text without the recognised words except `#project` (span offsets are code points), words joined by one space like quick add. */
function titleKeepingProject(text: string, r: QuickAddResult): string {
  const chars = Array.from(text);
  const drop = new Set<number>();
  for (const s of r.spans) if (s.kind !== "project") for (let i = s.start; i < s.end && i < chars.length; i++) drop.add(i);
  const words = chars
    .filter((_, i) => !drop.has(i))
    .join("")
    .split(/\s+/)
    .filter((w) => w !== "");
  return words.length > 0 ? words.join(" ") : r.title;
}
