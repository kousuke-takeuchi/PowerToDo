import type { Task } from "../../types/model";

/**
 * The No. of the moved root after `move_task` put a subtree into the target project. The move numbers the whole
 * subtree after the target's highest No. in file order, so the highest No. is usually a subtask: pick the task with
 * no parent among the top `size` Nos (`size` = the subtree's task count). If none is there (the count was short),
 * fall back to the highest parentless No.: every moved No. is above the target's old ones, and only the root has no parent.
 */
export function movedRootNo(tasks: Task[], size: number): number | undefined {
  const roots = tasks.filter((x) => x.parentNo == null).map((x) => x.no).sort((a, b) => b - a);
  if (!roots.length) return undefined;
  const top = tasks.map((x) => x.no).sort((a, b) => b - a).slice(0, Math.max(1, size));
  return roots.find((no) => top.includes(no)) ?? roots[0];
}
