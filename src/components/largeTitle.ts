/** Spec ④ iPhone §3.3: the large title (34 bold, line 41) and its count line (12, line 16). Scrolling this far finishes the move into the bar. */
export const LARGE_TITLE_HEIGHT = 57;

/** Scroll position -> how far the title has moved into the bar (0..1). iOS bounce gives negative values; they count as 0. */
export function titleProgress(scrollTop: number, distance: number = LARGE_TITLE_HEIGHT): number {
  if (!Number.isFinite(scrollTop) || distance <= 0) return scrollTop > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, scrollTop / distance));
}

export type TitleLook = { largeOpacity: number; largeScale: number; smallOpacity: number };

/** The large title shrinks to 0.9 and fades out; the small one fades in over the second half, so they never read at once. */
export function titleLook(p: number): TitleLook {
  const q = Math.min(1, Math.max(0, p));
  return { largeOpacity: 1 - q, largeScale: 1 - 0.1 * q, smallOpacity: Math.max(0, 2 * q - 1) };
}
