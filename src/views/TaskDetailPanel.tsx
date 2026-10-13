import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Bell, Calendar, ChevronDown, ChevronRight, ChevronUp, Ellipsis, Flag, Folder, Repeat, Tag, X } from "lucide-react";
import { AddTaskRow } from "../components/AddTaskRow";
import { Button } from "../components/Button";
import { Checkbox } from "../components/Checkbox";
import { TaskRow } from "../components/TaskRow";
import { TextField } from "../components/TextField";
import { TODAY, dateLabel } from "../mock/data";
import type { Comment, Project, Task, TaskPatch } from "../types/model";
import { DatePicker } from "./DatePicker";
import { PopRow, PopoverShell } from "./PopoverShell";
import { RecurrencePicker, recurrenceLabel } from "./RecurrencePicker";
import { ReminderPicker, reminderSummary } from "./ReminderPicker";
import { SubtaskForm } from "./SubtaskForm";
import { useDone } from "./useDone";

export type TaskDetailPanelProps = {
  task: Task;
  subtasks: Task[];
  project: Project;
  section?: string;
  initialPopover?: "date" | "recurrence" | "reminder" | "priority";
  onClose?: () => void;
  /** コメント一覧。task.no と同じ taskNo のものだけ表示する。 */
  comments?: Comment[];
  // ---- 実アプリ用 (onChange を渡すと編集モード。無ければ Storybook と同じ、見た目だけのローカル挙動) ----
  /** 編集の確定 (タイトル / 説明は blur・Enter、優先度・期限・繰り返し・リマインダーは選択時)。 */
  onChange?: (patch: TaskPatch) => void;
  /** 完了チェック。渡すと完了状態は task.progress から決まる。 */
  onToggleDone?: (done: boolean) => void;
  /** 渡すと下部に「タスクを削除」(確認つき) を出す。 */
  onDelete?: () => void;
  /** 渡すと「サブタスクを追加」がインライン入力を開く。 */
  onAddSubtask?: (title: string) => void;
  /** サブタスク行のチェック。渡すと完了状態は subtask.progress から決まる。 */
  onToggleSubtask?: (no: number, done: boolean) => void;
  /** 「今日」の基準日 YYYY-MM-DD (期限ラベルと日付ポップオーバー)。既定は Storybook の固定日。 */
  today?: string;
};

type Popover = NonNullable<TaskDetailPanelProps["initialPopover"]>;

// pen のポップオーバーは画面座標 (x 1040 = パネルの左端, y 300 / 420)。aside の border-left 1px の分だけ left: -1 で合わせる。パネルは画面上端から始まるので同じ値でよい。
const POPOVER_TOP: Record<Popover, number> = { date: 300, recurrence: 300, reminder: 420, priority: 340 };

const PRIORITIES: { value: 1 | 2 | 3 | 4; label: string }[] = [
  { value: 1, label: "P1 (高)" },
  { value: 2, label: "P2 (中)" },
  { value: 3, label: "P3 (低)" },
  { value: 4, label: "P4 (なし)" },
];

const bareField: React.CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  padding: 0,
  border: 0,
  outline: "none",
  background: "transparent",
  fontFamily: "var(--font-body)",
};

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
  onClick?: (row: HTMLElement) => void;
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
      data-prop-row
      onClick={(e) => onClick(e.currentTarget)}
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
export function TaskDetailPanel({
  task,
  subtasks,
  project,
  section,
  initialPopover,
  onClose,
  comments = [],
  onChange,
  onToggleDone,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  today = TODAY,
}: TaskDetailPanelProps) {
  const editable = onChange !== undefined;
  const [popover, setPopover] = useState<Popover | null>(initialPopover ?? null);
  const [done, setDone] = useState(task.progress === 100);
  const [due, setDue] = useState(task.due);
  const [time, setTime] = useState(task.dueTime);
  const [rrule, setRrule] = useState(task.rrule);
  const [reminders, setReminders] = useState(task.reminders);
  const sub = useDone();
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [noteDraft, setNoteDraft] = useState(task.note ?? "");
  const [addingSub, setAddingSub] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setTitleDraft(task.title), [task.title]);
  useEffect(() => setNoteDraft(task.note ?? ""), [task.note]);
  // 編集モードでは値は常に task (親の state) が正。ローカルの値は Storybook 用。
  const doneNow = onToggleDone ? task.progress === 100 : done;
  const dueNow = editable ? task.due : due;
  const timeNow = editable ? task.dueTime : time;
  const rruleNow = editable ? task.rrule : rrule;
  const remindersNow = editable ? task.reminders : reminders;
  const subDone = (t: Task) => (onToggleSubtask ? t.progress === 100 : sub.isDone(t));
  const commitTitle = () => {
    const v = titleDraft.trim();
    if (!v) setTitleDraft(task.title);
    else if (v !== task.title) onChange?.({ title: v });
  };
  const commitNote = () => {
    const v = noteDraft.trim();
    if (v !== (task.note ?? "")) onChange?.({ note: v === "" ? null : v });
  };
  const taskComments = comments.filter((c) => c.taskNo === task.no);
  // 編集モードでは、押した行の直下にポップオーバーを出す (パネル内の位置は行の offsetTop から)。Storybook は pen の座標のまま。
  const [anchorTop, setAnchorTop] = useState<number | null>(null);
  const toggle = (p: Popover, row?: HTMLElement) => {
    if (editable && row) setAnchorTop(row.offsetTop + row.offsetHeight);
    setPopover((cur) => (cur === p ? null : p));
  };
  const popoverRef = useRef<HTMLDivElement>(null);

  // Esc / ポップオーバーの外のクリックで閉じる。ポップオーバー内の行を押すと押した要素が消えてフォーカスが body に戻るので、
  // パネルの onKeyDown ではなく window で受ける。Esc はポップオーバーが開いていれば閉じ、無ければパネルを閉じる。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      if (popover) setPopover(null);
      else {
        // フォーカス中の入力の blur で編集中の値を確定してから閉じる (消えた要素には blur が来ない)
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        onClose?.();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!popover || !t || popoverRef.current?.contains(t) || t.closest("[data-prop-row]")) return;
      setPopover(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [popover, onClose]);

  const dueInfo = dateLabel(dueNow, today);
  const dueText = dueInfo ? `${dueInfo.label}${timeNow ? ` ${timeNow}` : ""}` : "なし";
  const dueColor =
    dueInfo?.tone === "success" ? "var(--color-success)" : dueInfo?.tone === "danger" ? "var(--color-danger)" : "var(--color-text-secondary)";

  return (
    <div
      style={{
        outline: "none",
        position: "relative",
        height: "100%",
        boxSizing: "border-box",
        padding: "16px 20px",
        overflowY: editable ? "auto" : undefined,
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
          {!editable && (
            <>
              <Button variant="icon" icon={ChevronUp} ariaLabel="前のタスク" />
              <Button variant="icon" icon={ChevronDown} ariaLabel="次のタスク" />
              <Button variant="icon" icon={Ellipsis} ariaLabel="その他" />
            </>
          )}
          <Button variant="icon" icon={X} ariaLabel="閉じる" onClick={onClose} />
        </div>
      </div>

      <div style={{ display: "flex", gap: "var(--space-3)" }}>
        <Checkbox checked={doneNow} onChange={(v) => (onToggleDone ? onToggleDone(v) : setDone(v))} ariaLabel="完了" />
        {editable ? (
          <input
            aria-label="タスク名"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
            }}
            style={{
              ...bareField,
              flex: 1,
              minWidth: 0,
              fontSize: 18,
              lineHeight: "26px",
              fontWeight: 600,
              color: doneNow ? "var(--color-text-muted)" : "var(--color-text-primary)",
            }}
          />
        ) : (
          <div style={{ flex: 1, minWidth: 0, fontSize: 18, lineHeight: "26px", fontWeight: 600, color: doneNow ? "var(--color-text-muted)" : "var(--color-text-primary)" }}>
            {task.title}
          </div>
        )}
      </div>

      {editable ? (
        <textarea
          aria-label="説明"
          value={noteDraft}
          placeholder="説明"
          rows={2}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={commitNote}
          className="placeholder:text-[var(--color-text-muted)]"
          style={{ ...bareField, resize: "vertical", fontSize: 14, lineHeight: "20px", color: "var(--color-text-secondary)" }}
        />
      ) : (
        task.note && <div style={{ fontSize: 14, lineHeight: "20px", color: "var(--color-text-secondary)" }}>{task.note}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", boxShadow: "inset 0 1px 0 var(--color-border), inset 0 -1px 0 var(--color-border)" }}>
        <PropRow icon={<Folder size={16} />} name="プロジェクト" value={section ? `${project.name} / ${section}` : project.name} />
        <PropRow icon={<Calendar size={16} />} name="期限" value={dueText} valueColor={dueColor} onClick={(row) => toggle("date", row)} expanded={popover === "date"} />
        <PropRow
          icon={<Flag size={16} />}
          name="優先度"
          value={`P${task.priority}`}
          valueColor={`var(--color-priority-${task.priority})`}
          onClick={editable ? (row) => toggle("priority", row) : undefined}
          expanded={editable ? popover === "priority" : undefined}
        />
        <PropRow icon={<Tag size={16} />} name="ラベル" value={task.labels.map((l) => `@${l}`).join(" ") || "なし"} />
        <PropRow icon={<Bell size={16} />} name="リマインダー" value={reminderSummary(remindersNow)} onClick={(row) => toggle("reminder", row)} expanded={popover === "reminder"} />
        <PropRow icon={<Repeat size={16} />} name="繰り返し" value={recurrenceLabel(rruleNow)} onClick={(row) => toggle("recurrence", row)} expanded={popover === "recurrence"} />
      </div>

      <div>
        <div style={heading}>
          サブタスク {subtasks.filter(subDone).length}/{subtasks.length}
        </div>
        {subtasks.map((t) => (
          <TaskRow
            key={t.no}
            title={t.title}
            done={subDone(t)}
            priority={t.priority}
            hideActions
            onToggleDone={() => (onToggleSubtask ? onToggleSubtask(t.no, !subDone(t)) : sub.toggle(t))}
          />
        ))}
        {addingSub && onAddSubtask ? (
          <SubtaskForm
            autoFocus
            compact
            onCancel={() => setAddingSub(false)}
            onSubmit={(title) => {
              setAddingSub(false);
              onAddSubtask(title.trim());
            }}
          />
        ) : (
          <AddTaskRow label="サブタスクを追加" onClick={onAddSubtask ? () => setAddingSub(true) : undefined} />
        )}
      </div>

      {!editable && (
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
      )}

      {onDelete && (
        <div style={{ marginTop: "auto", paddingTop: "var(--space-3)" }}>
          {confirmDelete ? (
            <div role="alertdialog" aria-label="タスクの削除" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>
              <span style={{ flex: 1, minWidth: 0 }}>{subtasks.length > 0 ? "このタスクとサブタスクを削除します。" : "このタスクを削除します。"}</span>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                キャンセル
              </Button>
              <Button onClick={onDelete}>削除</Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="bg-transparent hover:bg-[var(--color-bg-hover)]"
              style={{ padding: "4px 8px", border: 0, borderRadius: 6, fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "19px", color: "var(--color-danger)", cursor: "pointer" }}
            >
              タスクを削除
            </button>
          )}
        </div>
      )}

      {popover && (
        <div ref={popoverRef} style={{ position: "absolute", left: -1, top: editable && anchorTop !== null ? anchorTop : POPOVER_TOP[popover], zIndex: 10 }}>
          {popover === "date" && (
            <DatePicker
              value={dueNow}
              time={timeNow}
              today={today}
              recurrenceLabel={recurrenceLabel(rruleNow)}
              onChange={(v) => {
                if (onChange) onChange({ due: v.date ?? null, dueTime: v.date ? (v.time ?? null) : null });
                else {
                  setDue(v.date);
                  setTime(v.time);
                }
              }}
              onOpenRecurrence={() => setPopover("recurrence")}
            />
          )}
          {popover === "recurrence" && (
            <RecurrencePicker
              value={rruleNow}
              onChange={(r) => {
                if (onChange) onChange({ rrule: r ?? null });
                else setRrule(r);
                setPopover(null);
              }}
            />
          )}
          {popover === "reminder" && (
            <ReminderPicker reminders={remindersNow} dueTime={timeNow} onChange={(r) => (onChange ? onChange({ reminders: r }) : setReminders(r))} />
          )}
          {popover === "priority" && (
            <PopoverShell label="優先度" gap="var(--space-1)">
              {PRIORITIES.map((p) => (
                <PopRow
                  key={p.value}
                  icon={<Flag size={16} />}
                  iconColor={`var(--color-priority-${p.value})`}
                  selected={task.priority === p.value}
                  ariaLabel={`P${p.value}`}
                  onClick={() => {
                    if (p.value !== task.priority) onChange?.({ priority: p.value });
                    setPopover(null);
                  }}
                >
                  <span style={{ flex: 1, fontSize: 13, lineHeight: "19px" }}>{p.label}</span>
                </PopRow>
              ))}
            </PopoverShell>
          )}
        </div>
      )}
    </div>
  );
}
