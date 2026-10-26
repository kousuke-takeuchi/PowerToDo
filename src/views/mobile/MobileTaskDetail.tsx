import type React from "react";
import { useState } from "react";
import { Bell, Calendar, ChevronRight, Flag, Repeat, Send, Tag } from "lucide-react";
import { AddTaskRow } from "../../components/AddTaskRow";
import { Button } from "../../components/Button";
import { Checkbox } from "../../components/Checkbox";
import { MobileHeader } from "../../components/MobileHeader";
import { TaskRow } from "../../components/TaskRow";
import { TextField } from "../../components/TextField";
import { TODAY, dateLabel } from "../../mock/data";
import type { Label, Project, Task, TaskPatch } from "../../types/model";
import { RecurrencePicker, recurrenceLabel } from "../RecurrencePicker";
import type { RecurrenceParse } from "../RecurrencePicker";
import { reminderLabel } from "../ReminderPicker";
import { useDone } from "../useDone";
import { BottomSheet, SheetCard } from "./BottomSheet";
import { DateSheet } from "./DateSheet";
import { LabelSheet } from "./LabelSheet";
import { MobileShell } from "./MobileShell";
import { PrioritySheet } from "./PrioritySheet";
import { ReminderSheet } from "./ReminderSheet";
import { TEXT_SHEET_FORM, TextSheet } from "./TextSheet";

export type MobileTaskDetailProps = {
  task: Task;
  subtasks: Task[];
  project: Project;
  section?: string;
  onBack?: () => void;
  /** 実データで動かす: 完了は task.progress を見て onToggleDone / onToggleSubtask を呼ぶ。省略すると見た目だけトグルする。 */
  live?: boolean;
  /** 実機用: 幅 100% / 高さ 100dvh、上下はセーフエリア。 */
  fill?: boolean;
  today?: string;
  /** 画面に重ねる層 (帯など)。 */
  overlay?: React.ReactNode;
  /** header の下に流す帯 (MobileShell の banner)。 */
  banner?: React.ReactNode;
  onToggleDone?: (done: boolean) => void;
  onToggleSubtask?: (t: Task, done: boolean) => void;
  /**
   * 編集 (Phase 6): 渡すと各行 (名前 / 期限 / 優先度 / ラベル / リマインダー / 繰り返し / メモ) がタップできて、下部シートで変える。
   * 値は常に task (親の state) が正。省略すると Story の見た目のまま。
   */
  onChange?: (patch: TaskPatch) => void;
  /** サブタスクを追加する (「サブタスクを追加」の行)。 */
  onAddSubtask?: (title: string) => void;
  /** 削除 (確認のシートのあと)。デスクトップと同じく、呼び出し側が詳細を閉じる。 */
  onDelete?: () => void;
  /** ラベルのシートに並べる、ストアにあるラベル。 */
  labels?: Label[];
  /** 繰り返しの自然言語入力の解釈 (api.parseRecurrence)。 */
  onParseRecurrence?: (text: string) => Promise<RecurrenceParse>;
  /** 最初から開いておくシート (Story 用)。 */
  initialSheet?: DetailSheet;
};

type DetailSheet = "title" | "note" | "date" | "priority" | "label" | "reminder" | "recurrence" | "subtask" | "delete" | null;
const sheetName: Record<NonNullable<DetailSheet>, string> = {
  title: "名前",
  note: "メモ",
  date: "期限",
  priority: "優先度",
  label: "ラベル",
  reminder: "リマインダー",
  recurrence: "繰り返し",
  subtask: "サブタスクを追加",
  delete: "タスクを削除",
};

type Icon = React.ComponentType<{ size?: number }>;

/** タップできる領域にする (見た目は変えない)。onClick が無ければ中身をそのまま返す。 */
function Tap({ onClick, label, children }: { onClick?: () => void; label: string; children: React.ReactNode }) {
  if (!onClick) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{ display: "block", width: "100%", minHeight: 44, padding: 0, border: 0, background: "none", font: "inherit", textAlign: "left", color: "inherit", cursor: "pointer" }}
    >
      {children}
    </button>
  );
}

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
export function MobileTaskDetail({ task, subtasks, project, section, onBack, live, fill, today = TODAY, overlay, banner, onToggleDone, onToggleSubtask, onChange, onAddSubtask, onDelete, labels = [], onParseRecurrence, initialSheet = null }: MobileTaskDetailProps) {
  // 下部シートの状態。詳細は key (プロジェクト/番号) で作り直すだけで、一覧の再読み込みでは作り直さない。
  const [sheet, setSheet] = useState<DetailSheet>(initialSheet);
  const closeSheet = () => setSheet(null);
  const editable = onChange !== undefined;
  const open = (s: NonNullable<DetailSheet>) => (editable ? () => setSheet(s) : undefined);
  const [localDone, setLocalDone] = useState(task.progress === 100);
  const done = live ? task.progress === 100 : localDone;
  const setDone = (v: boolean) => (live ? onToggleDone?.(v) : setLocalDone(v));
  const local = useDone();
  const sub = {
    isDone: (t: Task) => (live ? t.progress === 100 : local.isDone(t)),
    toggle: (t: Task) => (live ? onToggleSubtask?.(t, t.progress !== 100) : local.toggle(t)),
  };
  const due = dateLabel(task.due, today);
  const dueColor = due?.tone === "success" ? "var(--color-success)" : due?.tone === "danger" ? "var(--color-danger)" : "var(--color-text-secondary)";
  const dueText = due ? `${due.label}${task.dueTime ? ` ${task.dueTime}` : ""}` : "なし";

  return (
    <MobileShell
      banner={banner}
      fill={fill}
      overlay={
        <>
          {overlay}
          <BottomSheet
            fill={fill}
            confirmForm={sheet === "title" || sheet === "note" || sheet === "subtask" ? TEXT_SHEET_FORM : undefined}
            open={sheet !== null}
            title={sheet ? sheetName[sheet] : undefined} onClose={closeSheet}
          >
            {sheet === "title" && (
              <TextSheet
                label="名前"
                value={task.title}
                onSave={(v) => {
                  const t = v.trim();
                  if (t && t !== task.title) onChange?.({ title: t });
                }}
                onClose={closeSheet}
              />
            )}
            {sheet === "note" && (
              <TextSheet
                label="メモ"
                multiline
                value={task.note ?? ""}
                onSave={(v) => {
                  const t = v.trim();
                  if (t !== (task.note ?? "")) onChange?.({ note: t === "" ? null : t });
                }}
                onClose={closeSheet}
              />
            )}
            {sheet === "subtask" && (
              <TextSheet
                label="サブタスク名"
                value=""
                placeholder="サブタスク名"
                onSave={(v) => {
                  const t = v.trim();
                  if (t) onAddSubtask?.(t);
                }}
                onClose={closeSheet}
              />
            )}
            {sheet === "date" && (
              <DateSheet
                value={task.due}
                time={task.dueTime}
                today={today}
                onChange={(v) => onChange?.({ due: v.date ?? null, dueTime: v.date ? (v.time ?? null) : null })}
                onClose={closeSheet}
              />
            )}
            {sheet === "priority" && <PrioritySheet value={task.priority} onChange={(priority) => onChange?.({ priority })} onClose={closeSheet} />}
            {sheet === "label" && <LabelSheet labels={labels} value={task.labels} onChange={(l) => onChange?.({ labels: l })} />}
            {sheet === "reminder" && <ReminderSheet value={task.reminders} onChange={(r) => onChange?.({ reminders: r })} />}
            {sheet === "recurrence" && (
              <SheetCard>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <RecurrencePicker
                  value={task.rrule}
                  valueLabel={task.rruleLabel ?? recurrenceLabel(task.rrule)}
                  onParse={onParseRecurrence}
                  fontSize={16}
                  onChange={(r) => {
                    onChange?.({ rrule: r ?? null });
                    closeSheet();
                  }}
                />
              </div>
              </SheetCard>
            )}
            {sheet === "delete" && (
              <SheetCard>
              <div role="alertdialog" aria-label="タスクの削除" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: 16 }}>
                <div style={{ fontSize: 14, lineHeight: "20px", color: "var(--color-text-secondary)" }}>
                  {subtasks.length > 0 ? "このタスクとサブタスクを削除します。" : "このタスクを削除します。"}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
                  <Button variant="secondary" onClick={closeSheet}>
                    キャンセル
                  </Button>
                  <Button
                    onClick={() => {
                      closeSheet();
                      onDelete?.();
                    }}
                  >
                    削除
                  </Button>
                </div>
              </div>
              </SheetCard>
            )}
          </BottomSheet>
        </>
      }
      header={
        <MobileHeader
          safeArea={fill}
          title="タスク詳細"
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
          <Checkbox checked={done} onChange={setDone} ariaLabel="完了" size={20} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Tap onClick={open("title")} label="名前を編集">
              <div style={{ fontSize: 20, lineHeight: "29px", fontWeight: 600, color: done ? "var(--color-text-muted)" : "var(--color-text-primary)" }}>{task.title}</div>
            </Tap>
          </div>
        </div>
        {(task.note || editable) && (
          <Tap onClick={open("note")} label="メモを編集">
            <div style={{ fontSize: 14, lineHeight: "20px", color: task.note ? "var(--color-text-secondary)" : "var(--color-text-muted)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {task.note || "メモを追加"}
            </div>
          </Tap>
        )}
        <div style={{ display: "flex", flexDirection: "column", boxShadow: "inset 0 1px 0 var(--color-border)" }}>
          <Tap onClick={open("date")} label="期限を変更"><Prop icon={Calendar} name="期限" value={dueText} valueColor={dueColor} /></Tap>
          <Tap onClick={open("priority")} label="優先度を変更"><Prop icon={Flag} name="優先度" value={`P${task.priority}`} valueColor={`var(--color-priority-${task.priority})`} /></Tap>
          <Tap onClick={open("label")} label="ラベルを変更"><Prop icon={Tag} name="ラベル" value={task.labels.map((l) => `@${l}`).join(" ") || "なし"} /></Tap>
          <Tap onClick={open("reminder")} label="リマインダーを変更"><Prop icon={Bell} name="リマインダー" value={task.reminders.map(reminderLabel).join(", ") || "なし"} /></Tap>
          <Tap onClick={open("recurrence")} label="繰り返しを変更"><Prop icon={Repeat} name="繰り返し" value={task.rruleLabel ?? recurrenceLabel(task.rrule)} /></Tap>
        </div>
        <div>
          <div style={{ fontSize: 13, lineHeight: "19px", fontWeight: 700, color: "var(--color-text-primary)" }}>
            サブタスク {subtasks.filter(sub.isDone).length}/{subtasks.length}
          </div>
          {subtasks.map((t) => (
            <TaskRow key={t.no} variant="mobile" title={t.title} done={sub.isDone(t)} priority={t.priority} onToggleDone={() => sub.toggle(t)} />
          ))}
          <AddTaskRow label="サブタスクを追加" onClick={onAddSubtask ? () => setSheet("subtask") : undefined} />
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={() => setSheet("delete")}
            className="bg-transparent hover:bg-[var(--color-bg-hover)]"
            style={{ alignSelf: "flex-start", minHeight: 44, padding: "0 8px", border: 0, borderRadius: 8, fontFamily: "var(--font-body)", fontSize: 14, color: "var(--color-danger)", cursor: "pointer" }}
          >
            タスクを削除
          </button>
        )}
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
      <div aria-hidden style={{ height: fill ? "env(safe-area-inset-bottom)" : 34, flex: "0 0 auto" }} />
    </MobileShell>
  );
}
