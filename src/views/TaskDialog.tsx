import type React from "react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useMotionTiming } from "../motion";
import { Bell, Calendar, ChevronDown, ChevronRight, ChevronUp, Ellipsis, Flag, Folder, Repeat, Tag, X } from "lucide-react";
import { AddTaskRow } from "../components/AddTaskRow";
import { isImeKey } from "../app/keys";
import { isTypingTarget } from "../app/shortcuts";
import { useEscLayer } from "../app/layers";
import { Button } from "../components/Button";
import { Checkbox } from "../components/Checkbox";
import { TaskRow } from "../components/TaskRow";
import { TODAY, dateLabel } from "../mock/data";
import type { Comment, Project, Task, TaskPatch } from "../types/model";
import { CommentsSection } from "./CommentsSection";
import { DatePicker } from "./DatePicker";
import { LabelPicker } from "./LabelPicker";
import { ProjectPicker } from "./ProjectPicker";
import { PopRow, PopoverShell } from "./PopoverShell";
import { RecurrencePicker, recurrenceLabel } from "./RecurrencePicker";
import { ReminderPicker, reminderSummary } from "./ReminderPicker";
import { SubtaskForm } from "./SubtaskForm";
import { useDone } from "./useDone";

export type TaskDialogProps = {
  task: Task;
  subtasks: Task[];
  project: Project;
  section?: string;
  initialPopover?: "date" | "recurrence" | "reminder" | "priority" | "project" | "labels";
  onClose?: () => void;
  /** このタスクのコメント (古い順)。 */
  comments?: Comment[];
  /** コメントを読み込めなかった。 */
  commentsFailed?: boolean;
  /** 開いたらコメントの入力欄にカーソルを置く (行のコメントのボタン、spec ② §2)。 */
  focusCommentInput?: boolean;
  /** 今の表示名 (自分のコメントだけ編集・削除できる)。 */
  me?: string;
  /** 渡すと入力欄を出す。true で保存できた (入力欄を空にする)。 */
  onAddComment?: (text: string) => Promise<boolean>;
  onEditComment?: (id: string, text: string) => Promise<boolean>;
  onDeleteComment?: (id: string) => void;
  /** Stories: this comment starts in edit mode. */
  initialCommentEdit?: string;
  // ---- 実アプリ用 (onChange を渡すと編集モード。無ければ Storybook と同じ、見た目だけのローカル挙動) ----
  /**
   * 編集の確定 (タイトル / 説明は blur・Enter、優先度・期限・繰り返し・リマインダーは選択時)。
   * Promise<false> を返すと失敗とみなし、タイトル / 説明の入力欄を task の値に戻す。
   */
  onChange?: (patch: TaskPatch) => void | Promise<boolean>;
  /** 完了チェック。渡すと完了状態は task.progress から決まる。 */
  onToggleDone?: (done: boolean) => void;
  /** 渡すと下部に「タスクを削除」(確認つき) を出す。 */
  onDelete?: () => void;
  /** 渡すと「サブタスクを追加」がインライン入力を開く。 */
  onAddSubtask?: (title: string) => void;
  /** サブタスク行のチェック。渡すと完了状態は subtask.progress から決まる。 */
  onToggleSubtask?: (no: number, done: boolean) => void;
  /** 繰り返しの自然言語入力の解釈 (api.parseRecurrence)。渡すと繰り返しピッカーが入力のプレビューと Enter 選択を持つ。 */
  onParseRecurrence?: (text: string) => Promise<{ rrule: string | null; label: string | null }>;
  /** 「今日」の基準日 YYYY-MM-DD (期限ラベルと日付ポップオーバー)。既定は Storybook の固定日。 */
  today?: string;
  // ---- ダイアログ (spec ① §2) ----
  /** ヘッダーの「プロジェクト / セクション」を押したとき (そのプロジェクトの画面へ)。 */
  onOpenProject?: () => void;
  /** 前 / 次のタスク。undefined なら矢印は押せない。 */
  onPrev?: () => void;
  onNext?: () => void;
  /** "narrow" (幅 750 未満) では右の欄を左の欄の下に回す。 */
  layout?: "wide" | "narrow";
  /** プロジェクトとセクションの一覧 (渡すと「プロジェクト」の行で移す先を選べる)。 */
  projects?: { name: string; sections: string[] }[];
  onMove?: (toProject: string, toSection: string | null) => void;
  /** ラベルの一覧 (渡すと「ラベル」の行で付け外しできる)。 */
  allLabels?: string[];
};

type Popover = NonNullable<TaskDialogProps["initialPopover"]>;

// pen のポップオーバーは画面座標 (x 1040 = パネルの左端, y 300 / 420)。aside の border-left 1px の分だけ left: -1 で合わせる。パネルは画面上端から始まるので同じ値でよい。
const POPOVER_TOP: Record<Popover, number> = { date: 300, recurrence: 300, reminder: 420, priority: 340, project: 60, labels: 180 };

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
  // Todoist: the name on top in small grey, the value under it with its icon.
  const content = (
    <>
      <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-secondary)" }}>{name}</span>
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", minWidth: 0 }}>
        <span style={{ display: "inline-flex", color: "var(--color-text-secondary)", flex: "0 0 auto" }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: "19px", color: valueColor, overflowWrap: "anywhere" }}>{value}</span>
        <span style={{ display: "inline-flex", color: "var(--color-text-muted)", flex: "0 0 auto" }}>
          <ChevronRight size={14} />
        </span>
      </span>
    </>
  );
  const style: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 4,
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

/** D-03: 画面中央のタスクの詳細 (spec ① §2)。左に名前・説明・サブタスク、右に項目の行とピッカー。
 * Esc はピッカーが開いていれば閉じ、無ければダイアログを閉じる (onClose)。k / j で前 / 次のタスク。 */
export function TaskDialog({
  task,
  subtasks,
  project,
  section,
  initialPopover,
  onClose,
  comments = [],
  commentsFailed,
  focusCommentInput,
  onChange,
  onToggleDone,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onParseRecurrence,
  today = TODAY,
  onOpenProject,
  onPrev,
  onNext,
  layout = "wide",
  projects,
  onMove,
  allLabels,
  me,
  onAddComment,
  onEditComment,
  onDeleteComment,
  initialCommentEdit,
}: TaskDialogProps) {
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
  // 編集モードでは Rust が埋めた要約 (読めなければ RRULE 文字列) を優先する。
  const rruleText = editable && rruleNow && task.rruleLabel ? task.rruleLabel : recurrenceLabel(rruleNow);
  const remindersNow = editable ? task.reminders : reminders;
  const subDone = (t: Task) => (onToggleSubtask ? t.progress === 100 : sub.isDone(t));
  // 失敗したら入力欄を task の値 (そのときの最新) に戻す。成功なら task が変わり、上の effect が入力欄を合わせる。
  const taskRef = useRef(task);
  taskRef.current = task;
  const commit = (patch: TaskPatch, revert: () => void) => {
    void onChange?.(patch)?.then((ok) => {
      if (!ok) revert();
    });
  };
  // 比較は trim 前の値で行う (前後の空白だけ足した入力も、保存せずに task の値へ戻す)。
  const commitTitle = () => {
    if (titleDraft === task.title) return;
    const v = titleDraft.trim();
    if (!v || v === task.title) setTitleDraft(task.title);
    else commit({ title: v }, () => setTitleDraft(taskRef.current.title));
  };
  const commitNote = () => {
    if (noteDraft === (task.note ?? "")) return;
    const v = noteDraft.trim();
    if (v === (task.note ?? "")) setNoteDraft(task.note ?? "");
    else commit({ note: v === "" ? null : v }, () => setNoteDraft(taskRef.current.note ?? ""));
  };
  // 編集モードでは、押した行の直下にポップオーバーを出す (パネル内の位置は行の offsetTop から)。Storybook は pen の座標のまま。
  const [anchorTop, setAnchorTop] = useState<number | null>(null);
  const toggle = (p: Popover, row?: HTMLElement) => {
    // The row's top in the dialog box (its offsetParent), less the scroll of the column it sits in.
    if (editable && row) setAnchorTop(row.offsetTop + row.offsetHeight - (row.parentElement?.scrollTop ?? 0));
    setPopover((cur) => (cur === p ? null : p));
  };
  const popoverRef = useRef<HTMLDivElement>(null);
  const { reduced, t } = useMotionTiming();
  // 閉じるアニメーション中 (AppShell の AnimatePresence で退場中) は Esc レイヤーから外す (下のレイヤーの Esc を奪わない)。
  const present = useIsPresent();

  // Esc は Esc レイヤー (パネル本体の上にポップオーバー): ポップオーバーが開いていればそれだけ閉じ、無ければパネルを閉じる。
  // ポップオーバー内の行を押すと押した要素が消えてフォーカスが body に戻るので、パネルの onKeyDown では受けられない。
  // フォーカス中の入力の blur で編集中の値を確定してから閉じる (消えた要素には blur が来ない)。Esc・×・暗い所で共通。
  const closeSafely = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    onClose?.();
  };
  useEscLayer(present, closeSafely);
  useEscLayer(present && popover !== null, () => setPopover(null));

  // ポップオーバーの外のクリックで閉じる。
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!popover || !t || popoverRef.current?.contains(t) || t.closest("[data-prop-row]")) return;
      setPopover(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [popover]);

  const dueInfo = dateLabel(dueNow, today);
  const dueText = dueInfo ? `${dueInfo.label}${timeNow ? ` ${timeNow}` : ""}` : "なし";
  const dueColor =
    dueInfo?.tone === "success" ? "var(--color-success)" : dueInfo?.tone === "danger" ? "var(--color-danger)" : "var(--color-text-secondary)";

  // k / j: 前 / 次のタスク (入力中と IME の変換中は効かない)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!present || e.defaultPrevented || isTypingTarget(e) || isImeKey(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "k" && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === "j" && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrev, onNext, present]);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => boxRef.current?.focus(), []);
  const [menuOpen, setMenuOpen] = useState(false);
  const narrow = layout === "narrow";

  const header = (
    <div
      style={{
        gridColumn: "1 / -1",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px 0 16px",
        boxShadow: "inset 0 -1px 0 var(--color-border)",
      }}
    >
      <button
        type="button"
        onClick={onOpenProject}
        className="bg-transparent hover:bg-[var(--color-bg-hover)]"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-1)",
          minWidth: 0,
          padding: "4px 6px",
          border: 0,
          borderRadius: 6,
          fontFamily: "var(--font-body)",
          fontSize: 13,
          lineHeight: "19px",
          color: "var(--color-text-secondary)",
          cursor: onOpenProject ? "pointer" : "default",
        }}
      >
        <Folder size={14} color={project.color} aria-hidden />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{section ? `${project.name} / ${section}` : project.name}</span>
      </button>
      <div style={{ display: "flex", gap: 2, position: "relative" }}>
        <Button variant="icon" icon={ChevronUp} ariaLabel="前のタスク" onClick={onPrev} disabled={!onPrev && editable} />
        <Button variant="icon" icon={ChevronDown} ariaLabel="次のタスク" onClick={onNext} disabled={!onNext && editable} />
        <Button variant="icon" icon={Ellipsis} ariaLabel="その他" onClick={onDelete ? () => setMenuOpen((v) => !v) : undefined} />
        <Button variant="icon" icon={X} ariaLabel="閉じる" onClick={closeSafely} />
        {menuOpen && onDelete && (
          <div
            role="menu"
            aria-label="タスクの操作"
            style={{
              position: "absolute",
              top: "100%",
              right: 40,
              zIndex: 10,
              minWidth: 160,
              padding: "4px 0",
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              boxShadow: "var(--shadow-popover)",
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setConfirmDelete(true);
              }}
              className="bg-transparent hover:bg-[var(--color-bg-hover)]"
              style={{ display: "block", width: "100%", padding: "6px 12px", border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "19px", color: "var(--color-danger)", textAlign: "left", cursor: "pointer" }}
            >
              削除
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const left = (
    <div style={{ minHeight: narrow ? undefined : 0, overflowY: narrow ? undefined : "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {confirmDelete && onDelete && (
        <div role="alertdialog" aria-label="タスクの削除" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>
          <span style={{ flex: 1, minWidth: 0 }}>{subtasks.length > 0 ? "このタスクとサブタスクを削除します。" : "このタスクを削除します。"}</span>
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            キャンセル
          </Button>
          <Button onClick={onDelete}>削除</Button>
        </div>
      )}
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
        <span style={{ paddingTop: 4, display: "inline-flex" }}>
          <Checkbox checked={doneNow} priority={task.priority} onChange={(v) => (onToggleDone ? onToggleDone(v) : setDone(v))} ariaLabel="完了" />
        </span>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {editable ? (
            <input
              aria-label="タスク名"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                // IME 変換を確定する Enter では確定 (blur) しない (keys.ts)
                if (e.key === "Enter" && !isImeKey(e)) e.currentTarget.blur();
              }}
              style={{ ...bareField, fontSize: 20, lineHeight: "28px", fontWeight: 700, color: doneNow ? "var(--color-text-muted)" : "var(--color-text-primary)" }}
            />
          ) : (
            <div style={{ fontSize: 20, lineHeight: "28px", fontWeight: 700, color: doneNow ? "var(--color-text-muted)" : "var(--color-text-primary)" }}>{task.title}</div>
          )}
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
            <div style={{ fontSize: 14, lineHeight: "20px", color: task.note ? "var(--color-text-secondary)" : "var(--color-text-muted)" }}>{task.note ?? "説明"}</div>
          )}
        </div>
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

      <CommentsSection
        comments={comments}
        failed={commentsFailed}
        autoFocusInput={focusCommentInput}
        me={me}
        onAdd={onAddComment}
        onEdit={onEditComment}
        onDelete={onDeleteComment}
        initialEditId={initialCommentEdit}
      />
    </div>
  );

  const pickers = (
      <AnimatePresence initial={false}>
        {popover && (
          <motion.div
            key="popover"
            ref={popoverRef}
            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : 8 }}
            transition={t(0.15)}
            style={{ position: "absolute", right: 8, top: editable && anchorTop !== null ? anchorTop : POPOVER_TOP[popover], zIndex: 10 }}
          >
            {popover === "date" && (
              <DatePicker
                value={dueNow}
                time={timeNow}
                today={today}
                recurrenceLabel={rruleText}
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
                valueLabel={rruleText}
                onParse={onParseRecurrence}
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
            {popover === "project" && projects && onMove && (
              <ProjectPicker
                projects={projects}
                current={{ project: project.name, section: section ?? null }}
                onPick={(pj, sec) => {
                  setPopover(null);
                  if (pj !== project.name || sec !== (section ?? null)) onMove(pj, sec);
                }}
              />
            )}
            {popover === "labels" && allLabels && (
              <LabelPicker
                labels={allLabels}
                selected={task.labels}
                onToggle={(name) => {
                  const next = task.labels.includes(name) ? task.labels.filter((l) => l !== name) : [...task.labels, name];
                  void onChange?.({ labels: next });
                }}
              />
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
          </motion.div>
        )}
      </AnimatePresence>
  );

  const right = (
    <div
      style={{
        minHeight: narrow ? undefined : 0,
        overflowY: narrow ? undefined : "auto",
        padding: "8px 16px",
        background: "var(--color-bg-sidebar)",
        boxShadow: narrow ? "inset 0 1px 0 var(--color-border)" : "inset 1px 0 0 var(--color-border)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <PropRow
        icon={<Folder size={16} />}
        name="プロジェクト"
        value={section ? `${project.name} / ${section}` : project.name}
        onClick={projects && onMove ? (row) => toggle("project", row) : undefined}
        expanded={projects && onMove ? popover === "project" : undefined}
      />
      <PropRow icon={<Calendar size={16} />} name="日付" value={dueText} valueColor={dueColor} onClick={(row) => toggle("date", row)} expanded={popover === "date"} />
      <PropRow
        icon={<Flag size={16} />}
        name="優先度"
        value={`P${task.priority}`}
        valueColor={`var(--color-priority-${task.priority})`}
        onClick={editable ? (row) => toggle("priority", row) : undefined}
        expanded={editable ? popover === "priority" : undefined}
      />
      <PropRow
        icon={<Tag size={16} />}
        name="ラベル"
        value={task.labels.map((l) => `@${l}`).join(" ") || "なし"}
        onClick={allLabels && editable ? (row) => toggle("labels", row) : undefined}
        expanded={allLabels && editable ? popover === "labels" : undefined}
      />
      <PropRow icon={<Bell size={16} />} name="リマインダー" value={reminderSummary(remindersNow)} onClick={(row) => toggle("reminder", row)} expanded={popover === "reminder"} />
      <PropRow icon={<Repeat size={16} />} name="繰り返し" value={rruleText} onClick={(row) => toggle("recurrence", row)} expanded={popover === "recurrence"} />
    </div>
  );

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          // Commit the edit in progress first (the mousedown would otherwise remove a focused input before its blur).
          e.preventDefault();
          closeSafely();
        }
      }}
      style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-scrim)", pointerEvents: "auto" }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        tabIndex={-1}
        style={{
          position: "relative",
          outline: "none",
          width: "min(864px, calc(100vw - 32px))",
          height: "min(820px, calc(100vh - 64px))",
          display: "grid",
          gridTemplateRows: narrow ? "48px max-content max-content" : "48px minmax(0, 1fr)",
          alignContent: "start",
          gridTemplateColumns: narrow ? "1fr" : "minmax(0, 1fr) 260px",
          overflowY: narrow ? "auto" : "hidden",
          background: "var(--color-bg)",
          borderRadius: 12,
          boxShadow: "var(--shadow-dialog)",
          fontFamily: "var(--font-body)",
          color: "var(--color-text-primary)",
        }}
      >
        {header}
        {left}
        {right}
        {pickers}
      </div>
    </div>
  );
}

