import type React from "react";
import { useState } from "react";
import { Bell, Calendar, ChevronDown, ChevronRight, ChevronUp, Ellipsis, Flag, Folder, Repeat, Tag, X } from "lucide-react";
import { AddTaskRow } from "../components/AddTaskRow";
import { Button } from "../components/Button";
import { Checkbox } from "../components/Checkbox";
import { TaskRow } from "../components/TaskRow";
import { TextField } from "../components/TextField";
import { dateLabel } from "../mock/data";
import type { Comment, Project, Task } from "../types/model";
import { DatePicker } from "./DatePicker";
import { RecurrencePicker, recurrenceLabel } from "./RecurrencePicker";
import { ReminderPicker, reminderSummary } from "./ReminderPicker";
import { useDone } from "./useDone";

export type TaskDetailPanelProps = {
  task: Task;
  subtasks: Task[];
  project: Project;
  section?: string;
  initialPopover?: "date" | "recurrence" | "reminder";
  onClose?: () => void;
  /** コメント一覧。task.no と同じ taskNo のものだけ表示する。 */
  comments?: Comment[];
};

type Popover = NonNullable<TaskDetailPanelProps["initialPopover"]>;

// pen のポップオーバーは画面座標 (x 1040 = パネルの左端, y 300 / 420)。aside の border-left 1px の分だけ left: -1 で合わせる。パネルは画面上端から始まるので同じ値でよい。
const POPOVER_TOP: Record<Popover, number> = { date: 300, recurrence: 300, reminder: 420 };

const heading: React.CSSProperties = { fontSize: 13, lineHeight: "19px", fontWeight: 700, color: "var(--color-text-primary)" };

function PropRow({
  icon,
  name,
  value,
  valueColor = "var(--color-text-primary)",
  onClick,
  expanded,
}: {
  icon: React.ReactNode;
  name: string;
  value: string;
  valueColor?: string;
  onClick?: () => void;
  expanded?: boolean;
}) {
  const content = (
    <>
      <span style={{ display: "inline-flex", color: "var(--color-text-secondary)", flex: "0 0 auto" }}>{icon}</span>
      <span style={{ width: 100, flex: "0 0 auto", fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>{name}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: "19px", color: valueColor }}>{value}</span>
      <span style={{ display: "inline-flex", color: "var(--color-text-muted)", flex: "0 0 auto" }}>
        <ChevronRight size={14} />
      </span>
    </>
  );
  const style: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "10px 0",
    border: 0,
    background: "none",
    boxShadow: "inset 0 -1px 0 var(--color-border)", // pen の stroke は内側
    fontFamily: "var(--font-body)",
    textAlign: "left",
  };
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className="bg-transparent hover:bg-[var(--color-bg-hover)]"
      style={{ ...style, cursor: "pointer" }}
    >
      {content}
    </button>
  ) : (
    <div style={style}>{content}</div>
  );
}

/** D-03: 右側のタスク詳細パネル (400)。期限 / リマインダー / 繰り返しの行でポップオーバーを開閉する。
 * Esc はポップオーバーが開いていれば閉じ、無ければパネルを閉じる (onClose)。 */
export function TaskDetailPanel({ task, subtasks, project, section, initialPopover, onClose, comments = [] }: TaskDetailPanelProps) {
  const [popover, setPopover] = useState<Popover | null>(initialPopover ?? null);
  const [done, setDone] = useState(task.progress === 100);
  const [due, setDue] = useState(task.due);
  const [time, setTime] = useState(task.dueTime);
  const [rrule, setRrule] = useState(task.rrule);
  const [reminders, setReminders] = useState(task.reminders);
  const sub = useDone();
  const taskComments = comments.filter((c) => c.taskNo === task.no);
  const toggle = (p: Popover) => setPopover((cur) => (cur === p ? null : p));

  const dueInfo = dateLabel(due);
  const dueText = dueInfo ? `${dueInfo.label}${time ? ` ${time}` : ""}` : "なし";
  const dueColor =
    dueInfo?.tone === "success" ? "var(--color-success)" : dueInfo?.tone === "danger" ? "var(--color-danger)" : "var(--color-text-secondary)";

  return (
    <div
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        if (popover) setPopover(null);
        else onClose?.();
      }}
      style={{
        outline: "none",
        position: "relative",
        height: "100%",
        boxSizing: "border-box",
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        background: "var(--color-bg)",
        fontFamily: "var(--font-body)",
        color: "var(--color-text-primary)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: project.color, flex: "0 0 auto" }} />
          <span>{project.name}</span>
          {section && (
            <>
              <span style={{ display: "inline-flex", color: "var(--color-text-muted)" }}>
                <ChevronRight size={12} />
              </span>
              <span>{section}</span>
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          <Button variant="icon" icon={ChevronUp} ariaLabel="前のタスク" />
          <Button variant="icon" icon={ChevronDown} ariaLabel="次のタスク" />
          <Button variant="icon" icon={Ellipsis} ariaLabel="その他" />
          <Button variant="icon" icon={X} ariaLabel="閉じる" onClick={onClose} />
        </div>
      </div>

      <div style={{ display: "flex", gap: "var(--space-3)" }}>
        <Checkbox checked={done} onChange={setDone} ariaLabel="完了" />
        <div style={{ flex: 1, minWidth: 0, fontSize: 18, lineHeight: "26px", fontWeight: 600, color: done ? "var(--color-text-muted)" : "var(--color-text-primary)" }}>
          {task.title}
        </div>
      </div>

      {task.note && <div style={{ fontSize: 14, lineHeight: "20px", color: "var(--color-text-secondary)" }}>{task.note}</div>}

      <div style={{ display: "flex", flexDirection: "column", boxShadow: "inset 0 1px 0 var(--color-border), inset 0 -1px 0 var(--color-border)" }}>
        <PropRow icon={<Folder size={16} />} name="プロジェクト" value={section ? `${project.name} / ${section}` : project.name} />
        <PropRow icon={<Calendar size={16} />} name="期限" value={dueText} valueColor={dueColor} onClick={() => toggle("date")} expanded={popover === "date"} />
        <PropRow icon={<Flag size={16} />} name="優先度" value={`P${task.priority}`} valueColor={`var(--color-priority-${task.priority})`} />
        <PropRow icon={<Tag size={16} />} name="ラベル" value={task.labels.map((l) => `@${l}`).join(" ") || "なし"} />
        <PropRow icon={<Bell size={16} />} name="リマインダー" value={reminderSummary(reminders)} onClick={() => toggle("reminder")} expanded={popover === "reminder"} />
        <PropRow icon={<Repeat size={16} />} name="繰り返し" value={recurrenceLabel(rrule)} onClick={() => toggle("recurrence")} expanded={popover === "recurrence"} />
      </div>

      <div>
        <div style={heading}>
          サブタスク {subtasks.filter(sub.isDone).length}/{subtasks.length}
        </div>
        {subtasks.map((t) => (
          <TaskRow
            key={t.no}
            title={t.title}
            done={sub.isDone(t)}
            priority={t.priority}
            hideActions
            onToggleDone={() => sub.toggle(t)}
          />
        ))}
        <AddTaskRow label="サブタスクを追加" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <div style={heading}>コメント</div>
        {taskComments.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: "var(--space-2)" }}>
            <span aria-hidden style={{ width: 24, height: 24, borderRadius: 12, background: "var(--color-accent)", flex: "0 0 auto" }} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" }}>{`${c.author}  ${c.at}`}</span>
              <span style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-primary)" }}>{c.text}</span>
            </div>
          </div>
        ))}
        <TextField placeholder="コメント" />
      </div>

      {popover && (
        <div style={{ position: "absolute", left: -1, top: POPOVER_TOP[popover], zIndex: 10 }}>
          {popover === "date" && (
            <DatePicker
              value={due}
              time={time}
              recurrenceLabel={recurrenceLabel(rrule)}
              onChange={(v) => {
                setDue(v.date);
                setTime(v.time);
              }}
              onOpenRecurrence={() => setPopover("recurrence")}
            />
          )}
          {popover === "recurrence" && (
            <RecurrencePicker
              value={rrule}
              onChange={(r) => {
                setRrule(r);
                setPopover(null);
              }}
            />
          )}
          {popover === "reminder" && <ReminderPicker reminders={reminders} dueTime={time} onChange={setReminders} />}
        </div>
      )}
    </div>
  );
}
