import type React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMotionTiming } from "../../motion";
import { FADE_SECONDS, PUSH_EASE, PUSH_SECONDS, posesFor, type ScreenDirection } from "./screenMotion";

/**
 * Holds the iPhone app's current screen and animates a change of screen (spec 2026-11-28): a push slides the new screen in over the old,
 * a back slides it out, a tab change cross-fades. The old screen stays as it was while it leaves. Reduce Motion: no movement.
 * The sheets and popups are not in here (they have their own motion); put them next to the stack.
 */
export function ScreenStack({ screenKey, direction, children }: { screenKey: string; direction: ScreenDirection; children: React.ReactNode }) {
  const { reduced } = useMotionTiming();
  const poses = posesFor(reduced ? "none" : direction);
  const transition = reduced ? { duration: 0 } : direction === "fade" ? { duration: FADE_SECONDS, ease: "easeOut" as const } : { duration: PUSH_SECONDS, ease: PUSH_EASE };
  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh", overflow: "hidden", background: "var(--color-bg)" }}>
      <AnimatePresence initial={false} custom={poses}>
        <motion.div
          key={screenKey}
          custom={poses}
          variants={{
            enter: (p: typeof poses) => ({ ...p.enter }),
            rest: { x: "0%", opacity: 1, zIndex: direction === "none" ? 1 : 2 },
            exit: (p: typeof poses) => ({ ...p.exit }),
          }}
          initial="enter"
          animate="rest"
          exit="exit"
          transition={transition}
          style={{ position: "absolute", inset: 0, background: "var(--color-bg)", boxShadow: direction === "push" || direction === "pop" ? "-8px 0 24px rgba(0,0,0,0.08)" : undefined }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
