import type React from "react";
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AddTaskRow } from "../components/AddTaskRow";
import { SectionHeader } from "../components/SectionHeader";
import { TaskRow } from "../components/TaskRow";
import { Button } from "../components/Button";
import { Collapse, useMotionTiming } from "../motion";
import { CommentCounts } from "../app/useComments";
import { LONG_TITLE, TODAY, dateLabel } from "../mock/data";
import type { InvalidRow, Section, Task } from "../types/model";
import { useReportKeys } from "../app/useRowFocus";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { PageHeader, Subtitle, titleStyle } from "./HeaderActions";
import { useView } from "../app/view/ViewOptionsContext";
import { arrange, firstOccurrences } from "../app/view/arrange";
import type { ViewOptions } from "../app/view/viewOptions";
import { InlineEdit } from "./InlineEdit";
import { SubtaskForm } from "./SubtaskForm";
import { DatePicker } from "./DatePicker";
import { DeleteTaskDialog } from "./DeleteTaskDialog";
import { TaskEditor } from "./TaskEditor";
import { ActionRow } from "./ActionRow";
import { RowActions } from "../app/rowActions";
import { DragCtx } from "../app/drag/DragContext";
import { TaskMenu } from "./TaskMenu";
import { blankValue, editorValueOf } from "./taskEditorValue";

export type ProjectViewProps = {
  project: string;
  tasks: Task[];
  sections: Section[];
  initialExpanded?: number[];
  initialFormParent?: number;
  showLongTitleRow?: boolean;
  state?: "normal" | "empty" | "error" | "invalid";
  /** 行の 4 アイコンを常に表示する (D-13 で右端のはみ出しを確認するため)。既定はホバー時のみ。 */
  showActions?: boolean;
  /** 行のクリック (チェック / シェブロン / アイコン以外) でタスク詳細を開く。D-03 系の Story だけが渡す。 */
  onOpenTask?: (t: Task) => void;
  // ---- 実アプリ用 (全部 optional。無ければ Storybook と同じ見た目だけの挙動) ----
  /** 渡すとチェックボックスはこれを呼ぶ (見た目だけのローカル切替はしない)。完了状態は task.progress から決まる。 */
  onToggleDone?: (t: Task, done: boolean) => void;
  /** 渡すと「タスクを追加」行がインライン入力 (SubtaskForm) を開く。section は未分類なら null。 */
  onAddTask?: (section: string | null, title: string) => void;
  /** 渡すと「サブタスクを追加」の入力は空で始まり (絵コンテの入力例は入れない)、送信でこれを呼ぶ。 */
  onAddSubtask?: (parent: Task, title: string) => void;
  /** 渡すと行の「その他」アイコンで削除の確認行を出し、確定でこれを呼ぶ。 */
  onDeleteTask?: (t: Task) => void;
  /** 型の不整合で Task にできなかった行。渡すと要修正の行として一覧に出す (D-11c)。 */
  invalidRows?: InvalidRow[];
  /** state="error" (D-11b) の「再試行」「ファイルの場所を開く」。 */
  onRetryLoad?: () => void;
  onRevealFile?: () => void;
  /** state="error" のとき ErrorState に添えるエラーメッセージ。 */
  errorDetail?: string;
  /** 渡すと最後のセクションの下に「セクションを追加」を出し、名前の入力 (Enter / Esc) で確定するとこれを呼ぶ。 */
  onAddSection?: (name: string) => void;
  /** 渡すとセクション名をダブルクリックでその場で編集でき、確定でこれ (旧名, 新名) を呼ぶ。 */
  onRenameSection?: (oldName: string, newName: string) => void;
  /** 渡すとヘッダー右の「その他」にメニュー (名前を変更) が出る。確定でこれを呼ぶ。受信トレイには渡さない。 */
  onRenameProject?: (newName: string) => void;
  /** 渡すとヘッダー右の「その他」メニューに「削除」が出る (確認は呼び出し側)。受信トレイには渡さない。 */
  onDeleteProject?: () => void;
  /** 期限ラベルの基準日 YYYY-MM-DD。既定は Storybook の固定日 (TODAY)。 */
  today?: string;
  /** キーボードのフォーカス行 (`project/no`)。 */
  focusedKey?: string;
  /** Main: the row (`project/no`) whose drop is being saved. Drawn faded, as while it is lifted. */
  movingKey?: string;
  /** Stories: draw the drag card, red line or ring at fixed positions without the engine (D-01n/o/p). A targetNo with no row only dims the source (D-01r draws its own card over the sidebar). */
  dragPreview?: { no: number; kind: "between" | "indent" | "onto"; targetNo: number };
  /** Stories: this section is drawn as dragged, with the red line above the first other section (D-01q). */
  sectionDragPreview?: string;
  /** Stories: draw this task's row as hovered (handle and actions shown). */
  hoverNo?: number;
  /** Stories: this task's row starts as the inline editor (D-01i). */
  initialEditNo?: number;
  /** Stories: the "add task" editor of this section starts open (null = unsectioned, D-01j). */
  initialAddSection?: string | null;
  /** Stories: this row's "..." menu is open (D-01k). */
  initialMenuNo?: number;
  /** Stories: this row's date picker is open (D-01l). */
  initialDateNo?: number;
  /** Stories: the delete confirmation of this task is shown (D-01m). */
  initialDeleteNo?: number;
  /** Stories: the 表示 menu starts open (D-01s). */
  initialViewMenuOpen?: boolean;
  /** Stories: the 表示 options without a provider (D-01s). */
  initialView?: ViewOptions;
  /** 表示している行 (折りたたまれていないセクション / 展開中のサブタスク / 表示中の完了) のキーを表示順に知らせる。変わったときだけ呼ぶ。 */
  onVisibleKeys?: (keys: string[]) => void;
  /** → / ← 用に、サブタスクの展開 / 折りたたみ操作をマウント時に 1 度渡す (アンマウントで null)。 */
  onExpandApi?: (api: ExpandApi | null) => void;
  /** 週の開始 (「今週」のフィルター)。既定は月曜。 */
  weekStart?: "mon" | "sun";
  /** ラベルのグループの並び順 (名前)。 */
  labelOrder?: string[];
  /** プロジェクトの並び順 (名前)。 */
  projectOrder?: string[];
  /** 自動の並び (並び替えかグループ) の間に持ち手を押した。restore は手動・グループなしに戻す。Main がお知らせを出す。 */
  onReorderLocked?: (restore: () => void) => void;
};

type PreviewRect = { top: number; left: number; width: number; height: number };
const cardStyle = {
  position: "absolute",
  boxSizing: "border-box",
  background: "var(--color-bg)",
  borderRadius: 6,
  boxShadow: "var(--shadow-popover)",
  pointerEvents: "none",
  zIndex: 5,
} as const;

/** Stories only (D-01n to D-01q): the card, red line and ring at fixed positions, measured from the rows. No engine. */
function PreviewLayer({
  listRef,
  task,
  dragPreview,
  section,
  firstOther,
}: {
  listRef: React.RefObject<HTMLDivElement | null>;
  task?: Task;
  dragPreview?: ProjectViewProps["dragPreview"];
  section?: string;
  firstOther?: string;
}) {
  const [rects, setRects] = useState<{ source?: PreviewRect; target?: PreviewRect; header?: PreviewRect }>({});
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const base = list.getBoundingClientRect();
    const rel = (el: Element | null): PreviewRect | undefined => {
      if (!el) return undefined;
      const r = el.getBoundingClientRect();
      return { top: r.top - base.top, left: r.left - base.left, width: r.width, height: r.height };
    };
    setRects({
      source: dragPreview ? rel(list.querySelector(`[data-row][data-no="${dragPreview.no}"]`)) : undefined,
      target: dragPreview ? rel(list.querySelector(`[data-row][data-no="${dragPreview.targetNo}"]`)) : undefined,
      header: firstOther ? rel(list.querySelector(`[data-row-kind="header"][data-section="${firstOther}"]`)) : undefined,
    });
  }, [listRef, dragPreview, firstOther]);
  const line = (top: number, left: number, width: number) => (
    <div aria-hidden style={{ position: "absolute", top: top - 1, left, width, height: 2, background: "var(--color-accent)", pointerEvents: "none", zIndex: 6 }}>
      <span style={{ position: "absolute", left: 0, top: -3, width: 8, height: 8, boxSizing: "border-box", borderRadius: 4, border: "2px solid var(--color-accent)", background: "var(--color-bg)" }} />
    </div>
  );
  const { source, target, header } = rects;
  return (
    <>
      {task && source && target && (
        <div aria-hidden style={{ ...cardStyle, top: source.top + 14, left: source.left + 6, width: source.width - 12 }}>
          <TaskRow title={task.title} done={false} priority={task.priority} hideActions />
        </div>
      )}
      {dragPreview && target && dragPreview.kind === "between" && line(target.top + target.height, target.left, target.width)}
      {dragPreview && target && dragPreview.kind === "indent" && line(target.top + target.height, target.left + 28, target.width - 28)}
      {dragPreview && target && dragPreview.kind === "onto" && (
        <div aria-hidden style={{ position: "absolute", top: target.top, left: target.left, width: target.width, height: target.height, borderRadius: 6, boxShadow: "inset 0 0 0 1px var(--color-accent)", pointerEvents: "none", zIndex: 6 }} />
      )}
      {section && header && (
        <>
          <div aria-hidden style={{ ...cardStyle, top: header.top + 14, left: header.left + 6, width: 280, padding: "8px 12px", fontWeight: 700, fontSize: 14, color: "var(--color-text-primary)" }}>
            {section}
          </div>
          {line(header.top, header.left, header.width)}
        </>
      )}
    </>
  );
}

export type ExpandApi = { expand(no: number): void; collapse(no: number): void };

const INVALID_TASK_NO = 2; // D-11c で要修正にする行 (洗剤の詰め替え)
const INVALID_SUFFIX = "    ⚠ 要修正: 「終了」列が日付ではありません (値: 来週)";
const noop = () => {};
/** 完了にしたチェックが付いたまま行を残す時間 (ms)。この後に行が退場する (完了タスクを隠している間だけ)。 */
const LEAVE_DELAY_MS = 250;
/** 追加された行のハイライトが消えるまで (ms)。 */
const HIGHLIGHT_MS = 600;
/** 型の不整合で Task にならなかった行の 1 行表示 (読み取り専用)。 */
function invalidRowTitle(r: InvalidRow): string {
  const where = r.no !== undefined ? `行 ${r.row} (No. ${r.no})` : `行 ${r.row}`;
  return `${where}    ⚠ 要修正: 「${r.column}」列: ${r.message}${r.value ? ` (値: ${r.value})` : ""}`;
}
const FORM_SAMPLE_TITLE = "食パンの代わりにベーグル"; // D-01c の入力例 (Story で最初から開いているときだけ入れる)

export function ProjectView({
  project,
  tasks,
  sections,
  initialExpanded = [],
  initialFormParent,
  showLongTitleRow,
  state = "normal",
  showActions,
  onOpenTask,
  onToggleDone,
  onAddTask,
  onAddSubtask,
  onDeleteTask,
  invalidRows,
  onRetryLoad,
  onRevealFile,
  errorDetail,
  onAddSection,
  onRenameSection,
  onRenameProject,
  onDeleteProject,
  today = TODAY,
  focusedKey,
  movingKey,
  hoverNo,
  dragPreview,
  sectionDragPreview,
  initialEditNo,
  initialAddSection,
  initialMenuNo,
  initialDateNo,
  initialDeleteNo,
  initialViewMenuOpen,
  initialView,
  onVisibleKeys,
  onExpandApi,
  weekStart = "mon",
  labelOrder = [],
  projectOrder = [],
  onReorderLocked,
}: ProjectViewProps) {
  const [viewOptions, setViewOptions] = useView("project", project, initialView);
  const previewRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(initialExpanded));
  const [formParent, setFormParent] = useState<number | undefined>(initialFormParent);
  const [formOpenedByClick, setFormOpenedByClick] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(sections.filter((s) => s.project === project && s.collapsed).map((s) => s.name)),
  );
  const [doneOverride, setDoneOverride] = useState<Map<number, boolean>>(() => new Map());
  const [groupCollapsed, setGroupCollapsed] = useState<Set<string>>(() => new Set());
  const showCompleted = viewOptions.done;
  const sorted = viewOptions.sort !== "manual" || viewOptions.group !== "none";
  const restoreManual = () => setViewOptions({ ...viewOptions, sort: "manual", dir: "asc", group: "none" });
  const lockedToast = () => onReorderLocked?.(restoreManual);
  const [addTo, setAddTo] = useState<{ section: string | null } | null>(initialAddSection !== undefined ? { section: initialAddSection } : null);
  const [editNo, setEditNo] = useState<number | undefined>(initialEditNo);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [renamingProject, setRenamingProject] = useState(false);
  // 完了にした直後の行 (no)。完了タスクを隠している間は、LEAVE_DELAY_MS だけ未完了の一覧に残してから退場させる。
  const [leaving, setLeaving] = useState<Set<number>>(() => new Set());
  const leaveTimers = useRef(new Map<number, number>());
  // 直前の描画に無かった行 (追加された行)。ハイライトを HIGHLIGHT_MS だけ出す。
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  const seenNos = useRef<Set<number> | null>(null);
  const timers = useRef(new Set<number>());
  const { reduced } = useMotionTiming();

  const commentCounts = useContext(CommentCounts);
  const rowCtx = useContext(RowActions);
  const drag = useContext(DragCtx);
  const mine = tasks.filter((t) => t.project === project);
  // Open tasks of this project, for the line under the title.
  const openCount = mine.filter((t) => t.progress !== 100).length;
  const nosKey = mine.map((t) => t.no).join(",");
  useEffect(() => {
    const now = new Set(nosKey ? nosKey.split(",").map(Number) : []);
    const prev = seenNos.current;
    seenNos.current = now;
    if (!prev) return;
    const added = [...now].filter((n) => !prev.has(n));
    if (added.length === 0) return;
    setFresh((f) => new Set([...f, ...added]));
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      setFresh((f) => new Set([...f].filter((n) => !added.includes(n))));
    }, HIGHLIGHT_MS + 100);
    timers.current.add(id);
  }, [nosKey]);
  useEffect(
    () => () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      leaveTimers.current.forEach((id) => window.clearTimeout(id));
    },
    [],
  );

  const isDone = (t: Task) => (onToggleDone ? t.progress === 100 || leaving.has(t.no) : (doneOverride.get(t.no) ?? t.progress === 100));
  const toggleDone = (t: Task) => {
    if (!onToggleDone) {
      setDoneOverride((m) => new Map(m).set(t.no, !isDone(t)));
      return;
    }
    const next = !isDone(t);
    const timer = leaveTimers.current.get(t.no);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      leaveTimers.current.delete(t.no);
    }
    if (next && !showCompleted && t.parentNo === undefined) {
      setLeaving((s) => new Set(s).add(t.no));
      leaveTimers.current.set(
        t.no,
        window.setTimeout(() => {
          leaveTimers.current.delete(t.no);
          setLeaving((s) => {
            const n = new Set(s);
            n.delete(t.no);
            return n;
          });
        }, LEAVE_DELAY_MS),
      );
    } else {
      setLeaving((s) => {
        if (!s.has(t.no)) return s;
        const n = new Set(s);
        n.delete(t.no);
        return n;
      });
    }
    onToggleDone(t, next);
  };
  const childrenOf = (no: number) => mine.filter((t) => t.parentNo === no).sort((a, b) => a.order - b.order);
  const heightOf = (no: number): number => Math.max(0, ...childrenOf(no).map((c) => 1 + heightOf(c.no)));
  const keysOf = (no: number): Set<string> => new Set([`${project}/${no}`, ...childrenOf(no).flatMap((c) => [...keysOf(c.no)])]);
  const toggleSet = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  /** `live`: false for the completed list (no data-row, no drag handle). */
  const renderRow = (t: Task, indent: 0 | 1 | 2, live = true, rowKey: string | number = t.no, dup = false): React.ReactNode => {
    const kids = childrenOf(t.no);
    const open = expanded.has(t.no);
    const invalid = state === "invalid" && !invalidRows && t.no === INVALID_TASK_NO;
    // A repeated copy (`dup`, label grouping) shares the task's editor / form / drag state: only the first copy shows them.
    const row = !dup && editNo === t.no ? (
      <TaskEditor
        mode="edit"
        initial={editorValueOf(t)}
        projects={t.parentNo === undefined ? [{ name: project, sections: projectSections.map((s) => s.name) }] : undefined}
        allLabels={[]}
        today={today}
        onCancel={() => setEditNo(undefined)}
        onSubmit={() => Promise.resolve(true)}
      />
    ) : (
      <ActionRow
        task={t}
        canInsert
        dup={dup}
        rowProps={{
          title: invalid ? t.title + INVALID_SUFFIX : t.title,
          description: t.note,
          focused: !dup && focusedKey === `${t.project}/${t.no}`,
          done: isDone(t),
          priority: t.priority,
          date: dateLabel(t.due, today),
          recurring: onToggleDone && t.rrule ? true : undefined,
          labels: t.labels,
          commentCount: commentCounts[`${t.project}/${t.no}`],
          indent,
          showActions: showActions || hoverNo === t.no,
          showHandle: hoverNo === t.no,
          onClick: onOpenTask ? () => onOpenTask(t) : undefined,
          subtasks: kids.length ? { done: kids.filter(isDone).length, total: kids.length, expanded: open } : undefined,
          onToggleDone: () => toggleDone(t),
          // Without RowActions (stories) the "..." shows the old inline confirmation; ActionRow replaces it otherwise.
          onMore: onDeleteTask ? () => setDeleteTarget((cur) => (cur === t.no ? null : t.no)) : undefined,
          onToggleExpand: () => setExpanded((s) => toggleSet(s, t.no)),
          onHandlePointerDown:
            live && drag
              ? (e) => {
                  if (sorted) lockedToast();
                  drag.start(
                    e,
                    { kind: "task", task: t, view: "project", depth: indent, height: heightOf(t.no), subtree: keysOf(t.no) },
                    <TaskRow title={t.title} done={false} priority={t.priority} hideActions />,
                  );
                }
              : undefined,
          dragging:
            !dup &&
            ((drag?.active?.kind === "task" && drag.active.task.no === t.no && drag.active.task.project === project) ||
              movingKey === `${project}/${t.no}` ||
              dragPreview?.no === t.no),
        }}
      />
    );
    return (
      <Collapse key={rowKey} enterY={-8} duration={0.1}>
        {/* 追加された行のハイライト: accent-soft から透明へ 600ms。行の背面 (DOM で行より前) に置く。 */}
        <div
          style={{ position: "relative" }}
          {...(live && !dup
            ? {
                "data-row": "",
                "data-row-kind": "task",
                "data-key": `${t.project}/${t.no}`,
                "data-no": t.no,
                "data-depth": indent,
                "data-parent": t.parentNo ?? "",
                // A カテゴリ that is no section (typed in Excel) shows unsectioned: drop as unsectioned too.
                "data-section": t.category !== null && sectionNames.has(t.category) ? t.category : "",
              }
            : {})}
        >
          {fresh.has(t.no) && (
            <motion.div
              aria-hidden
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : HIGHLIGHT_MS / 1000, ease: "easeOut" }}
              style={{ position: "absolute", top: 0, bottom: 0, right: 0, left: indent * 32, background: "var(--color-accent-soft)", pointerEvents: "none" }}
            />
          )}
          {invalid ? <div style={{ background: "var(--color-accent-soft)" }}>{row}</div> : row}
          {initialMenuNo === t.no && (
            <div style={{ position: "absolute", top: 36, right: 0, zIndex: 30 }}>
              <TaskMenu
                task={t}
                today={today}
                canInsert
                projects={[{ name: project, sections: projectSections.map((s) => s.name) }]}
                onAddAbove={noop}
                onAddBelow={noop}
                onEdit={noop}
                onDue={noop}
                onPriority={noop}
                onReminders={noop}
                onMove={noop}
                onDuplicate={noop}
                onDelete={noop}
                onClose={noop}
              />
            </div>
          )}
          {initialDateNo === t.no && (
            <div style={{ position: "absolute", top: 36, right: 40, zIndex: 30 }}>
              <DatePicker value={t.due} time={t.dueTime} today={today} />
            </div>
          )}
        </div>
        {onDeleteTask && deleteTarget === t.no && (
          <div
            role="alertdialog"
            aria-label="タスクの削除"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              padding: "8px 0",
              marginLeft: indent * 32,
              fontFamily: "var(--font-body)",
              fontSize: 13,
              lineHeight: "19px",
              color: "var(--color-text-secondary)",
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>{kids.length > 0 ? "このタスクとサブタスクを削除します。" : "このタスクを削除します。"}</span>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              キャンセル
            </Button>
            <Button
              onClick={() => {
                setDeleteTarget(null);
                onDeleteTask(t);
              }}
            >
              削除
            </Button>
          </div>
        )}
        <AnimatePresence initial={false}>
          {open && (
            <Collapse key="subtasks" duration={0}>
              <AnimatePresence initial={false}>{kids.map((k) => renderRow(k, Math.min(indent + 1, 2) as 1 | 2, live, k.no, dup))}</AnimatePresence>
              {indent === 0 && kids.length > 0 && !dup && (
                <div style={{ marginLeft: 32 }}>
                  {formParent === t.no && rowCtx ? (
                    <TaskEditor
                      mode="add"
                      initial={blankValue(project, t.category)}
                      allLabels={rowCtx.allLabels}
                      today={rowCtx.today}
                      onCancel={() => setFormParent(undefined)}
                      onSubmit={(v) => rowCtx.add(v, { parentNo: t.no }).then((no) => no !== null)}
                    />
                  ) : formParent === t.no ? (
                    <SubtaskForm
                      defaultTitle={formOpenedByClick || onAddSubtask ? "" : FORM_SAMPLE_TITLE}
                      autoFocus={formOpenedByClick}
                      compact={!!onAddSubtask}
                      onCancel={() => setFormParent(undefined)}
                      onSubmit={(title) => {
                        setFormParent(undefined);
                        onAddSubtask?.(t, title.trim());
                      }}
                    />
                  ) : (
                    <AddTaskRow
                      label="サブタスクを追加"
                      onClick={() => {
                        setFormOpenedByClick(true);
                        setFormParent(t.no);
                      }}
                    />
                  )}
                </div>
              )}
            </Collapse>
          )}
        </AnimatePresence>
      </Collapse>
    );
  };

  const topLevel = mine.filter((t) => t.parentNo === undefined).sort((a, b) => a.order - b.order);
  // 読み込み時点で未完了 / 完了済みの分類は固定し、チェックの見た目だけトグルする (行は動かない)
  // 完了にした直後の行 (leaving) は、LEAVE_DELAY_MS だけ未完了の一覧に残す
  const open = topLevel.filter((t) => t.progress !== 100 || leaving.has(t.no));
  const completed = topLevel.filter((t) => t.progress === 100 && !leaving.has(t.no));
  const projectSections = sections.filter((s) => s.project === project).sort((a, b) => a.order - b.order);
  const sectionNames = new Set(projectSections.map((s) => s.name));
  const unsectioned = open.filter((t) => t.category === null || !sectionNames.has(t.category));

  // 表示の設定 (spec ⑤ §3)。完了にした直後の行 (leaving) は未完了として並べ、元の Task に戻す。
  const arrangeCtx = { today, weekStart, labelOrder, projectOrder };
  const byNo = new Map(topLevel.map((t) => [t.no, t]));
  const asOpen = (t: Task): Task => (leaving.has(t.no) ? { ...t, progress: 0 } : t);
  const grouped = viewOptions.group !== "none";
  const arrangedGroups = grouped ? arrange(topLevel.map(asOpen), viewOptions, arrangeCtx) : null;
  const firstKeys = arrangedGroups ? firstOccurrences(arrangedGroups.groups) : new Set<string>();
  const arrangeSection = (list: Task[]) => {
    const r = arrange(list.map(asOpen), { ...viewOptions, group: "none", done: false }, arrangeCtx);
    return { rows: (r.groups[0]?.rows ?? []).map((x) => byNo.get(x.task.no)!), hidden: r.hidden };
  };
  const unsectionedA = arrangeSection(unsectioned);
  const sectionA = new Map(projectSections.map((s) => [s.name, arrangeSection(open.filter((t) => t.category === s.name))]));
  const doneRows = grouped
    ? []
    : (arrange(completed, { ...viewOptions, group: "none", done: true }, arrangeCtx).groups.find((g) => g.key === "done")?.rows ?? []).map((x) => x.task);
  const hiddenCount = arrangedGroups
    ? arrangedGroups.hidden
    : unsectionedA.hidden + [...sectionA.values()].reduce((n, a) => n + a.hidden, 0);

  // キーボードのフォーカス対象 = 画面に出ている行を表示順に (renderRow と同じ並び)。
  const rowKeys = (t: Task): string[] => [
    `${t.project}/${t.no}`,
    ...(expanded.has(t.no) ? childrenOf(t.no).flatMap(rowKeys) : []),
  ];
  const visibleKeys = (): string[] => {
    if (state === "empty" || state === "error") return [];
    if (arrangedGroups) {
      return arrangedGroups.groups.flatMap((g) =>
        groupCollapsed.has(g.key) ? [] : g.rows.filter((r) => firstKeys.has(r.key)).flatMap((r) => rowKeys(r.task)),
      );
    }
    return [
      ...unsectionedA.rows.flatMap(rowKeys),
      ...projectSections.flatMap((s) => (collapsed.has(s.name) ? [] : sectionA.get(s.name)!.rows.flatMap(rowKeys))),
      ...(showCompleted ? doneRows.flatMap(rowKeys) : []),
    ];
  };
  useReportKeys(visibleKeys, onVisibleKeys);
  const expandApi = useRef<ExpandApi>({
    expand: (no) => setExpanded((s) => (s.has(no) ? s : new Set(s).add(no))),
    collapse: (no) =>
      setExpanded((s) => {
        if (!s.has(no)) return s;
        const n = new Set(s);
        n.delete(no);
        return n;
      }),
  });
  useEffect(() => {
    onExpandApi?.(expandApi.current);
    return () => onExpandApi?.(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** セクション末尾 (未分類は section=null) の「タスクを追加」。onAddTask があればクリックでインライン入力に変わる。 */
  const addSlot = (section: string | null): React.ReactNode => {
    const slot = addSlotInner(section);
    return slot && (
      <div data-row="" data-row-kind="slot" data-section={section ?? ""}>
        {slot}
      </div>
    );
  };
  const addSlotInner = (section: string | null): React.ReactNode => {
    if (rowCtx) {
      if (addTo && addTo.section === section) {
        return (
          <TaskEditor
            mode="add"
            initial={blankValue(project, section)}
            projects={rowCtx.projects}
            inbox={rowCtx.inbox}
            allLabels={rowCtx.allLabels}
            today={rowCtx.today}
            onCancel={() => setAddTo(null)}
            onSubmit={(v) => rowCtx.add(v).then((no) => no !== null)}
          />
        );
      }
      return <AddTaskRow onClick={() => setAddTo({ section })} />;
    }
    if (!onAddTask && addTo && addTo.section === section) {
      return (
        <TaskEditor
          mode="add"
          initial={blankValue(project, section)}
          projects={[{ name: project, sections: projectSections.map((s) => s.name) }]}
          allLabels={[]}
          today={today}
          onCancel={() => setAddTo(null)}
          onSubmit={() => Promise.resolve(true)}
        />
      );
    }
    if (!onAddTask) return section === null ? null : <AddTaskRow />;
    if (addTo && addTo.section === section) {
      return (
        <SubtaskForm
          autoFocus
          compact
          placeholder="タスク名"
          submitLabel="タスクを追加"
          onCancel={() => setAddTo(null)}
          onSubmit={(title) => {
            setAddTo(null);
            onAddTask(section, title.trim());
          }}
        />
      );
    }
    return <AddTaskRow onClick={() => setAddTo({ section })} />;
  };

  /** 「セクションを追加」(onAddSection があるときだけ)。クリックで名前の入力 (Enter / Esc) に変わる。 */
  const addSectionSlot: React.ReactNode =
    onAddSection &&
    (addingSection ? (
      <div style={{ padding: "8px 0" }}>
        <InlineEdit
          ariaLabel="セクション名"
          placeholder="セクション名"
          onCommit={(name) => {
            setAddingSection(false);
            onAddSection(name);
          }}
          onCancel={() => setAddingSection(false)}
        />
      </div>
    ) : (
      <AddTaskRow label="セクションを追加" onClick={() => setAddingSection(true)} />
    ));

  const body = (): React.ReactNode => {
    if (state === "empty") return <EmptyState onAdd={onAddTask ? () => setAddTo({ section: null }) : undefined} />;
    const liveEmpty = state !== "error" && !!onAddTask && mine.length === 0 && projectSections.length === 0 && !invalidRows?.length && !addTo;
    if (liveEmpty) {
      return (
        <>
          <EmptyState onAdd={() => setAddTo({ section: null })} />
          {addSectionSlot}
        </>
      );
    }
    if (state === "error") {
      return <ErrorState fileName={`${project}.xlsx`} detail={errorDetail} onRetry={onRetryLoad} onReveal={onRevealFile ?? (onRetryLoad ? undefined : noop)} />;
    }
    return (
      <div ref={previewRef} {...(sorted ? {} : { "data-drop-list": "project" })} data-level0="0" data-section-list="" style={{ position: "relative" }}>
        {(dragPreview || sectionDragPreview) && (
          <PreviewLayer
            listRef={previewRef}
            task={dragPreview ? tasks.find((t) => t.no === dragPreview.no) : undefined}
            dragPreview={dragPreview}
            section={sectionDragPreview}
            firstOther={projectSections.find((x) => x.name !== sectionDragPreview)?.name}
          />
        )}
        {/* While a task is dragged, the gutter with the grips counts as part of the list (a pull straight up from the grip keeps its target). */}
        {drag?.active?.kind === "task" && <div aria-hidden style={{ position: "absolute", left: -48, top: 0, bottom: 0, width: 48 }} />}
        {showLongTitleRow && (
          <TaskRow title={LONG_TITLE} done={false} priority={4} showActions={showActions} />
        )}
        {invalidRows?.map((r) => (
          <div key={`invalid-${r.row}`} style={{ background: "var(--color-accent-soft)" }}>
            <TaskRow title={invalidRowTitle(r)} done={false} priority={4} hideActions />
          </div>
        ))}
        {arrangedGroups ? (
          <>
            {arrangedGroups.groups.map((g) => {
              const isCollapsed = groupCollapsed.has(g.key);
              const isDoneGroup = g.key === "done";
              return (
                <section key={g.key}>
                  <SectionHeader
                    title={g.title}
                    count={g.rows.filter((r) => !isDone(r.task)).length}
                    collapsed={isCollapsed}
                    onToggle={() => setGroupCollapsed((c) => toggleSet(c, g.key))}
                  />
                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <Collapse key="body" duration={0}>
                        <AnimatePresence initial={false}>
                          {g.rows.map((r) => renderRow(byNo.get(r.task.no)!, 0, !isDoneGroup, r.key, !firstKeys.has(r.key)))}
                        </AnimatePresence>
                      </Collapse>
                    )}
                  </AnimatePresence>
                </section>
              );
            })}
            {addSlot(null)}
          </>
        ) : (
          <>
        <AnimatePresence initial={false}>{unsectionedA.rows.map((t) => renderRow(t, 0))}</AnimatePresence>
        {addSlot(null)}
        {projectSections.map((s) => {
          const rows = sectionA.get(s.name)!.rows;
          const isCollapsed = collapsed.has(s.name);
          return (
            <section key={s.name}>
              <div data-row="" data-row-kind="header" data-section={s.name} {...(sorted ? {} : { "data-drop-section": s.name })}>
              <SectionHeader
                onHandlePointerDown={
                  drag
                    ? (e) => {
                        if (sorted) lockedToast();
                        else drag.start(e, { kind: "section", project, name: s.name }, <div style={{ padding: "8px 12px", fontWeight: 700 }}>{s.name}</div>);
                      }
                    : undefined
                }
                title={s.name}
                count={rows.filter((t) => !isDone(t)).length}
                collapsed={isCollapsed}
                onToggle={() => setCollapsed((c) => toggleSet(c, s.name))}
                onStartEdit={onRenameSection ? () => setEditingSection(s.name) : undefined}
                editor={
                  onRenameSection && editingSection === s.name ? (
                    <InlineEdit
                      value={s.name}
                      ariaLabel="セクション名"
                      style={{ fontWeight: 700 }}
                      onCommit={(newName) => {
                        setEditingSection(null);
                        if (newName === s.name) return;
                        // 折りたたみ状態は名前で持っているので新しい名前に引き継ぐ
                        setCollapsed((c) => (c.has(s.name) ? new Set([...c].filter((n) => n !== s.name).concat(newName)) : c));
                        onRenameSection(s.name, newName);
                      }}
                      onCancel={() => setEditingSection(null)}
                    />
                  ) : undefined
                }
              />
              </div>
              <AnimatePresence initial={false}>
                {!isCollapsed && (
                  <Collapse key="body" duration={0}>
                    <AnimatePresence initial={false}>{rows.map((t) => renderRow(t, 0))}</AnimatePresence>
                    {addSlot(s.name)}
                  </Collapse>
                )}
              </AnimatePresence>
            </section>
          );
        })}
        {addSectionSlot}
        <AnimatePresence initial={false}>{showCompleted && doneRows.map((t) => renderRow(t, 0, false))}</AnimatePresence>
          </>
        )}
        <button
          type="button"
          aria-pressed={showCompleted}
          onClick={() => setViewOptions({ ...viewOptions, done: !viewOptions.done })}
          style={{
            display: "block",
            padding: 0,
            border: 0,
            background: "none",
            fontFamily: "var(--font-body)",
            fontSize: 13,
            lineHeight: "19px",
            color: "var(--color-text-secondary)",
            cursor: "pointer",
          }}
        >
          {showCompleted ? "完了したタスクを隠す" : "完了したタスクを表示"}
        </button>
      </div>
    );
  };

  const menu = onRenameProject || onDeleteProject ? { rename: onRenameProject ? () => setRenamingProject(true) : undefined, delete: onDeleteProject } : undefined;
  return (
    <>
      <PageHeader onMenu={menu} view={{ screen: "project", options: viewOptions, onChange: setViewOptions }} initialViewMenuOpen={initialViewMenuOpen}>
        {renamingProject && onRenameProject ? (
          <div style={{ flex: 1, minWidth: 0, maxWidth: 480, marginRight: "var(--space-4)" }}>
            <InlineEdit
              value={project}
              ariaLabel="プロジェクト名"
              style={{ fontSize: 26, lineHeight: "36px", fontWeight: 700, padding: "0 7px" }}
              onCommit={(name) => {
                setRenamingProject(false);
                if (name !== project) onRenameProject(name);
              }}
              onCancel={() => setRenamingProject(false)}
            />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <h1 style={titleStyle}>{project}</h1>
            <Subtitle text={`${openCount} 件のタスク`} />
          </div>
        )}
      </PageHeader>
      {state === "normal" && hiddenCount > 0 && (
        <div style={{ fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)", marginBottom: "var(--space-2)" }}>
          {hiddenCount} 件を隠しています (フィルター)
        </div>
      )}
      {body()}
      {initialDeleteNo !== undefined &&
        (() => {
          const t = mine.find((x) => x.no === initialDeleteNo);
          return t ? <DeleteTaskDialog title={t.title} subtasks={childrenOf(t.no).length} onCancel={noop} onConfirm={noop} /> : null;
        })()}
    </>
  );
}
