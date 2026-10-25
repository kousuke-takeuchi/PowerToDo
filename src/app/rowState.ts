/** Main's inline-editing state (spec ②), keyed by row keys (`project/no`). */
export type RowState = {
  editing: string | null;
  inserting: { project: string; anchorNo: number; where: "before" | "after" } | null;
  overlay: string | null;
};

/**
 * Drops what points at a row no longer on screen (another view, deleted, completed and hidden, gone after a sync):
 * left set, it would keep the row keys off and reopen an editor later.
 */
export function rowStateAfter(keys: string[], s: RowState): RowState {
  const shown = new Set(keys);
  const keep = (k: string | null) => (k !== null && shown.has(k) ? k : null);
  const ins = s.inserting && shown.has(`${s.inserting.project}/${s.inserting.anchorNo}`) ? s.inserting : null;
  return { editing: keep(s.editing), inserting: ins, overlay: keep(s.overlay) };
}
