import type React from "react";
import { useRef, useState } from "react";
import { Bell, Calendar, ChevronRight, Flag, Hash, Inbox, MessageSquare, Paperclip, Repeat, Send, Tag } from "lucide-react";
import { AddTaskRow } from "../../components/AddTaskRow";
import { TextField } from "../../components/TextField";
import { Button } from "../../components/Button";
import { Checkbox } from "../../components/Checkbox";
import { MobileHeader } from "../../components/MobileHeader";
import { TaskRow } from "../../components/TaskRow";
import { TODAY, dateLabel } from "../../mock/data";
import { noteInfos } from "../../app/attachments/list";
import type { AttachmentInfo, Comment, Label, NoteFile, Project, ProjectSummary, Section, Task, TaskPatch } from "../../types/model";
import { AttachmentList } from "../Attachments";
import { commentTime } from "../CommentsSection";
import { RecurrencePicker, recurrenceLabel } from "../RecurrencePicker";
import type { RecurrenceParse } from "../RecurrencePicker";
import { reminderLabel } from "../ReminderPicker";
import { useDone } from "../useDone";
import { BottomSheet, SheetCard } from "./BottomSheet";
import { DateSheet } from "./DateSheet";
import { LabelSheet } from "./LabelSheet";
import { MobileComments, PICK_ACCEPT } from "./MobileComments";
import { MobileShell } from "./MobileShell";
import { MoveSheet } from "./MoveSheet";
import { mobileRowProps } from "./rowProps";
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
  /** サブタスクの行を押した (そのサブタスクの詳細を開く)。省略すると行は押せない。 */
  onOpenSubtask?: (t: Task) => void;
  /** 削除 (確認のシートのあと)。デスクトップと同じく、呼び出し側が詳細を閉じる。 */
  onDelete?: () => void;
  /** ラベルのシートに並べる、ストアにあるラベル。 */
  labels?: Label[];
  /** 繰り返しの自然言語入力の解釈 (api.parseRecurrence)。 */
  onParseRecurrence?: (text: string) => Promise<RecurrenceParse>;
  /** 最初から開いておくシート (Story 用)。 */
  initialSheet?: DetailSheet;
  /** コメント (spec 添付 §6): 渡すと「コメント」の欄と、下端の入力欄から開くコメントのシートが出る。 */
  comments?: Comment[];
  commentsFailed?: boolean;
  /** 今の表示名 (自分のコメントだけ編集・削除できる)。 */
  me?: string;
  onAddComment?: (text: string, files: AttachmentInfo[]) => Promise<boolean>;
  onEditComment?: (id: string, text: string, files?: AttachmentInfo[]) => Promise<boolean>;
  onDeleteComment?: (id: string) => void;
  /** 選んだファイルを (縮小して) 保存し、保存したものを返す。渡すとクリップのボタンが出る。 */
  onAttachComment?: (files: File[]) => Promise<AttachmentInfo[]>;
  /** Story: 送る前の添付 / 編集中のコメント。 */
  initialPending?: AttachmentInfo[];
  initialCommentEdit?: string;
  /** メモの添付 (spec 添付 §6)。onAttachNote を渡すと「添付」のボタンが出て、onDetachNote で × が効く。 */
  noteFiles?: NoteFile[];
  onAttachNote?: (files: File[]) => void | Promise<void>;
  onDetachNote?: (id: string) => void;
  /** 「プロジェクト」の行 (2026-11-22): 渡すと押して移動のシートを開く。サブタスクは親と一緒に動くので、呼び出し側が渡さない。 */
  onMove?: (project: string, section: string | null) => void;
  /** 移動のシートに並べるプロジェクトと、このタスクのプロジェクトのセクション。 */
  projects?: ProjectSummary[];
  sections?: Section[];
};

type DetailSheet = "comments" | "title" | "note" | "move" | "date" | "priority" | "label" | "reminder" | "recurrence" | "subtask" | "delete" | null;
const sheetName: Record<NonNullable<DetailSheet>, string> = {
  comments: "コメント",
  title: "名前",
  note: "メモ",
  move: "プロジェクト",
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
        padding: "13px 0",
        boxShadow: "inset 0 -1px 0 var(--color-border)", // pen の stroke は内側
      }}
    >
      <span style={{ display: "inline-flex", color: "var(--color-text-secondary)", flex: "0 0 auto" }}>
        <Icon size={18} />
      </span>
      <span style={{ width: 96, flex: "0 0 auto", fontSize: 15, lineHeight: "22px", color: "var(--color-text-secondary)" }}>{name}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 16, lineHeight: "22px", color: valueColor }}>{value}</span>
      <span style={{ display: "inline-flex", color: "var(--color-text-muted)", flex: "0 0 auto" }}>
        <ChevronRight size={16} />
      </span>
    </div>
  );
}

/** M-03: タスク詳細 (全画面、下部タブなし)。戻る + パンくず、プロパティ 5 行、サブタスク、下端のコメント欄。完了チェックとサブタスクのチェックは見た目だけトグルする。 */
export function MobileTaskDetail({ task, subtasks, project, section, onBack, live, fill, today = TODAY, overlay, banner, onToggleDone, onToggleSubtask, onChange, onAddSubtask, onDelete, labels = [], onParseRecurrence, initialSheet = null, comments = [], commentsFailed, me, onAddComment, onEditComment, onDeleteComment, onAttachComment, initialPending, initialCommentEdit, noteFiles = [], onAttachNote, onDetachNote, onOpenSubtask, onMove, projects = [], sections = [] }: MobileTaskDetailProps) {
  // 下部シートの状態。詳細は key (プロジェクト/番号) で作り直すだけで、一覧の再読み込みでは作り直さない。
  const [sheet, setSheet] = useState<DetailSheet>(initialSheet);
  const closeSheet = () => setSheet(null);
  const editable = onChange !== undefined;
  const open = (s: NonNullable<DetailSheet>) => (editable ? () => setSheet(s) : undefined);
  const notePicker = useRef<HTMLInputElement>(null);
  const note = noteInfos(noteFiles);
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
            size={sheet === "comments" || sheet === "move" ? "large" : "auto"}
            confirmForm={sheet === "title" || sheet === "note" || sheet === "subtask" ? TEXT_SHEET_FORM : undefined}
            open={sheet !== null}
            title={sheet ? sheetName[sheet] : undefined} onClose={closeSheet}
          >
            {sheet === "move" && onMove && (
              <MoveSheet projects={projects} sections={sections} current={{ project: task.project, section: task.category }} onMove={onMove} onClose={closeSheet} />
            )}
            {sheet === "comments" && (
              <MobileComments
                comments={comments}
                failed={commentsFailed}
                me={me}
                taskTitle={task.title}
                onAdd={onAddComment}
                onEdit={onEditComment}
                onDelete={onDeleteComment}
                onAttach={onAttachComment}
                initialPending={initialPending}
                initialEditId={initialCommentEdit}
                autoFocus={comments.length === 0}
              />
            )}
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
      {/* Grows to push the comment bar down, but never shrinks: a long body scrolls instead of running under the bar. */}
      <div style={{ flex: "1 0 auto", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "var(--space-4)", padding: "8px 15px" }}>
        <div style={{ display: "flex", gap: "var(--space-3)" }}>
          <Checkbox checked={done} onChange={setDone} ariaLabel="完了" size={22} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Tap onClick={open("title")} label="名前を編集">
              <div style={{ fontSize: 19, lineHeight: "25px", fontWeight: 700, color: done ? "var(--color-text-muted)" : "var(--color-text-primary)" }}>{task.title}</div>
            </Tap>
          </div>
        </div>
        {(task.note || editable) && (
          <Tap onClick={open("note")} label="メモを編集">
            <div style={{ fontSize: 13, lineHeight: "18px", color: task.note ? "var(--color-text-secondary)" : "var(--color-text-muted)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {task.note || "メモを追加"}
            </div>
          </Tap>
        )}
        {(note.files.length > 0 || onAttachNote) && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "var(--space-2)" }}>
            <AttachmentList touch files={note.files} ids={note.ids} alwaysRemove onRemove={onDetachNote ? (i) => onDetachNote(note.ids[i]) : undefined} />
            {onAttachNote && (
              <>
                <input
                  ref={notePicker}
                  type="file"
                  multiple
                  hidden
                  accept={PICK_ACCEPT}
                  aria-label="メモに添付するファイルを選ぶ"
                  onChange={(e) => {
                    void onAttachNote(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => notePicker.current?.click()}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, padding: "0 4px", border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 15, lineHeight: "20px", color: "var(--color-text-secondary)", cursor: "pointer" }}
                >
                  <Paperclip size={16} aria-hidden />
                  添付
                </button>
              </>
            )}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", boxShadow: "inset 0 1px 0 var(--color-border)" }}>
          {onMove && (
            <Tap onClick={() => setSheet("move")} label="プロジェクトを変更">
              <Prop icon={project.inbox ? Inbox : Hash} name="プロジェクト" value={(project.inbox ? "受信トレイ" : project.name) + (section ? ` / ${section}` : "")} />
            </Tap>
          )}
          <Tap onClick={open("date")} label="期限を変更"><Prop icon={Calendar} name="期限" value={dueText} valueColor={dueColor} /></Tap>
          <Tap onClick={open("priority")} label="優先度を変更"><Prop icon={Flag} name="優先度" value={`P${task.priority}`} valueColor={`var(--color-priority-${task.priority})`} /></Tap>
          <Tap onClick={open("label")} label="ラベルを変更"><Prop icon={Tag} name="ラベル" value={task.labels.map((l) => `@${l}`).join(" ") || "なし"} /></Tap>
          <Tap onClick={open("reminder")} label="リマインダーを変更"><Prop icon={Bell} name="リマインダー" value={task.reminders.map(reminderLabel).join(", ") || "なし"} /></Tap>
          <Tap onClick={open("recurrence")} label="繰り返しを変更"><Prop icon={Repeat} name="繰り返し" value={task.rruleLabel ?? recurrenceLabel(task.rrule)} /></Tap>
        </div>
        <div>
          <div style={{ fontSize: 15, lineHeight: "20px", fontWeight: 700, paddingTop: 16, color: "var(--color-text-primary)" }}>
            サブタスク {subtasks.filter(sub.isDone).length}/{subtasks.length}
          </div>
          {subtasks.map((t) => (
            <TaskRow key={t.no} variant="mobile" {...mobileRowProps(t, { today })} done={sub.isDone(t)} onToggleDone={() => sub.toggle(t)} onClick={onOpenSubtask ? () => onOpenSubtask(t) : undefined} />
          ))}
          <AddTaskRow label="サブタスクを追加" onClick={onAddSubtask ? () => setSheet("subtask") : undefined} />
        </div>
        {onAddComment && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div style={{ fontSize: 15, lineHeight: "20px", fontWeight: 700, paddingTop: 8, color: "var(--color-text-primary)" }}>コメント {comments.length}</div>
            {comments.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 16px", borderRadius: 16, background: "var(--color-sheet-card)" }}>
                <span style={{ fontSize: 13, lineHeight: "18px", color: "var(--color-text-secondary)" }}>
                  <b style={{ fontWeight: 700, color: "var(--color-text-primary)" }}>{comments[comments.length - 1].author}</b>
                  {`  ${commentTime(comments[comments.length - 1].at)}`}
                </span>
                {comments[comments.length - 1].text && (
                  <div style={{ fontSize: 16, lineHeight: "22px", color: "var(--color-text-primary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{comments[comments.length - 1].text}</div>
                )}
                <AttachmentList touch files={comments[comments.length - 1].files ?? []} />
                {comments.length > 1 && (
                  <button type="button" onClick={() => setSheet("comments")} style={{ alignSelf: "flex-start", minHeight: 44, padding: 0, border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 15, fontWeight: 600, color: "var(--color-accent)", cursor: "pointer" }}>
                    すべて表示
                  </button>
                )}
              </div>
            )}
          </div>
        )}
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
      {/* The comment bar stays at the bottom of the screen while the body scrolls above it (as Todoist's). */}
      <div style={{ position: "sticky", bottom: 0, zIndex: 1, flex: "0 0 auto", background: "var(--color-bg)", boxShadow: "inset 0 1px 0 var(--color-border)" }}>
      <div style={{ padding: "8px 15px" }}>
        {onAddComment ? (
          // The pill opens the comment sheet (an input card with the clip and send button), as Todoist's does.
          <button
            type="button"
            aria-label="コメントを書く"
            onClick={() => setSheet("comments")}
            style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", width: "100%", minHeight: 44, padding: "0 16px", border: "1px solid var(--color-border)", borderRadius: 22, background: "var(--color-bg)", fontFamily: "var(--font-body)", fontSize: 16, color: "var(--color-text-muted)", textAlign: "left", cursor: "pointer" }}
          >
            <MessageSquare size={18} aria-hidden />
            コメント
          </button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minHeight: 44 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TextField placeholder="コメント" />
            </div>
            <Button variant="icon" icon={Send} ariaLabel="送信" />
          </div>
        )}
      </div>
      <div aria-hidden style={{ height: fill ? "env(safe-area-inset-bottom)" : 34 }} />
      </div>
    </MobileShell>
  );
}
