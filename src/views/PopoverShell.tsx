import type React from "react";

/** ポップオーバーの外枠 (pen の DatePopover など: 幅 320, padding 12, 角丸 12, 影)。位置決めは呼び出し側。 */
export function PopoverShell({ children, gap = "var(--space-3)", label }: { children: React.ReactNode; gap?: string; label: string }) {
  return (
    <div
      role="dialog"
      aria-label={label}
      style={{
        width: 320,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap,
        padding: "var(--space-3)",
        background: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        boxShadow: "var(--shadow-popover)",
        fontFamily: "var(--font-body)",
        color: "var(--color-text-primary)",
      }}
    >
      {children}
    </div>
  );
}

/** ポップオーバー内の 1 行 (padding 6/4, gap 8)。 */
export function PopRow({
  icon,
  iconColor = "var(--color-text-secondary)",
  children,
  onClick,
  selected,
  borderTop,
  ariaLabel,
}: {
  icon?: React.ReactNode;
  iconColor?: string;
  children: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
  borderTop?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={selected}
      className={selected ? undefined : "bg-transparent hover:bg-[var(--color-bg-hover)]"}
      style={{
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "6px 4px",
        border: 0,
        borderTop: borderTop ? "1px solid var(--color-border)" : 0,
        borderRadius: borderTop ? 0 : 6,
        background: selected ? "var(--color-bg-hover)" : undefined,
        fontFamily: "var(--font-body)",
        textAlign: "left",
        cursor: onClick ? "pointer" : "default",
        color: "var(--color-text-primary)",
      }}
    >
      {icon && <span style={{ display: "inline-flex", color: iconColor, flex: "0 0 auto" }}>{icon}</span>}
      {children}
    </button>
  );
}
