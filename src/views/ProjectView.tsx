import type React from "react";
import { useState } from "react";
import { ArrowUpDown, Ellipsis, LayoutList } from "lucide-react";
import { AddTaskRow } from "../components/AddTaskRow";
import { SectionHeader } from "../components/SectionHeader";
import { TaskRow } from "../components/TaskRow";
import { LONG_TITLE, dateLabel } from "../mock/data";
import type { Section, Task } from "../types/model";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
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
};

const INVALID_TASK_NO = 2; // D-11c で要修正にする行 (洗剤の詰め替え)
const INVALID_SUFFIX = "    ⚠ 要修正: 「終了」列が日付ではありません (値: 来週)";
const FORM_SAMPLE_TITLE = "食パンの代わりにベーグル"; // D-01c の入力例 (Story で最初から開いているときだけ入れる)

const smallButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  padding: "4px 8px",
  border: 0,
  borderRadius: 6,
  fontFamily: "var(--font-body)",
  fontSize: 13,
  lineHeight: "19px",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

function HeaderAction({ icon: Icon, label }: { icon: React.ComponentType<{ size?: number }>; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label ?? "その他"}
      className="bg-transparent hover:bg-[var(--color-bg-hover)]"
      style={smallButton}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

export function ProjectView({
  project,
  tasks,
  sections,
  initialExpanded = [],
  initialFormParent,
  showLongTitleRow,
  state = "normal",
  showActions,
}: ProjectViewProps) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(initialExpanded));
  const [formParent, setFormParent] = useState<number | undefined>(initialFormParent);
  const [formOpenedByClick, setFormOpenedByClick] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(sections.filter((s) => s.project === project && s.collapsed).map((s) => s.name)),
  );
  const [doneOverride, setDoneOverride] = useState<Map<number, boolean>>(() => new Map());
  const [showCompleted, setShowCompleted] = useState(false);

  const mine = tasks.filter((t) => t.project === project);
  const isDone = (t: Task) => doneOverride.get(t.no) ?? t.progress === 100;
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
    const invalid = state === "invalid" && t.no === INVALID_TASK_NO;
    const row = (
      <TaskRow
        title={invalid ? t.title + INVALID_SUFFIX : t.title}
        description={t.note}
        done={isDone(t)}
        priority={t.priority}
        date={dateLabel(t.due)}
        labels={t.labels}
        indent={indent}
        showActions={showActions}
        subtasks={kids.length ? { done: kids.filter(isDone).length, total: kids.length, expanded: open } : undefined}
        onToggleDone={() => setDoneOverride((m) => new Map(m).set(t.no, !isDone(t)))}
        onToggleExpand={() => setExpanded((s) => toggleSet(s, t.no))}
      />
    );
    return (
      <div key={t.no}>
        {invalid ? <div style={{ background: "var(--color-accent-soft)" }}>{row}</div> : row}
        {open && kids.map((k) => renderRow(k, Math.min(indent + 1, 2) as 1 | 2))}
        {open && indent === 0 && kids.length > 0 && (
          <div style={{ marginLeft: 32 }}>
            {formParent === t.no ? (
              <SubtaskForm
                defaultTitle={formOpenedByClick ? "" : FORM_SAMPLE_TITLE}
                autoFocus={formOpenedByClick}
                onCancel={() => setFormParent(undefined)}
                onSubmit={() => setFormParent(undefined)}
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

  const body = (): React.ReactNode => {
    if (state === "empty") return <EmptyState />;
    if (state === "error") return <ErrorState fileName={`${project}.xlsx`} />;
    return (
      <div>
        {showLongTitleRow && (
          <TaskRow title={LONG_TITLE} done={false} priority={4} showActions={showActions} />
        )}
        {unsectioned.map((t) => renderRow(t, 0))}
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
              />
              {!isCollapsed && (
                <>
                  {rows.map((t) => renderRow(t, 0))}
                  <AddTaskRow />
                </>
              )}
            </section>
          );
        })}
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

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "var(--font-body)" }}>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: "35px", fontWeight: 700, color: "var(--color-text-primary)" }}>{project}</h1>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-1)" }}>
          <HeaderAction icon={LayoutList} label="表示" />
          <HeaderAction icon={ArrowUpDown} label="並び替え" />
          <HeaderAction icon={Ellipsis} />
        </div>
      </div>
      {body()}
    </>
  );
}
