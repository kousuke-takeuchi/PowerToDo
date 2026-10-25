import type React from "react";
import { MobileHeader } from "../../components/MobileHeader";
import { SectionHeader } from "../../components/SectionHeader";
import { TaskRow } from "../../components/TaskRow";
import { daysBetween, monthDay, weekdayLong } from "../../mock/data";
import type { SyncState } from "../../components/SyncStatus";
import type { TabBarProps } from "../../components/TabBar";
import type { Task } from "../../types/model";
import { useDone } from "../useDone";
import { WeekStrip } from "../WeekStrip";
import { MobileShell } from "./MobileShell";
import { SwipeRow } from "./SwipeRow";

/** 見出し: 今日 / 明日は「10月13日 · 今日」、それ以外は「10月16日 · 金曜日」 (pen の M-05)。 */
function dayTitle(ymd: string, today: string): string {
  const diff = daysBetween(ymd, today);
  return `${monthDay(ymd)} · ${diff === 0 ? "今日" : diff === 1 ? "明日" : weekdayLong(ymd)}`;
}

export type MobileUpcomingProps = {
  tasks: Task[];
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
  /** ヘッダーの同期アイコンを押したとき。 */
  onSync?: () => void;
  /** 週の帯の日付を押したとき (その日の行へ移る)。 */
  onSelectDay?: (ymd: string) => void;
  /** 「さらに 7 日」。 */
  onExtend?: () => void;
  onTabChange?: TabBarProps["onChange"];
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
export function MobileUpcoming({ tasks, today, live, fill, sync, onToggleDone, onOpenTask, onFab, onMenu, onSync, onSelectDay, onExtend, onTabChange, overlay, banner, onRefresh, onSwipeDate, onTaskMenu }: MobileUpcomingProps) {
  const local = useDone();
  const isDone = (t: Task) => (live ? t.progress === 100 : local.isDone(t));
  const toggle = (t: Task) => (live ? onToggleDone?.(t, !isDone(t)) : local.toggle(t));
  const days = [...new Set(tasks.map((t) => t.due).filter((d): d is string => d !== undefined && d >= today))].sort();
  return (
    <MobileShell banner={banner} onRefresh={onRefresh} fill={fill} header={<MobileHeader title="近日" safeArea={fill} sync={sync} onMenu={onMenu} onSync={onSync} />} tab="upcoming" onTabChange={onTabChange} fab onFab={onFab} overlay={overlay}>
      <div style={{ padding: "0 16px" }}>
        <WeekStrip variant="mobile" start={today} today={today} onSelect={(ymd) => {
            onSelectDay?.(ymd);
            // 実画面では、その日のグループまでスクロールする (タスクが無い日は動かない)
            if (live) document.querySelector(`[data-day="${ymd}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
          }}
        />
        {days.map((ymd) => (
          <section key={ymd} data-day={ymd}>
            <SectionHeader title={dayTitle(ymd, today)} showChevron={false} />
            {tasks
              .filter((t) => t.due === ymd)
              .sort((a, b) => a.no - b.no)
              .map((t) => {
                const r = <TaskRow key={t.no} variant="mobile" title={t.title} done={isDone(t)} priority={live ? t.priority : 4} onToggleDone={() => toggle(t)} onClick={onOpenTask ? () => onOpenTask(t) : undefined} />;
                return live && (onSwipeDate || onTaskMenu) ? (
                  <SwipeRow key={t.no} onComplete={() => toggle(t)} done={isDone(t)} onDate={onSwipeDate && (() => onSwipeDate(t))} onLongPress={onTaskMenu && (() => onTaskMenu(t))}>
                    {r}
                  </SwipeRow>
                ) : (
                  r
                );
              })}
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
