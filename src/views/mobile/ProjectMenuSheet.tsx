import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { SheetCard, SheetRow } from "./BottomSheet";

export type ProjectMenuSheetProps = { project: string; onRename: () => void; onDelete: () => void; onClose: () => void };

/** The 「…」 of a project's top bar (spec ④ iPhone §3.4): the desktop 「その他」 items 「名前を変更」 / 「削除」. */
export function ProjectMenuSheet({ project, onRename, onDelete, onClose }: ProjectMenuSheetProps) {
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <div role="group" aria-label="削除の確認" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <div style={{ fontSize: 14, lineHeight: "20px", color: "var(--color-text-secondary)" }}>プロジェクト「{project}」を削除します (archive フォルダに移動)。</div>
        <SheetCard>
          <SheetRow
            icon={<Trash2 size={18} />}
            label="本当に削除"
            danger
            onClick={() => {
              onDelete();
              onClose();
            }}
          />
          <SheetRow label="キャンセル" onClick={() => setConfirm(false)} />
        </SheetCard>
      </div>
    );
  }
  return (
    <SheetCard label="プロジェクトの操作">
      <SheetRow icon={<Pencil size={18} />} label="名前を変更" onClick={onRename} />
      <SheetRow icon={<Trash2 size={18} />} label="削除" danger onClick={() => setConfirm(true)} />
    </SheetCard>
  );
}
