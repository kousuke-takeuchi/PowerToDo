import type React from "react";
import { Tag } from "lucide-react";
import { MobileHeader } from "../../components/MobileHeader";
import { TaskRow } from "../../components/TaskRow";
import type { SyncState } from "../../components/SyncStatus";
import type { TabBarProps } from "../../components/TabBar";
import { TODAY, dateLabel } from "../../mock/data";
import type { Label, Task } from "../../types/model";
import { MobileShell } from "./MobileShell";

type Common = {
  fill?: boolean;
  sync?: SyncState;
  onMenu?: () => void;
  /** ヘッダーの同期アイコンを押したとき。 */
  onSync?: () => void;
  onFab?: () => void;
  onTabChange?: TabBarProps["onChange"];
  overlay?: React.ReactNode;
  banner?: React.ReactNode;
};

export type MobileLabelsProps = Common & {
  labels: Label[];
  counts: Record<string, number>;
  onOpenLabel?: (name: string) => void;
};

/** 「フィルターとラベル」: ラベルの一覧 (件数つき)。タップでそのラベルのタスク (MobileLabelDetail)。 */
export function MobileLabels({ labels, counts, onOpenLabel, fill, sync, onMenu, onSync, onFab, onTabChange, overlay, banner }: MobileLabelsProps) {
  return (
    <MobileShell
      banner={banner}
      fill={fill}
      header={<MobileHeader title="ラベル" safeArea={fill} sync={sync} onMenu={onMenu} onSync={onSync} />}
      tab="list"
      onTabChange={onTabChange}
      fab
      onFab={onFab}
      overlay={overlay}
    >
      <div style={{ padding: "0 16px" }}>
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
  onToggleDone?: (t: Task, done: boolean) => void;
  onOpenTask?: (t: Task) => void;
};

/** ラベル詳細: そのラベルが付いたタスク (プロジェクトをまたぐ)。 */
export function MobileLabelDetail({ label, tasks, today = TODAY, onToggleDone, onOpenTask, fill, sync, onMenu, onSync, onFab, onTabChange, overlay, banner }: MobileLabelDetailProps) {
  return (
    <MobileShell
      banner={banner}
      fill={fill}
      header={<MobileHeader title={`@${label}`} safeArea={fill} sync={sync} onMenu={onMenu} onSync={onSync} />}
      tab="list"
      onTabChange={onTabChange}
      fab
      onFab={onFab}
      overlay={overlay}
    >
      <div style={{ padding: "0 16px" }}>
        {tasks.map((t) => (
          <TaskRow
            key={`${t.project}/${t.no}`}
            variant="mobile"
            title={t.title}
            done={t.progress === 100}
            priority={t.priority}
            date={dateLabel(t.due, today)}
            project={t.project}
            onToggleDone={() => onToggleDone?.(t, t.progress !== 100)}
            onClick={onOpenTask ? () => onOpenTask(t) : undefined}
          />
        ))}
        {tasks.length === 0 && (
          <div style={{ padding: "var(--space-6) 0", textAlign: "center", fontSize: 14, color: "var(--color-text-secondary)" }}>タスクはありません</div>
        )}
      </div>
    </MobileShell>
  );
}
