import type React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export type SectionHeaderProps = {
  title: string;
  count?: number | string;
  collapsed?: boolean;
  onToggle?: () => void;
  showChevron?: boolean;
  trailing?: React.ReactNode;
  /**
   * 渡すとタイトルのダブルクリックでこれを呼ぶ (名前の編集を始める)。このときタイトルは折りたたみボタンの外に出し、
   * 折りたたみはシェブロンのボタンで行う (ダブルクリックで折りたたみが切り替わらないように)。
   */
  onStartEdit?: () => void;
  /** 渡すとタイトルの代わりにこれ (名前の入力欄) を出す。編集中かどうかは呼び出し側が持つ。 */
  editor?: React.ReactNode;
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "12px 0 8px 0",
  boxShadow: "inset 0 -1px 0 var(--color-border)", // pen の stroke は内側 (高さに加算しない)
  fontFamily: "var(--font-body)",
};
const buttonReset: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: 0,
  border: 0,
  background: "none",
  fontFamily: "var(--font-body)",
  textAlign: "left",
};
const chevronStyle: React.CSSProperties = { display: "inline-flex", color: "var(--color-text-secondary)", flex: "0 0 auto" };
const titleTextStyle: React.CSSProperties = { fontSize: 14, lineHeight: "20px", fontWeight: 700, color: "var(--color-text-primary)" };
const countStyle: React.CSSProperties = { fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" };

export function SectionHeader({ title, count, collapsed, onToggle, showChevron = true, trailing, onStartEdit, editor }: SectionHeaderProps) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const chevron = showChevron && (
    <span style={chevronStyle}>
      <Chevron size={16} />
    </span>
  );
  const countEl = count !== undefined && <span style={countStyle}>{count}</span>;

  let main: React.ReactNode;
  if (editor) {
    main = (
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        {chevron}
        {editor}
      </div>
    );
  } else if (onStartEdit) {
    main = (
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        {showChevron && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={title}
            style={{ ...buttonReset, cursor: onToggle ? "pointer" : "default" }}
          >
            {chevron}
          </button>
        )}
        <span onDoubleClick={onStartEdit} title="ダブルクリックで名前を変更" style={titleTextStyle}>
          {title}
        </span>
        {countEl}
      </div>
    );
  } else {
    main = (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={showChevron ? !collapsed : undefined}
        style={{ flex: 1, minWidth: 0, ...buttonReset, cursor: onToggle ? "pointer" : "default" }}
      >
        {chevron}
        <span style={titleTextStyle}>{title}</span>
        {countEl}
      </button>
    );
  }
  return (
    <div style={rowStyle}>
      {main}
      {trailing}
    </div>
  );
}
