import { Hash } from "lucide-react";

export type ProjectItemProps = {
  color: string; // CSS 変数名 (例 "var(--color-priority-3)")
  label: string;
  count?: number | string;
  active?: boolean;
  /** Mobile drawer: the earlier look (grey active row, 6 px padding, color dot). */
  mobile?: boolean;
  onClick?: () => void;
};

export function ProjectItem({ color, label, count, active, mobile, onClick }: ProjectItemProps) {
  // Desktop (Todoist): the current item is light red with red text. Mobile keeps the grey row.
  const red = active && !mobile;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={red ? undefined : "bg-transparent hover:bg-[var(--color-bg-hover)]"}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: mobile ? "6px 10px" : "7px 10px",
        borderRadius: 6,
        border: 0,
        background: red ? "var(--color-accent-soft)" : active ? "var(--color-bg-hover)" : undefined,
        fontFamily: "var(--font-body)",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {mobile ? (
        <span style={{ width: 10, height: 10, borderRadius: 5, background: color, flex: "0 0 auto" }} />
      ) : (
        <span style={{ display: "inline-flex", flex: "0 0 auto" }}>
          <Hash size={18} color={color} aria-hidden />
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: "20px", fontWeight: red ? 600 : undefined, color: red ? "var(--color-accent)" : "var(--color-text-primary)" }}>{label}</span>
      {count !== undefined && (
        <span style={{ fontSize: 12, lineHeight: "17px", color: red ? "var(--color-accent)" : "var(--color-text-muted)" }}>{count}</span>
      )}
    </button>
  );
}
