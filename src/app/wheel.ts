/** The row a scrolled wheel rests on: `scrollTop` over the item height, clamped to the list. */
export function wheelIndex(scrollTop: number, itemHeight: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(scrollTop / itemHeight)));
}
