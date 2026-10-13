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
      className="hover:bg-[var(--color-bg-hover)]"
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "6px 10px",
        borderRadius: 6,
        border: 0,
        background: active ? "var(--color-bg-hover)" : "transparent",
        fontFamily: "var(--font-body)",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: 5, background: color, flex: "0 0 auto" }} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: "20px", color: "var(--color-text-primary)" }}>{label}</span>
      {count !== undefined && (
        <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" }}>{count}</span>
      )}
    </button>
  );
}
