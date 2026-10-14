import type React from "react";
import { useState } from "react";
import { AddTaskRow } from "../components/AddTaskRow";
import { SectionHeader } from "../components/SectionHeader";
import { TaskRow } from "../components/TaskRow";
import { Button } from "../components/Button";
import { InlineEdit } from "../components/InlineEdit";
import { LONG_TITLE, TODAY, dateLabel } from "../mock/data";
import type { InvalidRow, Section, Task } from "../types/model";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { PageHeader, titleStyle } from "./HeaderActions";
import { SubtaskForm } from "./SubtaskForm";

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
};

const INVALID_TASK_NO = 2; // D-11c で要修正にする行 (洗剤の詰め替え)
const INVALID_SUFFIX = "    ⚠ 要修正: 「終了」列が日付ではありません (値: 来週)";
const noop = () => {};
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
}: ProjectViewProps) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(initialExpanded));
  const [formParent, setFormParent] = useState<number | undefined>(initialFormParent);
  const [formOpenedByClick, setFormOpenedByClick] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(sections.filter((s) => s.project === project && s.collapsed).map((s) => s.name)),
  );
  const [doneOverride, setDoneOverride] = useState<Map<number, boolean>>(() => new Map());
  const [showCompleted, setShowCompleted] = useState(false);
  const [addTo, setAddTo] = useState<{ section: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [renamingProject, setRenamingProject] = useState(false);

  const mine = tasks.filter((t) => t.project === project);
  const isDone = (t: Task) => (onToggleDone ? t.progress === 100 : (doneOverride.get(t.no) ?? t.progress === 100));
  const childrenOf = (no: number) => mine.filter((t) => t.parentNo === no).sort((a, b) => a.order - b.order);
  const toggleSet = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  const renderRow = (t: Task, indent: 0 | 1 | 2): React.ReactNode => {
    const kids = childrenOf(t.no);
    const open = expanded.has(t.no);
    const invalid = state === "invalid" && !invalidRows && t.no === INVALID_TASK_NO;
    const row = (
      <TaskRow
        title={invalid ? t.title + INVALID_SUFFIX : t.title}
        description={t.note}
        done={isDone(t)}
        priority={t.priority}
        date={dateLabel(t.due, today)}
        labels={t.labels}
        indent={indent}
        showActions={showActions}
        onClick={onOpenTask ? () => onOpenTask(t) : undefined}
        subtasks={kids.length ? { done: kids.filter(isDone).length, total: kids.length, expanded: open } : undefined}
        onToggleDone={() => (onToggleDone ? onToggleDone(t, !isDone(t)) : setDoneOverride((m) => new Map(m).set(t.no, !isDone(t))))}
        onMore={onDeleteTask ? () => setDeleteTarget((cur) => (cur === t.no ? null : t.no)) : undefined}
        onToggleExpand={() => setExpanded((s) => toggleSet(s, t.no))}
      />
    );
    return (
      <div key={t.no}>
        {invalid ? <div style={{ background: "var(--color-accent-soft)" }}>{row}</div> : row}
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
        {open && kids.map((k) => renderRow(k, Math.min(indent + 1, 2) as 1 | 2))}
        {open && indent === 0 && kids.length > 0 && (
          <div style={{ marginLeft: 32 }}>
            {formParent === t.no ? (
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
      </div>
    );
  };

  const topLevel = mine.filter((t) => t.parentNo === undefined).sort((a, b) => a.order - b.order);
  // 読み込み時点で未完了 / 完了済みの分類は固定し、チェックの見た目だけトグルする (行は動かない)
  const open = topLevel.filter((t) => t.progress !== 100);
  const completed = topLevel.filter((t) => t.progress === 100);
  const projectSections = sections.filter((s) => s.project === project).sort((a, b) => a.order - b.order);
  const sectionNames = new Set(projectSections.map((s) => s.name));
  const unsectioned = open.filter((t) => t.category === null || !sectionNames.has(t.category));

  /** セクション末尾 (未分類は section=null) の「タスクを追加」。onAddTask があればクリックでインライン入力に変わる。 */
  const addSlot = (section: string | null): React.ReactNode => {
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

  const body = (): React.ReactNode => {
    const liveEmpty = state !== "error" && !!onAddTask && mine.length === 0 && projectSections.length === 0 && !invalidRows?.length && !addTo;
    if (state === "empty" || liveEmpty) return <EmptyState onAdd={onAddTask ? () => setAddTo({ section: null }) : undefined} />;
    if (state === "error") {
      return <ErrorState fileName={`${project}.xlsx`} detail={errorDetail} onRetry={onRetryLoad} onReveal={onRevealFile ?? (onRetryLoad ? undefined : noop)} />;
    }
    return (
      <div>
        {showLongTitleRow && (
          <TaskRow title={LONG_TITLE} done={false} priority={4} showActions={showActions} />
        )}
        {invalidRows?.map((r) => (
          <div key={`invalid-${r.row}`} style={{ background: "var(--color-accent-soft)" }}>
            <TaskRow title={invalidRowTitle(r)} done={false} priority={4} hideActions />
          </div>
        ))}
        {unsectioned.map((t) => renderRow(t, 0))}
        {addSlot(null)}
        {projectSections.map((s) => {
          const rows = open.filter((t) => t.category === s.name);
          const isCollapsed = collapsed.has(s.name);
          return (
            <section key={s.name}>
              <SectionHeader
                title={s.name}
                count={rows.filter((t) => !isDone(t)).length}
                collapsed={isCollapsed}
                onToggle={() => setCollapsed((c) => toggleSet(c, s.name))}
                onRename={
                  onRenameSection
                    ? (newName) => {
                        // 折りたたみ状態は名前で持っているので新しい名前に引き継ぐ
                        setCollapsed((c) => (c.has(s.name) ? new Set([...c].filter((n) => n !== s.name).concat(newName)) : c));
                        onRenameSection(s.name, newName);
                      }
                    : undefined
                }
              />
              {!isCollapsed && (
                <>
                  {rows.map((t) => renderRow(t, 0))}
                  {addSlot(s.name)}
                </>
              )}
            </section>
          );
        })}
        {onAddSection &&
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
          ))}
        {showCompleted && completed.map((t) => renderRow(t, 0))}
        <button
          type="button"
          aria-pressed={showCompleted}
          onClick={() => setShowCompleted((v) => !v)}
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
      <PageHeader onMenu={menu}>
        {renamingProject && onRenameProject ? (
          <div style={{ flex: 1, minWidth: 0, maxWidth: 480, marginRight: "var(--space-4)" }}>
            <InlineEdit
              value={project}
              ariaLabel="プロジェクト名"
              style={{ fontSize: 24, lineHeight: "35px", fontWeight: 700, padding: "0 7px" }}
              onCommit={(name) => {
                setRenamingProject(false);
                if (name !== project) onRenameProject(name);
              }}
              onCancel={() => setRenamingProject(false)}
            />
          </div>
        ) : (
          <h1 style={titleStyle}>{project}</h1>
        )}
      </PageHeader>
      {body()}
    </>
  );
}
