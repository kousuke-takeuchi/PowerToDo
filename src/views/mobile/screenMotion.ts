/** How a screen of the iPhone app arrives (spec 2026-11-28): the new screen slides in from the right and the old one steps back (a push), the
 *  reverse for a back, a short cross-fade between tabs. Pure; tested with node. */
export type ScreenDirection = "push" | "pop" | "fade" | "none";

/** The screen under a sliding one moves this far (a fraction of the width) and dims, as iOS's navigation does. */
export const UNDER_SHIFT = 0.28;
/** The iOS navigation curve (a fast start, a long settle) and its length. */
export const PUSH_EASE = [0.32, 0.72, 0, 1] as const;
export const PUSH_SECONDS = 0.38;
export const FADE_SECONDS = 0.18;

type Nav = { tab: string; browse: readonly unknown[] };

/** What to do when the app goes from navigation `a` to `b`: another tab fades; a deeper 閲覧 stack pushes; a shallower one pops. */
export function directionBetween(a: Nav, b: Nav): ScreenDirection {
  if (a.tab !== b.tab) return "fade";
  if (b.browse.length > a.browse.length) return "push";
  if (b.browse.length < a.browse.length) return "pop";
  return "none";
}

export type ScreenPose = { x: string; opacity: number; zIndex: number; filter?: string };

/** Where a screen starts (`enter`) and where it leaves to (`exit`) for a direction; the resting pose is x 0, opacity 1. */
export function posesFor(direction: ScreenDirection): { enter: ScreenPose; exit: ScreenPose } {
  const under = `${-UNDER_SHIFT * 100}%`;
  switch (direction) {
    case "push":
      return { enter: { x: "100%", opacity: 1, zIndex: 2 }, exit: { x: under, opacity: 0.85, zIndex: 1 } };
    case "pop":
      return { enter: { x: under, opacity: 0.85, zIndex: 1 }, exit: { x: "100%", opacity: 1, zIndex: 2 } };
    case "fade":
      return { enter: { x: "0%", opacity: 0, zIndex: 2 }, exit: { x: "0%", opacity: 0, zIndex: 1 } };
    default:
      return { enter: { x: "0%", opacity: 1, zIndex: 1 }, exit: { x: "0%", opacity: 1, zIndex: 1 } };
  }
}
