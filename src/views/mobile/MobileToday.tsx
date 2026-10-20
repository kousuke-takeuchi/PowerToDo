import type React from "react";
import { MobileHeader } from "../../components/MobileHeader";
import { SectionHeader } from "../../components/SectionHeader";
import { TaskRow } from "../../components/TaskRow";
import { dateLabel, monthDay, weekdayLong } from "../../mock/data";
import type { SyncState } from "../../components/SyncStatus";
import type { TabBarProps } from "../../components/TabBar";
import type { Task } from "../../types/model";
import { useDone } from "../useDone";
import { MobileShell } from "./MobileShell";

export type MobileTodayProps = {
  overdue: Task[];
  todays: Task[];
  today: string;
  /** 実データで動かす: チェックは task.progress を見て onToggleDone を呼び、優先度の色は task.priority。省略すると Story の見た目のまま。 */
  live?: boolean;
  /** 実機用: 幅 100% / 高さ 100dvh、上下はセーフエリア。 */
  fill?: boolean;
  sync?: SyncState;
  onToggleDone?: (t: Task, done: boolean) => void;
  onOpenTask?: (t: Task) => void;
  onFab?: () => void;
  onMenu?: () => void;
  /** 「再スケジュール」(期限切れをまとめて動かす)。 */
  onReschedule?: () => void;
  onTabChange?: TabBarProps["onChange"];
  overlay?: React.ReactNode;
};

/** M-04: 今日 (ヘッダーに同期アイコンなし)。期限切れ (再スケジュール付き) + 今日。pen のとおりチェックの色は全行 priority-4。 */
export function MobileToday({ overdue, todays, today, live, fill, sync, onToggleDone, onOpenTask, onFab, onMenu, onReschedule, onTabChange, overlay }: MobileTodayProps) {
  const local = useDone();
  const isDone = (t: Task) => (live ? t.progress === 100 : local.isDone(t));
  const toggle = (t: Task) => (live ? onToggleDone?.(t, !isDone(t)) : local.toggle(t));
  const row = (t: Task, showDate: boolean) => (
    <TaskRow
      key={t.no}
      variant="mobile"
      title={t.title}
      done={isDone(t)}
      priority={live ? t.priority : 4}
      date={showDate ? dateLabel(t.due, today) : undefined}
      onToggleDone={() => toggle(t)}
      onClick={onOpenTask ? () => onOpenTask(t) : undefined}
    />
  );
  return (
    <MobileShell fill={fill} header={<MobileHeader title="今日" safeArea={fill} sync={sync} onMenu={onMenu} />} tab="today" onTabChange={onTabChange} fab onFab={onFab} overlay={overlay}>
      <div style={{ padding: "0 16px" }}>
        <div style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-secondary)" }}>
          {`${monthDay(today)} ${weekdayLong(today)} · ${overdue.length + todays.length} 件`}
        </div>
        {(!live || overdue.length > 0) && (
        <section>
          <SectionHeader title="期限切れ" count={overdue.length} />
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 0" }}>
            <button
              type="button"
              onClick={onReschedule}
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
        )}
        <section>
          <SectionHeader title="今日" count={todays.length} />
          {todays.map((t) => row(t, false))}
        </section>
        {live && overdue.length + todays.length === 0 && (
          <div style={{ padding: "var(--space-6) 0", textAlign: "center", fontSize: 14, color: "var(--color-text-secondary)" }}>今日のタスクはありません</div>
        )}
      </div>
    </MobileShell>
  );
}
