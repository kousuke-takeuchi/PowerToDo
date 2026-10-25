import type React from "react";
import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { ChevronRight, Pencil, Calendar, MessageSquare, Ellipsis, ListTree, Repeat } from "lucide-react";
import { Checkbox } from "./Checkbox";
import { DateChip } from "./DateChip";
import { LabelChip } from "./LabelChip";
import { MoreChip } from "./MoreChip";
import { Button } from "./Button";
import { EASE_CSS, useMotionTiming } from "../motion";

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
  const indentPx = (p.indent ?? 0) * (mobile ? 24 : 32);
  const { reduced, t } = useMotionTiming();
  const ref = useRef<HTMLDivElement>(null);
  // フォーカス行が画面の外に出たら見える位置までスクロールする (↑↓ で動かしたとき)。
  useEffect(() => {
    if (p.focused) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [p.focused]);
  const showActions = p.showActions || p.focused;
  // 開閉はアイコンの差し替えではなく、右向きのシェブロンを 90° 回して表す。最初の描画では回すアニメーションをしない。
  const chevron = (size: number) => (
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
      className={p.focused ? "group bg-[var(--color-bg-hover)]" : "group"}
      aria-current={p.focused ? "true" : undefined}
      style={{
        position: "relative",
        display: "flex",
        gap: "var(--space-3)",
        alignItems: "flex-start",
        padding: "10px 0",
        // pen の stroke は内側 (高さに加算しない)。フォーカス行は左に 2px の accent 枠を足す。
        boxShadow: p.focused
          ? "inset 2px 0 0 var(--color-accent), inset 0 -1px 0 var(--color-border)"
          : "inset 0 -1px 0 var(--color-border)",
        marginLeft: indentPx,
        fontFamily: "var(--font-body)",
      }}
      onClick={p.onClick}
    >
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
            top: 12,
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
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
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
        {(p.date || p.recurring || p.labels?.length || p.moreCount || p.project || p.subtasks) && (
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
            {p.project && (
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
          </div>
        )}
      </div>
      {!mobile && !p.hideActions && (
        <div
          style={{
            display: "flex",
            gap: "var(--space-1)",
            alignItems: "center",
            opacity: showActions ? 1 : undefined,
            transition: reduced ? undefined : `opacity 120ms ${EASE_CSS}`,
          }}
          onClick={(e) => e.stopPropagation()}
          className={showActions ? undefined : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}
        >
          <Button variant="icon" icon={Pencil} ariaLabel="編集" />
          <Button variant="icon" icon={Calendar} ariaLabel="日付" />
          <Button variant="icon" icon={MessageSquare} ariaLabel="コメント" />
          <Button variant="icon" icon={Ellipsis} ariaLabel="その他" onClick={p.onMore} />
        </div>
      )}
    </div>
  );
}
