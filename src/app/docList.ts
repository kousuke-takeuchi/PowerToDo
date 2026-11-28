import type { DocSummary } from "../types/model";

/** `2026-11-28T09:05:00` -> `11/28 09:05` (the document row's update time). Unknown text is returned as it is. */
export function shortStamp(updated: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(updated);
  if (!m) return updated;
  return `${Number(m[1])}/${Number(m[2])} ${m[3]}:${m[4]}`;
}

/** The muted second line of a document row: `<section or プロジェクト全体> · <updated> · <author>`. */
export function rowLine(d: Pick<DocSummary, "section" | "updated" | "author">): string {
  return [d.section ?? "プロジェクト全体", shortStamp(d.updated), d.author].filter((s) => s !== "").join(" · ");
}
