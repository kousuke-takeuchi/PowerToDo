import { AnimatePresence } from "motion/react";
import { TaskRow } from "../components/TaskRow";
import { TODAY, dateLabel } from "../mock/data";
import { Collapse } from "../motion";
import type { Task } from "../types/model";
import { AddSlot, HiddenNote, taskKey, useLeaving } from "./crossList";
import { PageHeader, TitleGroup } from "./HeaderActions";
import { useDone } from "./useDone";

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
  focusedKey?: string;
};

/** ラベルが付いたタスクを全プロジェクト横断で並べる。 */
export function LabelDetailView({ label, tasks, today, onToggleDone, onOpenTask, onAddTask, hiddenProjects }: LabelDetailViewProps) {
  const { isDone: fakeDone, toggle: fakeToggle } = useDone();
  const leave = useLeaving();
  const list = onToggleDone
    ? tasks
    : tasks.filter((t) => t.parentNo === undefined && t.progress !== 100 && t.labels.includes(label)).sort((a, b) => a.no - b.no);
  const rows = onToggleDone ? leave.merge("label", list) : list;

  const isDone = (t: Task) => (onToggleDone ? t.progress === 100 || leave.isLeaving(t) : fakeDone(t));
  const toggle = (t: Task, index: number) => {
    if (!onToggleDone) {
      fakeToggle(t);
      return;
    }
    const next = !isDone(t);
    if (next) leave.begin(t, "label", index);
    else leave.cancel(t);
    onToggleDone(t, next);
  };
  const items = rows.map((t, index) => {
    const el = (
      <TaskRow
        key={onToggleDone ? taskKey(t) : t.no}
        title={t.title}
        done={isDone(t)}
        priority={t.priority}
        date={dateLabel(t.due, today ?? TODAY)}
        project={t.project}
        onClick={onOpenTask ? () => onOpenTask(t) : undefined}
        onToggleDone={() => toggle(t, index)}
      />
    );
    return onToggleDone ? (
      <Collapse key={taskKey(t)} enterY={-8} exitX={-24}>
        {el}
      </Collapse>
    ) : (
      el
    );
  });

  return (
    <>
      <PageHeader>
        <TitleGroup title={`@${label}`} subtitle={`${list.length} 件 · 全プロジェクト`} />
      </PageHeader>
      <HiddenNote names={hiddenProjects} />
      <div>
        {onToggleDone ? <AnimatePresence initial={false}>{items}</AnimatePresence> : items}
        <AddSlot label="タスクを追加" onAdd={onAddTask} />
      </div>
    </>
  );
}
