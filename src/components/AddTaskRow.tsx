import { Plus } from "lucide-react";

export type AddTaskRowProps = { label?: string; onClick?: () => void };

export function AddTaskRow({ label = "タスクを追加", onClick }: AddTaskRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "10px 0",
        border: 0,
        background: "none",
        fontFamily: "var(--font-body)",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span style={{ display: "inline-flex", color: "var(--color-accent)", flex: "0 0 auto" }}>
        <Plus size={18} />
      </span>
      <span style={{ fontSize: 14, lineHeight: "20px", color: "var(--color-text-secondary)" }}>{label}</span>
    </button>
  );
}
