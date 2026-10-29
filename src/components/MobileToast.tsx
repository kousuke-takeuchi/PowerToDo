import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Undo2 } from "lucide-react";
import { useMotionTiming } from "../motion";
import { sheetTransition } from "../views/mobile/sheetMotion";
import { TAB_BAR } from "./TabBar";

/** Spec ④ iPhone §5.4: the toast stays 3 s. */
export const MOBILE_TOAST_MS = 3000;

/**
 * A white card just above the tab bar (left of the add button), rising from below. 「元に戻す」 (red, with its icon) is on
 * top, the description under it. Put it inside AnimatePresence. A new `id` restarts the timer. Desktop keeps `Toast`.
 */
export function MobileToast({ text, id, actionLabel = "元に戻す", onAction, onClose }: { text: string; id: number; actionLabel?: string; onAction: () => void; onClose: () => void }) {
  const { reduced } = useMotionTiming();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const t = window.setTimeout(() => close.current(), MOBILE_TOAST_MS);
    return () => window.clearTimeout(t);
  }, [id]);
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: reduced ? 0 : 24 }}
      animate={{ opacity: 1, y: 0, transition: sheetTransition("open", reduced) }}
      exit={{ opacity: 0, y: reduced ? 0 : 24, transition: sheetTransition("close", reduced) }}
      style={{
        position: "absolute",
        left: 10,
        right: 18 + 62 + 10,
        bottom: TAB_BAR.bottom + TAB_BAR.height + 10,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "10px 14px",
        borderRadius: 16,
        background: "var(--color-sheet-card)",
        boxShadow: "var(--shadow-popover)",
        fontFamily: "var(--font-body)",
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        onClick={onAction}
        style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, minHeight: 28, padding: 0, border: 0, background: "none", fontFamily: "var(--font-body)", fontSize: 15, lineHeight: "20px", fontWeight: 600, color: "var(--color-accent)", cursor: "pointer" }}
      >
        <Undo2 size={16} aria-hidden />
        {actionLabel}
      </button>
      <div style={{ fontSize: 13, lineHeight: "18px", color: "var(--color-text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</div>
    </motion.div>
  );
}
