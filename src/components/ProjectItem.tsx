import { Hash } from "lucide-react";

export type ProjectItemProps = {
  color: string; // CSS 変数名 (例 "var(--color-priority-3)")
  label: string;
  count?: number | string;
  active?: boolean;
  onClick?: () => void;
};

export function ProjectItem({ color, label, count, active, onClick }: ProjectItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={active ? undefined : "bg-transparent hover:bg-[var(--color-bg-hover)]"}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "7px 10px",
        borderRadius: 6,
        border: 0,
        // Todoist: the current item is light red with red text.
        background: active ? "var(--color-accent-soft)" : undefined,
        fontFamily: "var(--font-body)",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span style={{ display: "inline-flex", flex: "0 0 auto" }}>
        <Hash size={18} color={color} aria-hidden />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: "20px", fontWeight: active ? 600 : undefined, color: active ? "var(--color-accent)" : "var(--color-text-primary)" }}>{label}</span>
      {count !== undefined && (
        <span style={{ fontSize: 12, lineHeight: "17px", color: active ? "var(--color-accent)" : "var(--color-text-muted)" }}>{count}</span>
      )}
    </button>
  );
}
