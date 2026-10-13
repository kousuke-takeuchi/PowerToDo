import type React from "react";
import { useState } from "react";
import { Check } from "lucide-react";
import { AddTaskRow } from "../../components/AddTaskRow";
import { MobileHeader } from "../../components/MobileHeader";
import { SectionHeader } from "../../components/SectionHeader";
import { TaskRow } from "../../components/TaskRow";
import { counts as mockCounts, dateLabel, projects as mockProjects } from "../../mock/data";
import type { Project, Section, Task } from "../../types/model";
import { useDone } from "../useDone";
import { Drawer } from "./Drawer";
import { MobileQuickAddSheet } from "./MobileQuickAddSheet";
import { MobileShell } from "./MobileShell";
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
  /** ヘッダの同期アイコン (回転)。pen の M-02 / M-06 には無い。 */
  showSync?: boolean;
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
  showSync = true,
}: MobileProjectViewProps) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(initialExpanded));
  const [overlay, setOverlay] = useState(initialOverlay);
  const { isDone, toggle } = useDone();

  const mine = tasks.filter((t) => t.project === project);
  const childrenOf = (no: number) => mine.filter((t) => t.parentNo === no).sort((a, b) => a.order - b.order);
  const toggleExpand = (no: number) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(no)) next.delete(no);
      else next.add(no);
      return next;
    });

  const renderRow = (t: Task): React.ReactNode => {
    const kids = childrenOf(t.no);
    const open = expanded.has(t.no);
    return (
      <div key={t.no}>
        <TaskRow
          variant="mobile"
          title={t.title}
          done={isDone(t)}
          priority={4}
          date={dateLabel(t.due)}
          subtasks={kids.length ? { done: kids.filter(isDone).length, total: kids.length, expanded: open } : undefined}
          onToggleDone={() => toggle(t)}
          onToggleExpand={() => toggleExpand(t.no)}
        />
        {open && (
          <>
            {kids.map((k) => (
              <TaskRow key={k.no} variant="mobile" indent={1} title={k.title} done={isDone(k)} priority={4} onToggleDone={() => toggle(k)} />
            ))}
            <div style={{ marginLeft: 24 }}>
              <AddTaskRow label="サブタスクを追加" onClick={() => setOverlay("quickAdd")} />
            </div>
          </>
        )}
      </div>
    );
  };

  const open = mine.filter((t) => t.parentNo === undefined && t.progress !== 100);
  const projectSections = sections.filter((s) => s.project === project).sort((a, b) => a.order - b.order);

  return (
    <MobileShell
      header={<MobileHeader title={project} sync={showSync ? "syncing" : "synced"} onMenu={() => setOverlay("drawer")} />}
      tab="list"
      fab={overlay === "none"}
      onFab={() => setOverlay("quickAdd")}
      overlay={
        overlay === "quickAdd" ? (
          <MobileQuickAddSheet tokens={quickAddTokens} onClose={() => setOverlay("none")} />
        ) : overlay === "drawer" ? (
          <Drawer counts={mockCounts} projects={projects} syncState="syncing" onClose={() => setOverlay("none")} />
        ) : undefined
      }
    >
      <div style={{ padding: "0 16px" }}>
        {projectSections.map((s) => {
          const rows = open.filter((t) => t.category === s.name).sort((a, b) => a.order - b.order);
          return (
            <section key={s.name}>
              <SectionHeader title={s.name} count={rows.length} />
              {rows.map(renderRow)}
            </section>
          );
        })}
        <SwipeDemo title={swipeTitle} />
      </div>
    </MobileShell>
  );
}
