import type React from "react";
import { AnimatePresence } from "motion/react";
import { SectionHeader } from "../../components/SectionHeader";
import { TaskRow } from "../../components/TaskRow";
import type { MobileTab } from "../../app/mobileNav";
import type { Task } from "../../types/model";
import { Collapse } from "../../motion";
import { taskKey, useLeaving } from "../crossList";
import { useDone } from "../useDone";
import { mobileRowProps, type RowContext } from "./rowProps";
import { MobileWeekNav } from "./MobileWeekNav";
import { dayHeading } from "./mobileDates";
import { MobileShell } from "./MobileShell";
import { SwipeRow } from "./SwipeRow";

export type MobileUpcomingProps = {
  tasks: Task[];
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
  /** 週の帯の日付を押したとき (その日の行へ移る)。 */
  onSelectDay?: (ymd: string) => void;
  /** 「さらに 7 日」。 */
  onExtend?: () => void;
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

/** M-05: 近日。WeekStrip (今日から 7 日、タップで選択) + タスクのある日だけの日付グループ。行は日付チップなし (見出しが日付)。 */
export function MobileUpcoming({ tasks, today, live, fill, rowContext, onToggleDone, onOpenTask, onFab, onSelectDay, onExtend, onTabChange, overlay, banner, onRefresh, onSwipeDate, onTaskMenu }: MobileUpcomingProps) {
  const local = useDone();
  const leave = useLeaving(tasks);
  const isDone = (t: Task) => (live ? t.progress === 100 || leave.isLeaving(t) : local.isDone(t));
  const toggle = (t: Task, group: string, index: number) => {
    if (!live) return local.toggle(t);
    const next = !isDone(t);
    if (next) leave.begin(t, group, index);
    else leave.cancel(t);
    onToggleDone?.(t, next);
  };
  const row = (t: Task, group: string, index: number) => {
    const done = () => toggle(t, group, index);
    const r = (
      <TaskRow
        key={taskKey(t)}
        variant="mobile"
        {...mobileRowProps(t, { today, ...rowContext }, { project: true, date: false })}
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
  /** One day: completed rows stay LEAVE_DELAY_MS, then leave in 0.1 s. */
  const list = (group: string, rows: Task[]) => {
    const items = (live ? leave.merge(group, rows) : rows).map((t, i) => {
      const el = row(t, group, i);
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
  const days = [...new Set(tasks.map((t) => t.due).filter((d): d is string => d !== undefined && d >= today))].sort();
  return (
    <MobileShell banner={banner} onRefresh={onRefresh} fill={fill} title="近日" tab="upcoming" today={today} onTabChange={onTabChange} fab onFab={onFab} overlay={overlay}>
      <div style={{ padding: "0 15px" }}>
        <MobileWeekNav
          today={today}
          onSelect={(ymd) => {
            onSelectDay?.(ymd);
            // 実画面では、その日のグループまでスクロールする (タスクが無い日は動かない)
            if (live) document.querySelector(`[data-day="${ymd}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
          }}
        />
        {days.map((ymd) => (
          <section key={ymd} data-day={ymd}>
            <SectionHeader mobile title={dayHeading(ymd, today)} showChevron={false} />
            {list(
              ymd,
              tasks.filter((t) => t.due === ymd).sort((a, b) => a.no - b.no),
            )}
          </section>
        ))}
        {live && days.length === 0 && (
          <div style={{ padding: "var(--space-6) 0", textAlign: "center", fontSize: 14, color: "var(--color-text-secondary)" }}>この先のタスクはありません</div>
        )}
        {live && onExtend && (
          <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-4) 0" }}>
            <button
              type="button"
              onClick={onExtend}
              style={{ padding: "8px 12px", border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "19px", fontWeight: 600, color: "var(--color-accent)", cursor: "pointer" }}
            >
              さらに 7 日
            </button>
          </div>
        )}
      </div>
    </MobileShell>
  );
}
