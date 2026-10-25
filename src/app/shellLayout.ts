/** Spec ④ §7: below this window width the sidebar is hidden and opens over the page (Todoist hides it below about 750). */
export const NARROW_BELOW = 750;

export function layoutFor(innerWidth: number): "wide" | "narrow" {
  return innerWidth < NARROW_BELOW ? "narrow" : "wide";
}
