import { useState } from "react";
import { Calendar, Flag, FolderInput, Trash2 } from "lucide-react";
import type { Task } from "../../types/model";
import { SheetRow } from "./BottomSheet";

export type TaskMenuSheetProps = {
  task: Task;
  onDate: () => void;
  onPriority: () => void;
  /** 省略すると「移動」の行を出さない (サブタスクは移せない)。 */
  onMove?: () => void;
  onDelete: () => void;
  onClose: () => void;
};

/** 長押しのメニューの中身 (BottomSheet の children): 日付 / 優先度 / 移動 / 削除。削除は同じシートの中で 2 段階 (「削除」-> 「本当に削除」)。 */
export function TaskMenuSheet({ task, onDate, onPriority, onMove, onDelete, onClose }: TaskMenuSheetProps) {
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <div role="group" aria-label="削除の確認" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <div style={{ fontSize: 14, lineHeight: "20px", color: "var(--color-text-secondary)" }}>
          「{task.title}」を削除します。元に戻せません。
        </div>
        <SheetRow icon={<Trash2 size={18} />} label="本当に削除" danger onClick={() => { onDelete(); onClose(); }} />
        <SheetRow label="キャンセル" onClick={() => setConfirm(false)} />
      </div>
    );
  }
  return (
    <div role="group" aria-label="タスクのメニュー" style={{ display: "flex", flexDirection: "column" }}>
      <SheetRow icon={<Calendar size={18} />} label="日付" value={task.due} onClick={onDate} />
      <SheetRow icon={<Flag size={18} />} iconColor={`var(--color-priority-${task.priority})`} label="優先度" value={`P${task.priority}`} onClick={onPriority} />
      {onMove && <SheetRow icon={<FolderInput size={18} />} label="移動" onClick={onMove} />}
      <SheetRow icon={<Trash2 size={18} />} label="削除" danger onClick={() => setConfirm(true)} />
    </div>
  );
}
