import type React from "react";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { InlineEdit } from "./InlineEdit";

export type SectionHeaderProps = {
  title: string;
  count?: number | string;
  collapsed?: boolean;
  onToggle?: () => void;
  showChevron?: boolean;
  trailing?: React.ReactNode;
  /** 渡すとタイトルのダブルクリックでその場で名前を編集でき、確定でこれを呼ぶ (変更が無ければ呼ばない)。 */
  onRename?: (newName: string) => void;
};

export function SectionHeader({ title, count, collapsed, onToggle, showChevron = true, trailing, onRename }: SectionHeaderProps) {
  const [editing, setEditing] = useState(false);
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
      {editing && onRename ? (
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {showChevron && (
            <span style={{ display: "inline-flex", color: "var(--color-text-secondary)", flex: "0 0 auto" }}>
              <Chevron size={16} />
            </span>
          )}
          <InlineEdit
            value={title}
            ariaLabel="セクション名"
            style={{ fontWeight: 700 }}
            onCommit={(v) => {
              setEditing(false);
              if (v !== title) onRename(v);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
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
        <span
          onDoubleClick={onRename ? () => setEditing(true) : undefined}
          title={onRename ? "ダブルクリックで名前を変更" : undefined}
          style={{ fontSize: 14, lineHeight: "20px", fontWeight: 700, color: "var(--color-text-primary)" }}
        >
          {title}
        </span>
        {count !== undefined && (
          <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" }}>{count}</span>
        )}
      </button>
      )}
      {trailing}
    </div>
  );
}
