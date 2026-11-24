import type React from "react";
import { ChevronRight, Ellipsis } from "lucide-react";
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
import { arrangeFlat, type ArrangeCtx } from "../../app/view/arrange";
import { DEFAULTS, type ViewOptions } from "../../app/view/viewOptions";
import { beforeKeyOf, reordered, sectionAt } from "./mobileReorder";
import { reorderAttrs, useMobileReorder } from "./useMobileReorder";

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
  /**
   * live のみ (spec 2026-11-24): 「今日」のグループを長押しで並び替えた新しい順 (project/no)。期限切れの行を「今日」へ
   * 落とすと `rescheduled` にそのタスク (呼び出し側が今日に変えてから順を保存する)。期限切れの中では並び替えない。
   */
  onReorderToday?: (keys: string[], rescheduled?: Task) => void;
  /** 表示の設定 (spec 2026-11-24): 「今日」のグループの並び替え / グループ / 優先度の絞り込み。期限切れは並びを保ち、絞り込みだけかける。 */
  view?: ViewOptions;
  arrangeCtx?: ArrangeCtx;
  /** 右上の「…」: 表示のシートを開く。省略すると「…」は出ない。 */
  onViewMenu?: () => void;
};

/** M-04: 今日 (ヘッダーに同期アイコンなし)。期限切れ (再スケジュール付き) + 今日。pen のとおりチェックの色は全行 priority-4。 */
export function MobileToday({ overdue, todays, today, live, fill, rowContext, onToggleDone, onOpenTask, onFab, initialScrollTop, onReschedule, onTabChange, overlay, banner, onRefresh, onSwipeDate, onTaskMenu, onReorderToday, view, arrangeCtx, onViewMenu }: MobileTodayProps) {
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
  // 表示の設定 (as the desktop's TodayView): overdue keeps its order and only takes the priority filter; today takes all of it.
  const options = view ?? DEFAULTS;
  const ctx = arrangeCtx ?? { today, weekStart: "mon" as const, labelOrder: [], projectOrder: [] };
  const overdueA = arrangeFlat(overdue, { ...options, group: "none", sort: "manual", dir: "asc" }, ctx);
  const overdueShown = (overdueA.groups[0]?.rows ?? []).map((r) => r.task);
  const todayA = arrangeFlat(todays, options, ctx);
  const grouped = options.group !== "none";
  const todayShown = grouped ? [] : (todayA.groups[0]?.rows ?? []).map((r) => r.task);
  const shownCount = overdueShown.length + (grouped ? new Set(todayA.groups.flatMap((g) => g.rows.map((r) => taskKey(r.task)))).size : todayShown.length);
  const hidden = overdueA.hidden + todayA.hidden;
  // Dragging needs the manual order and the whole list (a filter would drop the hidden rows' places).
  const reordering = live && onReorderToday !== undefined && options.sort === "manual" && !grouped && options.prio === "all";
  const reorder = useMobileReorder({
    onDrop: (key, drop, rows) => {
      if (sectionAt(rows, drop) !== "today") return;
      const late = overdue.find((x) => taskKey(x) === key);
      const keys = todayShown.map(taskKey);
      const next = reordered(keys, key, beforeKeyOf(rows, drop, key));
      if (late || next.join("\n") !== keys.join("\n")) onReorderToday?.(next, late);
    },
    onMenu: (key) => {
      const t = [...overdue, ...todays].find((x) => taskKey(x) === key);
      if (t) onTaskMenu?.(t);
    },
  });
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
    // Overdue rows lift too: dropped into 今日 they move to today (Todoist).
    const liftable = reordering && (group === "today" || group === "overdue");
    const lifted = reorder.state?.key === taskKey(t);
    return live && (onSwipeDate || onTaskMenu) ? (
      <div
        key={taskKey(t)}
        {...(liftable ? reorderAttrs({ kind: "task", key: taskKey(t), no: t.no, depth: 0, parent: null, section: group }) : {})}
        style={lifted ? { position: "relative", zIndex: 3, transform: `translateY(${reorder.state!.dy}px)`, background: "var(--color-bg)", boxShadow: "var(--shadow-popover)", borderRadius: 8 } : undefined}
      >
        <SwipeRow
          onComplete={done}
          done={isDone(t)}
          onDate={onSwipeDate && (() => onSwipeDate(t))}
          onLongPress={onTaskMenu && (() => onTaskMenu(t))}
          onLift={liftable ? (at) => reorder.lift({ key: taskKey(t), at, depth: 0, height: 2, subtree: [taskKey(t)] }) : undefined}
        >
          {r}
        </SwipeRow>
      </div>
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
    <MobileShell banner={banner} onRefresh={onRefresh} fill={fill} title="今日" subtitle={`${shownCount} 件のタスク`} actions={onViewMenu ? [{ icon: Ellipsis, label: "表示", onClick: onViewMenu }] : undefined} largeTitle initialScrollTop={initialScrollTop} tab="today" today={today} onTabChange={onTabChange} fab onFab={onFab} overlay={overlay}>
      <div ref={reorder.list} style={{ position: "relative", padding: "0 15px" }}>
        {reorder.state?.line && (
          <div aria-hidden style={{ position: "absolute", zIndex: 4, top: reorder.state.line.y - 1, left: 15, right: 15, height: 2, background: "var(--color-accent)", pointerEvents: "none" }} />
        )}
        {(!live || overdueShown.length > 0) && (
          <section>
            <div {...(reordering ? reorderAttrs({ kind: "header", section: "overdue" }) : {})}>
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
            </div>
            {list("overdue", overdueShown, { project: true, date: true })}
          </section>
        )}
        {grouped ? (
          // Grouped (priority / label / project): a header per group, no dragging.
          todayA.groups.map((g, i) => (
            <section key={g.key}>
              <SectionHeader mobile tight={i === 0 && overdueShown.length === 0} title={g.title} />
              {list(`g:${g.key}`, g.rows.map((r) => r.task), { project: true, date: false })}
            </section>
          ))
        ) : (
          <section>
            <div {...(reordering ? reorderAttrs({ kind: "header", section: "today" }) : {})}>
              <SectionHeader mobile tight={live && overdueShown.length === 0} title={dayHeading(today, today)} />
            </div>
            {list("today", todayShown, { project: true, date: false })}
          </section>
        )}
        {live && shownCount === 0 && hidden === 0 && (
          <div style={{ padding: "var(--space-6) 0", textAlign: "center", fontSize: 14, color: "var(--color-text-secondary)" }}>今日のタスクはありません</div>
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
      </div>
    </MobileShell>
  );
}
