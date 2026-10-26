/**
 * Spec ④ iPhone §5.2, measured from the owner's recording: a sheet opens in about 0.37 s, 70 % of the way in the first
 * 0.1 s, with no overshoot. That is a critically damped spring (damping ratio 1): x(t) = 1 - (1 + ωt)e^(-ωt), and
 * (1 + 2.44)e^(-2.44) = 0.30 gives ω = 24.4 rad/s (stiffness ω², damping 2ω, mass 1). Pure, tested with node.
 */
export const SHEET_OMEGA = 24.4;

export function springProgress(t: number, omega: number = SHEET_OMEGA): number {
  return 1 - (1 + omega * t) * Math.exp(-omega * t);
}

export const EASE_IN = [0.4, 0, 1, 1] as const;
/** The same curve as motion.tsx's EASE (fast deceleration). */
export const EASE_OUT = [0.2, 0, 0, 1] as const;

export type SheetPhase = "open" | "close" | "detent";
export type SheetTransition =
  | { type: "spring"; stiffness: number; damping: number; mass: 1 }
  | { duration: number; ease: readonly [number, number, number, number] };

/** open: the spring; close: 0.13 s ease-in (× or swipe); detent (85 % <-> full, the dim of a covered sheet): 0.2 s decelerating. Reduce Motion: instant. */
export function sheetTransition(phase: SheetPhase, reduced: boolean): SheetTransition {
  if (reduced) return { duration: 0, ease: EASE_OUT };
  if (phase === "open") return { type: "spring", stiffness: SHEET_OMEGA ** 2, damping: 2 * SHEET_OMEGA, mass: 1 };
  if (phase === "close") return { duration: 0.13, ease: EASE_IN };
  return { duration: 0.2, ease: EASE_OUT };
}

/** The sheet under another sheet (spec ④ iPhone §5.2). */
export const COVERED_SCALE = 0.95;

export type Detent = "auto" | "large" | "full";

/** Gap above a sheet at its full stop (px): 8 below the top safe area (status bar / notch), 8 where there is none. */
export function sheetTopGap(safeTop: number): number {
  return Math.max(8, (Number.isFinite(safeTop) ? safeTop : 0) + 8);
}

/** Where a sheet goes when the finger lets go of its header. Positive y is down (px, px/s). */
export function sheetDragEnd(detent: Detent, offsetY: number, velocityY: number): "close" | Detent {
  const down = offsetY > 100 || velocityY > 600;
  const up = offsetY < -60 || velocityY < -600;
  if (detent === "full") return down ? "large" : "full";
  if (detent === "large") return up ? "full" : down ? "close" : "large";
  return down ? "close" : "auto";
}
