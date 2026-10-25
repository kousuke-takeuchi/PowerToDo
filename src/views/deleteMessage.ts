/** Spec ② §4.3: the body of the delete confirmation. */
export function deleteMessage(title: string, subtasks: number): string {
  return subtasks > 0 ? `「${title}」とサブタスク ${subtasks} 件を削除します。` : `「${title}」を削除します。`;
}

/** The subtasks (at any depth) that go with task `no`. */
export function countDescendants(tasks: { no: number; parentNo?: number }[], no: number): number {
  const kids = tasks.filter((t) => t.parentNo === no);
  return kids.reduce((n, k) => n + 1 + countDescendants(tasks, k.no), 0);
}
