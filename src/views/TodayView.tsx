import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useEscLayer } from "../app/layers";
import { SectionHeader } from "../components/SectionHeader";
import { TaskRow } from "../components/TaskRow";
import { dateLabel, monthDay, weekdayLong } from "../mock/data";
import { Collapse, useMotionTiming } from "../motion";
import type { Task } from "../types/model";
import { AddSlot, HiddenNote, taskKey, useLeaving } from "./crossList";
import { DatePicker } from "./DatePicker";
import { PageHeader, TitleGroup } from "./HeaderActions";
import { useDone } from "./useDone";

export type TodayViewProps = {
  tasks: Task[];
  today: string;
  hideOverdue?: boolean;
  // ---- 実アプリ用 (全部 optional。無ければ Storybook と同じ見た目だけの挙動) ----
  /** 渡すとチェックはこれを呼ぶ。完了状態は task.progress から決まる (完了直後 400ms は行を残す)。 */
  onToggleDone?: (t: Task, done: boolean) => void;
  onOpenTask?: (t: Task) => void;
  /** 渡すと「タスクを追加」行がインライン入力を開く。受信トレイに期限 = today で追加する。 */
  onAddTask?: (title: string) => void;
  /** 渡すと「再スケジュール」が日付ピッカーを開き、選んだ日でこれを呼ぶ。 */
  onReschedule?: (due: string) => void;
  /** 読み込めなかったプロジェクト名。1 行の注記を出す (仕様 §7)。 */
  hiddenProjects?: string[];
  /** 行フォーカス (Task 8)。 */
  focusedKey?: string;
};

const rescheduleButton = {
  padding: 0,
  border: 0,
  background: "none",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  lineHeight: "19px",
  fontWeight: 600,
  color: "var(--color-accent)",
  cursor: "pointer",
} as const;

/** 期限切れグループ (再スケジュール付き) + 今日。期限切れを出さないときは見出しなしで今日の行だけ並べる。 */
export function TodayView({ tasks, today, hideOverdue, onToggleDone, onOpenTask, onAddTask, onReschedule, hiddenProjects }: TodayViewProps) {
  const [overdueCollapsed, setOverdueCollapsed] = useState(false);
  const { isDone: fakeDone, toggle: fakeToggle } = useDone();
  const leave = useLeaving();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const { reduced, t: timing } = useMotionTiming();
  useEscLayer(pickerOpen, () => setPickerOpen(false));
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !pickerRef.current?.contains(e.target)) setPickerOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  const open = tasks.filter((t) => t.parentNo === undefined && t.progress !== 100 && t.due !== undefined);
  // Rust (today_view) already orders the groups (due, priority, No.); only the mock data needs sorting here.
  const overdue = open.filter((t) => t.due! < today);
  const todays = open.filter((t) => t.due === today);
  if (!onToggleDone) {
    overdue.sort((a, b) => (a.due! === b.due! ? a.no - b.no : a.due! < b.due! ? -1 : 1));
    todays.sort((a, b) => a.no - b.no);
  }
  const showOverdue = !hideOverdue && overdue.length > 0;
  const total = (showOverdue ? overdue.length : 0) + todays.length;

  const isDone = (t: Task) => (onToggleDone ? t.progress === 100 || leave.isLeaving(t) : fakeDone(t));
  const toggle = (t: Task, group: string, index: number) => {
    if (!onToggleDone) {
      fakeToggle(t);
      return;
    }
    const next = !isDone(t);
    if (next) leave.begin(t, group, index);
    else leave.cancel(t);
    onToggleDone(t, next);
  };

  const row = (group: string) => (t: Task, index: number) => {
    const el = (
      <TaskRow
        key={onToggleDone ? taskKey(t) : t.no}
        title={t.title}
        done={isDone(t)}
        priority={t.priority}
        date={dateLabel(t.due, today)}
        project={t.project}
        onClick={onOpenTask ? () => onOpenTask(t) : undefined}
        onToggleDone={() => toggle(t, group, index)}
      />
    );
    return onToggleDone ? (
      <Collapse key={taskKey(t)} enterY={-8} exitX={-24}>
        {el}
      </Collapse>
    ) : (
      el
    );
  };
  const rows = (group: string, list: Task[]) => {
    const items = (onToggleDone ? leave.merge(group, list) : list).map(row(group));
    return onToggleDone ? <AnimatePresence initial={false}>{items}</AnimatePresence> : items;
  };

  const reschedule = (
    <button type="button" style={rescheduleButton} onClick={onReschedule ? () => setPickerOpen((v) => !v) : undefined}>
      再スケジュール
    </button>
  );

  return (
    <>
      <PageHeader>
        <TitleGroup title="今日" subtitle={`${monthDay(today)} ${weekdayLong(today)} · ${total} 件`} />
      </PageHeader>
      <HiddenNote names={hiddenProjects} />
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
                  {onReschedule ? (
                    <div ref={pickerRef} style={{ position: "relative" }}>
                      {reschedule}
                      <AnimatePresence>
                        {pickerOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={timing(0.15)}
                            style={{ position: "absolute", right: 0, top: "100%", zIndex: 10 }}
                          >
                            <DatePicker
                              today={today}
                              value={today}
                              onChange={(v) => {
                                if (v.date) {
                                  onReschedule(v.date);
                                  setPickerOpen(false);
                                }
                              }}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ) : (
                    reschedule
                  )}
                </div>
                {rows("overdue", overdue)}
              </>
            )}
          </section>
        )}
        <section>
          {showOverdue && <SectionHeader title={`今日 · ${monthDay(today)}`} count={todays.length} showChevron={false} />}
          {rows("today", todays)}
          <AddSlot onAdd={onAddTask} />
        </section>
      </div>
    </>
  );
}
