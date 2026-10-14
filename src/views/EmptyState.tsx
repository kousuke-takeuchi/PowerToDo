import { ClipboardList } from "lucide-react";
import { Button } from "../components/Button";

export type EmptyStateProps = {
  onAdd?: () => void;
  /** 見出し。省略時は「タスクはまだありません」。 */
  title?: string;
  /** 説明。省略時は「タスクを追加」/ Q キーの案内。 */
  message?: string;
  /** 「タスクを追加」ボタンを出さない (Phase 2 の仮画面など)。 */
  hideAction?: boolean;
};

export function EmptyState({ onAdd, title = "タスクはまだありません", message = "「タスクを追加」または Q キーで最初のタスクを作成します。", hideAction }: EmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "80px 0",
        fontFamily: "var(--font-body)",
      }}
    >
      <span style={{ display: "inline-flex", color: "var(--color-text-muted)" }}>
        <ClipboardList size={56} />
      </span>
      <div style={{ fontSize: 16, lineHeight: "23px", fontWeight: 600, color: "var(--color-text-primary)" }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>
        {message}
      </div>
      {!hideAction && <Button onClick={onAdd}>タスクを追加</Button>}
    </div>
  );
}
