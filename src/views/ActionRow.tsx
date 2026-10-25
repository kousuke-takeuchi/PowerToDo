import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscLayer } from "../app/layers";
import { RowActions } from "../app/rowActions";
import { TaskRow, type TaskRowProps } from "../components/TaskRow";
import type { Task } from "../types/model";
import { DatePicker } from "./DatePicker";
import { placeMenu } from "./menuPlacement";
import { TaskEditor } from "./TaskEditor";
import { TASK_MENU_SIZE, TaskMenu } from "./TaskMenu";
import { blankValue, editBase, insertTarget, type EditorValue } from "./taskEditorValue";

const DATE_PICKER_SIZE = { width: 320, height: 470 };

/**
 * A task row with its hover actions (spec ② §2–§4). Without the RowActions context it is the plain row.
 * `dup`: a repeated copy of a task shown more than once (label grouping). It never shows the edit or insert
 * editors (they open on the first copy only, so one editor exists); its menu and date picker still work.
 */
export function ActionRow({ task, rowProps, canInsert, dup = false }: { task: Task; rowProps: TaskRowProps; canInsert: boolean; dup?: boolean }) {
  const ctx = useContext(RowActions);
  // The row key (`taskKey` in crossList, which imports this file).
  const key = `${task.project}/${task.no}`;
  const [open, setOpen] = useState<null | "menu" | "date">(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(null);
    ctx?.setOverlay(null);
  };
  // A row that leaves with its menu open (completed and hidden, deleted) must not keep the row keys off.
  const setOverlay = ctx?.setOverlay;
  useEffect(() => (open ? () => setOverlay?.(null) : undefined), [open, setOverlay]);
  // The edit is compared with the task as it was when editing began: a sync may change the task meanwhile.
  const base = useRef<EditorValue | null>(null);
  base.current = editBase(base.current, !dup && ctx?.editing === key, task);
  // Outside both the row (its own buttons toggle) and the popover (portaled to body).
  const pop = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const n = e.target instanceof Node ? e.target : null;
      if (n && !box.current?.contains(n) && !pop.current?.contains(n)) closeRef.current();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  // Placed first with an estimated size; once drawn, again with the real one (it differs per task and pane).
  useLayoutEffect(() => {
    const el = pop.current;
    const r = box.current?.getBoundingClientRect();
    if (!open || !el || !r) return;
    const next = placeMenu(
      { top: r.top, bottom: r.top + 36, right: r.right },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos((cur) => (cur && cur.top === next.top && cur.left === next.left ? cur : next));
  });
  // The menu has its own Esc layer; the date picker does not.
  useEscLayer(open === "date", close);
  if (!ctx) return <TaskRow {...rowProps} />;

  const show = (kind: "menu" | "date", size: { width: number; height: number }) => {
    if (open === kind) {
      close();
      return;
    }
    const r = box.current?.getBoundingClientRect();
    if (r) setPos(placeMenu({ top: r.top, bottom: r.top + 36, right: r.right }, size, { width: window.innerWidth, height: window.innerHeight }));
    setOpen(kind);
    ctx.setOverlay(key);
  };
  const ins = ctx.inserting;
  const insertHere = (where: "before" | "after") =>
    !dup && ins && ins.project === task.project && ins.anchorNo === task.no && ins.where === where ? (
      <TaskEditor
        mode="add"
        initial={blankValue(task.project, task.category)}
        allLabels={ctx.allLabels}
        today={ctx.today}
        inbox={ctx.inbox}
        projects={task.parentNo === undefined ? ctx.projects : undefined}
        onCancel={() => ctx.setInserting(null)}
        onSubmit={async (v) => {
          const target = insertTarget(task, v, where);
          const no = await ctx.add(v, { parentNo: task.parentNo, position: target.follow ? target.position : undefined });
          if (no === null) return false;
          // Spec ② §4.1: the editor moves under the task just added (only when it went next to this one).
          ctx.setInserting(target.follow ? { project: task.project, anchorNo: no, where: "after" } : null);
          return true;
        }}
      />
    ) : null;

  const row =
    !dup && ctx.editing === key ? (
      <TaskEditor
        mode="edit"
        initial={base.current ?? editBase(null, true, task)!}
        allLabels={ctx.allLabels}
        today={ctx.today}
        inbox={ctx.inbox}
        projects={task.parentNo === undefined ? ctx.projects : undefined}
        onCancel={() => ctx.setEditing(null)}
        onSubmit={async (v) => {
          const ok = await ctx.save(task, base.current ?? editBase(null, true, task)!, v);
          if (ok) ctx.setEditing(null);
          return ok;
        }}
      />
    ) : (
      <TaskRow
        {...rowProps}
        showActions={rowProps.showActions || open !== null}
        onEdit={() => ctx.setEditing(key)}
        onDate={() => show("date", DATE_PICKER_SIZE)}
        onComment={() => ctx.openComments(task)}
        onMore={() => show("menu", TASK_MENU_SIZE)}
      />
    );

  return (
    <div ref={box} style={{ position: "relative" }}>
      {insertHere("before")}
      {row}
      {insertHere("after")}
      {open &&
        pos &&
        createPortal(
        <div ref={pop} style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 40 }}>
          {open === "menu" ? (
            <TaskMenu
              task={task}
              today={ctx.today}
              canInsert={canInsert}
              projects={ctx.projects}
              onClose={close}
              onAddAbove={() => ctx.setInserting({ project: task.project, anchorNo: task.no, where: "before" })}
              onAddBelow={() => ctx.setInserting({ project: task.project, anchorNo: task.no, where: "after" })}
              onEdit={() => ctx.setEditing(key)}
              onDue={(d) => ctx.setDue(task, d)}
              onPriority={(pr) => ctx.setPriority(task, pr)}
              onReminders={(r) => ctx.setReminders(task, r)}
              onMove={(project, section) => ctx.move(task, project, section)}
              onDuplicate={() => ctx.duplicate(task)}
              onDelete={() => ctx.requestDelete(task)}
            />
          ) : (
            <DatePicker
              value={task.due}
              time={task.dueTime}
              today={ctx.today}
              onChange={({ date }) => {
                close();
                ctx.setDue(task, date);
              }}
            />
          )}
        </div>,
          document.body,
        )}
    </div>
  );
}
