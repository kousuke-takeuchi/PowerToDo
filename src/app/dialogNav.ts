/** Spec ① §2.5: previous / next follow the order of the rows on screen (row focus keys, `taskKey`). */
export function neighbors(keys: string[], key: string): { prev?: string; next?: string } {
  const i = keys.indexOf(key);
  if (i < 0) return { prev: undefined, next: undefined };
  return { prev: keys[i - 1], next: keys[i + 1] };
}

/** The task to show after the current one left the list (completed, deleted, moved): next, else previous. */
export function afterRemoval(keys: string[], key: string): string | null {
  const { prev, next } = neighbors(keys, key);
  return next ?? prev ?? null;
}

/** Which `useProject` holds the dialog's task: the open project's (only on its own screen) or a second one. */
export function dialogTarget(
  dialog: { project: string; no: number } | null,
  current: string,
  projectScreen: boolean,
): "none" | "current" | "other" {
  if (!dialog) return "none";
  return projectScreen && dialog.project === current ? "current" : "other";
}

/** Inverse of `taskKey` (`${project}/${no}`); a project name may contain "/". */
export function parseKey(key: string): { project: string; no: number } {
  const i = key.lastIndexOf("/");
  return { project: key.slice(0, i), no: Number(key.slice(i + 1)) };
}
