import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useEscLayer } from "../app/layers";
import { SectionHeader } from "../components/SectionHeader";
import { dateLabel, monthDay, weekdayLong } from "../mock/data";
import { useMotionTiming } from "../motion";
import type { Task } from "../types/model";
import { AddSlot, HiddenNote, useCrossRows, useOutsideClose } from "./crossList";
import { DatePicker } from "./DatePicker";
import { PageHeader, TitleGroup } from "./HeaderActions";

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
  /** 表示している行のキー (`project/no`) を表示順に知らせる。変わったときだけ呼ぶ。 */
  onVisibleKeys?: (keys: string[]) => void;
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

/** 「再スケジュール」ボタン + 日付ピッカーのポップオーバー。期限切れグループと一緒にマウントされ、消えると閉じた状態に戻る。 */
function RescheduleButton({ today, onReschedule }: { today: string; onReschedule?: (due: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { reduced, t } = useMotionTiming();
  const close = () => setOpen(false);
  useEscLayer(open, close);
  useOutsideClose(ref, open, close);
  const button = (
    <button type="button" style={rescheduleButton} onClick={onReschedule ? () => setOpen((v) => !v) : undefined}>
      再スケジュール
    </button>
  );
  if (!onReschedule) return button;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      {button}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: reduced ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={t(0.15)}
            style={{ position: "absolute", right: 0, top: "100%", zIndex: 10 }}
          >
            <DatePicker
              dateOnly
              today={today}
              value={today}
              onChange={(v) => {
                if (v.date) {
                  onReschedule(v.date);
                  close();
                }
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 期限切れグループ (再スケジュール付き) + 今日。期限切れを出さないときは見出しなしで今日の行だけ並べる。 */
export function TodayView({ tasks, today, hideOverdue, onToggleDone, onOpenTask, onAddTask, onReschedule, hiddenProjects, focusedKey, onVisibleKeys }: TodayViewProps) {
  const [overdueCollapsed, setOverdueCollapsed] = useState(false);
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
  const rows = useCrossRows({ tasks, onToggleDone, onOpenTask, date: (t) => dateLabel(t.due, today), focusedKey, onVisibleKeys });

  return (
    <>
      <PageHeader>
        <TitleGroup title="今日" subtitle={`${total} 件のタスク`} />
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
              trailing={<RescheduleButton today={today} onReschedule={onReschedule} />}
            />
            {!overdueCollapsed && (
              rows("overdue", overdue)
            )}
          </section>
        )}
        <section>
          <SectionHeader title={`${monthDay(today)} · 今日 · ${weekdayLong(today)}`} count={todays.length} showChevron={false} />
          {rows("today", todays)}
          <AddSlot onAdd={onAddTask} />
        </section>
      </div>
    </>
  );
}
