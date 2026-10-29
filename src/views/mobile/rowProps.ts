import type { TaskRowProps } from "../../components/TaskRow";
import type { Task } from "../../types/model";
import { dateLabel } from "../../mock/data.ts";

export type RowContext = { today: string; inbox?: string; colors?: Record<string, string>; comments?: Record<string, number> };

/** Spec ④ iPhone §4.1: what an iPhone row shows. `show.project` on cross views (Today, Upcoming, label, search), not on a project's own list. */
export function mobileRowProps(
  t: Task,
  c: RowContext,
  show: { date?: boolean; project?: boolean } = {},
): Pick<TaskRowProps, "title" | "description" | "priority" | "date" | "recurring" | "commentCount" | "project" | "projectColor" | "projectIsInbox"> {
  const inbox = c.inbox !== undefined && t.project === c.inbox;
  return {
    title: t.title,
    description: t.note?.split("\n")[0] || undefined,
    priority: t.priority,
    date: show.date === false ? undefined : dateLabel(t.due, c.today),
    recurring: t.rrule ? true : undefined,
    commentCount: c.comments?.[`${t.project}/${t.no}`] || undefined,
    project: show.project ? (inbox ? "受信トレイ" : t.project) : undefined,
    projectColor: show.project && !inbox ? c.colors?.[t.project] : undefined,
    projectIsInbox: show.project && inbox ? true : undefined,
  };
}
