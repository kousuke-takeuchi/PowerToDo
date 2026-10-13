import type React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export type SectionHeaderProps = {
  title: string;
  count?: number | string;
  collapsed?: boolean;
  onToggle?: () => void;
  showChevron?: boolean;
  trailing?: React.ReactNode;
};

export function SectionHeader({ title, count, collapsed, onToggle, showChevron = true, trailing }: SectionHeaderProps) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "12px 0 8px 0",
        boxShadow: "inset 0 -1px 0 var(--color-border)", // pen の stroke は内側 (高さに加算しない)
        fontFamily: "var(--font-body)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={showChevron ? !collapsed : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: 0,
          border: 0,
          background: "none",
          fontFamily: "var(--font-body)",
          textAlign: "left",
          cursor: onToggle ? "pointer" : "default",
        }}
      >
        {showChevron && (
          <span style={{ display: "inline-flex", color: "var(--color-text-secondary)", flex: "0 0 auto" }}>
            <Chevron size={16} />
          </span>
        )}
        <span style={{ fontSize: 14, lineHeight: "20px", fontWeight: 700, color: "var(--color-text-primary)" }}>{title}</span>
        {count !== undefined && (
          <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" }}>{count}</span>
        )}
      </button>
      {trailing}
    </div>
  );
}
