import type React from "react";

export type SidebarItemProps = {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  count?: number | string;
  active?: boolean;
  /** iPhone 閲覧 tab: full-width rows, 16 text. */
  mobile?: boolean;
  onClick?: () => void;
};

export function SidebarItem({ icon: Icon, label, count, active, mobile, onClick }: SidebarItemProps) {
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
        padding: mobile ? "11px 0" : "7px 10px",
        borderRadius: mobile ? 0 : 6,
        border: 0,
        background: red ? "var(--color-accent-soft)" : active ? "var(--color-bg-hover)" : undefined,
        fontFamily: "var(--font-body)",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span style={{ display: "inline-flex", color: red ? "var(--color-accent)" : "var(--color-text-secondary)", flex: "0 0 auto" }}>
        <Icon size={18} />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: mobile ? 16 : 14, lineHeight: mobile ? "22px" : "20px", fontWeight: red ? 600 : undefined, color: red ? "var(--color-accent)" : "var(--color-text-primary)" }}>{label}</span>
      {count !== undefined && (
        <span style={{ fontSize: 12, lineHeight: "17px", color: red ? "var(--color-accent)" : "var(--color-text-muted)" }}>{count}</span>
      )}
    </button>
  );
}
