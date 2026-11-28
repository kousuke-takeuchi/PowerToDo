import { useState } from "react";
import { CalendarDays, FileText, Pencil, Rows3, Trash2 } from "lucide-react";
import { SheetCard, SheetRow } from "./BottomSheet";

/** `onRename` / `onDelete` omitted (the inbox): only 「セクションを追加」. */
export type ProjectMenuSheetProps = { project: string; onAddSection: () => void; /** 「Google カレンダー」 (spec 2026-11-27): choose the calendar the project shows. */ onCalendar?: () => void; /** 「ドキュメント」 (spec 2026-11-28): the project's documents. */ onDocs?: () => void; onRename?: () => void; onDelete?: () => void; onClose: () => void };

/** The 「…」 of a project's top bar (spec ④ iPhone §3.4): the desktop 「その他」 items 「セクションを追加」 (spec 2026-11-22 §3) / 「名前を変更」 / 「削除」. */
export function ProjectMenuSheet({ project, onAddSection, onCalendar, onDocs, onRename, onDelete, onClose }: ProjectMenuSheetProps) {
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
              onDelete?.();
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
      {onDocs && <SheetRow icon={<FileText size={18} />} label="ドキュメント" onClick={onDocs} />}
      <SheetRow icon={<Rows3 size={18} />} label="セクションを追加" onClick={onAddSection} />
      {onCalendar && <SheetRow icon={<CalendarDays size={18} />} label="Google カレンダー" onClick={onCalendar} />}
      {onRename && <SheetRow icon={<Pencil size={18} />} label="名前を変更" onClick={onRename} />}
      {onDelete && <SheetRow icon={<Trash2 size={18} />} label="削除" danger onClick={() => setConfirm(true)} />}
    </SheetCard>
  );
}
