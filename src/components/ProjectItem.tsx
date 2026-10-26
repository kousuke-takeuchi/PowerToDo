import type React from "react";
import { GripVertical, Hash } from "lucide-react";

export type ProjectItemProps = {
  color: string; // CSS 変数名 (例 "var(--color-priority-3)")
  label: string;
  count?: number | string;
  active?: boolean;
  /** iPhone 閲覧 tab: full-width rows, 16 text, colored #. */
  mobile?: boolean;
  onClick?: () => void;
  /** Desktop: pressing the grip starts a drag (spec 3). The grip is always mounted (CSS hover only) because it holds the pointer capture. */
  onHandlePointerDown?: (e: React.PointerEvent) => void;
  /** The item being dragged (opacity 0.4). */
  dragging?: boolean;
};

export function ProjectItem({ color, label, count, active, mobile, onClick, onHandlePointerDown, dragging }: ProjectItemProps) {
  // Desktop (Todoist): the current item is light red with red text. Mobile keeps the grey row.
  const red = active && !mobile;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group ${red ? "" : "bg-transparent hover:bg-[var(--color-bg-hover)]"}`}
      style={{
        width: "100%",
        position: "relative",
        opacity: dragging ? 0.4 : undefined,
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
      {onHandlePointerDown && !mobile && (
        <span
          role="button"
          aria-label="ドラッグして動かす"
          onPointerDown={onHandlePointerDown}
          onClick={(e) => e.stopPropagation()}
          className="opacity-0 group-hover:opacity-100"
          style={{ position: "absolute", left: -15, top: 9, display: "inline-flex", color: "var(--color-text-muted)", cursor: "grab", touchAction: "none" }}
        >
          <GripVertical size={16} />
        </span>
      )}
      <span style={{ display: "inline-flex", flex: "0 0 auto" }}>
        <Hash size={18} color={color} aria-hidden />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: mobile ? 16 : 14, lineHeight: mobile ? "22px" : "20px", fontWeight: red ? 600 : undefined, color: red ? "var(--color-accent)" : "var(--color-text-primary)" }}>{label}</span>
      {count !== undefined && (
        <span style={{ fontSize: 12, lineHeight: "17px", color: red ? "var(--color-accent)" : "var(--color-text-muted)" }}>{count}</span>
      )}
    </button>
  );
}
