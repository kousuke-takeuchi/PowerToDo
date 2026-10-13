import { ClipboardList } from "lucide-react";
import { Button } from "../components/Button";

export type EmptyStateProps = { onAdd?: () => void };

export function EmptyState({ onAdd }: EmptyStateProps) {
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
      <div style={{ fontSize: 16, lineHeight: "23px", fontWeight: 600, color: "var(--color-text-primary)" }}>タスクはまだありません</div>
      <div style={{ fontSize: 13, lineHeight: "19px", color: "var(--color-text-secondary)" }}>
        「タスクを追加」または Q キーで最初のタスクを作成します。
      </div>
      <Button onClick={onAdd}>タスクを追加</Button>
    </div>
  );
}
