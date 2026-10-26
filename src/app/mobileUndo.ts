import { merge, toastText, undoOf, type Completed } from "./completionToast.ts";

/** Spec ④ iPhone §5.4: the toast after completing, changing a date, or moving; 「元に戻す」 puts the previous state back. Pure. */
export type DateEntry = { project: string; no: number; before: { due: string | null; dueTime: string | null } };
export type MobileUndo =
  | { kind: "complete"; entries: Completed[] }
  | { kind: "date"; entries: DateEntry[]; label: string | null }
  | { kind: "move"; to: { project: string; no: number }; back: { project: string; section: string | null }; toName: string };
export type UndoStep =
  | { op: "complete"; project: string; no: number; done: false }
  | { op: "update"; project: string; no: number; patch: { due: string | null; dueTime: string | null; reminders?: string[]; rrule?: string } }
  | { op: "move"; project: string; no: number; toProject: string; toSection: string | null };

/** Completions in a row share one toast (as desktop); anything else replaces it, and undo then covers only the newest. */
export function pushUndo(cur: MobileUndo | null, next: MobileUndo): MobileUndo {
  if (cur?.kind !== "complete" || next.kind !== "complete") return next;
  let state = { entries: cur.entries };
  for (const c of next.entries) state = merge(state, c);
  return { kind: "complete", entries: state.entries };
}

export function undoText(u: MobileUndo): string {
  switch (u.kind) {
    case "complete":
      return toastText({ entries: u.entries });
    case "date": {
      const n = u.entries.length;
      if (u.label) return n > 1 ? `${n} 件のタスクを ${u.label} にスケジュールしました` : `${u.label} にスケジュールしました`;
      return n > 1 ? `${n} 件のタスクの日付を削除しました` : "日付を削除しました";
    }
    case "move":
      return `${u.toName} に移動しました`;
  }
}

export function undoSteps(u: MobileUndo): UndoStep[] {
  switch (u.kind) {
    case "complete":
      return u.entries.flatMap((c): UndoStep[] => {
        const x = undoOf(c);
        const reopen: UndoStep = { op: "complete", project: x.project, no: x.no, done: false };
        return x.kind === "restore" ? [reopen, { op: "update", project: x.project, no: x.no, patch: x.patch }] : [reopen];
      });
    case "date":
      return u.entries.map((e) => ({ op: "update", project: e.project, no: e.no, patch: { due: e.before.due, dueTime: e.before.dueTime } }));
    case "move":
      // move_task renumbers the task in the target: `to.no` is its number there (MobileMain reads it from the result).
      return [{ op: "move", project: u.to.project, no: u.to.no, toProject: u.back.project, toSection: u.back.section }];
  }
}
