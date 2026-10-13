import { MobileHeader } from "../../components/MobileHeader";
import { SectionHeader } from "../../components/SectionHeader";
import { TaskRow } from "../../components/TaskRow";
import { dateLabel, monthDay, weekdayLong } from "../../mock/data";
import type { Task } from "../../types/model";
import { useDone } from "../useDone";
import { MobileShell } from "./MobileShell";

export type MobileTodayProps = { overdue: Task[]; todays: Task[]; today: string };

/** M-04: 今日 (ヘッダーに同期アイコンなし)。期限切れ (再スケジュール付き) + 今日。pen のとおりチェックの色は全行 priority-4。 */
export function MobileToday({ overdue, todays, today }: MobileTodayProps) {
  const { isDone, toggle } = useDone();
  const row = (t: Task, showDate: boolean) => (
    <TaskRow
      key={t.no}
      variant="mobile"
      title={t.title}
      done={isDone(t)}
      priority={4}
      date={showDate ? dateLabel(t.due, today) : undefined}
      onToggleDone={() => toggle(t)}
    />
  );
  return (
    <MobileShell header={<MobileHeader title="今日" />} tab="today" fab>
      <div style={{ padding: "0 16px" }}>
        <div style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-secondary)" }}>
          {`${monthDay(today)} ${weekdayLong(today)} · ${overdue.length + todays.length} 件`}
        </div>
        <section>
          <SectionHeader title="期限切れ" count={overdue.length} />
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
          {overdue.map((t) => row(t, true))}
        </section>
        <section>
          <SectionHeader title="今日" count={todays.length} />
          {todays.map((t) => row(t, false))}
        </section>
      </div>
    </MobileShell>
  );
}
