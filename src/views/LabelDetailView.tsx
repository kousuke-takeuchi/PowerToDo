import { TODAY, dateLabel } from "../mock/data";
import { useState } from "react";
import type { Task } from "../types/model";
import { useView } from "../app/view/ViewOptionsContext";
import { arrangeFlat, firstOccurrences } from "../app/view/arrange";
import { SectionHeader } from "../components/SectionHeader";
import { AddSlot, FilterNote, HiddenNote, dupKeysOf, useCrossRows } from "./crossList";
import { PageHeader, TitleGroup } from "./HeaderActions";

export type LabelDetailViewProps = {
  label: string;
  tasks: Task[];
  /** 期限ラベルの基準日 YYYY-MM-DD。既定は Storybook の固定日 (TODAY)。 */
  today?: string;
  // ---- 実アプリ用 (全部 optional。無ければ Storybook と同じ見た目だけの挙動) ----
  /** 渡すとチェックはこれを呼び、tasks は絞らずそのまま並べる (Rust の label_view が絞り込み済み)。 */
  onToggleDone?: (t: Task, done: boolean) => void;
  onOpenTask?: (t: Task) => void;
  /** 受信トレイにこのラベルを付けて追加する。 */
  onAddTask?: (title: string) => void;
  hiddenProjects?: string[];
  /** 行フォーカス (Task 8)。 */
  focusedKey?: string;
  /** 表示している行のキー (`project/no`) を表示順に知らせる。変わったときだけ呼ぶ。 */
  onVisibleKeys?: (keys: string[]) => void;
  /** 「表示」の並べ替え・グループ・フィルターに使う (Main が渡す)。 */
  weekStart?: "mon" | "sun";
  labelOrder?: string[];
  projectOrder?: string[];
};

/** ラベルが付いたタスクを全プロジェクト横断で並べる。 */
export function LabelDetailView({ label, tasks, today, onToggleDone, onOpenTask, onAddTask, hiddenProjects, focusedKey, onVisibleKeys, weekStart = "mon", labelOrder = [], projectOrder = [] }: LabelDetailViewProps) {
  const [view, setView] = useView("label", label);
  const list = onToggleDone
    ? tasks
    : tasks.filter((t) => t.parentNo === undefined && t.progress !== 100 && t.labels.includes(label)).sort((a, b) => a.no - b.no);
  // 表示の設定 (spec ⑤)。label_view は未完了のタスクだけを返すので、完了の表示は無い (ALLOWED.label.done)。
  const arranged = arrangeFlat(list, view, { today: today ?? TODAY, weekStart, labelOrder, projectOrder });
  const grouped = view.group !== "none";
  const firstKeys = firstOccurrences(arranged.groups);
  const [groupCollapsed, setGroupCollapsed] = useState<Set<string>>(() => new Set());
  const rows = useCrossRows({ tasks, onToggleDone, onOpenTask, date: (t) => dateLabel(t.due, today ?? TODAY), focusedKey, onVisibleKeys, dragView: "label" });

  return (
    <>
      <PageHeader view={{ screen: "label", options: view, onChange: setView }}>
        <TitleGroup title={`@${label}`} subtitle={`${list.length} 件のタスク`} />
      </PageHeader>
      <HiddenNote names={hiddenProjects} />
      <FilterNote count={arranged.hidden} />
      <div>
        {grouped
          ? arranged.groups.map((g) => (
              <section key={g.key}>
                <SectionHeader
                  title={g.title}
                  count={g.rows.length}
                  collapsed={groupCollapsed.has(g.key)}
                  onToggle={() =>
                    setGroupCollapsed((c) => {
                      const n = new Set(c);
                      if (!n.delete(g.key)) n.add(g.key);
                      return n;
                    })
                  }
                />
                {!groupCollapsed.has(g.key) && rows(g.key, g.rows.map((r) => r.task), dupKeysOf(g, firstKeys))}
              </section>
            ))
          : rows("label", (arranged.groups[0]?.rows ?? []).map((r) => r.task))}
        <AddSlot label="タスクを追加" defaults={{ labels: [label] }} onAdd={onAddTask} />
      </div>
    </>
  );
}
