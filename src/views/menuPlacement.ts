const MARGIN = 8;
const GAP = 4;

/** Below the anchor and right-aligned to it; above when it does not fit below; always inside the window. */
export function placeMenu(
  anchor: { top: number; bottom: number; right: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - size.height;
  let top = below + size.height <= viewport.height - MARGIN ? below : above >= MARGIN ? above : MARGIN;
  top = Math.max(MARGIN, Math.min(top, viewport.height - MARGIN - size.height));
  const left = Math.max(MARGIN, Math.min(anchor.right - size.width, viewport.width - MARGIN - size.width));
  return { top, left };
}
