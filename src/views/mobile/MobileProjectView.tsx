import type React from "react";
import { useState } from "react";
import { Check, Ellipsis } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { AddTaskRow } from "../../components/AddTaskRow";
import { SectionHeader } from "../../components/SectionHeader";
import { TaskRow } from "../../components/TaskRow";
import { MOBILE_ROW } from "../../components/MobileTaskRow";
import { Collapse } from "../../motion";
import { TODAY } from "../../mock/data";
import type { Placement, Section, Task } from "../../types/model";
import { useLeaving } from "../crossList";
import { useDone } from "../useDone";
import { visibleOpen } from "../visibleOpen";
import { mobileRowProps, type RowContext } from "./rowProps";
import { MobileQuickAddSheet } from "./MobileQuickAddSheet";
import { MobileShell } from "./MobileShell";
import { SwipeRow } from "./SwipeRow";
import { reorderAttrs, useMobileReorder } from "./useMobileReorder";
import type { MobileTab } from "../../app/mobileNav";
import type { QuickAddToken } from "../QuickAddDialog";

export type MobileProjectViewProps = {
  project: string;
  tasks: Task[];
  sections: Section[];
  /** 最初から展開しておく親タスクの no (M-01b)。 */
  initialExpanded?: number[];
  /** 最初から開いておく層 (M-02: quickAdd)。 */
  initialOverlay?: "none" | "quickAdd";
  quickAddTokens?: QuickAddToken[];
  /** スワイプ中の行のタイトル。pen は M-01 / M-02 が「食パン」、M-01b が「電池を買う」。 */
  swipeTitle?: string;
  /**
   * 実データで動かす (Phase 6): チェックは task.progress を見て onToggleDone を呼び、優先度の色は task.priority、
   * スワイプの見本は出さず、層 (クイック追加) は呼び出し側の `overlay` で出す。省略すると Story の見た目のまま。
   */
  live?: boolean;
  /** 実機用: 幅 100% / 高さ 100dvh、上下はセーフエリア (MobileShell の fill)。 */
  fill?: boolean;
  /** What a row shows beyond the task itself (inbox name, project colors, comment counts). */
  rowContext?: Omit<RowContext, "today">;
  /** 期限の表示の基準日。省略すると mock の TODAY。 */
  today?: string;
  /** ヘッダーに出す名前。省略すると project。 */
  title?: string;
  onToggleDone?: (t: Task, done: boolean) => void;
  onOpenTask?: (t: Task) => void;
  onFab?: () => void;
  /** The back arrow (a project opened from 閲覧). */
  onBack?: () => void;
  /** The 「…」 pill at the right of the top bar (project menu). Omitted: no pill. */
  onProjectMenu?: () => void;
  /** 下部タブの選択。省略すると「受信トレイ」。 */
  tab?: MobileTab;
  onTabChange?: (t: MobileTab) => void;
  /** 呼び出し側が持つ層。クイック追加の内部の状態の代わりに出す。 */
  overlay?: React.ReactNode;
  /** header の下に流す帯 (MobileShell の banner)。 */
  banner?: React.ReactNode;
  /** 一覧を引っ張って更新したとき (MobileShell の onRefresh)。 */
  onRefresh?: () => Promise<void>;
  /** 更新中の目印を強制して出す (Storybook 用)。 */
  refreshing?: boolean;
  /** タスクが 1 件もないときの文言 (live のみ)。 */
  emptyText?: string;
  /** live のみ: 左スワイプ (日付のシート) / 長押し (メニュー)。右スワイプは onToggleDone。どちらも省略すると行はスワイプしない。 */
  onSwipeDate?: (t: Task) => void;
  onTaskMenu?: (t: Task) => void;
  /** 「タスクを追加」 at the end of each section (null: the tasks without a section). Omitted: no such rows. */
  onAddTask?: (section: string | null) => void;
  /** 「サブタスクを追加」 under an expanded parent. Omitted: it opens the plain quick add (onFab). */
  onAddSubtask?: (parent: Task) => void;
  /** live のみ (spec 2026-11-22): 長押しで行を持ち上げて並び替える。動かさずに離すと onTaskMenu。省略すると長押しはメニューだけ。 */
  onReorder?: (no: number, to: Placement) => void;
};

const defaultTokens: QuickAddToken[] = [
  { text: "牛乳と卵を買う " },
  { text: "明日", kind: "date" },
  { text: "p1", kind: "priority" },
];

/** スワイプ中の行 (見た目だけ): 緑の完了パネルの上に、右へ 98 ずれた幅 260 の行。pen の SwipeDemo。 */
function SwipeDemo({ title }: { title: string }) {
  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderRadius: 6,
        background: "var(--color-success)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", padding: "10px 12px", color: "#FFFFFF" /* pen と同じ (緑上の白) */ }}>
        <Check size={16} />
        <span style={{ fontSize: 13, lineHeight: "19px", fontWeight: 600 }}>完了</span>
      </div>
      <div style={{ width: 260, background: "var(--color-bg)" }}>
        <TaskRow variant="mobile" title={title} done={false} priority={4} />
      </div>
    </div>
  );
}

/**
 * M-01 / M-01b / M-02: モバイルのプロジェクト画面。ヘッダー (同期中) + セクション付きの一覧 + SwipeDemo + FAB + 下部タブ。
 * 件数バッジのタップで子タスクを展開 / 折りたたみ。FAB でクイック追加シート (M-02)、scrim タップで閉じる。
 * 層が開いている間は FAB を出さない (pen の M-02)。pen のとおりチェックの色は全行 priority-4。
 */
export function MobileProjectView({
  project,
  tasks,
  sections,
  initialExpanded = [],
  initialOverlay = "none",
  quickAddTokens = defaultTokens,
  swipeTitle = "電池を買う",
  live,
  fill,
  rowContext,
  today = TODAY,
  title,
  onToggleDone,
  onOpenTask,
  onFab,
  onBack,
  onProjectMenu,
  tab = "inbox",
  onTabChange,
  overlay: externalOverlay,
  banner,
  onRefresh,
  refreshing,
  emptyText = "タスクはありません",
  onSwipeDate,
  onTaskMenu,
  onAddTask,
  onAddSubtask,
  onReorder,
}: MobileProjectViewProps) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(initialExpanded));
  const [overlay, setOverlay] = useState(initialOverlay);
  const local = useDone();
  const leave = useLeaving(tasks);
  const isDone = (t: Task) => (live ? t.progress === 100 || leave.isLeaving(t) : local.isDone(t));
  const toggle = (t: Task, group = "", index = 0) => {
    if (!live) return local.toggle(t);
    const next = !isDone(t);
    if (next) leave.begin(t, group, index);
    else leave.cancel(t);
    onToggleDone?.(t, next);
  };

  const mine = tasks.filter((t) => t.project === project);
  const childrenOf = (no: number) => mine.filter((t) => t.parentNo === no).sort((a, b) => a.order - b.order);
  const toggleExpand = (no: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(no)) next.delete(no);
      else next.add(no);
      return next;
    });

  const reorder = useMobileReorder({
    project,
    onMove: (no, to) => onReorder?.(no, to),
    onMenu: (no) => {
      const t = mine.find((x) => x.no === no);
      if (t) onTaskMenu?.(t);
    },
  });
  const reordering = live && onReorder !== undefined;
  const heightOf = (no: number): number => Math.max(0, ...childrenOf(no).map((c) => 1 + heightOf(c.no)));
  const subtreeOf = (no: number): number[] => [no, ...childrenOf(no).flatMap((c) => subtreeOf(c.no))];
  /** The lifted row follows the finger (its subtree inside it goes along). */
  const liftStyle = (t: Task): React.CSSProperties | undefined =>
    reorder.state?.no === t.no
      ? { position: "relative", zIndex: 3, transform: `translateY(${reorder.state.dy}px)`, background: "var(--color-bg)", boxShadow: "var(--shadow-popover)", borderRadius: 8 }
      : undefined;

  /** live のとき、行をスワイプ / 長押しのラッパーで包む。 */
  const swipeable = (t: Task, row: React.ReactNode, onComplete: () => void, depth = 0): React.ReactNode =>
    live && (onSwipeDate || onTaskMenu) ? (
      <SwipeRow
        key={t.no}
        onComplete={onComplete}
        done={isDone(t)}
        onDate={onSwipeDate && (() => onSwipeDate(t))}
        onLongPress={onTaskMenu && (() => onTaskMenu(t))}
        onLift={reordering ? (at) => reorder.lift(t.no, at, subtreeOf(t.no), heightOf(t.no), depth) : undefined}
      >
        {row}
      </SwipeRow>
    ) : (
      row
    );
  const taskAttrs = (t: Task, depth: number) => (reordering ? reorderAttrs({ kind: "task", no: t.no, depth, parent: t.parentNo ?? null, section: t.category }) : {});

  const renderRow = (t: Task, group = "", index = 0): React.ReactNode => {
    const kids = childrenOf(t.no);
    const open = expanded.has(t.no);
    const ctx: RowContext = { today, ...rowContext };
    const done = () => toggle(t, group, index);
    return (
      <div key={t.no} style={liftStyle(t)}>
        <div {...taskAttrs(t, 0)}>
        {swipeable(
          t,
          <TaskRow
            variant="mobile"
            {...mobileRowProps(t, ctx)}
            done={isDone(t)}
            subtasks={kids.length ? { done: kids.filter(isDone).length, total: kids.length, expanded: open } : undefined}
            onToggleDone={done}
            onClick={onOpenTask ? () => onOpenTask(t) : undefined}
            onToggleExpand={() => toggleExpand(t.no)}
          />,
          done,
        )}
        </div>
        {open && (
          <>
            {kids.map((k) => (
              <div key={k.no} {...taskAttrs(k, 1)} style={liftStyle(k)}>
                {swipeable(
                  k,
                  <TaskRow variant="mobile" indent={1} {...mobileRowProps(k, ctx)} done={isDone(k)} onToggleDone={() => toggle(k)} onClick={onOpenTask ? () => onOpenTask(k) : undefined} />,
                  () => toggle(k),
                  1,
                )}
              </div>
            ))}
            <div style={{ marginLeft: MOBILE_ROW.indent }}>
              <AddTaskRow label="サブタスクを追加" onClick={onAddSubtask ? () => onAddSubtask(t) : (onFab ?? (() => setOverlay("quickAdd")))} />
            </div>
          </>
        )}
      </div>
    );
  };
  /** One list: completed rows stay LEAVE_DELAY_MS, then leave in 0.1 s. */
  const list = (group: string, rows: Task[]) => {
    const items = (live ? leave.merge(group, rows) : rows).map((t, i) => {
      const el = renderRow(t, group, i);
      return live ? (
        <Collapse key={t.no} duration={0.1}>
          {el}
        </Collapse>
      ) : (
        el
      );
    });
    return live ? <AnimatePresence initial={false}>{items}</AnimatePresence> : items;
  };

  const open = mine.filter((t) => t.parentNo === undefined && t.progress !== 100);
  // サイドバーの件数と同じ (完了した親の下の行は数えない)。
  const openCount = visibleOpen(mine).length;
  const projectSections = sections.filter((s) => s.project === project).sort((a, b) => a.order - b.order);
  // どのセクションにも入っていないタスク (受信トレイなど) は、見出しなしで先頭に並べる
  const sectionNames = new Set(projectSections.map((s) => s.name));
  const unsectioned = open.filter((t) => t.category === null || !sectionNames.has(t.category)).sort((a, b) => a.order - b.order);

  return (
    <MobileShell
      banner={banner}
      onRefresh={onRefresh}
      refreshing={refreshing}
      fill={fill}
      title={title ?? project}
      subtitle={`${openCount} 件のタスク`}
      largeTitle
      onBack={onBack}
      actions={onProjectMenu ? [{ icon: Ellipsis, label: "その他", onClick: onProjectMenu }] : undefined}
      tab={tab}
      today={today}
      onTabChange={onTabChange}
      fab={externalOverlay !== undefined ? true : overlay === "none"}
      onFab={onFab ?? (() => setOverlay("quickAdd"))}
      overlay={
        externalOverlay !== undefined ? externalOverlay : (
        <AnimatePresence initial={false}>
          {overlay === "quickAdd" && <MobileQuickAddSheet key="quickAdd" tokens={quickAddTokens} onClose={() => setOverlay("none")} />}
        </AnimatePresence>
        )
      }
    >
      <div ref={reorder.list} style={{ position: "relative", padding: "0 15px" }}>
        {reorder.state?.line && (
          // Where the lifted row will land (the desktop's drop line, spec ③ §3.4)
          <div aria-hidden style={{ position: "absolute", zIndex: 4, top: reorder.state.line.y - 1, left: 15 + reorder.state.line.x, right: 15, height: 2, background: "var(--color-accent)", pointerEvents: "none" }} />
        )}
        {live && open.length === 0 && projectSections.length === 0 && (
          <div style={{ padding: "var(--space-6) 0", textAlign: "center", fontSize: 14, color: "var(--color-text-secondary)" }}>{emptyText}</div>
        )}
        {list("s:", unsectioned)}
        {/* With sections and no loose tasks, the FAB covers 「no section」 (no lone add row above the first section). */}
        {onAddTask && (unsectioned.length > 0 || projectSections.length === 0) && (
          <div {...(reordering ? reorderAttrs({ kind: "slot", section: null }) : {})}>
            <AddTaskRow onClick={() => onAddTask(null)} />
          </div>
        )}
        {projectSections.map((s, i) => {
          const rows = open.filter((t) => t.category === s.name).sort((a, b) => a.order - b.order);
          return (
            <section key={s.name}>
              <div {...(reordering ? reorderAttrs({ kind: "header", section: s.name }) : {})}>
                <SectionHeader mobile title={s.name} tight={i === 0 && unsectioned.length === 0} />
              </div>
              {list(`s:${s.name}`, rows)}
              {onAddTask && (
                <div {...(reordering ? reorderAttrs({ kind: "slot", section: s.name }) : {})}>
                  <AddTaskRow onClick={() => onAddTask(s.name)} />
                </div>
              )}
            </section>
          );
        })}
        {!live && <SwipeDemo title={swipeTitle} />}
      </div>
    </MobileShell>
  );
}
