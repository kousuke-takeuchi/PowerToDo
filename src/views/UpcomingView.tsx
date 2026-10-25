import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { addDays, daysBetween, monthDay, monthStart, weekdayLong } from "../app/dates";
import { useEscLayer } from "../app/layers";
import { Button } from "../components/Button";
import { SectionHeader } from "../components/SectionHeader";
import { useMotionTiming } from "../motion";
import type { DayGroup, Task } from "../types/model";
import { AddSlot, HiddenNote, useCrossRows, useOutsideClose } from "./crossList";
import { PageHeader, titleStyle } from "./HeaderActions";
import { WeekStrip } from "./WeekStrip";

export type UpcomingViewProps = {
  tasks: Task[];
  today: string;
  // ---- 実アプリ用 (全部 optional。無ければ Storybook と同じ見た目だけの挙動) ----
  /** 渡すとこのグループ (Rust の upcoming_view) をそのまま表示し、tasks は使わない。 */
  days?: DayGroup[];
  /** 「さらに 7 日」。渡さないとボタンは出ない。 */
  onExtend?: () => void;
  /** 月セレクトで月を選んだ (その月の 1 日の YYYY-MM-DD。「今日」と今月は today を渡す)。 */
  onJumpTo?: (from: string) => void;
  onToggleDone?: (t: Task, done: boolean) => void;
  onOpenTask?: (t: Task) => void;
  /** 各日の「タスクを追加」。受信トレイにその日を期限として追加する。 */
  onAddTask?: (date: string, title: string) => void;
  hiddenProjects?: string[];
  /** 行フォーカス (Task 8)。 */
  focusedKey?: string;
  /** 表示している行のキー (`project/no`) を表示順に知らせる。変わったときだけ呼ぶ。 */
  onVisibleKeys?: (keys: string[]) => void;
  /** Stories only: draw this day (YYYY-MM-DD) as the drop target (accent-soft highlight, D-05b). */
  dropPreviewDay?: string;
};

/** upcoming_view が返せる最大日数 (Rust 側の上限)。 */
const MAX_DAYS = 91;
const MONTH_CHOICES = 12;

const menuItem = {
  display: "block",
  width: "100%",
  padding: "6px 12px",
  border: 0,
  background: "none",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  lineHeight: "19px",
  color: "var(--color-text-primary)",
  textAlign: "left",
  cursor: "pointer",
} as const;

function dayTitle(ymd: string, today: string): string {
  const diff = daysBetween(ymd, today);
  const rel = diff === 0 ? "今日" : diff === 1 ? "明日" : undefined;
  return [monthDay(ymd), rel, weekdayLong(ymd)].filter(Boolean).join(" · ");
}

/** MonthSelect + WeekStrip (今日から 7 日) + 日付グループ。タスクのない日も見出し + AddTaskRow を出す。 */
export function UpcomingView({ tasks, today, days, onExtend, onJumpTo, onToggleDone, onOpenTask, onAddTask, hiddenProjects, focusedKey, onVisibleKeys, dropPreviewDay }: UpcomingViewProps) {
  const { reduced } = useMotionTiming();
  const [monthOpen, setMonthOpen] = useState(false);
  const monthRef = useRef<HTMLDivElement>(null);
  useEscLayer(monthOpen, () => setMonthOpen(false));
  useOutsideClose(monthRef, monthOpen, () => setMonthOpen(false));

  const [y, m] = (days?.[0]?.date ?? today).split("-");
  const open = tasks.filter((t) => t.parentNo === undefined && t.progress !== 100 && t.due !== undefined);
  // 見出しは pen に合わせて「今日 + 3 日」(10月13日〜16日) の 4 グループ。days があれば Rust のグループをそのまま使う。
  const groups = days ? days.map((d) => d.date) : Array.from({ length: 4 }, (_, i) => addDays(today, i));
  const rowsOf = (ymd: string): Task[] =>
    days ? (days.find((d) => d.date === ymd)?.tasks ?? []) : open.filter((t) => t.due === ymd).sort((a, b) => a.no - b.no);

  const allTasks = days ? days.flatMap((d) => d.tasks) : tasks;
  const rows = useCrossRows({ tasks: allTasks, onToggleDone, onOpenTask, focusedKey, onVisibleKeys, dragView: "upcoming" });

  const monthButton = (
    <button
      type="button"
      aria-haspopup={onJumpTo ? "menu" : undefined}
      aria-expanded={onJumpTo ? monthOpen : undefined}
      onClick={onJumpTo ? () => setMonthOpen((v) => !v) : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: 0,
        border: 0,
        background: "none",
        fontFamily: "var(--font-body)",
        fontSize: 14,
        lineHeight: "20px",
        fontWeight: 600,
        color: "var(--color-text-primary)",
        cursor: "pointer",
      }}
    >
      {`${y}年${Number(m)}月`}
      <span style={{ display: "inline-flex", color: "var(--color-text-secondary)" }}>
        <ChevronDown size={14} />
      </span>
    </button>
  );
  const jump = (from: string) => {
    setMonthOpen(false);
    onJumpTo?.(from);
  };

  return (
    <>
      <PageHeader>
        <h1 style={titleStyle}>近日</h1>
        {onJumpTo ? (
          <div ref={monthRef} style={{ position: "relative" }}>
            {monthButton}
            {monthOpen && (
              <div
                role="menu"
                aria-label="月を選ぶ"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  zIndex: 10,
                  minWidth: 160,
                  maxHeight: 320,
                  overflowY: "auto",
                  padding: "4px 0",
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  boxShadow: "var(--shadow-popover)",
                }}
              >
                <button type="button" role="menuitem" className="bg-transparent hover:bg-[var(--color-bg-hover)]" style={menuItem} onClick={() => jump(today)}>
                  今日
                </button>
                {Array.from({ length: MONTH_CHOICES }, (_, i) => {
                  const first = monthStart(today, i);
                  const [fy, fm] = first.split("-").map(Number);
                  return (
                    <button
                      key={first}
                      type="button"
                      role="menuitem"
                      className="bg-transparent hover:bg-[var(--color-bg-hover)]"
                      style={menuItem}
                      onClick={() => jump(i === 0 ? today : first)}
                    >
                      {`${fy}年${fm}月`}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          monthButton
        )}
      </PageHeader>
      <HiddenNote names={hiddenProjects} />
      <WeekStrip
        start={days?.[0]?.date ?? today}
        today={today}
        onSelect={
          days
            ? (ymd) => document.getElementById(`day-${ymd}`)?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" })
            : undefined
        }
      />
      <div>
        {groups.map((ymd) => (
          <section key={ymd} id={days ? `day-${ymd}` : undefined} data-drop-day={ymd < today ? undefined : ymd}
            style={dropPreviewDay === ymd ? { background: "var(--color-accent-soft)", borderRadius: 6 } : undefined}
          >
            <SectionHeader title={dayTitle(ymd, today)} showChevron={false} />
            {rows(ymd, rowsOf(ymd))}
            <AddSlot defaults={{ due: ymd }} onAdd={onAddTask ? (title) => onAddTask(ymd, title) : undefined} />
          </section>
        ))}
        {onExtend && days && days.length < MAX_DAYS && (
          <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-4) 0" }}>
            <Button variant="secondary" onClick={onExtend}>
              さらに 7 日
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
