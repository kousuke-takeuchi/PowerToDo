import type React from "react";
import { ChevronDown, ChevronRight, Hash, Inbox, ListTree, MessageSquare, Repeat } from "lucide-react";
import { Checkbox } from "./Checkbox";
import { DateChip } from "./DateChip";
import type { TaskRowProps } from "./TaskRow";

/** Spec ④ iPhone §4.1-4.2. The list pads 15 at both sides; the text starts 12 after the 22 checkbox (x 49); a child's checkbox sits under its parent's text. */
export const MOBILE_ROW = { checkbox: 22, gap: 12, indent: 34, oneLine: 48, twoLine: 63 } as const;

const oneLine: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const meta: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  fontSize: 12,
  lineHeight: "17px",
  color: "var(--color-text-secondary)",
  flex: "0 0 auto",
};

export function MobileTaskRow(p: TaskRowProps) {
  const sub = p.subtasks;
  const hasMeta = !!(p.date || p.recurring || sub || p.commentCount || p.project);
  const twoOrMore = hasMeta || !!p.description;
  return (
    <div
      data-mobile-row=""
      aria-current={p.focused ? "true" : undefined}
      onClick={p.onClick}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: MOBILE_ROW.gap,
        boxSizing: "border-box",
        // 2 lines: 11 + 22 + 2 + 17 + 11 = 63 (3 lines with a description: 82); 1 line: 13 + 22 + 13 = 48
        padding: twoOrMore ? "11px 0" : "13px 0",
        marginLeft: (p.indent ?? 0) * MOBILE_ROW.indent,
        background: p.focused ? "var(--color-bg-hover)" : undefined,
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ display: "flex", flex: "0 0 auto" }} onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={p.done} priority={p.priority} onChange={() => p.onToggleDone?.()} size={22} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ ...oneLine, flex: 1, minWidth: 0, fontSize: 16, lineHeight: "22px", color: p.done ? "var(--color-text-muted)" : "var(--color-text-primary)" }}>{p.title}</div>
          {sub && (
            // Spec ④ iPhone §4.2: a chevron at the right of the title line; switches at once (no motion).
            <button
              type="button"
              aria-label={sub.expanded ? "サブタスクを折りたたむ" : "サブタスクを展開"}
              aria-expanded={sub.expanded}
              onClick={(e) => {
                e.stopPropagation();
                p.onToggleExpand?.();
              }}
              style={{ display: "grid", placeItems: "center end", width: 44, height: 44, margin: "-11px 0", padding: 0, border: 0, background: "none", color: "var(--color-text-secondary)", cursor: "pointer", flex: "0 0 auto" }}
            >
              {sub.expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </button>
          )}
        </div>
        {p.description && <div style={{ ...oneLine, fontSize: 13, lineHeight: "17px", color: "var(--color-text-secondary)" }}>{p.description}</div>}
        {hasMeta && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {sub && (
              <span style={meta}>
                <ListTree size={12} aria-hidden />
                {sub.done}/{sub.total}
              </span>
            )}
            {p.date && <DateChip label={p.date.label} tone={p.date.tone} />}
            {p.recurring && (
              <span role="img" aria-label="繰り返し" style={meta}>
                <Repeat size={12} />
              </span>
            )}
            {p.commentCount ? (
              <span style={meta} aria-label={`コメント ${p.commentCount} 件`}>
                <MessageSquare size={12} aria-hidden />
                {p.commentCount}
              </span>
            ) : null}
            {p.project && (
              <span style={{ ...meta, flex: "1 1 auto", minWidth: 0, justifyContent: "flex-end", marginLeft: "auto" }}>
                <span style={oneLine}>{p.project}</span>
                {p.projectIsInbox ? <Inbox size={12} aria-hidden /> : <Hash size={12} color={p.projectColor ?? "var(--color-text-muted)"} aria-hidden />}
              </span>
            )}
          </div>
        )}
      </div>
      {/* Hairline from the text's left edge to the right padding; none under the checkbox */}
      <span aria-hidden style={{ position: "absolute", left: MOBILE_ROW.checkbox + MOBILE_ROW.gap, right: 0, bottom: 0, height: 0.5, background: "var(--color-border)" }} />
    </div>
  );
}
