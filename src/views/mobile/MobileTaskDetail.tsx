import type React from "react";
import { useState } from "react";
import { Bell, Calendar, ChevronRight, Flag, Repeat, Send, Tag } from "lucide-react";
import { AddTaskRow } from "../../components/AddTaskRow";
import { Button } from "../../components/Button";
import { Checkbox } from "../../components/Checkbox";
import { MobileHeader } from "../../components/MobileHeader";
import { TaskRow } from "../../components/TaskRow";
import { TextField } from "../../components/TextField";
import { dateLabel } from "../../mock/data";
import type { Project, Task } from "../../types/model";
import { recurrenceLabel } from "../RecurrencePicker";
import { reminderLabel } from "../ReminderPicker";
import { useDone } from "../useDone";
import { MobileShell } from "./MobileShell";

export type MobileTaskDetailProps = {
  task: Task;
  subtasks: Task[];
  project: Project;
  section?: string;
  onBack?: () => void;
};

type Icon = React.ComponentType<{ size?: number }>;

function Prop({ icon: Icon, name, value, valueColor = "var(--color-text-primary)" }: { icon: Icon; name: string; value: string; valueColor?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "12px 0",
        boxShadow: "inset 0 -1px 0 var(--color-border)", // pen の stroke は内側
      }}
    >
      <span style={{ display: "inline-flex", color: "var(--color-text-secondary)", flex: "0 0 auto" }}>
        <Icon size={18} />
      </span>
      <span style={{ width: 96, flex: "0 0 auto", fontSize: 14, lineHeight: "20px", color: "var(--color-text-secondary)" }}>{name}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: "20px", color: valueColor }}>{value}</span>
      <span style={{ display: "inline-flex", color: "var(--color-text-muted)", flex: "0 0 auto" }}>
        <ChevronRight size={16} />
      </span>
    </div>
  );
}

/** M-03: タスク詳細 (全画面、下部タブなし)。戻る + パンくず、プロパティ 5 行、サブタスク、下端のコメント欄。完了チェックとサブタスクのチェックは見た目だけトグルする。 */
export function MobileTaskDetail({ task, subtasks, project, section, onBack }: MobileTaskDetailProps) {
  const [done, setDone] = useState(task.progress === 100);
  const sub = useDone();
  const due = dateLabel(task.due);
  const dueColor = due?.tone === "success" ? "var(--color-success)" : due?.tone === "danger" ? "var(--color-danger)" : "var(--color-text-secondary)";
  const dueText = due ? `${due.label}${task.dueTime ? ` ${task.dueTime}` : ""}` : "なし";

  return (
    <MobileShell
      header={
        <MobileHeader
          title="タスク詳細"
          showBack
          onBack={onBack}
          breadcrumb={
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: project.color, flex: "0 0 auto" }} />
              {section ? `${project.name} / ${section}` : project.name}
            </div>
          }
        />
      }
    >
      <div style={{ flex: 1, minHeight: 0, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "var(--space-4)", padding: "8px 16px" }}>
        <div style={{ display: "flex", gap: "var(--space-3)" }}>
          <Checkbox checked={done} onChange={setDone} ariaLabel="完了" />
          <div style={{ flex: 1, minWidth: 0, fontSize: 20, lineHeight: "29px", fontWeight: 600, color: done ? "var(--color-text-muted)" : "var(--color-text-primary)" }}>
            {task.title}
          </div>
        </div>
        {task.note && <div style={{ fontSize: 14, lineHeight: "20px", color: "var(--color-text-secondary)" }}>{task.note}</div>}
        <div style={{ display: "flex", flexDirection: "column", boxShadow: "inset 0 1px 0 var(--color-border)" }}>
          <Prop icon={Calendar} name="期限" value={dueText} valueColor={dueColor} />
          <Prop icon={Flag} name="優先度" value={`P${task.priority}`} valueColor={`var(--color-priority-${task.priority})`} />
          <Prop icon={Tag} name="ラベル" value={task.labels.map((l) => `@${l}`).join(" ") || "なし"} />
          <Prop icon={Bell} name="リマインダー" value={task.reminders.map(reminderLabel).join(", ") || "なし"} />
          <Prop icon={Repeat} name="繰り返し" value={task.rruleLabel ?? recurrenceLabel(task.rrule)} />
        </div>
        <div>
          <div style={{ fontSize: 13, lineHeight: "19px", fontWeight: 700, color: "var(--color-text-primary)" }}>
            サブタスク {subtasks.filter(sub.isDone).length}/{subtasks.length}
          </div>
          {subtasks.map((t) => (
            <TaskRow key={t.no} variant="mobile" title={t.title} done={sub.isDone(t)} priority={t.priority} onToggleDone={() => sub.toggle(t)} />
          ))}
          <AddTaskRow label="サブタスクを追加" />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "8px 16px",
          boxShadow: "inset 0 1px 0 var(--color-border)",
          flex: "0 0 auto",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <TextField placeholder="コメント" />
        </div>
        <Button variant="icon" icon={Send} ariaLabel="送信" />
      </div>
      <div aria-hidden style={{ height: 34, flex: "0 0 auto" }} />
    </MobileShell>
  );
}
