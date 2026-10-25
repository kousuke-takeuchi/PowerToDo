import type React from "react";
import { useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, Bell, CalendarDays, Copy, Ellipsis, Flag, FolderInput, Pencil, Sofa, Sun, Trash2 } from "lucide-react";
import { useEscLayer } from "../app/layers";
import type { Task } from "../types/model";
import { DatePicker } from "./DatePicker";
import { ProjectPicker, type PickerProject } from "./ProjectPicker";
import { quickDates } from "./quickDates";
import { ReminderPicker } from "./ReminderPicker";

export type TaskMenuProps = {
  task: Task;
  today: string;
  /** 上に・下に追加 (project screen only). */
  canInsert: boolean;
  projects: PickerProject[];
  onAddAbove: () => void;
  onAddBelow: () => void;
  onEdit: () => void;
  onDue: (date: string | undefined) => void;
  onPriority: (p: 1 | 2 | 3 | 4) => void;
  onReminders: (r: string[]) => void;
  onMove: (project: string, section: string | null) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
  initialPane?: "main" | "date" | "reminders" | "move";
};

export const TASK_MENU_SIZE = { width: 280, height: 460 };

const PRIORITY_COLOR = ["var(--color-priority-1)", "var(--color-priority-2)", "var(--color-priority-3)", "var(--color-text-secondary)"];

const item: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  padding: "6px 10px",
  border: 0,
  borderRadius: 6,
  background: "none",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  lineHeight: "19px",
  color: "var(--color-text-primary)",
  textAlign: "left",
  cursor: "pointer",
};
const square: React.CSSProperties = { ...item, width: 36, justifyContent: "center", padding: 6 };
const hint: React.CSSProperties = { marginLeft: "auto", fontSize: 12, color: "var(--color-text-muted)" };
const group: React.CSSProperties = { padding: "4px 10px 2px", fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", fontFamily: "var(--font-body)" };
const sep = <div role="separator" style={{ height: 1, margin: "4px 0", background: "var(--color-border)" }} />;

/** Spec ② §4: the "..." menu of a row. ↑↓ move between items, Enter presses, Esc closes (a sub pane first). */
export function TaskMenu(p: TaskMenuProps) {
  const [pane, setPane] = useState(p.initialPane ?? "main");
  const ref = useRef<HTMLDivElement>(null);
  useEscLayer(true, () => (pane === "main" ? p.onClose() : setPane("main")));
  const done = p.task.progress === 100;
  const q = quickDates(p.today);
  const run = (fn: () => void) => () => {
    fn();
    p.onClose();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  };
  if (pane === "date") {
    return <DatePicker value={p.task.due} time={p.task.dueTime} today={p.today} hideTimeRepeat onChange={({ date }) => run(() => p.onDue(date))()} />;
  }
  if (pane === "reminders") return <ReminderPicker reminders={p.task.reminders} dueTime={p.task.dueTime} onChange={p.onReminders} />;
  if (pane === "move") {
    return (
      <ProjectPicker
        projects={p.projects}
        current={{ project: p.task.project, section: p.task.category }}
        onPick={(project, section) => run(() => p.onMove(project, section))()}
      />
    );
  }
  const dateBtn = (label: string, date: string, icon: React.ReactNode) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      aria-label={label}
      title={label}
      aria-pressed={p.task.due === date}
      onClick={run(() => p.onDue(date))}
      style={{ ...square, background: p.task.due === date ? "var(--color-bg-hover)" : "none" }}
    >
      {icon}
    </button>
  );
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="タスクのメニュー"
      onKeyDown={onKeyDown}
      style={{
        width: TASK_MENU_SIZE.width,
        boxSizing: "border-box",
        padding: 4,
        borderRadius: 10,
        border: "1px solid var(--color-border)",
        background: "var(--color-bg)",
        boxShadow: "var(--shadow-popover)",
      }}
    >
      {p.canInsert && (
        <>
          <button type="button" role="menuitem" autoFocus style={item} onClick={run(p.onAddAbove)}>
            <ArrowUpToLine size={16} />
            タスクを上に追加
          </button>
          <button type="button" role="menuitem" style={item} onClick={run(p.onAddBelow)}>
            <ArrowDownToLine size={16} />
            タスクを下に追加
          </button>
          {sep}
        </>
      )}
      <button type="button" role="menuitem" autoFocus={!p.canInsert} style={item} onClick={run(p.onEdit)}>
        <Pencil size={16} />
        編集<span style={hint}>⌘E</span>
      </button>
      {!done && (
        <>
          {sep}
          <div style={group}>日付</div>
          <div style={{ display: "flex", gap: 4, padding: "2px 6px" }}>
            {dateBtn("今日", q.today, <CalendarDays size={18} color="var(--color-success)" />)}
            {dateBtn("明日", q.tomorrow, <Sun size={18} color="var(--color-priority-2)" />)}
            {dateBtn("今週末", q.weekend, <Sofa size={18} color="var(--color-priority-3)" />)}
            {dateBtn("来週", q.nextWeek, <CalendarDays size={18} color="var(--color-text-secondary)" />)}
            <button type="button" role="menuitem" aria-label="日付を選ぶ" title="日付を選ぶ" style={square} onClick={() => setPane("date")}>
              <Ellipsis size={18} />
            </button>
          </div>
          <div style={group}>優先度</div>
          <div style={{ display: "flex", gap: 4, padding: "2px 6px" }}>
            {([1, 2, 3, 4] as const).map((pr) => (
              <button
                key={pr}
                type="button"
                role="menuitem"
                aria-label={`優先度 ${pr}`}
                title={`優先度 ${pr}`}
                aria-pressed={p.task.priority === pr}
                onClick={run(() => p.onPriority(pr))}
                style={{ ...square, background: p.task.priority === pr ? "var(--color-bg-hover)" : "none" }}
              >
                <Flag size={18} color={PRIORITY_COLOR[pr - 1]} fill={pr < 4 ? PRIORITY_COLOR[pr - 1] : "none"} />
              </button>
            ))}
          </div>
          {sep}
          <button type="button" role="menuitem" style={item} onClick={() => setPane("reminders")}>
            <Bell size={16} />
            リマインダー…
          </button>
        </>
      )}
      {sep}
      <button type="button" role="menuitem" style={item} onClick={() => setPane("move")}>
        <FolderInput size={16} />
        移動…
      </button>
      <button type="button" role="menuitem" style={item} onClick={run(p.onDuplicate)}>
        <Copy size={16} />
        複製
      </button>
      {sep}
      <button type="button" role="menuitem" style={{ ...item, color: "var(--color-danger)" }} onClick={run(p.onDelete)}>
        <Trash2 size={16} />
        削除<span style={hint}>⌘⌫</span>
      </button>
    </div>
  );
}
