import { useState } from "react";
import { AddTaskRow } from "../components/AddTaskRow";
import { SectionHeader } from "../components/SectionHeader";
import { TaskRow } from "../components/TaskRow";
import { dateLabel, monthDay, weekdayLong } from "../mock/data";
import type { Task } from "../types/model";
import { PageHeader, TitleGroup } from "./HeaderActions";
import { useDone } from "./useDone";

export type TodayViewProps = { tasks: Task[]; today: string; hideOverdue?: boolean };

/** 期限切れグループ (再スケジュール付き) + 今日。期限切れを出さないときは見出しなしで今日の行だけ並べる。 */
export function TodayView({ tasks, today, hideOverdue }: TodayViewProps) {
  const [overdueCollapsed, setOverdueCollapsed] = useState(false);
  const { isDone, toggle } = useDone();

  const open = tasks.filter((t) => t.parentNo === undefined && t.progress !== 100 && t.due !== undefined);
  const overdue = open.filter((t) => t.due! < today).sort((a, b) => (a.due! === b.due! ? a.no - b.no : a.due! < b.due! ? -1 : 1));
  const todays = open.filter((t) => t.due === today).sort((a, b) => a.no - b.no);
  const showOverdue = !hideOverdue && overdue.length > 0;
  const total = (showOverdue ? overdue.length : 0) + todays.length;

  const row = (t: Task) => (
    <TaskRow
      key={t.no}
      title={t.title}
      done={isDone(t)}
      priority={t.priority}
      date={dateLabel(t.due, today)}
      project={t.project}
      onToggleDone={() => toggle(t)}
    />
  );

  return (
    <>
      <PageHeader>
        <TitleGroup title="今日" subtitle={`${monthDay(today)} ${weekdayLong(today)} · ${total} 件`} />
      </PageHeader>
      <div>
        {showOverdue && (
          <section>
            <SectionHeader
              title="期限切れ"
              count={overdue.length}
              collapsed={overdueCollapsed}
              onToggle={() => setOverdueCollapsed((v) => !v)}
            />
            {!overdueCollapsed && (
              <>
                <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 0" }}>
                  <button
                    type="button"
                    style={{
                      padding: 0,
                      border: 0,
                      background: "none",
                      fontFamily: "var(--font-body)",
                      fontSize: 13,
                      lineHeight: "19px",
                      fontWeight: 600,
                      color: "var(--color-accent)",
                      cursor: "pointer",
                    }}
                  >
                    再スケジュール
                  </button>
                </div>
                {overdue.map(row)}
              </>
            )}
          </section>
        )}
        <section>
          {showOverdue && <SectionHeader title={`今日 · ${monthDay(today)}`} count={todays.length} showChevron={false} />}
          {todays.map(row)}
          <AddTaskRow />
        </section>
      </div>
    </>
  );
}
