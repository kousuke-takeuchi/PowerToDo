import { MobileHeader } from "../../components/MobileHeader";
import { SectionHeader } from "../../components/SectionHeader";
import { TaskRow } from "../../components/TaskRow";
import { daysBetween, monthDay, weekdayLong } from "../../mock/data";
import type { Task } from "../../types/model";
import { useDone } from "../useDone";
import { WeekStrip } from "../WeekStrip";
import { MobileShell } from "./MobileShell";

/** 見出し: 今日 / 明日は「10月13日 · 今日」、それ以外は「10月16日 · 金曜日」 (pen の M-05)。 */
function dayTitle(ymd: string, today: string): string {
  const diff = daysBetween(ymd, today);
  return `${monthDay(ymd)} · ${diff === 0 ? "今日" : diff === 1 ? "明日" : weekdayLong(ymd)}`;
}

export type MobileUpcomingProps = { tasks: Task[]; today: string };

/** M-05: 近日。WeekStrip (今日から 7 日、タップで選択) + タスクのある日だけの日付グループ。行は日付チップなし (見出しが日付)。 */
export function MobileUpcoming({ tasks, today }: MobileUpcomingProps) {
  const { isDone, toggle } = useDone();
  const days = [...new Set(tasks.map((t) => t.due).filter((d): d is string => d !== undefined && d >= today))].sort();
  return (
    <MobileShell header={<MobileHeader title="近日" />} tab="upcoming" fab>
      <div style={{ padding: "0 16px" }}>
        <WeekStrip variant="mobile" start={today} today={today} />
        {days.map((ymd) => (
          <section key={ymd}>
            <SectionHeader title={dayTitle(ymd, today)} showChevron={false} />
            {tasks
              .filter((t) => t.due === ymd)
              .sort((a, b) => a.no - b.no)
              .map((t) => (
                <TaskRow key={t.no} variant="mobile" title={t.title} done={isDone(t)} priority={4} onToggleDone={() => toggle(t)} />
              ))}
          </section>
        ))}
      </div>
    </MobileShell>
  );
}
