import type React from "react";
import { AnimatePresence, motion, useDragControls, useIsPresent } from "motion/react";
import { useEscLayer } from "../../app/layers";
import { useMotionTiming } from "../../motion";
import { sheetTransition } from "./sheetMotion";

/**
 * The task detail as a popup (spec 2026-11-28): a card that rises from the bottom over the list, with a little room left at the top
 * (below the status bar) and rounded top corners, like the calendar event's sheet. Pull the grabber down (or press the 「×」, or the dark
 * area) to close. It holds the whole detail (its own scroll, the comment bar, and the sheets it opens), so the list stays where it was.
 * Put it in a screen's overlay slot.
 */
export function DetailSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return <AnimatePresence initial={false}>{open && <Card key="detail" onClose={onClose}>{children}</Card>}</AnimatePresence>;
}

function Card({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const present = useIsPresent();
  useEscLayer(present, onClose);
  const { reduced } = useMotionTiming();
  const open = sheetTransition("open", reduced);
  const close = sheetTransition("close", reduced);
  const controls = useDragControls();
  return (
    <motion.div
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: open }}
      exit={{ opacity: 0, transition: close }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ position: "absolute", inset: 0, background: "var(--color-scrim)", pointerEvents: "auto", fontFamily: "var(--font-body)" }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="タスクの詳細"
        initial={{ y: reduced ? 0 : "100%" }}
        animate={{ y: 0, transition: open }}
        exit={{ y: reduced ? 0 : "100%", transition: close }}
        drag="y"
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 1 }}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          if (info.offset.y > 100 || info.velocity.y > 600) onClose();
        }}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          top: "calc(env(safe-area-inset-top) + 10px)",
          overflow: "hidden",
          borderRadius: "16px 16px 0 0",
          background: "var(--color-bg)",
          boxShadow: "var(--shadow-popover)",
        }}
      >
        {/* The grabber: the drag handle (the content scrolls, so it does not start drags). */}
        <div onPointerDown={(e) => controls.start(e)} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 20, zIndex: 20, touchAction: "none", display: "grid", placeItems: "start center", paddingTop: 6 }}>
          <div aria-hidden style={{ width: 36, height: 4, borderRadius: 2, background: "var(--color-border)" }} />
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
