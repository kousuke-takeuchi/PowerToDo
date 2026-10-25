import type React from "react";
import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { ChevronDown, ChevronRight, GripVertical, Hash, Pencil, Calendar, MessageSquare, Ellipsis, ListTree, Repeat } from "lucide-react";
import { Checkbox } from "./Checkbox";
import { DateChip } from "./DateChip";
import { LabelChip } from "./LabelChip";
import { MoreChip } from "./MoreChip";
import { Button } from "./Button";
import { useMotionTiming } from "../motion";

export type TaskRowProps = {
  title: string;
  description?: string;
  done: boolean;
  priority: 1 | 2 | 3 | 4;
  date?: { label: string; tone: "success" | "danger" | "muted" };
  /** 繰り返しのタスク: 期限チップの右に小さな繰り返しアイコンを出す。 */
  recurring?: boolean;
  labels?: string[];
  moreCount?: number;
  project?: string;
  /** Desktop: shown after the project on the right of the meta line (「プロジェクト / セクション」). */
  section?: string;
  /** Desktop: color of the `#` after the project (a CSS color, e.g. "var(--color-priority-3)"). */
  projectColor?: string;
  /** Comments of the task (spec ① §3.3): shown on the meta line when more than 0. */
  commentCount?: number;
  /** Stories: show the drag handle as if hovered. */
  showHandle?: boolean;
  subtasks?: { done: number; total: number; expanded: boolean };
  indent?: 0 | 1 | 2;
  variant?: "desktop" | "mobile";
  showActions?: boolean;
  /** 右端の 4 アイコンを出さない (D-03 のサブタスク行)。 */
  hideActions?: boolean;
  /** キーボードのフォーカス行: 左に 2px の accent 枠 + ホバーと同じ背景 + 右端のアイコンを出す。 */
  focused?: boolean;
  onToggleDone?: () => void;
  onToggleExpand?: () => void;
  onClick?: () => void;
  /** 右端の「その他」アイコンを押したとき。 */
  onMore?: () => void;
  /** 鉛筆 (spec ② §2). */
  onEdit?: () => void;
  /** 日付のアイコン. */
  onDate?: () => void;
  /** コメントのアイコン. */
  onComment?: () => void;
  /** Desktop: pressing the drag handle starts a drag (spec ③). The handle stays mounted while dragging (it holds the pointer capture). */
  onHandlePointerDown?: (e: React.PointerEvent) => void;
  /** This row is the one being dragged: drawn at opacity 0.4 while the card follows the pointer. */
  dragging?: boolean;
};

const subCountStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-1)",
  fontFamily: "var(--font-body)",
  fontSize: 12,
  lineHeight: "17px",
  color: "var(--color-text-secondary)",
};

export function TaskRow(p: TaskRowProps) {
  const mobile = p.variant === "mobile";
  const indentPx = (p.indent ?? 0) * (mobile ? 24 : 28);
  const { t } = useMotionTiming();
  const ref = useRef<HTMLDivElement>(null);
  // フォーカス行が画面の外に出たら見える位置までスクロールする (↑↓ で動かしたとき)。
  useEffect(() => {
    if (p.focused) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [p.focused]);
  const showActions = p.showActions || p.focused;
  // Desktop swaps the icon at once (Todoist has no motion here). Mobile turns a right chevron by 90° (not on the first render).
  const chevron = (size: number) =>
    !mobile ? (
      <span aria-hidden style={{ display: "inline-flex" }}>
        {p.subtasks?.expanded ? <ChevronDown size={size} /> : <ChevronRight size={size} />}
      </span>
    ) : (
    <motion.span
      aria-hidden
      initial={false}
      animate={{ rotate: p.subtasks?.expanded ? 90 : 0 }}
      transition={t(0.2)}
      style={{ display: "inline-flex" }}
    >
      <ChevronRight size={size} />
    </motion.span>
  );
  return (
    <div
      ref={ref}
      className={p.focused && mobile ? "group bg-[var(--color-bg-hover)]" : "group"}
      aria-current={p.focused ? "true" : undefined}
      style={{
        position: "relative",
        display: "flex",
        gap: mobile ? "var(--space-3)" : 10,
        alignItems: "flex-start",
        padding: mobile ? "10px 0" : "12px 0 11px",
        // pen の stroke は内側 (高さに加算しない)。フォーカス行: モバイルは左に 2px の accent 枠、デスクトップは角の丸い薄い枠 (Todoist)。
        boxShadow: p.focused
          ? mobile
            ? "inset 2px 0 0 var(--color-accent), inset 0 -1px 0 var(--color-border)"
            : "inset 0 0 0 1px var(--color-border)"
          : "inset 0 -1px 0 var(--color-border)",
        borderRadius: p.focused && !mobile ? 6 : undefined,
        marginLeft: indentPx,
        fontFamily: "var(--font-body)",
        opacity: p.dragging ? 0.4 : undefined,
      }}
      onClick={p.onClick}
    >
      {!mobile && (
        // Drag handle (Todoist): shown on hover or focus (CSS only, so it stays mounted during a drag).
        <span
          aria-hidden={p.onHandlePointerDown ? undefined : true}
          role={p.onHandlePointerDown ? "button" : undefined}
          aria-label={p.onHandlePointerDown ? "ドラッグして動かす" : undefined}
          onPointerDown={p.onHandlePointerDown}
          className={p.showHandle || p.focused ? undefined : "opacity-0 group-hover:opacity-100"}
          style={{ position: "absolute", left: -40, top: 14, display: "inline-flex", color: "var(--color-text-muted)", cursor: p.onHandlePointerDown ? "grab" : undefined, touchAction: "none" }}
        >
          <GripVertical size={16} />
        </span>
      )}
      {p.subtasks && !mobile && (
        <button
          type="button"
          aria-label={p.subtasks.expanded ? "サブタスクを折りたたむ" : "サブタスクを展開"}
          aria-expanded={p.subtasks.expanded}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggleExpand?.();
          }}
          style={{
            position: "absolute",
            left: -24,
            top: 14,
            width: 16,
            height: 16,
            padding: 0,
            border: 0,
            background: "none",
            color: "var(--color-text-muted)",
            cursor: "pointer",
          }}
        >
          {chevron(16)}
        </button>
      )}
      <div style={{ display: "flex", flex: "0 0 auto" }} onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={p.done} priority={p.priority} onChange={() => p.onToggleDone?.()} size={mobile ? 20 : 18} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: mobile ? "var(--space-1)" : 0 }}>
        <div
          style={{
            fontSize: 14,
            lineHeight: "20px",
            color: p.done ? "var(--color-text-muted)" : "var(--color-text-primary)",
            overflowWrap: "anywhere",
          }}
        >
          {p.title}
        </div>
        {p.description && (
          <div style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-secondary)" }}>{p.description}</div>
        )}
        {(p.date || p.recurring || p.labels?.length || p.moreCount || p.project || p.subtasks || p.commentCount) && (
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "nowrap" }}>
            {p.date && <DateChip label={p.date.label} tone={p.date.tone} />}
            {p.recurring && (
              <span role="img" aria-label="繰り返し" style={{ display: "inline-flex", color: "var(--color-text-secondary)" }}>
                <Repeat size={12} />
              </span>
            )}
            {p.labels?.map((l) => (
              <LabelChip key={l} name={l} />
            ))}
            {p.moreCount ? <MoreChip count={p.moreCount} /> : null}
            {p.project && mobile && (
              <span style={{ fontSize: 12, lineHeight: "17px", color: "var(--color-text-muted)" }}>{p.project}</span>
            )}
            {p.subtasks &&
              (mobile ? (
                <button
                  type="button"
                  aria-label={p.subtasks.expanded ? "サブタスクを折りたたむ" : "サブタスクを展開"}
                  aria-expanded={p.subtasks.expanded}
                  onClick={(e) => {
                    e.stopPropagation();
                    p.onToggleExpand?.();
                  }}
                  style={{ ...subCountStyle, background: "none", border: 0, padding: 0, cursor: "pointer" }}
                >
                  <ListTree size={12} color="var(--color-text-muted)" />
                  {p.subtasks.done}/{p.subtasks.total}
                  {chevron(12)}
                </button>
              ) : (
                <span style={subCountStyle}>
                  <ListTree size={12} color="var(--color-text-muted)" />
                  {p.subtasks.done}/{p.subtasks.total}
                </span>
              ))}
            {p.commentCount ? (
              <span style={subCountStyle} aria-label={`コメント ${p.commentCount} 件`}>
                <MessageSquare size={12} color="var(--color-text-muted)" aria-hidden />
                {p.commentCount}
              </span>
            ) : null}
            {p.project && !mobile && (
              // Todoist: the project (and section) on the right of the meta line, with a colored #.
              <span
                style={{
                  marginLeft: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  lineHeight: "17px",
                  color: "var(--color-text-secondary)",
                  whiteSpace: "nowrap",
                }}
              >
                {p.section ? `${p.project} / ${p.section}` : p.project}
                <Hash size={12} color={p.projectColor ?? "var(--color-text-muted)"} aria-hidden />
              </span>
            )}
          </div>
        )}
      </div>
      {!mobile && !p.hideActions && (
        // On the first line at the right, over the row (Todoist): the meta line keeps the full width for the project.
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 8,
            display: "flex",
            gap: "var(--space-1)",
            alignItems: "center",
            background: "var(--color-bg)",
            opacity: showActions ? 1 : undefined,
          }}
          onClick={(e) => e.stopPropagation()}
          className={showActions ? undefined : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}
        >
          <Button variant="icon" icon={Pencil} ariaLabel="編集" onClick={p.onEdit} />
          <Button variant="icon" icon={Calendar} ariaLabel="日付" onClick={p.onDate} />
          <Button variant="icon" icon={MessageSquare} ariaLabel="コメント" onClick={p.onComment} />
          <Button variant="icon" icon={Ellipsis} ariaLabel="その他" onClick={p.onMore} />
        </div>
      )}
    </div>
  );
}
