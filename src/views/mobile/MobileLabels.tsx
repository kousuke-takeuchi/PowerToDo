import type React from "react";
import { Tag } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { TaskRow } from "../../components/TaskRow";
import type { MobileTab } from "../../app/mobileNav";
import { Collapse } from "../../motion";
import { TODAY } from "../../mock/data";
import type { Label, Task } from "../../types/model";
import { taskKey, useLeaving } from "../crossList";
import { MobileShell } from "./MobileShell";
import { mobileRowProps, type RowContext } from "./rowProps";

type Common = {
  fill?: boolean;
  /** Back to 閲覧. */
  onBack?: () => void;
  today?: string;
  onFab?: () => void;
  onTabChange?: (t: MobileTab) => void;
  overlay?: React.ReactNode;
  banner?: React.ReactNode;
};

export type MobileLabelsProps = Common & {
  labels: Label[];
  counts: Record<string, number>;
  onOpenLabel?: (name: string) => void;
};

/** 「フィルターとラベル」: ラベルの一覧 (件数つき)。タップでそのラベルのタスク (MobileLabelDetail)。 */
export function MobileLabels({ labels, counts, onOpenLabel, fill, onBack, today, onFab, onTabChange, overlay, banner }: MobileLabelsProps) {
  return (
    <MobileShell
      banner={banner}
      fill={fill}
      title="ラベル"
      largeTitle
      onBack={onBack}
      tab="browse"
      today={today}
      onTabChange={onTabChange}
      fab
      onFab={onFab}
      overlay={overlay}
    >
      <div style={{ padding: "0 15px" }}>
        {labels.map((l) => (
          <button
            key={l.name}
            type="button"
            onClick={() => onOpenLabel?.(l.name)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              padding: "12px 0",
              border: 0,
              background: "none",
              fontFamily: "var(--font-body)",
              fontSize: 15,
              lineHeight: "22px",
              color: "var(--color-text-primary)",
              textAlign: "left",
              cursor: "pointer",
              boxShadow: "inset 0 -1px 0 var(--color-border)",
            }}
          >
            <span style={{ display: "inline-flex", color: l.color }}>
              <Tag size={18} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>{l.name}</span>
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{counts[l.name] ?? 0}</span>
          </button>
        ))}
        {labels.length === 0 && (
          <div style={{ padding: "var(--space-6) 0", textAlign: "center", fontSize: 14, color: "var(--color-text-secondary)" }}>ラベルはありません</div>
        )}
      </div>
    </MobileShell>
  );
}

export type MobileLabelDetailProps = Common & {
  label: string;
  tasks: Task[];
  today?: string;
  /** What a row shows beyond the task itself (inbox name, project colors, comment counts). */
  rowContext?: Omit<RowContext, "today">;
  onToggleDone?: (t: Task, done: boolean) => void;
  onOpenTask?: (t: Task) => void;
};

/** ラベル詳細: そのラベルが付いたタスク (プロジェクトをまたぐ)。 */
export function MobileLabelDetail({ label, tasks, today = TODAY, rowContext, onToggleDone, onOpenTask, fill, onBack, onFab, onTabChange, overlay, banner }: MobileLabelDetailProps) {
  // Completing leaves like the other lists (the view drops the task a moment later).
  const leave = useLeaving(tasks);
  const toggle = (t: Task, index: number) => {
    const next = !(t.progress === 100 || leave.isLeaving(t));
    if (next) leave.begin(t, "label", index);
    else leave.cancel(t);
    onToggleDone?.(t, next);
  };
  return (
    <MobileShell
      banner={banner}
      fill={fill}
      title={`@${label}`}
      subtitle={`${tasks.length} 件のタスク`}
      largeTitle
      onBack={onBack}
      tab="browse"
      today={today}
      onTabChange={onTabChange}
      fab
      onFab={onFab}
      overlay={overlay}
    >
      <div style={{ padding: "0 15px" }}>
        <AnimatePresence initial={false}>
          {leave.merge("label", tasks).map((t, i) => (
            <Collapse key={taskKey(t)} duration={0.1}>
              <TaskRow
                variant="mobile"
                {...mobileRowProps(t, { today, ...rowContext }, { project: true })}
                done={t.progress === 100 || leave.isLeaving(t)}
                onToggleDone={() => toggle(t, i)}
                onClick={onOpenTask ? () => onOpenTask(t) : undefined}
              />
            </Collapse>
          ))}
        </AnimatePresence>
        {tasks.length === 0 && (
          <div style={{ padding: "var(--space-6) 0", textAlign: "center", fontSize: 14, color: "var(--color-text-secondary)" }}>タスクはありません</div>
        )}
      </div>
    </MobileShell>
  );
}
