import type React from "react";
import { useState } from "react";
import { Check } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { AddTaskRow } from "../../components/AddTaskRow";
import { MobileHeader } from "../../components/MobileHeader";
import { SectionHeader } from "../../components/SectionHeader";
import { TaskRow } from "../../components/TaskRow";
import { Collapse } from "../../motion";
import { TODAY, counts as mockCounts, dateLabel, projects as mockProjects } from "../../mock/data";
import type { SyncState } from "../../components/SyncStatus";
import type { Project, Section, Task } from "../../types/model";
import { useDone } from "../useDone";
import { Drawer } from "./Drawer";
import { MobileQuickAddSheet } from "./MobileQuickAddSheet";
import { MobileShell } from "./MobileShell";
import { SwipeRow } from "./SwipeRow";
import type { TabBarProps } from "../../components/TabBar";
import type { QuickAddToken } from "../QuickAddDialog";

export type MobileProjectViewProps = {
  project: string;
  tasks: Task[];
  sections: Section[];
  /** 最初から展開しておく親タスクの no (M-01b)。 */
  initialExpanded?: number[];
  /** 最初から開いておく層 (M-02: quickAdd / M-06: drawer)。 */
  initialOverlay?: "none" | "quickAdd" | "drawer";
  projects?: Project[];
  quickAddTokens?: QuickAddToken[];
  /** スワイプ中の行のタイトル。pen は M-01 / M-02 / M-06 が「食パン」、M-01b が「電池を買う」。 */
  swipeTitle?: string;
  /**
   * 実データで動かす (Phase 6): チェックは task.progress を見て onToggleDone を呼び、優先度の色は task.priority、
   * スワイプの見本は出さず、層 (ドロワー / クイック追加) は呼び出し側の `overlay` で出す。省略すると Story の見た目のまま。
   */
  live?: boolean;
  /** 実機用: 幅 100% / 高さ 100dvh、上下はセーフエリア (MobileShell の fill)。 */
  fill?: boolean;
  /** 期限の表示の基準日。省略すると mock の TODAY。 */
  today?: string;
  /** ヘッダーに出す名前。省略すると project。 */
  title?: string;
  /** ヘッダーの同期アイコン。省略すると同期中 (絵)。 */
  sync?: SyncState;
  onToggleDone?: (t: Task, done: boolean) => void;
  onOpenTask?: (t: Task) => void;
  onFab?: () => void;
  onMenu?: () => void;
  /** 下部タブの選択。省略すると「一覧」。 */
  tab?: TabBarProps["active"];
  onTabChange?: TabBarProps["onChange"];
  /** 呼び出し側が持つ層。ドロワー / クイック追加の内部の状態の代わりに出す。 */
  overlay?: React.ReactNode;
  /** header の下に流す帯 (MobileShell の banner)。 */
  banner?: React.ReactNode;
  /** タスクが 1 件もないときの文言 (live のみ)。 */
  emptyText?: string;
  /** live のみ: 左スワイプ (日付のシート) / 長押し (メニュー)。右スワイプは onToggleDone。どちらも省略すると行はスワイプしない。 */
  onSwipeDate?: (t: Task) => void;
  onTaskMenu?: (t: Task) => void;
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
 * M-01 / M-01b / M-02 / M-06: モバイルのプロジェクト画面。ヘッダー (同期中) + セクション付きの一覧 + SwipeDemo + FAB + 下部タブ (一覧)。
 * 件数バッジのタップで子タスクを展開 / 折りたたみ。FAB でクイック追加シート (M-02)、ハンバーガーでドロワー (M-06) を開き、scrim タップで閉じる。
 * 層が開いている間は FAB を出さない (pen の M-02 / M-06)。pen のとおりチェックの色は全行 priority-4。
 */
export function MobileProjectView({
  project,
  tasks,
  sections,
  initialExpanded = [],
  initialOverlay = "none",
  projects = mockProjects,
  quickAddTokens = defaultTokens,
  swipeTitle = "電池を買う",
  live,
  fill,
  today = TODAY,
  title,
  sync = "syncing",
  onToggleDone,
  onOpenTask,
  onFab,
  onMenu,
  tab = "list",
  onTabChange,
  overlay: externalOverlay,
  banner,
  emptyText = "タスクはありません",
  onSwipeDate,
  onTaskMenu,
}: MobileProjectViewProps) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(initialExpanded));
  const [overlay, setOverlay] = useState(initialOverlay);
  const local = useDone();
  const isDone = (t: Task) => (live ? t.progress === 100 : local.isDone(t));
  const toggle = (t: Task) => (live ? onToggleDone?.(t, !isDone(t)) : local.toggle(t));
  const priorityOf = (t: Task) => (live ? t.priority : 4);

  const mine = tasks.filter((t) => t.project === project);
  const childrenOf = (no: number) => mine.filter((t) => t.parentNo === no).sort((a, b) => a.order - b.order);
  const toggleExpand = (no: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(no)) next.delete(no);
      else next.add(no);
      return next;
    });

  /** live のとき、行をスワイプ / 長押しのラッパーで包む。 */
  const swipeable = (t: Task, row: React.ReactNode): React.ReactNode =>
    live && (onSwipeDate || onTaskMenu) ? (
      <SwipeRow key={t.no} onComplete={() => toggle(t)} onDate={onSwipeDate && (() => onSwipeDate(t))} onLongPress={onTaskMenu && (() => onTaskMenu(t))}>
        {row}
      </SwipeRow>
    ) : (
      row
    );

  const renderRow = (t: Task): React.ReactNode => {
    const kids = childrenOf(t.no);
    const open = expanded.has(t.no);
    return (
      <div key={t.no}>
        {swipeable(t, <TaskRow
          variant="mobile"
          title={t.title}
          done={isDone(t)}
          priority={priorityOf(t)}
          date={dateLabel(t.due, today)}
          subtasks={kids.length ? { done: kids.filter(isDone).length, total: kids.length, expanded: open } : undefined}
          onToggleDone={() => toggle(t)}
          onClick={onOpenTask ? () => onOpenTask(t) : undefined}
          onToggleExpand={() => toggleExpand(t.no)}
        />)}
        <AnimatePresence initial={false}>
          {open && (
            <Collapse key="subtasks">
              {kids.map((k) => (
                swipeable(k, <TaskRow key={k.no} variant="mobile" indent={1} title={k.title} done={isDone(k)} priority={priorityOf(k)} onToggleDone={() => toggle(k)} onClick={onOpenTask ? () => onOpenTask(k) : undefined} />)
              ))}
              <div style={{ marginLeft: 24 }}>
                <AddTaskRow label="サブタスクを追加" onClick={onFab ?? (() => setOverlay("quickAdd"))} />
              </div>
            </Collapse>
          )}
        </AnimatePresence>
      </div>
    );
  };

  const open = mine.filter((t) => t.parentNo === undefined && t.progress !== 100);
  const projectSections = sections.filter((s) => s.project === project).sort((a, b) => a.order - b.order);
  // どのセクションにも入っていないタスク (受信トレイなど) は、見出しなしで先頭に並べる
  const sectionNames = new Set(projectSections.map((s) => s.name));
  const unsectioned = open.filter((t) => t.category === null || !sectionNames.has(t.category)).sort((a, b) => a.order - b.order);

  return (
    <MobileShell
      banner={banner}
      fill={fill}
      header={<MobileHeader title={title ?? project} safeArea={fill} sync={sync} onMenu={onMenu ?? (() => setOverlay("drawer"))} />}
      tab={tab}
      onTabChange={onTabChange}
      fab={externalOverlay !== undefined ? true : overlay === "none"}
      onFab={onFab ?? (() => setOverlay("quickAdd"))}
      overlay={
        externalOverlay !== undefined ? externalOverlay : (
        <AnimatePresence initial={false}>
          {overlay === "quickAdd" && <MobileQuickAddSheet key="quickAdd" tokens={quickAddTokens} onClose={() => setOverlay("none")} />}
          {overlay === "drawer" && <Drawer key="drawer" counts={mockCounts} projects={projects} syncState="syncing" onClose={() => setOverlay("none")} />}
        </AnimatePresence>
        )
      }
    >
      <div style={{ padding: "0 16px" }}>
        {unsectioned.map(renderRow)}
        {projectSections.map((s) => {
          const rows = open.filter((t) => t.category === s.name).sort((a, b) => a.order - b.order);
          return (
            <section key={s.name}>
              <SectionHeader title={s.name} count={rows.length} />
              {rows.map(renderRow)}
            </section>
          );
        })}
        {live && open.length === 0 && (
          <div style={{ padding: "var(--space-6) 0", textAlign: "center", fontSize: 14, color: "var(--color-text-secondary)" }}>{emptyText}</div>
        )}
        {!live && <SwipeDemo title={swipeTitle} />}
      </div>
    </MobileShell>
  );
}
