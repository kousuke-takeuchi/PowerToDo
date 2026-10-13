import { AddTaskRow } from "../components/AddTaskRow";
import { TaskRow } from "../components/TaskRow";
import { TODAY, dateLabel } from "../mock/data";
import type { Task } from "../types/model";
import { PageHeader, TitleGroup } from "./HeaderActions";
import { useDone } from "./useDone";

export type LabelDetailViewProps = { label: string; tasks: Task[] };

/** ラベルが付いたタスクを全プロジェクト横断で並べる。 */
export function LabelDetailView({ label, tasks }: LabelDetailViewProps) {
  const { isDone, toggle } = useDone();
  const rows = tasks.filter((t) => t.parentNo === undefined && t.progress !== 100 && t.labels.includes(label)).sort((a, b) => a.no - b.no);
  return (
    <>
      <PageHeader>
        <TitleGroup title={`@${label}`} subtitle={`${rows.length} 件 · 全プロジェクト`} />
      </PageHeader>
      <div>
        {rows.map((t) => (
          <TaskRow
            key={t.no}
            title={t.title}
            done={isDone(t)}
            priority={t.priority}
            date={dateLabel(t.due, TODAY)}
            project={t.project}
            onToggleDone={() => toggle(t)}
          />
        ))}
        <AddTaskRow label="タスクを追加" />
      </div>
    </>
  );
}
