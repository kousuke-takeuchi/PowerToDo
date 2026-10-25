import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { useMotionTiming } from "../motion";

/** How long the toast stays (Todoist: a few seconds). Hovering keeps it. */
export const TOAST_MS = 5000;

/**
 * Bottom-left notice with 「元に戻す」 (Todoist, after completing). Inverted colors so it reads in both themes.
 * Put it inside AnimatePresence; `text` changing restarts the timer.
 */
export function Toast({ text, onUndo, onClose }: { text: string; onUndo: () => void; onClose: () => void }) {
  const { reduced, t } = useMotionTiming();
  const timer = useRef<number | undefined>(undefined);
  const close = useRef(onClose);
  close.current = onClose;
  const start = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => close.current(), TOAST_MS);
  };
  useEffect(() => {
    start();
    return () => window.clearTimeout(timer.current);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: reduced ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : 8 }}
      transition={t(0.15)}
      onMouseEnter={() => window.clearTimeout(timer.current)}
      onMouseLeave={start}
      style={{
        position: "absolute",
        left: 16,
        bottom: 16,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "10px 12px",
        borderRadius: 8,
        background: "var(--color-text-primary)",
        color: "var(--color-bg)",
        boxShadow: "var(--shadow-popover)",
        fontFamily: "var(--font-body)",
        fontSize: 13,
        lineHeight: "19px",
        pointerEvents: "auto",
      }}
    >
      <span>{text}</span>
      <button
        type="button"
        onClick={onUndo}
        style={{ padding: 0, border: 0, background: "none", font: "inherit", fontWeight: 700, color: "var(--color-accent-soft)", cursor: "pointer" }}
      >
        元に戻す
      </button>
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        style={{ display: "inline-flex", padding: 0, border: 0, background: "none", color: "inherit", cursor: "pointer" }}
      >
        <X size={16} />
      </button>
    </motion.div>
  );
}
