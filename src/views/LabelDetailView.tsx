import { TODAY, dateLabel } from "../mock/data";
import type { Task } from "../types/model";
import { AddSlot, HiddenNote, useCrossRows } from "./crossList";
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
};

/** ラベルが付いたタスクを全プロジェクト横断で並べる。 */
export function LabelDetailView({ label, tasks, today, onToggleDone, onOpenTask, onAddTask, hiddenProjects, focusedKey, onVisibleKeys }: LabelDetailViewProps) {
  const list = onToggleDone
    ? tasks
    : tasks.filter((t) => t.parentNo === undefined && t.progress !== 100 && t.labels.includes(label)).sort((a, b) => a.no - b.no);
  const rows = useCrossRows({ tasks, onToggleDone, onOpenTask, date: (t) => dateLabel(t.due, today ?? TODAY), focusedKey, onVisibleKeys, dragView: "label" });

  return (
    <>
      <PageHeader>
        <TitleGroup title={`@${label}`} subtitle={`${list.length} 件のタスク`} />
      </PageHeader>
      <HiddenNote names={hiddenProjects} />
      <div>
        {rows("label", list)}
        <AddSlot label="タスクを追加" defaults={{ labels: [label] }} onAdd={onAddTask} />
      </div>
    </>
  );
}
