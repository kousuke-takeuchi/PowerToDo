import type React from "react";
import { useEffect, useRef } from "react";
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
import { sectionAt } from "./mobileReorder";
import { Ellipsis } from "lucide-react";
import { arrangeFlat, type ArrangeCtx } from "../../app/view/arrange";
import { CalendarEventRow } from "../../components/CalendarEventRow";
import type { ShownEvent } from "../../app/calendarEvents";
import { DEFAULTS, type ViewOptions } from "../../app/view/viewOptions";
import { reorderAttrs, useMobileReorder } from "./useMobileReorder";

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
  /** live のみ (spec 2026-11-24): 長押しで別の日のグループへ動かした (その日に変える)。同じ日の中の順は保存しない。 */
  onMoveToDay?: (t: Task, date: string) => void;
  /** live のみ (spec 2026-11-24): 一覧の上に見えている日 (スクロールで変わる。週の帯で選んだ日も)。追加ボタンはこの日で開く。 */
  onVisibleDay?: (date: string) => void;
  /** 表示の設定 (spec 2026-11-24): 各日の中の並び替えと優先度の絞り込み (デスクトップと同じ)。日ごとのまとまりはそのまま。 */
  view?: ViewOptions;
  arrangeCtx?: ArrangeCtx;
  /** 右上の「…」: 表示のシートを開く。省略すると「…」は出ない。 */
  onViewMenu?: () => void;
  /** Google Calendar events by day (spec 2026-11-27): shown first in each day, display only. A day with only events is shown too. */
  eventsOn?: (ymd: string) => ShownEvent[];
  eventDays?: string[];
};

/** M-05: 近日。WeekStrip (今日から 7 日、タップで選択) + タスクのある日だけの日付グループ。行は日付チップなし (見出しが日付)。 */
export function MobileUpcoming({ tasks, today, live, fill, rowContext, onToggleDone, onOpenTask, onFab, onSelectDay, onExtend, onTabChange, overlay, banner, onRefresh, onSwipeDate, onTaskMenu, onMoveToDay, onVisibleDay, view, arrangeCtx, onViewMenu, eventsOn, eventDays = [] }: MobileUpcomingProps) {
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
  const reordering = live && onMoveToDay !== undefined;
  const reorder = useMobileReorder({
    onDrop: (key, drop, rows) => {
      const t = tasks.find((x) => taskKey(x) === key);
      const day = sectionAt(rows, drop);
      if (t && day && day !== t.due) onMoveToDay?.(t, day);
    },
    onMenu: (key) => {
      const t = tasks.find((x) => taskKey(x) === key);
      if (t) onTaskMenu?.(t);
    },
  });
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
    const lifted = reorder.state?.key === taskKey(t);
    return live && (onSwipeDate || onTaskMenu) ? (
      <div
        key={taskKey(t)}
        {...(reordering ? reorderAttrs({ kind: "task", key: taskKey(t), no: t.no, depth: 0, parent: null, section: group }) : {})}
        style={lifted ? { position: "relative", zIndex: 3, transform: `translateY(${reorder.state!.dy}px)`, background: "var(--color-bg)", boxShadow: "var(--shadow-popover)", borderRadius: 8 } : undefined}
      >
        <SwipeRow
          onComplete={done}
          done={isDone(t)}
          onDate={onSwipeDate && (() => onSwipeDate(t))}
          onLongPress={onTaskMenu && (() => onTaskMenu(t))}
          onLift={reordering ? (at) => reorder.lift({ key: taskKey(t), at, depth: 0, height: 2, subtree: [taskKey(t)] }) : undefined}
        >
          {r}
        </SwipeRow>
      </div>
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
  // The day at the top of the list: the last day group whose top has scrolled up to the top bar.
  const visibleCb = useRef(onVisibleDay);
  visibleCb.current = onVisibleDay;
  useEffect(() => {
    const body = reorder.list.current?.closest<HTMLElement>("[data-scroll-body]");
    if (!body || !live) return;
    const pick = () => {
      const top = body.getBoundingClientRect().top + 8;
      let day: string | undefined;
      for (const el of body.querySelectorAll<HTMLElement>("[data-day]")) {
        if (el.getBoundingClientRect().top <= top || day === undefined) day = el.dataset.day;
        else break;
      }
      if (day) visibleCb.current?.(day);
    };
    pick();
    body.addEventListener("scroll", pick, { passive: true });
    return () => body.removeEventListener("scroll", pick);
  }, [live, tasks]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = view ?? DEFAULTS;
  const ctx = arrangeCtx ?? { today, weekStart: "mon" as const, labelOrder: [], projectOrder: [] };
  const dayTasks = (ymd: string) => tasks.filter((t) => t.due === ymd).sort((a, b) => a.no - b.no);
  const arranged = new Map(
    [...new Set(tasks.map((t) => t.due).filter((d): d is string => d !== undefined && d >= today))].map((ymd) => [ymd, arrangeFlat(dayTasks(ymd), { ...options, group: "none" }, ctx)]),
  );
  const hidden = [...arranged.values()].reduce((n, a) => n + a.hidden, 0);
  // A day whose tasks the filter hides is not shown (it has no rows).
  const days = [...new Set([...[...arranged.keys()].filter((d) => (arranged.get(d)?.groups[0]?.rows.length ?? 0) > 0), ...eventDays.filter((d) => d >= today)])].sort();
  return (
    <MobileShell banner={banner} onRefresh={onRefresh} fill={fill} title="近日" actions={onViewMenu ? [{ icon: Ellipsis, label: "表示", onClick: onViewMenu }] : undefined} tab="upcoming" today={today} onTabChange={onTabChange} fab onFab={onFab} overlay={overlay}>
      <div ref={reorder.list} style={{ position: "relative", padding: "0 15px" }}>
        {reorder.state?.line && (
          <div aria-hidden style={{ position: "absolute", zIndex: 4, top: reorder.state.line.y - 1, left: 15, right: 15, height: 2, background: "var(--color-accent)", pointerEvents: "none" }} />
        )}
        <MobileWeekNav
          today={today}
          onSelect={(ymd) => {
            onSelectDay?.(ymd);
            onVisibleDay?.(ymd);
            // 実画面では、その日のグループまでスクロールする (タスクが無い日は動かない)
            if (live) document.querySelector(`[data-day="${ymd}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
          }}
        />
        {days.map((ymd) => (
          <section key={ymd} data-day={ymd}>
            <div {...(reordering ? reorderAttrs({ kind: "header", section: ymd }) : {})}>
              <SectionHeader mobile title={dayHeading(ymd, today)} showChevron={false} />
            </div>
            {(eventsOn?.(ymd) ?? []).map((e) => (
              <CalendarEventRow key={`${e.project}/${e.id}`} event={e} variant="mobile" showProject />
            ))}
            {list(
              ymd,
              (arranged.get(ymd)?.groups[0]?.rows ?? []).map((r) => r.task),
            )}
          </section>
        ))}
        {live && days.length === 0 && hidden === 0 && (
          <div style={{ padding: "var(--space-6) 0", textAlign: "center", fontSize: 14, color: "var(--color-text-secondary)" }}>この先のタスクはありません</div>
        )}
        {live && hidden > 0 && (
          <button
            type="button"
            onClick={onViewMenu}
            style={{ display: "block", width: "100%", minHeight: 44, padding: "8px 0", border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 13, lineHeight: "18px", color: "var(--color-text-secondary)", textAlign: "center", cursor: onViewMenu ? "pointer" : "default" }}
          >
            {`優先度の絞り込みで ${hidden} 件を隠しています`}
          </button>
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
