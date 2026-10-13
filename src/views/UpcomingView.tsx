import { ChevronDown } from "lucide-react";
import { AddTaskRow } from "../components/AddTaskRow";
import { SectionHeader } from "../components/SectionHeader";
import { TaskRow } from "../components/TaskRow";
import { addDays, daysBetween, monthDay, weekdayLong } from "../mock/data";
import type { Task } from "../types/model";
import { PageHeader, titleStyle } from "./HeaderActions";
import { useDone } from "./useDone";
import { WeekStrip } from "./WeekStrip";

export type UpcomingViewProps = { tasks: Task[]; today: string };

function dayTitle(ymd: string, today: string): string {
  const diff = daysBetween(ymd, today);
  const rel = diff === 0 ? "今日" : diff === 1 ? "明日" : undefined;
  return [monthDay(ymd), rel, weekdayLong(ymd)].filter(Boolean).join(" · ");
}

/** MonthSelect + WeekStrip (今日から 7 日) + 日付グループ。タスクのない日も見出し + AddTaskRow を出す。 */
export function UpcomingView({ tasks, today }: UpcomingViewProps) {
  const { isDone, toggle } = useDone();
  const [y, m] = today.split("-");
  const open = tasks.filter((t) => t.parentNo === undefined && t.progress !== 100 && t.due !== undefined);
  // 見出しは pen に合わせて「今日 + 3 日」(10月13日〜16日) の 4 グループ
  const groups = Array.from({ length: 4 }, (_, i) => addDays(today, i));

  return (
    <>
      <PageHeader>
        <h1 style={titleStyle}>近日</h1>
        <button
          type="button"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-1)",
            padding: 0,
            border: 0,
            background: "none",
            fontFamily: "var(--font-body)",
            fontSize: 14,
            lineHeight: "20px",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            cursor: "pointer",
          }}
        >
          {`${y}年${Number(m)}月`}
          <span style={{ display: "inline-flex", color: "var(--color-text-secondary)" }}>
            <ChevronDown size={14} />
          </span>
        </button>
      </PageHeader>
      <WeekStrip start={today} today={today} />
      <div>
        {groups.map((ymd) => {
          const rows = open.filter((t) => t.due === ymd).sort((a, b) => a.no - b.no);
          return (
            <section key={ymd}>
              <SectionHeader title={dayTitle(ymd, today)} showChevron={false} />
              {rows.map((t) => (
                <TaskRow
                  key={t.no}
                  title={t.title}
                  done={isDone(t)}
                  priority={t.priority}
                  project={t.project}
                  onToggleDone={() => toggle(t)}
                />
              ))}
              <AddTaskRow />
            </section>
          );
        })}
      </div>
    </>
  );
}
