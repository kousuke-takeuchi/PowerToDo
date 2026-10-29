import type React from "react";
import { ChevronRight } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { SectionHeader } from "../../components/SectionHeader";
import { TaskRow } from "../../components/TaskRow";
import { Collapse } from "../../motion";
import type { MobileTab } from "../../app/mobileNav";
import type { Task } from "../../types/model";
import { taskKey, useLeaving } from "../crossList";
import { useDone } from "../useDone";
import { mobileRowProps, type RowContext } from "./rowProps";
import { MobileShell } from "./MobileShell";
import { SwipeRow } from "./SwipeRow";
import { dayHeading } from "./mobileDates";

export type MobileTodayProps = {
  overdue: Task[];
  todays: Task[];
  today: string;
  /** What a row shows beyond the task itself (inbox name, project colors, comment counts). */
  rowContext?: Omit<RowContext, "today">;
  /** 実データで動かす: チェックは task.progress を見て onToggleDone を呼び、優先度の色は task.priority。省略すると Story の見た目のまま。 */
  live?: boolean;
  /** 実機用: 幅 100% / 高さ 100dvh、上下はセーフエリア。 */
  fill?: boolean;
  onToggleDone?: (t: Task, done: boolean) => void;
  onOpenTask?: (t: Task) => void;
  onFab?: () => void;
  /** Stories: start scrolled by this many px (M-04b). */
  initialScrollTop?: number;
  /** 「再スケジュール」(期限切れをまとめて動かす)。 */
  onReschedule?: () => void;
  onTabChange?: (t: MobileTab) => void;
  overlay?: React.ReactNode;
  /** header の下に流す帯 (MobileShell の banner)。 */
  banner?: React.ReactNode;
  /** 一覧を引っ張って更新したとき (MobileShell の onRefresh)。 */
  onRefresh?: () => Promise<void>;
  /** live のみ: 左スワイプ (日付のシート) / 長押し (メニュー)。右スワイプは onToggleDone。 */
  onSwipeDate?: (t: Task) => void;
  onTaskMenu?: (t: Task) => void;
};

/** M-04: 今日 (ヘッダーに同期アイコンなし)。期限切れ (再スケジュール付き) + 今日。pen のとおりチェックの色は全行 priority-4。 */
export function MobileToday({ overdue, todays, today, live, fill, rowContext, onToggleDone, onOpenTask, onFab, initialScrollTop, onReschedule, onTabChange, overlay, banner, onRefresh, onSwipeDate, onTaskMenu }: MobileTodayProps) {
  const local = useDone();
  const leave = useLeaving([...overdue, ...todays]);
  const isDone = (t: Task) => (live ? t.progress === 100 || leave.isLeaving(t) : local.isDone(t));
  const toggle = (t: Task, group: string, index: number) => {
    if (!live) return local.toggle(t);
    const next = !isDone(t);
    if (next) leave.begin(t, group, index);
    else leave.cancel(t);
    onToggleDone?.(t, next);
  };
  const row = (t: Task, group: string, index: number, show: { date?: boolean; project?: boolean }) => {
    const done = () => toggle(t, group, index);
    const r = (
      <TaskRow
        key={taskKey(t)}
        variant="mobile"
        {...mobileRowProps(t, { today, ...rowContext }, show)}
        done={isDone(t)}
        onToggleDone={done}
        onClick={onOpenTask ? () => onOpenTask(t) : undefined}
      />
    );
    return live && (onSwipeDate || onTaskMenu) ? (
      <SwipeRow key={taskKey(t)} onComplete={done} done={isDone(t)} onDate={onSwipeDate && (() => onSwipeDate(t))} onLongPress={onTaskMenu && (() => onTaskMenu(t))}>
        {r}
      </SwipeRow>
    ) : (
      r
    );
  };
  /** One list: completed rows stay LEAVE_DELAY_MS, then leave in 0.1 s. */
  const list = (group: string, rows: Task[], show: { date?: boolean; project?: boolean }) => {
    const items = (live ? leave.merge(group, rows) : rows).map((t, i) => {
      const el = row(t, group, i, show);
      return live ? (
        <Collapse key={taskKey(t)} duration={0.1}>
          {el}
        </Collapse>
      ) : (
        el
      );
    });
    return live ? <AnimatePresence initial={false}>{items}</AnimatePresence> : items;
  };
  return (
    <MobileShell banner={banner} onRefresh={onRefresh} fill={fill} title="今日" subtitle={`${overdue.length + todays.length} 件のタスク`} largeTitle initialScrollTop={initialScrollTop} tab="today" today={today} onTabChange={onTabChange} fab onFab={onFab} overlay={overlay}>
      <div style={{ padding: "0 15px" }}>
        {(!live || overdue.length > 0) && (
          <section>
            <SectionHeader
              mobile
              tight
              title="期限切れ"
              trailing={
                <button
                  type="button"
                  onClick={onReschedule}
                  style={{ display: "inline-flex", alignItems: "center", gap: 2, minHeight: 32, padding: 0, border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 15, lineHeight: "20px", color: "var(--color-accent)", cursor: "pointer" }}
                >
                  再スケジュール
                  <ChevronRight size={16} aria-hidden />
                </button>
              }
            />
            {list("overdue", overdue, { project: true, date: true })}
          </section>
        )}
        <section>
          <SectionHeader mobile tight={live && overdue.length === 0} title={dayHeading(today, today)} />
          {list("today", todays, { project: true, date: false })}
        </section>
        {live && overdue.length + todays.length === 0 && (
          <div style={{ padding: "var(--space-6) 0", textAlign: "center", fontSize: 14, color: "var(--color-text-secondary)" }}>今日のタスクはありません</div>
        )}
      </div>
    </MobileShell>
  );
}
